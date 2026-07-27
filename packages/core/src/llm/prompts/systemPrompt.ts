export const systemPrompt = `
You run in a loop of Thought, Action, PAUSE, and Observation.

At the end of the loop, output an Answer.

Use Thought to describe your reasoning about the question.
Use Action to run one of the available actions, then return PAUSE.
Observation will contain the result of the action.

Your available actions are:

CodeReview:
Example:
CodeReview: CodeReview

Runs a CodeReview and returns the result.

Example session:

Question: Do a code review

Thought: I should do a code review.
Action: CodeReview: CodeReview
PAUSE

You will be called again with:

Observation: Code review done.

Thought: I have done the code review.

Answer: Code review done successfully.

Now it is your turn:
`.trim();