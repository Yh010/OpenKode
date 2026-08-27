export interface PlanStep{
    id: string,
    description: string,
    files: string[],
    acceptanceCriteria: string[]
}

export interface Plan {
  type: "plan",
  summary: string,
  steps: PlanStep[],
  verification: string[],
  risks: string[]
}


//TODO:
// repositoryFacts: RepositoryFacts;
// previousPlan?: Plan;
export interface PlannerNeedContext{
    type: "needs_context",
    questions: string[]
}

export interface PlannerReadToolCall {
    type: "tool_call",
    toolName: "ReadFileTool",
    fileToRead: string
}

export interface PlannerGlobToolCall {
    type: "tool_call",
    toolName: "GlobTool",
    pattern: string
}

export interface PlannerGrepToolCall {
    type: "tool_call",
    toolName: "GrepTool",
    pattern: string,
    paths: string[]
}

export interface PlannerResearchResult {
    type: "research_result",
    answer: string,
    sources: string[]
}

export interface PlannerInvalidResponse {
    type: "invalid_response",
    message: string
}

export type PlannerResponse = Plan | PlannerNeedContext | PlannerReadToolCall | PlannerGlobToolCall | PlannerGrepToolCall | PlannerResearchResult | PlannerInvalidResponse;
