import type { WebAction, WebObservation } from "./contracts.js";

interface WorldActionLog {
  action: WebAction;
  timestamp: string;
  success: boolean;
}

export class WebWorldModel {
  readonly sessionId: string;
  goal = "";
  observations: WebObservation[] = [];
  actions: WorldActionLog[] = [];
  notes: string[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  setGoal(goal: string): void {
    this.goal = String(goal || "").trim();
  }

  addObservation(observation: WebObservation): void {
    this.observations.push(observation);
    if (this.observations.length > 30) {
      this.observations = this.observations.slice(-30);
    }
  }

  addAction(action: WebAction, success: boolean): void {
    this.actions.push({
      action,
      success,
      timestamp: new Date().toISOString(),
    });
    if (this.actions.length > 50) {
      this.actions = this.actions.slice(-50);
    }
  }

  addNote(note: string): void {
    const trimmed = String(note || "").trim();
    if (!trimmed) return;
    this.notes.push(trimmed);
    if (this.notes.length > 40) {
      this.notes = this.notes.slice(-40);
    }
  }

  getLatestObservation(): WebObservation | undefined {
    return this.observations[this.observations.length - 1];
  }

  summary(): Record<string, unknown> {
    return {
      sessionId: this.sessionId,
      goal: this.goal,
      observations: this.observations.length,
      actions: this.actions.length,
      notes: this.notes.slice(-5),
      latestUrl: this.getLatestObservation()?.url,
    };
  }
}

export class WebWorldModelStore {
  private readonly models = new Map<string, WebWorldModel>();

  forSession(sessionId: string): WebWorldModel {
    const existing = this.models.get(sessionId);
    if (existing) return existing;

    const created = new WebWorldModel(sessionId);
    this.models.set(sessionId, created);
    return created;
  }

  delete(sessionId: string): void {
    this.models.delete(sessionId);
  }
}
