export type RiskLevel = "low" | "medium" | "high";
export type ObservationMode = "dom" | "dom+vision";

export interface WebAgentSessionConfig {
  profileId: string;
  headless: boolean;
  viewport: { width: number; height: number };
  locale: string;
  timezone: string;
  startUrl?: string;
  backendPreference?: "auto" | "browserbase" | "steel" | "local";
  fallbackOnError?: boolean;
}

export interface WebActionTarget {
  css?: string;
  text?: string;
  role?: string;
  bbox?: { x: number; y: number; w: number; h: number };
}

export interface WebAction {
  type:
    | "navigate"
    | "click"
    | "fill"
    | "submit"
    | "scroll"
    | "wait"
    | "extract"
    | "search";
  target?: WebActionTarget;
  value?: string;
  url?: string;
  options?: Record<string, unknown>;
}

export interface WebObservationElement {
  id: string;
  role: string;
  text: string;
  cssPath: string;
}

export interface WebObservation {
  url: string;
  title: string;
  domSummary: string;
  visibleText: string;
  elements: WebObservationElement[];
  screenshotPath?: string;
  timestamp: string;
}

export interface ActionDecision {
  action: WebAction;
  reason: string;
  risk: RiskLevel;
  needsConfirmation: boolean;
}

export interface ThoughtRecord {
  sessionId: string;
  turnId: string;
  intent: string;
  previousActions: string[];
  nextBestAction: string;
  usefulnessPlan: string;
  timestamp: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  rank: number;
  engine: string;
  retrievedAt: string;
  score: number;
}

export interface StructuredExtraction {
  url: string;
  title: string;
  byline?: string;
  publishedAt?: string;
  mainText: string;
  headings: string[];
  links: Array<{ text: string; url: string }>;
}

export interface WebActionExecutionResult {
  success: boolean;
  action: WebAction;
  risk: RiskLevel;
  needsConfirmation: boolean;
  confirmationRequired?: {
    actionDigest: string;
    sessionId: string;
    commandHint: string;
  };
  data?: Record<string, unknown>;
}
