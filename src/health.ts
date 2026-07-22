/** @file Health session-start module. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface HealthWarning {
	code: string;
	message: string;
}

export interface HealthCheckDeps {
	checkPlaywright?: () => Promise<boolean>;
	onWarning?: (warning: HealthWarning) => void;
}

export function registerSessionStartHealthChecks(
	pi: ExtensionAPI,
	deps: HealthCheckDeps = {},
): void {
	pi.on("session_start", (_event, context) => {
		void runSessionStartHealthChecks({
			...deps,
			onWarning: (warning) => {
				deps.onWarning?.(warning);
				emitWarning(context, warning);
			},
		}).catch((error) =>
			emitWarning(context, {
				code: "WEB_HEALTH_CHECK_FAILED",
				message: error instanceof Error ? error.message : "pi-scraper health check failed",
			}),
		);
	});
}

export async function runSessionStartHealthChecks(
	deps: HealthCheckDeps = {},
): Promise<HealthWarning[]> {
	const warnings: HealthWarning[] = [];
	const warn = (warning: HealthWarning) => {
		warnings.push(warning);
		deps.onWarning?.(warning);
	};

	if (!(await (deps.checkPlaywright?.() ?? checkPlaywrightAvailable()))) {
		warn({
			code: "PLAYWRIGHT_UNAVAILABLE",
			message:
				"Playwright backend is unavailable for browser mode use with browserBackend: 'playwright'. CloakBrowser is the default backend and should be available. To use Playwright instead, run `bun add playwright` and `bunx playwright install chromium`.",
		});
	}

	return warnings;
}

async function checkPlaywrightAvailable(): Promise<boolean> {
	try {
		const moduleName = "playwright";
		await import(moduleName);
		return true;
	} catch {
		return false;
	}
}

function emitWarning(context: ExtensionContext, warning: HealthWarning): void {
	const message = `pi-scraper ${warning.code}: ${warning.message}`;
	context.ui.notify(message, "warning");
}
