import * as fs from "node:fs";
import * as path from "node:path";

import type { EdgeKind, WorkspacePackage } from "./types.js";

export const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

const skippedDirectories = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"coverage",
	".next",
	".turbo",
	".cache",
]);

const entryFileBasenames = [
	"main.ts",
	"main.tsx",
	"main.js",
	"main.mjs",
	"index.ts",
	"index.tsx",
	"index.js",
	"index.mjs",
	"server.ts",
	"server.js",
	"cli.ts",
	"cli.js",
];

export const entryFileStems = ["main", "index", "server", "cli"];

export function discoverSourceFiles(root: string): string[] {
	const files: string[] = [];

	function walk(directory: string): void {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;

			const fullPath = path.join(directory, entry.name);
			if (entry.isDirectory()) walk(fullPath);
			else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) files.push(fullPath);
		}
	}

	walk(root);
	return files.sort();
}

export function extractDependencies(source: string): Array<{ specifier: string; kind: EdgeKind }> {
	const dependencies: Array<{ specifier: string; kind: EdgeKind }> = [];

	for (const match of source.matchAll(/\bimport\s+(type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) {
		dependencies.push({ specifier: match[2]!, kind: match[1] ? "type-only" : "static" });
	}
	for (const match of source.matchAll(/\bexport\s+(type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) {
		dependencies.push({ specifier: match[2]!, kind: match[1] ? "type-only" : "static" });
	}
	for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
		dependencies.push({ specifier: match[1]!, kind: "dynamic" });
	}
	for (const match of source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) {
		dependencies.push({ specifier: match[1]!, kind: "require" });
	}
	return dependencies;
}

export function resolveDependency(
	specifier: string,
	importingFile: string,
	repoRoot: string,
	workspacePackages: WorkspacePackage[],
): string | undefined {
	if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
		return resolveSourceFile(path.resolve(path.dirname(importingFile), specifier));
	}

	const workspacePackage = [...workspacePackages]
		.sort((a, b) => b.name.length - a.name.length)
		.find((candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`));
	if (!workspacePackage) return undefined;

	const subpath = specifier.slice(workspacePackage.name.length).replace(/^\//, "");
	const candidate = subpath
		? path.join(workspacePackage.root, "src", subpath)
		: path.join(workspacePackage.root, "src", "index");
	const resolved = resolveSourceFile(candidate);
	return resolved?.startsWith(`${repoRoot}${path.sep}`) ? resolved : undefined;
}

export function resolveSourceFile(candidate: string): string | undefined {
	const extensionlessCandidate = [".js", ".jsx", ".mjs", ".cjs"].includes(path.extname(candidate))
		? candidate.slice(0, -path.extname(candidate).length)
		: candidate;
	const candidates = [
		candidate,
		...sourceExtensions.values().map((extension) => `${extensionlessCandidate}${extension}`),
		...entryFileBasenames.map((name) => path.join(candidate, name)),
	];

	for (const file of candidates) {
		if (fs.existsSync(file) && fs.statSync(file).isFile()) return fs.realpathSync(file);
	}

	return undefined;
}

export function findFilesNamed(root: string, name: string): string[] {
	const results: string[] = [];

	function walk(directory: string): void {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;

			const fullPath = path.join(directory, entry.name);
			if (entry.isDirectory()) walk(fullPath);
			else if (entry.isFile() && entry.name === name) results.push(fullPath);
		}
	}

	walk(root);
	return results.sort();
}

export function findWorkspacePackages(root: string): WorkspacePackage[] {
	return findFilesNamed(root, "package.json").flatMap((packageJson) => {
		try {
			const manifest = JSON.parse(fs.readFileSync(packageJson, "utf8")) as { name?: unknown };
			return typeof manifest.name === "string" ? [{ name: manifest.name, root: path.dirname(packageJson) }] : [];
		} catch {
			return [];
		}
	});
}

export function isWorkspaceSpecifier(specifier: string, workspacePackages: WorkspacePackage[]): boolean {
	return workspacePackages.some((candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`));
}

export function packageNameFromSpecifier(specifier: string): string {
	return specifier.startsWith("@")
		? specifier.split("/").slice(0, 2).join("/")
		: (specifier.split("/")[0] ?? specifier);
}
