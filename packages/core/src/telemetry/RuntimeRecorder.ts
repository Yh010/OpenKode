import { randomUUID } from "node:crypto";
import type { Delegate } from "../agent/interface/OrchestratorResponsetypes.js";
import type { ToolResult } from "../tools/interface/Tool.js";
import { SpanType } from "./TelemetryEventInterface.js";
import type { TelemetryInterface, TelemetrySpanDetails } from "./TelemetryInterface.js";
import { TelemetryPayloadPolicy } from "./TelemetryPayloadPolicy.js";

export type RuntimeStep = {
    version: 1;
    kind: "agent_call";
    stepId: string;
    agent: "orchestrator" | "planner" | "coder";
    attempt: number;
    fromStepId?: string;
    taskSource: "original_user_request" | "approved_plan_step";
    inputSummary: { historyMessages: number; discoveredFiles?: number; sourceFiles?: number; approvedFiles?: number };
};

function decisionSummary(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") return { type: "unknown" };
    const item = value as Record<string, unknown>;
    return {
        type: typeof item.type === "string" ? item.type : "unknown",
        ...(typeof item.agent === "string" ? { agent: item.agent } : {}),
        ...(typeof item.toolName === "string" ? { toolName: item.toolName } : {}),
    };
}

/** Records execution facts separately from model suggestions. Payloads obey the existing capture policy. */
export class RuntimeRecorder {
    private readonly policy = TelemetryPayloadPolicy.fromEnvironment();
    constructor(private readonly telemetry: TelemetryInterface) {}

    step(agent: RuntimeStep["agent"], attempt: number, fromStepId: string | undefined, context?: Delegate["context"]): RuntimeStep {
        return {
            version: 1, kind: "agent_call", stepId: `step-${randomUUID()}`, agent, attempt,
            ...(fromStepId ? { fromStepId } : {}),
            taskSource: agent === "coder" ? "approved_plan_step" : "original_user_request",
            inputSummary: {
                historyMessages: context?.conversation?.length ?? 0,
                ...(context?.discoveredFiles ? { discoveredFiles: context.discoveredFiles.length } : {}),
                ...(context?.sourceFiles ? { sourceFiles: Object.keys(context.sourceFiles).length } : {}),
                ...(context?.approvedFiles ? { approvedFiles: context.approvedFiles.length } : {}),
            },
        };
    }

    content(values: Record<string, unknown>): Record<string, unknown> {
        const captured = Object.fromEntries(Object.entries(values).flatMap(([key, value]) => {
            if (value === undefined) return [];
            const entry = this.policy.captureRuntimeContent(value);
            return entry ? [[key, entry]] : [];
        }));
        return Object.keys(captured).length ? { runtimeContent: captured } : {};
    }

    agentDetails(step: RuntimeStep, result: unknown, input: unknown): TelemetrySpanDetails {
        const fields = input && typeof input === "object" ? input as Record<string, unknown> : {};
        return { metadata: { runtime: { ...step, modelDecision: decisionSummary(result) }, ...this.content({ input, task: fields.task, systemMessage: fields.feedback, modelOutput: result }) } };
    }

    agentCall<T>(step: RuntimeStep, name: SpanType, operation: () => Promise<T>, input: unknown): Promise<T> {
        return this.telemetry.withSpan("agent_step", name, operation,
            result => this.agentDetails(step,result,input),
            () => this.agentDetails(step,{type:"error"},input));
    }

    async transition(owner: RuntimeStep, reasonCode: string, facts: Record<string, unknown> = {}, content: Record<string, unknown> = {}): Promise<void> {
        try {
            await this.telemetry.withSpan("agent_step", SpanType.RUNTIME_DECISION, async () => undefined, () => ({
                metadata: { runtime: { version: 1, kind: "transition", ownerStepId: owner.stepId, reasonCode, ...facts }, ...this.content(content) },
            }));
        } catch (error) {
            console.error("[OpenKode][telemetry] Could not record runtime transition", error);
        }
    }

    route(owner: RuntimeStep, requested: unknown, effective: unknown, overridden: boolean) {
        return this.transition(owner, overridden ? "planner_route_override" : "model_route_accepted", {
            modelDecision: decisionSummary(requested), effectiveDecision: decisionSummary(effective), overridden,
            routingRule: overridden ? decisionSummary(requested).toolName === "ReadFileTool" ? "direct_file_request_not_recognized" : "planning_required" : "model_route_accepted",
        });
    }

    async tool(owner: RuntimeStep, toolName: string, input: unknown, invoked: boolean, operation: () => Promise<ToolResult>, requestedBy: "model" | "runtime" = "model", validationRule?: string): Promise<ToolResult> {
        try {
            return await this.telemetry.withSpan("tool", SpanType.TOOL_EXECUTION, operation, result => ({
                metadata: {
                    runtime: { version: 1, kind: "tool_result", ownerStepId: owner.stepId, toolName, toolInvoked: invoked, requestedBy,
                        outcome: result.ok ? "ok" : invoked ? "error" : "blocked", ...(!result.ok ? { errorCode: result.code } : {}), ...(!invoked && validationRule ? { validationRule } : {}) },
                    ...this.content({ toolInput: input, toolResult: result }),
                },
            }), error => ({metadata:{
                runtime:{version:1,kind:"tool_result",ownerStepId:owner.stepId,toolName,toolInvoked:invoked,requestedBy,outcome:"error"},
                ...this.content({toolInput:input,error:error instanceof Error ? error.message : String(error)}),
            }}));
        } catch (error) {
            await this.transition(owner, "tool_threw", { toolName, toolInvoked: invoked }, { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }
}
