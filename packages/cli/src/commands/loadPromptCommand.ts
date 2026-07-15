// cli client
import { Command } from 'commander';
import { askAI } from "@openkode/core";

export function loadPromptCommand(program: Command) {
    program
        .argument("[prompt...]", "task for the agent")
        .action(async (prompt: string[]) => {
            if (!prompt || prompt.length === 0) {
                program.help();
                return;
            }

            const response = await askAI(prompt.join(" "));

            console.log("\n🤖 OpenKode:");
            console.log(response);
        });
}