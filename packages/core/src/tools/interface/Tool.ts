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
    | "UNAPPROVED_FILE";

export type ToolResult =
    | { ok: true; output: string }
    | { ok: false; code: ToolErrorCode; message: string };

export interface Tool{
    name: string;
    description: string;
    execute: (input: string) => Promise<ToolResult>;
}
