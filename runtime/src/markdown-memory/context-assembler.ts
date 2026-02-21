/**
 * context-assembler.ts — Builds the system prompt context from Markdown stores.
 *
 * Replaces the SQLite-backed ContextAssembler.
 * Reads user traits, memories, relationships from Markdown files
 * and assembles them into a context string for the LLM.
 */

import {
  MarkdownConversationStore,
  type StoredMessage,
} from "./conversation-store.js";
import {
  MarkdownKnowledgeStore,
  type MemoryItem,
  type UserTrait,
  type AgentTrait,
  type Relationship,
} from "./knowledge-store.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface MemoryContextPackage {
  userId: string;
  conversationId: string;
  recentMessages: StoredMessage[];
  memoryItems: MemoryItem[];
  userTraits: UserTrait[];
  agentTraits: AgentTrait[];
  relationships: Relationship[];
  assembledSystemPrompt: string;
}

// ── Assembler ───────────────────────────────────────────────────────────────

export class MarkdownContextAssembler {
  constructor(
    private readonly conversationStore: MarkdownConversationStore,
    private readonly knowledgeStore: MarkdownKnowledgeStore,
  ) {}

  buildContext(input: {
    userId: string;
    conversationId: string;
    messageLimit?: number;
    memoryLimit?: number;
    traitLimit?: number;
  }): MemoryContextPackage {
    const recentMessages = this.conversationStore.getRecentMessages({
      userId: input.userId,
      conversationId: input.conversationId,
      limit: input.messageLimit || 36,
    });

    const memoryItems = this.knowledgeStore.getTopMemoryItems(
      input.userId,
      input.memoryLimit || 16,
    );
    const userTraits = this.knowledgeStore.getUserTraits(
      input.traitLimit || 20,
    );
    const agentTraits = this.knowledgeStore.getAgentTraits(16);
    const relationships = this.knowledgeStore.getRelationships(
      input.userId,
      16,
    );

    // Filter out self-reflection and system entries from user-facing memories
    const userMemories = memoryItems.filter(
      (m) =>
        m.type !== "self_reflection" &&
        m.type !== "system_audit" &&
        m.type !== "curiosity_target",
    );

    const sections: string[] = [];

    // Section 1: What I know about the user
    sections.push("=== WHAT I KNOW ABOUT MY USER ===");
    if (userTraits.length > 0) {
      const grouped = new Map<string, string>();
      for (const t of userTraits) {
        grouped.set(t.key, t.value);
      }
      const name = grouped.get("name");
      if (name) {
        sections.push(`Their name is ${name}.`);
        grouped.delete("name");
      }
      if (grouped.size > 0) {
        sections.push(
          "Things I've learned about them:",
          ...[...grouped.entries()].map(([k, v]) => `- ${k}: ${v}`),
        );
      }
    } else {
      sections.push(
        "I don't know much about this user yet — I should be curious and learn!",
      );
    }

    // Section 2: Relationships
    if (relationships.length > 0) {
      sections.push(
        "",
        "=== PEOPLE & RELATIONSHIPS ===",
        ...relationships.map(
          (r) =>
            `- ${r.subject} ${r.relation} ${r.object} (confidence: ${r.confidence.toFixed(2)})`,
        ),
      );
    }

    // Section 3: Important memories
    if (userMemories.length > 0) {
      sections.push(
        "",
        "=== THINGS I REMEMBER ===",
        ...userMemories.map(
          (m) =>
            `- [${m.type}] ${m.content.slice(0, 200)} (importance: ${m.importance.toFixed(2)})`,
        ),
      );
    }

    // Section 4: Who I am (learned traits, not soul.md — those come separately)
    if (agentTraits.length > 0) {
      sections.push(
        "",
        "=== WHO I AM ===",
        ...agentTraits.map((t) => `- ${t.key}: ${t.value}`),
      );
    }

    const assembledSystemPrompt = sections.join("\n");

    return {
      userId: input.userId,
      conversationId: input.conversationId,
      recentMessages,
      memoryItems,
      userTraits,
      agentTraits,
      relationships,
      assembledSystemPrompt,
    };
  }
}
