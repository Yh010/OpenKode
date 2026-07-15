#!/usr/bin/env node
import { Command } from 'commander';
import { loadCommands } from './commands/index.js';
//import { loadCommands } from './commands/llmcall.js';
const program = new Command();
program
    .name('openkode')
    .description('Powerful CLI Coding agent')
    .version('1.0.0');
loadCommands(program);
program.parse();