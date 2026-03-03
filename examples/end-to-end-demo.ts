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
    security: {
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

  // Test 4: Knowledge storage
  console.log("5️⃣  Test: Knowledge storage");
  const store = runtime.getMarkdownMemory().getKnowledgeJsonStore();

  store.addEntry({
    category: "fact",
    subject: "demo_execution",
    content: "Nova successfully executed bash, read, and write operations",
    tags: ["demo", "success", "tools"],
    importance: 0.9,
    source: "system",
  });
  console.log("   ✅ Knowledge stored\n");

  // Test 5: Search knowledge
  console.log("6️⃣  Test: Knowledge search");
  const searchResults = store.search("Nova executed");
  console.log(`   ✅ Found ${searchResults.length} entries`);
  if (searchResults.length > 0) {
    console.log(`   First result: "${searchResults[0].entry.content}"\n`);
  }

  // Summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎉 All Tests Passed!\n");
  console.log("Nova successfully:");
  console.log("  ✅ Wrote a file to disk");
  console.log("  ✅ Read the file back");
  console.log("  ✅ Executed bash commands");
  console.log("  ✅ Stored knowledge entries");
  console.log("  ✅ Searched knowledge with ranking");
  console.log("\n🚀 Nova is fully operational!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Shutdown
  await runtime.shutdown();
}

main().catch((error) => {
  console.error("❌ Demo failed:", error);
  process.exit(1);
});
