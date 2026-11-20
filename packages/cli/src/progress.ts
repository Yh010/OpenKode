import * as p from "@clack/prompts";
import type { AgentProgress } from "@openkode/core";

type ProgressView = { start(message: string): void; stop(message: string): void; log(message: string): void };

export function createProgressDisplay(view?: ProgressView) {
    if (!view) {
        if (process.stdout.isTTY) {
            const spinner = p.spinner();
            view = { start: message => spinner.start(message), stop: message => spinner.stop(message), log: message => p.log.message(message) };
        } else {
            let previous: string | undefined;
            const write = (message: string) => {
                if (message !== previous) process.stderr.write(`[OpenKode] ${message}\n`);
                previous = message;
            };
            view = { start: write, stop: write, log: write };
        }
    }
    const output = view;
    let active = false;
    let activity = "";
    return {
        update(event: AgentProgress) {
            if (event.kind === "status") {
                if (active) output.stop(activity);
                output.start(event.message);
                active = true;
                activity = event.message;
            } else {
                if (active) output.stop(event.message); else output.log(event.message);
                active = false;
                if (event.detail) output.log(event.detail);
            }
        },
        finish(message: string) {
            if (active) output.stop(message);
            active = false;
        },
    };
}
