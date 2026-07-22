import type { GraphEdge } from "./types.js";

export function deduplicateEdges(edges: GraphEdge[]): GraphEdge[] {
	const seen = new Set<string>();

	return edges.filter((edge) => {
		const key = `${edge.from}\0${edge.to}\0${edge.kind}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function buildAdjacency(files: string[], edges: GraphEdge[]): Map<string, Set<string>> {
	const adjacency = new Map(files.map((file) => [file, new Set<string>()]));
	for (const edge of edges) adjacency.get(edge.from)!.add(edge.to);
	return adjacency;
}

export function buildReverseAdjacency(files: string[], edges: GraphEdge[]): Map<string, Set<string>> {
	const reverse = new Map(files.map((file) => [file, new Set<string>()]));
	for (const edge of edges) reverse.get(edge.to)!.add(edge.from);
	return reverse;
}

export function reachable(start: string, adjacency: Map<string, Set<string>>): Set<string> {
	const visited = new Set<string>();
	const queue = [start];

	while (queue.length > 0) {
		const current = queue.shift()!;
		if (visited.has(current)) continue;
		visited.add(current);
		queue.push(...adjacency.get(current)!);
	}

	return visited;
}

export function weaklyConnectedComponents(
	files: string[],
	adjacency: Map<string, Set<string>>,
	reverse: Map<string, Set<string>>,
): string[][] {
	const visited = new Set<string>();
	const components: string[][] = [];

	for (const file of files) {
		if (visited.has(file)) continue;

		const component: string[] = [];
		const queue = [file];
		while (queue.length > 0) {
			const current = queue.shift()!;
			if (visited.has(current)) continue;

			visited.add(current);
			component.push(current);
			queue.push(...adjacency.get(current)!, ...reverse.get(current)!);
		}

		components.push(component);
	}

	return components;
}

export function stronglyConnectedComponents(files: string[], adjacency: Map<string, Set<string>>): string[][] {
	let index = 0;
	const stack: string[] = [];
	const indices = new Map<string, number>();
	const lowLinks = new Map<string, number>();
	const onStack = new Set<string>();
	const components: string[][] = [];

	function visit(node: string): void {
		indices.set(node, index);
		lowLinks.set(node, index);
		index++;
		stack.push(node);
		onStack.add(node);

		for (const dependency of adjacency.get(node)!) {
			if (!indices.has(dependency)) {
				visit(dependency);
				lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(dependency)!));
			} else if (onStack.has(dependency)) {
				lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(dependency)!));
			}
		}

		if (lowLinks.get(node) === indices.get(node)) {
			const component: string[] = [];
			let member: string;
			do {
				member = stack.pop()!;
				onStack.delete(member);
				component.push(member);
			} while (member !== node);
			components.push(component);
		}
	}

	for (const file of files) {
		if (!indices.has(file)) visit(file);
	}

	return components;
}
