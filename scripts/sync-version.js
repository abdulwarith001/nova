import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootPath = join(__dirname, "..");

// 1. Read target version from root package.json
const rootPkg = JSON.parse(
  readFileSync(join(rootPath, "package.json"), "utf-8"),
);
const version = rootPkg.version;

console.log(`🚀 Syncing version ${version} across monorepo...`);

// 2. Sync workspace package.json files
const workspaces = ["cli", "gateway", "agent", "runtime"];
for (const workspace of workspaces) {
  const pkgPath = join(rootPath, workspace, "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    pkg.version = version;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`   ✅ Updated ${workspace}/package.json`);
  } catch (err) {
    console.error(
      `   ❌ Failed to update ${workspace}/package.json:`,
      err.message,
    );
  }
}

// 3. Sync CLI source version string
const cliIndexPath = join(rootPath, "cli", "src", "index.ts");
try {
  let content = readFileSync(cliIndexPath, "utf-8");
  content = content.replace(/\.version\(".*"\)/, `.version("${version}")`);
  writeFileSync(cliIndexPath, content);
  console.log(`   ✅ Updated cli/src/index.ts source string`);
} catch (err) {
  console.error(`   ❌ Failed to update cli/src/index.ts:`, err.message);
}

// 4. Sync Gateway source version string
const gatewayIndexPath = join(rootPath, "gateway", "src", "index.ts");
try {
  let content = readFileSync(gatewayIndexPath, "utf-8");
  content = content.replace(/version: ".*",/, `version: "${version}",`);
  writeFileSync(gatewayIndexPath, content);
  console.log(`   ✅ Updated gateway/src/index.ts source string`);
} catch (err) {
  console.error(`   ❌ Failed to update gateway/src/index.ts:`, err.message);
}

console.log("\n✨ Version sync complete!");
