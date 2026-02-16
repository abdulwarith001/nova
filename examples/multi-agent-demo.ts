import { Runtime } from "../runtime/src/index.js";
import { AgentOrchestrator } from "../agent/src/multi-agent.js";

async function main() {
  console.log("🎭 Nova Multi-Agent System Demo\n");
  console.log(
    "This demo shows specialized agents working together on complex tasks.\n",
  );

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.log("⚠️  Set OPENAI_API_KEY environment variable to run this demo");
    console.log("Example: export OPENAI_API_KEY=sk-...\n");
    process.exit(0);
  }

  // Create runtime with all tools
  console.log("1️⃣  Creating runtime...");
  const runtime = await Runtime.create({
    memoryPath: ":memory:",
    security: {
      sandboxMode: "none",
      allowedTools: [
        "bash",
        "read",
        "write",
        "browser_navigate",
        "browser_extract",
        "browser_screenshot",
        "browser_click",
        "browser_fill",
        "browser_html",
        "browser_close",
      ],
      deniedTools: [],
    },
    executor: {
      maxParallel: 4,
      defaultTimeoutMs: 60000,
    },
  });
  console.log("   ✅ Runtime created\n");

  // Create multi-agent orchestrator
  console.log("2️⃣  Creating multi-agent orchestrator...");
  const orchestrator = new AgentOrchestrator(runtime, {
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxIterations: 8,
  });
  console.log("   ✅ Orchestrator ready\n");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Task 1: Simple single-agent task (Coder)
  console.log("📋 Task 1: Simple Coding Task\n");
  const task1 =
    "Create a file called /tmp/multi-agent-test.txt with information about multi-agent systems.";

  try {
    const result1 = await orchestrator.executeCollaborative(task1);
    console.log("\n📊 Final Result:");
    console.log(result1.substring(0, 500) + "...\n");
  } catch (error) {
    console.error(`\n❌ Task 1 failed: ${error}\n`);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Task 2: Multi-agent collaboration
  console.log("📋 Task 2: Complex Multi-Agent Task\n");
  const task2 =
    "Research information about TypeScript, analyze its benefits, and create a summary report file.";

  try {
    const result2 = await orchestrator.executeCollaborative(task2);
    console.log("\n📊 Final Result:");
    console.log(result2.substring(0, 500) + "...\n");
  } catch (error) {
    console.error(`\n❌ Task 2 failed: ${error}\n`);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Show statistics
  const stats = orchestrator.getStats();
  console.log("📊 Orchestrator Statistics:");
  console.log(`   Agents: ${stats.agentCount}`);
  console.log(`   Available: ${stats.agents.join(", ")}`);
  console.log(`   Messages: ${stats.messageCount}`);
  console.log(`   Tasks: ${stats.taskCount}\n`);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Summary
  console.log("🎉 Multi-Agent Demo Complete!\n");
  console.log("Nova successfully:");
  console.log(
    "  ✅ Initialized specialized agents (Researcher, Coder, Analyst)",
  );
  console.log("  ✅ Delegated tasks to appropriate agents");
  console.log("  ✅ Coordinated collaborative workflows");
  console.log("  ✅ Synthesized results from multiple agents");
  console.log("\n🎭 Nova now has multi-agent collaboration!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Examples of what you can do
  console.log("💡 Example Tasks for Multi-Agent System:\n");
  console.log("Research Tasks (Researcher Agent):");
  console.log('  - "Research the top 3 JavaScript frameworks"');
  console.log('  - "Find information about AI developments in 2024"\n');

  console.log("Coding Tasks (Coder Agent):");
  console.log('  - "Create a Node.js Express server template"');
  console.log('  - "Write unit tests for a calculator function"\n');

  console.log("Analysis Tasks (Analyst Agent):");
  console.log('  - "Analyze user behavior data and create insights"');
  console.log('  - "Compare performance metrics across services"\n');

  console.log("Complex Multi-Agent Tasks:");
  console.log(
    '  - "Research TypeScript best practices, analyze adoption trends, and create a migration guide"',
  );
  console.log(
    '  - "Find API documentation, implement integration code, and write test suite"\n',
  );

  // Shutdown
  await runtime.shutdown();
}

main().catch((error) => {
  console.error("❌ Demo failed:", error);
  process.exit(1);
});
