# Sprint 0 — Multi-User Isolation

Entry point for implementing Sprint 0 of Akashic Context.

## What This Does

Runs the `sprint-0` agent to implement full multi-user isolation:
- userId parameter in all 4 MCP tools
- Per-user workspace (`users/{userId}/`)
- Per-user SQLite database
- Working Memory (`context.json` per user)
- New `memory_context` MCP tool
- 10+ isolation tests

## Usage

```
/sprint-0
/sprint-0 [specific task]
```

Examples:
- `/sprint-0` — full sprint (plan + implement + test)
- `/sprint-0 userId in MCP tools` — implement only tool changes
- `/sprint-0 working memory` — implement only context.json

## Process

1. Use Plan Mode to review current state and define implementation order
2. Read key files before touching anything
3. TDD: write tests first, then implement
4. Run `pnpm test -- --run` after each step
5. Commit when each deliverable is complete

## Invoke Agent

Use the `sprint-0` agent for all implementation work.
The agent has full context of the codebase and Sprint 0 requirements.
