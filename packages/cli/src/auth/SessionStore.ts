import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MacKeychainProtection } from "./MacKeychainProtection.js";
const macCredentials = new MacKeychainProtection();

// Refresh tokens and model keys are encrypted for the current OS account.
// Secrets travel over stdin/stdout, never PowerShell arguments or logs.
export async function protectToken(value: string, decrypt = false): Promise<string> {
    if (process.platform === "darwin") return macCredentials.protect(value, decrypt);
    if (process.platform !== "win32") throw new Error("Secure credential storage supports Windows and macOS.");
    const script = "$ErrorActionPreference='Stop'; [void][Reflection.Assembly]::LoadWithPartialName('System.Security'); $v=[Console]::In.ReadToEnd(); " + (decrypt
        ? "$b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))"
        : "$b=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($b))");
    return new Promise((resolve, reject) => {
        const child = spawn(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        let output = "";
        const timeout = setTimeout(() => child.kill(), 10_000);
        child.stdout.on("data", chunk => { output += chunk.toString(); });
        child.stderr.resume();
        child.stdin.on("error", () => {});
        child.once("error", () => { clearTimeout(timeout); reject(new Error("Windows credential protection is unavailable.")); });
        child.once("close", code => {
            clearTimeout(timeout);
            if (code === 0 && output) resolve(output);
            else reject(new Error("Could not protect or unlock the saved session. Run openkode login again."));
        });
        child.stdin.end(value);
    });
}

export class SessionStore {
    readonly directory: string;
    readonly file: string;
    constructor(projectUrl: string, home = process.env.OPENKODE_HOME ?? path.join(os.homedir(), ".openkode")) {
        this.directory = path.join(home, "auth");
        this.file = path.join(this.directory, `${createHash("sha256").update(projectUrl).digest("hex").slice(0, 24)}.json`);
    }
    async read(): Promise<string | undefined> {
        let raw: string;
        try { raw = await readFile(this.file, "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
        const record = JSON.parse(raw);
        if (record.version !== 1 || typeof record.encryptedRefreshToken !== "string") throw new Error("Invalid saved session. Run openkode logout --local, then login.");
        return protectToken(record.encryptedRefreshToken, true);
    }
    async save(token: string): Promise<void> {
        const encryptedRefreshToken = await protectToken(token);
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, JSON.stringify({ version: 1, encryptedRefreshToken }), { mode: 0o600, flag: "wx" });
            await rename(temporary, this.file);
        } finally { await rm(temporary, { force: true }); }
    }
    async clear(): Promise<void> { await rm(this.file, { force: true }); }

    async exclusive<T>(operation: () => Promise<T>): Promise<T> {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const lock = `${this.file}.lock`;
        try { await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 }); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            throw new Error(`Another authentication command is running. If it crashed, remove ${lock} after confirming it has stopped.`);
        }
        try { return await operation(); } finally { await rm(lock, { force: true }); }
    }
}
