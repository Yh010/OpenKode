import type { LlmTelemetry, SpanType, TelemetryEventType } from "./TelemetryEventInterface.js";

export interface TelemetrySpanDetails {
    metadata?: Record<string, unknown>;
    llm?: LlmTelemetry;
}

export interface TelemetryOwnership {
    userId: string;
    installationId: string;
    sessionId: string;
    chatId?: string;
}

export interface TelemetryInterface{
    withRun<T>(
        name: string,
        operation: () => Promise<T>,
        metadataFactory?: (result: T) => TelemetrySpanDetails | undefined,
        ownership?: TelemetryOwnership,
        errorMetadataFactory?: (error: unknown) => TelemetrySpanDetails | undefined,
    ): Promise<T>; // always creates type: "run"
    withSpan<T>(
        type:TelemetryEventType,
        name: SpanType,
        operation: ()=> Promise<T>,
        metadataFactory?: (result: T) => TelemetrySpanDetails | undefined,
        errorMetadataFactory?: (error: unknown) => TelemetrySpanDetails | undefined,
    ) : Promise<T>;
    shutdown(): Promise<void> ;
}
