# AI-Assisted Development

Varve is built by a solo developer who uses AI coding assistants as a
force multiplier. This directory documents what tooling is used, how
agent instructions are structured, and which files are for humans vs
automation.

## Quick reference

| File | Audience | Purpose |
|------|----------|---------|
| `AGENTS.md` (root) | AI agents | Cross-repository rules, architecture constraints, command reference |
| `docs/agents/session-history.md` | Humans + agents | Historical record of development sessions |
| `docs/plans/archived/redesign-strategy.md` | AI agents + humans | UI redesign strategy (moved from `.opencode/plans/`) |
| `.opencode/config.json` | opencode tool | Project configuration for the opencode CLI agent |
| `.windsurf/plans/` | Windsurf IDE | Implementation plans for specific features |
| `.devin/workflows/` | Devin agent | Workflow definitions |

## Why AI tooling is tracked

AI agent configurations and plans are tracked in Git because they form
part of the project's development methodology. A solo maintainer uses
these tools to maintain velocity across a large Rust+TypeScript monorepo.

## Which files are for humans

The root `README.md`, `CONTRIBUTING.md`, and all docs under `docs/` except
`docs/agents/` are written for human contributors. The `AGENTS.md` file at
the repository root is primarily for AI agents but may contain useful
information for human developers too.

## Keeping it manageable

Agent instructions are kept concise by:
- Storing only essential cross-project rules in root `AGENTS.md`
- Moving session logs to `docs/agents/session-history.md`
- Keeping durable architecture knowledge in `docs/adr/` and `docs/architecture/`
- Ignoring generated/temporary agent state via `.gitignore`

## Tools used

- **opencode** — CLI-based agent for structured repository operations
- **Windsurf** — IDE with integrated AI agent capabilities
- **Claude Code** (`.claude/`) — Local configuration, not tracked in Git
- **Devin** — Cloud-based autonomous engineering agent

No contributor is required to use any specific AI tool.
