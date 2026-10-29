import path from "node:path";

/** Uses only the current request. History must never supply the file to explain. */
export function requestedFilePaths(request: string, projectRoot: string): string[] {
    return normalizeFilePaths(fileCandidates(request), projectRoot);
}

function fileCandidates(request: string): string[] {
    const candidates = [...request.matchAll(/"([^"\r\n]+)"|'([^'\r\n]+)'|`([^`\r\n]+)`|([^\s"'`<>]+)/g)]
        .map(match => (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").replace(/[),;:?!]+$/, "").replace(/\.$/, ""))
        .filter(value => /\.(?:[cm]?[jt]sx?|json|css|html|md|mdx|txt|ya?ml|toml|py|sql|sh)$/i.test(value)
            && !/^[a-z][\w+.-]*:\/\//i.test(value));
    return candidates;
}

export function directFileRequestPaths(request: string, projectRoot: string): string[] {
    const candidates = fileCandidates(request);
    const prose = candidates.reduce((text, file) => text.replaceAll(file, ""), request);
    if (!/\b(explain|understand|describe|summari[sz]e|what|show|read|contents?|contain)\b/i.test(prose)
        || /\b(change|modify|update|fix|implement|refactor|rename|replace|remove|add|create|write|delete|edit)\b/i.test(prose)
        || /\b(where\s+(?:is|are)|find|which\s+files?)\b/i.test(prose)) return [];

    return normalizeFilePaths(candidates, projectRoot);
}

function normalizeFilePaths(candidates: string[], projectRoot: string): string[] {
    return [...new Set(candidates.map(file => {
        const normalized = file.replaceAll("\\", "/");
        const resolved = path.resolve(projectRoot, normalized);
        const relative = path.relative(projectRoot, resolved);
        // Support absolute paths inside the project without weakening ReadFileTool's boundary.
        return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
            ? relative.replaceAll("\\", "/") : normalized;
    }))];
}
