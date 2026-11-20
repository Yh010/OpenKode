import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

/** Keep each submitted question in normal terminal text under a stable speaker label. */
export async function readChatPrompt(input: Readable = process.stdin, output: Writable = process.stdout): Promise<string | undefined> {
    const controller = new AbortController();
    const prompt = createInterface({ input, output, terminal: true });
    const cancel = () => controller.abort();
    prompt.once("SIGINT", cancel);
    prompt.once("close", cancel);
    try {
        return await prompt.question("\nYou › ", { signal: controller.signal });
    } catch (error) {
        if (controller.signal.aborted) return;
        throw error;
    } finally {
        prompt.off("SIGINT", cancel);
        prompt.off("close", cancel);
        prompt.close();
    }
}
