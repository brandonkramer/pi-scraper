import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildAndImport } from "./build-pipeline.mjs";
import { writeSuiteReport } from "./results.mjs";
import { evaluateSignals, renderMarkdown } from "./signals.mjs";
import { timedRepeats } from "./stats.mjs";

const FIXTURE_EXTS = [".html", ".pdf"];

export async function runEval({ rootDir, corpusPath, warmup = 3, repeats = 20 }) {
	const timestamp = new Date().toISOString();
	const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
	const pkg = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
	const compiled = await buildAndImport(rootDir);
	const fixturesDir = path.join(rootDir, "eval/fixtures");
	const results = [];
	for (const testCase of corpus.cases ?? [])
		results.push(
			await runCase(testCase, compiled, fixturesDir, rootDir, {
				warmup,
				repeats,
			}),
		);
	const report = {
		corpusVersion: corpus.corpusVersion ?? "unversioned",
		// gitSha is undefined on fresh repos with no commits yet; JSON.stringify drops it then.
		gitSha: gitSha(rootDir),
		nodeVersion: process.version,
		packageVersion: pkg.version,
		generatedAt: timestamp,
		modeFlags: {
			fixtureMode: true,
			liveNetwork: false,
			pipelineMode: "scrapeUrl(fast)",
			warmup,
			repeats,
		},
		results,
	};
	const markdown = renderMarkdown(report);
	await writeSuiteReport({
		rootDir,
		suite: "eval-corpus",
		timestamp,
		report,
		markdown,
	});
	return {
		report,
		markdown,
		failed: results.some((result) => result.verdict === "fail"),
	};
}

async function runCase(testCase, compiled, fixturesDir, rootDir, options) {
	const fixture = await findFixture(fixturesDir, testCase.id);
	if (!fixture) return skippedCase(testCase, "no_fixture");
	if (fixture.ext === ".pdf")
		return await runPdfCase(testCase, compiled, fixture, rootDir, options);
	const totalStart = performance.now();
	const fetchStart = performance.now();
	const htmlBuffer = await readFile(fixture.path);
	const fetchMs = performance.now() - fetchStart;
	const html = htmlBuffer.toString("utf8");
	const fileUrl = pathToFileURL(fixture.path).toString();
	const scrapeOnce = () =>
		compiled.scrapeUrl(
			fileUrl,
			{ mode: "fast", format: "markdown", removeImages: true },
			{ httpClient: stubHttpClient(fileUrl, html, htmlBuffer.byteLength) },
		);
	const parseStart = performance.now();
	const result = await scrapeOnce();
	const parseMs = performance.now() - parseStart;
	const markdown = result.data.markdown ?? "";
	const text = result.data.text ?? "";
	const signals = evaluateSignals(testCase.expectedSignals ?? [], {
		html,
		markdown,
		text,
		scrape: result.data,
		fixtureExt: fixture.ext,
	});
	const metrics = metricsFor(
		fetchMs,
		parseMs,
		performance.now() - totalStart,
		htmlBuffer.byteLength,
		markdown,
		text,
	);
	// Repeat scrapeUrl(fast) on the same fixture to capture distribution stats; warmup discards JIT
	// noise from the first calls. Pure CPU work — no network, no FS reads inside the loop.
	const perf = await timedRepeats(scrapeOnce, options);
	return caseResult(testCase, fixture, rootDir, signals, metrics, perf);
}

// Inject a fixture-backed HttpClient stub so scrapeUrl(fast) drives the full pipeline
// (signal aggregation, blocked detection, format rendering, truncation) with no network I/O.
function stubHttpClient(url, payload, bytes, contentType = "text/html; charset=utf-8") {
	return {
		fetchUrl: async () => ({
			url,
			finalUrl: url,
			status: 200,
			headers: { "content-type": contentType },
			contentType,
			body: Buffer.isBuffer(payload) ? payload : Buffer.from(payload),
			text: typeof payload === "string" ? payload : undefined,
			downloadedBytes: bytes,
		}),
	};
}

async function runPdfCase(testCase, compiled, fixture, rootDir, options) {
	const totalStart = performance.now();
	const fetchStart = performance.now();
	const pdfBuffer = await readFile(fixture.path);
	const fetchMs = performance.now() - fetchStart;
	const fileUrl = pathToFileURL(fixture.path).toString();
	const scrapeOnce = () =>
		compiled.scrapeUrl(
			fileUrl,
			{ mode: "fast", format: "markdown" },
			{
				httpClient: stubHttpClient(fileUrl, pdfBuffer, pdfBuffer.byteLength, "application/pdf"),
			},
		);
	const parseStart = performance.now();
	const result = await scrapeOnce();
	const parseMs = performance.now() - parseStart;
	const markdown = result.data.markdown ?? "";
	const text = result.data.text ?? "";
	const signals = evaluateSignals(testCase.expectedSignals ?? [], {
		html: "",
		markdown,
		text,
		scrape: result.data,
		fixtureExt: fixture.ext,
	});
	const metrics = metricsFor(
		fetchMs,
		parseMs,
		performance.now() - totalStart,
		pdfBuffer.byteLength,
		markdown,
		text,
	);
	const perf = await timedRepeats(scrapeOnce, options);
	return caseResult(testCase, fixture, rootDir, signals, metrics, perf);
}

function caseResult(testCase, fixture, rootDir, signals, metrics, perf) {
	return {
		id: testCase.id,
		category: testCase.category,
		fixture: path.relative(rootDir, fixture.path),
		verdict: signals.some((signal) => signal.status === "fail") ? "fail" : "pass",
		metrics,
		signals,
		...(perf ? { perf } : {}),
	};
}

async function findFixture(fixturesDir, id) {
	for (const ext of FIXTURE_EXTS) {
		const candidate = path.join(fixturesDir, `${String(id)}${ext}`);
		try {
			await stat(candidate);
			return { path: candidate, ext };
		} catch {
			/* ignore */
		}
	}
}

function skippedCase(testCase, reason) {
	return {
		id: testCase.id,
		category: testCase.category,
		verdict: "skipped",
		skipped: reason,
		metrics: metricsFor(0, 0, 0, 0, "", ""),
		signals: (testCase.expectedSignals ?? []).map((name) => ({
			name,
			status: "skipped",
			details: reason,
		})),
	};
}

function metricsFor(fetchMs, parseMs, totalMs, downloadedBytes, markdown, visibleText) {
	return {
		fetch_ms: round(fetchMs),
		parse_ms: round(parseMs),
		total_ms: round(totalMs),
		downloaded_bytes: downloadedBytes,
		markdown_chars: markdown.length,
		visible_text_chars: visibleText.length,
		estimated_tokens: Math.ceil(markdown.length / 4),
	};
}

function gitSha(rootDir) {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: rootDir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		/* ignore */
	}
}

function round(value) {
	return Math.round(value * 100) / 100;
}
