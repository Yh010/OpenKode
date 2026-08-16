import type { LLMProvider } from "../llm/interface/LLMProvider.js";
import type { LLMUsage } from "../llm/interface/LLMUsage.js";
import { SpanType } from "../telemetry/TelemetryEventInterface.js";
import type { TelemetryInterface } from "../telemetry/TelemetryInterface.js";
import { RepoScanner } from "../tools/reposcan/Reposcanner.js";
import type { AgentRequest } from "./interface/AgentRequest.js";
import type { AgentResponse } from "./interface/AgentResponse.js";
import type { CoderResponse } from "./interface/CoderResponsetypes.js";
import type { Message } from "./interface/Message.js";
import type { OrchestratorResponse } from "./interface/OrchestratorResponsetypes.js";
import type { PlannerResponse } from "./interface/PlannerResponsetype.js";
import { createOrchestrator } from "./orchestrator/createOrchestrator.js";
import { systemPrompt as orchestratorSystemPrompt } from "./orchestrator/systemPrompt.js";
import { CoderAgent } from "./workers/coder/coderAgent.js";
import { PlannerAgent } from "./workers/planner/PlannerAgent.js";

//type ToolFunction = (argument: string) => Promise<string> | string;

interface LoopResult {
    response: string;
    usage: LLMUsage;
}

export class OpenKodeAgent {
    constructor(private readonly llm: LLMProvider, private readonly telemetry: TelemetryInterface) { }

    // async run(agentRequest: AgentRequest): Promise<AgentResponse> {

    //     const llmrequest: LLMRequest = { prompt: agentRequest.prompt };

    //     //agentrequest => llmrequest transformation
    //     const response = await this.llm.generate(llmrequest);

    //     //llmresponse => agentresponse transformation
    //     const agentresponse: AgentResponse = { response: response.response };

    //     return agentresponse;
    // }

    /**
 * Runs the agent until it produces a final answer or reaches its limit.
 *
 * @param prompt - The user's request.
 * @param onChunk - Called whenever Ollama streams new text.
 * @returns The final response and token usage.
 */
    async run(prompt: AgentRequest, onChunk: (text: string) => void): Promise<LoopResult> {
        return this.telemetry.withRun("openKode-run",()=> this.loop(prompt)) ;
    }

    // private async loop(prompt: AgentRequest, onChunk: (text: string) => void): Promise<LoopResult> {
    //     let maxIterations = 10;
    //     const tools: Record<string, ToolFunction> = {
    //         CodeReview: async (argument: string) => {
    //             return CodeReviewer();
    //         },
    //     };

    //     let nextPrompt = prompt.prompt;
    //     let lastUsage: LLMUsage | undefined;

    //     for (let iteration = 0; iteration < maxIterations; iteration++) {
    //         let fullResponse = "";

    //         const result = await this.stream(
    //             { prompt: nextPrompt },
    //             (chunk: string) => {
    //                 fullResponse += chunk;
    //                 onChunk(chunk);
    //             },
    //         );

    //         lastUsage = result.usage;

    //         if (
    //             fullResponse.includes("PAUSE") &&
    //             fullResponse.includes("Action")
    //         ) {
    //             const actionMatch = fullResponse.match(
    //                 /Action:\s*([a-z_]+):\s*(.+)/i,
    //             );

    //             if (!actionMatch) {
    //                 nextPrompt = "Observation: Invalid action format";
    //                 continue;
    //             }

    //             const chosenTool = actionMatch[1];
    //             const rawArgument = actionMatch[2];

    //             if (!chosenTool || !rawArgument) {
    //                 nextPrompt = "Observation: Missing tool name or argument";
    //                 continue;
    //             }

    //             const argument = rawArgument.trim();

    //             console.log({
    //                 chosenTool,
    //                 argument,
    //             });

    //             const tool = tools[chosenTool];

    //             if (tool) {
    //                 try {
    //                     const toolResult = await tool(argument);
    //                     nextPrompt = `Observation: ${toolResult}`;
    //                 } catch (error) {
    //                     const message =
    //                         error instanceof Error
    //                             ? error.message
    //                             : String(error);

    //                     nextPrompt = `Observation: Tool failed: ${message}`;
    //                 }
    //             } else {
    //                 nextPrompt = `Observation: Tool "${chosenTool}" not found`;
    //             }

    //             console.log(nextPrompt);
    //             continue;
    //         }

    //         if (fullResponse.includes("Answer")) {
    //             if (!lastUsage) {
    //                 throw new Error("LLM usage was not returned");
    //             }

    //             return {
    //                 response: fullResponse,
    //                 usage: lastUsage,
    //             };
    //         }

    //         nextPrompt =
    //             "Observation: Respond using either an Action or a final Answer.";
    //     }

    //     if (!lastUsage) {
    //         throw new Error("The agent did not complete any LLM request");
    //     }

    //     return {
    //         response: "Maximum number of iterations reached.",
    //         usage: lastUsage,
    //     };
    // }

    private async loop(prompt: AgentRequest): Promise<LoopResult> {
        const maxSteps = 12;
        const workerResults: Array<{ worker: "planner" | "coder"; result: PlannerResponse | CoderResponse }> = [];
        const orchestrator = createOrchestrator(this.llm);

        console.log(`[OpenKode][orchestration] Started: ${prompt.prompt}`);

        for (let step = 1; step <= maxSteps; step++) {
            console.log(`[OpenKode][orchestration] Step ${step}/${maxSteps}: requesting a decision.`);
            const messages: Message[] = [
                { role: "system", content: orchestratorSystemPrompt },
                {
                    role: "user",
                    content: JSON.stringify({ request: prompt.prompt, workerResults }),
                },
            ];

            let orchestratorResp: OrchestratorResponse;
            try {
                orchestratorResp = await this.telemetry.withSpan("agent_step",SpanType.ORCHESTRATOR_RUN,()=> orchestrator.run({ messages }));
            } catch (error) {
                console.error(`[OpenKode][orchestration] Orchestrator failed at step ${step}.`, error);
                throw error;
            }

            console.dir(orchestratorResp, { depth: null });

            if (orchestratorResp.type === "final") {
                console.log(`[OpenKode][orchestration] Finished at step ${step}.`);
                return { response: orchestratorResp.answer, usage: emptyUsage() };
            }

            console.log(`[OpenKode][orchestration] Delegating to ${orchestratorResp.agent}.`);
            try {
                if (orchestratorResp.agent === "planner") {
                    const planner = new PlannerAgent(this.llm);
                    const result = await this.telemetry.withSpan("agent_step",SpanType.PLANNER_RUN, () => planner.run(orchestratorResp)) ;
                    workerResults.push({ worker: "planner", result });
                    console.log(`[OpenKode][planner] Completed with result type "${result.type}".`);
                    console.dir(result, { depth: null });
                } else {
                    const coder = new CoderAgent(this.llm);
                    const result = await this.telemetry.withSpan("agent_step",SpanType.CODER_RUN,()=> coder.run(orchestratorResp));
                    workerResults.push({ worker: "coder", result });
                    console.log(`[OpenKode][coder] Completed with result type "${result.type}".`);
                    console.dir(result, { depth: null });
                }
            } catch (error) {
                console.error(`[OpenKode][orchestration] ${orchestratorResp.agent} failed at step ${step}.`, error);
                throw error;
            }
        }

        throw new Error(`Orchestration stopped after ${maxSteps} steps without a final response.`);


        // return {
        //     response: "Maximum number of iterations reached.",
        //     usage: "lastUsage",
        // };
    }

    async scan(pwd: string) {
        return RepoScanner(pwd);
    }

    async shutdown(){
        try {
            await this.telemetry.shutdown();
        } catch (error) {
            console.error("[OpenKode][telemetry] Shutdown failed", error);
        }
    }
}

function emptyUsage(): LLMUsage {
    return {
        inputTokens: 0,
        outputTokens: 0,
        totalDurationNs: 0,
        promptEvalDurationNs: 0,
        evalDurationNs: 0,
    };
}
