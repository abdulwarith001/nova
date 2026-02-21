/**
 * knowledge-store.ts — Markdown-based knowledge store.
 *
 * Replaces the SQLite-backed KnowledgeStore with file reads/writes.
 *
 * Files managed:
 *   ~/.nova/memory/user.md         — User traits
 *   ~/.nova/memory/knowledge.md    — Important memories / facts
 *   ~/.nova/memory/relationships.md — People & relationships
 *   ~/.nova/memory/identity.md     — Agent's self-discovered traits
 */

import { join } from "path";
import { randomUUID } from "crypto";
import {
  parseMarkdownSections,
  serializeMarkdownSections,
  readMarkdownFile,
  writeMarkdownFile,
  upsertMarkdownItem,
  ensureDir,
  type MarkdownSection,
  type MarkdownItem,
} from "./markdown-store.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface MemoryItem {
  id: string;
  type: string;
  content: string;
  importance: number;
  confidence: number;
  createdAt: number;
}

export interface UserTrait {
  id: string;
  key: string;
  value: string;
  confidence: number;
  contradictionGroup?: string;
  createdAt: number;
}

export interface AgentTrait {
  id: string;
  key: string;
  value: string;
  confidence: number;
  createdAt: number;
}

export interface Relationship {
  id: string;
  subject: string;
  relation: string;
  object: string;
  confidence: number;
  createdAt: number;
}

// ── Store ───────────────────────────────────────────────────────────────────

export class MarkdownKnowledgeStore {
  private readonly userPath: string;
  private readonly knowledgePath: string;
  private readonly relationshipsPath: string;
  private readonly identityPath: string;

  constructor(memoryDir: string) {
    ensureDir(memoryDir);
    this.userPath = join(memoryDir, "user.md");
    this.knowledgePath = join(memoryDir, "knowledge.md");
    this.relationshipsPath = join(memoryDir, "relationships.md");
    this.identityPath = join(memoryDir, "identity.md");
  }

  // ── User Traits ─────────────────────────────────────────────────────────

  getUserTraits(limit = 20): UserTrait[] {
    const content = readMarkdownFile(this.userPath);
    if (!content) return [];

    const sections = parseMarkdownSections(content);
    const traits: UserTrait[] = [];

    for (const section of sections) {
      for (const item of section.items) {
        traits.push({
          id: `trait-${item.key}`,
          key: item.key,
          value: item.value,
          confidence: 0.9,
          createdAt: Date.now(),
        });
      }
    }

    return traits.slice(0, limit);
  }

  upsertUserTrait(
    userId: string,
    key: string,
    value: string,
    confidence = 0.9,
  ): void {
    upsertMarkdownItem(this.userPath, "User Traits", key, value);
  }

  // ── Memory Items (Knowledge) ────────────────────────────────────────────

  getTopMemoryItems(userId: string, limit = 16): MemoryItem[] {
    const content = readMarkdownFile(this.knowledgePath);
    if (!content) return [];

    const items: MemoryItem[] = [];

    // Parse freeform knowledge entries
    // Format: ## [type] Content
    //         - importance: 0.8
    //         - confidence: 0.9
    const lines = content.split("\n");
    let currentItem: Partial<MemoryItem> | null = null;

    for (const line of lines) {
      const headingMatch = line.match(/^##\s+\[(.+?)\]\s+(.+)$/);
      if (headingMatch) {
        if (currentItem?.content) {
          items.push(currentItem as MemoryItem);
        }
        currentItem = {
          id: `mem-${randomUUID().slice(0, 8)}`,
          type: headingMatch[1].trim(),
          content: headingMatch[2].trim(),
          importance: 0.5,
          confidence: 0.5,
          createdAt: Date.now(),
        };
        continue;
      }

      const kvMatch = line.match(/^-\s+(.+?):\s+(.+)$/);
      if (kvMatch && currentItem) {
        const key = kvMatch[1].trim();
        const val = kvMatch[2].trim();
        if (key === "importance")
          currentItem.importance = parseFloat(val) || 0.5;
        if (key === "confidence")
          currentItem.confidence = parseFloat(val) || 0.5;
        if (key === "created")
          currentItem.createdAt = Date.parse(val) || Date.now();
      }
    }

    if (currentItem?.content) items.push(currentItem as MemoryItem);

    // Sort by importance descending
    items.sort((a, b) => b.importance - a.importance);
    return items.slice(0, limit);
  }

  addMemoryItem(
    userId: string,
    type: string,
    content: string,
    importance = 0.5,
    confidence = 0.5,
  ): string {
    const id = `mem-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const entry = [
      "",
      `## [${type}] ${content}`,
      `- importance: ${importance.toFixed(2)}`,
      `- confidence: ${confidence.toFixed(2)}`,
      `- created: ${now}`,
      "",
    ].join("\n");

    const existing = readMarkdownFile(this.knowledgePath);
    const header = existing ? "" : "# Knowledge\n\n";
    writeMarkdownFile(this.knowledgePath, existing + header + entry);

    return id;
  }

  // ── Relationships ───────────────────────────────────────────────────────

  getRelationships(userId: string, limit = 16): Relationship[] {
    const content = readMarkdownFile(this.relationshipsPath);
    if (!content) return [];

    const relationships: Relationship[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      // Format: - Subject [relation] Object (confidence: 0.85)
      const match = line.match(
        /^-\s+(.+?)\s+\[(.+?)\]\s+(.+?)\s+\(confidence:\s+([\d.]+)\)$/,
      );
      if (match) {
        relationships.push({
          id: `rel-${randomUUID().slice(0, 8)}`,
          subject: match[1].trim(),
          relation: match[2].trim(),
          object: match[3].trim(),
          confidence: parseFloat(match[4]) || 0.5,
          createdAt: Date.now(),
        });
      }
    }

    return relationships.slice(0, limit);
  }

  addRelationship(
    userId: string,
    subject: string,
    relation: string,
    object: string,
    confidence = 0.8,
  ): void {
    const entry = `- ${subject} [${relation}] ${object} (confidence: ${confidence.toFixed(2)})\n`;
    const existing = readMarkdownFile(this.relationshipsPath);
    const header = existing ? "" : "# Relationships\n\n";
    writeMarkdownFile(this.relationshipsPath, existing + header + entry);
  }

  // ── Agent Traits (learned identity) ─────────────────────────────────────

  getAgentTraits(limit = 16): AgentTrait[] {
    const content = readMarkdownFile(this.identityPath);
    if (!content) return [];

    const sections = parseMarkdownSections(content);
    const traits: AgentTrait[] = [];

    for (const section of sections) {
      for (const item of section.items) {
        traits.push({
          id: `agent-trait-${item.key}`,
          key: item.key,
          value: item.value,
          confidence: 0.9,
          createdAt: Date.now(),
        });
      }
    }

    return traits.slice(0, limit);
  }

  upsertAgentTrait(key: string, value: string, confidence = 0.9): void {
    upsertMarkdownItem(this.identityPath, "Agent Identity", key, value);
  }
}
