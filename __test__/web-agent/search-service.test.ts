import { describe, expect, it } from "vitest";
import { SearchService } from "../../runtime/src/web-agent/search-service.js";

describe("SearchService helpers", () => {
  const service = new SearchService();

  describe("stripHtml", () => {
    it("removes HTML tags", () => {
      expect((service as any).stripHtml("<b>bold</b> text")).toBe("bold text");
    });

    it("decodes entities", () => {
      expect((service as any).stripHtml("A &amp; B")).toBe("A & B");
    });

    it("collapses whitespace", () => {
      expect((service as any).stripHtml("  a   b  ")).toBe("a b");
    });

    it("handles empty input", () => {
      expect((service as any).stripHtml("")).toBe("");
    });
  });

  describe("decode", () => {
    it("decodes &amp;", () => {
      expect((service as any).decode("A &amp; B")).toBe("A & B");
    });

    it("decodes &quot;", () => {
      expect((service as any).decode("&quot;hello&quot;")).toBe('"hello"');
    });

    it("decodes &#39;", () => {
      expect((service as any).decode("it&#39;s")).toBe("it's");
    });

    it("decodes &lt; and &gt;", () => {
      expect((service as any).decode("&lt;div&gt;")).toBe("<div>");
    });
  });

  describe("normalizeSearchUrl", () => {
    it("returns clean URL unchanged", () => {
      expect((service as any).normalizeSearchUrl("https://a.com/page")).toBe(
        "https://a.com/page",
      );
    });

    it("extracts DuckDuckGo redirect (uddg param)", () => {
      const ddg =
        "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=abc";
      expect((service as any).normalizeSearchUrl(ddg)).toBe(
        "https://example.com/page",
      );
    });

    it("handles empty input", () => {
      expect((service as any).normalizeSearchUrl("")).toBe("");
    });
  });

  describe("rerankAndNormalize", () => {
    it("ranks by token match + engine boost", () => {
      const input = [
        {
          title: "AI News Today",
          url: "https://a.com",
          snippet: "Latest AI breakthroughs",
          engine: "brave_api",
        },
        {
          title: "Cooking Tips",
          url: "https://b.com",
          snippet: "Best recipes",
          engine: "ddg_html",
        },
      ];
      const result = (service as any).rerankAndNormalize("AI news", input);
      expect(result).toHaveLength(2);
      expect(result[0].url).toBe("https://a.com");
      expect(result[0].rank).toBe(1);
      expect(result[1].rank).toBe(2);
    });

    it("deduplicates URLs", () => {
      const input = [
        {
          title: "A",
          url: "https://a.com?utm_source=x",
          snippet: "first",
          engine: "ddg_html",
        },
        {
          title: "A dup",
          url: "https://a.com",
          snippet: "duplicate",
          engine: "ddg_html",
        },
      ];
      const result = (service as any).rerankAndNormalize("test", input);
      expect(result).toHaveLength(1);
    });

    it("filters non-HTTP URLs", () => {
      const input = [
        {
          title: "Bad",
          url: "ftp://bad.com",
          snippet: "bad",
          engine: "ddg_html",
        },
      ];
      const result = (service as any).rerankAndNormalize("test", input);
      expect(result).toHaveLength(0);
    });
  });
});
