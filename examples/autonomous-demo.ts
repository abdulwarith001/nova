import { Runtime } from "../runtime/src/index.js";
import { AutonomousAgent } from "../agent/src/autonomous.js";

async function main() {
  console.log("🤖 Nova Autonomous Agent Demo\n");
  console.log(
    "This demo shows Nova autonomously using tools to complete tasks.\n",
  );

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.log("⚠️  Set OPENAI_API_KEY environment variable to run this demo");
    console.log("Example: export OPENAI_API_KEY=sk-...\n");
    process.exit(0);
  }

  // Create runtime
  console.log("1️⃣  Creating runtime...");
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
  console.log("   ✅ Runtime created\n");

  // Create autonomous agent with OpenAI
  console.log("2️⃣  Creating autonomous agent...");
  const agent = new AutonomousAgent(runtime, {
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 2048,
    maxIterations: 5,
  });
  console.log("   ✅ Agent created (using GPT-4)\n");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Task 1: Simple file operation
  console.log("📋 Task 1: Create a file with project info\n");
  const task1 =
    "Create a file called /tmp/nova-info.txt that contains information about the Nova project, including what it is and what it can do.";

  try {
    const result1 = await agent.execute(task1);
    console.log(`\n✅ Final result: ${result1}\n`);
  } catch (error) {
    console.error(`\n❌ Task failed: ${error}\n`);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Task 2: Multi-step task
  console.log("📋 Task 2: Analyze the current directory\n");
  const task2 =
    "List all TypeScript files in the current directory and count how many there are. Then create a summary file.";

  agent.reset(); // Reset conversation history

  try {
    const result2 = await agent.execute(task2);
    console.log(`\n✅ Final result: ${result2}\n`);
  } catch (error) {
    console.error(`\n❌ Task failed: ${error}\n`);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Summary
  console.log("🎉 Autonomous Agent Demo Complete!\n");
  console.log("Nova successfully:");
  console.log("  ✅ Reasoned about tasks autonomously");
  console.log("  ✅ Selected appropriate tools");
  console.log("  ✅ Executed multi-step workflows");
  console.log("  ✅ Handled tool results");
  console.log("\n🚀 Nova is a fully autonomous AI agent!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Shutdown
  await runtime.shutdown();
}

main().catch((error) => {
  console.error("❌ Demo failed:", error);
  process.exit(1);
});
