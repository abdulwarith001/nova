import chalk from "chalk";
import { SkillLoader } from "../../../runtime/src/skill-loader.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * nova skill [action]
 *
 * Actions:
 *   list   — Show all discovered skills and their capabilities
 */
export async function skillCommand(action?: string): Promise<void> {
  const loader = new SkillLoader();
  const dirs = SkillLoader.getDefaultDirs(path.resolve(__dirname, "../../../"));

  switch (action) {
    case "list": {
      const manifests = loader.buildIndex(dirs);

      if (manifests.length === 0) {
        console.log(chalk.yellow("No skills found."));
        console.log(chalk.dim(`Searched directories: ${dirs.join(", ")}`));
        return;
      }

      console.log(
        chalk.cyan(`\n📦 ${manifests.length} skill(s) discovered:\n`),
      );

      for (const manifest of manifests) {
        console.log(chalk.bold.white(`  ${manifest.name}`));
        console.log(chalk.dim(`    ${manifest.description}`));
        console.log(
          chalk.dim(
            `    Tools: ${manifest.toolCount} | Capabilities: ${manifest.capabilities.slice(0, 4).join(", ")}`,
          ),
        );
        if (manifest.envRequired.length > 0) {
          const envStatus = manifest.envRequired.map((env) => {
            const set = !!process.env[env];
            return set ? chalk.green(`✓ ${env}`) : chalk.red(`✗ ${env}`);
          });
          console.log(chalk.dim(`    Env: ${envStatus.join(", ")}`));
        }
        console.log();
      }
      break;
    }

    default:
      console.log(chalk.cyan("Nova Skills — Manage agent skills\n"));
      console.log("Usage: nova skill <action>\n");
      console.log("Actions:");
      console.log("  list   — Show all discovered skills");
      break;
  }
}
