import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  isHttpUrl,
  dedupeCanonicalUrls,
  extractExplicitUrls,
  isBlockedSourceUrl,
} from "../../runtime/src/web-agent/url-utils.js";

describe("canonicalizeUrl", () => {
  it("lowercases protocol and hostname", () => {
    expect(canonicalizeUrl("HTTPS://Example.COM/Page")).toBe(
      "https://example.com/Page",
    );
  });

  it("strips tracking params", () => {
    const url = "https://example.com/page?utm_source=google&keep=1&fbclid=abc";
    expect(canonicalizeUrl(url)).toBe("https://example.com/page?keep=1");
  });

  it("strips hash by default", () => {
    expect(canonicalizeUrl("https://a.com/page#section")).toBe(
      "https://a.com/page",
    );
  });

  it("preserves hash when stripHash=false", () => {
    expect(
      canonicalizeUrl("https://a.com/page#section", { stripHash: false }),
    ).toBe("https://a.com/page#section");
  });

  it("strips default ports (443 for https, 80 for http)", () => {
    expect(canonicalizeUrl("https://a.com:443/page")).toBe(
      "https://a.com/page",
    );
    expect(canonicalizeUrl("http://a.com:80/page")).toBe("http://a.com/page");
  });

  it("keeps non-default ports", () => {
    expect(canonicalizeUrl("https://a.com:8443/page")).toBe(
      "https://a.com:8443/page",
    );
  });

  it("removes trailing slash", () => {
    expect(canonicalizeUrl("https://a.com/")).toBe("https://a.com");
  });

  it("returns original string for malformed URL", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });

  it("handles empty input", () => {
    expect(canonicalizeUrl("")).toBe("");
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("http://a.com")).toBe(true);
    expect(isHttpUrl("https://a.com")).toBe(true);
  });

  it("rejects ftp, empty, relative", () => {
    expect(isHttpUrl("ftp://a.com")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("/page")).toBe(false);
  });
});

describe("dedupeCanonicalUrls", () => {
  it("deduplicates by canonical form", () => {
    const urls = [
      "https://a.com/page?utm_source=x",
      "https://a.com/page",
      "https://b.com",
    ];
    const result = dedupeCanonicalUrls(urls);
    expect(result).toHaveLength(2);
    expect(result).toContain("https://a.com/page");
    expect(result).toContain("https://b.com");
  });

  it("filters non-HTTP URLs", () => {
    expect(dedupeCanonicalUrls(["ftp://a.com", "not-url"])).toEqual([]);
  });

  it("preserves first occurrence order", () => {
    const result = dedupeCanonicalUrls([
      "https://b.com",
      "https://a.com",
      "https://b.com",
    ]);
    expect(result).toEqual(["https://b.com", "https://a.com"]);
  });
});

describe("extractExplicitUrls", () => {
  it("extracts multiple URLs from text", () => {
    const text = "Visit https://a.com and also https://b.com/page for details";
    const result = extractExplicitUrls(text);
    expect(result).toHaveLength(2);
  });

  it("deduplicates extracted URLs", () => {
    const text = "Go to https://a.com and https://a.com again";
    expect(extractExplicitUrls(text)).toHaveLength(1);
  });

  it("handles empty string", () => {
    expect(extractExplicitUrls("")).toEqual([]);
  });
});

describe("isBlockedSourceUrl", () => {
  it("blocks duckduckgo.com", () => {
    expect(isBlockedSourceUrl("https://duckduckgo.com/results")).toBe(true);
    expect(isBlockedSourceUrl("https://html.duckduckgo.com/lite")).toBe(true);
  });

  it("blocks bing.com/search", () => {
    expect(isBlockedSourceUrl("https://www.bing.com/search?q=hello")).toBe(
      true,
    );
  });

  it("blocks example.com", () => {
    expect(isBlockedSourceUrl("https://example.com")).toBe(true);
  });

  it("allows normal domains", () => {
    expect(isBlockedSourceUrl("https://google.com")).toBe(false);
    expect(isBlockedSourceUrl("https://github.com")).toBe(false);
  });

  it("blocks non-HTTP URLs", () => {
    expect(isBlockedSourceUrl("ftp://a.com")).toBe(true);
    expect(isBlockedSourceUrl("not a url")).toBe(true);
  });
});
