/**
 * @fileoverview Tool-selection suite config — thresholds and scoring keys as
 * data, consumed by score.mjs/run.mjs. Magic numbers live here, not in runner
 * branches (task 79, convention 4).
 */
import { readFileSync } from "node:fs";

const contractBudget = JSON.parse(
	readFileSync(new URL("./contract-budget.json", import.meta.url), "utf8"),
);

/** Gate thresholds. A run FAILs if any metric crosses its bound. */
export const THRESHOLDS = {
	positiveExactToolAccuracy: 0.9,
	negativeNoToolPrecision: 0.9,
	invocationExactArgAccuracy: 0.9,
	criticalConfusions: 0,
	contractTokenBudget: contractBudget.fullCatalogTokenBudget,
	minimumInitialPromptReduction: contractBudget.minimumInitialPromptReduction,
};

/** Discriminator args that route within a god-tool; scored for exact match. */
export const DISCRIMINATOR_ARG_KEYS = ["action", "task", "extractor", "format", "jsonPaths"];

/** Free-form payload args: many valid forms, so score presence not exact value. */
export const FREE_FORM_ARG_KEYS = new Set(["jsonPaths"]);

/** Default model runs to average when --runs/PI_TOOL_SELECTION_RUNS is unset. */
export const DEFAULT_RUNS = 1;
