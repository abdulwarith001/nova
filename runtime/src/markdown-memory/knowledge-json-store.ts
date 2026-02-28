/**
 * knowledge-json-store.ts — JSON-based knowledge store with search.
 *
 * The single source of truth for all persistent knowledge.
 * Supports rich metadata, fuzzy deduplication, category validation,
 * and ranked search with recency/confidence/phrase boosts.
 *
 * File: ~/.nova/memory/knowledge.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

// ── Types ───────────────────────────────────────────────────────────────────

export type KnowledgeCategory =
  | "user_trait"
  | "fact"
  | "preference"
  | "relationship"
  | "event"
  | "skill"
  | "context"
  | "agent_trait";

export const VALID_CATEGORIES = new Set<KnowledgeCategory>([
  "user_trait",
  "fact",
  "preference",
  "relationship",
  "event",
  "skill",
  "context",
  "agent_trait",
]);

export interface KnowledgeEntry {
  id: string;
  category: KnowledgeCategory;
  subject: string;
  content: string;
  tags: string[];
  importance: number; // 0.0–1.0
  confidence: number; // 0.0–1.0
  source: "conversation" | "user_explicit" | "system" | "heartbeat";
  sourceRef?: string; // e.g. conversation session ID
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  supersedes?: string | null; // ID of entry this corrects/replaces
  active: boolean; // false = soft-deleted or superseded
}

export interface KnowledgeSearchResult {
  entry: KnowledgeEntry;
  score: number;
  matchReason: string;
}

export interface KnowledgeSearchOptions {
  category?: KnowledgeCategory;
  subject?: string;
  minImportance?: number;
  limit?: number;
  includeInactive?: boolean;
}

// ── Text Helpers ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "and",
  "but",
  "or",
  "nor",
  "not",
  "so",
  "yet",
  "both",
  "either",
  "neither",
  "each",
  "every",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "him",
  "his",
  "she",
  "her",
  "they",
  "them",
  "their",
  "user",
  "users",
]);

/** Lowercase, strip punctuation, remove stop words, return sorted unique words. */
export function normalizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Normalized Levenshtein distance (0.0 = identical, 1.0 = completely different). */
function levenshteinDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return la === lb ? 0 : 1;

  const prev = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= lb; j++) {
      const temp = prev[j];
      prev[j] =
        a[i - 1] === b[j - 1]
          ? prevDiag
          : 1 + Math.min(prev[j], prev[j - 1], prevDiag);
      prevDiag = temp;
    }
  }
  return prev[lb] / Math.max(la, lb);
}

/**
 * Hybrid text similarity (0.0 – 1.0).
 * Uses Levenshtein for short strings (< 5 words) where Jaccard is unreliable,
 * and Jaccard word-overlap for longer strings.
 */
export function textSimilarity(a: string, b: string): number {
  const wordsA = normalizeText(a);
  const wordsB = normalizeText(b);

  // Short strings: Levenshtein is more reliable
  if (wordsA.length < 5 || wordsB.length < 5) {
    return (
      1 - levenshteinDistance(a.toLowerCase().trim(), b.toLowerCase().trim())
    );
  }

  // Longer strings: Jaccard word-overlap
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// ── Category priority for cross-category merging ─────────────────────────
// Higher number = higher priority. When merging duplicates across categories,
// we keep the higher-priority category.
const CATEGORY_PRIORITY: Record<string, number> = {
  user_trait: 10,
  preference: 9,
  relationship: 8,
  skill: 7,
  event: 6,
  fact: 5,
  agent_trait: 4,
  context: 3,
};

// ── Store ───────────────────────────────────────────────────────────────────

export class KnowledgeJsonStore {
  private readonly filePath: string;
  private cache: KnowledgeEntry[] | null = null;

  constructor(memoryDir: string) {
    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true });
    }
    this.filePath = join(memoryDir, "knowledge.json");
  }

  // ── Read / Write ────────────────────────────────────────────────────────

  private readEntries(): KnowledgeEntry[] {
    if (this.cache) return this.cache;
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const entries = JSON.parse(raw);
      this.cache = Array.isArray(entries) ? entries : [];
      return this.cache;
    } catch {
      return [];
    }
  }

  private writeEntries(entries: KnowledgeEntry[]): void {
    this.cache = entries;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(entries, null, 2), "utf-8");
  }

  /** Force reload from disk on next read. */
  invalidateCache(): void {
    this.cache = null;
  }

  // ── Category Validation ─────────────────────────────────────────────────

  /** Validate and normalize a category, defaulting to "fact" if invalid. */
  private validateCategory(category: string): KnowledgeCategory {
    if (VALID_CATEGORIES.has(category as KnowledgeCategory)) {
      return category as KnowledgeCategory;
    }
    console.warn(
      `⚠️ Invalid knowledge category "${category}", defaulting to "fact"`,
    );
    return "fact";
  }

  // ── Search ──────────────────────────────────────────────────────────────

  /**
   * Search knowledge entries with improved scoring.
   *
   * Score = (termMatch * 0.35 + tagMatch * 0.2 + importance * 0.15
   *          + phraseBoost * 0.15 + recencyBoost * 0.05) * confidence
   *        + categoryBoost (0.1 if exact category match)
   */
  search(
    query: string,
    options?: KnowledgeSearchOptions,
  ): KnowledgeSearchResult[] {
    const entries = this.readEntries();
    const limit = options?.limit ?? 5;
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 1);

    if (queryWords.length === 0) return [];

    const now = Date.now();
    const results: KnowledgeSearchResult[] = [];

    for (const entry of entries) {
      // Skip inactive unless requested
      if (!entry.active && !options?.includeInactive) continue;

      // Apply filters
      if (options?.category && entry.category !== options.category) continue;
      if (
        options?.subject &&
        !entry.subject.toLowerCase().includes(options.subject.toLowerCase())
      )
        continue;
      if (options?.minImportance && entry.importance < options.minImportance)
        continue;

      // Score: text match
      const textHaystack = `${entry.subject} ${entry.content}`.toLowerCase();
      const textMatches = queryWords.filter((w) =>
        textHaystack.includes(w),
      ).length;
      const termMatchScore = textMatches / queryWords.length;

      // Score: tag match
      const tagHaystack = entry.tags.join(" ").toLowerCase();
      const tagMatches = queryWords.filter((w) =>
        tagHaystack.includes(w),
      ).length;
      const tagMatchScore = tagMatches / queryWords.length;

      // Score: exact phrase boost
      const phraseBoost = textHaystack.includes(queryLower) ? 1.0 : 0.0;

      // Score: recency boost (entries updated in last 7 days get up to 1.0)
      const entryAge = now - new Date(entry.updatedAt).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const recencyBoost = Math.max(0, 1.0 - entryAge / sevenDaysMs);

      // Score: category match boost
      const categoryBoost =
        options?.category && entry.category === options.category ? 1.0 : 0.0;

      // Combined score, weighted by confidence
      const rawScore =
        termMatchScore * 0.35 +
        tagMatchScore * 0.2 +
        entry.importance * 0.15 +
        phraseBoost * 0.15 +
        recencyBoost * 0.05 +
        categoryBoost * 0.1;

      const score = rawScore * Math.max(0.3, entry.confidence);

      if (score > 0.15) {
        const reasons: string[] = [];
        if (termMatchScore > 0)
          reasons.push(`content match (${(termMatchScore * 100).toFixed(0)}%)`);
        if (tagMatchScore > 0)
          reasons.push(`tag match (${(tagMatchScore * 100).toFixed(0)}%)`);
        if (phraseBoost > 0) reasons.push("exact phrase");
        if (recencyBoost > 0.5) reasons.push("recent");

        results.push({
          entry,
          score,
          matchReason: reasons.join(", ") || "importance",
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  // ── Essentials (for system prompt) ──────────────────────────────────────

  /**
   * Get high-importance user traits for system prompt injection.
   * Only returns active user_trait entries with importance >= threshold.
   */
  getEssentials(importanceThreshold = 0.7): KnowledgeEntry[] {
    const entries = this.readEntries();
    return entries
      .filter(
        (e) =>
          e.active &&
          e.category === "user_trait" &&
          e.importance >= importanceThreshold,
      )
      .sort((a, b) => b.importance - a.importance);
  }

  /**
   * Get active agent trait entries.
   */
  getAgentTraits(): KnowledgeEntry[] {
    const entries = this.readEntries();
    return entries
      .filter((e) => e.active && e.category === "agent_trait")
      .sort((a, b) => b.importance - a.importance);
  }

  /**
   * Get user-related knowledge: user_traits, preferences, and high-importance relationships.
   */
  getUserContext(importanceThreshold = 0.6): KnowledgeEntry[] {
    const entries = this.readEntries();
    return entries
      .filter(
        (e) =>
          e.active &&
          (e.category === "user_trait" ||
            e.category === "preference" ||
            (e.category === "relationship" &&
              e.importance >= importanceThreshold)),
      )
      .sort((a, b) => b.importance - a.importance);
  }

  // ── Add ─────────────────────────────────────────────────────────────────

  addEntry(input: {
    category: KnowledgeCategory | string;
    subject: string;
    content: string;
    tags?: string[];
    importance?: number;
    confidence?: number;
    source?: KnowledgeEntry["source"];
    sourceRef?: string;
  }): KnowledgeEntry {
    const now = new Date().toISOString();
    const validCategory = this.validateCategory(input.category);

    const entry: KnowledgeEntry = {
      id: `k-${Date.now()}-${randomUUID().slice(0, 8)}`,
      category: validCategory,
      subject: input.subject,
      content: input.content,
      tags: input.tags || [],
      importance: Math.max(0, Math.min(1, input.importance ?? 0.5)),
      confidence: Math.max(0, Math.min(1, input.confidence ?? 0.8)),
      source: input.source || "conversation",
      sourceRef: input.sourceRef,
      createdAt: now,
      updatedAt: now,
      supersedes: null,
      active: true,
    };

    const entries = this.readEntries();

    // Fuzzy deduplicate: similar content OR same subject → merge
    const existing = this.findDuplicate(entries, entry);

    if (existing) {
      existing.confidence = Math.max(existing.confidence, entry.confidence);
      existing.importance = Math.max(existing.importance, entry.importance);
      existing.updatedAt = now;
      // Always prefer the newer content — it may be a correction
      existing.content = entry.content;
      if (entry.tags.length > 0) {
        existing.tags = [...new Set([...existing.tags, ...entry.tags])];
      }
      // Keep the higher-priority category
      if (
        (CATEGORY_PRIORITY[entry.category] ?? 0) >
        (CATEGORY_PRIORITY[existing.category] ?? 0)
      ) {
        existing.category = entry.category;
      }
      this.writeEntries(entries);
      return existing;
    }

    entries.push(entry);
    this.writeEntries(entries);
    return entry;
  }

  /**
   * Find an existing entry that is a near-duplicate of the candidate.
   * Three matching strategies (any one triggers a match):
   *   1. Same category + very similar subject (>=0.8) — e.g. both "name"
   *   2. Very similar content (>=0.7) regardless of category/subject
   *   3. Moderate content similarity (>=0.55) + moderate subject similarity (>0.4)
   */
  private findDuplicate(
    entries: KnowledgeEntry[],
    candidate: KnowledgeEntry,
  ): KnowledgeEntry | undefined {
    return entries.find((e) => {
      if (!e.active) return false;

      // Exact match (fast path)
      if (
        e.subject.toLowerCase() === candidate.subject.toLowerCase() &&
        e.content.toLowerCase() === candidate.content.toLowerCase()
      ) {
        return true;
      }

      const subjectSim = textSimilarity(e.subject, candidate.subject);

      // Strategy 1: Same category + very similar subject = same knowledge
      // e.g. both user_trait with subject "name" → update, not duplicate
      if (e.category === candidate.category && subjectSim >= 0.8) {
        return true;
      }

      // Strategy 2 & 3: Content-based matching
      const contentSim = textSimilarity(e.content, candidate.content);

      // Very similar content = duplicate regardless
      if (contentSim >= 0.7) return true;

      // Moderate content + moderate subject = duplicate
      return contentSim >= 0.55 && subjectSim > 0.4;
    });
  }

  /**
   * Find entries similar to given content (for dedup auditing).
   */
  findSimilar(
    content: string,
    category?: KnowledgeCategory,
    threshold = 0.5,
  ): KnowledgeEntry[] {
    const entries = this.readEntries();
    return entries.filter((e) => {
      if (!e.active) return false;
      if (category && e.category !== category) return false;
      return textSimilarity(e.content, content) > threshold;
    });
  }

  /**
   * Check if content is already stored (across all categories).
   * Used by the analyzer to pre-filter before calling addEntry.
   */
  isDuplicateContent(content: string, threshold = 0.55): boolean {
    return this.readEntries()
      .filter((e) => e.active)
      .some((e) => textSimilarity(e.content, content) >= threshold);
  }

  // ── Update ──────────────────────────────────────────────────────────────

  /**
   * Update an existing entry.
   */
  updateEntry(
    id: string,
    updates: Partial<
      Pick<
        KnowledgeEntry,
        | "content"
        | "importance"
        | "confidence"
        | "tags"
        | "category"
        | "subject"
      >
    >,
  ): KnowledgeEntry | null {
    const entries = this.readEntries();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;

    const now = new Date().toISOString();
    if (updates.content !== undefined) entry.content = updates.content;
    if (updates.importance !== undefined)
      entry.importance = Math.max(0, Math.min(1, updates.importance));
    if (updates.confidence !== undefined)
      entry.confidence = Math.max(0, Math.min(1, updates.confidence));
    if (updates.tags !== undefined)
      entry.tags = [...new Set([...entry.tags, ...updates.tags])];
    if (updates.category !== undefined)
      entry.category = this.validateCategory(updates.category);
    if (updates.subject !== undefined) entry.subject = updates.subject;
    entry.updatedAt = now;

    this.writeEntries(entries);
    return entry;
  }

  /**
   * Relabel an entry's category.
   */
  relabel(id: string, newCategory: KnowledgeCategory): KnowledgeEntry | null {
    return this.updateEntry(id, {
      category: this.validateCategory(newCategory),
    });
  }

  /**
   * Supersede an entry — creates a new entry and marks the old one inactive.
   * Fixed: single write operation instead of the previous double-write.
   */
  supersedeEntry(
    oldId: string,
    newInput: {
      content: string;
      importance?: number;
      confidence?: number;
      tags?: string[];
      source?: KnowledgeEntry["source"];
      sourceRef?: string;
    },
  ): KnowledgeEntry | null {
    const entries = this.readEntries();
    const oldEntry = entries.find((e) => e.id === oldId);
    if (!oldEntry) return null;

    const now = new Date().toISOString();

    // Mark old as inactive
    oldEntry.active = false;
    oldEntry.updatedAt = now;

    // Build new entry inline (avoid calling addEntry which would write separately)
    const newEntry: KnowledgeEntry = {
      id: `k-${Date.now()}-${randomUUID().slice(0, 8)}`,
      category: oldEntry.category,
      subject: oldEntry.subject,
      content: newInput.content,
      tags: newInput.tags || oldEntry.tags,
      importance: Math.max(
        0,
        Math.min(1, newInput.importance ?? oldEntry.importance),
      ),
      confidence: Math.max(
        0,
        Math.min(1, newInput.confidence ?? oldEntry.confidence),
      ),
      source: newInput.source || "conversation",
      sourceRef: newInput.sourceRef,
      createdAt: now,
      updatedAt: now,
      supersedes: oldId,
      active: true,
    };

    entries.push(newEntry);

    // Single write
    this.writeEntries(entries);
    return newEntry;
  }

  // ── Delete ──────────────────────────────────────────────────────────────

  /** Soft-delete by setting active = false. */
  deleteEntry(id: string): boolean {
    const entries = this.readEntries();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return false;

    entry.active = false;
    entry.updatedAt = new Date().toISOString();
    this.writeEntries(entries);
    return true;
  }

  // ── Deduplication ──────────────────────────────────────────────────────

  /**
   * Scan all active entries and merge near-duplicates.
   * Keeps the entry with the highest importance/confidence,
   * merges tags, and soft-deletes the duplicate.
   * Returns the number of entries merged.
   */
  deduplicateAll(similarityThreshold = 0.6): number {
    const entries = this.readEntries();
    const active = entries.filter((e) => e.active);
    const merged = new Set<string>();
    let mergedCount = 0;

    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      if (merged.has(a.id)) continue;

      for (let j = i + 1; j < active.length; j++) {
        const b = active[j];
        if (merged.has(b.id)) continue;

        // Content-first matching (no category gate)
        const contentSim = textSimilarity(a.content, b.content);
        if (contentSim < similarityThreshold) continue;

        // For moderate similarity, also check subject
        if (contentSim < 0.7) {
          const subjectSim = textSimilarity(a.subject, b.subject);
          if (subjectSim <= 0.4) continue;
        }

        // Keep a as the survivor, merge b into a
        a.importance = Math.max(a.importance, b.importance);
        a.confidence = Math.max(a.confidence, b.confidence);
        a.tags = [...new Set([...a.tags, ...b.tags])];
        if (b.content.length > a.content.length) {
          a.content = b.content;
        }
        // Keep the higher-priority category
        if (
          (CATEGORY_PRIORITY[b.category] ?? 0) >
          (CATEGORY_PRIORITY[a.category] ?? 0)
        ) {
          a.category = b.category;
        }
        a.updatedAt = new Date().toISOString();

        // Soft-delete the duplicate
        b.active = false;
        b.updatedAt = a.updatedAt;
        merged.add(b.id);
        mergedCount++;
      }
    }

    if (mergedCount > 0) {
      this.writeEntries(entries);
      console.log(`🧹 Deduplicated ${mergedCount} knowledge entries`);
    }

    return mergedCount;
  }

  // ── Utilities ───────────────────────────────────────────────────────────

  /** Get all active entries (for export/debug). */
  getAllActive(): KnowledgeEntry[] {
    return this.readEntries().filter((e) => e.active);
  }

  /** Get entry count. */
  count(activeOnly = true): number {
    const entries = this.readEntries();
    return activeOnly ? entries.filter((e) => e.active).length : entries.length;
  }

  /** Purge inactive entries older than maxAge. */
  purgeInactive(maxAgeMs = 30 * 24 * 60 * 60 * 1000): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const entries = this.readEntries();
    const kept = entries.filter((e) => e.active || e.updatedAt > cutoff);
    const purged = entries.length - kept.length;
    if (purged > 0) this.writeEntries(kept);
    return purged;
  }
}
