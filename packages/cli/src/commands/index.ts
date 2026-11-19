// cli client
import { Command } from 'commander';
import { loadPromptCommand } from './loadPromptCommand.js';
import { GreetUser } from './GreetUser.js';
import { RepoScan } from './RepoScan.js';
import { loadAuthCommands } from './auth.js';

export function loadCommands(program: Command) {
    loadAuthCommands(program);
    loadPromptCommand(program);
    GreetUser(program);
    RepoScan(program)
}
