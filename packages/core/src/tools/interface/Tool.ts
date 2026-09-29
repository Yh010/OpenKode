export type ToolErrorCode =
    | "INVALID_INPUT"
    | "INVALID_PATH"
    | "NOT_FOUND"
    | "NOT_A_FILE"
    | "PERMISSION_DENIED"
    | "READ_FAILED"
    | "WRITE_FAILED"
    | "TEXT_NOT_FOUND"
    | "TEXT_NOT_UNIQUE"
    | "EDIT_FAILED"
    | "NO_MATCHES"
    | "GLOB_FAILED"
    | "INVALID_PATTERN"
    | "UNAPPROVED_FILE"
    | "INVALID_COMMAND"
    | "MANIFEST_NOT_FOUND"
    | "INVALID_MANIFEST"
    | "SCRIPT_NOT_FOUND"
    | "UNSUPPORTED_PROJECT"
    | "UNSUPPORTED_PACKAGE_MANAGER"
    | "AMBIGUOUS_PACKAGE_MANAGER"
    | "COMMAND_FAILED"
    | "COMMAND_TIMED_OUT";

export type ToolResult =
    | { ok: true; output: string }
    | { ok: false; code: ToolErrorCode; message: string };

export interface Tool{
    name: string;
    description: string;
    execute: (input: string) => Promise<ToolResult>;
}
