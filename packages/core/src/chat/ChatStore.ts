import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ChatTurn {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
}

export interface Chat {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    turns: ChatTurn[];
}

interface ChatFile {
    version: 1;
    projectRoot: string;
    chats: Chat[];
}

export class ChatStore {
    private readonly filePath: string;
    private readonly projectRoot: string;

    private constructor(projectRoot: string, storageHome: string) {
        this.projectRoot = projectRoot;
        const projectHash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
        this.filePath = path.join(storageHome, "chats", `${projectHash}.json`);
    }

    static async open(projectRoot: string, storageHome = process.env.OPENKODE_HOME ?? path.join(os.homedir(), ".openkode")): Promise<ChatStore> {
        let canonicalRoot: string;
        try {
            canonicalRoot = await realpath(projectRoot);
        } catch {
            canonicalRoot = path.resolve(projectRoot);
        }
        return new ChatStore(canonicalRoot, storageHome);
    }

    async list(): Promise<Chat[]> {
        return [...(await this.load()).chats].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    async create(title = "New chat"): Promise<Chat> {
        const file = await this.load();
        const now = new Date().toISOString();
        const chat: Chat = { id: randomUUID(), title, createdAt: now, updatedAt: now, turns: [] };
        file.chats.push(chat);
        await this.save(file);
        return chat;
    }

    async rename(chatId: string, title: string): Promise<Chat> {
        const file = await this.load();
        const chat = requiredChat(file, chatId);
        chat.title = requiredTitle(title);
        chat.updatedAt = new Date().toISOString();
        await this.save(file);
        return chat;
    }

    async append(chatId: string, role: ChatTurn["role"], content: string): Promise<Chat> {
        const file = await this.load();
        const chat = requiredChat(file, chatId);
        const now = new Date().toISOString();
        chat.turns.push({ id: randomUUID(), role, content, createdAt: now });
        if (role === "user" && chat.turns.length === 1 && chat.title === "New chat") chat.title = titleFrom(content);
        chat.updatedAt = now;
        await this.save(file);
        return chat;
    }

    private async load(): Promise<ChatFile> {
        try {
            const value: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
            if (isChatFile(value, this.projectRoot)) return value;
        } catch {
            // Missing or malformed local data starts a fresh project store.
        }
        return { version: 1, projectRoot: this.projectRoot, chats: [] };
    }

    private async save(file: ChatFile): Promise<void> {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
        await writeFile(temporaryPath, JSON.stringify(file, null, 2), "utf8");
        await rename(temporaryPath, this.filePath);
    }
}

function requiredChat(file: ChatFile, chatId: string): Chat {
    const chat = file.chats.find((candidate) => candidate.id === chatId);
    if (!chat) throw new Error(`Chat "${chatId}" does not belong to this project.`);
    return chat;
}

function requiredTitle(title: string): string {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Chat titles cannot be empty.");
    return trimmed.slice(0, 80);
}

function titleFrom(content: string): string {
    return content.trim().replace(/\s+/g, " ").slice(0, 80) || "New chat";
}

function isChatFile(value: unknown, projectRoot: string): value is ChatFile {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return candidate.version === 1 && candidate.projectRoot === projectRoot && Array.isArray(candidate.chats);
}
