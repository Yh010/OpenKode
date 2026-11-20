import { stripVTControlCharacters } from "node:util";

export function createAnswerOutput(stopProgress: () => void, showWhole: (text: string) => void, write: (text: string) => void = text => { process.stdout.write(text); }) {
    let received = "";
    let started = false;
    const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
    return {
        chunk(text: string) {
            if (!text) return;
            if (!started) { stopProgress(); write("\nOpenKode:\n\n"); started = true; }
            received += text;
            write(clean(text));
        },
        finish(response: string) {
            if (!started) showWhole(response);
            else if (response.startsWith(received)) write(clean(response.slice(received.length)) + "\n");
            else { write("\n[Answer revised]\n"); showWhole(response); }
        },
        interrupt() { if (started) write("\n[Response incomplete]\n"); },
    };
}
