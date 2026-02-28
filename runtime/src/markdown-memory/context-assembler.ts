/**
 * context-assembler.ts — Builds the system prompt context from knowledge stores.
 *
 * Reads user traits, agent traits, preferences, and relationships from
 * KnowledgeJsonStore and assembles them into a context string for the LLM.
 */

import {
  MarkdownConversationStore,
  type StoredMessage,
} from "./conversation-store.js";
import {
  KnowledgeJsonStore,
  type KnowledgeEntry,
} from "./knowledge-json-store.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface MemoryContextPackage {
  userId: string;
  conversationId: string;
  recentMessages: StoredMessage[];
  userKnowledge: KnowledgeEntry[];
  agentTraits: KnowledgeEntry[];
  assembledSystemPrompt: string;
}

// ── Assembler ───────────────────────────────────────────────────────────────

export class MarkdownContextAssembler {
  constructor(
    private readonly conversationStore: MarkdownConversationStore,
    private readonly knowledgeStore: KnowledgeJsonStore,
  ) {}

  buildContext(input: {
    userId: string;
    conversationId: string;
    messageLimit?: number;
  }): MemoryContextPackage {
    const recentMessages = this.conversationStore.getRecentMessages({
      userId: input.userId,
      conversationId: input.conversationId,
      limit: input.messageLimit || 36,
    });

    // Get user-related knowledge (user_traits, preferences, important relationships)
    const userKnowledge = this.knowledgeStore.getUserContext(0.6);
    const agentTraits = this.knowledgeStore.getAgentTraits();

    const sections: string[] = [];

    // Section 1: What I know about the user
    sections.push("=== WHAT I KNOW ABOUT MY USER ===");
    if (userKnowledge.length > 0) {
      // Extract name if available
      const nameEntry = userKnowledge.find(
        (e) =>
          e.category === "user_trait" &&
          e.subject.toLowerCase().includes("name"),
      );
      if (nameEntry) {
        sections.push(`Their name is ${nameEntry.content}.`);
      }

      // Group by category for organized display
      const traits = userKnowledge.filter(
        (e) => e.category === "user_trait" && e !== nameEntry,
      );
      const preferences = userKnowledge.filter(
        (e) => e.category === "preference",
      );
      const relationships = userKnowledge.filter(
        (e) => e.category === "relationship",
      );

      if (traits.length > 0) {
        sections.push(
          "Things I've learned about them:",
          ...traits.map((e) => `- ${e.subject}: ${e.content}`),
        );
      }

      if (preferences.length > 0) {
        sections.push(
          "",
          "=== PREFERENCES ===",
          ...preferences.map((e) => `- ${e.subject}: ${e.content}`),
        );
      }

      if (relationships.length > 0) {
        sections.push(
          "",
          "=== PEOPLE & RELATIONSHIPS ===",
          ...relationships.map(
            (r) =>
              `- ${r.subject}: ${r.content} (confidence: ${r.confidence.toFixed(2)})`,
          ),
        );
      }
    } else {
      sections.push(
        "I don't know much about this user yet — I should be curious and learn!",
      );
    }

    // Section 2: Who I am (learned agent traits)
    if (agentTraits.length > 0) {
      sections.push(
        "",
        "=== WHO I AM ===",
        ...agentTraits.map((t) => `- ${t.subject}: ${t.content}`),
      );
    }

    const assembledSystemPrompt = sections.join("\n");

    return {
      userId: input.userId,
      conversationId: input.conversationId,
      recentMessages,
      userKnowledge,
      agentTraits,
      assembledSystemPrompt,
    };
  }
}
