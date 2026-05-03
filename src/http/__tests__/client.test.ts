import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";
import { createHttpClient, HttpClientError } from "../client.js";

let agents: MockAgent[] = [];

afterEach(async () => {
  await Promise.all(agents.map((agent) => agent.close()));
  agents = [];
});

function mockClient(retryAttempts = 1): { agent: MockAgent; client: ReturnType<typeof createHttpClient> } {
  const agent = new MockAgent();
  agent.disableNetConnect();
  agents.push(agent);
  return {
    agent,
    client: createHttpClient({ dispatcher: agent, resolveDns: false, retryAttempts }),
  };
}

function allowRobots(agent: MockAgent, origin: string): void {
  agent.get(origin).intercept({ path: "/robots.txt" }).reply(404, "");
}

describe("HttpClient", () => {
  it("fetches bounded text responses through guarded URLs", async () => {
    const { agent, client } = mockClient();
    allowRobots(agent, "https://example.com");
    agent.get("https://example.com").intercept({ path: "/page?a=1&b=2" }).reply(200, "hello", {
      headers: { "content-type": "text/plain", "content-length": "5" },
    });

    const result = await client.fetchUrl("https://EXAMPLE.com/page?b=2&a=1&utm_source=x");
    expect(result.url).toBe("https://example.com/page?a=1&b=2");
    expect(result.finalUrl).toBe("https://example.com/page?a=1&b=2");
    expect(result.status).toBe(200);
    expect(result.text).toBe("hello");
    expect(result.downloadedBytes).toBe(5);
  });

  it("rejects when robots.txt disallows the URL by default", async () => {
    const { agent, client } = mockClient();
    agent.get("https://example.com").intercept({ path: "/robots.txt" }).reply(
      200,
      "User-agent: *\nDisallow: /private",
      { headers: { "content-type": "text/plain" } },
    );

    await expect(client.fetchUrl("https://example.com/private/page")).rejects.toMatchObject({
      structured: { code: "ROBOTS_DENIED", phase: "robots" },
    });
  });

  it("allows explicitly disabling robots checks", async () => {
    const { agent, client } = mockClient();
    agent.get("https://example.com").intercept({ path: "/private/page" }).reply(200, "ok", {
      headers: { "content-type": "text/plain" },
    });

    await expect(client.fetchUrl("https://example.com/private/page", { respectRobots: false })).resolves.toMatchObject({
      text: "ok",
    });
  });

  it("enforces content-length maxBytes before allocation", async () => {
    const { agent, client } = mockClient();
    allowRobots(agent, "https://example.com");
    agent.get("https://example.com").intercept({ path: "/large" }).reply(200, "too large", {
      headers: { "content-type": "text/plain", "content-length": "9" },
    });

    await expect(client.fetchUrl("https://example.com/large", { maxBytes: 4 })).rejects.toMatchObject({
      structured: { code: "MAX_BYTES_EXCEEDED", phase: "download" },
    });
  });

  it("retries retryable status responses", async () => {
    const { agent, client } = mockClient(2);
    allowRobots(agent, "https://example.com");
    agent.get("https://example.com").intercept({ path: "/flaky" }).reply(503, "try again", {
      headers: { "content-type": "text/plain", "retry-after": "0" },
    });
    agent.get("https://example.com").intercept({ path: "/flaky" }).reply(200, "ok", {
      headers: { "content-type": "text/plain" },
    });

    await expect(client.fetchUrl("https://example.com/flaky")).resolves.toMatchObject({ status: 200, text: "ok" });
  });

  it("propagates pre-aborted cancellation", async () => {
    const { client } = mockClient();
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(client.fetchUrl("https://example.com/cancel", {}, controller.signal)).rejects.toMatchObject({
      structured: { code: "ABORTED", phase: "fetch" },
    });
  });

  it("streams binary responses to safe temp files", async () => {
    const { agent, client } = mockClient();
    allowRobots(agent, "https://example.com");
    agent.get("https://example.com").intercept({ path: "/image" }).reply(200, Buffer.from([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    });

    const result = await client.fetchUrl("https://example.com/image");
    expect(result.file?.downloadedBytes).toBe(3);
    expect(result.file?.contentType).toBe("image/png");
    await expect(readFile(result.file?.path ?? "")).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it("wraps blocked URLs as safety errors before HTTP I/O", async () => {
    const { client } = mockClient();
    await expect(client.fetchUrl("http://127.0.0.1/")).rejects.toMatchObject({
      structured: { code: "PRIVATE_NETWORK_ADDRESS", phase: "url_safety" },
    });
  });

  it("follows same-origin redirects and reports normalized original url plus finalUrl", async () => {
    const { agent, client } = mockClient();
    allowRobots(agent, "https://example.com");
    agent.get("https://example.com").intercept({ path: "/start" }).reply(302, "", {
      headers: { location: "/final" },
    });
    agent.get("https://example.com").intercept({ path: "/final" }).reply(200, "done", {
      headers: { "content-type": "text/plain" },
    });

    await expect(client.fetchUrl("https://EXAMPLE.com/start?utm_source=x#top")).resolves.toMatchObject({
      url: "https://example.com/start",
      finalUrl: "https://example.com/final",
      text: "done",
    });
  });

  it("follows cross-origin redirects when the target is safe and robots-allowed", async () => {
    const { agent, client } = mockClient();
    allowRobots(agent, "https://example.com");
    allowRobots(agent, "https://docs.example");
    agent.get("https://example.com").intercept({ path: "/start" }).reply(301, "", {
      headers: { location: "https://docs.example/final" },
    });
    agent.get("https://docs.example").intercept({ path: "/final" }).reply(200, "docs", {
      headers: { "content-type": "text/plain" },
    });

    await expect(client.fetchUrl("https://example.com/start")).resolves.toMatchObject({
      url: "https://example.com/start",
      finalUrl: "https://docs.example/final",
      text: "docs",
    });
  });

  it("blocks redirects to private-network targets before requesting them", async () => {
    const { agent, client } = mockClient();
    allowRobots(agent, "https://example.com");
    agent.get("https://example.com").intercept({ path: "/start" }).reply(302, "", {
      headers: { location: "http://127.0.0.1/private" },
    });

    await expect(client.fetchUrl("https://example.com/start")).rejects.toMatchObject({
      structured: { code: "PRIVATE_NETWORK_ADDRESS", phase: "url_safety" },
    });
  });

  it("fails safely on redirect loops", async () => {
    const { agent, client } = mockClient();
    allowRobots(agent, "https://example.com");
    agent.get("https://example.com").intercept({ path: "/a" }).reply(302, "", { headers: { location: "/b" } });
    agent.get("https://example.com").intercept({ path: "/b" }).reply(302, "", { headers: { location: "/a" } });

    await expect(client.fetchUrl("https://example.com/a")).rejects.toMatchObject({
      structured: { code: "REDIRECT_LOOP", phase: "redirect" },
    });
  });

  it("fetches robots outside normal host slots to avoid same-host starvation", async () => {
    const { agent, client } = mockClient();
    agent.get("https://example.com").intercept({ path: "/robots.txt" }).reply(404, "");
    for (const path of ["/one", "/two", "/three"]) {
      agent.get("https://example.com").intercept({ path }).reply(200, path, {
        headers: { "content-type": "text/plain" },
      });
    }

    const results = await Promise.all([
      client.fetchUrl("https://example.com/one"),
      client.fetchUrl("https://example.com/two"),
      client.fetchUrl("https://example.com/three"),
    ]);
    expect(results.map((result) => result.text)).toEqual(["/one", "/two", "/three"]);
  });

  it("handles crawl-like same-host pressure with slow robots and default per-host limits", async () => {
    let activePages = 0;
    let maxActivePages = 0;
    let robotsHits = 0;
    const server = createServer((request, response) => {
      if (request.url === "/robots.txt") {
        robotsHits += 1;
        setTimeout(() => {
          response.writeHead(200, { "content-type": "text/plain" });
          response.end("User-agent: *\nAllow: /");
        }, 25);
        return;
      }

      activePages += 1;
      maxActivePages = Math.max(maxActivePages, activePages);
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end(request.url ?? "");
        activePages -= 1;
      }, 10);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const client = createHttpClient({ allowPrivateNetwork: true });
    try {
      const paths = Array.from({ length: 8 }, (_, index) => `/page-${index}`);
      const results = await Promise.all(paths.map((path) => client.fetchUrl(`http://127.0.0.1:${port}${path}`)));
      expect(results.map((result) => result.text)).toEqual(paths);
      expect(robotsHits).toBe(1);
      expect(maxActivePages).toBeLessThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("decodes common legacy charset aliases", async () => {
    const { agent, client } = mockClient();
    allowRobots(agent, "https://example.com");
    agent.get("https://example.com").intercept({ path: "/latin1" }).reply(200, Buffer.from([0x63, 0x61, 0x66, 0xe9]), {
      headers: { "content-type": "text/plain; charset=iso-8859-1" },
    });
    agent.get("https://example.com").intercept({ path: "/win1252" }).reply(200, Buffer.from([0x93, 0x68, 0x69, 0x94]), {
      headers: { "content-type": "text/plain; charset=windows-1252" },
    });

    await expect(client.fetchUrl("https://example.com/latin1")).resolves.toMatchObject({ text: "café" });
    await expect(client.fetchUrl("https://example.com/win1252")).resolves.toMatchObject({ text: "“hi”" });
  });
});

expect.addSnapshotSerializer({
  serialize: (value) => String(value),
  test: (value) => value instanceof HttpClientError,
});
