// cli client
import { createOpenKodeAgent } from '@openkode/core';
import { Command } from 'commander';

export function RepoScan(program: Command) {
    program
        .command('scan')
        .description('Scan the codebase')
        .action(async () => {
            const openkode = createOpenKodeAgent();
            const currWorkDir = process.cwd() ;

            console.log("\n🤖 OpenKode:");
            console.log("scanning the codebase");

            const result = await openkode.scan(currWorkDir) ;

            console.log(result.terminal);

            /*
            console.dir(result,{
                depth: null
            });
            */
        });
}
