import { afterEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";
import { getFingerprintFetchAdapter, UnsupportedFingerprintOptionError } from "../fingerprint.js";

const agents: MockAgent[] = [];

afterEach(async () => {
  await Promise.all(agents.map((agent) => agent.close()));
  agents.length = 0;
});

describe("fingerprint adapter", () => {
  it("exposes a pooled static adapter boundary without Playwright", async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    agents.push(agent);
    agent.get("https://example.com").intercept({ path: "/robots.txt" }).reply(404, "");
    agent.get("https://example.com").intercept({ path: "/" }).reply(200, "fingerprint", {
      headers: { "content-type": "text/plain" },
    });

    const adapter = getFingerprintFetchAdapter(
      { browserProfile: "chrome", osProfile: "mac" },
      { dispatcher: agent, resolveDns: false },
    );
    expect(getFingerprintFetchAdapter({ browserProfile: "chrome", osProfile: "mac" })).toBe(adapter);

    await expect(adapter.fetch("https://example.com/")).resolves.toMatchObject({ text: "fingerprint" });
  });

  it("rejects proxy options explicitly until a proxy-capable backend exists", async () => {
    const adapter = getFingerprintFetchAdapter({ browserProfile: "no-proxy", osProfile: "test" });

    expect(() => getFingerprintFetchAdapter({ proxy: "http://proxy.example" })).toThrow(UnsupportedFingerprintOptionError);
    await expect(adapter.fetch("https://example.com/", { proxy: "http://proxy.example" })).rejects.toMatchObject({
      structured: { code: "UNSUPPORTED_FINGERPRINT_OPTION", phase: "fingerprint" },
    });
  });

  it("uses browser-like headers but does not claim full TLS/proxy emulation", async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    agents.push(agent);
    agent.get("https://headers.example").intercept({ path: "/robots.txt" }).reply(404, "");
    agent.get("https://headers.example").intercept({
      path: "/",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    }).reply(200, "headers", { headers: { "content-type": "text/plain" } });

    const adapter = getFingerprintFetchAdapter(
      { browserProfile: "baseline-docs", osProfile: "test" },
      { dispatcher: agent, resolveDns: false },
    );
    await expect(adapter.fetch("https://headers.example/")).resolves.toMatchObject({ text: "headers" });
  });
});
