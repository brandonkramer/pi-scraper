/** @file Fingerprint backend response stream tests. */
import { describe, expect, it } from "vitest";

import { materializeBackendResponse } from "../adapter.ts";

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	let index = 0;
	return new ReadableStream({
		pull(controller) {
			if (index < chunks.length) {
				controller.enqueue(chunks[index++]);
			} else {
				controller.close();
			}
		},
	});
}

function streamFromString(text: string): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return streamFromChunks([encoder.encode(text)]);
}

describe("materializeBackendResponse streaming", () => {
	it("consumes a ReadableStream body into text", async () => {
		const result = await materializeBackendResponse(
			"https://example.com/",
			{
				status: 200,
				statusText: "OK",
				headers: { "content-type": "text/html" },
				body: streamFromString("<html>hello</html>"),
			},
			{ method: "GET" },
			1024,
		);

		expect(result.status).toBe(200);
		expect(result.text).toBe("<html>hello</html>");
		expect(result.downloadedBytes).toBe(18);
	});

	it("enforces maxBytes mid-stream and rejects when exceeded", async () => {
		const encoder = new TextEncoder();
		const chunks = [encoder.encode("a".repeat(60)), encoder.encode("b".repeat(60))];
		await expect(
			materializeBackendResponse(
				"https://example.com/",
				{
					status: 200,
					body: streamFromChunks(chunks),
				},
				{ method: "GET" },
				100,
			),
		).rejects.toMatchObject({
			message: expect.stringContaining("exceeded maxBytes"),
		});
	});

	it("falls back to Buffer path when body is a Buffer", async () => {
		const result = await materializeBackendResponse(
			"https://example.com/",
			{
				status: 200,
				headers: { "content-type": "text/plain" },
				body: Buffer.from("buffer-body"),
			},
			{ method: "GET" },
			1024,
		);

		expect(result.text).toBe("buffer-body");
		expect(result.downloadedBytes).toBe(11);
	});

	it("handles an empty ReadableStream body", async () => {
		const result = await materializeBackendResponse(
			"https://example.com/",
			{
				status: 200,
				headers: { "content-type": "text/plain" },
				body: streamFromChunks([]),
			},
			{ method: "GET" },
			1024,
		);

		expect(result.text).toBe("");
		expect(result.downloadedBytes).toBe(0);
	});
});
