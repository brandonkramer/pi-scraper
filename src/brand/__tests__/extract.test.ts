import { describe, expect, it } from "vitest";
import { extractBrandIdentity } from "../extract.js";

describe("extractBrandIdentity", () => {
  it("extracts static brand colors, fonts, assets, social metadata, and schema", () => {
    const html = `<!doctype html><html><head>
      <title>Acme</title><meta name="description" content="Build rockets">
      <meta name="theme-color" content="#ff6600"><meta property="og:title" content="Acme OG">
      <meta property="og:image" content="/og.png"><meta name="twitter:image" content="/tw.png">
      <link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple.png">
      <link rel="manifest" href="/site.webmanifest">
      <style>:root{--brand:#ff6600} body{color:#112233;font-family: Inter, Arial, sans-serif}</style>
      <script type="application/ld+json">{"@type":"Organization","name":"Acme Inc","url":"https://example.com","logo":"https://example.com/logo.svg","sameAs":["https://x.example/acme"]}</script>
    </head><body><img class="site-logo" alt="Acme logo" src="/logo.svg"><h1>Hi</h1></body></html>`;

    const brand = extractBrandIdentity(html, "https://example.com/", {
      manifestJson: JSON.stringify({ name: "Acme App", theme_color: "#0055ff", background_color: "#ffffff", icons: [{ src: "/icon-512.png", type: "image/png" }] }),
    });
    expect(brand.name).toBe("Acme Inc");
    expect(brand.description).toBe("Build rockets");
    expect(brand.themeColors).toEqual(["#ff6600", "#0055ff", "#ffffff"]);
    expect(brand.colors.map((item) => item.value)).toContain("#ff6600");
    expect(brand.fonts.map((item) => item.value)).toContain("Inter");
    expect(brand.assets.map((asset) => asset.url)).toEqual(expect.arrayContaining([
      "https://example.com/favicon.ico",
      "https://example.com/apple.png",
      "https://example.com/site.webmanifest",
      "https://example.com/logo.svg",
      "https://example.com/og.png",
      "https://example.com/icon-512.png",
    ]));
    expect(brand.openGraph.title).toBe("Acme OG");
    expect(brand.schema[0]?.type).toBe("Organization");
  });
});
