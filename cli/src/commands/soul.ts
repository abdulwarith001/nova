import chalk from "chalk";
import { execSync } from "child_process";
import { getSoulPath, resetSoul, loadSoul } from "../../../runtime/src/soul.js";

/**
 * nova soul [action]
 *
 * Actions:
 *   edit    — Open ~/.nova/soul.md in $EDITOR
 *   show    — Print the current soul.md
 *   reset   — Reset to default soul.md
 */
export async function soulCommand(action?: string): Promise<void> {
  switch (action) {
    case "edit": {
      const soulPath = getSoulPath();
      // Ensure the file exists
      loadSoul();
      const editor = process.env.EDITOR || "nano";
      console.log(chalk.cyan(`Opening ${soulPath} in ${editor}...`));
      try {
        execSync(`${editor} "${soulPath}"`, { stdio: "inherit" });
        console.log(
          chalk.green("✅ Soul updated. Restart daemon to apply changes."),
        );
      } catch (err: any) {
        console.error(chalk.red(`Failed to open editor: ${err.message}`));
      }
      break;
    }

    case "show": {
      const content = loadSoul();
      console.log(content);
      break;
    }

    case "reset": {
      resetSoul();
      console.log(
        chalk.green("✅ Soul reset to default. Restart daemon to apply."),
      );
      break;
    }

    default:
      console.log(chalk.cyan("Nova Soul — Manage agent personality\n"));
      console.log("Usage: nova soul <action>\n");
      console.log("Actions:");
      console.log("  edit   — Open soul.md in your editor");
      console.log("  show   — Print the current soul.md");
      console.log("  reset  — Reset to default personality");
      break;
  }
}
