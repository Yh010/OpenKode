import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type CommandResult = { code: number | null; output: string };
type Command = (args: string[], input?: string) => Promise<CommandResult>;
const PREFIX = "mac-keychain-v1:";

async function security(args: string[], input?: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "pipe"] });
        let output = "";
        const timer = setTimeout(() => child.kill(), 30_000);
        child.stdout.on("data", chunk => { output += chunk.toString(); });
        child.stderr.resume();
        child.stdin.on("error", () => {});
        child.once("error", () => { clearTimeout(timer); reject(new Error("macOS Keychain is unavailable.")); });
        child.once("close", code => { clearTimeout(timer); resolve({ code, output }); });
        child.stdin.end(input);
    });
}

/** Encrypt local credentials with a random AES key held in the login Keychain. */
export class MacKeychainProtection {
    private key: Promise<Buffer> | undefined;
    constructor(private readonly command: Command = security, private readonly service = "org.openkode.credentials.v1") {
        if (!/^[a-zA-Z0-9.-]+$/.test(service)) throw new Error("Invalid Keychain service.");
    }
    async protect(value: string, decrypt = false): Promise<string> {
        try {
            const key = await (this.key ??= this.loadKey(!decrypt).catch(error => { this.key = undefined; throw error; }));
            if (decrypt) {
                if (!value.startsWith(PREFIX)) throw new Error();
                const sealed = Buffer.from(value.slice(PREFIX.length), "base64");
                if (sealed.length < 28) throw new Error();
                const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
                decipher.setAuthTag(sealed.subarray(12, 28));
                return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString("utf8");
            }
            const iv = randomBytes(12);
            const cipher = createCipheriv("aes-256-gcm", key, iv);
            const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
            return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
        } catch { throw new Error("Could not access saved credentials. Unlock your macOS login Keychain and retry."); }
    }
    private async loadKey(create: boolean): Promise<Buffer> {
        const args = ["find-generic-password", "-a", "OpenKode", "-s", this.service, "-w"];
        let found = await this.command(args);
        if (found.code === 44 && create) {
            // Interactive mode consumes the command over stdin. No secret appears
            // in process arguments, shell history, or an intermediate file.
            const key = randomBytes(32).toString("base64");
            await this.command(["-i"], `add-generic-password -a OpenKode -s ${this.service} -w ${key}\n`);
            // Read back the winner if another process created the item first.
            // Deliberately omit -U: never replace a key protecting existing files.
            found = await this.command(args);
        }
        const encoded = found.output.trim();
        if (found.code !== 0 || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error();
        return Buffer.from(encoded, "base64");
    }
}
