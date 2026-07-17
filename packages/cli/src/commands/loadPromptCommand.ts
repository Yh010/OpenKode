// cli client

import { createOpenKodeAgent } from '@openkode/core';
import { Command } from 'commander';

export function loadPromptCommand(program: Command) {
    program
        .argument("[prompt...]", "task for the agent")
        .action(async (prompt: string[]) => {
            if (!prompt || prompt.length === 0) {
                program.help();
                return;
            }

            const openkode = createOpenKodeAgent();
            // const response = await openkode.run({
            //     prompt: prompt.join(" ")
            // })
            // console.log("\n🤖 OpenKode:\n");
            // console.log(response.response);
            console.log("\n🤖 OpenKode is thinking....\n");
            console.log("\n🤖 OpenKode says:\n");
            
            const result = await openkode.stream(prompt.join(" "), (chunk) => {
                process.stdout.write(chunk);
            });

            console.log(`\nInput tokens: ${result.usage.inputTokens}`);
            console.log(`Output tokens: ${result.usage.outputTokens}`);

        });
}