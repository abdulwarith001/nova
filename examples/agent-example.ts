import { Agent } from "../agent/src/index.js";

async function main() {
  console.log("🤖 Nova Agent Example\n");

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      "⚠️  Set ANTHROPIC_API_KEY environment variable to run this example",
    );
    console.log("Example: export ANTHROPIC_API_KEY=sk-ant-...\n");
    process.exit(0);
  }

  // Create agent with Anthropic
  const agent = new Agent(
    {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      temperature: 0.7,
      maxTokens: 1024,
    },
    "You are a helpful AI assistant named Nova.",
  );

  console.log("Agent created with Anthropic Claude\n");

  // Simple chat
  console.log("User: Hello! What can you do?");
  const response = await agent.chat("Hello! What can you do?");
  console.log("Nova:", response);

  // Streaming chat
  console.log("\n\nUser: Tell me a short joke");
  process.stdout.write("Nova: ");

  for await (const chunk of agent.streamChat("Tell me a short joke")) {
    process.stdout.write(chunk);
  }

  console.log("\n\n✅ Done!");
}

main().catch(console.error);
