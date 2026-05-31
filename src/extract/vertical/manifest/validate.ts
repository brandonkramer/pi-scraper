/** @file Vertical manifest validation. */

import type {
	ManifestDiagnostic,
	ManifestKind,
	ManifestSource,
	VerticalManifest,
} from "./types.ts";

const VALID_NAME = /^[a-z][a-z0-9_-]*$/iu;
const VALID_KINDS = new Set<ManifestKind>([
	"builtin",
	"api-json",
	"api-json-aggregate",
	"api-json-chain",
	"http-workflow",
	"api-xml",
	"selector",
	"pattern",
	"recipe",
	"html-extract",
	"text-extract",
	"code-extract",
]);
const VALID_SCHEMES = new Set(["http", "https"]);
const MAX_NAME_LEN = 64;

export function validateManifest(
	manifest: unknown,
	source: ManifestSource,
	sourcePath?: string,
): { manifest: VerticalManifest; diagnostics: ManifestDiagnostic[] } {
	const diagnostics: ManifestDiagnostic[] = [];
	const m = manifest as Record<string, unknown>;

	// name
	const name = validateString(m, "name", diagnostics);
	if (name !== undefined) {
		if (name.length > MAX_NAME_LEN) {
			diagnostics.push({
				severity: "error",
				message: `name exceeds ${MAX_NAME_LEN} chars`,
				field: "name",
			});
		}
		if (!VALID_NAME.test(name)) {
			diagnostics.push({
				severity: "error",
				message: "name must start with a letter and contain only a-z, 0-9, _, -",
				field: "name",
			});
		}
	}

	// kind
	const kind = validateString(m, "kind", diagnostics);
	if (kind !== undefined && !VALID_KINDS.has(kind as ManifestKind)) {
		diagnostics.push({ severity: "error", message: `unknown kind: ${kind}`, field: "kind" });
	}

	// version
	const version = validateNumber(m, "version", diagnostics);
	if (version !== undefined && version !== 1) {
		diagnostics.push({
			severity: "warning",
			message: `unsupported version ${version}`,
			field: "version",
		});
	}

	// description
	validateString(m, "description", diagnostics);

	// urlPatterns
	const urlPatterns = validateStringArray(m, "urlPatterns", diagnostics);
	if (urlPatterns) {
		for (const pattern of urlPatterns) {
			if (pattern.startsWith("http://") || pattern.startsWith("https://")) continue;
			diagnostics.push({
				severity: "error",
				message: `urlPatterns must start with http:// or https://: ${pattern}`,
				field: "urlPatterns",
			});
		}
	}

	// handler required for builtin
	if (kind === "builtin") {
		const handler = validateString(m, "handler", diagnostics);
		if (handler && !handler.startsWith("builtin.")) {
			diagnostics.push({
				severity: "error",
				message: "builtin handler must start with 'builtin.'",
				field: "handler",
			});
		}
	}

	if (kind === "recipe") validateRecipe(m, diagnostics);
	if (kind === "html-extract" || kind === "text-extract") validateRuleExtract(m, kind, diagnostics);
	if (kind === "code-extract") validateCodeExtract(m, diagnostics);
	if (kind === "api-json-aggregate") validateApiJsonAggregate(m, diagnostics);
	if (kind === "api-json-chain") validateApiJsonChain(m, diagnostics);
	if (kind === "http-workflow") validateHttpWorkflow(m, diagnostics);

	// request validation for declarative fetch kinds
	if (kind === "api-json" || kind === "api-xml" || kind === "selector" || kind === "pattern") {
		if (!m.request || typeof m.request !== "object") {
			diagnostics.push({
				severity: "error",
				message: `${kind} manifests require a request object`,
				field: "request",
			});
		} else {
			validateManifestRequest(m.request as Record<string, unknown>, diagnostics);
		}

		if (
			(!m.extract || typeof m.extract !== "object") &&
			(!m.extractList || typeof m.extractList !== "object")
		) {
			diagnostics.push({
				severity: "error",
				message: `${kind} manifests require an extract or extractList mapping`,
				field: "extract",
			});
		}
	}

	// Reject private-network patterns — check both urlPatterns and request.urlTemplate
	const allUrlsToCheck: Array<{ url: string; field: string }> = [];
	if (urlPatterns) {
		for (const pattern of urlPatterns) {
			allUrlsToCheck.push({ url: pattern, field: "urlPatterns" });
		}
	}
	if (m.request && typeof m.request === "object") {
		collectRequestUrlTemplate(
			m.request as Record<string, unknown>,
			"request.urlTemplate",
			allUrlsToCheck,
			diagnostics,
		);
	}
	collectAggregateRequestUrlTemplates(m.requests, allUrlsToCheck, diagnostics);
	collectChainStepUrlTemplates(m.steps, allUrlsToCheck, diagnostics);
	collectHttpWorkflowStepUrlTemplates(m.steps, allUrlsToCheck, diagnostics);
	collectRecipeRequestUrlTemplates(m.recipe, allUrlsToCheck, diagnostics);
	for (const { url, field } of allUrlsToCheck) {
		const host = tryGetHost(url);
		if (host) {
			const lower = host.toLowerCase();
			if (isPrivateNetworkHost(lower)) {
				diagnostics.push({
					severity: "error",
					message: `private-network URL rejected: ${host}`,
					field,
				});
			}
		}
	}

	const result = {
		...m,
		name: name ?? "unknown",
		kind: (kind ?? "api-json") as ManifestKind,
		version: version ?? 1,
		source,
		sourcePath,
		diagnostics,
	} as VerticalManifest;
	return { manifest: result, diagnostics };
}

function validateApiJsonAggregate(
	manifest: Record<string, unknown>,
	diagnostics: ManifestDiagnostic[],
): void {
	if (!manifest.requests || typeof manifest.requests !== "object") {
		diagnostics.push({
			severity: "error",
			message: "api-json-aggregate manifests require a requests object",
			field: "requests",
		});
		return;
	}
	for (const [name, request] of Object.entries(manifest.requests as Record<string, unknown>)) {
		if (!request || typeof request !== "object") continue;
		validateManifestRequest(request as Record<string, unknown>, diagnostics);
		const last = diagnostics.at(-1);
		if (last?.field === "request.urlTemplate") last.field = `requests.${name}.urlTemplate`;
	}
	if (!manifest.extract || typeof manifest.extract !== "object") {
		diagnostics.push({
			severity: "error",
			message: "api-json-aggregate manifests require an extract mapping",
			field: "extract",
		});
	}
}

function validateApiJsonChain(
	manifest: Record<string, unknown>,
	diagnostics: ManifestDiagnostic[],
): void {
	if (!Array.isArray(manifest.steps) || manifest.steps.length === 0) {
		diagnostics.push({
			severity: "error",
			message: "api-json-chain manifests require a non-empty steps array",
			field: "steps",
		});
		return;
	}
	for (const [index, stepValue] of manifest.steps.entries()) {
		if (!stepValue || typeof stepValue !== "object") continue;
		const step = stepValue as Record<string, unknown>;
		const request = step.request;
		if (request && typeof request === "object") {
			validateManifestRequest(request as Record<string, unknown>, diagnostics);
			const last = diagnostics.at(-1);
			if (last?.field === "request.urlTemplate") last.field = `steps[${index}].request.urlTemplate`;
		}
	}
	if (!manifest.extract || typeof manifest.extract !== "object") {
		diagnostics.push({
			severity: "error",
			message: "api-json-chain manifests require an extract mapping",
			field: "extract",
		});
	}
}

function validateHttpWorkflow(
	manifest: Record<string, unknown>,
	diagnostics: ManifestDiagnostic[],
): void {
	if (!Array.isArray(manifest.steps) || manifest.steps.length === 0) {
		diagnostics.push({
			severity: "error",
			message: "http-workflow manifests require a non-empty steps array",
			field: "steps",
		});
	}
}

function collectHttpWorkflowStepUrlTemplates(
	stepsValue: unknown,
	allUrlsToCheck: Array<{ url: string; field: string }>,
	diagnostics: ManifestDiagnostic[],
): void {
	if (!Array.isArray(stepsValue)) return;
	for (const [index, stepValue] of stepsValue.entries()) {
		if (!stepValue || typeof stepValue !== "object") continue;
		collectWorkflowStepUrlTemplates(
			stepValue as Record<string, unknown>,
			`steps[${index}]`,
			allUrlsToCheck,
			diagnostics,
		);
	}
}

function collectChainStepUrlTemplates(
	stepsValue: unknown,
	allUrlsToCheck: Array<{ url: string; field: string }>,
	diagnostics: ManifestDiagnostic[],
): void {
	if (!Array.isArray(stepsValue)) return;
	for (const [index, stepValue] of stepsValue.entries()) {
		if (!stepValue || typeof stepValue !== "object") continue;
		const step = stepValue as Record<string, unknown>;
		const request = step.request;
		if (request && typeof request === "object") {
			collectRequestUrlTemplate(
				request as Record<string, unknown>,
				`steps[${index}].request.urlTemplate`,
				allUrlsToCheck,
				diagnostics,
			);
			validateRequestHeaders((request as Record<string, unknown>).headers, diagnostics);
		}
	}
}

function collectAggregateRequestUrlTemplates(
	requestsValue: unknown,
	allUrlsToCheck: Array<{ url: string; field: string }>,
	diagnostics: ManifestDiagnostic[],
): void {
	if (!requestsValue || typeof requestsValue !== "object") return;
	for (const [name, request] of Object.entries(requestsValue as Record<string, unknown>)) {
		if (!request || typeof request !== "object") continue;
		collectRequestUrlTemplate(
			request as Record<string, unknown>,
			`requests.${name}.urlTemplate`,
			allUrlsToCheck,
			diagnostics,
		);
		validateRequestHeaders((request as Record<string, unknown>).headers, diagnostics);
	}
}

function validateCodeExtract(
	manifest: Record<string, unknown>,
	diagnostics: ManifestDiagnostic[],
): void {
	if (manifest.languages !== undefined) validateStringArray(manifest, "languages", diagnostics);
	if (manifest.extensions !== undefined) validateStringArray(manifest, "extensions", diagnostics);
}

function validateRuleExtract(
	manifest: Record<string, unknown>,
	kind: "html-extract" | "text-extract",
	diagnostics: ManifestDiagnostic[],
): void {
	if (!manifest.fields || typeof manifest.fields !== "object") {
		diagnostics.push({
			severity: "error",
			message: `${kind} manifests require a fields object`,
			field: "fields",
		});
	}
	if (manifest.request && typeof manifest.request === "object") {
		validateManifestRequest(manifest.request as Record<string, unknown>, diagnostics);
	}
}

function validateRecipe(
	manifest: Record<string, unknown>,
	diagnostics: ManifestDiagnostic[],
): void {
	const recipe = manifest.recipe;
	if (!recipe || typeof recipe !== "object") {
		diagnostics.push({
			severity: "error",
			message: "recipe manifests require a recipe object",
			field: "recipe",
		});
		return;
	}
	const before = diagnostics.length;
	validateString(recipe as Record<string, unknown>, "primitive", diagnostics);
	const last = diagnostics.at(-1);
	if (diagnostics.length > before && last) last.field = "recipe.primitive";
}

function collectRecipeRequestUrlTemplates(
	recipeValue: unknown,
	allUrlsToCheck: Array<{ url: string; field: string }>,
	diagnostics: ManifestDiagnostic[],
): void {
	if (!recipeValue || typeof recipeValue !== "object") return;
	const recipe = recipeValue as Record<string, unknown>;
	if (recipe.request && typeof recipe.request === "object") {
		collectRequestUrlTemplate(
			recipe.request as Record<string, unknown>,
			"recipe.request.urlTemplate",
			allUrlsToCheck,
			diagnostics,
		);
		validateRequestHeaders((recipe.request as Record<string, unknown>).headers, diagnostics);
	}
	if (recipe.requests && typeof recipe.requests === "object") {
		for (const [name, request] of Object.entries(recipe.requests as Record<string, unknown>)) {
			if (!request || typeof request !== "object") continue;
			collectRequestUrlTemplate(
				request as Record<string, unknown>,
				`recipe.requests.${name}.urlTemplate`,
				allUrlsToCheck,
				diagnostics,
			);
			validateRequestHeaders((request as Record<string, unknown>).headers, diagnostics);
		}
	}
	if (!Array.isArray(recipe.steps)) return;
	for (const [index, stepValue] of recipe.steps.entries()) {
		if (!stepValue || typeof stepValue !== "object") continue;
		const step = stepValue as Record<string, unknown>;
		const request = step.request;
		if (request && typeof request === "object") {
			collectRequestUrlTemplate(
				request as Record<string, unknown>,
				`recipe.steps[${index}].request.urlTemplate`,
				allUrlsToCheck,
				diagnostics,
			);
			validateRequestHeaders((request as Record<string, unknown>).headers, diagnostics);
		}
		collectWorkflowStepUrlTemplates(step, `recipe.steps[${index}]`, allUrlsToCheck, diagnostics);
	}
}

function collectWorkflowStepUrlTemplates(
	step: Record<string, unknown>,
	fieldPrefix: string,
	allUrlsToCheck: Array<{ url: string; field: string }>,
	diagnostics: ManifestDiagnostic[],
): void {
	for (const key of ["fetchText", "postJson"] as const) {
		const config = step[key];
		if (!config || typeof config !== "object") continue;
		collectUrlField(
			config as Record<string, unknown>,
			"url",
			`${fieldPrefix}.${key}.url`,
			allUrlsToCheck,
			diagnostics,
		);
	}
	const tryJson = step.tryJson;
	if (!tryJson || typeof tryJson !== "object") return;
	const endpoints = (tryJson as Record<string, unknown>).endpoints;
	if (!Array.isArray(endpoints)) return;
	for (const [endpointIndex, endpoint] of endpoints.entries()) {
		if (!endpoint || typeof endpoint !== "object") continue;
		collectUrlField(
			endpoint as Record<string, unknown>,
			"url",
			`${fieldPrefix}.tryJson.endpoints[${endpointIndex}].url`,
			allUrlsToCheck,
			diagnostics,
		);
	}
}

function collectUrlField(
	record: Record<string, unknown>,
	key: string,
	field: string,
	allUrlsToCheck: Array<{ url: string; field: string }>,
	diagnostics: ManifestDiagnostic[],
): void {
	const value = record[key];
	if (typeof value !== "string") return;
	collectRequestUrlTemplate({ urlTemplate: value }, field, allUrlsToCheck, diagnostics);
}

function collectRequestUrlTemplate(
	req: Record<string, unknown>,
	field: string,
	allUrlsToCheck: Array<{ url: string; field: string }>,
	diagnostics: ManifestDiagnostic[],
): void {
	const urlTemplate = typeof req.urlTemplate === "string" ? req.urlTemplate : undefined;
	if (!urlTemplate) return;
	const templateHost = tryGetHost(urlTemplate);
	if (templateHost) {
		const scheme = new URL(urlTemplate).protocol.slice(0, -1);
		if (!VALID_SCHEMES.has(scheme)) {
			diagnostics.push({
				severity: "error",
				message: `unsupported scheme in urlTemplate: ${scheme}`,
				field,
			});
		}
		if (templateHost.includes("{{") || templateHost.includes("}}")) {
			diagnostics.push({
				severity: "error",
				message: `templated host in urlTemplate rejected (cannot validate at load): ${urlTemplate}`,
				field,
			});
		} else {
			allUrlsToCheck.push({ url: urlTemplate, field });
		}
	} else if (urlTemplate.includes("{{host}}") || urlTemplate.includes("{{hostname}}")) {
		diagnostics.push({
			severity: "error",
			message: `templated host in urlTemplate rejected (cannot validate at load): ${urlTemplate}`,
			field,
		});
	}
}

function validateManifestRequest(
	req: Record<string, unknown>,
	diagnostics: ManifestDiagnostic[],
): void {
	const urlTemplate = validateString(req, "urlTemplate", diagnostics);
	if (urlTemplate) validateRequestUrlTemplate(urlTemplate, diagnostics);
	const method = typeof req.method === "string" ? req.method : undefined;
	if (method !== undefined && !["GET", "POST", "PUT", "DELETE"].includes(method)) {
		diagnostics.push({
			severity: "error",
			message: `invalid method: ${method}`,
			field: "request.method",
		});
	}
	validateRequestHeaders(req.headers, diagnostics);
}

function validateRequestUrlTemplate(urlTemplate: string, diagnostics: ManifestDiagnostic[]): void {
	try {
		const scheme = new URL(urlTemplate).protocol.slice(0, -1);
		if (!VALID_SCHEMES.has(scheme)) {
			diagnostics.push({
				severity: "error",
				message: `unsupported scheme in urlTemplate: ${scheme}`,
				field: "request.urlTemplate",
			});
		}
	} catch {
		// Template with {{placeholders}} may not parse as URL; that's ok.
	}
}

function validateRequestHeaders(headersValue: unknown, diagnostics: ManifestDiagnostic[]): void {
	if (!headersValue || typeof headersValue !== "object") return;
	const headers = headersValue as Record<string, string>;
	for (const key of Object.keys(headers)) {
		if (!isCredentialLikeHeader(key)) continue;
		diagnostics.push({
			severity: "error",
			message: `credential-like header rejected: ${key}`,
			field: "request.headers",
		});
	}
}

function isCredentialLikeHeader(key: string): boolean {
	const lower = key.toLowerCase();
	return ["auth", "token", "cookie", "secret", "key"].some((part) => lower.includes(part));
}

function validateString(
	obj: Record<string, unknown>,
	key: string,
	diagnostics: ManifestDiagnostic[],
): string | undefined {
	const v = obj[key];
	if (v === undefined) {
		diagnostics.push({ severity: "error", message: `missing required field: ${key}`, field: key });
		return undefined;
	}
	if (typeof v !== "string") {
		diagnostics.push({ severity: "error", message: `${key} must be a string`, field: key });
		return undefined;
	}
	if (v.trim() === "") {
		diagnostics.push({ severity: "error", message: `${key} must not be empty`, field: key });
		return undefined;
	}
	return v;
}

function validateNumber(
	obj: Record<string, unknown>,
	key: string,
	diagnostics: ManifestDiagnostic[],
): number | undefined {
	const v = obj[key];
	if (v === undefined) return undefined;
	if (typeof v !== "number" || !Number.isFinite(v)) {
		diagnostics.push({ severity: "error", message: `${key} must be a number`, field: key });
		return undefined;
	}
	return v;
}

function validateStringArray(
	obj: Record<string, unknown>,
	key: string,
	diagnostics: ManifestDiagnostic[],
): string[] | undefined {
	const v = obj[key];
	if (v === undefined) {
		diagnostics.push({ severity: "error", message: `missing required field: ${key}`, field: key });
		return undefined;
	}
	if (!Array.isArray(v)) {
		diagnostics.push({ severity: "error", message: `${key} must be an array`, field: key });
		return undefined;
	}
	const result: string[] = [];
	for (let i = 0; i < v.length; i++) {
		if (typeof v[i] !== "string") {
			diagnostics.push({ severity: "error", message: `${key}[${i}] must be a string`, field: key });
		} else {
			result.push(v[i] as string);
		}
	}
	return result;
}

function tryGetHost(pattern: string): string | undefined {
	try {
		const url = new URL(pattern);
		return url.hostname;
	} catch {
		return undefined;
	}
}

/** Check whether a hostname is a private-network or loopback address (CIDR-accurate). */
function isPrivateNetworkHost(host: string): boolean {
	if (host === "localhost" || host === "::1" || host === "[::1]") return true;
	// 127.0.0.0/8
	if (host.startsWith("127.")) return true;
	// 10.0.0.0/8
	if (host.startsWith("10.")) return true;
	// 192.168.0.0/16
	if (host.startsWith("192.168.")) return true;
	// 169.254.0.0/16
	if (host.startsWith("169.254.")) return true;

	// 172.16.0.0/12 — check second octet is 16-31
	const dot1 = host.indexOf(".");
	if (dot1 !== -1) {
		const first = host.slice(0, dot1);
		const rest = host.slice(dot1 + 1);
		const dot2 = rest.indexOf(".");
		if (first === "172" && dot2 !== -1) {
			const second = Number(rest.slice(0, dot2));
			if (!Number.isNaN(second) && second >= 16 && second <= 31) return true;
		}
	}

	// 0.0.0.0 (catch-all / IANA reserved)
	if (host === "0.0.0.0" || host.startsWith("0.")) return true;

	return false;
}

export function isManifestValid(manifest: VerticalManifest): boolean {
	return !manifest.diagnostics || manifest.diagnostics.every((d) => d.severity !== "error");
}
