// cli client
import { Command } from 'commander';
import { loadPromptCommand } from './loadPromptCommand.js';
import { GreetUser } from './GreetUser.js';

export function loadCommands(program: Command) {
    loadPromptCommand(program);
    GreetUser(program);
}