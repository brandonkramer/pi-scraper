/** @file Bench script measuring HTTP connection reuse across sequential scrapes. */
import { Agent } from "undici";

import { createHttpClient } from "../../src/http/client.ts";

const TARGET = "https://www.rfc-editor.org/rfc/rfc9110.html";
const WARMUPS = 1;
const RUNS = 5;

async function measureShared() {
	const client = createHttpClient();
	for (let i = 0; i < WARMUPS; i++) await client.fetchUrl(TARGET);

	const times: number[] = [];
	for (let i = 0; i < RUNS; i++) {
		const start = performance.now();
		await client.fetchUrl(TARGET);
		const end = performance.now();
		times.push(end - start);
	}
	return times;
}

async function measureNoReuse() {
	const times: number[] = [];
	for (let i = 0; i < RUNS; i++) {
		const agent = new Agent();
		const client = createHttpClient({ dispatcher: agent });
		const start = performance.now();
		await client.fetchUrl(TARGET);
		const end = performance.now();
		times.push(end - start);
		await agent.close();
	}
	return times;
}

function report(label: string, times: number[]) {
	const [first, ...rest] = times;
	rest.sort((a, b) => a - b);
	const median = rest[Math.floor(rest.length / 2)] ?? first;
	console.log(`\n${label}`);
	console.log(`  times: ${times.map((t) => t.toFixed(1)).join(", ")} ms`);
	console.log(`  first: ${first.toFixed(1)} ms`);
	console.log(`  median of rest: ${median.toFixed(1)} ms`);
	return { first, median };
}

async function main() {
	const sharedTimes = await measureShared();
	const shared = report("Shared Agent (connection reuse)", sharedTimes);

	const noReuseTimes = await measureNoReuse();
	const noReuse = report("Fresh Agent each time (no reuse)", noReuseTimes);

	console.log("\nSummary");
	console.log(`  Shared median:  ${shared.median.toFixed(1)} ms`);
	console.log(`  No-reuse median: ${noReuse.median.toFixed(1)} ms`);
	console.log(`  Win:             ${(noReuse.median - shared.median).toFixed(1)} ms`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
