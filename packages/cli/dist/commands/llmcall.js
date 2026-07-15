// cli client
import { Command } from 'commander';
import { askAI } from "@openkode/core";
export function loadCommands(program) {
    program
        .command('llmcall')
        .description('Interact with Ollama LLM API')
        .argument("<prompt>", "task for the agent")
        .action(async (prompt) => {
        const response = await askAI(prompt);
        console.log("\n🤖 OpenKode:");
        console.log(response);
    });
}
//# sourceMappingURL=llmcall.js.map