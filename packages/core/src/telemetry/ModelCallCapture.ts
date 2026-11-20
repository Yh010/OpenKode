import { AsyncLocalStorage } from "node:async_hooks";
import { TelemetryPayloadPolicy } from "./TelemetryPayloadPolicy.js";
import type { LLMUsage } from "../llm/interface/LLMUsage.js";

type Attempt = { attempt: number; status?: number; outcome: "ok" | "http_error" | "network_error"; retryInMs?: number };
const current = new AsyncLocalStorage<ModelCallCapture>();

export class ModelCallCapture {
    readonly output;
    readonly attempts: Attempt[] = [];
    usage: LLMUsage | undefined;
    constructor(policy: TelemetryPayloadPolicy) { this.output = policy.createStreamCapture(); }
    run<T>(operation: () => Promise<T>): Promise<T> { return current.run(this, operation); }
}
export function captureModelText(text: string): void { current.getStore()?.output.append(text); }
export function captureModelAttempt(attempt: Attempt): void { current.getStore()?.attempts.push(attempt); }
export function captureModelUsage(usage: LLMUsage | undefined): void {
    const capture = current.getStore();
    if (capture && usage) capture.usage = { ...usage };
}
