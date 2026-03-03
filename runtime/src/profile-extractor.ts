/**
 * profile-extractor.ts — Fire-and-forget profile extraction agent.
 *
 * After each chat turn, a cheap/fast LLM checks the last user + assistant
 * messages and updates USER.md / IDENTITY.md if new info was revealed.
 *
 * Hardened with:
 * - Pre-filter: skips trivial messages that can't contain profile info
 * - Write mutex: prevents concurrent overwrites from rapid messages
 * - Separate focused calls: one for USER, one for IDENTITY
 */

import type { ProfileStore } from "./markdown-memory/profile-store.js";

type ChatFn = (
  userMessage: string,
  history: Array<{ role: string; content: string }>,
) => Promise<string>;

// ── Pre-filter: keywords that signal possible profile-relevant content ──

const USER_SIGNALS = [
  // First-person indicators
  /\bmy\b/i,
  /\bi\s+(am|was|work|live|like|love|hate|prefer|use|have|need|want)\b/i,
  /\bi'm\b/i,
  /\bname\s+is\b/i,
  /\bcall\s+me\b/i,
  // Location / identity
  /\b(?:i'm |i am |i live |i'm based |coming )from\b/i,
  /\bbased\s+in\b/i,
  /\blive\s+in\b/i,
  /\blocated\b/i,
  // Work / projects
  /\bbuilding\b/i,
  /\bproject\b/i,
  /\bstartup\b/i,
  /\bcompany\b/i,
  /\bjob\b/i,
  /\bfreelance/i,
];

const IDENTITY_SIGNALS = [
  /\bcall\s+you\b/i,
  /\byour\s+name\b/i,
  /\brename\b/i,
  /\bname\s+you\b/i,
  /\bbe\s+more\b/i,
  /\bbe\s+less\b/i,
  /\bstop\s+(being|doing)\b/i,
  /\btone\b/i,
  /\bpersonality\b/i,
  /\bstyle\b/i,
  /\brespond\b/i,
];

function hasUserSignals(message: string): boolean {
  return USER_SIGNALS.some((re) => re.test(message));
}

function hasIdentitySignals(message: string): boolean {
  return IDENTITY_SIGNALS.some((re) => re.test(message));
}

// ── Prompts ──

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

Your response must be EITHER the word NONE or the FULL updated IDENTITY.md content (starting with "# " and the agent name). Nothing else.`;

// ── Extractor ──

export class ProfileExtractor {
  private readonly chatFn: ChatFn;
  private writing = false;
  private pendingArgs: [string, string, ProfileStore] | null = null;

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
    // Pre-filter: skip if message is too short or has no signals
    if (userMessage.length < 4) return;

    const needsUser = hasUserSignals(userMessage);
    const needsIdentity = hasIdentitySignals(userMessage);

    if (!needsUser && !needsIdentity) {
      return; // Nothing to extract
    }

    // Mutex: queue if another extraction is still writing
    if (this.writing) {
      this.pendingArgs = [userMessage, assistantResponse, profileStore];
      return;
    }
    this.writing = true;

    try {
      const tasks: Promise<void>[] = [];
      if (needsUser) {
        tasks.push(
          this.extractUser(userMessage, assistantResponse, profileStore),
        );
      }
      if (needsIdentity) {
        tasks.push(
          this.extractIdentity(userMessage, assistantResponse, profileStore),
        );
      }
      await Promise.all(tasks);
    } finally {
      this.writing = false;

      // Re-run if a message arrived while we were writing
      if (this.pendingArgs) {
        const args = this.pendingArgs;
        this.pendingArgs = null;
        void this.extract(...args);
      }
    }
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
