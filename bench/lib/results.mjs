import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeSuiteReport({
	rootDir,
	suite,
	kind,
	timestamp,
	report,
	markdown,
	jsonName,
}) {
	const dir = kind
		? path.join(rootDir, "bench/results", suite, kind)
		: path.join(rootDir, "bench/results", suite);
	const historyDir = path.join(dir, "history");
	await mkdir(historyDir, { recursive: true });
	const safeName = jsonName ?? `${String(timestamp)}.json`;
	await writeFile(path.join(historyDir, safeName), `${JSON.stringify(report, null, 2)}\n`);
	await writeFile(path.join(dir, "latest.md"), markdown);
}
