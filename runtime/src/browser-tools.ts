import { chromium, Browser, Page } from "playwright";

let browser: Browser | null = null;
let currentPage: Page | null = null;

/**
 * Browser automation tools using Playwright
 */

interface BrowserToolExecution {
  toolName: string;
  parameters: Record<string, unknown>;
}

/**
 * Initialize browser if not already running
 */
async function ensureBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
    });
  }
  return browser;
}

/**
 * Get or create a page
 */
async function ensurePage(): Promise<Page> {
  const browserInstance = await ensureBrowser();

  if (!currentPage || currentPage.isClosed()) {
    currentPage = await browserInstance.newPage();

    // Set default timeout
    currentPage.setDefaultTimeout(60000); // 60 seconds
    currentPage.setDefaultNavigationTimeout(60000);
  }

  return currentPage;
}

/**
 * Navigate to a URL with retry logic
 */
async function navigateTo(
  params: Record<string, unknown>,
): Promise<{ url: string; title: string }> {
  const url = params.url as string;
  const maxRetries = (params.maxRetries as number) || 2;

  if (!url) {
    throw new Error("Missing url parameter");
  }

  const page = await ensurePage();
  let lastError: Error | null = null;

  // Try with different wait strategies
  const waitStrategies = ["networkidle", "domcontentloaded", "load"] as const;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const waitUntil = waitStrategies[i] || "load";
      await page.goto(url, {
        waitUntil,
        timeout: 60000,
      });

      const title = await page.title();
      return { url, title };
    } catch (error) {
      lastError = error as Error;
      console.error(`Navigation attempt ${i + 1} failed:`, error);

      // Wait before retry
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw new Error(
    `Failed to navigate after ${maxRetries} attempts: ${lastError?.message}`,
  );
}

/**
 * Take a screenshot with error handling
 */
async function takeScreenshot(
  params: Record<string, unknown>,
): Promise<{ path: string; success: boolean }> {
  const path = params.path as string;
  if (!path) {
    throw new Error("Missing path parameter");
  }

  try {
    const page = await ensurePage();
    await page.screenshot({
      path,
      fullPage: true,
      timeout: 30000,
    });

    return { path, success: true };
  } catch (error) {
    console.error("Screenshot failed:", error);
    throw new Error(
      `Failed to take screenshot: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Extract text content from page with fallback
 */
async function extractText(
  params: Record<string, unknown>,
): Promise<{ text: string }> {
  const selector = params.selector as string;
  const page = await ensurePage();

  try {
    let text: string;

    if (selector) {
      // Try the provided selector first
      const element = page.locator(selector).first();
      const count = await element.count();

      if (count === 0) {
        // Fallback to common selectors
        console.warn(`Selector "${selector}" not found, trying fallbacks...`);

        const fallbacks = [
          "main",
          "article",
          "#content",
          ".content",
          "[role='main']",
          "body",
        ];

        for (const fallback of fallbacks) {
          const fallbackElement = page.locator(fallback).first();
          const fallbackCount = await fallbackElement.count();

          if (fallbackCount > 0) {
            const fallbackText = (await fallbackElement.textContent()) || "";
            if (fallbackText.trim().length > 0) {
              console.log(`✓ Using fallback selector: ${fallback}`);
              text = fallbackText;
              return { text: text.trim() };
            }
          }
        }

        // No fallback worked, use body
        text = (await page.locator("body").textContent()) || "";
      } else {
        text = (await element.textContent()) || "";
      }
    } else {
      // Extract all text from body
      text = (await page.locator("body").textContent()) || "";
    }

    return { text: text.trim() };
  } catch (error) {
    console.error("Text extraction failed:", error);
    throw new Error(
      `Failed to extract text: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Click an element with retry
 */
async function clickElement(
  params: Record<string, unknown>,
): Promise<{ success: boolean }> {
  const selector = params.selector as string;
  const maxRetries = 3;

  if (!selector) {
    throw new Error("Missing selector parameter");
  }

  const page = await ensurePage();
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.click(selector, { timeout: 10000 });
      return { success: true };
    } catch (error) {
      lastError = error as Error;
      console.error(`Click attempt ${i + 1} failed:`, error);

      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  throw new Error(
    `Failed to click after ${maxRetries} attempts: ${lastError?.message}`,
  );
}

/**
 * Fill a form field with validation
 */
async function fillField(
  params: Record<string, unknown>,
): Promise<{ success: boolean }> {
  const selector = params.selector as string;
  const value = params.value as string;

  if (!selector || value === undefined) {
    throw new Error("Missing selector or value parameter");
  }

  try {
    const page = await ensurePage();

    // Wait for element to be visible
    await page.waitForSelector(selector, { timeout: 10000 });

    // Clear and fill
    await page.fill(selector, value);

    // Verify the value was set
    const actualValue = await page.inputValue(selector);
    if (actualValue !== value) {
      console.warn(`Value mismatch: expected "${value}", got "${actualValue}"`);
    }

    return { success: true };
  } catch (error) {
    console.error("Fill field failed:", error);
    throw new Error(
      `Failed to fill field: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Get page HTML with timeout
 */
async function getHTML(
  params: Record<string, unknown>,
): Promise<{ html: string }> {
  try {
    const page = await ensurePage();
    const html = await page.content();

    return { html };
  } catch (error) {
    console.error("Get HTML failed:", error);
    throw new Error(
      `Failed to get HTML: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Close browser safely
 */
async function closeBrowser(): Promise<{ success: boolean }> {
  try {
    if (currentPage) {
      await currentPage.close();
      currentPage = null;
    }

    if (browser) {
      await browser.close();
      browser = null;
    }

    return { success: true };
  } catch (error) {
    console.error("Browser close failed:", error);
    // Force cleanup
    currentPage = null;
    browser = null;
    return { success: false };
  }
}

/**
 * Main browser tool handler with error handling
 */
export async function executeBrowserTool(
  execution: BrowserToolExecution,
): Promise<unknown> {
  const { toolName, parameters } = execution;

  try {
    switch (toolName) {
      case "browser_navigate":
        return await navigateTo(parameters);
      case "browser_screenshot":
        return await takeScreenshot(parameters);
      case "browser_extract":
        return await extractText(parameters);
      case "browser_click":
        return await clickElement(parameters);
      case "browser_fill":
        return await fillField(parameters);
      case "browser_html":
        return await getHTML(parameters);
      case "browser_close":
        return await closeBrowser();
      default:
        throw new Error(`Unknown browser tool: ${toolName}`);
    }
  } catch (error) {
    // Enhanced error reporting
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : "";

    console.error(`Browser tool error [${toolName}]:`, {
      message: errorMessage,
      parameters,
      stack: errorStack,
    });

    throw new Error(`Browser tool error: ${errorMessage}`);
  }
}
