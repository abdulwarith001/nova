import type { Agent } from "../../../agent/src/index.js";
import type { Runtime } from "../../../runtime/src/index.js";
import { DeepResearchCoordinator } from "../../../runtime/src/research-agent/coordinator.js";
import { ResearchSessionStore } from "../../../runtime/src/research-session-store.js";

export async function wireTools(runtime: Runtime, agent: Agent): Promise<void> {
  const registry = runtime.getTools();
  const sessionStore = new ResearchSessionStore();
  const coordinator = new DeepResearchCoordinator({
    runtime,
    agent,
    sessionStore,
  });

  registry.register({
    name: "deep_research",
    description: [
      "Run deep, parallel, multi-lane research with synthesis and source validation.",
      "",
      "WHEN TO USE:",
      "• User asks to research, investigate, or analyze a topic in depth",
      "• Question requires cross-source validation or comparing viewpoints",
      "• Topic is complex or multi-faceted (regulation, policy, market, science)",
      "• User wants evidence-backed answers with cited sources",
      "• Following up on a previously researched topic (24h session memory)",
      "",
      "WHEN NOT TO USE (use web_search, scrape, or browse instead):",
      '• Simple factual lookup ("what is the capital of France") → web_search',
      "• Reading a single specific URL the user gave you → scrape or browse",
      "• Checking what a website looks like visually → browse",
      "• Getting a quick news headline or price → web_search",
      "",
      "This tool uses web_search, scrape, and browse internally.",
      "Do NOT call those tools separately before or after deep_research for the same topic.",
    ].join("\n"),
    category: "data",
    keywords: [
      "research",
      "investigate",
      "analyze in depth",
      "compare viewpoints",
      "cross-source validation",
      "evidence-backed",
      "policy analysis",
      "market analysis",
    ],
    examples: [
      "research the pros and cons of nuclear energy policy in the EU",
      "investigate what happened with the Silicon Valley Bank collapse and compare expert analyses",
      "analyze the latest AI regulation proposals — who supports them and who opposes them?",
      "I want to understand cryptocurrency market trends, get me evidence from multiple sources",
    ],
    parametersSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Main research topic or follow-up question.",
        },
        focusHints: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional focus areas to prioritize (e.g. ['regulation', 'market impact']).",
        },
        subAgentCount: {
          type: "number",
          description:
            "Optional number of sub-agents. Clamped to 2..4. Default is adaptive.",
        },
        maxRounds: {
          type: "number",
          description:
            "Optional number of rounds. Clamped to 1..2. Default is 2.",
        },
        resetSession: {
          type: "boolean",
          description:
            "Reset the current research session before running this request.",
        },
      },
      required: ["topic"],
    },
    permissions: ["network", "browser"],
    execute: async (params: any, context: any) => {
      const topic = String(params.topic || "").trim();
      if (!topic) throw new Error("topic is required");

      const focusHints = Array.isArray(params.focusHints)
        ? params.focusHints.map((value: unknown) => String(value || "").trim())
        : undefined;

      return await coordinator.runDeepResearch(
        {
          topic,
          focusHints,
          subAgentCount:
            params.subAgentCount != null
              ? Number(params.subAgentCount)
              : undefined,
          maxRounds:
            params.maxRounds != null ? Number(params.maxRounds) : undefined,
          resetSession: params.resetSession === true,
        },
        context,
      );
    },
  });

  console.log("🧭 Wired research-agent tool (deep_research)");
}
