# Multi-window workspaces — architecture

Detachable UI panels and native multi-monitor workspaces. Design date:
2026-08-05. Status: architecture accepted; the dock model, panel registry,
session broker, and auxiliary-window shell have landed on `master` (the
remaining milestones below are tracked per-item). This document was written
while the implementation was in progress and describes both landed and
planned machinery — check the code before relying on a specific milestone.

This document is the readable overview. The 26 ADRs in `docs/adr/0017-0042`
hold the decisions; the audit in
`docs/audits/multi-window-workspace-audit-2026-08-05.md` holds the
evidence.

## Terminology

| Term | Meaning |
|---|---|
| Workspace mode | Existing Varve concept: tool/panel/shortcut configuration per work type (design, print, motion, ...). Never conflated with window layout. |
| Workspace layout | User-configurable arrangement of windows, dock groups, tabs, sizes, monitor placement, window state. |
| Application window | A Tauri window (primary or auxiliary) or the single browser surface. |
| Panel host | A dock region inside a window that contains one or more panels. |
| Panel definition | Registered type + capabilities of a panel (registry entry). |
| Panel instance | Concrete mounted instance with stable id and local presentation state. |
| Editor session | The canonical live editing session (documents, undo, selection, commands, save) owned by the primary window. |
| Document view | A viewport/presentation of a document. Panel detachment never creates one; canvas windows are deferred (ADR-0142). |

## Core principles

1. **One canonical editing authority** (ADR-0122): one session, one
   `EditorProvider` (primary window), one undo stack, one save authority.
   Auxiliary windows are projections that submit validated commands.
2. **Explicit state partitioning** (ADR-0123): `document-shared`,
   `session-shared`, `window-local`, `panel-instance-local`,
   `machine-local`, `ephemeral`. Only shared slices cross the channel.
3. **Stable identities** (ADR-0125): UUIDs for sessions, windows, panel
   instances, hosts, dock nodes, transfers, layouts. Tauri labels are
   sanitized derivations.
4. **Typed, versioned protocol** (ADR-0128): every message is a
   `SessionEnvelope` with version/session/window/generation/sequence/
   revision validation at the broker.
5. **Atomic panel transfer** (ADR-0134): detach/reattach is a two-phase
   state machine; the source never unmounts before the destination
   acknowledges.
6. **Platform abstraction** (ADR-0127): React never touches Tauri window
   APIs; `@varve/platform` window service has memory/browser/tauri
   implementations.
7. **Safe recovery** (ADR-0136): generation-based registration,
   heartbeat liveness, last-known-good layouts, crash-loop breaker,
   safe single-window boot.
8. **Progressive capability** (ADR-0142): panel windows first; canvas
   windows deferred.

## Module layout

| Module | Owns | Location |
|---|---|---|
| Panel registry | Panel definitions, lifecycle contracts, registry-derived menus/validation | `packages/editor/src/workspace/panelRegistry.ts` (+ registry data files) |
| Dock model | Dock-tree schema, pure ops, normalization, serialization, migrations, property tests | `packages/editor/src/workspace/dock/` |
| Session broker + protocol | Envelopes, registration, snapshots, patches, revisions, command routing, transfer state machine, focus tracking, diagnostics | `packages/editor/src/workspace/session/` |
| Window service | Window/monitor API, geometry normalization, display fingerprints, machine-local layout persistence boundary | `packages/platform/src/windows/` |
| Auxiliary shell | Minimal boot route, panel-window providers, dock rendering, panel chrome | `apps/desktop/src/auxiliary.tsx` (+ web fallback route) |
| Tauri app | Window creation, capability scoping, native event bridge, application lifetime | `apps/desktop/src-tauri/` |
| AI proposals | Typed workspace plans, screenshot/PDF analysis, NL instructions (never native effects) | `@varve/ai` (M14) |

Nothing window-related goes into `Shell.tsx` (its import budget is at the
ceiling); Shell renders what the dock tree says via a thin adapter.

## Data flow

```
Auxiliary window                    Primary window (broker)
┌────────────────────┐              ┌─────────────────────────────┐
│ AuxiliaryShell     │   envelope   │ EditorProvider (canonical)  │
│ PanelSessionCtx    │◄────────────►│ SessionBroker               │
│ (projection)       │  (transport) │  ├ registry/liveness        │
│ dock renderer      │              │  ├ snapshots + patches      │
│ command client     │              │  ├ command validation+apply │
└────────────────────┘              │  ├ transfer transactions    │
        │                           │  └ focus/diagnostics        │
        └── windowService (memory/browser/tauri) ── Tauri windows/monitors
```

A detached Inspector opacity edit: panel submits `COMMAND_SUBMIT`
(`commandType: 'set-opacity'`, `activeDocumentId`, `expectedRevision`) →
broker validates sender/capability/document/schema → applies once through
the canonical `updateDoc` → undo stack updates naturally → revision bumps →
patches fan out to all windows → `COMMAND_ACK` returns with new revision.

## Browser fallback

`windowService.capability === 'single-window'`: the same dock-tree model
renders in one window (tabs, splits, named layouts, focus mode); native
operations are labeled as desktop-only with accurate explanations; popups
are opt-in experiments only (ADR-0139).

## Milestones

| # | Deliverable | Commit series |
|---|---|---|
| M1 | Audit, baseline tests, ADRs | `test(workspace): capture single-window panel baselines`, `docs(workspace): define multi-window architecture` |
| M2 | Typed panel registry | `refactor(editor): introduce typed panel registry` |
| M3 | Dock model + property tests | `feat(workspace): add normalized dock layout model` |
| M4 | Platform window service | `feat(platform): add native workspace window service` |
| M5 | Session protocol | `feat(workspace): add versioned window session protocol` |
| M6 | Minimal auxiliary window shell | `feat(desktop): add auxiliary panel window shell` |
| M7 | Atomic detach/reattach | `feat(workspace): add atomic panel transfer transactions`, `feat(editor): add detachable panel controls` |
| M8 | Shared mutation workflow | `feat(workspace): route detached panel commands through editor session` |
| M9 | Persistence + monitors | `feat(workspace): persist monitor-aware layouts` |
| M10 | Workspace manager | `feat(editor): add workspace and window manager` |
| M11 | Lifecycle hardening | `feat(workspace): add auxiliary window recovery` |
| M12 | Browser fallback | `feat(web): add detachable-panel workspace fallback` |
| M13 | Cross-window dragging | `feat(workspace): add cross-window panel dragging` |
| M14 | Multimodal proposals | `feat(ai): add typed workspace layout proposals` |
| M15 | Hardening + docs | `test(workspace): add multi-window lifecycle coverage`, `test(workspace): add cross-platform monitor fixtures`, `docs(workspace): document detachable panel workflows` |

## Performance budgets (recorded pre-M7)

Measured at the M6 gate:
empty auxiliary window memory, per-panel incremental memory, creation and
hydration latency, patch latency, command round-trip, idle/minimized CPU.
Target: practical multi-window layout on 4 GB RAM; max 8 auxiliary
windows by default.

## Cross-platform posture

Linux (WebKitGTK, Wayland + X11): exact placement may be refused by the
compositor — request size + monitor/relative placement and document the
fallback honestly. Windows: mixed-DPI work areas, taskbar, snap layouts.
macOS: Spaces, application-lives-without-windows, native traffic lights
if auxiliary windows use native decorations. Native testing per OS is
mandatory (ADR-0147); browser tests never substitute for it.
