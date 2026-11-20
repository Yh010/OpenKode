#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from 'commander';
import { loadCommands } from './commands/index.js';
//import { loadCommands } from './commands/llmcall.js';

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const program = new Command();
program
    .name('openkode')
    .description('Open source coding agent for your terminal')
    .version(version);
loadCommands(program);
await program.parseAsync();
