/** @file Http **tests** proxy-dispatcher.test module. */
import type { LookupAddress } from "node:dns";
import { createServer, type Socket } from "node:net";

import { request } from "undici";
import { describe, expect, it } from "vitest";

import { createProxyDispatcher, isSupportedProxyScheme } from "../proxy-dispatcher.ts";

type NetServer = ReturnType<typeof createServer>;

type CapturedSocksRequest = {
	addressType: number;
	host: string;
	port: number;
};

type ParsedSocksRequest = {
	capture: CapturedSocksRequest;
	length: number;
};

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
	let resolveValue: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolveValue = resolve;
	});
	return {
		promise,
		resolve(value) {
			resolveValue?.(value);
		},
	};
}

function getStructuredCode(error: unknown): string | undefined {
	if (
		error instanceof Error &&
		"structured" in error &&
		typeof (error as { structured?: unknown }).structured === "object" &&
		(error as { structured: { code?: unknown } }).structured
	) {
		return (error as { structured: { code?: string } }).structured.code;
	}
	return undefined;
}

function listen(server: NetServer): Promise<number> {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address && typeof address === "object") {
				resolve(address.port);
			}
		});
	});
}

function closeServer(server: NetServer): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

async function requestThroughDispatcher(proxyUrl: string): Promise<void> {
	const dispatcher = createProxyDispatcher(proxyUrl, {
		lookupTargetAddresses: async (): Promise<LookupAddress[]> => [
			{ address: "93.184.216.34", family: 4 },
		],
	});
	try {
		const response = await request("http://example.invalid/page", { dispatcher });
		expect(response.statusCode).toBe(200);
		expect(await response.body.text()).toBe("ok");
	} finally {
		await dispatcher.close();
	}
}

async function captureSocks5Connect(): Promise<CapturedSocksRequest> {
	const capture = deferred<CapturedSocksRequest>();
	const server = createServer((socket) => {
		let stage: "greeting" | "connect" | "http" = "greeting";
		let buffer = Buffer.alloc(0);
		socket.on("data", (chunk) => {
			const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			buffer = Buffer.concat([buffer, data]);
			if (stage === "greeting") {
				if (buffer.length < 2) return;
				const methodCount = buffer[1] ?? 0;
				const greetingLength = 2 + methodCount;
				if (buffer.length < greetingLength) return;
				buffer = buffer.subarray(greetingLength);
				stage = "connect";
				socket.write(Buffer.from([0x05, 0x00]));
			}
			if (stage === "connect") {
				const parsed = parseSocks5Request(buffer);
				if (!parsed) return;
				capture.resolve(parsed.capture);
				buffer = buffer.subarray(parsed.length);
				stage = "http";
				socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
			}
			if (stage === "http") {
				writeHttpOk(socket, buffer);
			}
		});
	});
	const port = await listen(server);
	try {
		await requestThroughDispatcher(`socks5://127.0.0.1:${port}`);
		return await capture.promise;
	} finally {
		await closeServer(server);
	}
}

async function captureSocks4Connect(): Promise<CapturedSocksRequest> {
	const capture = deferred<CapturedSocksRequest>();
	const server = createServer((socket) => {
		let stage: "connect" | "http" = "connect";
		let buffer = Buffer.alloc(0);
		socket.on("data", (chunk) => {
			const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			buffer = Buffer.concat([buffer, data]);
			if (stage === "connect") {
				const parsed = parseSocks4Request(buffer);
				if (!parsed) return;
				capture.resolve(parsed.capture);
				buffer = buffer.subarray(parsed.length);
				stage = "http";
				socket.write(Buffer.from([0x00, 0x5a, 0, 0, 0, 0, 0, 0]));
			}
			if (stage === "http") {
				writeHttpOk(socket, buffer);
			}
		});
	});
	const port = await listen(server);
	try {
		await requestThroughDispatcher(`socks4://127.0.0.1:${port}`);
		return await capture.promise;
	} finally {
		await closeServer(server);
	}
}

function parseSocks5Request(buffer: Buffer): ParsedSocksRequest | undefined {
	if (buffer.length < 4) return undefined;
	const addressType = buffer[3] ?? 0;
	let offset = 4;
	let host: string;
	if (addressType === 0x01) {
		if (buffer.length < offset + 4 + 2) return undefined;
		host = [...buffer.subarray(offset, offset + 4)].join(".");
		offset += 4;
	} else if (addressType === 0x03) {
		const length = buffer[offset] ?? 0;
		if (buffer.length < offset + 1 + length + 2) return undefined;
		offset += 1;
		host = buffer.subarray(offset, offset + length).toString("utf8");
		offset += length;
	} else if (addressType === 0x04) {
		if (buffer.length < offset + 16 + 2) return undefined;
		host = ipv6String(buffer.subarray(offset, offset + 16));
		offset += 16;
	} else {
		throw new Error(`Unexpected SOCKS5 address type: ${addressType}`);
	}
	const port = buffer.readUInt16BE(offset);
	return { capture: { addressType, host, port }, length: offset + 2 };
}

function parseSocks4Request(buffer: Buffer): ParsedSocksRequest | undefined {
	if (buffer.length < 9) return undefined;
	const userIdEnd = buffer.indexOf(0x00, 8);
	if (userIdEnd === -1) return undefined;
	const port = buffer.readUInt16BE(2);
	const host = [...buffer.subarray(4, 8)].join(".");
	return { capture: { addressType: 0x01, host, port }, length: userIdEnd + 1 };
}

function writeHttpOk(socket: Socket, buffer: Buffer): void {
	if (buffer.indexOf("\r\n\r\n") === -1) {
		return;
	}
	socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
}

function ipv6String(buffer: Buffer): string {
	const parts: string[] = [];
	for (let offset = 0; offset < buffer.length; offset += 2) {
		parts.push(buffer.readUInt16BE(offset).toString(16));
	}
	return parts.join(":");
}

describe("isSupportedProxyScheme", () => {
	it("returns true for http://", () => {
		expect(isSupportedProxyScheme("http://127.0.0.1:8080")).toBe(true);
	});
	it("returns true for https://", () => {
		expect(isSupportedProxyScheme("https://127.0.0.1:8080")).toBe(true);
	});
	it("returns true for socks5://", () => {
		expect(isSupportedProxyScheme("socks5://127.0.0.1:1080")).toBe(true);
	});
	it("returns true for socks://", () => {
		expect(isSupportedProxyScheme("socks://127.0.0.1:1080")).toBe(true);
	});
	it("returns true for socks4://", () => {
		expect(isSupportedProxyScheme("socks4://127.0.0.1:1080")).toBe(true);
	});
	it("returns false for socks5h://", () => {
		expect(isSupportedProxyScheme("socks5h://127.0.0.1:1080")).toBe(false);
	});
	it("returns false for socks4a://", () => {
		expect(isSupportedProxyScheme("socks4a://127.0.0.1:1080")).toBe(false);
	});
	it("returns false for ftp://", () => {
		expect(isSupportedProxyScheme("ftp://127.0.0.1:21")).toBe(false);
	});
	it("returns false for malformed URL", () => {
		expect(isSupportedProxyScheme("not-a-url")).toBe(false);
	});
});

describe("createProxyDispatcher", () => {
	it("returns ProxyAgent for http://", () => {
		const dispatcher = createProxyDispatcher("http://127.0.0.1:8080");
		expect(dispatcher).toBeDefined();
		expect(typeof dispatcher.dispatch).toBe("function");
	});
	it("returns ProxyAgent for https://", () => {
		const dispatcher = createProxyDispatcher("https://127.0.0.1:8080");
		expect(dispatcher).toBeDefined();
		expect(typeof dispatcher.dispatch).toBe("function");
	});
	it("returns local-DNS SOCKS dispatcher for socks5://", () => {
		const dispatcher = createProxyDispatcher("socks5://127.0.0.1:1080");
		expect(dispatcher).toBeDefined();
		expect(typeof dispatcher.dispatch).toBe("function");
	});
	it("returns local-DNS SOCKS dispatcher for socks://", () => {
		const dispatcher = createProxyDispatcher("socks://127.0.0.1:1080");
		expect(dispatcher).toBeDefined();
		expect(typeof dispatcher.dispatch).toBe("function");
	});
	it("returns local-DNS SOCKS dispatcher for socks4://", () => {
		const dispatcher = createProxyDispatcher("socks4://127.0.0.1:1080");
		expect(dispatcher).toBeDefined();
		expect(typeof dispatcher.dispatch).toBe("function");
	});
	it("resolves socks5:// target hostnames locally before CONNECT", async () => {
		const capture = await captureSocks5Connect();
		expect(capture).toEqual({ addressType: 0x01, host: "93.184.216.34", port: 80 });
	});
	it("resolves socks4:// target hostnames locally before CONNECT", async () => {
		const capture = await captureSocks4Connect();
		expect(capture).toEqual({ addressType: 0x01, host: "93.184.216.34", port: 80 });
	});
	it("throws UNSUPPORTED_PROXY_SCHEME for socks5h://", () => {
		expect(() => createProxyDispatcher("socks5h://127.0.0.1:1080")).toThrow(
			"Unsupported proxy scheme",
		);
		const code = getStructuredCode(
			(() => {
				try {
					createProxyDispatcher("socks5h://127.0.0.1:1080");
				} catch (e) {
					return e;
				}
			})(),
		);
		expect(code).toBe("UNSUPPORTED_PROXY_SCHEME");
	});
	it("throws UNSUPPORTED_PROXY_SCHEME for socks4a://", () => {
		expect(() => createProxyDispatcher("socks4a://127.0.0.1:1080")).toThrow(
			"Unsupported proxy scheme",
		);
		const code = getStructuredCode(
			(() => {
				try {
					createProxyDispatcher("socks4a://127.0.0.1:1080");
				} catch (e) {
					return e;
				}
			})(),
		);
		expect(code).toBe("UNSUPPORTED_PROXY_SCHEME");
	});
	it("throws INVALID_PROXY_URL for malformed URL", () => {
		expect(() => createProxyDispatcher("not-a-url")).toThrow("Could not parse proxy URL");
		const code = getStructuredCode(
			(() => {
				try {
					createProxyDispatcher("not-a-url");
				} catch (e) {
					return e;
				}
			})(),
		);
		expect(code).toBe("INVALID_PROXY_URL");
	});
	it("throws UNSUPPORTED_PROXY_SCHEME for unknown scheme", () => {
		expect(() => createProxyDispatcher("ftp://127.0.0.1:21")).toThrow("Unsupported proxy scheme");
		const code = getStructuredCode(
			(() => {
				try {
					createProxyDispatcher("ftp://127.0.0.1:21");
				} catch (e) {
					return e;
				}
			})(),
		);
		expect(code).toBe("UNSUPPORTED_PROXY_SCHEME");
	});
});
