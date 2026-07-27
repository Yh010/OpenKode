import type { Message } from "../../agent/interface/Message.js";

export interface LLMRequest {
    messages: Message[];
}