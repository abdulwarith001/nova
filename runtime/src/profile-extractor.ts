/**
 * profile-extractor.ts — Fire-and-forget profile extraction agent.
 *
 * After each chat turn, a cheap/fast LLM checks the last user + assistant
 * messages and updates USER.md / IDENTITY.md if new info was revealed.
 *
 * Uses two separate, focused calls to avoid regex parsing issues.
 */

import type { ProfileStore } from "./markdown-memory/profile-store.js";

type ChatFn = (
  userMessage: string,
  history: Array<{ role: string; content: string }>,
) => Promise<string>;

const USER_EXTRACTION_PROMPT = `You extract user information from conversations and update a profile.

You will receive the current USER.md profile and the last 2 messages (user + assistant).

USER.md contains information ABOUT THE HUMAN — their name, location, job, preferences, projects, relationships, and communication style.

Rules:
- If the user revealed NEW personal info about THEMSELVES, output the FULL updated USER.md.
- PRESERVE all existing sections and headers (## Basics, ## Interests, etc.) — only ADD or MODIFY content within them.
- Do NOT put info about the AI agent here (agent name changes, personality requests go elsewhere).
- Do NOT invent anything — only extract what was explicitly stated.
- If NOTHING new about the USER was revealed, respond with exactly: NONE

Your response must be EITHER the word NONE or the FULL updated USER.md content (starting with "# User Profile"). Nothing else.`;

const IDENTITY_EXTRACTION_PROMPT = `You extract AI agent identity changes from conversations and update a profile.

You will receive the current IDENTITY.md profile and the last 2 messages (user + assistant).

IDENTITY.md contains information ABOUT THE AI AGENT — its name/nickname, personality, response style, and learned behaviors.

Things that belong here:
- User renaming the agent (e.g. "I'll call you Chiti" → update name field)
- User requesting personality changes (e.g. "be more concise")
- Learned behaviors about how to serve this user better

Things that do NOT belong here (they go in USER.md):
- User's own name, location, job, preferences

Rules:
- If the conversation revealed something the agent should update about ITSELF, output the FULL updated IDENTITY.md.
- PRESERVE all existing sections and content — only ADD or MODIFY.
- If updating the name, change the "name:" field under Identity Traits AND the first line of Personality.
- If NOTHING new about the AGENT was revealed, respond with exactly: NONE

Your response must be EITHER the word NONE or the FULL updated IDENTITY.md content (starting with "# Nova — Identity" or the new agent name). Nothing else.`;

export class ProfileExtractor {
  private readonly chatFn: ChatFn;

  constructor(chatFn: ChatFn) {
    this.chatFn = chatFn;
  }

  /**
   * Analyse the last user+assistant messages and update profiles if needed.
   * Designed to be called fire-and-forget (void this.extract(...)).
   */
  async extract(
    userMessage: string,
    assistantResponse: string,
    profileStore: ProfileStore,
  ): Promise<void> {
    // Run both extractions in parallel
    await Promise.all([
      this.extractUser(userMessage, assistantResponse, profileStore),
      this.extractIdentity(userMessage, assistantResponse, profileStore),
    ]);
  }

  private async extractUser(
    userMessage: string,
    assistantResponse: string,
    profileStore: ProfileStore,
  ): Promise<void> {
    const current = profileStore.getUser();

    const prompt = [
      USER_EXTRACTION_PROMPT,
      "",
      "=== CURRENT USER.md ===",
      current,
      "",
      "=== LAST 2 MESSAGES ===",
      `User: ${userMessage}`,
      `Assistant: ${assistantResponse}`,
    ].join("\n");

    let result: string;
    try {
      result = await this.chatFn(prompt, []);
    } catch (err: any) {
      console.warn("⚠️ User profile extraction failed:", err?.message);
      return;
    }

    const trimmed = result.trim();

    if (
      trimmed === "NONE" ||
      trimmed.length < 20 ||
      !trimmed.includes("# User Profile")
    ) {
      return;
    }

    if (trimmed !== current.trim()) {
      profileStore.updateUser(trimmed);
      console.log("📝 Profile extractor updated USER.md");
    }
  }

  private async extractIdentity(
    userMessage: string,
    assistantResponse: string,
    profileStore: ProfileStore,
  ): Promise<void> {
    const current = profileStore.getIdentity();

    const prompt = [
      IDENTITY_EXTRACTION_PROMPT,
      "",
      "=== CURRENT IDENTITY.md ===",
      current,
      "",
      "=== LAST 2 MESSAGES ===",
      `User: ${userMessage}`,
      `Assistant: ${assistantResponse}`,
    ].join("\n");

    let result: string;
    try {
      result = await this.chatFn(prompt, []);
    } catch (err: any) {
      console.warn("⚠️ Identity profile extraction failed:", err?.message);
      return;
    }

    const trimmed = result.trim();

    if (trimmed === "NONE" || trimmed.length < 20 || !trimmed.includes("# ")) {
      return;
    }

    if (trimmed !== current.trim()) {
      profileStore.updateIdentity(trimmed);
      console.log("📝 Profile extractor updated IDENTITY.md");
    }
  }
}
