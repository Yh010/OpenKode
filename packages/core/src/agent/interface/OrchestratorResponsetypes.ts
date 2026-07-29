export interface Delegate{
    type: "delegate",
    agent:"planner"|"coder",
    task: string,
    feedback?: string
}


interface Final{
    type:"final",
    answer: string
}


export type OrchestratorResponse = Delegate | Final ;
