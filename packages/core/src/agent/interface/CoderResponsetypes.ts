interface Change{
    "path": string,
    "reason": string,
    "unifiedDiff": string
}

export interface Proposal{
  "type": "proposed_change",
  "summary": string,
  "changes": Change[],
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

export type CoderResponse = Proposal | CoderNeedContext ;
