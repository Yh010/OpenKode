#!/usr/bin/env node
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from 'commander';
import { loadCommands } from './commands/index.js';
//import { loadCommands } from './commands/llmcall.js';

const cliDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(cliDirectory, "../../../.env") });

const program = new Command();
program
    .name('openkode')
    .description('Powerful CLI Coding agent')
    .version('1.0.0');
loadCommands(program);
program.parse();
