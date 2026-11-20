import type { ChatTurn } from "../../chat/ChatStore.js";
import type { TelemetryOwnership } from "../../telemetry/TelemetryInterface.js";

export interface AgentRequest {
    prompt: string;
    stream?: boolean;
    chatId?: string;
    history?: ChatTurn[];
    ownership?: TelemetryOwnership;
}
