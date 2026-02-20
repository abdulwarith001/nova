export type ChannelType = "ws" | "telegram" | "whatsapp";
export type MessageRole = "system" | "user" | "assistant";
export type MemoryJobType =
  | "post_turn_extract"
  | "post_turn_reflect"
  | "hourly_sweep"
  | "self_audit";

export interface StoredMessage {
  id: string;
  userId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  channel: ChannelType;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface MemoryContextPackage {
  userId: string;
  conversationId: string;
  recentMessages: StoredMessage[];
  memoryItems: Array<{
    id: string;
    type: string;
    content: string;
    importance: number;
    confidence: number;
    createdAt: number;
  }>;
  userTraits: Array<{
    id: string;
    key: string;
    value: string;
    confidence: number;
    contradictionGroup?: string;
    createdAt: number;
  }>;
  agentTraits: Array<{
    id: string;
    key: string;
    value: string;
    confidence: number;
    createdAt: number;
  }>;
  relationships: Array<{
    id: string;
    subject: string;
    relation: string;
    object: string;
    confidence: number;
    createdAt: number;
  }>;
  assembledSystemPrompt: string;
}

export interface LearningJob {
  id: string;
  userId: string;
  conversationId: string;
  type: MemoryJobType;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "completed" | "failed" | "dead_letter";
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  lastErrorAt?: number;
}

export interface ProactiveEvent {
  id: string;
  userId: string;
  channel: ChannelType;
  eventType: "check_in" | "suggestion" | "follow_up";
  message: string;
  status: "pending" | "sent" | "dropped";
  reason?: string;
  createdAt: number;
  sentAt?: number;
  updatedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface QueueProactiveEventInput {
  userId: string;
  channel: ChannelType;
  message: string;
  eventType?: ProactiveEvent["eventType"];
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRequest {
  id: string;
  userId: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "consumed" | "expired";
  reason: string;
  token: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
  rejectedAt?: number;
}

export interface AutonomyEvaluationResult {
  userId: string;
  checkedAt: number;
  shouldSendProactive: boolean;
  reason: string;
  draftedMessage?: string;
  createdEventIds: string[];
}
