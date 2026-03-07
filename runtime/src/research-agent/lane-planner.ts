import { canonicalizeUrl, isHttpUrl } from "../web-agent/url-utils.js";
import type { LanePlanInput, ResearchLane, SearchResult } from "./types.js";

export type LaneSearchFn = (
  query: string,
  limit: number,
) => Promise<SearchResult[]>;

export type LaneLLMFn = (
  prompt: string,
  history?: Array<{ role: string; content: string }>,
) => Promise<string>;

/**
 * Fallback focus areas used when the LLM fails or is unavailable.
 */
const FALLBACK_FOCUS_AREAS = [
  "latest developments",
  "primary sources and official statements",
  "independent analysis and expert perspectives",
  "counterarguments and risks",
  "data, metrics, and evidence quality",
];

export class ResearchLanePlanner {
  constructor(
    private readonly searchWeb: LaneSearchFn,
    private readonly llmChat: LaneLLMFn,
  ) {}

  async planLanes(input: LanePlanInput): Promise<ResearchLane[]> {
    const topic = String(input.topic || "").trim();
    if (!topic) throw new Error("topic is required");

    const desiredCount = Math.max(2, Math.min(4, input.subAgentCount || 2));

    // LLM-powered topic decomposition
    const llmPlan = await this.llmDecompose(topic, input, desiredCount);
    const claimedUrls = new Set<string>();
    const lanes: ResearchLane[] = [];

    for (let index = 0; index < llmPlan.lanes.length; index++) {
      const planned = llmPlan.lanes[index];

      const targetPages = await this.buildTargetPages({
        topic,
        focusArea: planned.focusArea,
        seedQueries: planned.seedQueries,
        claimedUrls,
      });

      lanes.push({
        id: `lane-${index + 1}`,
        focusArea: planned.focusArea,
        objective: planned.objective,
        seedQueries: planned.seedQueries,
        targetPages,
        watchFor: planned.watchFor,
        requiredActions: [
          "Visit assigned pages first",
          "Extract concrete evidence with citations",
          "Flag contradictions and uncertain claims",
          "Only deviate when assigned pages are weak or inaccessible",
        ],
      });
    }

    this.deduplicatePrimaryPages(lanes);
    return lanes;
  }

  /**
   * LLM-powered decomposition of a research topic into orthogonal lanes.
   * Falls back to heuristics if the LLM call fails.
   */
  private async llmDecompose(
    topic: string,
    input: LanePlanInput,
    desiredCount: number,
  ): Promise<LLMDecompositionResult> {
    try {
      const contextParts: string[] = [];
      if (input.focusHints?.length) {
        contextParts.push(
          `User-specified focus areas: ${JSON.stringify(input.focusHints)}`,
        );
      }
      if (input.unresolvedQuestions?.length) {
        contextParts.push(
          `Unresolved questions from prior research: ${JSON.stringify(input.unresolvedQuestions.slice(0, 8))}`,
        );
      }
      if (input.priorSession) {
        contextParts.push(
          `Prior research findings: ${input.priorSession.keyFindings?.slice(0, 5).join("; ") || "none"}`,
        );
        contextParts.push(
          `Prior disagreements: ${input.priorSession.disagreements?.slice(0, 5).join("; ") || "none"}`,
        );
      }

      const prompt = [
        "You are a research planning expert. Decompose the following research topic into orthogonal investigation lanes.",
        "",
        "RULES:",
        `- Produce exactly ${desiredCount} lanes.`,
        "- Each lane MUST investigate a meaningfully different angle — avoid overlap.",
        "- Each lane needs 2-3 targeted search queries that would find high-quality sources.",
        "- Queries should be specific and varied — NOT just 'topic focusArea latest'.",
        "- Include at least one query targeting primary/official sources per lane.",
        "- watchFor items should be specific claims, evidence types, or signals to look for.",
        "",
        "Return JSON only with this exact shape:",
        "{",
        '  "lanes": [',
        "    {",
        '      "focusArea": "short label for this investigation angle",',
        '      "objective": "one-sentence description of what this lane investigates",',
        '      "seedQueries": ["specific search query 1", "specific search query 2"],',
        '      "watchFor": ["specific claim/signal to look for", "another signal"]',
        "    }",
        "  ]",
        "}",
        "",
        `Topic: ${topic}`,
        contextParts.length > 0 ? `\nContext:\n${contextParts.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const raw = await this.llmChat(prompt, []);
      const parsed = parseJsonObject(raw);

      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as any).lanes)
      ) {
        const llmLanes = (parsed as any).lanes as any[];
        const validated: PlannedLane[] = [];
        const seenFocus = new Set<string>();

        for (const lane of llmLanes) {
          if (validated.length >= desiredCount) break;
          const focusArea = sanitize(lane?.focusArea, 160);
          if (!focusArea) continue;
          const focusKey = focusArea.toLowerCase();
          if (seenFocus.has(focusKey)) continue;
          seenFocus.add(focusKey);

          const seedQueries = uniqueStrings(lane?.seedQueries, 3, 180);
          if (seedQueries.length === 0) {
            // Generate basic queries if LLM didn't provide any
            seedQueries.push(
              `${topic} ${focusArea}`,
              `${topic} ${focusArea} latest evidence`,
            );
          }

          validated.push({
            focusArea,
            objective:
              sanitize(lane?.objective, 300) ||
              `Investigate ${focusArea} for: ${topic}`,
            seedQueries,
            watchFor:
              uniqueStrings(lane?.watchFor, 4, 200).length > 0
                ? uniqueStrings(lane?.watchFor, 4, 200)
                : [
                    `Claims directly tied to ${focusArea}`,
                    "Dates and recency of evidence",
                  ],
          });
        }

        if (validated.length >= desiredCount) {
          console.log(
            `   🧠 [LLM planner] Decomposed topic into ${validated.length} lanes: ${validated.map((l) => l.focusArea).join(", ")}`,
          );
          return { lanes: validated };
        }

        // LLM gave fewer lanes than needed — pad with heuristic
        console.warn(
          `   ⚠️ [LLM planner] Got ${validated.length}/${desiredCount} lanes — padding with heuristic`,
        );
        return {
          lanes: this.padWithHeuristic(validated, topic, input, desiredCount),
        };
      }

      console.warn(
        "   ⚠️ [LLM planner] Failed to parse LLM output — falling back to heuristic",
      );
    } catch (err: any) {
      console.warn(
        `   ⚠️ [LLM planner] LLM call failed: ${err?.message?.slice(0, 80)} — falling back to heuristic`,
      );
    }

    return { lanes: this.buildHeuristicLanes(topic, input, desiredCount) };
  }

  /**
   * Heuristic fallback — picks focus areas from hints/defaults
   * and generates template-based seed queries.
   */
  private buildHeuristicLanes(
    topic: string,
    input: LanePlanInput,
    desiredCount: number,
  ): PlannedLane[] {
    const focusAreas = this.pickFocusAreas(input, desiredCount);
    return focusAreas.map((focusArea) => ({
      focusArea,
      objective: `Investigate ${focusArea} for: ${topic}`,
      seedQueries: this.buildSeedQueries(topic, focusArea),
      watchFor: this.buildWatchList(focusArea),
    }));
  }

  /**
   * Pad an incomplete LLM result with heuristic lanes.
   */
  private padWithHeuristic(
    existing: PlannedLane[],
    topic: string,
    input: LanePlanInput,
    desiredCount: number,
  ): PlannedLane[] {
    const existingFocus = new Set(
      existing.map((l) => l.focusArea.toLowerCase()),
    );
    const heuristicLanes = this.buildHeuristicLanes(topic, input, desiredCount);
    const padded = [...existing];

    for (const lane of heuristicLanes) {
      if (padded.length >= desiredCount) break;
      if (existingFocus.has(lane.focusArea.toLowerCase())) continue;
      padded.push(lane);
    }

    // If still short, add numbered angles
    while (padded.length < desiredCount) {
      padded.push({
        focusArea: `angle-${padded.length + 1}`,
        objective: `Investigate angle-${padded.length + 1} for: ${topic}`,
        seedQueries: [`${topic} angle ${padded.length + 1}`],
        watchFor: ["Evidence quality", "Contradictions"],
      });
    }

    return padded;
  }

  private pickFocusAreas(input: LanePlanInput, desiredCount: number): string[] {
    const candidates = [
      ...(Array.isArray(input.focusHints) ? input.focusHints : []),
      ...(Array.isArray(input.unresolvedQuestions)
        ? input.unresolvedQuestions
        : []),
      ...(input.priorSession?.openQuestions || []),
      ...FALLBACK_FOCUS_AREAS,
    ];

    const unique: string[] = [];
    const seen = new Set<string>();

    for (const raw of candidates) {
      const focus = sanitize(raw, 160);
      if (!focus) continue;
      const key = focus.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(focus);
      if (unique.length >= desiredCount) break;
    }

    while (unique.length < desiredCount) {
      unique.push(`angle-${unique.length + 1}`);
    }
    return unique;
  }

  private buildSeedQueries(topic: string, focusArea: string): string[] {
    const seeds = [
      `${topic} ${focusArea}`,
      `${topic} ${focusArea} latest`,
      `${topic} ${focusArea} evidence`,
    ];

    const out: string[] = [];
    const seen = new Set<string>();
    for (const seed of seeds) {
      const q = seed.replace(/\s+/g, " ").trim().slice(0, 180);
      if (!q) continue;
      const key = q.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(q);
    }
    return out;
  }

  private async buildTargetPages(params: {
    topic: string;
    focusArea: string;
    seedQueries: string[];
    claimedUrls: Set<string>;
  }): Promise<string[]> {
    const collected: string[] = [];

    for (const query of params.seedQueries) {
      const results = await this.safeSearch(query, 8);
      for (const result of results) {
        const canonical = canonicalizeUrl(String(result.url || ""));
        if (!isHttpUrl(canonical)) continue;
        if (params.claimedUrls.has(canonical)) continue;
        params.claimedUrls.add(canonical);
        collected.push(canonical);
        if (collected.length >= 5) return collected;
      }
    }

    // Ensure each lane still has 3-5 targets even when search is sparse.
    for (const fallback of this.buildFallbackUrls(
      params.topic,
      params.focusArea,
    )) {
      const canonical = canonicalizeUrl(fallback);
      if (!isHttpUrl(canonical)) continue;
      if (params.claimedUrls.has(canonical)) continue;
      params.claimedUrls.add(canonical);
      collected.push(canonical);
      if (collected.length >= 5) break;
    }

    return collected.slice(0, Math.max(3, Math.min(5, collected.length)));
  }

  /**
   * High-quality fallback sources instead of search engine result pages.
   */
  private buildFallbackUrls(topic: string, focusArea: string): string[] {
    const topicSlug = encodeURIComponent(topic.replace(/\s+/g, " ").trim());
    const wikiSlug = topic.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
    return [
      `https://en.wikipedia.org/wiki/${wikiSlug}`,
      `https://www.reuters.com/site-search/?query=${topicSlug}`,
      `https://scholar.google.com/scholar?q=${topicSlug}+${encodeURIComponent(focusArea)}`,
      `https://www.bbc.com/search?q=${topicSlug}`,
      `https://apnews.com/search#?q=${topicSlug}`,
    ];
  }

  private buildWatchList(focusArea: string): string[] {
    return [
      `Claims directly tied to ${focusArea}`,
      "Dates and recency of evidence",
      "Primary-source links and data provenance",
      "Contradictions with other lanes",
    ];
  }

  /**
   * Deduplicate overlapping primary pages across lanes instead of throwing.
   * When a duplicate is found, shift the lane to use its next target page as primary.
   */
  private deduplicatePrimaryPages(lanes: ResearchLane[]): void {
    const seen = new Set<string>();
    for (const lane of lanes) {
      if (lane.targetPages.length === 0) continue;

      // Find the first non-duplicate page to use as primary
      let shifted = false;
      for (let i = 0; i < lane.targetPages.length; i++) {
        const canonical = canonicalizeUrl(lane.targetPages[i]);
        if (!canonical || !isHttpUrl(canonical)) continue;
        if (!seen.has(canonical)) {
          seen.add(canonical);
          if (i > 0) {
            // Move this page to the front
            const [page] = lane.targetPages.splice(i, 1);
            lane.targetPages.unshift(page);
            console.log(
              `   🔄 [Lane ${lane.id}] Shifted primary page to avoid overlap: ${canonical.slice(0, 60)}`,
            );
          }
          shifted = true;
          break;
        }
      }

      if (!shifted) {
        // All target pages are duplicates — add the first one anyway
        const primary = canonicalizeUrl(lane.targetPages[0] || "");
        if (primary && isHttpUrl(primary)) {
          seen.add(primary);
        }
      }
    }
  }

  private async safeSearch(
    query: string,
    limit: number,
  ): Promise<SearchResult[]> {
    try {
      const results = await this.searchWeb(query, limit);
      if (!Array.isArray(results)) return [];
      return results
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          title: String((item as any).title || ""),
          url: String((item as any).url || ""),
          snippet: String((item as any).snippet || ""),
        }));
    } catch {
      return [];
    }
  }
}

// --- Internal types ---

interface PlannedLane {
  focusArea: string;
  objective: string;
  seedQueries: string[];
  watchFor: string[];
}

interface LLMDecompositionResult {
  lanes: PlannedLane[];
}

// --- Utilities ---

function parseJsonObject(text: string): unknown | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Find the outermost balanced braces instead of greedy regex
    const start = raw.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let end = -1;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === "{") depth++;
      else if (raw[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function sanitize(value: unknown, maxLen: number): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function uniqueStrings(
  raw: unknown,
  limit: number,
  maxLen: number = 400,
): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const value = sanitize(item, maxLen);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}
