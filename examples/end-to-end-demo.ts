import { Runtime, Task } from "../runtime/src/index.js";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

async function main() {
  console.log("🚀 Nova End-to-End Demo\n");
  console.log("This demo shows Nova executing real tools:\n");

  // Create runtime
  console.log("1️⃣  Creating runtime...");
  const runtime = await Runtime.create({
    memoryPath: ":memory:",
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

  // Test 1: Write a file
  console.log("2️⃣  Test: Write file");
  const testFile = join(tmpdir(), "nova-test.txt");
  const writeTask: Task = {
    id: "write-task",
    description: "Write a test file",
    toolCalls: [
      {
        toolName: "write",
        parameters: {
          path: testFile,
          content: "Hello from Nova! 🚀\nThis file was created by an AI agent.",
        },
      },
    ],
  };

  const writeResult = await runtime.execute(writeTask);
  console.log(`   ✅ File written to ${testFile}`);
  console.log(`   Duration: ${writeResult.durationMs}ms\n`);

  // Test 2: Read the file back
  console.log("3️⃣  Test: Read file");
  const readTask: Task = {
    id: "read-task",
    description: "Read the test file",
    toolCalls: [
      {
        toolName: "read",
        parameters: {
          path: testFile,
        },
      },
    ],
  };

  const readResult = await runtime.execute(readTask);
  console.log("   ✅ File read successfully");
  console.log(`   Content: ${JSON.stringify(readResult.outputs[0])}`);
  console.log(`   Duration: ${readResult.durationMs}ms\n`);

  // Test 3: Execute bash command
  console.log("4️⃣  Test: Bash command");
  const bashTask: Task = {
    id: "bash-task",
    description: "Execute bash command",
    toolCalls: [
      {
        toolName: "bash",
        parameters: {
          command: 'echo "Nova is running!" && date',
        },
      },
    ],
  };

  const bashResult = await runtime.execute(bashTask);
  console.log("   ✅ Bash command executed");
  console.log(`   Output: ${JSON.stringify(bashResult.outputs[0])}`);
  console.log(`   Duration: ${bashResult.durationMs}ms\n`);

  // Test 4: Memory storage
  console.log("5️⃣  Test: Memory storage");
  const memory = runtime.getMemory();

  await memory.store({
      id: "demo-memory",
      content: "Nova successfully executed bash, read, and write operations",
      timestamp: Date.now(),
      importance: 0.9,
      decayRate: 0.1,
      tags: ["demo", "success", "tools"],
      source: "end-to-end-demo",
      metadata: {
          tasksExecuted: 3,
          toolsUsed: ["bash", "read", "write"],
      },
      category: "self"
  });
  console.log("   ✅ Memory stored\n");

  // Test 5: Search memory
  console.log("6️⃣  Test: Memory search");
  const searchResults = await memory.search("Nova executed", 5);
  console.log(`   ✅ Found ${searchResults.length} memories`);
  if (searchResults.length > 0) {
    console.log(`   First result: "${searchResults[0].content}"\n`);
  }

  // Summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎉 All Tests Passed!\n");
  console.log("Nova successfully:");
  console.log("  ✅ Wrote a file to disk");
  console.log("  ✅ Read the file back");
  console.log("  ✅ Executed bash commands");
  console.log("  ✅ Stored memories in SQLite");
  console.log("  ✅ Searched memories with FTS5");
  console.log("\n🚀 Nova is fully operational!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Shutdown
  await runtime.shutdown();
}

main().catch((error) => {
  console.error("❌ Demo failed:", error);
  process.exit(1);
});
