import WebSocket from "ws";
import { readFileSync } from "fs";
import path from "path";

type ChatResponse = {
  type?: string;
  response?: string;
  success?: boolean;
  message?: string;
  research?: {
    sources?: Array<{ title?: string; url?: string; whyRelevant?: string }>;
    confidence?: number;
    uncertainty?: string;
  };
  events?: Array<{
    type?: string;
    timestamp?: number;
    details?: Record<string, unknown>;
  }>;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[index];
}

function buildBatch(base: string[], count: number): string[] {
  return Array.from({ length: count }, (_, i) => base[i % base.length]);
}

type PromptSuite = {
  label: string;
  prompts: string[];
  expectCitations: boolean;
};

type PromptSuiteConfig = {
  label: string;
  count?: number;
  expectCitations?: boolean;
  basePrompts?: string[];
  prompts?: string[];
};

type PromptConfigFile = {
  suites: PromptSuiteConfig[];
};

type PromptResult = {
  prompt: string;
  elapsedMs: number;
  success: boolean;
  fallback: boolean;
  fallbackReason?: string;
  citations: number;
  responsePreview: string;
};

const DEFAULT_FALLBACK_RESPONSE = "I'm sorry, I couldn't complete that request.";

function sendChat(ws: WebSocket, message: string): Promise<ChatResponse> {
  const requestTimeoutMs = Number.isFinite(Number(process.env.NOVA_BENCHMARK_TIMEOUT_MS))
    ? Number(process.env.NOVA_BENCHMARK_TIMEOUT_MS)
    : 90_000;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`timeout waiting for response: ${message}`)),
      requestTimeoutMs,
    );

    ws.once("message", (payload) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(payload.toString()) as ChatResponse);
      } catch {
        resolve({ response: payload.toString(), success: true });
      }
    });

    ws.send(JSON.stringify({ type: "chat", message }));
  });
}

function extractFallbackReason(response: ChatResponse): string | undefined {
  if (!Array.isArray(response.events)) return undefined;
  const finalized = response.events.find((event) => event.type === "finalized");
  if (!finalized?.details) return undefined;
  const reason = finalized.details.fallbackReason;
  return typeof reason === "string" && reason.trim() ? reason : undefined;
}

function loadPromptSuites(filePath?: string): PromptSuite[] {
  const defaultFilePath = path.join("scripts", "benchmark-prompts.json");
  const promptFilePath = filePath || process.env.NOVA_BENCHMARK_PROMPTS || defaultFilePath;
  const raw = readFileSync(promptFilePath, "utf-8");
  const parsed = JSON.parse(raw) as PromptConfigFile;

  if (!parsed || !Array.isArray(parsed.suites) || parsed.suites.length === 0) {
    throw new Error(`Invalid prompt file: ${promptFilePath}`);
  }

  return parsed.suites.map((suite) => {
    if (!suite.label || typeof suite.label !== "string") {
      throw new Error(`Invalid suite label in ${promptFilePath}`);
    }

    if (Array.isArray(suite.prompts) && suite.prompts.length > 0) {
      return {
        label: suite.label,
        prompts: suite.prompts,
        expectCitations: Boolean(suite.expectCitations),
      };
    }

    if (!Array.isArray(suite.basePrompts) || suite.basePrompts.length === 0) {
      throw new Error(`Suite ${suite.label} must define prompts or basePrompts`);
    }

    const count =
      typeof suite.count === "number" && suite.count > 0
        ? Math.floor(suite.count)
        : suite.basePrompts.length;

    return {
      label: suite.label,
      prompts: buildBatch(suite.basePrompts, count),
      expectCitations: Boolean(suite.expectCitations),
    };
  });
}

async function runBatch(
  ws: WebSocket,
  suite: PromptSuite,
): Promise<PromptResult[]> {
  const results: PromptResult[] = [];

  for (const prompt of suite.prompts) {
    const start = performance.now();
    try {
      const response = await sendChat(ws, prompt);
      const elapsed = performance.now() - start;
      const fallbackReason = extractFallbackReason(response);
      const citations = Array.isArray(response.research?.sources)
        ? response.research!.sources!.length
        : 0;
      const text = String(response.response || "").trim();
      const success = response.success === true;
      const fallback =
        !success ||
        text.length === 0 ||
        text === DEFAULT_FALLBACK_RESPONSE ||
        Boolean(fallbackReason);

      results.push({
        prompt,
        elapsedMs: elapsed,
        success,
        fallback,
        fallbackReason,
        citations,
        responsePreview: text.slice(0, 160),
      });
    } catch (error: any) {
      const elapsed = performance.now() - start;
      results.push({
        prompt,
        elapsedMs: elapsed,
        success: false,
        fallback: true,
        fallbackReason: "transport_or_timeout_error",
        citations: 0,
        responsePreview: String(error?.message || "Unknown benchmark error").slice(
          0,
          160,
        ),
      });
    }
  }

  return results;
}

function printBatchSummary(suite: PromptSuite, results: PromptResult[]): void {
  const samples = results.map((result) => result.elapsedMs);
  const fallbackCount = results.filter((result) => result.fallback).length;
  const successCount = results.filter((result) => result.success).length;
  const withCitations = results.filter((result) => result.citations > 0).length;
  const citationDenominator = suite.expectCitations ? results.length : withCitations || 1;
  const citationRate = suite.expectCitations
    ? (withCitations / citationDenominator) * 100
    : (withCitations / results.length) * 100;

  console.log(
    [
      `${suite.label}:`,
      `count=${results.length}`,
      `p50=${percentile(samples, 0.5).toFixed(1)}ms`,
      `p95=${percentile(samples, 0.95).toFixed(1)}ms`,
      `success_rate=${((successCount / results.length) * 100).toFixed(1)}%`,
      `fallback_rate=${((fallbackCount / results.length) * 100).toFixed(1)}%`,
      `${suite.expectCitations ? "citation_rate_required" : "citation_rate"}=${citationRate.toFixed(1)}%`,
    ].join(" "),
  );

  const fallbackSamples = results.filter((result) => result.fallback).slice(0, 3);
  for (const sample of fallbackSamples) {
    console.log(
      `  fallback sample: reason=${sample.fallbackReason || "none"} prompt="${sample.prompt}" response="${sample.responsePreview}"`,
    );
  }
}

function printOverallSummary(
  suites: PromptSuite[],
  suiteResults: Array<{ suite: PromptSuite; results: PromptResult[] }>,
): void {
  const all = suiteResults.flatMap((entry) => entry.results);
  const total = all.length;
  const success = all.filter((result) => result.success).length;
  const fallback = all.filter((result) => result.fallback).length;
  const requiredCitationResults = suiteResults
    .filter((entry) => entry.suite.expectCitations)
    .flatMap((entry) => entry.results);
  const requiredCitationHits = requiredCitationResults.filter(
    (result) => result.citations > 0,
  ).length;

  const samples = all.map((result) => result.elapsedMs);
  console.log("\nOverall:");
  console.log(
    [
      `suites=${suites.length}`,
      `count=${total}`,
      `p50=${percentile(samples, 0.5).toFixed(1)}ms`,
      `p95=${percentile(samples, 0.95).toFixed(1)}ms`,
      `success_rate=${((success / total) * 100).toFixed(1)}%`,
      `fallback_rate=${((fallback / total) * 100).toFixed(1)}%`,
      `citation_rate_required=${
        requiredCitationResults.length
          ? ((requiredCitationHits / requiredCitationResults.length) * 100).toFixed(1)
          : "n/a"
      }%`,
    ].join(" "),
  );
}

async function main() {
  const port = process.env.NOVA_DAEMON_PORT || "18789";
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const promptFilePath = process.argv[2];
  const suites = loadPromptSuites(promptFilePath);
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    setTimeout(() => reject(new Error("connection timeout")), 10_000);
  });

  console.log(`Connected to ${wsUrl}`);
  console.log(
    `Loaded prompt suites: ${suites.map((suite) => `${suite.label}(${suite.prompts.length})`).join(", ")}`,
  );

  const suiteResults: Array<{ suite: PromptSuite; results: PromptResult[] }> = [];
  for (const suite of suites) {
    const results = await runBatch(ws, suite);
    suiteResults.push({ suite, results });
    printBatchSummary(suite, results);
  }

  printOverallSummary(suites, suiteResults);

  ws.close();
}

main().catch((error) => {
  console.error("benchmark failed:", error);
  process.exit(1);
});
