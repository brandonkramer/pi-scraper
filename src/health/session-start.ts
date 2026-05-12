/** @file Health session-start module. */
import { clearEffectiveConfigCache } from "../config/settings.ts";

export interface HealthWarning {
	code: string;
	message: string;
}

export interface PiHealthRegistrar {
	on(event: "session_start", handler: (event: unknown, ctx: unknown) => void | Promise<void>): void;
	warn?: (message: string) => void;
	notify?: (message: string | { type?: string; message: string }) => void;
}

export interface HealthCheckDeps {
	checkPlaywright?: () => Promise<boolean>;
	onWarning?: (warning: HealthWarning) => void;
}

export function registerSessionStartHealthChecks(
	pi: PiHealthRegistrar,
	deps: HealthCheckDeps = {},
): void {
	pi.on("session_start", () => {
		clearEffectiveConfigCache();
		void runSessionStartHealthChecks({
			...deps,
			onWarning: (warning) => {
				deps.onWarning?.(warning);
				emitWarning(pi, warning);
			},
		}).catch((error) =>
			emitWarning(pi, {
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
				"Optional browser mode is unavailable. Playwright is an optional dependency; if it was omitted, run `npm install playwright` in the extension directory, then `npx playwright install chromium` if browser rendering is needed.",
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

function emitWarning(pi: PiHealthRegistrar, warning: HealthWarning): void {
	const message = `pi-scraper ${warning.code}: ${warning.message}`;
	if (pi.warn) pi.warn(message);
	else if (pi.notify) pi.notify({ type: "warning", message });
}
