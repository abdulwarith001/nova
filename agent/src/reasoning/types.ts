// === Thought Step Types ===

export type ThoughtStepType =
  | "observation"
  | "hypothesis"
  | "reasoning"
  | "conclusion"
  | "plan"
  | "reflection"
  | "error_recovery";

export interface ThoughtStep {
  type: ThoughtStepType;
  content: string;
  confidence: number;
  evidence?: string[];
  timestamp?: number;
}

// === Tool Decision Types ===

export interface ToolDecision {
  toolNames: string[];
  rationale: string;
  fallback: string;
}

export interface ReasoningToolDefinition {
  name: string;
  description: string;
  parametersSchema?: Record<string, unknown>;
  category?: string;
  keywords?: string[];
  examples?: string[];
}

// === Chain-of-Thought Types ===

export interface ThoughtChain {
  steps: ThoughtStep[];
  decision: ToolDecision;
  confidence: number;
  risks?: string[];
  createdAt: number;
}

export interface ThoughtChainContext {
  task: string;
  memoryContext?: string;
  observation: ObservationResult;
  orientation: OrientationResult;
  tools: ReasoningToolDefinition[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// === Thinking Result (New: first-class CoT output) ===

export interface ThinkingResult {
  thinking: string;
  response: string;
  toolCalls?: Array<{ name: string; parameters: Record<string, unknown> }>;
  steps: ThoughtStep[];
  confidence: number;
}

// === Plan Step (New: task decomposition) ===

export interface PlanStep {
  id: number;
  description: string;
  toolsNeeded?: string[];
  status: "pending" | "in_progress" | "completed" | "failed";
  result?: string;
}

// === Reasoning Trace (New: full trace for a task) ===

export interface ReasoningTrace {
  taskId: string;
  task: string;
  startedAt: number;
  completedAt?: number;
  iterations: ReasoningIteration[];
  finalResult?: string;
  totalTokensUsed?: { input: number; output: number };
}

export interface ReasoningIteration {
  iteration: number;
  thinking: ThinkingResult;
  toolCalls?: Array<{ name: string; parameters: Record<string, unknown> }>;
  toolResults?: Array<{ toolName: string; result?: unknown; error?: string }>;
  reflection?: ReflectionResult;
  timestamp: number;
}

// === Agent Event System (New: structured events) ===

export type AgentEvent =
  | { type: "thinking_start"; task: string; iteration: number }
  | { type: "thinking_step"; step: ThoughtStep; iteration: number }
  | { type: "thinking_complete"; result: ThinkingResult; iteration: number }
  | {
      type: "tool_start";
      toolName: string;
      parameters: Record<string, unknown>;
    }
  | {
      type: "tool_complete";
      toolName: string;
      result?: unknown;
      error?: string;
    }
  | { type: "reflection"; result: ReflectionResult }
  | { type: "plan_created"; steps: PlanStep[] }
  | { type: "iteration_complete"; iteration: number; maxIterations: number }
  | { type: "task_complete"; result: string; trace: ReasoningTrace };

export type AgentEventHandler = (event: AgentEvent) => void;

// === OODA Types ===

export interface ReasoningContext {
  task: string;
  history: Array<{ role: string; content: string }>;
  memoryContext?: string;
  tools: ReasoningToolDefinition[];
  maxTools?: number;
}

export interface ObservationResult {
  task: string;
  memoryContext?: string;
  availableTools: ReasoningToolDefinition[];
  constraints: {
    maxTools: number;
  };
  notes: string[];
}

export interface OrientationCandidate {
  tool: ReasoningToolDefinition;
  score: number;
  rationale: string;
}

export interface OrientationResult {
  intent: string;
  candidates: OrientationCandidate[];
  confidence: number;
  risks: string[];
}

export interface DecisionResult {
  selectedTools: ReasoningToolDefinition[];
  rationale: string;
  fallback: string;
  confidence: number;
  thoughtChain?: ThoughtChain;
  isTerminal?: boolean;
}

export interface ActionResult {
  toolCalls: Array<{ name: string; parameters: Record<string, unknown> }>;
  toolResults: Array<{ toolName: string; result?: unknown; error?: string }>;
}

export interface ReflectionResult {
  success: boolean;
  summary: string;
  adjustments: string[];
  shouldContinue?: boolean;
}

export interface OODAState {
  observe: ObservationResult;
  orient: OrientationResult;
  decide: DecisionResult;
  act: ActionResult;
}

export interface ReasoningEngineConfig {
  mode?: "off" | "fast" | "full";
  verbosity?: "none" | "summary";
  fallbackToSimple?: boolean;
  maxTools?: number;
}

export interface LLMClient {
  chat(
    prompt: string,
    history?: Array<{ role: string; content: string }>,
  ): Promise<string>;
}
