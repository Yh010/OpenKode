import { AsyncLocalStorage } from "node:async_hooks";
type Decision = Record<string, any>;
type Context = { output: ((text: string) => void) | undefined; role?: string; accept?: (decision: Decision) => boolean };
const current = new AsyncLocalStorage<Context>();

export function withAnswerOutput<T>(output: Context["output"], operation: () => Promise<T>): Promise<T> {
    return current.run({ output }, operation);
}
export function withDecisionOutput<T>(role: string, accept: (decision: Decision) => boolean, operation: () => Promise<T>): Promise<T> {
    return current.run({ output: current.getStore()?.output, role, accept }, operation);
}
export function decisionStream(role: string, wrapped: boolean): DecisionStream | undefined {
    const context = current.getStore();
    return context?.output && context.role === role && context.accept ? new DecisionStream(wrapped, context.accept, context.output) : undefined;
}

/** Extract only an allowed answer string; never print tool JSON or model reasoning. */
export class DecisionStream {
    private buffer = "";
    private emitted = "";
    constructor(private readonly wrapped: boolean, private readonly accept: (decision: Decision) => boolean, private readonly output: (text: string) => void) {}
    append(chunk: string): void {
        this.buffer += chunk;
        const partial = partialObject(this.buffer);
        const decision = this.wrapped ? partial?.value?.result : partial?.value;
        if (partial?.answerOpen && decision && this.accept(decision) && typeof decision.answer === "string") this.publish(decision.answer);
    }
    finish(decision: unknown): void {
        const value = decision as Decision;
        if (this.accept(value) && typeof value.answer === "string") this.publish(value.answer);
        else if (this.emitted) throw new Error("The streamed answer changed. Please retry the request.");
    }
    private publish(answer: string): void {
        // Hold a split UTF-16 surrogate until its matching low surrogate arrives.
        if (/[\uD800-\uDBFF]$/.test(answer)) answer = answer.slice(0, -1);
        if (!answer.startsWith(this.emitted)) throw new Error("The streamed answer changed. Please retry the request.");
        const added = answer.slice(this.emitted.length);
        if (added) { this.output(added); this.emitted = answer; }
    }
}

function partialObject(text: string): { value: Decision; answerOpen: boolean } | undefined {
    const stack: string[] = [];
    let quoted = false; let escaped = false; let lastEscape = -1;
    let quoteStart = -1;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (quoted) {
            if (escaped) { escaped = false; continue; }
            if (char === "\\") { escaped = true; lastEscape = index; }
            else if (char === '"') quoted = false;
        } else if (char === '"') { quoted = true; quoteStart = index; }
        else if (char === "{") stack.push("}");
        else if (char === "[") stack.push("]");
        else if (char === "}" || char === "]") {
            if (stack.pop() !== char) return;
        }
    }
    let prefix = text;
    if (quoted) {
        if (escaped || (lastEscape >= 0 && /^\\u[0-9a-f]{0,3}$/i.test(text.slice(lastEscape)))) prefix = text.slice(0, lastEscape);
        prefix += '"';
    }
    try { return { value: JSON.parse(prefix + stack.reverse().join("")), answerOpen: quoted && /"answer"\s*:\s*$/.test(text.slice(0, quoteStart)) }; } catch { return; }
}
