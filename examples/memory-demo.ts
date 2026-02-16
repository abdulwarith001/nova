import { Runtime } from "../runtime/src/index.js";
import { AutonomousAgent } from "../agent/src/autonomous.js";

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
  console.log("1️⃣  Creating runtime with memory...");
  const runtime = await Runtime.create({
    memoryPath: "./nova-memory.db", // Persistent database
    security: {
      sandboxMode: "none",
      allowedTools: ["bash", "read", "write"],
    },
    executor: {
      maxParallel: 4,
      defaultTimeoutMs: 30000,
    },
  });
  console.log("   ✅ Runtime created with persistent memory\n");

  const memory = runtime.getMemory();

  // Show initial profiles
  console.log("2️⃣  Initial Agent Profile:");
  const agentProfile = memory.getAgentProfile();
  console.log(`   Version: ${agentProfile.version}`);
  console.log(`   Capabilities: ${agentProfile.capabilities.length}`);
  console.log(`   Limitations: ${agentProfile.limitations.length}\n`);

  console.log("3️⃣  Initial User Profile:");
  const userProfile = memory.getUserProfile();
  console.log(`   Name: ${userProfile.name || "Unknown"}`);
  console.log(`   Goals: ${userProfile.goals.length}`);
  console.log(
    `   Preferences: ${Object.keys(userProfile.preferences).length}\n`,
  );

  // Simulate learning about the user
  console.log("4️⃣  Simulating user interaction...");
  await memory.updateUserProfile({
    name: "Abdulwarith",
    workStyle: "Focused and efficient",
    goals: ["Build autonomous AI agents", "Ship production-ready software"],
  });
  console.log("   ✅ User profile updated\n");

  // Store some memories
  console.log("5️⃣  Storing memories...");

  await memory.store({
    id: `mem-${Date.now()}-1`,
    content: "User prefers TypeScript over Rust for rapid prototyping",
    timestamp: Date.now(),
    importance: 0.8,
    decayRate: 0.05,
    tags: ["preference", "technology"],
    source: "conversation",
    category: "user",
    metadata: { topic: "programming" },
  });

  await memory.store({
    id: `mem-${Date.now()}-2`,
    content: "Successfully implemented browser automation with Playwright",
    timestamp: Date.now(),
    importance: 0.9,
    decayRate: 0.1,
    tags: ["capability", "achievement"],
    source: "task-execution",
    category: "self",
    metadata: { feature: "browser-automation" },
  });

  await memory.store({
    id: `mem-${Date.now()}-3`,
    content: "Completed file operations task in under 3 seconds",
    timestamp: Date.now(),
    importance: 0.7,
    decayRate: 0.1,
    tags: ["task", "performance"],
    source: "execution",
    category: "task",
    metadata: { duration: 2847 },
  });

  console.log("   ✅ Stored 3 memories\n");

  // Search memories
  console.log("6️⃣  Searching memories...");
  const results = await memory.search("browser automation", { limit: 5 });
  console.log(`   Found ${results.length} relevant memories:`);
  for (const result of results) {
    console.log(`   - ${result.content} (${result.category})`);
  }
  console.log();

  // Get recent memories by category
  console.log("7️⃣  Recent user-related memories:");
  const userMemories = await memory.getRecent("user", 3);
  for (const mem of userMemories) {
    console.log(`   - ${mem.content}`);
  }
  console.log();

  // Build context
  console.log("8️⃣  Building context for agent...");
  const context = await memory.buildContext("browser automation");
  console.log("   Context preview:");
  console.log(context.split("\n").slice(0, 15).join("\n"));
  console.log("   ...\n");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Create autonomous agent with memory
  console.log("9️⃣  Creating autonomous agent with memory context...");
  const agent = new AutonomousAgent(runtime, {
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxIterations: 10,
    enableMemoryContext: true, // Enable memory integration
  });
  console.log("   ✅ Agent created with memory enabled\n");

  // Execute a task that benefits from context
  console.log("🔟 Executing task with memory context...");
  const task =
    "Create a summary file about what you know about me and what youve accomplished.";

  try {
    const result = await agent.execute(task);
    console.log(`\n✅ Final result: ${result}\n`);
  } catch (error) {
    console.error(`\n❌ Task failed: ${error}\n`);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Show updated profiles
  console.log("1️⃣1️⃣  Final User Profile:");
  const finalUserProfile = memory.getUserProfile();
  console.log(`   Name: ${finalUserProfile.name}`);
  console.log(`   Work Style: ${finalUserProfile.workStyle}`);
  console.log(`   Goals:`);
  for (const goal of finalUserProfile.goals) {
    console.log(`     - ${goal}`);
  }
  console.log();

  // Summary
  console.log("🎉 Memory Management Demo Complete!\n");
  console.log("Nova successfully:");
  console.log("  ✅ Learned about the user (name, work style, goals)");
  console.log("  ✅ Stored memories in different categories");
  console.log("  ✅ Retrieved relevant context");
  console.log("  ✅ Built context for task execution");
  console.log("  ✅ Executed tasks with memory awareness");
  console.log("\n🧠 Nova now has contextual memory!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Shutdown
  await runtime.shutdown();
}

main().catch((error) => {
  console.error("❌ Demo failed:", error);
  process.exit(1);
});
