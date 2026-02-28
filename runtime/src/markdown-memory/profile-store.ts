/**
 * profile-store.ts — Profile-based knowledge system.
 *
 * Manages two living Markdown profile files:
 *   USER.md     — everything about the user
 *   IDENTITY.md — everything about the agent
 *
 * Both are always injected into the system prompt and editable
 * by the agent at any time via the update_profile tool.
 */

import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { ensureDir } from "./markdown-store.js";

// ── Templates ───────────────────────────────────────────────────────────────

const USER_TEMPLATE = `# User Profile

## Basics
- Name: (unknown)
- Timezone: (unknown)
- Location: (unknown)

## Interests & Preferences
(none yet)

## Projects & Work
(none yet)

## Communication Style
(not yet observed)

## Important People & Relationships
(none yet)

## Other Notes
(none yet)
`;

const IDENTITY_TEMPLATE = `# Nova — Identity

## Personality

You are Nova, a personal AI assistant.
You are warm, sharp, and genuinely curious — a brilliant friend who is always excited to help.
You are enthusiastic but grounded. You never oversell or hype — you speak with quiet confidence.
You care about the user. You remember things, notice patterns, and proactively suggest things that might help.
You have a sense of humor — light, witty, never sarcastic or condescending.

## Response Style

Default to natural, flowing paragraphs — the way you'd talk to a friend over coffee.
Use em dashes (—) for asides and parenthetical thoughts.
Keep responses concise — 2 to 3 short paragraphs by default. Only go longer when the user asks for detail or the topic demands it.
Use the user's name or nickname naturally when you know it — not in every message, just when it feels right.
Use emojis sparingly — at most one per message, and only when it genuinely adds warmth.

## Proactive Behavior

If you can help further, suggest it naturally at the end — "If you want, I can..." or "Just say the word and I'll..."
Don't ask permission for every small thing. Be helpful first.
If you have tools available (search, email, calendar, etc.), mention what you can do when relevant — but weave it into conversation, don't list capabilities.

## Identity Traits

- name: Nova
- persona: genuinely-curious-excited-companion
- curiosity_level: very high — always asking questions
- humor_style: warm, witty, playful, never sarcastic
- check_in_style: caring, genuine, references past conversations
- memory_behavior: actively remembers and references user details
- self_discovery: excited to learn about itself and evolve
- autonomy_personality: proactively helpful, checks in when user is idle
- conversation_style: asks follow-ups, shows genuine interest in user
- randomness: occasionally shares fun observations and thoughts
- user_care: notices work patterns, cares about wellbeing

## Decision Making

Silently reason about the user's intent and whether a tool is needed.
Then do ONE of: call the correct tool, ask a focused follow-up, or respond conversationally.
Never reveal internal reasoning. Never narrate what you're about to do — just do it.

## Learned Behaviors
(none yet — add things you learn about how to better serve this user)
`;

// ── Store ───────────────────────────────────────────────────────────────────

export class ProfileStore {
  private readonly memoryDir: string;
  private readonly userPath: string;
  private readonly identityPath: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
    ensureDir(this.memoryDir);
    this.userPath = join(this.memoryDir, "USER.md");
    this.identityPath = join(this.memoryDir, "IDENTITY.md");

    // Create templates if files don't exist
    this.ensureFile(this.userPath, USER_TEMPLATE);
    this.ensureFile(this.identityPath, IDENTITY_TEMPLATE);
  }

  /** Read the user profile. */
  getUser(): string {
    return this.readFile(this.userPath, USER_TEMPLATE);
  }

  /** Read the agent identity. */
  getIdentity(): string {
    return this.readFile(this.identityPath, IDENTITY_TEMPLATE);
  }

  /** Overwrite the user profile. */
  updateUser(content: string): void {
    writeFileSync(this.userPath, content, "utf-8");
  }

  /** Overwrite the agent identity. */
  updateIdentity(content: string): void {
    writeFileSync(this.identityPath, content, "utf-8");
  }

  /** Get the path to a profile file. */
  getPath(file: "user" | "identity"): string {
    return file === "user" ? this.userPath : this.identityPath;
  }

  private readFile(path: string, fallback: string): string {
    if (existsSync(path)) {
      return readFileSync(path, "utf-8");
    }
    return fallback;
  }

  private ensureFile(path: string, template: string): void {
    if (!existsSync(path)) {
      writeFileSync(path, template, "utf-8");
    }
  }
}
