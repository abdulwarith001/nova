#!/usr/bin/env node
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Use tsx to handle TypeScript imports
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcEntry = join(__dirname, "..", "src", "index.ts");

// Dynamic import of tsx loader registration, then import the TS source
async function main() {
  try {
    // Try to use tsx
    await import("tsx");
    await import(pathToFileURL(srcEntry).href);
  } catch {
    // Fallback: try dist
    const distEntry = join(__dirname, "..", "dist", "index.js");
    await import(pathToFileURL(distEntry).href);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
