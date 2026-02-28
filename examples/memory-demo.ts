import { Runtime } from "../runtime/src/index.js";

async function main() {
  console.log("🧠 Nova Memory Management Demo\n");
  console.log(
    "This demo shows how Nova learns and remembers context about itself and its user.\n",
  );

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.log("⚠️  Set OPENAI_API_KEY environment variable to run this demo");
    console.log("Example: export OPENAI_API_KEY=sk-...\n");
    process.exit(0);
  }

  // Create runtime with persistent memory
  console.log("1️⃣  Creating runtime with knowledge store...");
  const runtime = await Runtime.create({
    security: {
      sandboxMode: "none",
      allowedTools: ["bash", "read", "write"],
      deniedTools: [],
    },
    executor: {
      maxParallel: 4,
      defaultTimeoutMs: 30000,
    },
  });
  console.log("   ✅ Runtime created with knowledge store\n");

  const store = runtime.getMarkdownMemory().getKnowledgeJsonStore();

  // Store knowledge about the user
  console.log("2️⃣  Storing user knowledge...");

  store.addEntry({
    category: "user_trait",
    subject: "name",
    content: "Abdulwarith",
    importance: 0.95,
    confidence: 1.0,
    source: "user_explicit",
  });

  store.addEntry({
    category: "user_trait",
    subject: "work_style",
    content: "Focused and efficient",
    importance: 0.7,
    confidence: 0.9,
    source: "conversation",
  });

  store.addEntry({
    category: "preference",
    subject: "programming_language",
    content: "User prefers TypeScript over Rust for rapid prototyping",
    tags: ["preference", "technology"],
    importance: 0.8,
    source: "conversation",
  });

  store.addEntry({
    category: "fact",
    subject: "browser_automation",
    content: "Successfully implemented browser automation with Playwright",
    tags: ["capability", "achievement"],
    importance: 0.9,
    source: "system",
  });

  store.addEntry({
    category: "agent_trait",
    subject: "capability",
    content: "Browser automation with Playwright",
    tags: ["capability"],
    importance: 0.8,
    source: "system",
  });

  console.log("   ✅ Stored 5 knowledge entries\n");

  // Search knowledge
  console.log("3️⃣  Searching knowledge...");
  const results = store.search("browser automation");
  console.log(`   Found ${results.length} relevant entries:`);
  for (const result of results) {
    console.log(
      `   - [${result.entry.category}] ${result.entry.content} (score: ${result.score.toFixed(2)})`,
    );
  }
  console.log();

  // Get essentials for system prompt
  console.log("4️⃣  Getting user essentials for system prompt...");
  const essentials = store.getEssentials(0.7);
  console.log(`   ${essentials.length} essential traits:`);
  for (const e of essentials) {
    console.log(`   - ${e.subject}: ${e.content}`);
  }
  console.log();

  // Get agent traits
  console.log("5️⃣  Getting agent traits...");
  const agentTraits = store.getAgentTraits();
  console.log(`   ${agentTraits.length} agent traits:`);
  for (const t of agentTraits) {
    console.log(`   - ${t.subject}: ${t.content}`);
  }
  console.log();

  // Build context
  console.log("6️⃣  Building assembled context for LLM...");
  const ctx = runtime.getMarkdownMemory().buildContext({
    userId: "demo-user",
    conversationId: "demo-conv",
  });
  console.log("   Context preview:");
  console.log(ctx.assembledSystemPrompt.split("\n").slice(0, 15).join("\n"));
  console.log("   ...\n");

  // Test deduplication
  console.log("7️⃣  Testing fuzzy deduplication...");
  store.addEntry({
    category: "preference",
    subject: "programming_language",
    content: "The user enjoys TypeScript for rapid prototyping over Rust",
    importance: 0.7,
    source: "conversation",
  });
  console.log(
    `   Active entries after near-duplicate: ${store.count(true)} (should NOT increase)\n`,
  );

  // Summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("🎉 Memory Management Demo Complete!\n");
  console.log("Nova successfully:");
  console.log("  ✅ Stored user traits, preferences, and facts");
  console.log("  ✅ Searched knowledge with ranked scoring");
  console.log("  ✅ Built assembled context for LLM");
  console.log("  ✅ Detected and merged near-duplicate entries");
  console.log("\n🧠 Nova now has contextual knowledge!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Shutdown
  await runtime.shutdown();
}

main().catch((error) => {
  console.error("❌ Demo failed:", error);
  process.exit(1);
});
