import type { GraphEdge, RepoDependencyGraph } from "./types.js";

type GraphData = Omit<RepoDependencyGraph, "mermaid" | "terminal">;

export function toMermaidFlowchart(graph: GraphData): string {
	const nodeIds = new Map(graph.nodes.map((node, index) => [node.path, `n${index}`]));
	const entryPaths = new Set(graph.entryPoints.map((entryPoint) => entryPoint.path));
	const lines = ["flowchart LR"];

	for (const node of graph.nodes) {
		lines.push(`  ${nodeIds.get(node.path)!}[\"${node.path.replaceAll('"', "'")}\"]`);
	}
	for (const edge of graph.edges) {
		lines.push(`  ${nodeIds.get(edge.from)!} -->|${edge.kind}| ${nodeIds.get(edge.to)!}`);
	}
	if (entryPaths.size > 0) {
		lines.push("  classDef entry fill:#dbeafe,stroke:#2563eb,stroke-width:2px");
		lines.push(`  class ${[...entryPaths].map((entryPath) => nodeIds.get(entryPath)!).join(",")} entry`);
	}

	return lines.join("\n");
}

export function toTerminalGraph(graph: GraphData, options: { includeTypeOnly?: boolean } = {}): string {
	const includeTypeOnly = options.includeTypeOnly ?? false;
	const edgesBySource = new Map<string, GraphEdge[]>();
	for (const edge of graph.edges) {
		if (!includeTypeOnly && edge.kind === "type-only") continue;
		const edges = edgesBySource.get(edge.from) ?? [];
		edges.push(edge);
		edgesBySource.set(edge.from, edges);
	}
	for (const edges of edgesBySource.values()) {
		edges.sort((a, b) => a.kind.localeCompare(b.kind) || a.to.localeCompare(b.to));
	}

	const lines = ["Repository dependency flow"];
	for (const entryPoint of graph.entryPoints) {
		lines.push("", `● ENTRY  ${entryPoint.path}`);
		renderTerminalChildren(entryPoint.path, "", new Set([entryPoint.path]), new Set([entryPoint.path]), edgesBySource, lines);
	}
	if (!includeTypeOnly && graph.edges.some((edge) => edge.kind === "type-only")) {
		lines.push("", "  Type-only dependencies are hidden. Pass { includeTypeOnly: true } to show them.");
	}
	if (graph.orphanModules.length > 0) {
		lines.push("", "○ ORPHAN MODULES (no local importers)");
		for (const orphan of graph.orphanModules) lines.push(`  ○ ${orphan}`);
	}
	if (graph.cycles.length > 0) {
		lines.push("", "↻ CYCLES");
		for (const cycle of graph.cycles) lines.push(`  ↻ ${cycle.join(" → ")}`);
	}

	return lines.join("\n");
}

function renderTerminalChildren(
	path: string,
	prefix: string,
	ancestors: Set<string>,
	expanded: Set<string>,
	edgesBySource: Map<string, GraphEdge[]>,
	lines: string[],
): void {
	const edges = edgesBySource.get(path) ?? [];
	for (const [index, edge] of edges.entries()) {
		const isLast = index === edges.length - 1;
		const childPrefix = `${prefix}${isLast ? "   " : "│  "}`;
		const isCycle = ancestors.has(edge.to);
		const isShared = expanded.has(edge.to);
		lines.push(`${prefix}${isLast ? "└─" : "├─"} ${edge.kind} → ${edge.to}${isCycle ? "  ↩ cycle" : isShared ? "  ↗ shared" : ""}`);
		if (!isCycle && !isShared) {
			const nextAncestors = new Set(ancestors);
			nextAncestors.add(edge.to);
			expanded.add(edge.to);
			renderTerminalChildren(edge.to, childPrefix, nextAncestors, expanded, edgesBySource, lines);
		}
	}
}
