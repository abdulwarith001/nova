import { describe, expect, it } from "vitest";
import {
  WebWorldModel,
  WebWorldModelStore,
} from "../../runtime/src/web-agent/world-model.js";
import type { WebObservation } from "../../runtime/src/web-agent/contracts.js";

function fakeObservation(url = "https://a.com"): WebObservation {
  return {
    url,
    title: "Test",
    domSummary: "",
    visibleText: "text",
    elements: [],
    timestamp: new Date().toISOString(),
  };
}

describe("WebWorldModel", () => {
  it("stores goal", () => {
    const wm = new WebWorldModel("s1");
    wm.setGoal("find things");
    expect(wm.goal).toBe("find things");
  });

  it("trims goal", () => {
    const wm = new WebWorldModel("s1");
    wm.setGoal("  spaced  ");
    expect(wm.goal).toBe("spaced");
  });

  it("caps observations at 30", () => {
    const wm = new WebWorldModel("s1");
    for (let i = 0; i < 35; i++) {
      wm.addObservation(fakeObservation(`https://${i}.com`));
    }
    expect(wm.observations).toHaveLength(30);
    expect(wm.observations[29].url).toBe("https://34.com");
  });

  it("caps actions at 50", () => {
    const wm = new WebWorldModel("s1");
    for (let i = 0; i < 55; i++) {
      wm.addAction({ type: "click" }, true);
    }
    expect(wm.actions).toHaveLength(50);
  });

  it("caps notes at 40 and skips empty", () => {
    const wm = new WebWorldModel("s1");
    wm.addNote("");
    wm.addNote("   ");
    expect(wm.notes).toHaveLength(0);

    for (let i = 0; i < 45; i++) {
      wm.addNote(`note-${i}`);
    }
    expect(wm.notes).toHaveLength(40);
  });

  it("getLatestObservation returns most recent", () => {
    const wm = new WebWorldModel("s1");
    expect(wm.getLatestObservation()).toBeUndefined();
    wm.addObservation(fakeObservation("https://first.com"));
    wm.addObservation(fakeObservation("https://second.com"));
    expect(wm.getLatestObservation()?.url).toBe("https://second.com");
  });

  it("summary returns correct shape", () => {
    const wm = new WebWorldModel("s1");
    wm.setGoal("test goal");
    wm.addObservation(fakeObservation());
    const s = wm.summary();
    expect(s.sessionId).toBe("s1");
    expect(s.goal).toBe("test goal");
    expect(s.observations).toBe(1);
    expect(s.latestUrl).toBe("https://a.com");
  });
});

describe("WebWorldModelStore", () => {
  it("creates and returns same model for same session", () => {
    const store = new WebWorldModelStore();
    const a = store.forSession("s1");
    const b = store.forSession("s1");
    expect(a).toBe(b);
  });

  it("returns different models for different sessions", () => {
    const store = new WebWorldModelStore();
    expect(store.forSession("s1")).not.toBe(store.forSession("s2"));
  });

  it("delete removes model", () => {
    const store = new WebWorldModelStore();
    const a = store.forSession("s1");
    a.setGoal("original");
    store.delete("s1");
    const b = store.forSession("s1");
    expect(b.goal).toBe("");
    expect(b).not.toBe(a);
  });
});
