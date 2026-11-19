import * as p from "@clack/prompts";
import { ChatStore, createOpenKodeAgent, type Chat } from "@openkode/core";
import { AuthenticatedSession, configureAuthNetwork } from "./auth/AuthenticatedSession.js";
import { loadModelConfiguration } from "./model/ModelConfigurationStore.js";

const HELP = [
    "/new [title]    Start a new chat",
    "/chats          Switch to another chat in this project",
    "/history        Show every message in the current chat",
    "/rename <title> Rename the current chat",
    "/help           Show commands",
    "/exit           Exit OpenKode",
].join("\n");

export async function runInteractiveChat(): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error("Interactive mode requires a terminal. Use openkode \"your prompt\" for one-shot mode.");
        process.exitCode = 1;
        return;
    }

    const restoreNetwork = configureAuthNetwork();
    try {
        await runSignedInChat(await AuthenticatedSession.open());
    } catch (error) {
        console.error(`[OpenKode] ${error instanceof Error ? error.message : "Could not start the coding session."}`);
        process.exitCode = 1;
    } finally { restoreNetwork(); }
}

async function runSignedInChat(identity: AuthenticatedSession): Promise<void> {
    const store = await ChatStore.open(process.cwd(), undefined, identity.accountScope);
    let chat: Chat | undefined;
    let draftTitle = "New chat";
    const modelConfiguration = await loadModelConfiguration();
    const agent = createOpenKodeAgent({ accessToken: () => identity.token(), modelConfiguration });
    p.intro("OpenKode");
    p.log.info(`Model: ${modelConfiguration.provider} / ${modelConfiguration.model}`);
    p.log.info("New chat draft — it will be saved after your first message.");
    p.log.message("Type /help for chat commands.");

    try {
        while (true) {
            const input = await p.text({ message: `${chat?.title ?? draftTitle} ›`, placeholder: "Ask OpenKode to work on this project" });
            if (p.isCancel(input)) break;
            const prompt = input.trim();
            if (!prompt) continue;

            const commandResult = await handleCommand(prompt, store, chat);
            if (commandResult.type === "exit") break;
            if (commandResult.type === "chat") {
                chat = commandResult.chat;
                draftTitle = chat.title;
                continue;
            }
            if (commandResult.type === "draft") {
                chat = undefined;
                draftTitle = commandResult.title;
                continue;
            }
            if (commandResult.type === "handled") continue;

            if (!chat) chat = await store.create(draftTitle);
            await identity.chat(chat.id);
            const history = chat.turns;
            chat = await store.append(chat.id, "user", prompt);
            const spinner = p.spinner();
            spinner.start("OpenKode is thinking");
            try {
                const result = await agent.run({ prompt, chatId: chat.id, history, ownership: {
                    userId: identity.user.id, installationId: identity.installationId, sessionId: identity.sessionId,
                } }, () => {});
                spinner.stop("OpenKode replied");
                chat = await store.append(chat.id, "assistant", result.response);
                p.note(result.response, "OpenKode");
            } catch (error) {
                spinner.stop("OpenKode could not complete the request");
                p.log.error(error instanceof Error ? error.message : String(error));
            }
        }
    } finally {
        await agent.shutdown();
        p.outro("Goodbye.");
    }
}

type CommandResult =
    | { type: "not-command" }
    | { type: "handled" }
    | { type: "chat"; chat: Chat }
    | { type: "draft"; title: string }
    | { type: "exit" };

async function handleCommand(input: string, store: ChatStore, chat: Chat | undefined): Promise<CommandResult> {
    if (!input.startsWith("/")) return { type: "not-command" };
    const [command, ...arguments_] = input.slice(1).trim().split(/\s+/);
    const argument = arguments_.join(" ").trim();

    if (command === "exit") return { type: "exit" };
    if (command === "help") {
        p.note(HELP, "Commands");
        return { type: "handled" };
    }
    if (command === "new") {
        const title = argument || "New chat";
        p.log.success(`New chat draft: ${title}`);
        return { type: "draft", title };
    }
    if (command === "rename") {
        if (!argument) {
            p.log.warn("Usage: /rename <title>");
            return { type: "handled" };
        }
        if (!chat) {
            p.log.success(`Renamed draft to ${argument}`);
            return { type: "draft", title: argument };
        }
        const renamed = await store.rename(chat.id, argument);
        p.log.success(`Renamed chat to ${renamed.title}`);
        return { type: "chat", chat: renamed };
    }
    if (command === "history") {
        if (!chat || chat.turns.length === 0) {
            p.log.info("This chat has no saved messages yet.");
            return { type: "handled" };
        }
        p.note(formatHistory(chat), `${chat.title} · ${chat.turns.length} messages`);
        return { type: "handled" };
    }
    if (command === "chats") {
        const chats = await store.list();
        if (chats.length === 0) {
            p.log.info("No saved chats for this project.");
            return { type: "handled" };
        }
        const choice = await p.select({
            message: "Switch chat",
            options: chats.map((candidate) => ({
                value: candidate.id,
                label: candidate.title,
                hint: `${shortId(candidate.id)} · ${candidate.turns.length} turns`,
            })),
            ...(chat ? { initialValue: chat.id } : {}),
        });
        if (p.isCancel(choice)) return { type: "handled" };
        const nextChat = chats.find((candidate) => candidate.id === choice);
        if (!nextChat) return { type: "handled" };
        p.log.success(`Switched to ${nextChat.title}`);
        return { type: "chat", chat: nextChat };
    }

    p.log.warn(`Unknown command: /${command}. Type /help for commands.`);
    return { type: "handled" };
}

function shortId(id: string): string {
    return id.slice(0, 8);
}

function formatHistory(chat: Chat): string {
    return chat.turns.map((turn) => `${turn.role === "user" ? "You" : "OpenKode"}:\n${turn.content}`).join("\n\n");
}
