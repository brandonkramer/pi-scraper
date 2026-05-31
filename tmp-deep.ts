/**
 * Deep analysis — find every remaining byte of overhead.
 */
import { webTools } from "./src/tools/infra/register.ts";

for (const tool of webTools) {
	const full = JSON.stringify({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
	});
	
	// Extract all serialized param values (key:value pairs)
	const paramsMatch = full.match(/"properties":\{(.*)"\},\s*"required"/s) || 
	                   full.match(/"properties":\{(.*)\}\}/s);
	const inner = paramsMatch ? paramsMatch[1] : '';
	
	// Split into individual param definitions
	// Each param is "key":{...} or "key":{...},  
	const segments = inner.match(/"\w+":\{(?:[^{}]|\{[^{}]*\})*\}/g) || [];
	
	// Sort by length descending  
	const sorted = segments
		.map(s => ({ raw: s, len: s.length }))
		.sort((a, b) => b.len - a.len);
	
	console.log(`\n=== ${tool.name} (${full.length}c, ${Math.ceil(full.length/4)}t) ===`);
	console.log(`  Top-8 param serializations:`);
	for (const seg of sorted.slice(0, 8)) {
		const key = seg.raw.match(/"(\w+)":/)?.[1] || '?';
		console.log(`  [${seg.len}c] ${key}: ${seg.raw.slice(0, 100)}`);
	}
	console.log(`  Remaining params: ${sorted.length - 8}`);
	
	// Count non-param structural overhead
	const allParamsJoined = segments.join(',');
	const structuralOverhead = full.length - allParamsJoined.length - '{name,label,desc}'.length;
}
