#!/usr/bin/env bun
/** Cross-platform Pi-backed tool-selection runner. */
import process from "node:process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const contractOnly = args.includes("--contract-only");
const forwarded = args.filter((arg) => arg !== "--contract-only");
const quote = (value) => JSON.stringify(value);

process.env.PI_TOOL_SELECTION_EVAL_COMMAND = `${quote(process.execPath)} ${quote(
	fileURLToPath(new URL("./adapters/pi.mjs", import.meta.url)),
)}`;
if (contractOnly) process.env.PI_TOOL_SELECTION_NO_CUES = "1";
process.argv = [process.argv[0], fileURLToPath(new URL("./run.mjs", import.meta.url)), ...forwarded];

await import("./run.mjs");
