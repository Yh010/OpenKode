// cli client
import { Command } from 'commander';

export function GreetUser(program: Command) {
    program
        .command('greet')
        .description('Greet User')
        .action(async () => {
            console.log("\n🤖 OpenKode:");
            console.log("Hi User how is your day?");

        });
}