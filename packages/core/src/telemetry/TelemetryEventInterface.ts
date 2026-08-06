export type TelemetryEventType =
    | "run"
    | "agent_step"
    | "generation"
    | "tool"
    | "error";

export interface TelemetryEventInterface {
    eventId: string;
    runId: string;
    spanId: string;
    parentSpanId?: string;
    type: TelemetryEventType;
    name: string;
    startedAt: string;
    endedAt: string;
    status: "ok" | "error";
    metadata?: Record<string, unknown>;
}