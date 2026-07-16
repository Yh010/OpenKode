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
            //const response = await askAI(prompt.join(" "));
            //prompt : AgentRequest
            //await agent.run(prompt)
            // await streamAIResponse(
            //     prompt.join(" "),
            //     (chunk) => {
            //         process.stdout.write(chunk);
            //     }
            // );
            const openkode = createOpenKodeAgent();
            const response = await openkode.run({
                prompt: prompt.join(" ")
            })


            console.log("\n🤖 OpenKode:\n");

            console.log(response.response);

        });
}