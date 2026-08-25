export interface EditToolCall {
  "type": "tool_call",
  "toolName": "EditFileTool",
  "path": string,
  "oldText": string,
  "newText": string
}

export interface WriteToolCall {
  "type": "tool_call",
  "toolName": "WriteFileTool",
  "path": string,
  "content": string
}

export type CoderToolCall = EditToolCall | WriteToolCall;

export interface CoderCompleted {
  "type": "completed",
  "summary": string,
  "verification": string[],
  "risks": string[]
}

//TODO:
// planStep: PlanStep;
//   files: SourceFile[];
//   previousProposal?: ProposedChange;
//   feedback?: string;
export interface CoderNeedContext{
  "type": "needs_context",
  "questions": string[]
}

export interface CoderInvalidResponse {
  "type": "invalid_response",
  "message": string
}

export type CoderResponse = CoderToolCall | CoderCompleted | CoderNeedContext | CoderInvalidResponse ;
