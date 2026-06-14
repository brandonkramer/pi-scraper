/**
 * @fileoverview Pure scoring for the tool-selection suite: predictions ->
 * report, aggregate over runs, gate verdict. No fs/process/network so it is
 * unit-testable on canned predictions (task 79, convention 3). The runner owns
 * model invocation and side effects; this module only judges data.
 */
import { DISCRIMINATOR_ARG_KEYS, FREE_FORM_ARG_KEYS, THRESHOLDS } from "./config.mjs";

/**
 * Score one prediction set against the fixtures + live contracts.
 * @param {{contracts: Array, fixtures: Array, predictions: Array, predictionMode: string}} input
 */
export function buildReport({ contracts, fixtures, predictions, predictionMode }) {
	const byId = new Map(predictions.map((prediction) => [prediction.id, prediction]));
	const rows = fixtures.map((fixture) => {
		const prediction = byId.get(fixture.id) ?? { id: fixture.id, actualTool: null };
		const actualTool = prediction.actualTool ?? null;
		const actualArgs = prediction.actualArgs ?? {};
		const passed = actualTool === fixture.expectedTool;
		const expectedDiscriminators = discriminatorArgs(fixture.expectedArgs ?? {});
		// Only score discriminator keys the model actually provided. An omitted key
		// is assumed correctly inferred by the tool (crawl->run, extract->adhoc), so
		// it neither passes nor fails. A row is scorable once the tool is right and
		// >=1 expected discriminator was actually set, so there is a choice to judge.
		// ponytail: lenient on omission; a model could pass by setting only the easy
		// key. Tighten with a per-tool required-arg registry if that ever masks a real
		// regression.
		const checkedKeys = Object.keys(expectedDiscriminators).filter(
			(key) => actualArgs[key] !== undefined,
		);
		const scorableArgs = passed && checkedKeys.length > 0;
		const argsPassed = scorableArgs && argsMatch(expectedDiscriminators, actualArgs, checkedKeys);
		return {
			id: fixture.id,
			prompt: fixture.prompt,
			expectedTool: fixture.expectedTool,
			actualTool,
			actualArgs,
			passed,
			expectedDiscriminators,
			scorableArgs,
			argsPassed,
			tags: fixture.tags,
		};
	});
	const positives = rows.filter((row) => row.expectedTool !== null);
	const negatives = rows.filter((row) => row.expectedTool === null);
	const positiveAccuracy = ratio(positives.filter((row) => row.passed).length, positives.length);
	const negativePrecision = ratio(negatives.filter((row) => row.passed).length, negatives.length);
	const criticalConfusions = rows.filter((row) => isCriticalConfusion(row));
	const invocationScorable = rows.filter((row) => row.scorableArgs);
	const invocationAccuracy = ratio(
		invocationScorable.filter((row) => row.argsPassed).length,
		invocationScorable.length,
	);
	const contractTokenByTool = contracts.map((contract) => ({
		name: contract.name,
		tokens: Math.ceil(JSON.stringify(contract).length / 4),
	}));
	const contractTokenEstimate = contractTokenByTool.reduce((sum, entry) => sum + entry.tokens, 0);
	return {
		kind: "tool-selection-eval",
		generatedAt: new Date().toISOString(),
		predictionMode,
		contractTokenEstimate,
		contractTokenByTool,
		thresholds: THRESHOLDS,
		metrics: {
			total: rows.length,
			passed: rows.filter((row) => row.passed).length,
			failed: rows.filter((row) => !row.passed).length,
			positiveAccuracy,
			negativePrecision,
			invocationAccuracy,
			invocationScorable: invocationScorable.length,
			invocationPassed: invocationScorable.filter((row) => row.argsPassed).length,
			criticalConfusions: criticalConfusions.length,
		},
		confusionMatrix: confusionMatrix(rows),
		perFixture: rows.map((row) => ({
			id: row.id,
			expectedTool: row.expectedTool,
			passed: row.passed,
			scorableArgs: row.scorableArgs,
			argsPassed: row.argsPassed,
		})),
		failures: rows.filter((row) => !row.passed),
		invocationFailures: invocationScorable
			.filter((row) => !row.argsPassed)
			.map((row) => ({
				id: row.id,
				expected: row.expectedDiscriminators,
				actual: pick(row.actualArgs, Object.keys(row.expectedDiscriminators)),
			})),
		criticalConfusions,
	};
}

/** Average N per-run reports; gate on the mean, surface per-fixture flakiness. */
export function aggregateReports(reports) {
	const runs = reports.length;
	const base = reports[0];
	const mean = (selectMetric) => reports.reduce((sum, r) => sum + selectMetric(r), 0) / runs;
	const range = (selectMetric) => [
		Math.min(...reports.map(selectMetric)),
		Math.max(...reports.map(selectMetric)),
	];
	const flakySelection = [];
	const flakyInvocation = [];
	for (const { id } of base.perFixture) {
		const samples = reports.map((r) => r.perFixture.find((f) => f.id === id));
		if (samples[0].expectedTool !== null) {
			const rate = samples.filter((f) => f.passed).length / runs;
			if (rate < 1) flakySelection.push({ id, passRate: rate });
		}
		const scorable = samples.filter((f) => f.scorableArgs);
		if (scorable.length > 0) {
			const rate = scorable.filter((f) => f.argsPassed).length / scorable.length;
			if (rate < 1) flakyInvocation.push({ id, passRate: rate });
		}
	}
	return {
		...base,
		runs,
		metrics: {
			total: base.metrics.total,
			positiveAccuracy: mean((r) => r.metrics.positiveAccuracy),
			negativePrecision: mean((r) => r.metrics.negativePrecision),
			invocationAccuracy: mean((r) => r.metrics.invocationAccuracy),
			invocationScorable: mean((r) => r.metrics.invocationScorable),
			invocationPassed: mean((r) => r.metrics.invocationPassed),
			criticalConfusions: mean((r) => r.metrics.criticalConfusions),
		},
		metricRanges: {
			positiveAccuracy: range((r) => r.metrics.positiveAccuracy),
			negativePrecision: range((r) => r.metrics.negativePrecision),
			invocationAccuracy: range((r) => r.metrics.invocationAccuracy),
		},
		perRunMetrics: reports.map((r) => ({
			positiveAccuracy: r.metrics.positiveAccuracy,
			invocationAccuracy: r.metrics.invocationAccuracy,
			criticalConfusions: r.metrics.criticalConfusions,
		})),
		flakySelection,
		flakyInvocation,
		failures: [],
		invocationFailures: [],
	};
}

/** Gate-breaking findings; empty array == PASS. */
export function gateFailures(report) {
	const { metrics: m, thresholds: t } = report;
	const failures = [];
	if (m.positiveAccuracy < t.positiveExactToolAccuracy)
		failures.push(
			`positive tool accuracy ${pct(m.positiveAccuracy)} < ${pct(t.positiveExactToolAccuracy)}`,
		);
	if (m.negativePrecision < t.negativeNoToolPrecision)
		failures.push(
			`negative no-tool precision ${pct(m.negativePrecision)} < ${pct(t.negativeNoToolPrecision)}`,
		);
	if (m.invocationAccuracy < t.invocationExactArgAccuracy)
		failures.push(
			`invocation arg accuracy ${pct(m.invocationAccuracy)} < ${pct(t.invocationExactArgAccuracy)}`,
		);
	if (m.criticalConfusions > t.criticalConfusions)
		failures.push(`critical confusions ${String(m.criticalConfusions)} > ${String(t.criticalConfusions)}`);
	if (report.contractTokenEstimate > t.contractTokenBudget)
		failures.push(
			`contract tokens ${String(report.contractTokenEstimate)} > budget ${String(t.contractTokenBudget)}`,
		);
	return failures;
}

export function pct(value) {
	return `${(value * 100).toFixed(1)}%`;
}

function isCriticalConfusion(row) {
	const prompt = String(row.prompt).toLowerCase();
	const tags = row.tags.join(" ");
	if (
		["web_scrape", "web_extract"].includes(row.actualTool) &&
		/multi-source|citations/u.test([prompt, tags].join(" "))
	)
		return true;
	if (
		["web_scrape", "web_extract", "web_crawl"].includes(row.actualTool) &&
		/research|recent articles|open-ended/u.test([prompt, tags].join(" ")) &&
		!/https?:\/\//u.test(prompt)
	)
		return true;
	if (
		row.expectedTool === "web_extract" &&
		/vertical|known-site|typed|github|npm|deepwiki/u.test([prompt, tags].join(" ")) &&
		row.actualArgs?.action === "adhoc"
	)
		return true;
	if (
		row.actualTool === "web_map" &&
		/reading pages|extract page|read-pages/u.test([prompt, tags].join(" "))
	)
		return true;
	return false;
}

function confusionMatrix(rows) {
	const matrix = {};
	for (const row of rows) {
		const expected = row.expectedTool ?? "none";
		const actual = row.actualTool ?? "none";
		matrix[expected] ??= {};
		matrix[expected][actual] = (matrix[expected][actual] ?? 0) + 1;
	}
	return matrix;
}

function discriminatorArgs(expectedArgs) {
	const out = {};
	for (const key of DISCRIMINATOR_ARG_KEYS)
		if (expectedArgs?.[key] !== undefined) out[key] = expectedArgs[key];
	return out;
}

function argsMatch(expected, actual, keys) {
	return keys.every((key) => {
		if (FREE_FORM_ARG_KEYS.has(key)) return isNonEmpty(actual?.[key]);
		return JSON.stringify(actual?.[key]) === JSON.stringify(expected[key]);
	});
}

function isNonEmpty(value) {
	if (Array.isArray(value)) return value.length > 0;
	return value !== undefined && value !== null && value !== "";
}

function pick(source, keys) {
	const out = {};
	for (const key of keys) out[key] = source?.[key];
	return out;
}

function ratio(numerator, denominator) {
	return denominator === 0 ? 1 : numerator / denominator;
}
