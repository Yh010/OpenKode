import { AsyncLocalStorage } from "node:async_hooks";
import type { LLMUsage } from "./interface/LLMUsage.js";

const current = new AsyncLocalStorage<LLMUsage>();
export function recordModelUsage(usage: LLMUsage): void {
    const total = current.getStore();
    if (total) for (const key of Object.keys(total) as (keyof LLMUsage)[]) total[key] += usage[key];
}
export async function withModelUsage<T extends { usage: LLMUsage }>(operation: () => Promise<T>): Promise<T> {
    const total: LLMUsage = { inputTokens: 0, outputTokens: 0, totalDurationNs: 0, promptEvalDurationNs: 0, evalDurationNs: 0 };
    return current.run(total, async () => ({ ...await operation(), usage: total }));
}
