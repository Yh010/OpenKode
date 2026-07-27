import type { AgentRequest } from "./AgentRequest.js";
import type { AgentResponse } from "./AgentResponse.js";

export interface Message {
    role: "system" | "user" | "assistant",
    content: string
}