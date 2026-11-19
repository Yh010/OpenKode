// cli client

import { createOpenKodeAgent } from '@openkode/core';
import { Command } from 'commander';
import { runInteractiveChat } from "../interactiveChat.js";
import { AuthenticatedSession, configureAuthNetwork } from "../auth/AuthenticatedSession.js";

export function loadPromptCommand(program: Command) {
    program
        .argument("[prompt...]", "task for the agent")
        .action(async (prompt: string[]) => {
            if (!prompt || prompt.length === 0) {
                await runInteractiveChat();
                return;
            }

            const restoreNetwork = configureAuthNetwork();
            let openkode: ReturnType<typeof createOpenKodeAgent> | undefined;
            try {
                const identity = await AuthenticatedSession.open();
                openkode = createOpenKodeAgent({ accessToken: () => identity.token() });
                console.log("\n🤖 OpenKode is thinking....\n");
                const result = await openkode.run({prompt: prompt.join(" "), ownership: {
                    userId: identity.user.id, installationId: identity.installationId, sessionId: identity.sessionId,
                }}, (chunk) => {
                    process.stdout.write(chunk);
                });

                console.log(result.response);
                console.log(`\nInput tokens: ${result.usage.inputTokens}`);
                console.log(`Output tokens: ${result.usage.outputTokens}`);
            } catch (error) {
                console.error(`[OpenKode] ${error instanceof Error ? error.message : "Could not start the coding session."}`);
                process.exitCode = 1;
            } finally {
                await openkode?.shutdown();
                restoreNetwork();
            }
        });
}
