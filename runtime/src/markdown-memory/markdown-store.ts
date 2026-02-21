/**
 * markdown-store.ts — Core read/write helpers for structured Markdown files.
 *
 * Markdown files use a simple format:
 *   # Section Name
 *   - key: value
 *   - key: value
 *
 * This module parses/serializes that format.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";

// ── Types ───────────────────────────────────────────────────────────────────

export interface MarkdownSection {
  heading: string;
  items: MarkdownItem[];
}

export interface MarkdownItem {
  key: string;
  value: string;
}

export interface MarkdownEntry {
  id: string;
  [key: string]: string | number | undefined;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Parse a Markdown file into sections, each with a heading and key-value items.
 */
export function parseMarkdownSections(content: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;

  for (const line of content.split("\n")) {
    const headingMatch = line.match(/^#+\s+(.+)$/);
    if (headingMatch) {
      current = { heading: headingMatch[1].trim(), items: [] };
      sections.push(current);
      continue;
    }

    const itemMatch = line.match(/^-\s+(.+?):\s+(.+)$/);
    if (itemMatch && current) {
      current.items.push({
        key: itemMatch[1].trim(),
        value: itemMatch[2].trim(),
      });
    }
  }

  return sections;
}

/**
 * Parse a structured Markdown file where each ## heading is an entry
 * with key-value list items underneath.
 * Returns an array of entries as key-value records.
 */
export function parseMarkdownEntries(content: string): MarkdownEntry[] {
  const entries: MarkdownEntry[] = [];
  let current: Record<string, string | number | undefined> | null = null;

  for (const line of content.split("\n")) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (current) entries.push(current as MarkdownEntry);
      current = { id: randomUUID(), _heading: headingMatch[1].trim() };
      continue;
    }

    const itemMatch = line.match(/^-\s+(.+?):\s+(.+)$/);
    if (itemMatch && current) {
      const key = itemMatch[1].trim();
      const rawValue = itemMatch[2].trim();
      // Auto-convert numeric values
      const numVal = Number(rawValue);
      current[key] =
        Number.isFinite(numVal) && rawValue !== "" ? numVal : rawValue;
    }
  }

  if (current) entries.push(current as MarkdownEntry);
  return entries;
}

// ── Serialization ───────────────────────────────────────────────────────────

/**
 * Serialize sections back to Markdown format.
 */
export function serializeMarkdownSections(sections: MarkdownSection[]): string {
  const parts: string[] = [];

  for (const section of sections) {
    parts.push(`# ${section.heading}\n`);
    for (const item of section.items) {
      parts.push(`- ${item.key}: ${item.value}`);
    }
    parts.push("");
  }

  return parts.join("\n");
}

/**
 * Serialize an array of entries to structured Markdown with ## headings.
 */
export function serializeMarkdownEntries(
  entries: MarkdownEntry[],
  headingKey = "_heading",
): string {
  const parts: string[] = [];

  for (const entry of entries) {
    const heading = entry[headingKey] || entry.id;
    parts.push(`## ${heading}\n`);
    for (const [key, value] of Object.entries(entry)) {
      if (key === "id" || key === headingKey) continue;
      if (value === undefined) continue;
      parts.push(`- ${key}: ${value}`);
    }
    parts.push("");
  }

  return parts.join("\n");
}

// ── File I/O ────────────────────────────────────────────────────────────────

/**
 * Read a Markdown file, returning empty string if it doesn't exist.
 */
export function readMarkdownFile(filePath: string): string {
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf-8");
}

/**
 * Write content to a file atomically (temp file + rename).
 * Creates parent directories if needed.
 */
export function writeMarkdownFile(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);
}

/**
 * Append content to the end of a Markdown file.
 * Creates the file if it doesn't exist.
 */
export function appendMarkdownFile(filePath: string, content: string): void {
  const existing = readMarkdownFile(filePath);
  const separator = existing && !existing.endsWith("\n") ? "\n" : "";
  writeMarkdownFile(filePath, existing + separator + content);
}

/**
 * Upsert a key-value item under a specific section heading.
 * If the section doesn't exist, it's created.
 * If the key already exists, the value is updated.
 */
export function upsertMarkdownItem(
  filePath: string,
  sectionHeading: string,
  key: string,
  value: string,
): void {
  const content = readMarkdownFile(filePath);
  const sections = parseMarkdownSections(content);

  let section = sections.find((s) => s.heading === sectionHeading);
  if (!section) {
    section = { heading: sectionHeading, items: [] };
    sections.push(section);
  }

  const existingItem = section.items.find((i) => i.key === key);
  if (existingItem) {
    existingItem.value = value;
  } else {
    section.items.push({ key, value });
  }

  writeMarkdownFile(filePath, serializeMarkdownSections(sections));
}

/**
 * Remove a key-value item from a section.
 * Returns true if removed, false if not found.
 */
export function removeMarkdownItem(
  filePath: string,
  sectionHeading: string,
  key: string,
): boolean {
  const content = readMarkdownFile(filePath);
  const sections = parseMarkdownSections(content);

  const section = sections.find((s) => s.heading === sectionHeading);
  if (!section) return false;

  const idx = section.items.findIndex((i) => i.key === key);
  if (idx === -1) return false;

  section.items.splice(idx, 1);
  writeMarkdownFile(filePath, serializeMarkdownSections(sections));
  return true;
}

/**
 * Ensure a directory exists.
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}
