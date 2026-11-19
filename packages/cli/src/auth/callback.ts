import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

export const LOGIN_PORT = 43821;

export async function loginCallback<T>(complete: (code: string) => Promise<T>, options: { port?: number; timeoutMs?: number; signal?: AbortSignal } = {}) {
    const callbackPath = `/auth/callback/${randomBytes(24).toString("hex")}`;
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    // A browser launch error may close the listener before the caller awaits result.
    void result.catch(() => {});
    let busy = false;
    const server = createServer(async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== callbackPath || request.headers.host !== `127.0.0.1:${port}`) {
            response.writeHead(404).end("Not found."); return;
        }
        if (request.method !== "GET") { response.writeHead(405).end("Method not allowed."); return; }
        const codes = url.searchParams.getAll("code");
        if (busy) { response.writeHead(409).end("Sign-in is already being processed."); return; }
        if (url.searchParams.has("error") || codes.length !== 1 || !codes[0]) {
            response.writeHead(400).end("Sign-in did not complete. Return to your terminal.");
            reject(new Error("Google sign-in was cancelled or returned an invalid callback.")); return;
        }
        busy = true;
        try {
            const value = await complete(codes[0]);
            response.end("Signed in to OpenKode. You can close this tab and return to your terminal.");
            resolve(value);
        } catch (error) {
            response.writeHead(400).end("Sign-in failed. Return to your terminal and try again.");
            reject(error instanceof Error ? error : new Error("Sign-in failed."));
        }
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((yes, no) => {
        server.once("error", no);
        server.listen(options.port ?? LOGIN_PORT, "127.0.0.1", () => { server.off("error", no); yes(); });
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : LOGIN_PORT;
    const timer = setTimeout(() => reject(new Error("Sign-in timed out. Run openkode login to retry.")), options.timeoutMs ?? 180_000);
    const abort = () => reject(new Error("Sign-in cancelled."));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const close = async () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        await new Promise<void>(yes => { server.close(() => yes()); server.closeAllConnections(); });
    };
    return { redirect: `http://127.0.0.1:${port}${callbackPath}`, result, close };
}
