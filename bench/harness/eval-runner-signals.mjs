export function evaluateSignals(names, context) {
	return names.map((name) => ({ name, ...signalStatus(name, context) }));
}

export function renderMarkdown(report) {
	const failed = report.results.filter(
		(result) => result.verdict === "fail",
	).length;
	const passed = report.results.filter(
		(result) => result.verdict === "pass",
	).length;
	const skipped = report.results.filter(
		(result) => result.verdict === "skipped",
	).length;
	const lines = [
		"# pi-scraper extraction eval",
		"",
		`Generated: ${report.generatedAt}`,
		`Package: ${report.packageVersion} · Node: ${report.nodeVersion} · Git: ${report.gitSha ?? "unknown"}`,
		`Summary: ${passed} passed, ${skipped} skipped, ${failed} failed`,
		"",
		"## Signals",
		"",
		"| Case | Verdict | Fixture | Bytes | Markdown chars | Signals |",
		"| --- | --- | --- | ---: | ---: | --- |",
		...report.results.map(
			(result) => `| ${signalRow(result).map(escapeCell).join(" | ")} |`,
		),
	];
	const perfRows = report.results.filter((result) => result.perf);
	if (perfRows.length > 0) {
		lines.push(
			"",
			`## Performance — scrapeUrl(fast), warmup ${report.modeFlags?.warmup ?? "?"} × repeats ${report.modeFlags?.repeats ?? "?"}`,
			"",
			"| Case | Samples | Min ms | Median ms | Mean ms | P95 ms | Max ms | Stddev ms |",
			"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
			...perfRows.map(
				(result) => `| ${perfRow(result).map(escapeCell).join(" | ")} |`,
			),
		);
	}
	lines.push("");
	return lines.join("\n");
}

function signalStatus(name, context) {
	const { html, markdown, text, scrape, fixtureExt } = context;
	const cleanedHtml = scrape?.html ?? html;
	const lower = `${html}\n${markdown}\n${text}`.toLowerCase();
	const links = scrape?.links ?? [];
	const dataIslandLen = scrape?.signals?.dataIslandTextLength ?? 0;
	const headingsCount = (cleanedHtml.match(/<h[1-6][\s>]/giu) ?? []).length;
	const blocked = Boolean(
		scrape?.blocked ||
			/captcha|access denied|blocked|cloudflare|verify you are human/iu.test(
				lower,
			),
	);
	const browserUsed = (scrape?.extractionPath ?? []).includes("browser");
	const pass = {
		title: Boolean(scrape?.title),
		main_text: text.length >= 80,
		body_text: text.length >= 80,
		headings: headingsCount > 0,
		links: links.length > 0,
		internal_links: links.length > 0,
		metadata: Boolean(scrape?.title || scrape?.description),
		// Cleaned HTML may strip <script> tags; fall back to raw fixture HTML for the JSON-LD probe.
		json_ld:
			/application\/ld\+json/iu.test(cleanedHtml) ||
			/application\/ld\+json/iu.test(html),
		price_or_features: /\$\d|\bpricing\b|\bfeatures?\b|\bplans?\b/iu.test(
			lower,
		),
		sparse_dom: Boolean(scrape?.signals?.sparseDom) && dataIslandLen > 0,
		data_island_text: dataIslandLen > 0,
		no_unnecessary_browser: !browserUsed,
		blocked_signal: blocked,
		structured_error: blocked,
		content_type_pdf: fixtureExt === ".pdf" && scrape?.route === "pdf",
		pdf_text_or_metadata:
			fixtureExt === ".pdf" &&
			(Boolean(scrape?.pdf?.ok && text.length > 0) ||
				Boolean(
					scrape?.pdf?.metadata && Object.keys(scrape.pdf.metadata).length > 0,
				)),
		hero_text: /class=["'][^"']*hero/iu.test(html),
		section_headings: headingsCount >= 2,
		footer_links: /<footer[\s>]/iu.test(html),
		low_noise:
			(lower.match(/cookie|subscribe|privacy|advertisement/gu) ?? []).length <=
				3 && markdown.length < 5000,
	};
	if (!(name in pass))
		return { status: "unverifiable_offline", details: "no_offline_heuristic" };
	if (["blocked_signal", "structured_error"].includes(name) && !pass[name]) {
		return {
			status: "unverifiable_offline",
			details: "requires_live_or_specialized_fixture",
		};
	}
	return pass[name] ? { status: "pass" } : { status: "fail" };
}

function signalRow(result) {
	const verdict =
		result.verdict === "pass"
			? "✅ pass"
			: result.verdict === "skipped"
				? `⏭ skipped (${result.skipped})`
				: "❌ fail";
	return [
		result.id,
		verdict,
		result.fixture ?? "—",
		result.metrics.downloaded_bytes,
		result.metrics.markdown_chars,
		signalSummary(result.signals),
	];
}

function perfRow(result) {
	const p = result.perf;
	return [
		result.id,
		p.samples,
		p.min_ms,
		p.median_ms,
		p.mean_ms,
		p.p95_ms,
		p.max_ms,
		p.stddev_ms,
	];
}

function signalSummary(signals) {
	return signals
		.map((signal) => `${iconFor(signal.status)} ${signal.name}`)
		.join("<br>");
}

function iconFor(status) {
	return status === "pass"
		? "✅"
		: status === "fail"
			? "❌"
			: status === "skipped"
				? "⏭"
				: "◌";
}

function escapeCell(value) {
	return String(value).replace(/\|/gu, "\\|").replace(/\n/gu, " ");
}
