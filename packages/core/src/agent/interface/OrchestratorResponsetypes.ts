export interface WorkerContext {
    originalRequest: string;
    repositoryFiles: string[];
    requestedNewFiles?: string[];
    approvedFiles?: string[];
    sourceFiles?: Record<string, string>;
}

export interface Delegate{
    type: "delegate",
    agent:"planner"|"coder",
    task: string,
    feedback?: string,
    context?: WorkerContext,
}

export interface ReadToolCall {
    type: "tool_call",
    toolName: "ReadFileTool",
    fileToRead: string
}

export interface WriteToolCall {
    type: "tool_call",
    toolName: "WriteFileTool",
    fileToWrite: string,
    content: string,
}

export type ToolCall = ReadToolCall | WriteToolCall;

interface Final{
    type:"final",
    answer: string
}


export type OrchestratorResponse = Delegate | Final | ToolCall;
