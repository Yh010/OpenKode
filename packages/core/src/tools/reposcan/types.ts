export type EdgeKind = "static" | "dynamic" | "require" | "type-only";

export type GraphEdge = {
	from: string;
	to: string;
	kind: EdgeKind;
};

export type GraphNode = {
	path: string;
	inDegree: number;
	outDegree: number;
	isEntryPoint: boolean;
	entryReasons: string[];
};

export type RepoDependencyGraph = {
	root: string;
	nodes: GraphNode[];
	edges: GraphEdge[];
	entryPoints: Array<{ path: string; reasons: string[] }>;
	highDegreeModules: GraphNode[];
	disconnectedComponents: string[][];
	cycles: string[][];
	reachableFromEntryPoint: Record<string, string[]>;
	externalDependencies: Array<{ name: string; occurrences: number }>;
	orphanModules: string[];
	unresolvedLocalDependencies: Array<{ from: string; specifier: string }>;
	mermaid: string;
	terminal: string;
};

export type WorkspacePackage = {
	name: string;
	root: string;
};
