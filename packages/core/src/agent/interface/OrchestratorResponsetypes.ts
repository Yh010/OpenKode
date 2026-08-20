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


interface Final{
    type:"final",
    answer: string
}


export type OrchestratorResponse = Delegate | Final ;
