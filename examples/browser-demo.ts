import { Runtime } from "../runtime/src/index.js";
import { AutonomousAgent } from "../agent/src/autonomous.js";

async function main() {
  console.log("🌐 Nova Browser Automation Demo\n");
  console.log(
    "This demo shows Nova autonomously browsing the web and extracting information.\n",
  );

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.log("⚠️  Set OPENAI_API_KEY environment variable to run this demo");
    console.log("Example: export OPENAI_API_KEY=sk-...\n");
    process.exit(0);
  }

  // Create runtime with browser tools
  console.log("1️⃣  Creating runtime with browser automation...");
  const runtime = await Runtime.create({
    memoryPath: ":memory:",
    security: {
      sandboxMode: "none",
      allowedTools: [
        "bash",
        "read",
        "write",
        "browser_navigate",
        "browser_screenshot",
        "browser_extract",
        "browser_click",
        "browser_fill",
        "browser_html",
        "browser_close",
      ],
      deniedTools: [],
    },
    executor: {
      maxParallel: 4,
      defaultTimeoutMs: 60000, // Longer timeout for browser operations
    },
  });
  console.log("   ✅ Runtime created with browser tools\n");

  // Create autonomous agent
  console.log("2️⃣  Creating autonomous agent...");
  const agent = new AutonomousAgent(runtime, {
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 2048,
    maxIterations: 10,
    systemPrompt: `You are Nova, an AI agent with browser automation capabilities.

You can navigate websites, extract information, take screenshots, and interact with web pages.

Available browser tools:
- browser_navigate: Navigate to a URL
- browser_extract: Extract text from the page (optionally with CSS selector)
- browser_screenshot: Take a screenshot
- browser_click: Click an element
- browser_fill: Fill a form field
- browser_html: Get page HTML
- browser_close: Close the browser

When given a web-related task, use these tools to accomplish it.
Always close the browser when done.`,
  });
  console.log("   ✅ Agent created (with browser automation)\n");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Task 1: Simple web scraping
  console.log("📋 Task 1: Visit example.com and extract the main heading\n");
  const task1 =
    "Navigate to https://example.com and extract the main heading text. Then close the browser.";

  try {
    const result1 = await agent.execute(task1);
    console.log(`\n✅ Final result: ${result1}\n`);
  } catch (error) {
    console.error(`\n❌ Task failed: ${error}\n`);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Task 2: Screenshot
  console.log("📋 Task 2: Take a screenshot of a website\n");
  const task2 =
    "Navigate to https://noteiq.live and take a screenshot, give a summary of what you see. Then close the browser.";

  agent.reset();

  try {
    const result2 = await agent.execute(task2);
    console.log(`\n✅ Final result: ${result2}\n`);
  } catch (error) {
    console.error(`\n❌ Task failed: ${error}\n`);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Summary
  console.log("🎉 Browser Automation Demo Complete!\n");
  console.log("Nova successfully:");
  console.log("  ✅ Navigated to websites");
  console.log("  ✅ Extracted web content");
  console.log("  ✅ Took screenshots");
  console.log("  ✅ Managed browser lifecycle");
  console.log("\n🌐 Nova can now browse the web autonomously!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Shutdown
  await runtime.shutdown();
}

main().catch((error) => {
  console.error("❌ Demo failed:", error);
  process.exit(1);
});
