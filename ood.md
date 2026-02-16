# Chain of Reasoning & OODA Tool Selection Enhancement

Enhance Nova's agent with structured reasoning patterns (Chain-of-Reasoning) and OODA (Observe-Orient-Decide-Act) loop for intelligent tool selection and problem-solving.

## Current State Analysis

The current implementation has:
- **Basic keyword-matching tool selector** ([tool-selector.ts](file:///Users/engmare/personal-projects/nova/runtime/src/tool-selector.ts)) - scores tools by keyword/description matches
- **Simple iteration loop** ([autonomous.ts](file:///Users/engmare/personal-projects/nova/agent/src/autonomous.ts)) - LLM-driven with basic retry logic
- **Empty planning/reasoning directories** - Ready for structured implementation

### Key Limitations
1. No explicit reasoning steps before tool selection
2. No structured observation → orientation → decision flow
3. Tool selection relies on LLM intuition, not explicit chain-of-thought
4. No reflection or learning from tool execution results

---

## Proposed Changes

### Component 1: Core Reasoning Engine

#### [NEW] [reasoning-engine.ts](file:///Users/engmare/personal-projects/nova/agent/src/reasoning/reasoning-engine.ts)

Core reasoning framework with OODA loop implementation:

```typescript
interface OODAState {
  observe: ObservationResult;    // What do we know?
  orient: OrientationResult;     // What does it mean?
  decide: DecisionResult;        // What should we do?
  act: ActionResult;             // Execute & record outcome
}

class ReasoningEngine {
  // OODA cycle execution
  async reason(context: ReasoningContext): Promise<OODAState>;
  
  // Chain-of-thought generation
  async generateThoughtChain(task: string, tools: ToolDefinition[]): Promise<ThoughtChain>;
  
  // Reflection on outcomes
  async reflect(action: ActionResult): Promise<ReflectionResult>;
}
```

---

#### [NEW] [ooda-loop.ts](file:///Users/engmare/personal-projects/nova/agent/src/reasoning/ooda-loop.ts)

OODA loop implementation:

```typescript
// OBSERVE: Gather information about current state
async observe(context: OODAContext): Promise<ObservationResult> {
  // - Parse user intent
  // - Check memory for relevant context
  // - Identify available tools
  // - Note constraints & resources
}

// ORIENT: Analyze & interpret observations
async orient(observation: ObservationResult): Promise<OrientationResult> {
  // - Match intent to tool categories
  // - Identify dependencies between tools
  // - Assess risk/confidence levels
  // - Generate hypotheses about approach
}

// DECIDE: Select action based on orientation
async decide(orientation: OrientationResult): Promise<DecisionResult> {
  // - Rank candidate tool sequences
  // - Apply chain-of-thought reasoning
  // - Select optimal tool(s) with parameters
  // - Generate fallback plan
}

// ACT: Execute decision and capture outcome
async act(decision: DecisionResult): Promise<ActionResult> {
  // - Execute tool call(s)
  // - Capture results/errors
  // - Record for reflection
}
```

---

#### [NEW] [chain-of-thought.ts](file:///Users/engmare/personal-projects/nova/agent/src/reasoning/chain-of-thought.ts)

Chain-of-thought reasoning patterns:

```typescript
interface ThoughtStep {
  type: 'observation' | 'hypothesis' | 'reasoning' | 'conclusion';
  content: string;
  confidence: number;
  evidence?: string[];
}

class ChainOfThought {
  // Build reasoning chain for tool selection
  async buildChain(task: string, context: ReasoningContext): Promise<ThoughtChain>;
  
  // Validate reasoning chain
  validate(chain: ThoughtChain): ValidationResult;
  
  // Extract actionable decision
  extractDecision(chain: ThoughtChain): ToolDecision;
}
```

---

### Component 2: Enhanced Tool Selector

#### [MODIFY] [tool-selector.ts](file:///Users/engmare/personal-projects/nova/runtime/src/tool-selector.ts)

Enhance with reasoning-aware selection:

```diff
+ import { ThoughtChain, ChainOfThought } from '../agent/src/reasoning/chain-of-thought.js';

  export class ToolSelector {
+   private chainOfThought: ChainOfThought;
+
+   // New: Reasoning-enhanced selection
+   async selectToolsWithReasoning(
+     task: string,
+     allTools: ToolDefinition[],
+     context?: ReasoningContext
+   ): Promise<{
+     tools: ToolDefinition[];
+     reasoning: ThoughtChain;
+     confidence: number;
+   }>;
  }
```

---

### Component 3: Autonomous Agent Integration

#### [MODIFY] [autonomous.ts](file:///Users/engmare/personal-projects/nova/agent/src/autonomous.ts)

Integrate OODA loop into execution:

```diff
+ import { ReasoningEngine, OODAState } from './reasoning/reasoning-engine.js';

  export class AutonomousAgent {
+   private reasoningEngine: ReasoningEngine;
+   private reasoningHistory: OODAState[] = [];
+
    async execute(userTask: string): Promise<string> {
-     // Current: Direct LLM call with all tools
+     // New: OODA-driven execution
+     while (iteration < maxIterations) {
+       // OBSERVE
+       const observation = await this.reasoningEngine.observe({
+         task: userTask,
+         history: this.conversationHistory,
+         memory: await this.runtime.getMemory().buildContext(userTask)
+       });
+
+       // ORIENT
+       const orientation = await this.reasoningEngine.orient(observation);
+
+       // DECIDE (with chain-of-thought)
+       const decision = await this.reasoningEngine.decide(orientation);
+
+       // ACT
+       const actionResult = await this.executeDecision(decision);
+
+       // REFLECT & LEARN
+       await this.reasoningEngine.reflect(actionResult);
+
+       if (decision.isTerminal) break;
+     }
    }
  }
```

---

### Component 4: Reasoning Prompts

#### [NEW] [prompts.ts](file:///Users/engmare/personal-projects/nova/agent/src/reasoning/prompts.ts)

Chain-of-thought prompt templates:

```typescript
export const REASONING_PROMPTS = {
  observation: `
    Given the user's request and available tools, identify:
    1. What is the user trying to accomplish? (primary goal)
    2. What sub-tasks might this involve? (decomposition)
    3. What constraints exist? (time, resources, permissions)
    4. What context is relevant from memory?
  `,
  
  orientation: `
    Based on observations, analyze:
    1. Which tools are relevant to each sub-task?
    2. What is the optimal sequence of tool usage?
    3. What could go wrong? (risk assessment)
    4. How confident are we in this approach? (1-10)
  `,
  
  decision: `
    Select the next action:
    1. Which specific tool(s) should be called?
    2. What parameters should be used?
    3. What is the expected outcome?
    4. What is the fallback if this fails?
    
    Format: {tool, parameters, rationale, fallback}
  `,
  
  reflection: `
    Evaluate the action outcome:
    1. Did the tool produce expected results?
    2. What did we learn?
    3. Should we adjust our approach?
    4. Are we closer to the goal?
  `
};
```

---

## File Structure

```
agent/src/
├── reasoning/
│   ├── index.ts              # Exports
│   ├── reasoning-engine.ts   # Core OODA engine
│   ├── ooda-loop.ts          # OODA phases implementation
│   ├── chain-of-thought.ts   # CoT reasoning patterns
│   ├── prompts.ts            # Reasoning prompts
│   └── types.ts              # Type definitions
├── autonomous.ts             # Modified to use reasoning
└── ...

runtime/src/
├── tool-selector.ts          # Enhanced with reasoning
└── ...
```

---

## Verification Plan

### Unit Tests

> [!NOTE]
> The [agent/tests/](file:///Users/engmare/personal-projects/nova/agent/tests) directory is currently empty. We will create new test files.

#### Tests to Create

| Test File | Purpose |
|-----------|---------|
| `agent/tests/reasoning-engine.test.ts` | OODA loop unit tests |
| `agent/tests/chain-of-thought.test.ts` | CoT reasoning tests |
| `agent/tests/tool-selector.test.ts` | Enhanced selector tests |

#### Run Command
```bash
cd /Users/engmare/personal-projects/nova/agent
npm test
```

> [!IMPORTANT]
> Need to verify if Jest/Vitest is configured. If not, will need to add test framework.

---

### Manual Verification

**Test 1: Basic Tool Selection Reasoning**
```bash
# Start Nova daemon
cd /Users/engmare/personal-projects/nova
npm run dev:gateway

# In another terminal, run a task that requires tool selection
npm run nova -- chat
# Then ask: "What files are in my current directory?"
# Verify: Agent shows reasoning steps before selecting tools
```

**Test 2: Multi-step Task with OODA**
```bash
npm run nova -- chat
# Ask: "Create a new file called test.txt with the content 'hello world', then read it back"
# Verify: Agent uses OODA loop (observe → orient → decide → act → reflect)
```

---

## Questions for User

1. **Verbosity Level**: Should the reasoning steps (OODA state, thought chains) be visible to the user in the CLI, or logged only for debugging?

2. **LLM Overhead**: The chain-of-thought approach requires additional LLM calls per decision. Is this acceptable, or should we have a "fast mode" that skips detailed reasoning?

3. **Fallback Behavior**: If reasoning fails or times out, should we fall back to the current simple keyword-matching approach?
