// cli client
import { streamAIResponse } from '@openkode/core';
import { Command } from 'commander';
//import { askAI } from "@openkode/core";

export function loadPromptCommand(program: Command) {
    program
        .argument("[prompt...]", "task for the agent")
        .action(async (prompt: string[]) => {
            if (!prompt || prompt.length === 0) {
                program.help();
                return;
            }

            //const response = await askAI(prompt.join(" "));

            console.log("\n🤖 OpenKode:");
            await streamAIResponse(
                prompt.join(" "),
                (chunk) => {
                    process.stdout.write(chunk);
                }
            );


            console.log("\n");
            //console.log(response);
        });
}