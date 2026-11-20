// cli client

import { createOpenKodeAgent } from '@openkode/core';
import { Command } from 'commander';
import { runInteractiveChat } from "../interactiveChat.js";
import { AuthenticatedSession, configureAuthNetwork } from "../auth/AuthenticatedSession.js";
import { loadModelConfiguration } from "../model/ModelConfigurationStore.js";
import { createProgressDisplay } from "../progress.js";
import { createAnswerOutput } from "../answerOutput.js";

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
            const progress = createProgressDisplay();
            const answer = createAnswerOutput(() => progress.finish("OpenKode is replying"), response => console.log(response));
            try {
                const identity = await AuthenticatedSession.open();
                openkode = createOpenKodeAgent({ accessToken: () => identity.token(), modelConfiguration: await loadModelConfiguration() });
                const result = await openkode.run({prompt: prompt.join(" "), stream: true, ownership: {
                    userId: identity.user.id, installationId: identity.installationId, sessionId: identity.sessionId,
                }}, answer.chunk, progress.update);
                progress.finish("OpenKode replied");

                answer.finish(result.response);
                console.log(`\nInput tokens: ${result.usage.inputTokens}`);
                console.log(`Output tokens: ${result.usage.outputTokens}`);
            } catch (error) {
                answer.interrupt();
                progress.finish("OpenKode could not complete the request");
                console.error(`[OpenKode] ${error instanceof Error ? error.message : "Could not start the coding session."}`);
                process.exitCode = 1;
            } finally {
                await openkode?.shutdown();
                restoreNetwork();
            }
        });
}
