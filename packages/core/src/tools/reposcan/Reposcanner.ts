import { createRepoDependencyGraph } from "./dependency-graph.js";
import type { RepoDependencyGraph } from "./types.js";

/*
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

const excludedNames = new Set([
    "node_modules",
    ".git",
    "dist"
]);

const excludedExtensions = new Set([
    ".log",
    ".tmp"
]);

type FileItem = {
    name: string;
    type: "file";
    path: string;
};

type DirectoryItem = {
    name: string;
    type: "directory";
    path: string;
    children: FolderItem[];
};

export type FolderItem = FileItem | DirectoryItem;

export type FolderStructure = FolderItem[];

function shouldExclude(entry:Dirent):boolean {
    return (
        excludedNames.has(entry.name) ||
        excludedExtensions.has(path.extname(entry.name).toLowerCase())
    );
}

export async function RepoScanner(directory:string): Promise<FolderStructure> {
    const entries = await readdir(directory, {
        withFileTypes: true
    });

    const result: FolderStructure = [];

    for (const entry of entries) {
        if (shouldExclude(entry)) {
            continue;
        }

        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            result.push({
                name: entry.name,
                type: "directory",
                path: fullPath,
                children: await RepoScanner(fullPath)
            });
        } else {
            result.push({
                name: entry.name,
                type: "file",
                path: fullPath
            });
        }
    }

    return result;
}

//usage: 
// const directoryTree = await RepoScanner(
//     "C:/Yash_Personal/Projects/OpenKode/"
// );

// console.dir(directoryTree, {
//     depth: null
// });
*/

export async function RepoScanner(directory: string): Promise<RepoDependencyGraph> {
    return createRepoDependencyGraph(directory);
}
