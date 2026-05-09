/**
 * @fileoverview Anti-detection stealth patches for Playwright browser mode.
 *
 * @remarks
 * Reduces browser automation detection signals by spoofing common browser
 * fingerprinting vectors. These are well-understood techniques that make headless
 * Chromium behave more like a real user's browser.
 */
import type { Page } from "playwright";

export interface StealthPatchOptions {
	/** Remove navigator.webdriver property. */
	webdriver?: boolean;
	/** Add random noise to canvas operations. */
	canvasNoise?: boolean;
	/** Force WebRTC to respect proxy instead of leaking local IP. */
	blockWebRTC?: boolean;
	/** Block WebRTC entirely. */
	locale?: string;
	/** Timezone ID for Date and Intl APIs. */
	timezone?: string;
	/** Set random but consistent window dimensions. */
	viewportSeed?: string;
}

/**
 * Apply all enabled stealth patches before navigation.
 */
export async function applyStealthPatches(
	page: Page,
	options: StealthPatchOptions = {},
): Promise<void> {
	const scripts: string[] = [];

	if (options.webdriver !== false) {
		scripts.push(patchWebDriver);
	}
	if (options.canvasNoise) {
		scripts.push(patchCanvasNoise);
	}
	if (options.blockWebRTC) {
		scripts.push(patchWebRTC);
	}
	if (options.locale) {
		scripts.push(localePatch(options.locale));
	}
	if (options.timezone) {
		scripts.push(timezonePatch(options.timezone));
	}

	for (const script of scripts) {
		try {
			await page.addInitScript(script);
		} catch {
			/* ignore init script errors */
		}
	}
}

const patchWebDriver = `(() => {
	if (navigator.webdriver === true) {
		// Try to remove the property
		try { delete Object.getPrototypeOf(navigator).webdriver; } catch {}
	}
	if (typeof window !== "undefined" && window.chrome?.runtime) {
		try { delete window.chrome.runtime; } catch {}
	}
	const originalUA = navigator.userAgent;
	if (originalUA.includes("HeadlessChrome")) {
		Object.defineProperty(navigator, "userAgent", {
			get: () => originalUA.replace("HeadlessChrome", "Chrome"),
		});
	}
	// Hide automation flags in permissions API
	if (window.navigator.permissions?.query) {
		const orig = window.navigator.permissions.query;
		window.navigator.permissions.query = (p: any) =>
			p?.name === "notifications"
				? Promise.resolve({ state: Notification.permission })
				: orig(p);
	}
})();`;

const patchCanvasNoise = `(() => {
	const origFill = CanvasRenderingContext2D.prototype.fillText;
	CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) {
		const noise = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 > 0.9 ? 1 : 0;
		return origFill.call(this, text, x + noise, y + noise, ...rest);
	};
	// Similar for getImageData
	const origGet = CanvasRenderingContext2D.prototype.getImageData;
	CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
		const img = origGet.call(this, sx, sy, sw, sh);
		for (let i = 0; i < img.data.length; i += 4) {
			if (Math.random() > 0.95) {
				img.data[i] += Math.random() > 0.5 ? 1 : -1;
			}
		}
		return img;
	};
})();`;

const patchWebRTC = `(() => {
	if (window.RTCPeerConnection) {
		window.RTCPeerConnection = undefined as any;
	}
})();`;

function localePatch(locale: string): string {
	return `(() => {
		Object.defineProperty(navigator, "language", { get: () => "${locale}" });
		Object.defineProperty(navigator, "languages", { get: () => ["${locale}", "${locale.split("-")[0]}"] });
	})();`;
}

function timezonePatch(timezone: string): string {
	return `(() => {
		const OriginalDate = window.Date;
		class PatchedDate extends OriginalDate {
			constructor(...args: any[]) {
				super(...args);
			}
			getTimezoneOffset() {
				return new OriginalDate().getTimezoneOffset();
			}
		}
		window.Date = PatchedDate;
		window.Intl.DateTimeFormat = class {
			format(d: any) {
				return new OriginalDate(d).toLocaleString("en-US", { timeZone: "${timezone}" });
			}
		};
	})();`;
}
