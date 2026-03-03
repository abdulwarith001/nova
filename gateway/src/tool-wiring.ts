/**
 * tool-wiring.ts — Registers skill tools and wires execute handlers.
 *
 * Delegates to each skill's wireTools() function, which handles both
 * schema registration and execute handler wiring internally.
 */

import type { Runtime } from "../../runtime/src/index.js";
import type { Agent } from "../../agent/src/index.js";

/**
 * Load and wire all skill tools by calling each skill's wireTools().
 */
export async function wireSkillTools(
  runtime: Runtime,
  agent: Agent,
): Promise<void> {
  // Web browsing skill (browse, scrape, web_search, web-agent tools)
  try {
    const webBrowsing = await import("../../skills/core/web-browsing/tools.js");
    if (webBrowsing.wireTools) {
      await webBrowsing.wireTools(runtime, agent);
    }
  } catch (err: any) {
    console.warn("⚠️ Failed to load web-browsing skill:", err.message);
  }

  // Google Workspace skill (Gmail, Calendar, Drive)
  try {
    const googleWorkspace =
      await import("../../skills/core/google-workspace/tools.js");
    if (googleWorkspace.wireTools) {
      await googleWorkspace.wireTools(runtime);
    }
  } catch (err: any) {
    console.warn("⚠️ Failed to load google-workspace skill:", err.message);
  }
}

/**
 * Wire the update_profile tool to the ProfileStore.
 */
export function wireProfileTools(runtime: Runtime): void {
  const store = runtime.getMarkdownMemory().getProfileStore();
  const tool = runtime.getTools().get("update_profile");
  if (tool) {
    tool.execute = async (params: any) => {
      const file = String(params.file || "").trim();
      const content = String(params.content || "").trim();

      if (file !== "user" && file !== "identity") {
        return { success: false, error: "file must be 'user' or 'identity'" };
      }
      if (!content) {
        return { success: false, error: "content must not be empty" };
      }

      if (file === "user") {
        store.updateUser(content);
      } else {
        store.updateIdentity(content);
      }

      return {
        success: true,
        message: `Updated ${file} profile`,
        path: store.getPath(file),
      };
    };
    console.log("📝 Wired update_profile tool");
  }
}
