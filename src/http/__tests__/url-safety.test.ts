/**
 * @fileoverview http __tests__ url-safety.test module.
 */
import { describe, expect, it } from "vitest";
import { assertPublicAddresses, assertSafeUrl, isPrivateOrReservedIp } from "../url-safety.js";

describe("assertSafeUrl", () => {
  it("allows normalized public http and https URLs", () => {
    const result = assertSafeUrl("https://Example.com:443/path/?z=2&a=1#top");
    expect(result.normalizedUrl).toBe("https://example.com/path?a=1&z=2");
  });

  it.each([
    "file:///etc/passwd",
    "ftp://example.com/file",
    "http://localhost/",
    "http://service.internal/",
    "http://printer.local/",
    "http://127.0.0.1/",
    "http://10.0.0.2/",
    "http://172.20.0.1/",
    "http://192.168.1.2/",
    "http://169.254.169.254/",
    "http://[::]/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://[ff02::1]/",
    "http://[2001:db8::1]/",
    "http://[2002::1]/",
  ])("blocks unsafe URL %s", (url) => {
    expect(() => assertSafeUrl(url)).toThrow();
  });

  it("can explicitly allow private addresses for controlled tests", () => {
    expect(assertSafeUrl("http://127.0.0.1/", { allowPrivateNetwork: true }).normalizedUrl).toBe(
      "http://127.0.0.1/",
    );
  });

  it("detects private and reserved IP ranges", () => {
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("100.64.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("224.0.0.1")).toBe(true);
  });

  it.each([
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "00ff::1",
    "100::",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "ff00::1",
    "2001:db8::1",
    "2002::1",
  ])("detects reserved IPv6 address %s", (address) => {
    expect(isPrivateOrReservedIp(address)).toBe(true);
  });

  it("does not treat addresses outside reserved prefixes as private by comment drift", () => {
    expect(isPrivateOrReservedIp("100:1::")).toBe(false);
  });

  it("allows public IPv6 addresses", () => {
    expect(isPrivateOrReservedIp("2606:4700:4700::1111")).toBe(false);
  });

  it("shares address checks with connect-time DNS rebinding mitigation", () => {
    expect(() => assertPublicAddresses(["93.184.216.34"], "https://example.com/")).not.toThrow();
    expect(() => assertPublicAddresses(["93.184.216.34", "10.0.0.1"], "https://example.com/")).toThrow();
  });
});
