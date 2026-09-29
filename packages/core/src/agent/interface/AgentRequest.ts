import type { ChatTurn } from "../../chat/ChatStore.js";

export interface AgentRequest {
    prompt: string;
    chatId?: string;
    history?: ChatTurn[];
}
