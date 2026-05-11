import { writeSuiteReport } from "./results.mjs";

export async function writeBenchmarkReport({ rootDir, suite, kind, report, markdown }) {
	await writeSuiteReport({
		rootDir,
		suite,
		kind,
		timestamp: report.generatedAt,
		report,
		markdown,
	});
}

export function safeSelect(adapter, doc, selector, root) {
	try {
		return adapter.select(doc, selector, root);
	} catch {
		return [];
	}
}

export function perfRow(tool) {
	return markdownRow(perfCells(tool.name, tool.perf));
}

export function perfCells(label, perf) {
	return [
		label,
		perf.samples,
		perf.min_ms,
		perf.median_ms,
		perf.mean_ms,
		perf.p95_ms,
		perf.max_ms,
		perf.stddev_ms,
	];
}

export function markdownRow(values) {
	return "| " + values.join(" | ") + " |";
}

export function markdownTable(headers, rows, align = []) {
	const separator = headers.map((_, index) => align[index] ?? "---");
	return [markdownRow(headers), markdownRow(separator), ...rows.map((row) => markdownRow(row))];
}
