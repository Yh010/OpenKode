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
        { role: "system", content: `${systemPrompt}\n\nThe final user message is the current task and runtime context. Earlier conversation is background only; do not repeat or carry out an old task instead of the current request.` },
    ];

    if (request.type === "delegate") {
        const { conversation, ...currentContext } = request.context ?? {};
        if (conversation?.length) messages.push({role:"user",content:JSON.stringify({backgroundConversation:conversation})});
        messages.push({
            role: "user",
            content: JSON.stringify({
                task: request.task,
                feedback: request.feedback ?? "",
                context: currentContext,
            }),
        });
    }

    return messages;
}
