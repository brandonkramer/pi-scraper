import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../http/client.js";
import { runCrawl } from "../runner.js";

interface ServedSite {
	origin: string;
	hits: Map<string, number>;
	close: () => Promise<void>;
}

describe("runCrawl respectRobots integration", () => {
	it("does not fetch disallowed pages when respectRobots is enabled", async () => {
		const site = await servedRobotsSite();
		try {
			const crawl = await runCrawl(
				site.origin,
				{ maxPages: 3, maxDepth: 1, respectRobots: true },
				{ httpClient: createHttpClient({ allowPrivateNetwork: true }) },
			);

			expect(site.hits.get("/robots.txt")).toBe(1);
			expect(site.hits.get("/allowed")).toBe(1);
			expect(site.hits.get("/private/blocked")).toBeUndefined();
			expect(
				crawl.pages.some((page) => page.error?.code === "ROBOTS_DENIED"),
			).toBe(true);
		} finally {
			await site.close();
		}
	});

	it("fetches disallowed pages only when robots checks are explicitly disabled", async () => {
		const site = await servedRobotsSite();
		try {
			const crawl = await runCrawl(
				site.origin,
				{ maxPages: 3, maxDepth: 1, respectRobots: false },
				{ httpClient: createHttpClient({ allowPrivateNetwork: true }) },
			);

			expect(site.hits.get("/robots.txt")).toBeUndefined();
			expect(site.hits.get("/private/blocked")).toBe(1);
			expect(
				crawl.pages.every((page) => page.error?.code !== "ROBOTS_DENIED"),
			).toBe(true);
		} finally {
			await site.close();
		}
	});
});

async function servedRobotsSite(): Promise<ServedSite> {
	const hits = new Map<string, number>();
	const server = createServer((request, response) =>
		serve(request, response, hits),
	);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		origin: `http://127.0.0.1:${port}/`,
		hits,
		close: () =>
			new Promise((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	};
}

function serve(
	request: IncomingMessage,
	response: ServerResponse,
	hits: Map<string, number>,
): void {
	const pathname = request.url ?? "/";
	hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
	if (pathname === "/robots.txt") {
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("User-agent: *\nDisallow: /private");
		return;
	}
	response.writeHead(200, { "content-type": "text/html" });
	if (pathname === "/") {
		response.end(
			'<main>Seed page</main><a href="/allowed">Allowed</a><a href="/private/blocked">Blocked</a>',
		);
		return;
	}
	response.end(`<main>${pathname}</main>`);
}
