import type { OrchestratorResponse } from "../../agent/interface/OrchestratorResponsetypes.js";
import type { Message } from "../../agent/interface/Message.js";
import { coderSystemPrompt } from "../../agent/workers/coder/coderSystemPrompt.js";
import { plannerSystemPrompt } from "../../agent/workers/planner/plannerSystemPrompt.js";

export function createPlannerMessages(request: OrchestratorResponse): Message[] {
    return createWorkerMessages(plannerSystemPrompt, request);
}

export function createCoderMessages(request: OrchestratorResponse): Message[] {
    return createWorkerMessages(coderSystemPrompt, request);
}

function createWorkerMessages(systemPrompt: string, request: OrchestratorResponse): Message[] {
    const messages: Message[] = [
        { role: "system", content: systemPrompt },
    ];

    if (request.type === "delegate") {
        messages.push({
            role: "user",
            content: JSON.stringify({
                task: request.task,
                feedback: request.feedback ?? "",
                context: request.context,
            }),
        });
    }

    return messages;
}
