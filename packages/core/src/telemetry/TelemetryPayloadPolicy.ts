export interface TelemetryPayloadPolicyOptions {
    captureLlmContent: boolean;
    maxContentChars: number;
}

interface CapturedContent {
    value: string;
    truncated: boolean;
}

export interface StreamCapture {
    append(chunk: string): void;
    getValue(): { value: string; truncated: boolean };
}

interface TelemetryMessage {
    role: string;
    content: string;
}

export class TelemetryPayloadPolicy {
    readonly captureLlmContent: boolean;
    readonly maxContentChars: number;

    constructor(options: TelemetryPayloadPolicyOptions) {
        this.captureLlmContent = options.captureLlmContent;
        this.maxContentChars = options.maxContentChars;
    }

    static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): TelemetryPayloadPolicy {
        return new TelemetryPayloadPolicy({
            captureLlmContent: environment.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT === "true",
            maxContentChars: parsePositiveInteger(
                environment.OPENKODE_TELEMETRY_LLM_MAX_CONTENT_CHARS,
                4_000,
            ),
        });
    }

    generationMetadata(
        input: { messages: TelemetryMessage[] },
        output: unknown,
        streamOutputTruncated = false,
    ): Record<string, unknown> | undefined {
        if (!this.captureLlmContent) {
            return undefined;
        }

        const capturedInput = this.captureMessages(input.messages);
        const capturedOutput = this.capture(output);

        return {
            llm: {
                inputMessages: capturedInput.value,
                inputMessageCount: input.messages.length,
                output: capturedOutput.value,
                inputTruncated: capturedInput.truncated,
                outputTruncated: capturedOutput.truncated || streamOutputTruncated,
            },
        };
    }

    createStreamCapture(): StreamCapture {
        let value = "";
        let truncated = false;

        return {
            append: (chunk: string) => {
                if (!this.captureLlmContent || truncated) {
                    return;
                }

                const remaining = this.maxContentChars - value.length;
                if (chunk.length > remaining) {
                    value += chunk.slice(0, Math.max(remaining, 0));
                    truncated = true;
                    return;
                }

                value += chunk;
            },
            getValue: () => ({ value, truncated }),
        };
    }

    private capture(value: unknown): CapturedContent {
        const redacted = redactSensitiveText(safelySerialize(value));
        if (redacted.length <= this.maxContentChars) {
            return { value: redacted, truncated: false };
        }

        return {
            value: `${redacted.slice(0, this.maxContentChars)}…[truncated]`,
            truncated: true,
        };
    }

    private captureMessages(messages: TelemetryMessage[]): {
        value: TelemetryMessage[];
        truncated: boolean;
    } {
        let remaining = this.maxContentChars;
        let truncated = false;

        // The final message holds the current tool observation and worker context.
        // Capture from newest to oldest so a large system prompt cannot hide it.
        const captured = new Array<TelemetryMessage>(messages.length);
        for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index]!;
            const content = redactSensitiveText(message.content);
            if (content.length <= remaining) {
                remaining -= content.length;
                captured[index] = { role: message.role, content };
                continue;
            }

            const capturedContent = `${content.slice(0, Math.max(remaining, 0))}…[truncated]`;
            remaining = 0;
            truncated = true;
            captured[index] = { role: message.role, content: capturedContent };
        }

        return { value: captured, truncated };
    }
}

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
    const parsedValue = Number(value ?? defaultValue);
    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
}

function safelySerialize(value: unknown): string {
    try {
        return JSON.stringify(value, (_, item: unknown) =>
            typeof item === "bigint" ? item.toString() : item,
        ) ?? "undefined";
    } catch {
        return "[unserializable telemetry payload]";
    }
}

function redactSensitiveText(value: string): string {
    return value
        .replace(/(authorization["']?\s*[:=]\s*["']?bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
        .replace(/((?:api[_-]?key|password|secret|token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]")
        .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]");
}
