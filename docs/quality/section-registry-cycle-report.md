# `sectionRegistry ↔ sectionState ↔ context/types ↔ tools/types ↔ workspaceTypes` — doesn't exist

Target cycle: `sectionRegistry → sectionState → context/types → tools/types → workspaceTypes →
(back to sectionRegistry)`. **This cycle does not exist in the current codebase, and the
architecture it presupposes (a registry that concrete sections import to self-register) doesn't
exist either.** No code changes were made — everything the brief asks for is already true. This
document is the evidence, checked point by point rather than assumed, plus one real, adjacent bug
that surfaced while checking.

## The actual graph

`npx madge --circular` on `packages/editor/src/index.ts` returns `[]` — zero cycles anywhere in the
editor package (same result as the last two rounds: `docs/quality/cycles.md` §7's `context.tsx ↔
context/index.ts` and §8's `Button ↔ IconButton` were also both already dead). Tracing the five
named files directly (via madge's own resolved dependency graph, not just source-reading):

```
context/types.ts      → sectionRegistry.ts   (inline `import('../.../sectionRegistry').SectionId` — TYPE-ONLY)
context/types.ts      → sectionState.ts      (`import type { SectionVisibilityState }` — TYPE-ONLY)
context/types.ts      → tools/types.ts       (`import type { DraftShape, MaskPreviewMode, ToolId }` — TYPE-ONLY)
context/types.ts      → workspaceTypes.ts    (`import type { WorkspaceMode }` — TYPE-ONLY)
sectionState.ts       → sectionRegistry.ts   (`import { getAllSectionIds, getHideableSectionIds,
                                                getSectionDefinition, type SectionId }` — VALUE)
sectionRegistry.ts    → workspaceTypes.ts    (`import type { WorkspaceMode }` — TYPE-ONLY)
workspaceTypes.ts     → tools/types.ts       (`import type { ToolId }` — TYPE-ONLY)
tools/types.ts        → (nothing in this set — external packages + ./inputNormalizer only)
```

This is a DAG, not a cycle. `context/types.ts` is a pure sink (imports from all four others, is
imported back by none of them — confirmed against madge's full importer list for `context/types.ts`,
which lists 18 files, none of which are these other four). `tools/types.ts` is a genuine leaf. The
one real value edge, `sectionState.ts → sectionRegistry.ts`, doesn't close a loop because
`sectionRegistry.ts` never imports `sectionState.ts` (or anything that leads back to it).

## Why the presupposed anti-pattern isn't here either

The brief describes "the classic registry cycle: the registry imports the things that register
with it, and the registered things import the registry to register." Checked `sectionRegistry.ts`
(686 lines) directly: there is no `registerSection()` function, no mutable registry populated by
external callers, nothing resembling `packages/scene/src/auditEngine.ts`'s `rules = new Map();
registerRule()` pattern (which *does* exist elsewhere in this codebase — see
`docs/quality/scene-cycle-report.md`'s edge-case section — just not here).

`SECTION_DEFINITIONS` is a single static `const` array of ~37 plain data objects
(`{ id, title, defaultExpanded, canHide, essential, order, category, isAvailable }`), all written
directly in `sectionRegistry.ts` itself. It contains **zero references to concrete section
components** — no `component`, no `render`, not even a component *type*. The registry is pure
metadata; it has no way to import a concrete section because it was never designed to hold one.

The actual rendering composition lives in `PropertiesPanel.tsx`, which already does exactly what
the brief's "composition root" asks for: it statically imports every concrete section
(`FillSection`, `TypographySection`, `CornerRadiusSection`, etc. — ~15+ direct imports) alongside
`sectionRegistry`'s metadata/types, and combines them by `SectionId` in its own render logic. It's
not wired through an explicit `register()` call, but there's nothing for it to call — the registry
was never the thing tracking components.

## Every specific requirement in the brief, checked against the real file

| Requirement | Status | Evidence |
|---|---|---|
| Registry depends only on an interface, no concrete sections | **Already true** | `sectionRegistry.ts` has zero imports of anything under `./sections/`; `SectionDefinition` has no component field at all. |
| Concrete sections registered at one composition root | **Already true, informally** | `PropertiesPanel.tsx` is the single place importing every section component; nothing else does. |
| `sectionState`/`context/types`/`tools/types`/`workspaceTypes` are leaves with no sibling imports | **Mostly, with one legitimate exception** | `tools/types.ts` is a true leaf. `context/types.ts` and `workspaceTypes.ts` only reach *forward* into this set (never imported back). `sectionState.ts` is **not** a pure type module — it owns real state-transition logic (`toggleCollapsed`, `hideSection`, `moveSectionUp`, `migrateSectionState`, `assignStableOrders`, 20+ functions) — and it *needs* `sectionRegistry`'s defaults/order/hideability to compute default and derived state. That's a legitimate one-way runtime dependency, not a leftover type-only artifact; nothing to invert. |
| Ordering is explicit data, not import order | **Already true** | Every `SectionDefinition` has a numeric `order` field (100, 110, 120…); `getOrderedSectionIds` sorts by it. `sectionState.ts`'s reordering functions (`moveSectionUp`/`moveSectionBefore`/etc.) reassign stable integer orders (`assignStableOrders`), not array-splice-and-hope. |
| Workspace-scoped availability lives in the section's own declaration, evaluated by the registry, using the same `WorkspaceMode` | **Already true, partially** | 11 of the ~37 `SECTION_DEFINITIONS` entries gate on `ctx.workspaceMode === 'image'`/`!== 'image'` directly inside their own `isAvailable` predicate — not a branch inside the registry engine. `SectionAvailabilityContext.workspaceMode` is typed as `WorkspaceMode` imported from `../../workspace/workspaceTypes` (§ below: "the same type" turns out to be more complicated than expected). |
| Lazy-loaded sections handled without forcing eager load | **Already true where it matters** | `PropertiesPanel.tsx` already uses `React.lazy()`/`Suspense` for its larger sub-panels (`AppearancePanel`, `AdjustmentsPanel`, `PrototypePanel`, `AuditPanel`). The registry's metadata is a plain synchronous array — it doesn't need a "not yet loaded" state because it never held component references to begin with; only rendering (in `PropertiesPanel.tsx`) is lazy, which is the correct split. Not changed, because nothing needed changing. |
| Design the interface-only dependency for third-party/plugin sections, "it's free" | **Not done** | It would not, in fact, be free here: there is no cycle motivating it, and retrofitting a `register()`-based composition root onto `PropertiesPanel.tsx` (900+ lines, not currently broken) to support a plugin architecture that isn't confirmed to be on the roadmap is exactly the kind of speculative restructuring the rest of this exercise has been explicitly scoped to avoid. Flagging as a legitimate future direction, not doing it now. |

## The one real bug this surfaced: three `WorkspaceMode` types, not one

The brief's throwaway line — "use the same `WorkspaceMode` type and don't create a second one" —
turned out to already be violated, just not by `sectionRegistry.ts` (which correctly uses the one
canonical editor-local type). There are **three separate `WorkspaceMode` declarations**:

```
packages/shared/src/auditTypes.ts:83   'design' | 'drawing' | 'image' | 'print' | 'motion'
packages/scene/src/auditFinding.ts:56  'design' | 'print' | 'drawing' | 'image' | 'motion'
packages/editor/src/workspace/workspaceTypes.ts:25
                                        'design' | 'print' | 'drawing' | 'image' | 'motion' | 'codegen'
```

The editor's version added `'codegen'`; the other two didn't get updated. This is **already
causing live typecheck failures** — confirmed via `pnpm --filter @strata/editor typecheck`:

```
src/components/AuditBadge.tsx(54,7): Type '...workspaceTypes".WorkspaceMode' is not assignable to
  type '...auditFinding".WorkspaceMode'. Type '"codegen"' is not assignable to type 'WorkspaceMode'.
src/panels/IntelligencePanel.tsx(83,35 / 600,35 / 601,56 / 617,9): same error, 4 more places
src/components/WorkspaceSwitcher.tsx(43,9): Property 'codegen' is missing in type '{ design: ...; }'
```

9 distinct errors trace back to this. **Not fixed here** — it spans three packages, and resolving
it is a real decision (does `'codegen'` belong in the shared/scene definitions too, or is editor's
addition premature relative to the audit/linting system scene owns?) that isn't this task's to make
unilaterally. Flagging it because the brief specifically anticipated this exact failure mode and it
turned out to already be real, elsewhere, not hypothetical.

## What was not done, and why

No file was edited. `madge --circular` already returns `[]` for editor (verified, not assumed); the
registry already depends on zero concrete sections; ordering is already explicit data; workspace
predicates are already declared where they belong. Building a `core-types`-style leaf module, an
`InspectorSection` interface, or a `register()`-based composition root for a cycle and an
anti-pattern that don't exist would be inventing structure for a non-problem — precisely what this
whole cycle-fixing pass has been scoped to avoid (see `docs/quality/scene-cycle-report.md`'s
identical conclusion for the scene package's "16-file mega-cycle").

## Running total

Unchanged: `docs/quality/cycles.md` tracks 6 real cycles (scene 6, engine 0, ui 0, editor 0). This
check didn't move that number — editor was already at 0 and stays there. No ratchet update needed:
the existing identity-based cycle ratchet (`docs/quality/cycles.md` §5) already protects editor's
zero-cycle baseline — if this exact cycle were reintroduced, `checkCycles()` would catch it as a
brand-new cycle in a package with an empty allowlist, no additional check required.

## Update — the `WorkspaceMode` triplication is now fixed

Resolved as a follow-up. Canonical `WorkspaceMode` now lives in `packages/shared/src/auditTypes.ts`
(L1 — the lowest layer both `scene` (L3) and `editor` (L5) already depend on in their
`package.json`, so no new dependency was introduced). Its own header comment already described it
as "the unified finding model used across all audit systems... Codegen Audits" — it was designed to
be this canonical source, it had just drifted. Added `'codegen'` there (matching editor's value,
which was the more complete/current one), then:

- `packages/scene/src/auditFinding.ts`: replaced the local `WorkspaceMode` declaration with
  `import type { WorkspaceMode } from '@strata/shared'; ... export type { WorkspaceMode };` (needed
  both — a bare `export type { X } from 'y'` re-export does **not** also bring `X` into local scope
  for the file's own internal use, which broke two of `auditFinding.ts`'s own interface fields on
  the first attempt; caught by `pnpm --filter @strata/scene typecheck`, fixed immediately).
- `packages/editor/src/workspace/workspaceTypes.ts`: same pattern, re-exporting from
  `@strata/shared` instead of declaring locally.
- `packages/scene/src/auditProfiles.ts`: `WORKSPACE_AUDIT_PROFILES` is a
  `Record<WorkspaceMode, WorkspaceAuditProfile>` — adding `'codegen'` to the type immediately
  surfaced (via typecheck) that this record was missing the sixth entry. Added one, designed to
  match the file's own stated categories (`primaryCategories: ['codegen', 'structure',
  'governance', 'accessibility']`, hiding print/raster/vector/prototype/performance/layer-hygiene
  as irrelevant to code generation). Its `contextualSummaryRules` follows the same convention every
  other profile already uses — planned/aspirational rule-ID strings, not yet-registered rules
  (confirmed above: `registerBuiltinRules()` is dead code, so *no* profile's rule IDs correspond to
  real registered rules today).
- `packages/editor/src/components/WorkspaceSwitcher.tsx`: its local `WORKSPACE_SOLID_ICONS` map was
  missing a `codegen` entry (a `Record<WorkspaceMode, ...>` in the same file as everything else,
  independently incomplete). Added `codegen: 'code'`, matching the identical map in `Menubar.tsx`,
  which already had it.
- `packages/editor/src/panels/AuditProfileSwitcher.tsx`: a **separate, unrelated** bug surfaced by
  the same typecheck sweep and mis-attributed to the triplication in the original report above —
  its `applicableModes: WorkspaceMode[]` field is populated with values like `'prototype-linking'`
  and `'export-preflight'`, which are `EditorMode` values (a different type in
  `@strata/shared/auditTypes.ts`), not `WorkspaceMode` values, in any of the three declarations that
  ever existed. Confirmed this component is dead code (`grep` finds zero importers anywhere in the
  repo). Widened the field to `Array<WorkspaceMode | EditorMode>`, matching what the data already
  intentionally mixes, rather than redesigning or wiring up an unused component.

**Verified:** `pnpm --filter @strata/shared|@strata/scene|@strata/editor typecheck` — zero
`WorkspaceMode`/`EditorMode`-related errors remain (was 14 error lines across `AuditBadge.tsx`,
`IntelligencePanel.tsx` ×4, `AuditProfileSwitcher.tsx` ×8, `WorkspaceSwitcher.tsx` ×1). Full
`auditFinding.test.ts` (21), `auditProfiles.test.ts` (22, added a `codegen`-profile test + widened
the "has profiles for all N modes" test from 5→6), full scene suite (2266/2270 passing — the 3
pre-existing `state-machine-runtime.test.ts` failures, confirmed via `git stash` unrelated), full
shared suite (686/686).

**Not fixed, confirmed pre-existing and unrelated (via `git stash` isolation):**
- `workspaceTypes.ts` has 6 `PanelLayout`-shaped object literals (across different named configs)
  still missing a `codegen` key each — a genuinely different bug (incomplete config data, not a
  type-source-of-truth problem) that requires real UI design decisions (what should the layers/
  inspector/timeline/pagenav/library panel visibility be in codegen mode?) this task shouldn't
  make unilaterally.
- `workspaceTypes.test.ts`'s `useWorkerRenderer` test ("codegen... is intentionally lightweight")
  already failed before this fix — the actual `WORKSPACE_CONFIGS.codegen.performance
  .useWorkerRenderer` value is `true`, contradicting the test's stated intent. Pre-existing,
  unrelated to the type triplication.
