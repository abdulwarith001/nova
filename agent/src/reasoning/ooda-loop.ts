import type { OODAThought } from "./types.js";
import { REASONING_PROMPTS } from "./prompts.js";
import type { LLMClient } from "./types.js";

/**
 * LLM-powered OODA loop.
 * Each phase produces a thought that is passed to the next phase,
 * building up an accumulated thinking context.
 */

export interface OODAInput {
  message: string;
  memoryContext?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  llmChat: (
    prompt: string,
    history?: Array<{ role: string; content: string }>,
  ) => Promise<string>;
}

function parseJsonSafe(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/**
 * OBSERVE: Analyze the message and context.
 * Returns a thought describing what Nova sees.
 */
export async function oodaObserve(
  input: OODAInput,
  previousThoughts: OODAThought[] = [],
): Promise<OODAThought> {
  const prompt = [
    REASONING_PROMPTS.system,
    REASONING_PROMPTS.oodaObserve,
    `User message: ${input.message}`,
    input.memoryContext ? `Memory context:\n${input.memoryContext}` : "",
    input.conversationHistory && input.conversationHistory.length > 0
      ? `Recent conversation:\n${input.conversationHistory
          .slice(-6)
          .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await input.llmChat(prompt, []);
  const parsed = parseJsonSafe(raw);

  const observation = parsed?.observation
    ? String(parsed.observation)
    : `Received message: ${input.message.slice(0, 100)}`;
  const userState = parsed?.userState ? String(parsed.userState) : "";
  const knownContext = parsed?.knownContext ? String(parsed.knownContext) : "";
  const confidence = Number(parsed?.confidence || 0.7);

  const parts = [observation];
  if (userState) parts.push(`User state: ${userState}`);
  if (knownContext) parts.push(`Known context: ${knownContext}`);

  return {
    phase: "observe",
    content: parts.join(". "),
    confidence: Math.max(0, Math.min(1, confidence)),
    timestamp: Date.now(),
  };
}

/**
 * ORIENT: Assess intent and determine approach.
 * Receives the observation thought as context.
 */
export async function oodaOrient(
  input: OODAInput,
  previousThoughts: OODAThought[],
): Promise<OODAThought> {
  const thoughtContext = previousThoughts
    .map((t) => `[${t.phase.toUpperCase()}] ${t.content}`)
    .join("\n");

  const prompt = [
    REASONING_PROMPTS.system,
    REASONING_PROMPTS.oodaOrient,
    `My previous thinking:\n${thoughtContext}`,
    `User message: ${input.message}`,
    input.memoryContext ? `Memory context:\n${input.memoryContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await input.llmChat(prompt, []);
  const parsed = parseJsonSafe(raw);

  const intent = parsed?.intent ? String(parsed.intent) : "responding to user";
  const approach = parsed?.approach
    ? String(parsed.approach)
    : "conversational";
  const needsTools = Boolean(parsed?.needsTools);
  const personalityNotes = parsed?.personalityNotes
    ? String(parsed.personalityNotes)
    : "";
  const confidence = Number(parsed?.confidence || 0.7);

  const parts = [`Intent: ${intent}`, `Approach: ${approach}`];
  if (needsTools) {
    const hints = Array.isArray(parsed?.toolHints) ? parsed.toolHints : [];
    parts.push(`Tools needed: ${hints.join(", ") || "yes"}`);
  }
  if (personalityNotes) parts.push(`Personality: ${personalityNotes}`);

  return {
    phase: "orient",
    content: parts.join(". "),
    confidence: Math.max(0, Math.min(1, confidence)),
    timestamp: Date.now(),
  };
}

/**
 * DECIDE: Pick the response strategy.
 * Receives all previous thoughts as context.
 */
export async function oodaDecide(
  input: OODAInput,
  previousThoughts: OODAThought[],
): Promise<OODAThought> {
  const thoughtContext = previousThoughts
    .map((t) => `[${t.phase.toUpperCase()}] ${t.content}`)
    .join("\n");

  const prompt = [
    REASONING_PROMPTS.system,
    REASONING_PROMPTS.oodaDecide,
    `My previous thinking:\n${thoughtContext}`,
    `User message: ${input.message}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await input.llmChat(prompt, []);
  const parsed = parseJsonSafe(raw);

  const strategy = parsed?.strategy
    ? String(parsed.strategy)
    : "Respond directly and helpfully";
  const responseType = parsed?.responseType
    ? String(parsed.responseType)
    : "conversational";
  const curiosityTarget = parsed?.curiosityTarget
    ? String(parsed.curiosityTarget)
    : "";
  const toneGuide = parsed?.toneGuide ? String(parsed.toneGuide) : "";
  const confidence = Number(parsed?.confidence || 0.7);

  const parts = [`Strategy: ${strategy}`, `Type: ${responseType}`];
  if (toneGuide) parts.push(`Tone: ${toneGuide}`);
  if (curiosityTarget) parts.push(`Curious about: ${curiosityTarget}`);

  return {
    phase: "decide",
    content: parts.join(". "),
    confidence: Math.max(0, Math.min(1, confidence)),
    timestamp: Date.now(),
  };
}

/**
 * Run the full OODA loop: observe → orient → decide.
 * Returns all accumulated thoughts ready to inject into the response context.
 */
export async function runOODALoop(input: OODAInput): Promise<{
  thoughts: OODAThought[];
  assembledThinking: string;
}> {
  const thoughts: OODAThought[] = [];

  // OBSERVE
  const observeThought = await oodaObserve(input, thoughts);
  thoughts.push(observeThought);

  // ORIENT
  const orientThought = await oodaOrient(input, thoughts);
  thoughts.push(orientThought);

  // DECIDE
  const decideThought = await oodaDecide(input, thoughts);
  thoughts.push(decideThought);

  // Assemble thinking for injection into response context
  const assembledThinking = thoughts
    .map(
      (t) =>
        `[${t.phase.toUpperCase()}] (confidence: ${t.confidence.toFixed(2)}) ${t.content}`,
    )
    .join("\n");

  return { thoughts, assembledThinking };
}
