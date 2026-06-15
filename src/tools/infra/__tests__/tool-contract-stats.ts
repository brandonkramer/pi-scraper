/**
 * @file Tool contract token stats — used by autoresearch to measure schema token usage. NOT a test
 *   file (no test runner dependency). Run: npx tsx src/tools/**tests**/tool-contract-stats.ts
 */
import { webTools } from "../infra/register.ts";

function approxTokens(s: string): number {
	const l = s.length;
	const r = Math.ceil(l / 4);
	return r;
}

let total = 0;
const counts: Record<string, number> = {};

for (const tool of webTools) {
	const obj = {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
	};
	const contract = JSON.stringify(obj);
	if (typeof contract !== "string") {
		console.error(`ERROR: ${tool.name} contract is ${typeof contract}`);
		process.exit(1);
	}
	const tokens = approxTokens(contract);
	const key = tool.name.replace("web_", "");
	counts[key] = tokens;
	total += tokens;
}

console.log(`METRIC total_tokens=${total}`);
for (const [k, v] of Object.entries(counts)) {
	console.log(`METRIC ${k}_tokens=${v}`);
}
