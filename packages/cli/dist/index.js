#!/usr/bin/env node
import { Command } from 'commander';
import { loadCommands } from './commands/llmcall.js';
const program = new Command();
program
    .name('openkode-cli-tool')
    .description('A powerful CLI tool built with TypeScript')
    .version('1.0.0');
loadCommands(program);
program.parse(process.argv);
//# sourceMappingURL=index.js.map