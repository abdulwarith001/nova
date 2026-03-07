import type {
  ResearchLaneSessionSummary,
  ResearchSessionRecord,
  ResearchSessionSource,
} from "../research-session-store.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface ResearchLane {
  id: string;
  focusArea: string;
  objective: string;
  seedQueries: string[];
  targetPages: string[];
  watchFor: string[];
  requiredActions: string[];
}

export interface LanePlanInput {
  topic: string;
  focusHints: string[];
  unresolvedQuestions: string[];
  subAgentCount: number;
  priorSession?: ResearchSessionRecord;
}

export interface LaneReport {
  laneId: string;
  focusArea: string;
  summary: string;
  keyFindings: string[];
  openQuestions: string[];
  confidence: number;
  sources: ResearchSessionSource[];
  pagesVisited: string[];
  routeDeviations: string[];
}

export interface MainBranchReport {
  summary: string;
  keyFindings: string[];
  openQuestions: string[];
  confidence: number;
  sources: ResearchSessionSource[];
}

export interface RoundSynthesis {
  answer: string;
  confidence: number;
  keyFindings: string[];
  disagreements: string[];
  openQuestions: string[];
  followUpQuestions: string[];
}

export interface DeepResearchInput {
  topic: string;
  focusHints?: string[];
  subAgentCount?: number;
  maxRounds?: number;
  resetSession?: boolean;
}

export interface DeepResearchResult {
  answer: string;
  sources: ResearchSessionSource[];
  uncertainty: string;
  confidence: number;
  keyFindings: string[];
  disagreements: string[];
  openQuestions: string[];
  followUpQuestions: string[];
  needsFollowUp: boolean;
  session: {
    sessionId: string;
    continued: boolean;
    expiresAt: number;
  };
  laneSummary: ResearchLaneSessionSummary[];
  agentHint: string;
}
