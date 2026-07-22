import * as fs from "node:fs";
import * as path from "node:path";

import {
	buildAdjacency,
	buildReverseAdjacency,
	deduplicateEdges,
	reachable,
	stronglyConnectedComponents,
	weaklyConnectedComponents,
} from "./analysis.js";
import { toMermaidFlowchart, toTerminalGraph } from "./render.js";
import {
	discoverSourceFiles,
	entryFileStems,
	extractDependencies,
	findFilesNamed,
	findWorkspacePackages,
	isWorkspaceSpecifier,
	packageNameFromSpecifier,
	resolveDependency,
	resolveSourceFile,
} from "./source.js";
import type { GraphEdge, RepoDependencyGraph } from "./types.js";

export function createRepoDependencyGraph(repoPath: string): RepoDependencyGraph {
	const root = fs.realpathSync(repoPath);
	const files = discoverSourceFiles(root);
	const fileSet = new Set(files);
	const workspacePackages = findWorkspacePackages(root);
	const edges: GraphEdge[] = [];
	const externalDependencyCounts = new Map<string, number>();
	const unresolvedLocalDependencies: Array<{ from: string; specifier: string }> = [];

	for (const file of files) {
		const source = fs.readFileSync(file, "utf8");
		for (const dependency of extractDependencies(source)) {
			const resolved = resolveDependency(dependency.specifier, file, root, workspacePackages);
			if (resolved && fileSet.has(resolved)) {
				edges.push({ from: file, to: resolved, kind: dependency.kind });
			} else if (dependency.specifier.startsWith(".") || path.isAbsolute(dependency.specifier)) {
				unresolvedLocalDependencies.push({ from: relative(root, file), specifier: dependency.specifier });
			} else if (isWorkspaceSpecifier(dependency.specifier, workspacePackages)) {
				unresolvedLocalDependencies.push({ from: relative(root, file), specifier: dependency.specifier });
			} else {
				const packageName = packageNameFromSpecifier(dependency.specifier);
				externalDependencyCounts.set(packageName, (externalDependencyCounts.get(packageName) ?? 0) + 1);
			}
		}
	}

	const uniqueEdges = deduplicateEdges(edges);
	const adjacency = buildAdjacency(files, uniqueEdges);
	const reverseAdjacency = buildReverseAdjacency(files, uniqueEdges);
	const entryReasons = findEntryPoints(root, files);
	const graph = {
		root,
		nodes: files
			.map((file) => ({
				path: relative(root, file),
				inDegree: reverseAdjacency.get(file)!.size,
				outDegree: adjacency.get(file)!.size,
				isEntryPoint: entryReasons.has(file),
				entryReasons: entryReasons.get(file) ?? [],
			}))
			.sort((a, b) => a.path.localeCompare(b.path)),
		edges: uniqueEdges
			.map((edge) => ({ from: relative(root, edge.from), to: relative(root, edge.to), kind: edge.kind }))
			.sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)),
		entryPoints: [...entryReasons.entries()]
			.map(([file, reasons]) => ({ path: relative(root, file), reasons }))
			.sort((a, b) => a.path.localeCompare(b.path)),
		highDegreeModules: files
			.map((file) => ({
				path: relative(root, file),
				inDegree: reverseAdjacency.get(file)!.size,
				outDegree: adjacency.get(file)!.size,
				isEntryPoint: entryReasons.has(file),
				entryReasons: entryReasons.get(file) ?? [],
			}))
			.sort((a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree) || a.path.localeCompare(b.path))
			.slice(0, 20),
		disconnectedComponents: weaklyConnectedComponents(files, adjacency, reverseAdjacency)
			.map((component) => component.map((file) => relative(root, file)).sort())
			.sort((a, b) => b.length - a.length || (a[0] ?? "").localeCompare(b[0] ?? "")),
		cycles: stronglyConnectedComponents(files, adjacency)
			.filter((component) => component.length > 1 || (component[0] !== undefined && adjacency.get(component[0])!.has(component[0])))
			.map((component) => component.map((file) => relative(root, file)).sort())
			.sort((a, b) => b.length - a.length || (a[0] ?? "").localeCompare(b[0] ?? "")),
		reachableFromEntryPoint: Object.fromEntries(
			[...entryReasons.keys()].map((entry) => [
				relative(root, entry),
				[...reachable(entry, adjacency)].map((file) => relative(root, file)).sort(),
			]),
		),
		externalDependencies: [...externalDependencyCounts.entries()]
			.map(([name, occurrences]) => ({ name, occurrences }))
			.sort((a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name)),
		orphanModules: files
			.filter((file) => reverseAdjacency.get(file)!.size === 0 && !entryReasons.has(file) && !isLikelyTestFile(file))
			.map((file) => relative(root, file))
			.sort(),
		unresolvedLocalDependencies: unresolvedLocalDependencies.sort(
			(a, b) => a.from.localeCompare(b.from) || a.specifier.localeCompare(b.specifier),
		),
	};

	return { ...graph, mermaid: toMermaidFlowchart(graph), terminal: toTerminalGraph(graph) };
}

function findEntryPoints(root: string, files: string[]): Map<string, string[]> {
	const reasons = new Map<string, string[]>();
	const add = (file: string | undefined, reason: string): void => {
		if (!file || !files.includes(file)) return;
		const existing = reasons.get(file) ?? [];
		if (!existing.includes(reason)) existing.push(reason);
		reasons.set(file, existing);
	};

	for (const packageJson of findFilesNamed(root, "package.json")) {
		const packageRoot = path.dirname(packageJson);
		try {
			const manifest = JSON.parse(fs.readFileSync(packageJson, "utf8")) as Record<string, unknown>;
			for (const value of packageEntrypointValues(manifest)) {
				add(resolvePackageEntrypoint(value, packageRoot), `declared in ${relative(root, packageJson)}`);
			}
		} catch {
			// A broken package manifest should not prevent graph generation.
		}
		for (const stem of entryFileStems) {
			add(resolveSourceFile(path.join(packageRoot, "src", stem)), "conventional package source entry");
		}
	}

	return reasons;
}

function packageEntrypointValues(manifest: Record<string, unknown>): string[] {
	const values: string[] = [];
	for (const key of ["main", "module", "types", "typings"]) {
		if (typeof manifest[key] === "string") values.push(manifest[key]);
	}
	if (typeof manifest.bin === "string") values.push(manifest.bin);
	if (manifest.bin && typeof manifest.bin === "object") {
		values.push(...Object.values(manifest.bin as Record<string, unknown>).filter(isString));
	}
	collectExportStrings(manifest.exports, values);
	return [...new Set(values)];
}

function collectExportStrings(value: unknown, output: string[]): void {
	if (typeof value === "string") output.push(value);
	else if (Array.isArray(value)) value.forEach((item) => collectExportStrings(item, output));
	else if (value && typeof value === "object") {
		Object.values(value as Record<string, unknown>).forEach((item) => collectExportStrings(item, output));
	}
}

function resolvePackageEntrypoint(entry: string, packageRoot: string): string | undefined {
	if (!entry.startsWith(".")) return undefined;
	const candidate = path.resolve(packageRoot, entry);
	if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
	return resolveSourceFile(path.join(packageRoot, "src", "index"));
}

function isLikelyTestFile(file: string): boolean {
	return /(^|[\\/])(?:test|tests|__tests__|fixtures)([\\/]|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function relative(root: string, file: string): string {
	return path.relative(root, file).replaceAll(path.sep, "/");
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}
