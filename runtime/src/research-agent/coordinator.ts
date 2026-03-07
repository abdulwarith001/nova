import type { Runtime } from "../index.js";
import type { ToolExecutionContext } from "../tools.js";
import {
  ResearchSessionStore,
  type ResearchSessionSource,
} from "../research-session-store.js";
import { canonicalizeUrl, isHttpUrl } from "../web-agent/url-utils.js";
import { ResearchLanePlanner } from "./lane-planner.js";
import type {
  DeepResearchInput,
  DeepResearchResult,
  LaneReport,
  MainBranchReport,
  ResearchLane,
  RoundSynthesis,
  SearchResult,
} from "./types.js";

interface DeepResearchCoordinatorOptions {
  runtime: Runtime;
  agent: {
    chat(
      prompt: string,
      history?: Array<{ role: string; content: string }>,
    ): Promise<string>;
  };
  sessionStore?: ResearchSessionStore;
  planner?: ResearchLanePlanner;
}

interface PageEvidence {
  url: string;
  title: string;
  snippet: string;
  source?: ResearchSessionSource;
  success: boolean;
}

const MAX_LANES = 4;
const MIN_LANES = 2;
const MIN_CONFIDENCE = 0.78;

export class DeepResearchCoordinator {
  private readonly runtime: Runtime;
  private readonly agent: DeepResearchCoordinatorOptions["agent"];
  private readonly sessionStore: ResearchSessionStore;
  private readonly planner: ResearchLanePlanner;

  constructor(options: DeepResearchCoordinatorOptions) {
    this.runtime = options.runtime;
    this.agent = options.agent;
    this.sessionStore = options.sessionStore || new ResearchSessionStore();
    this.planner =
      options.planner ||
      new ResearchLanePlanner(
        (query, limit) => this.searchWeb(query, limit),
        (prompt, history) => this.agent.chat(prompt, history),
      );
  }

  async runDeepResearch(
    input: DeepResearchInput,
    context?: ToolExecutionContext,
  ): Promise<DeepResearchResult> {
    const topic = this.clean(input.topic, 500);
    if (!topic) throw new Error("topic is required");
    console.log(
      `\n🔬 [deep_research] Starting research: "${topic.slice(0, 100)}"`,
    );

    const sessionId = this.normalizeSessionId(
      context?.sessionId || `research-${Date.now()}`,
    );
    const resetRequested = Boolean(input.resetSession) || isResetPhrase(topic);
    if (resetRequested) this.sessionStore.clear(sessionId);

    const previous = resetRequested
      ? undefined
      : this.sessionStore.getActive(sessionId);
    const continued = !!previous;

    const subAgentCount = this.resolveSubAgentCount(topic, input.subAgentCount);
    const maxRounds = this.resolveMaxRounds(input.maxRounds);
    const sourceAccumulator = new SourceAccumulator(previous?.sources || []);
    const findings = new StringAccumulator(previous?.keyFindings || []);
    const disagreements = new StringAccumulator(previous?.disagreements || []);

    let unresolved = this.mergeHints(
      previous?.openQuestions || [],
      Array.isArray(input.focusHints) ? input.focusHints : [],
    );
    let laneSummary: Array<{
      focusArea: string;
      pagesVisited: string[];
      notableDeviations: string[];
    }> = previous?.laneSummary || [];
    let finalSynthesis: RoundSynthesis = {
      answer: "",
      confidence: previous?.confidence || 0.55,
      keyFindings: previous?.keyFindings || [],
      disagreements: previous?.disagreements || [],
      openQuestions: previous?.openQuestions || [],
      followUpQuestions: previous?.followUpQuestions || [],
    };
    let roundsUsed = 0;
    const visitedUrls = new Set<string>();

    // Pre-populate visited URLs from prior session to avoid re-scraping (#21)
    if (previous?.laneSummary) {
      for (const lane of previous.laneSummary) {
        for (const url of lane.pagesVisited || []) {
          const canonical = canonicalizeUrl(url);
          if (isHttpUrl(canonical)) visitedUrls.add(canonical);
        }
      }
    }

    for (let round = 1; round <= maxRounds; round++) {
      roundsUsed = round;
      console.log(
        `\n📋 [deep_research] Round ${round}/${maxRounds} — planning lanes...`,
      );
      const lanes = await this.planner.planLanes({
        topic,
        focusHints: this.mergeHints(
          Array.isArray(input.focusHints) ? input.focusHints : [],
          round === 1 ? [] : unresolved,
        ),
        unresolvedQuestions: unresolved,
        subAgentCount,
        priorSession: previous,
      });

      const claimedUrls = new Set<string>();
      for (const lane of lanes) {
        for (const url of lane.targetPages) {
          const canonical = canonicalizeUrl(url);
          if (isHttpUrl(canonical)) claimedUrls.add(canonical);
        }
      }

      console.log(
        `   📊 Planned ${lanes.length} lanes: ${lanes.map((l) => l.focusArea).join(", ")}`,
      );

      const lanePromises = lanes.map((lane) =>
        this.runLane(lane, {
          parentSessionId: sessionId,
          round,
          claimedUrls,
          visitedUrls,
        }),
      );
      const mainPromise = this.runMainBranch(topic, lanes, {
        parentSessionId: sessionId,
        round,
      });

      // Use Promise.allSettled so partial lane failures don't crash the run (#1)
      const [mainResult, ...laneResults] = await Promise.allSettled([
        mainPromise,
        ...lanePromises,
      ]);

      const mainBranch: MainBranchReport =
        mainResult.status === "fulfilled"
          ? mainResult.value
          : {
              summary: "Main branch failed.",
              keyFindings: [],
              openQuestions: [],
              confidence: 0.4,
              sources: [],
            };
      if (mainResult.status === "rejected") {
        console.error(
          `   ❌ [deep_research] Main branch failed: ${mainResult.reason?.message || mainResult.reason}`,
        );
      }

      const laneReports: LaneReport[] = [];
      for (let i = 0; i < laneResults.length; i++) {
        const result = laneResults[i];
        if (result.status === "fulfilled") {
          laneReports.push(result.value);
        } else {
          console.error(
            `   ❌ [deep_research] Lane ${i + 1} failed: ${result.reason?.message || result.reason}`,
          );
        }
      }
      if (laneReports.length === 0 && mainResult.status === "rejected") {
        console.error(
          "   ❌ [deep_research] All lanes and main branch failed.",
        );
        break;
      }

      laneSummary = laneReports.map((lane) => ({
        focusArea: lane.focusArea,
        pagesVisited: lane.pagesVisited.slice(0, 8),
        notableDeviations: lane.routeDeviations.slice(0, 6),
      }));

      for (const lane of laneReports) {
        sourceAccumulator.addMany(lane.sources);
        findings.addMany(lane.keyFindings);
      }
      sourceAccumulator.addMany(mainBranch.sources);
      findings.addMany(mainBranch.keyFindings);

      finalSynthesis = await this.synthesizeRound({
        topic,
        round,
        laneReports,
        mainBranch,
        unresolvedFromPriorRound: unresolved,
      });

      findings.addMany(finalSynthesis.keyFindings);
      disagreements.addMany(finalSynthesis.disagreements);
      unresolved = finalSynthesis.openQuestions.slice(0, 12);

      if (
        finalSynthesis.confidence >= MIN_CONFIDENCE
        // finalSynthesis.openQuestions.length <= 2
      ) {
        console.log(
          `   ✅ [deep_research] Round ${round} conclusive (confidence: ${finalSynthesis.confidence.toFixed(2)})`,
        );
        break;
      } else {
        console.log(
          `   🔄 [deep_research] Round ${round} inconclusive (confidence: ${finalSynthesis.confidence.toFixed(2)}, open questions: ${finalSynthesis.openQuestions.length})`,
        );
      }
    }

    const confidence = this.clamp(
      finalSynthesis.confidence,
      sourceAccumulator.count() > 0 ? 0.7 : 0.45,
      1,
    );
    const needsFollowUp =
      confidence < MIN_CONFIDENCE || finalSynthesis.openQuestions.length > 0;

    const followUpQuestions = needsFollowUp
      ? this.ensureFollowUps(
          finalSynthesis.followUpQuestions,
          finalSynthesis.openQuestions,
          topic,
        )
      : [];

    const keyFindings = findings.list(12);
    const disagreementList = disagreements.list(10);
    const openQuestions = this.uniqueStrings(finalSynthesis.openQuestions, 12);
    const sources = sourceAccumulator.list(12);

    const structuredAnswer = this.buildStructuredAnswer({
      topic,
      narrative: finalSynthesis.answer,
      keyFindings,
      disagreements: disagreementList,
      openQuestions,
      needsFollowUp,
      followUpQuestions,
    });

    const uncertainty = needsFollowUp
      ? "Some questions remain open; follow-up research is recommended."
      : "No major unresolved gaps were detected in this pass.";

    const stored = this.sessionStore.upsert(sessionId, {
      topic,
      summary: structuredAnswer.slice(0, 2500),
      lastAnswer: structuredAnswer,
      keyFindings,
      disagreements: disagreementList,
      openQuestions,
      followUpQuestions,
      sources,
      confidence,
      rounds: roundsUsed,
      laneSummary,
    });

    return {
      answer: structuredAnswer,
      sources,
      uncertainty,
      confidence,
      keyFindings,
      disagreements: disagreementList,
      openQuestions,
      followUpQuestions,
      needsFollowUp,
      session: {
        sessionId: stored.sessionId,
        continued,
        expiresAt: stored.expiresAt,
      },
      laneSummary,
      agentHint: needsFollowUp
        ? "The research is not fully conclusive. Present the findings to the user and suggest the follow-up questions listed above. If the user asks a follow-up, call deep_research again."
        : "The research is conclusive. Present the answer with cited sources. If the user asks a follow-up question on this topic, call deep_research again to continue the session.",
    };
  }

  private async runLane(
    lane: ResearchLane,
    options: {
      parentSessionId: string;
      round: number;
      claimedUrls: Set<string>;
      visitedUrls: Set<string>;
    },
  ): Promise<LaneReport> {
    const pagesVisited: string[] = [];
    const routeDeviations: string[] = [];
    const evidenceChunks: string[] = [];
    const sourceAccumulator = new SourceAccumulator();
    console.log(
      `   🔍 [Lane ${lane.id}] "${lane.focusArea}" — visiting ${lane.targetPages.length} pages`,
    );

    for (const url of lane.targetPages.slice(0, 5)) {
      const canonical = canonicalizeUrl(url);
      if (options.visitedUrls.has(canonical)) {
        console.log(
          `      ⏭️ [skip] Already visited: ${canonical.slice(0, 60)}`,
        );
        continue;
      }
      options.visitedUrls.add(canonical);
      const evidence = await this.collectPageEvidence(
        url,
        `${options.parentSessionId}:lane:${lane.id}:r${options.round}`,
      );
      pagesVisited.push(evidence.url);
      if (evidence.source) sourceAccumulator.add(evidence.source);
      if (evidence.snippet) {
        evidenceChunks.push(`URL: ${evidence.url}\n${evidence.snippet}`);
      }
    }

    // LLM-driven mid-lane evaluation: assess evidence quality and decide whether to search for more
    const needsMoreEvidence = await this.evaluateEvidenceQuality(
      lane,
      evidenceChunks,
    );

    if (needsMoreEvidence || evidenceChunks.length < 2) {
      // Search for additional sources using lane's seed queries
      const queryToUse = needsMoreEvidence
        ? `${lane.focusArea} primary sources evidence ${new Date().getFullYear()}`
        : lane.seedQueries[0];
      const alternatives = await this.searchWeb(queryToUse, 6);
      for (const candidate of alternatives) {
        const canonical = canonicalizeUrl(candidate.url);
        if (!isHttpUrl(canonical)) continue;
        if (options.claimedUrls.has(canonical)) continue;
        options.claimedUrls.add(canonical);

        const evidence = await this.collectPageEvidence(
          canonical,
          `${options.parentSessionId}:lane:${lane.id}:alt:r${options.round}`,
        );
        pagesVisited.push(evidence.url);
        if (evidence.source) sourceAccumulator.add(evidence.source);
        if (evidence.snippet) {
          evidenceChunks.push(`URL: ${evidence.url}\n${evidence.snippet}`);
        }

        routeDeviations.push(
          needsMoreEvidence
            ? `Visited ${canonical} because LLM evaluation found existing evidence insufficient for ${lane.focusArea}.`
            : `Visited ${canonical} as a backup because assigned pages lacked strong evidence.`,
        );
        if (evidenceChunks.length >= 4) break;
      }
    }

    // Adaptive evidence window: allocate more chars when fewer pages succeeded
    const maxEvidencePerChunk =
      evidenceChunks.length <= 2
        ? 5500
        : evidenceChunks.length <= 3
          ? 4500
          : 3500;
    const trimmedEvidence = evidenceChunks.map((chunk) =>
      chunk.length > maxEvidencePerChunk
        ? chunk.slice(0, maxEvidencePerChunk) + "..."
        : chunk,
    );

    console.log(
      `   📝 [Lane ${lane.id}] Collected ${evidenceChunks.length} evidence chunks from ${pagesVisited.length} pages — analyzing...`,
    );
    const analysis = await this.agent.chat(
      this.buildLaneAnalysisPrompt({
        lane,
        pagesVisited,
        routeDeviations,
        evidenceChunks: trimmedEvidence,
      }),
      [],
    );

    const parsed = parseJsonObject(analysis) as any;
    const keyFindings = this.uniqueStrings(parsed?.keyFindings, 10);
    const openQuestions = this.uniqueStrings(parsed?.openQuestions, 8);
    const llmDeviations = this.uniqueStrings(parsed?.notableDeviations, 6);

    return {
      laneId: lane.id,
      focusArea: lane.focusArea,
      summary:
        this.clean(parsed?.summary, 2000) ||
        `Lane ${lane.focusArea} completed with ${pagesVisited.length} page visits.`,
      keyFindings,
      openQuestions,
      confidence: this.clamp(parsed?.confidence, 0.55, 1),
      sources: sourceAccumulator.list(8),
      pagesVisited: this.uniqueUrls(pagesVisited, 8),
      routeDeviations: this.uniqueStrings(
        [...routeDeviations, ...llmDeviations],
        8,
      ),
    };
  }

  /**
   * LLM-driven mid-lane evidence evaluation.
   * Asks the LLM if the collected evidence is sufficient for the lane's focus area,
   * or if additional sources should be searched.
   */
  private async evaluateEvidenceQuality(
    lane: ResearchLane,
    evidenceChunks: string[],
  ): Promise<boolean> {
    if (evidenceChunks.length === 0) return true;
    if (evidenceChunks.length >= 4) return false;

    try {
      const prompt = [
        "You are a research sub-agent evaluating evidence quality.",
        "Based on the evidence collected so far, determine if MORE sources are needed.",
        "",
        'Return JSON only: {"needsMore": true/false, "reason": "brief reason"}',
        "",
        `Focus area: ${lane.focusArea}`,
        `Objective: ${lane.objective}`,
        `Evidence collected (${evidenceChunks.length} chunks):`,
        truncate(evidenceChunks.join("\n---\n"), 4000),
      ].join("\n");

      const raw = await this.agent.chat(prompt, []);
      const parsed = parseJsonObject(raw) as any;
      const needsMore = Boolean(parsed?.needsMore);
      if (needsMore) {
        console.log(
          `      🔎 [Lane ${lane.id}] LLM says more evidence needed: ${this.clean(parsed?.reason, 80)}`,
        );
      }
      return needsMore;
    } catch {
      return evidenceChunks.length < 2;
    }
  }

  private async runMainBranch(
    topic: string,
    lanes: ResearchLane[],
    options: { parentSessionId: string; round: number },
  ): Promise<MainBranchReport> {
    const avoided = new Set<string>();
    for (const lane of lanes) {
      for (const url of lane.targetPages) {
        const canonical = canonicalizeUrl(url);
        if (isHttpUrl(canonical)) avoided.add(canonical);
      }
    }

    const broadQuery = `${topic} primary source analysis latest`;
    const results = await this.searchWeb(broadQuery, 10);
    const selected: string[] = [];

    for (const result of results) {
      const canonical = canonicalizeUrl(result.url);
      if (!isHttpUrl(canonical)) continue;
      if (avoided.has(canonical)) continue;
      selected.push(canonical);
      if (selected.length >= 3) break;
    }

    const sourceAccumulator = new SourceAccumulator();
    const evidenceChunks: string[] = [];

    for (const url of selected) {
      const evidence = await this.collectPageEvidence(
        url,
        `${options.parentSessionId}:main:r${options.round}`,
      );
      if (evidence.source) sourceAccumulator.add(evidence.source);
      if (evidence.snippet) {
        evidenceChunks.push(`URL: ${evidence.url}\n${evidence.snippet}`);
      }
    }

    const analysis = await this.agent.chat(
      [
        "You are the lead research branch.",
        "Analyze broad cross-lane signals and unresolved gaps.",
        "Return JSON only:",
        '{"summary":"...","keyFindings":["..."],"openQuestions":["..."],"confidence":0.0}',
        `Topic: ${topic}`,
        `Evidence:\n${truncate(evidenceChunks.join("\n\n"), 12000) || "No additional evidence collected."}`,
      ].join("\n\n"),
      [],
    );

    const parsed = parseJsonObject(analysis) as any;
    return {
      summary:
        this.clean(parsed?.summary, 2000) ||
        "Main branch completed broad synthesis.",
      keyFindings: this.uniqueStrings(parsed?.keyFindings, 8),
      openQuestions: this.uniqueStrings(parsed?.openQuestions, 8),
      confidence: this.clamp(parsed?.confidence, 0.6, 1),
      sources: sourceAccumulator.list(6),
    };
  }

  private async synthesizeRound(params: {
    topic: string;
    round: number;
    laneReports: LaneReport[];
    mainBranch: MainBranchReport;
    unresolvedFromPriorRound: string[];
  }): Promise<RoundSynthesis> {
    const prompt = [
      "You are coordinating multiple research agents.",
      "Critique the reports, identify disagreements, and decide if evidence is conclusive.",
      "Your answer field must be a COMPREHENSIVE narrative that covers all major findings, evidence, viewpoints, and nuances. Do not summarize briefly — give a thorough, detailed analysis.",
      "Return JSON only with this shape:",
      '{"answer":"...","confidence":0.0,"keyFindings":["..."],"disagreements":["..."],"openQuestions":["..."],"followUpQuestions":["..."]}',
      `Topic: ${params.topic}`,
      `Round: ${params.round}`,
      `Prior unresolved questions: ${JSON.stringify(params.unresolvedFromPriorRound.slice(0, 12))}`,
      `Lane reports: ${truncate(JSON.stringify(params.laneReports), 14000)}`,
      `Main branch report: ${truncate(JSON.stringify(params.mainBranch), 6000)}`,
    ].join("\n\n");

    console.log(`   🧪 [deep_research] Synthesizing round ${params.round}...`);
    const raw = await this.agent.chat(prompt, []);
    const parsed = parseJsonObject(raw) as any;

    return {
      answer:
        this.clean(parsed?.answer, 6000) ||
        "Synthesis completed but confidence remains limited.",
      confidence: this.clamp(parsed?.confidence, 0.6, 1),
      keyFindings: this.uniqueStrings(parsed?.keyFindings, 12),
      disagreements: this.uniqueStrings(parsed?.disagreements, 10),
      openQuestions: this.uniqueStrings(parsed?.openQuestions, 12),
      followUpQuestions: this.uniqueStrings(parsed?.followUpQuestions, 12),
    };
  }

  private buildStructuredAnswer(params: {
    topic: string;
    narrative: string;
    keyFindings: string[];
    disagreements: string[];
    openQuestions: string[];
    needsFollowUp: boolean;
    followUpQuestions: string[];
  }): string {
    const lines: string[] = [];
    lines.push(`Research Topic: ${params.topic}`);
    lines.push("");
    lines.push("Final Answer:");
    lines.push(params.narrative || "No conclusive answer was produced.");

    lines.push("");
    lines.push("Key Findings:");
    if (params.keyFindings.length === 0) {
      lines.push("- No strong findings yet.");
    } else {
      for (const finding of params.keyFindings) {
        lines.push(`- ${finding}`);
      }
    }

    lines.push("");
    lines.push("Disagreements:");
    if (params.disagreements.length === 0) {
      lines.push("- No major disagreements detected.");
    } else {
      for (const disagreement of params.disagreements) {
        lines.push(`- ${disagreement}`);
      }
    }

    lines.push("");
    lines.push("Open Questions:");
    if (params.openQuestions.length === 0) {
      lines.push("- None.");
    } else {
      for (const question of params.openQuestions) {
        lines.push(`- ${question}`);
      }
    }

    if (params.needsFollowUp) {
      lines.push("");
      lines.push("Suggested Follow-up Questions:");
      for (const followUp of params.followUpQuestions) {
        lines.push(`- ${followUp}`);
      }
    }

    return lines.join("\n");
  }

  private buildLaneAnalysisPrompt(params: {
    lane: ResearchLane;
    pagesVisited: string[];
    routeDeviations: string[];
    evidenceChunks: string[];
  }): string {
    return [
      "You are a focused research sub-agent.",
      "Stay inside the assigned focus area. Use evidence only from visited pages.",
      "Return JSON only with this shape:",
      '{"summary":"...","keyFindings":["..."],"openQuestions":["..."],"notableDeviations":["..."],"confidence":0.0}',
      `Focus area: ${params.lane.focusArea}`,
      `Objective: ${params.lane.objective}`,
      `Watch for: ${JSON.stringify(params.lane.watchFor)}`,
      `Required actions: ${JSON.stringify(params.lane.requiredActions)}`,
      `Assigned pages: ${JSON.stringify(params.lane.targetPages)}`,
      `Visited pages: ${JSON.stringify(params.pagesVisited)}`,
      `Route deviations: ${JSON.stringify(params.routeDeviations)}`,
      `Evidence:\n${truncate(params.evidenceChunks.join("\n\n"), 14000) || "No page evidence available."}`,
    ].join("\n\n");
  }

  private async collectPageEvidence(
    url: string,
    sessionId: string,
  ): Promise<PageEvidence> {
    const canonical = canonicalizeUrl(url);
    const safeUrl = isHttpUrl(canonical) ? canonical : url;

    try {
      console.log(`      📥 [scrape] ${safeUrl.slice(0, 80)}`);
      const scraped = await this.runtime.executeTool(
        "scrape",
        { url: safeUrl },
        { sessionId },
      );
      const result = scraped as any;
      const content = this.clean(result?.content, 4000);
      const title = this.clean(result?.title, 240) || safeUrl;
      if (content) {
        return {
          url: canonicalizeUrl(result?.url || safeUrl),
          title,
          snippet: content,
          success: true,
          source: {
            title,
            url: canonicalizeUrl(result?.url || safeUrl),
            whyRelevant: `Evidence collected by scrape for ${title}.`,
          },
        };
      }
    } catch (err: any) {
      console.log(
        `      ⚠️ [scrape] Failed: ${err?.message?.slice(0, 80) || "unknown"} — trying browse...`,
      );
    }

    try {
      console.log(`      📥 [browse] ${safeUrl.slice(0, 80)}`);
      const browsed = await this.runtime.executeTool(
        "browse",
        { url: safeUrl, sendScreenshot: false },
        { sessionId },
      );
      const result = browsed as any;
      const summary =
        this.clean(result?.analysis, 2500) ||
        this.clean(result?.summary, 2500) ||
        this.clean(result?.content, 2500);
      const finalUrl = canonicalizeUrl(result?.finalUrl || safeUrl);
      const title = this.clean(result?.title, 240) || finalUrl;
      if (summary) {
        return {
          url: finalUrl,
          title,
          snippet: summary,
          success: true,
          source: {
            title,
            url: finalUrl,
            whyRelevant: `Evidence collected by browse for ${title}.`,
          },
        };
      }
    } catch (err: any) {
      console.log(
        `      ⚠️ [browse] Failed: ${err?.message?.slice(0, 80) || "unknown"}`,
      );
    }

    return {
      url: safeUrl,
      title: safeUrl,
      snippet: "",
      success: false,
    };
  }

  private async searchWeb(
    query: string,
    limit: number,
  ): Promise<SearchResult[]> {
    const result = (await this.runtime.executeTool("web_search", {
      query,
      limit,
    })) as any;

    const rows = Array.isArray(result?.results) ? result.results : [];
    return rows
      .filter((entry: any) => entry && typeof entry === "object")
      .map((entry: any) => ({
        title: this.clean(entry.title, 300),
        url: this.clean(entry.url, 2000),
        snippet: this.clean(entry.snippet, 500),
      }))
      .filter((entry: SearchResult) => isHttpUrl(canonicalizeUrl(entry.url)));
  }

  private ensureFollowUps(
    fromModel: string[],
    openQuestions: string[],
    topic: string,
  ): string[] {
    const seeded = this.uniqueStrings(fromModel, 6);
    if (seeded.length > 0) return seeded;

    const fromOpen = this.uniqueStrings(
      openQuestions.map((q) => `Can you clarify: ${q}?`),
      6,
    );
    if (fromOpen.length > 0) return fromOpen;

    return [
      `What specific angle of "${topic}" should I prioritize next?`,
      "Should I prioritize newer sources or more authoritative primary sources?",
    ];
  }

  private resolveSubAgentCount(topic: string, requested?: number): number {
    const parsed = Number(requested);
    if (Number.isFinite(parsed)) {
      return Math.max(MIN_LANES, Math.min(MAX_LANES, Math.floor(parsed)));
    }

    const words = topic.split(/\s+/).filter(Boolean).length;
    if (words >= 16) return 4;
    if (words >= 8) return 3;
    return 2;
  }

  private resolveMaxRounds(requested?: number): number {
    const parsed = Number(requested);
    if (!Number.isFinite(parsed)) return 2;
    return Math.max(1, Math.min(3, Math.floor(parsed)));
  }

  private mergeHints(a: string[], b: string[]): string[] {
    return this.uniqueStrings([...(a || []), ...(b || [])], 16);
  }

  private uniqueUrls(values: string[], limit: number): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const canonical = canonicalizeUrl(value);
      if (!isHttpUrl(canonical)) continue;
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      out.push(canonical);
      if (out.length >= limit) break;
    }
    return out;
  }

  private uniqueStrings(raw: unknown, limit: number): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const value = this.clean(item, 400);
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
      if (out.length >= limit) break;
    }
    return out;
  }

  private normalizeSessionId(raw: string): string {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._:-]/g, "-")
      .slice(0, 120);
  }

  private clean(value: unknown, maxLen: number): string {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLen);
  }

  private clamp(value: unknown, fallback: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(max, parsed));
  }
}

class StringAccumulator {
  private readonly values: string[];
  private readonly seen: Set<string>;

  constructor(initial: string[] = []) {
    this.values = [];
    this.seen = new Set<string>();
    this.addMany(initial);
  }

  add(value: string): void {
    const clean = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.values.push(clean);
  }

  addMany(values: string[]): void {
    if (!Array.isArray(values)) return;
    for (const value of values) this.add(value);
  }

  list(limit: number): string[] {
    return this.values.slice(0, limit);
  }
}

class SourceAccumulator {
  private readonly values: ResearchSessionSource[] = [];
  private readonly seen: Set<string> = new Set();

  constructor(initial: ResearchSessionSource[] = []) {
    this.addMany(initial);
  }

  add(source: ResearchSessionSource): void {
    if (!source || typeof source !== "object") return;
    const url = canonicalizeUrl(String(source.url || ""));
    if (!isHttpUrl(url)) return;
    if (this.seen.has(url)) return;
    this.seen.add(url);
    this.values.push({
      title: String(source.title || url).slice(0, 300),
      url,
      whyRelevant: String(source.whyRelevant || "Referenced evidence").slice(
        0,
        400,
      ),
    });
  }

  addMany(sources: ResearchSessionSource[]): void {
    if (!Array.isArray(sources)) return;
    for (const source of sources) this.add(source);
  }

  list(limit: number): ResearchSessionSource[] {
    return this.values.slice(0, limit);
  }

  count(): number {
    return this.values.length;
  }
}

function parseJsonObject(text: string): unknown | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function truncate(text: string, maxLen: number): string {
  const value = String(text || "").trim();
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}...`;
}

export function isResetPhrase(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("start over") ||
    text.includes("new research topic") ||
    text.includes("reset research session")
  );
}
