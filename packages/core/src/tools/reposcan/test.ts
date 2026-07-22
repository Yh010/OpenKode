import { createRepoDependencyGraph } from "./dependency-graph.js";

const graph = createRepoDependencyGraph("C:/Yash_Personal/Projects/OpenKode");

console.log("Entry points:", graph.entryPoints);
console.log("High-degree modules:", graph.highDegreeModules.slice(0, 10));
console.log("Cycles:", graph.cycles);
console.log("Components:", graph.disconnectedComponents.map((component) => component.length));
console.log(`\n${graph.terminal}`);
