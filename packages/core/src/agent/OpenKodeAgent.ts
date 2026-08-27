import type { LLMProvider } from "../llm/interface/LLMProvider.js";
import type { LLMUsage } from "../llm/interface/LLMUsage.js";
import { SpanType } from "../telemetry/TelemetryEventInterface.js";
import type { TelemetryInterface } from "../telemetry/TelemetryInterface.js";
import { EditFileTool } from "../tools/edit/EditFileTool.js";
import { GlobTool } from "../tools/glob/GlobTool.js";
import { GrepTool } from "../tools/grep/GrepTool.js";
import { ReadFileTool } from "../tools/read/ReadFileTool.js";
import { RepoScanner } from "../tools/reposcan/Reposcanner.js";
import { WriteFileTool } from "../tools/write/WriteFileTool.js";
import type { AgentRequest } from "./interface/AgentRequest.js";
import type { AgentResponse } from "./interface/AgentResponse.js";
import type { CoderResponse } from "./interface/CoderResponsetypes.js";
import type { Message } from "./interface/Message.js";
import type { Delegate, OrchestratorResponse, WorkerContext } from "./interface/OrchestratorResponsetypes.js";
import type { Plan, PlannerResponse } from "./interface/PlannerResponsetype.js";
import { createOrchestrator } from "./orchestrator/createOrchestrator.js";
import { systemPrompt as orchestratorSystemPrompt } from "./orchestrator/systemPrompt.js";
import { CoderAgent } from "./workers/coder/coderAgent.js";
import { PlannerAgent } from "./workers/planner/PlannerAgent.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolResult } from "../tools/interface/Tool.js";
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
        const workerResults: Array<{ worker: "planner" | "coder"; result: PlannerResponse | CoderResponse }> = []; //TODO: Remove this since it's of no use
        const orchestrator = createOrchestrator(this.llm);
        let repositoryFiles: string[] | undefined;
        let approvedPlan: Plan | undefined;
        const requestedNewFiles = extractRequestedFilePaths(prompt.prompt);
        const isResearchRequest = isRepositoryResearchRequest(prompt.prompt);

        console.log(`[OpenKode][orchestration] Started: ${prompt.prompt}`);

          const messages: Message[] = [
                { role: "system", content: orchestratorSystemPrompt },
                {
                    role: "user",
                    content: JSON.stringify({ request: prompt.prompt, workerResults }),
                },
            ];

        for (let step = 1; step <= maxSteps; step++) {
            console.log(`[OpenKode][orchestration] Step ${step}/${maxSteps}: requesting a decision.`);
          
            let orchestratorResp: OrchestratorResponse;
            try {
                orchestratorResp = await this.telemetry.withSpan("agent_step",SpanType.ORCHESTRATOR_RUN,()=> orchestrator.run({ messages }));
            } catch (error) {
                console.error(`[OpenKode][orchestration] Orchestrator failed at step ${step}.`, error);
                throw error;
            }

            if (!approvedPlan && shouldForcePlanner(prompt.prompt, orchestratorResp)) {
                orchestratorResp = {
                    type: "delegate",
                    agent: "planner",
                    task: prompt.prompt,
                    feedback: "Create an implementation plan for this coding request.",
                };
            }

            console.dir(orchestratorResp, { depth: null });

            if (orchestratorResp.type === "final") {
                console.log(`[OpenKode][orchestration] Finished at step ${step}.`);
                return { response: orchestratorResp.answer, usage: emptyUsage() };
            }

            if (orchestratorResp.type === "tool_call") {
                messages.push({
                    role: "assistant",
                    content: JSON.stringify(orchestratorResp),
                });
                try{
                    const projectRoot = process.cwd();
                    const resp: ToolResult = orchestratorResp.toolName === "ReadFileTool"
                        ? await new ReadFileTool(projectRoot).execute(orchestratorResp.fileToRead)
                        : await new WriteFileTool(projectRoot).execute(JSON.stringify({
                            path: orchestratorResp.fileToWrite,
                            content: orchestratorResp.content,
                        }));
                    const toolResult = JSON.stringify(resp) ;
                    messages.push({
                        role: "user",
                        content: `Observation from ${orchestratorResp.toolName}:\n${toolResult}`,
                    });

                }catch(err){
                    console.log(`error calling ${orchestratorResp.toolName}:`) ;
                    console.log(err) ;
                }

                continue ;
            }

            console.log(`[OpenKode][orchestration] Delegating to ${orchestratorResp.agent}.`);
            try {
                if (orchestratorResp.agent === "planner" || !approvedPlan) {
                    const repoFiles = repositoryFiles ?? await this.getRepositoryFiles();
                    repositoryFiles = repoFiles;
                    const plannerTask: Delegate = {
                        type: "delegate",
                        agent: "planner",
                        task: prompt.prompt,
                        feedback: "Create a minimal implementation plan from the original request and supplied repository context.",
                    };
                    const planner = new PlannerAgent(this.llm);
                    const sourceFiles: Record<string, string> = {};
                    const discoveredFiles: string[] = [];
                    let feedback = plannerTask.feedback ?? "";
                    let plan: Plan | undefined;
                    let globCalls = 0;

                    for (let plannerStep = 1; plannerStep <= maxSteps; plannerStep++) {
                        const task = this.withWorkerContext({ ...plannerTask, feedback }, {
                            originalRequest: prompt.prompt,
                            discoveredFiles,
                            sourceFiles,
                            requestedNewFiles,
                        });
                        const result = await this.telemetry.withSpan("agent_step",SpanType.PLANNER_RUN, () => planner.run(task));
                        if (result.type === "invalid_response") {
                            feedback = `Your previous response was invalid: ${result.message}`;
                            continue;
                        }

                        if (result.type === "tool_call") {
                            if (result.toolName === "GlobTool") {
                                if (discoveredFiles.length > 0 && Object.keys(sourceFiles).length === 0) {
                                    feedback = readDiscoveredFileFeedback(prompt.prompt, discoveredFiles);
                                    continue;
                                }
                                if (globCalls === 5) {
                                    return {
                                        response: "Cannot continue: the planner exceeded the five GlobTool-call limit.",
                                        usage: emptyUsage(),
                                    };
                                }

                                globCalls++;
                                const toolResult = await new GlobTool(process.cwd()).execute(JSON.stringify({ pattern: result.pattern }));
                                if (toolResult.ok) {
                                    for (const file of globMatches(toolResult.output)) {
                                        if (!discoveredFiles.includes(file)) {
                                            discoveredFiles.push(file);
                                        }
                                    }
                                }
                                feedback = toolResult.ok
                                    ? `${readDiscoveredFileFeedback(prompt.prompt, discoveredFiles)}\nGlobTool observation:\n${JSON.stringify(toolResult)}`
                                    : `GlobTool found no matches. Try a broader pattern such as "${suggestGlobPattern(prompt.prompt)}".\nGlobTool observation:\n${JSON.stringify(toolResult)}`;
                                continue;
                            }

                            if (result.toolName === "GrepTool") {
                                const toolResult = await this.executeGrepToolCall(result, process.cwd(), discoveredFiles);
                                feedback = `GrepTool observation:\n${JSON.stringify(toolResult)}`;
                                continue;
                            }

                            const toolResult = await this.readPlannerFile(result.fileToRead, discoveredFiles);
                            if (toolResult.ok) {
                                sourceFiles[result.fileToRead] = toolResult.output;
                            }
                            feedback = `ReadFileTool observation:\n${JSON.stringify(toolResult)}`;
                            continue;
                        }

                        if (result.type === "needs_context") {
                            if (isResearchRequest) {
                                if (Object.keys(sourceFiles).length > 0) {
                                    feedback = "You already have repository evidence in context.sourceFiles. Return research_result with an answer and source paths; do not return needs_context.";
                                    continue;
                                }
                                feedback = discoveredFiles.length > 0
                                    ? readDiscoveredFileFeedback(prompt.prompt, discoveredFiles)
                                    : "This is a repository research request. Use GlobTool to discover candidate paths before requesting more context or answering.";
                                continue;
                            }
                            if (Object.keys(sourceFiles).length > 0) {
                                console.warn("[OpenKode][planner] Using a fallback plan because the planner requested context already supplied by the user or source files.");
                                plan = createFallbackPlan(prompt.prompt, Object.keys(sourceFiles));
                                break;
                            }
                            return { response: formatQuestions(result.questions), usage: emptyUsage() };
                        }

                        if (result.type === "research_result") {
                            const hasEvidence = result.sources.length > 0
                                && result.sources.every((source) => Object.hasOwn(sourceFiles, source));
                            if (!hasEvidence) {
                                feedback = discoveredFiles.length > 0
                                    ? `A research_result requires a source whose contents are in context.sourceFiles. ${readDiscoveredFileFeedback(prompt.prompt, discoveredFiles)}`
                                    : "A research_result requires at least one source path whose contents are present in context.sourceFiles. Use GlobTool and ReadFileTool before answering.";
                                continue;
                            }
                            return { response: result.answer, usage: emptyUsage() };
                        }

                        if (isResearchRequest) {
                            feedback = "This is a repository research request. Do not return a plan; use GlobTool and ReadFileTool, then return research_result.";
                            continue;
                        }

                        plan = result;
                        break;
                    }

                    if (!plan) {
                        return {
                            response: `Cannot continue: the planner did not produce a plan after ${maxSteps} attempts.`,
                            usage: emptyUsage(),
                        };
                    }

                    const invalidPaths = plan.steps.flatMap((step) => step.files)
                        .filter((file) => !discoveredFiles.includes(file) && !requestedNewFiles.includes(file));
                    if (invalidPaths.length > 0) {
                        return {
                            response: `Cannot continue: the plan references files not discovered by GlobTool: ${[...new Set(invalidPaths)].join(", ")}.`,
                            usage: emptyUsage(),
                        };
                    }

                    approvedPlan = plan;
                    workerResults.push({ worker: "planner", result: plan });
                    messages.push({
                        role: "user",
                        content: `Planner result:\n${JSON.stringify(plan)}`,
                    });
                    console.log(`[OpenKode][planner] Completed with result type "${plan.type}".`);
                    console.dir(plan, { depth: null });

                    const codingFailure = await this.executeApprovedPlan(
                        plan,
                        prompt.prompt,
                        repoFiles,
                        discoveredFiles,
                        requestedNewFiles,
                        workerResults,
                        messages,
                        maxSteps,
                    );
                    if (codingFailure) {
                        return codingFailure;
                    }

                    return {
                        response: `Completed: ${plan.summary}`,
                        usage: emptyUsage(),
                    };
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

    private async executeApprovedPlan(
        plan: Plan,
        originalRequest: string,
        repositoryFiles: string[],
        discoveredFiles: string[],
        requestedNewFiles: string[],
        workerResults: Array<{ worker: "planner" | "coder"; result: PlannerResponse | CoderResponse }>,
        messages: Message[],
        maxSteps: number,
    ): Promise<LoopResult | undefined> {
        const coder = new CoderAgent(this.llm);

        for (const planStep of plan.steps) {
            const approvedFiles = [...new Set(planStep.files)];
            const sourceFiles = await this.readApprovedFiles(approvedFiles.filter((file) => repositoryFiles.includes(file)));
            const coderTask: Delegate = {
                type: "delegate",
                agent: "coder",
                task: planStep.description,
                feedback: `Acceptance criteria:\n${planStep.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`,
            };
            let feedback = coderTask.feedback ?? "";
            let completed = false;
            let executedToolCalls = 0;
            let successfulToolCalls = 0;
            const successfulEdits: Array<{ path: string; newText: string }> = [];

            for (let coderStep = 1; coderStep <= maxSteps; coderStep++) {
                const task = this.withWorkerContext({ ...coderTask, feedback }, {
                    originalRequest,
                    discoveredFiles,
                    approvedFiles,
                    sourceFiles,
                    requestedNewFiles,
                });
                const result = await this.telemetry.withSpan("agent_step", SpanType.CODER_RUN, () => coder.run(task));
                if (result.type === "invalid_response") {
                    feedback = `Your previous response was invalid: ${result.message}`;
                    continue;
                }

                if (result.type === "needs_context") {
                    if (executedToolCalls > 0) {
                        feedback = "You already have context.sourceFiles and the last tool observation. Do not return needs_context after a tool call. If the tool failed, inspect sourceFiles and return a corrected tool_call; if the task is already correct, return completed.";
                        continue;
                    }
                    if (hasAllApprovedSourceFiles(approvedFiles, repositoryFiles, sourceFiles)) {
                        feedback = "All existing approved file contents are already in context.sourceFiles. Use them to perform the approved plan step; do not return needs_context.";
                        continue;
                    }
                    if (requestsSuppliedSourceFile(result.questions, sourceFiles)) {
                        feedback = "The file contents you requested are already available in context.sourceFiles. Use those contents to continue the approved plan step; do not request them again.";
                        continue;
                    }
                    return { response: formatQuestions(result.questions), usage: emptyUsage() };
                }

                if (result.type === "completed") {
                    if (successfulToolCalls === 0) {
                        feedback = "You cannot return completed yet because no file change has succeeded for this implementation step. Inspect context.sourceFiles and return one exact EditFileTool or WriteFileTool call.";
                        continue;
                    }
                    workerResults.push({ worker: "coder", result });
                    messages.push({
                        role: "user",
                        content: `Coder result:\n${JSON.stringify(result)}`,
                    });
                    console.log(`[OpenKode][coder] Verified completion after ${successfulToolCalls} successful tool call(s).`);
                    completed = true;
                    break;
                }

                if (
                    result.toolName === "EditFileTool" &&
                    successfulEdits.some((edit) => edit.path === result.path && edit.newText === result.oldText)
                ) {
                    feedback = "Do not replace the entire result of a successful edit with another whole-file edit. If the acceptance criteria are met, return completed. If a separate criterion remains unmet, edit only the distinct current text required for that criterion.";
                    continue;
                }

                const toolResult = result.toolName === "GrepTool"
                    ? await this.executeGrepToolCall(result, process.cwd(), discoveredFiles)
                    : await this.executeCoderToolCall(result, process.cwd(), approvedFiles, requestedNewFiles);
                executedToolCalls++;
                if (toolResult.ok && result.toolName !== "GrepTool") {
                    sourceFiles[result.path] = await readFile(path.join(process.cwd(), result.path), "utf8");
                    successfulToolCalls++;
                    if (result.toolName === "EditFileTool") {
                        successfulEdits.push({ path: result.path, newText: result.newText });
                    }
                }
                if (result.toolName === "GrepTool") {
                    feedback = toolResult.ok
                        ? `GrepTool returned matching lines. Use them only to locate or verify code for the approved plan step, then return an EditFileTool or WriteFileTool call when a change is still required.\nTool observation:\n${JSON.stringify(toolResult)}`
                        : `The preceding GrepTool call failed. Correct its pattern or paths using context.discoveredFiles.\nTool observation:\n${JSON.stringify(toolResult)}`;
                    continue;
                }

                feedback = toolResult.ok
                    ? `The preceding ${result.toolName} call succeeded. Compare the refreshed sourceFiles only with the approved plan step and its acceptance criteria. Do not make cleanup, refinement, or reversal edits. If every criterion is met, return completed. Make another tool call only for a criterion that is still visibly unmet.\nTool observation:\n${JSON.stringify(toolResult)}`
                    : `The preceding ${result.toolName} call failed. Inspect the refreshed sourceFiles and return a corrected tool_call.\nTool observation:\n${JSON.stringify(toolResult)}`;
            }

            if (!completed) {
                return {
                    response: `Cannot continue: the coder did not verify completion after ${maxSteps} tool calls.`,
                    usage: emptyUsage(),
                };
            }
        }
    }

    async scan(pwd: string) {
        return RepoScanner(pwd);
    }

    private async getRepositoryFiles(): Promise<string[]> {
        const root = process.cwd();
        const graph = await RepoScanner(root);
        return graph.nodes.map((node) => toRepositoryPath(root, node.path));
    }

    private async readApprovedFiles(files: string[]): Promise<Record<string, string>> {
        const root = process.cwd();
        const entries = await Promise.all(files.map(async (file) => [
            file,
            await readFile(path.join(root, file), "utf8"),
        ] as const));
        return Object.fromEntries(entries);
    }

    private async readPlannerFile(file: string, discoveredFiles: string[]): Promise<ToolResult> {
        if (!discoveredFiles.includes(file)) {
            return {
                ok: false,
                code: "UNAPPROVED_FILE",
                message: `Planner may only read a file returned by GlobTool: "${file}".`,
            };
        }

        return new ReadFileTool(process.cwd()).execute(file);
    }

    private withWorkerContext(task: Delegate, context: WorkerContext): Delegate {
        return { ...task, context };
    }

    private async executeCoderToolCall(
        toolCall: Exclude<Extract<CoderResponse, { type: "tool_call" }>, { toolName: "GrepTool" }>,
        projectRoot: string,
        approvedFiles: string[],
        requestedNewFiles: string[],
    ): Promise<ToolResult> {
        if (!approvedFiles.includes(toolCall.path)) {
            return {
                ok: false,
                code: "UNAPPROVED_FILE",
                message: `"${toolCall.path}" is not approved for this coding step.`,
            };
        }

        if (toolCall.toolName === "EditFileTool") {
            return new EditFileTool(projectRoot).execute(JSON.stringify({
                path: toolCall.path,
                oldText: toolCall.oldText,
                newText: toolCall.newText,
            }));
        }

        if (!requestedNewFiles.includes(toolCall.path)) {
            return {
                ok: false,
                code: "UNAPPROVED_FILE",
                message: `WriteFileTool may only create an approved new file: "${toolCall.path}".`,
            };
        }

        return new WriteFileTool(projectRoot).execute(JSON.stringify({
            path: toolCall.path,
            content: toolCall.content,
        }));
    }

    private async executeGrepToolCall(
        toolCall: { pattern: string; paths: string[] },
        projectRoot: string,
        discoveredFiles: string[],
    ): Promise<ToolResult> {
        const unapprovedPaths = toolCall.paths.filter((file) => !discoveredFiles.includes(file));
        if (unapprovedPaths.length > 0) {
            return {
                ok: false,
                code: "UNAPPROVED_FILE",
                message: `GrepTool may only search paths returned by GlobTool: ${[...new Set(unapprovedPaths)].join(", ")}.`,
            };
        }

        return new GrepTool(projectRoot).execute(JSON.stringify({
            pattern: toolCall.pattern,
            paths: toolCall.paths,
        }));
    }

    async shutdown(){
        try {
            await this.telemetry.shutdown();
        } catch (error) {
            console.error("[OpenKode][telemetry] Shutdown failed", error);
        }
    }
}

function toRepositoryPath(root: string, file: string): string {
    return path.relative(root, file).replaceAll("\\", "/");
}

function requestsSuppliedSourceFile(questions: string[], sourceFiles: Record<string, string>): boolean {
    return questions.some((question) => Object.hasOwn(sourceFiles, question.match(/[^\s`]+\.[^\s`]+/)?.[0] ?? ""));
}

function shouldForcePlanner(request: string, response: OrchestratorResponse): boolean {
    if (response.type === "delegate" || response.type === "tool_call" && response.toolName === "WriteFileTool") {
        return false;
    }

    if (response.type === "tool_call" && response.toolName === "ReadFileTool") {
        return !isDirectFileContentRequest(request);
    }

    return isRepositoryResearchRequest(request)
        || /\b(change|modify|update|fix|implement|refactor|rename|replace|remove|add)\b/i.test(request);
}

function isRepositoryResearchRequest(request: string): boolean {
    return /\b(where\s+(?:is|are)|find|which\s+files?|how\s+is|what\s+does)\b/i.test(request)
        && /\b(implemented|implementation|file|code|class|function|agent|config|repository|project|defined|used|located|todo)\b/i.test(request);
}

function globMatches(output: string): string[] {
    try {
        const value: unknown = JSON.parse(output);
        if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value) &&
            "matches" in value &&
            Array.isArray(value.matches) &&
            value.matches.every((match) => typeof match === "string")
        ) {
            return value.matches;
        }
    } catch {
        return [];
    }

    return [];
}

function readDiscoveredFileFeedback(request: string, discoveredFiles: string[]): string {
    const suggestedFile = mostRelevantDiscoveredFile(request, discoveredFiles);
    return suggestedFile
        ? `GlobTool already returned candidate paths. Your next response must be ReadFileTool for "${suggestedFile}" before another GlobTool call, needs_context, or research_result.`
        : "GlobTool already returned candidate paths. Your next response must be one ReadFileTool call for a path in context.discoveredFiles before another GlobTool call, needs_context, or research_result.";
}

function mostRelevantDiscoveredFile(request: string, discoveredFiles: string[]): string | undefined {
    const terms = request.toLowerCase().match(/[a-z0-9]+/g)
        ?.filter((term) => term.length > 2 && !RESEARCH_STOP_WORDS.has(term))
        ?? [];
    return discoveredFiles
        .map((file) => ({
            file,
            score: terms.reduce((score, term) => score + (file.toLowerCase().includes(term) ? 1 : 0), 0),
        }))
        .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file))[0]?.file;
}

const RESEARCH_STOP_WORDS = new Set([
    "where", "what", "which", "does", "that", "this", "with", "from", "into", "implemented", "implementation",
]);

function suggestGlobPattern(request: string): string {
    const terms = request.toLowerCase().match(/[a-z0-9]+/g)
        ?.filter((term) => term.length > 2 && !RESEARCH_STOP_WORDS.has(term))
        .slice(0, 3)
        ?? [];
    return terms.length > 0
        ? `**/*${terms.join("*")}*.{ts,tsx,js,jsx,json}`
        : "**/*";
}

function isDirectFileContentRequest(request: string): boolean {
    return /\b(what|show|read|contents?|contain)\b/i.test(request);
}

function hasAllApprovedSourceFiles(
    approvedFiles: string[],
    repositoryFiles: string[],
    sourceFiles: Record<string, string>,
): boolean {
    const existingApprovedFiles = approvedFiles.filter((file) => repositoryFiles.includes(file));
    return existingApprovedFiles.length > 0 && existingApprovedFiles.every((file) => Object.hasOwn(sourceFiles, file));
}

function createFallbackPlan(originalRequest: string, files: string[]): Plan {
    return {
        type: "plan",
        summary: "Apply the requested change",
        steps: [{
            id: "step-1",
            description: originalRequest,
            files,
            acceptanceCriteria: [originalRequest],
        }],
        verification: [],
        risks: ["The planner could not produce a detailed plan after receiving the required context."],
    };
}

function formatQuestions(questions: string[]): string {
    return `I need more context before continuing:\n${questions.map((question) => `- ${question}`).join("\n")}`;
}

function extractRequestedFilePaths(request: string): string[] {
    return [...new Set(
        [...request.matchAll(/\b[\w.-]+\.(?:[cm]?[jt]sx?|json|css|html|md)\b/gi)]
            .map((match) => match[0]),
    )];
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

