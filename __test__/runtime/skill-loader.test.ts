import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SkillLoader } from "../../runtime/src/skill-loader";

describe("SkillLoader", () => {
  let tmpDir: string;
  let loader: SkillLoader;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "nova-test-skills-"));
    loader = new SkillLoader();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createSkill(name: string, manifest: string) {
    const skillDir = join(tmpDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), manifest, "utf-8");
  }

  it("builds an empty index when no skills exist", () => {
    const index = loader.buildIndex([join(tmpDir, "nonexistent")]);
    expect(index).toEqual([]);
  });

  it("discovers skills with YAML frontmatter", () => {
    createSkill(
      "test-skill",
      `---
name: test-skill
description: A test skill for unit tests
capabilities: do thing, do other thing
env: TEST_KEY
tools: 3
---

# Test Skill
This is a test skill.`,
    );

    const index = loader.buildIndex([tmpDir]);
    expect(index.length).toBe(1);
    expect(index[0].name).toBe("test-skill");
    expect(index[0].description).toBe("A test skill for unit tests");
    expect(index[0].capabilities).toEqual(["do thing", "do other thing"]);
    expect(index[0].envRequired).toEqual(["TEST_KEY"]);
    expect(index[0].toolCount).toBe(3);
  });

  it("discovers skills with list format", () => {
    createSkill(
      "list-skill",
      `# A Skill
- name: list-skill
- description: A list-format skill
- capabilities: search, browse
- tools: 2`,
    );

    const index = loader.buildIndex([tmpDir]);
    expect(index.length).toBe(1);
    expect(index[0].name).toBe("list-skill");
    expect(index[0].capabilities).toEqual(["search", "browse"]);
  });

  it("searches skills by keyword", () => {
    createSkill(
      "email-skill",
      `---
name: email-tool
description: Send and receive emails
capabilities: send email, read email, search inbox
tools: 3
---`,
    );
    createSkill(
      "calendar-skill",
      `---
name: calendar-tool
description: Manage calendar events
capabilities: create event, list events, search calendar
tools: 3
---`,
    );

    loader.buildIndex([tmpDir]);

    const emailResults = loader.searchSkills("email");
    expect(emailResults.length).toBe(1);
    expect(emailResults[0].name).toBe("email-tool");

    const calendarResults = loader.searchSkills("calendar event");
    expect(calendarResults.length).toBe(1);
    expect(calendarResults[0].name).toBe("calendar-tool");
  });

  it("returns all matching skills sorted by relevance", () => {
    createSkill(
      "workspace",
      `---
name: workspace
description: Google Workspace with email and calendar
capabilities: send email, read email, create calendar event
tools: 7
---`,
    );
    createSkill(
      "notification",
      `---
name: notification
description: Send notifications via email or push
capabilities: send email notification, push notification
tools: 2
---`,
    );

    loader.buildIndex([tmpDir]);

    // Both mention "email" — workspace should rank higher (more matches)
    const results = loader.searchSkills("email calendar");
    expect(results.length).toBe(2);
    expect(results[0].name).toBe("workspace");
  });

  it("generates a summary for the system prompt", () => {
    createSkill(
      "demo",
      `---
name: demo
description: Demo skill
capabilities: do stuff, more stuff
tools: 2
---`,
    );

    loader.buildIndex([tmpDir]);
    const summary = loader.getIndexSummary();
    expect(summary).toContain("AVAILABLE SKILLS");
    expect(summary).toContain("demo");
    expect(summary).toContain("2 tools");
  });

  it("throws when loading non-existent skill", async () => {
    loader.buildIndex([tmpDir]);
    await expect(loader.loadSkill("nonexistent")).rejects.toThrow(
      /not found in index/,
    );
  });
});
