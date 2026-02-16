import { Runtime } from "../runtime/src/index.js";

async function main() {
  console.log("⏰ Nova Reminders Demo\n");
  console.log("This demo shows the reminder system in action!\n");

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.log(
      "⚠️  Set OPENAI_API_KEY environment variable to run agent demos",
    );
    console.log("   (Not required for reminder-only demos)\n");
  }

  // Create runtime
  console.log("1️⃣  Creating runtime with reminder system...");
  const runtime = await Runtime.create({
    memoryPath: "/tmp/nova-reminders.db",
    security: {
      sandboxMode: "none",
      allowedTools: ["reminder_create"],
      deniedTools: [],
    },
    executor: {
      maxParallel: 4,
      defaultTimeoutMs: 30000,
    },
  });
  console.log("   ✅ Runtime created with reminders enabled\n");

  const reminders = runtime.getReminders();

  // Demo 1: Create immediate reminder (30 seconds)
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("📋 Demo 1: Immediate Reminder (30 seconds)\n");

  const reminder1 = await reminders.createReminder({
    message: "Test reminder - this will trigger in 30 seconds!",
    triggerTime: Date.now() + 30 * 1000,
  });

  console.log(`   Created: ${reminder1.id}`);
  console.log(
    `   Triggers at: ${new Date(reminder1.triggerTime).toLocaleTimeString()}\n`,
  );

  // Demo 2: Create delayed reminder (2 minutes)
  console.log("📋 Demo 2: Delayed Reminder (2 minutes)\n");

  const reminder2 = await reminders.createReminder({
    message: "Call John about project update",
    triggerTime: Date.now() + 2 * 60 * 1000,
  });

  console.log(`   Created: ${reminder2.id}`);
  console.log(
    `   Triggers at: ${new Date(reminder2.triggerTime).toLocaleTimeString()}\n`,
  );

  // Demo 3: Show all pending reminders
  console.log("📋 Demo 3: View All Pending Reminders\n");

  const pending = reminders.getReminders({ status: "pending" });
  console.log(`   Total pending: ${pending.length}`);
  for (const reminder of pending) {
    console.log(
      `   - [${new Date(reminder.triggerTime).toLocaleTimeString()}] ${reminder.message}`,
    );
  }
  console.log();

  // Demo 4: Reminder statistics
  console.log("📋 Demo 4: Reminder Statistics\n");

  const stats = reminders.getStats();
  console.log(`   Pending: ${stats.pending}`);
  console.log(`   Triggered: ${stats.triggered}`);
  console.log(`   Snoozed: ${stats.snoozed}`);
  console.log(`   Cancelled: ${stats.cancelled}\n`);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Wait for reminders to trigger
  console.log("⏳ Waiting for reminders to trigger...");
  console.log("   (Checking every 10 seconds)\n");

  // Keep the process running for 3 minutes to see reminders trigger
  console.log("💡 Tip: Reminders are monitored in the background");
  console.log("   Press Ctrl+C to exit\n");

  await new Promise((resolve) => setTimeout(resolve, 3 * 60 * 1000));

  // Show final statistics
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("📊 Final Statistics\n");

  const finalStats = reminders.getStats();
  console.log(`   Pending: ${finalStats.pending}`);
  console.log(`   Triggered: ${finalStats.triggered}`);
  console.log(`   Snoozed: ${finalStats.snoozed}`);
  console.log(`   Cancelled: ${finalStats.cancelled}\n`);

  console.log("✅ Reminder demo complete!\n");

  // Cleanup
  await runtime.shutdown();
}

main().catch((error) => {
  console.error("❌ Demo failed:", error);
  process.exit(1);
});
