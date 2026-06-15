/** @file Browser session pool unit tests. */
import { afterEach, describe, expect, it } from "vitest";

import type { SafeUrlResult } from "../../http/url-safety.ts";
import {
	acquireBrowserSession,
	closeAllBrowserSessions,
	destroyBrowserSession,
} from "../session-pool.ts";

async function safeCheck(input: string | URL): Promise<SafeUrlResult> {
	const value = input.toString();
	return {
		url: new globalThis.URL(value.startsWith("http") ? value : `http://${value}`),
		normalizedUrl: value,
		checkedAddresses: [],
	};
}

function fakeLaunchBrowser() {
	const pages: Array<Record<string, unknown>> = [];
	let pageCounter = 0;
	const browserContext = {
		route: async () => {
			/* no-op */
		},
		close: async () => {
			/* no-op */
		},
		newPage: async () => {
			pageCounter += 1;
			const id = pageCounter;
			let closed = false;
			const page = {
				id,
				isClosed: () => closed,
				close: async () => {
					closed = true;
				},
			};
			pages.push(page);
			return page;
		},
	};
	const browser = {
		newContext: async () => browserContext,
		close: async () => {
			/* no-op */
		},
	};
	return {
		browser,
		getPages: () => pages,
	};
}

afterEach(async () => {
	await closeAllBrowserSessions();
});

describe("acquireBrowserSession reusePage", () => {
	it("returns the same Page twice when reusePage is true", async () => {
		const fake = fakeLaunchBrowser();
		const first = await acquireBrowserSession("reuse-test", {
			launchBrowser: async () => fake.browser as never,
			safetyCheck: safeCheck,
			reusePage: true,
		});
		const second = await acquireBrowserSession("reuse-test", {
			launchBrowser: async () => fake.browser as never,
			safetyCheck: safeCheck,
			reusePage: true,
		});

		expect(first.page).toBe(second.page);
		expect(fake.getPages()).toHaveLength(1);
	});

	it("mints a new Page when the reused page is closed", async () => {
		const fake = fakeLaunchBrowser();
		const first = await acquireBrowserSession("reuse-closed", {
			launchBrowser: async () => fake.browser as never,
			safetyCheck: safeCheck,
			reusePage: true,
		});
		await first.page.close();

		const second = await acquireBrowserSession("reuse-closed", {
			launchBrowser: async () => fake.browser as never,
			safetyCheck: safeCheck,
			reusePage: true,
		});

		expect(second.page).not.toBe(first.page);
		expect(fake.getPages()).toHaveLength(2);
	});

	it("returns a fresh Page on each call without reusePage", async () => {
		const fake = fakeLaunchBrowser();
		const first = await acquireBrowserSession("no-reuse", {
			launchBrowser: async () => fake.browser as never,
			safetyCheck: safeCheck,
		});
		const second = await acquireBrowserSession("no-reuse", {
			launchBrowser: async () => fake.browser as never,
			safetyCheck: safeCheck,
		});

		expect(first.page).not.toBe(second.page);
		expect(fake.getPages()).toHaveLength(2);
	});

	it("stores the persistent page on the session when reusePage is true", async () => {
		const fake = fakeLaunchBrowser();
		const { page, session } = await acquireBrowserSession("stored-page", {
			launchBrowser: async () => fake.browser as never,
			safetyCheck: safeCheck,
			reusePage: true,
		});

		expect(session.page).toBe(page);
		await destroyBrowserSession("stored-page");
	});
});
