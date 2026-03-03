import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { scrape } from "../../runtime/src/web-agent/scrape-tool.js";

function fakeResponse(html: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Not Found",
    text: () => Promise.resolve(html),
    headers: new Headers(),
  } as unknown as Response;
}

const ARTICLE_HTML = `<!DOCTYPE html>
<html><head><title>Test Article</title></head>
<body>
  <article>
    <h1>Test Article</h1>
    <p>By Test Author</p>
    <p>This is the main content of the article. It has enough text to be recognized as a real article by the readability parser. The content needs to be substantial enough for the algorithm to work properly and extract it as the main readable content of the page.</p>
    <p>Additional paragraph with more content to ensure the readability parser has enough material to work with. This second paragraph adds depth to the article and helps establish it as genuine content rather than boilerplate text.</p>
    <p>A third paragraph providing even more context and substance to the article. The readability algorithm needs a critical mass of content to properly identify the main article body.</p>
  </article>
</body></html>`;

const MINIMAL_HTML = `<!DOCTYPE html>
<html><head><title>Minimal Page</title></head>
<body>
  <nav>Navigation</nav>
  <div>Some content</div>
  <footer>Footer</footer>
</body></html>`;

describe("scrape", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("extracts article content via Readability", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse(ARTICLE_HTML));

    const result = await scrape("https://example.com/article");
    expect(result.url).toBe("https://example.com/article");
    expect(result.title).toBeTruthy();
    expect(result.content).toBeTruthy();
    expect(result.word_count).toBeGreaterThan(0);
  });

  it("falls back to raw text for non-article pages", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse(MINIMAL_HTML));

    const result = await scrape("https://example.com/page");
    expect(result.content).toBeTruthy();
    expect(result.title).toBe("Minimal Page");
  });

  it("adds https:// when missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse(MINIMAL_HTML));

    const result = await scrape("example.com");
    expect(result.url).toBe("https://example.com");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.anything(),
    );
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse("", false, 404));

    await expect(scrape("https://example.com/404")).rejects.toThrow("HTTP 404");
  });
});
