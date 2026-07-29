interface Step{
    id: string,
    description: string,
    files: string[],
    acceptanceCriteria: string[]
}

export interface Plan {
  type: "plan",
  summary: string,
  steps: Step[],
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


export type PlannerResponse = Plan | PlannerNeedContext;
