export type TelemetryEventType =
    | "run" //one complete user request handled by OpenKode
    | "agent_step" //internal agent decision/work stages that coordinate the run => orchestrator-run, planner-run, coder-run
    | "generation" //actual LLM/provider call => llm.orchestrator, llm.planner, llm.coder, llm.stream
    | "tool" //for tools eg) repo-scan
    | "error"; //standalone error record that is not simply a failed span

    //TODO: incorporate these span types instead of hardcoding => how to do 1) main event type 2) span type
export const SpanType = {
    LLM_PLANNER: "llm.planner",
    LLM_ORCHESTRATOR: "llm.orchestrator",
    LLM_CODER: "llm.coder",
    LLM_GENERATE: "llm.generate",
    LLM_STREAM: "llm.stream",
    PLANNER_RUN: "planner-run",
    CODER_RUN: "coder-run",
    ORCHESTRATOR_RUN: "orchestrator-run"
} as const;

export type SpanType = typeof SpanType[keyof typeof SpanType];

export interface LlmTelemetry {
    provider: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    totalDurationNs?: number;
    promptEvalDurationNs?: number;
    evalDurationNs?: number;
}

export interface TelemetryEventInterface {
    eventId: string; //identifies this stored telemetry record
    runId: string; //groups the whole user request
    spanId: string; //identifies a node in its trace tree
    parentSpanId?: string;
    type: TelemetryEventType;
    name: string;
    startedAt: string;
    endedAt: string;
    status: "ok" | "error";
    metadata?: Record<string, unknown>;
    llm?: LlmTelemetry;
}
