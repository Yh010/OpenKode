export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalDurationNs: number;
  promptEvalDurationNs: number;
  evalDurationNs: number;
}