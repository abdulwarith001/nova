import { Runtime, Task } from "../runtime/src/index.js";

async function main() {
  console.log("🚀 Nova Runtime Example\n");

  // Create runtime
  console.log("Creating runtime...");
  const runtime = await Runtime.create({
    security: {
      allowedTools: ["bash", "read", "write"],
      deniedTools: [],
    },
    executor: {
      maxParallel: 4,
      defaultTimeoutMs: 30000,
    },
  });

  console.log("✅ Runtime created\n");

  // Create a simple task
  const task: Task = {
    id: "task-1",
    description: "Test task execution",
    toolCalls: [
      {
        toolName: "read",
        parameters: { path: "/tmp/test.txt" },
      },
    ],
  };

  console.log("Executing task:", task.description);
  console.log("Tool calls:", task.toolCalls.length, "\n");

  // Execute task
  try {
    const result = await runtime.execute(task);

    console.log("✅ Task completed successfully!");
    console.log("Duration:", result.durationMs, "ms");
    console.log("Success:", result.success);
    console.log("Outputs:", result.outputs.length);
  } catch (error) {
    console.error("❌ Task failed:", error);
  }

  // Test knowledge store
  console.log("\n📚 Testing knowledge store...");
  const store = runtime.getMarkdownMemory().getKnowledgeJsonStore();

  store.addEntry({
    category: "fact",
    subject: "test",
    content: "This is a test knowledge entry",
    tags: ["test", "example"],
    importance: 0.8,
  });

  console.log("✅ Knowledge stored");

  const results = store.search("test");
  console.log("Search results:", results.length);
  if (results.length > 0) {
    console.log("First result:", results[0].entry.content);
  }

  // Shutdown
  console.log("\n🛑 Shutting down...");
  await runtime.shutdown();
  console.log("✅ Done!");
}

main().catch(console.error);
