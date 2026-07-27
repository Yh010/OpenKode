import type { LLMProvider } from "../llm/interface/LLMProvider.js";
import type { LLMRequest } from "../llm/interface/LLMRequest.js";
import type { LLMUsage } from "../llm/interface/LLMUsage.js";
import { systemPrompt } from "../llm/prompts/systemPrompt.js";
import { CodeReviewer } from "../tools/codereview/CodeReviewer.js";
import { RepoScanner } from "../tools/reposcan/Reposcanner.js";
import type { AgentRequest } from "./interface/AgentRequest.js";
import type { AgentResponse } from "./interface/AgentResponse.js";
import type { Message } from "./interface/Message.js";

type ToolFunction = (argument: string) => Promise<string> | string;

interface LoopResult {
    response: string;
    usage: LLMUsage;
}

export class OpenKodeAgent {
    private readonly messages: Message[] = [
        {
            role: "system",
            content: systemPrompt
        }
    ];
    constructor(private readonly llm: LLMProvider) { }

    // async run(agentRequest: AgentRequest): Promise<AgentResponse> {

    //     const llmrequest: LLMRequest = { prompt: agentRequest.prompt };

    //     //agentrequest => llmrequest transformation
    //     const response = await this.llm.generate(llmrequest);

    //     //llmresponse => agentresponse transformation
    //     const agentresponse: AgentResponse = { response: response.response };

    //     return agentresponse;
    // }

    // packages/core/src/agent/OpenKodeAgent.ts
    private async stream(prompt: AgentRequest, onChunk: (text: string) => void): Promise<{ usage: LLMUsage }> {

        const userQuery: string = prompt.prompt;

        this.messages.push({ role: "user", content: userQuery });
        let fullResponse = "";


        const response = await this.llm.stream({ messages: this.messages }, (chunk: string) => {
            fullResponse += chunk;
            onChunk(chunk);
        });

        this.messages.push({ role: "assistant", content: fullResponse });
        return response;
    }


    async run(prompt: AgentRequest, onChunk: (text: string) => void): Promise<LoopResult> {
        return this.loop(prompt, onChunk);
    }

    private async loop(prompt: AgentRequest, onChunk: (text: string) => void): Promise<LoopResult> {
        let maxIterations = 10;
        const tools: Record<string, ToolFunction> = {
            CodeReview: async (argument: string) => {
                return CodeReviewer();
            },
        };

        let nextPrompt = prompt.prompt;
        let lastUsage: LLMUsage | undefined;

        for (let iteration = 0; iteration < maxIterations; iteration++) {
            let fullResponse = "";

            const result = await this.stream(
                { prompt: nextPrompt },
                (chunk: string) => {
                    fullResponse += chunk;
                    onChunk(chunk);
                },
            );

            lastUsage = result.usage;

            if (
                fullResponse.includes("PAUSE") &&
                fullResponse.includes("Action")
            ) {
                const actionMatch = fullResponse.match(
                    /Action:\s*([a-z_]+):\s*(.+)/i,
                );

                if (!actionMatch) {
                    nextPrompt = "Observation: Invalid action format";
                    continue;
                }

                const chosenTool = actionMatch[1];
                const rawArgument = actionMatch[2];

                if (!chosenTool || !rawArgument) {
                    nextPrompt = "Observation: Missing tool name or argument";
                    continue;
                }

                const argument = rawArgument.trim();

                console.log({
                    chosenTool,
                    argument,
                });

                const tool = tools[chosenTool];

                if (tool) {
                    try {
                        const toolResult = await tool(argument);
                        nextPrompt = `Observation: ${toolResult}`;
                    } catch (error) {
                        const message =
                            error instanceof Error
                                ? error.message
                                : String(error);

                        nextPrompt = `Observation: Tool failed: ${message}`;
                    }
                } else {
                    nextPrompt = `Observation: Tool "${chosenTool}" not found`;
                }

                console.log(nextPrompt);
                continue;
            }

            if (fullResponse.includes("Answer")) {
                if (!lastUsage) {
                    throw new Error("LLM usage was not returned");
                }

                return {
                    response: fullResponse,
                    usage: lastUsage,
                };
            }

            nextPrompt =
                "Observation: Respond using either an Action or a final Answer.";
        }

        if (!lastUsage) {
            throw new Error("The agent did not complete any LLM request");
        }

        return {
            response: "Maximum number of iterations reached.",
            usage: lastUsage,
        };
    }

    async scan(pwd: string) {
        return RepoScanner(pwd);
    }
}
