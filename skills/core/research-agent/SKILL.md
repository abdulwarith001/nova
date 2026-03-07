---
name: research-agent
description: Focus-driven deep research with parallel sub-agents that run in distinct lanes, synthesize disagreements, and keep a 24-hour session context for follow-up questions.
---

# Research Agent Skill

Provides `deep_research` for extensive, multi-lane research workflows.

## What It Does

- Plans 2–4 distinct focus lanes per topic
- Assigns route packets for each lane (pages to visit, watchouts, and actions)
- Runs lanes in parallel and waits for all reports
- Performs internal critique/debate before synthesis
- Persists session context for 24 hours to support follow-up turns

## Tool

| Tool | Description |
| --- | --- |
| `deep_research` | Run deep, parallel, focus-driven research and return a structured brief with sources and follow-up prompts when needed |
