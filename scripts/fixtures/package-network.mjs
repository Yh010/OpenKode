import { appendFileSync } from "node:fs";

// Synthetic responses for the packed-CLI test. No external requests are made.
globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const record = { url: url.href };
    if (url.origin === "https://openkode-collector.onrender.com") record.batch = JSON.parse(String(options.body));
    appendFileSync(process.env.OPENKODE_PACKAGE_SMOKE_LOG, JSON.stringify(record) + "\n");
    if (url.origin === "https://hzrnpjibpbaxjmlbfkeh.supabase.co") {
        if (url.pathname === "/auth/v1/token") return Response.json({ access_token: "synthetic-access-token", refresh_token: "synthetic-refresh-token", expires_at: Math.floor(Date.now() / 1000) + 3600 });
        if (url.pathname === "/auth/v1/user") return Response.json({ id: "00000000-0000-4000-8000-000000000001", email: "package-test@example.invalid" });
        if (url.pathname.startsWith("/rest/v1/")) return new Response(null, { status: 201 });
    }
    if (url.origin === "https://generativelanguage.googleapis.com") {
        const body = JSON.parse(String(options.body));
        if (!body.generationConfig?.responseJsonSchema) throw new Error("Structured output was not requested");
        return new Response(new ReadableStream({ async start(controller) {
            const send = event => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
            send({ candidates: [{ content: { parts: [{ text: '{"result":{"type":"final","answer":"Hello from' }] } }] });
            await new Promise(resolve => setTimeout(resolve, 20));
            send({ candidates: [{ content: { parts: [{ text: ' the installed package."}}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6 } });
            controller.close();
        } }));
    }
    if (url.href === "https://openkode-collector.onrender.com/v1/telemetry/events") return Response.json({ accepted: record.batch.events.length }, { status: 202 });
    throw new Error(`Unexpected request in package smoke test: ${url.origin}${url.pathname}`);
};
