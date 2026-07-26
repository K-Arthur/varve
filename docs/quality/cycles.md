# Dependency Cycle Classification — 2026-07-25

**Status: §0-§6 are the as-of-first-writing snapshot (10 cycles). §7 fixed E2 (10→9). §8 fixed E3
and confirmed Button/IconButton was already dead (9→8). Current total: 8** — scene 7 (all
type-erased or grandfathered, §2-§4), engine 1 (`engine.ts ↔ wasmLoader.ts`, deliberate, §2), ui 0,
editor 0. Kept the history instead of rewriting it: §0-§6 is why each cycle was or wasn't worth
fixing, §7-§8 are what actually happened next.

Scope: classify every edge in the currently-reported dependency cycles by whether it's erased at
compile time, assess whether any cycle causes a real runtime problem today, and replace the
count-based CI cycle gate with an identity-based allowlist so fixing a cycle can't be silently
offset by introducing a different one.

No behavior was changed as part of this document. One tooling change was made (the ratchet, §4) —
additive, CI-only, no application code touched.

## 0. "Seven" vs. what's actually on disk

The brief's "seven reported cycles" undercounts current reality. Live `madge --circular` against
this working tree right now:

| Package | Cycles |
|---|---|
| engine | 3 |
| scene | 7 |
| **everything else (14 packages)** | 0 |
| **Total** | **10** |

Per `docs/quality/report-audit.md` §9, the original "7" was a snapshot taken mid-remediation
(cycle count has moved 5 → 19 → 10 over three weeks as fixes landed and new code was added). The
scene package alone matches "seven" today — engine's 3 are real, currently-tracked cycles that a
scoped-to-"seven" allowlist would leave completely unprotected. **This document classifies all 10
real cycles** and the ratchet (§4) covers all 10, not 7, for exactly the reason Task 4 warns about:
an allowlist that omits real cycles isn't a ratchet, it's a blind spot.

One of the 7 scene cycles (`auditFinding.ts ↔ suppressions.ts`) does not exist in the committed
baseline (`docs/audits/architecture-health-baseline-2026-07-25.md`, which recorded 10 scene cycles
under different filenames, later reduced to 6 by in-flight remediation). It was introduced by the
new `packages/scene/src/suppressions.ts` module in the current uncommitted working tree. It is
grandfathered into the ratchet as part of this change (§4) — flagged here, not hidden.

## 1. tsconfig verification

`tsconfig.base.json` (extended, unmodified, by both `packages/scene/tsconfig.json` and
`packages/engine/tsconfig.json`):

```json
"isolatedModules": true,
"verbatimModuleSyntax": true,
```

Confirmed: `import type`, inline `type` specifiers (`import { resolveBinding, type VariableStore }`),
and inline `import('./x').Y` type queries are all fully erased at compile time for both packages.
**Converting a value import to `import type` is a real fix, not a no-op, in this repo.** This check
had to happen before anything else — if `verbatimModuleSyntax` were off, all the classification
below would be moot.

Caveat found along the way: `madge` (the tool `scripts/audit-architecture.mjs` uses, and the same
one behind the numbers in the architecture-health baseline) **does not distinguish `import type`
from a value import when detecting cycles** — confirmed empirically below (§2, §3) and previously
noted in the baseline doc itself. So "a cycle is type-only" and "madge stops reporting it" are two
different facts; only some of the fixes below actually shrink the CI-visible cycle count. That
distinction is called out per-cycle in §3.

## 2. Edge classification — all 10 cycles

Classification key: **TYPE-ONLY** (erased, zero runtime relationship) · **VALUE** (real runtime
import) · **MIXED** (one direction of a 2-cycle is TYPE-ONLY, the other VALUE — listed once per
cycle since 2-node cycles have exactly two directed edges).

### Scene (7 cycles)

| # | Cycle (madge, sorted) | Edge 1 | Edge 2 | Edge 3 | Edge 4 | Runtime cycle? |
|---|---|---|---|---|---|---|
| S1 | adjustmentScope.ts → bindings.ts → document.ts → types.ts | adjustmentScope→document: `import type { Document }` **TYPE-ONLY** | document→bindings: `import { stripBindingForVariable }` **VALUE** | bindings→types: `import type { PropertyBinding, SceneNode }` **TYPE-ONLY** | types→adjustmentScope: `import('./adjustmentScope').AdjustmentScope` inline type query, line 998 **TYPE-ONLY** | **No** |
| S2 | bindings.ts → component-sync.ts → document.ts → types.ts | document→bindings: **VALUE** (same edge as S1) | bindings→types: **TYPE-ONLY** (same edge as S1) | types→component-sync: `import('./component-sync').SyncBaseline` inline, line 835 **TYPE-ONLY** | component-sync→document: `import type { Document }` **TYPE-ONLY** | **No** |
| S3 | component-sync.ts → types.ts | types→component-sync: **TYPE-ONLY** (same as S2) | component-sync→types: `import type { ComponentDefinition, FrameNode, NodeId }` **TYPE-ONLY** | — | — | **No — never was** |
| S4 | bindings.ts → document.ts → types.ts → typography.ts | document→bindings: **VALUE** (same edge as S1/S2) | bindings→types: **TYPE-ONLY** (same edge as S1/S2) | types→typography: `import('./typography').RichText` etc., inline, lines 729/731/733/754 **TYPE-ONLY** | typography→document: `import type { Document }` **TYPE-ONLY** | **No** |
| S5 | types.ts → typography.ts | types→typography: **TYPE-ONLY** (same as S4) | typography→types: `import type { NodeId }` **TYPE-ONLY** | — | — | **No — never was** |
| S6 | brush.ts → document.ts | document→brush: `import('./brush').BrushPreset` inline, line 163 **TYPE-ONLY** | brush→document: `import('./document').Document` inline, line 637 **TYPE-ONLY** | — | — | **No — never was** |
| S7 | auditFinding.ts → suppressions.ts | auditFinding→suppressions: `export { applySuppressions, buildSuppression, isSuppressed } from './suppressions'` **VALUE** (barrel re-export of real functions) | suppressions→auditFinding: `import type { AuditFinding }` **TYPE-ONLY** | — | — | **No** |

**Headline: none of the 7 scene cycles is a real runtime cycle.** Every one of them has at least
one edge that's fully erased, and in every case that's enough to break the loop. S1/S2/S4 all
share the *same single* real edge — `document.ts → bindings.ts` (for `stripBindingForVariable`) —
fanning out through a shared type-only spine (`bindings.ts → types.ts`) to three different
type-only return paths (`adjustmentScope`, `component-sync`, `typography`). That's not three
independent problems, it's one real edge plus three cosmetic ones. S3, S5, S6 are 100% type-only
in both directions — these were never runtime cycles at all, in any version of this code, and
never will be as long as `verbatimModuleSyntax` stays on.

### Engine (3 cycles)

| # | Cycle | Edge 1 | Edge 2 | Edge 3 | Runtime cycle? |
|---|---|---|---|---|---|
| E1 | engine.ts → wasmLoader.ts | engine→wasmLoader: `await import('./wasmLoader')` — **dynamic** import, called inside `createEngine('wasm')`, lines 397/401 **VALUE (deferred/async)** | wasmLoader→engine: `import type { Engine }` **TYPE-ONLY** | — | **No — deliberately broken by design** |
| E2 | filterCompositor.ts → lut/index.ts → lut/bake.ts → filterCompositor.ts | filterCompositor→lut/index: `import { applyLutToImageData, type LutTransform }` **VALUE** | lut/index→bake: `export { bakeFiltersToLut } from './bake'` (barrel; also `export type { BakeOptions, BakeResult }`) **VALUE** | bake→filterCompositor: `import { applySoftwareFilter }` **VALUE** | **Yes — the only genuine value cycle in this set** |
| E3 | raster-size.ts → raster.ts | raster→raster-size: `import { estimateFileSize }` **VALUE** | raster-size→raster: `import type { RasterFormat }` **TYPE-ONLY** | — | **No** |

**E2 is the one real thing in this whole exercise.** All three edges are genuine value imports of
real functions, forming an actual 3-file runtime cycle. Every other cycle in this repo, scene or
engine, is either fully type-erased or has its one value edge deferred past module-init time (E1's
dynamic `import()`).

## 3. Actual impact — is anything breaking today?

**Static check, not a constructed failing test.** I verified every real-value call site and
confirmed none of them execute at module top level (all are inside function bodies, called after
the full module graph has settled):

- `stripBindingForVariable` — called at `document.ts:1824`, inside a function.
- `captureSyncBaseline` / `detectOverrides` — called at `document.ts:1393` / `document.ts:1439`,
  both inside functions (these aren't part of the cycle table above but share the same document.ts
  hub and were checked for completeness).
- `applyLutToImageData` — called at `filterCompositor.ts:555`, inside a function.
- `applySoftwareFilter` — called at `lut/bake.ts:85/123/133/143`, all inside `bakeFiltersToLut`.
- `bakeFiltersToLut` (the barrel re-export in E2) — not currently imported by
  `filterCompositor.ts` at all; the value edge exists at the module-graph level but isn't even
  exercised from that direction today.

**Conclusion: zero of the 10 currently-reported cycles reproduces a TDZ / "cannot access before
initialization" / undefined-at-import failure today**, because the one place with a real 3-file
value cycle (E2) only touches the circular bindings from inside deferred function calls, never at
init time.

**That is not the same as "value cycles are safe here."** This repo's own history says otherwise:

- `17ddebfa` (`fix(editor): resolve useMotion/usePrototype circular dependency in EditorProvider`,
  2026-07-14) — `useMotion()`/`usePrototype()` were called at `EditorProvider`'s top level while the
  providers that supply them hadn't mounted yet, **throwing before the providers existed**. Fixed
  with an `onReady` callback + no-op fallback pattern. This is the exact TDZ-shaped failure mode
  Task 3 asks about, and it happened in this codebase three weeks ago.
- `0bf98cf6` (`fix: break colour WASM circular dep (engine -> print -> scene -> engine)`,
  2026-07-14) — a cross-*package* value cycle (not just cross-file) that required extracting
  `colourLoader.ts` into engine and rewriting `print`'s copy as a thin re-export.

So: **no active incident from the current 10 cycles, but the failure mode is proven, recent, and
specific to this codebase** — not a theoretical concern imported from a blog post. E2 is the one
cycle here structurally capable of reproducing it, because it's the only one where all edges are
real values.

**Bundler / tree-shaking impact — not independently measured.** Neither `scene` nor `engine` has a
bundling build step (`packages/*/package.json`'s `build` script is `tsc --noEmit`; no `dist` is
emitted). The actual bundling happens once, at the `apps/desktop` Vite/Rollup build. I did not run
a before/after bundle-size comparison — doing so would require isolating E2 specifically, and
since none of E2's cross-cycle calls happen at module top level, there's no plausible tree-shaking
interaction to measure (Rollup can't drop code that's actually called; it also has no side effects
to worry about ordering here). Flagging this as **not verified** rather than asserting a number.
No dev-vs-prod module-init-order divergence was found or looked for beyond the static check above.

## 4. Fix strategy, priority, and effort

| Cycle(s) | Fix | Effort | Priority | Why |
|---|---|---|---|---|
| S3, S5, S6 | None required. | 0h | **None** | Both edges erased; there is no runtime relationship to fix. Only worth touching if the *tooling* noise (madge/CI counting these) becomes annoying enough to justify a structural type move — see below. |
| S1, S2, S4 | Structural: relocate `AdjustmentScope`, `SyncBaseline`, and the typography types (`RichText`, `TextMode`, etc.) out of their domain modules into a shared low-level module `types.ts` can import without reaching back into `adjustmentScope.ts`/`component-sync.ts`/`typography.ts`. This is exactly `docs/audits/architecture-health-baseline-2026-07-25.md`'s Phase 1/2 recommendation, already on file. | 4-8h (Phase 2 estimate, unchanged from existing baseline doc) | **Low** | Zero runtime risk today. The payoff is a smaller/clearer TS source graph and fewer madge false-positives, not a bug fix. Don't schedule this ahead of anything with real user-facing risk. |
| S7 (auditFinding ↔ suppressions) | **Real, cheap, full fix**, not cosmetic: `auditFinding.ts` lines 301-302 are a pure barrel re-export (`export type { SuppressionEntry }` / `export { applySuppressions, buildSuppression, isSuppressed } from './suppressions'`) — nothing in `auditFinding.ts` calls these internally. Move the re-export to `packages/scene/src/index.ts` (`export * from './suppressions';`, alongside the existing `export * from './auditFinding';`), delete lines 301-302 from `auditFinding.ts`, and repoint `packages/scene/src/auditEngine.ts:29` (`import { buildAuditSummary, isSuppressed } from './auditFinding'`) to import `isSuppressed` from `./suppressions` directly. After this, `auditFinding.ts` has **zero** import from `suppressions.ts` — the cycle doesn't just go type-only, it's gone. | ~30 min | **Medium — do this one, it's nearly free** | It's brand new (uncommitted), it's the one scene cycle that's a textbook "barrel re-export creates a cycle" case (the exact anti-pattern Prompt 6's `no-restricted-imports` ban targets), and it's cheaper to fix now than after more callers start depending on the `auditFinding` barrel path. **Recommended as the first, separate, single-concern PR** — not bundled into this one, per PR discipline. |
| E1 (engine ↔ wasmLoader) | None required; already correctly designed (dynamic import specifically to defer the wasm load and avoid a synchronous cycle). Optional cosmetic: relocate `Engine` type to a shared file if the madge noise matters. | 0h (1h optional) | **None** | Deliberate lazy-load pattern, not an accident. |
| E2 (filterCompositor ↔ lut ↔ bake) | **The one that matters.** Extract the shared raster-filter primitive that both `filterCompositor.ts` and `lut/bake.ts` need (the actual pixel-application step) into a leaf module neither needs to import back through the other — matching the architecture-health baseline's own Phase 3 suggestion for this exact cycle, previously scoped as "extract shared types into `lut/types.ts`"; the finding here is that the shared thing isn't just types, it's the `applySoftwareFilter`/`applyLutToImageData` value functions themselves, so the extraction has to move code, not just type declarations. | 8-16h (Phase 3 estimate, unchanged) | **Medium-high** (highest of the 10, but not urgent — zero current incidents) | This is the only cycle among all 10 built entirely from real value edges. It's not broken today only because every cross-cycle call happens to be deferred inside a function body — one added top-level constant (`const DEFAULT_LUT = bakeFiltersToLut(...)`-shaped code, the same class of mistake as `17ddebfa`) would reproduce the exact TDZ failure this repo has already hit twice. Schedule it, don't rush it. |
| E3 (raster ↔ raster-size) | None required. `raster-size.ts`'s edge is already `import type` — 100% erased. | 0h | **None** | Never a runtime cycle; only exists in the type-blind cycle count. |

**Bottom line on effort:** of ~13-25h of *possible* cycle work across all 10, only the 30-minute S7
fix has both (a) non-trivial value and (b) near-zero cost. Everything else is either free (already
safe, no fix needed) or a multi-hour structural change with no currently-demonstrated bug behind
it. Don't let "10 cycles" or "seven cycles" read as 10 or 7 equally-weighted problems — it's one
cheap real fix (S7), one real-but-not-urgent one (E2), and eight items that need either nothing or
a tooling change, not a code change.

## 5. Ratchet — from count-based to identity-based

### The gap

`scripts/audit-architecture.mjs --ci` already existed and already runs `madge --circular` per
package, diffed against `.architecture-baseline.json`. But the comparison was **count-only**:

```js
// before
if (cData && cData.count > (bData.count || 0)) {
  errors.push(`CYCLE REGRESSION: ${name} — ${cData.count} cycles (baseline ${bData.count})`);
}
```

Concretely broken by this: fix `brush.ts ↔ document.ts` (S6, harmless, type-only) and introduce a
brand-new value cycle between two unrelated files in the same package in the same PR — the count
stays at 7, `7 > 7` is `false`, CI passes. This is precisely the "fix seven, grow three more"
failure Task 4 warns about, and it isn't hypothetical: **S7 itself is a live instance of a new
cycle appearing in uncommitted work** while old ones were being fixed elsewhere in the same
package.

### The fix (already applied, `scripts/audit-architecture.mjs`)

Per-package **set difference** against the baseline's own `cycles` array (which the script was
already writing on `--update`, just never diffing by identity):

```js
// after
if (baseline.cycles) {
  for (const [name, bData] of Object.entries(baseline.cycles)) {
    const cData = cycles[name];
    if (!cData) continue;
    const allowed = new Set(bData.cycles || []);
    const current = new Set(cData.cycles || []);
    const newCycles = [...current].filter((c) => !allowed.has(c));
    const fixedCycles = [...allowed].filter((c) => !current.has(c));
    if (newCycles.length > 0) {
      errors.push(
        `CYCLE REGRESSION: ${name} — ${newCycles.length} new cycle(s) not in allowlist:\n` +
          newCycles.map((c) => `        + ${c}`).join('\n'),
      );
    }
    if (fixedCycles.length > 0) {
      console.log(
        `  ℹ ${name}: ${fixedCycles.length} allowlisted cycle(s) no longer present — ` +
          `run --update to shrink the allowlist:`,
      );
      for (const c of fixedCycles) console.log(`        - ${c}`);
    }
  }
}
```

Any cycle not already in the baseline's per-package list fails the build, regardless of whether the
total count went up, down, or stayed flat. A fixed cycle prints an informational note (shrink the
allowlist with `--update`) instead of silently vanishing into a count that has slack in it. The
`max_cycles` global threshold is left in place as a secondary sanity check; it's now redundant with
the identity check for catching regressions, but harmless.

`.architecture-baseline.json`'s `scene` entry was updated to explicitly grandfather all 7 current
scene cycles (including S7, the new one) and `engine`'s 3 were already exact matches to the live
graph — no change needed there.

### Verification

Unit-tested the diff logic directly (not the full slow multi-check script) against two scenarios:

1. **Current real state vs. updated baseline** → `PASS (no regressions)`, confirmed.
2. **Simulated swap** — S6 (`brush.ts → document.ts`) removed, a fabricated `evilA.ts → evilB.ts`
   added, count held at 7 (the exact "fix one, grow one" case) → old logic: `7 > 7` → **false, would
   have passed**. New logic: `CYCLE REGRESSION: scene — new: evilA.ts → evilB.ts` — **correctly
   caught**.

`node --check scripts/audit-architecture.mjs` passes (syntax verified). **Not verified**: a full
live `--ci` run of the entire script end-to-end — the full multi-check run (cycles + instability +
complexity + dead-code + duplication across 16 packages) takes several minutes per invocation via
`npx madge`/`ts-prune`/`jscpd` subprocess overhead and was still running in the background at
write-time; the isolated unit test above exercises the exact code path that changed and is the part
that matters for this PR. If a full run surfaces anything in the untouched sections (complexity,
dead-code, etc.), that's pre-existing and out of scope for this change.

### Out of scope, flagged for Prompt 6

Task 4 also asks for `no-restricted-imports` banning same-package barrel imports (the pattern that
caused S7). This repo lints with **Biome**, not ESLint — `no-restricted-imports` is an
`eslint-plugin-import` rule with no direct Biome equivalent as of the version pinned here
(`biome.json` already has `style.useImportType: "error"`, which catches the *value-vs-type* half of
this problem but not *same-package barrel* imports specifically). Solving this needs either a
custom Biome GritQL rule, a small standalone grep-based CI check, or accepting an ESLint dependency
for this one rule — a real decision, not a one-line config add, and squarely a separate PR per the
"one concern per PR" rule. Not implemented here.

## 6. Recommendation

| Refactor | Go/no-go | Basis |
|---|---|---|
| Fix S7 (auditFinding ↔ suppressions) | **Go** | 30 min, zero behavior change, removes the one scene cycle built from a real anti-pattern, cheapest while it's still uncommitted. |
| Fix S1/S2/S4 (document→bindings type fan-out) | **No-go, not now** | Real but zero current impact; 4-8h of type relocation for a graph-hygiene win, not a bug fix. Revisit opportunistically when touching `types.ts`/`document.ts` for other reasons (e.g. the Phase 4 `context.tsx`/`CanvasArea.tsx` work), not as a standalone PR. |
| Fix S3/S5/S6 | **No-go, ever (as currently understood)** | Never were runtime cycles. Fixing them changes nothing except a CI count. Leave allowlisted. |
| Fix E2 (filterCompositor/lut/bake value cycle) | **Go, but scheduled, not urgent** | The one cycle in this set structurally capable of a TDZ-class failure (this repo has hit that exact class twice, `17ddebfa`/`0bf98cf6`). No current incident. 8-16h, needs a real extraction, deserves its own PR with before/after verification that no top-level cross-cycle access was introduced by the extraction itself. |
| Fix E1/E3 | **No-go** | E1 is deliberate and safe by design; E3 is fully erased. |
| Ratchet (this change) | **Done** | Identity-based allowlist live in `scripts/audit-architecture.mjs`, verified against both the real current state and a constructed swap scenario. |

### Definition of done for this document

- **Metric moved, with a number**: cycle *count* unchanged (still 10 total, 7 scene + 3 engine) —
  this task was classification and ratchet, not remediation. What moved: the ratchet went from
  count-based (defeatable by any same-count swap) to identity-based (defeats that swap, verified
  §5.3).
- **Ratchet updated so it can't regress**: yes — §5, plus baseline file updated to grandfather the
  true current 7 scene / 3 engine cycles explicitly.
- **AGENTS.md**: no new convention established by this document itself; the barrel-import
  convention belongs to Prompt 6, not here.
- **Left deliberately undone**: the S7 code fix itself (recommended as a separate PR, §4/§6), the
  E2 extraction (recommended, scheduled, §4/§6), and the Biome-vs-ESLint decision for
  same-package-barrel linting (Prompt 6's scope, §5).

## 7. Update, same day — E2 fixed; the editor target was already dead

A follow-up task named two specific targets to fix mechanically: `context.tsx ↔ context/index.ts`
(editor) and `filterCompositor.ts → lut/index.ts → lut/bake.ts` (E2, engine), framed as removing
"2 of 7 cycles." Reality, checked before touching anything:

- **`context.tsx ↔ context/index.ts` was not a live cycle.** `npx madge --circular` on
  `packages/editor/src/index.ts` returns `[]` — 0 cycles — and has for this entire document (§0's
  table already showed `editor: 0`). Tracing the actual dependency graph: `context.tsx` imports
  `./context/index` (the barrel), but `context/index.ts`'s own dependencies (`DocumentContext`,
  `MotionContext`, `PrototypeContext`, `SelectionContext`, `ViewportContext`, `types`,
  `reducedMotionManager`, `tools/types`) do not import back from `context.tsx`. This cycle from the
  architecture-health baseline was already broken, most likely by `17ddebfa`
  (2026-07-14, the `useMotion`/`usePrototype` TDZ fix cited in §3) or later context decomposition
  work. **Fixing it changed the cycle count by zero** — editor was 0 before and 0 after.
- It was still worth doing: `context.tsx` importing its own package's barrel instead of the
  concrete modules is the anti-pattern itself, live cycle or not, and leaving it in place is a
  standing invitation for the cycle to come back the next time someone adds an export to
  `context/index.ts` that reaches into `context.tsx`. Fixed anyway, mechanically, as hygiene.
- **E2 (the one real value cycle in this whole document) is fixed.** `filterCompositor.ts` imported
  `applyLutToImageData` and `LutTransform` from the barrel (`./lut`); both actually live in
  `./lut/apply` and `./lut/types` respectively — neither in `./lut/bake`, so "import directly from
  lut/bake" (as literally suggested) wasn't the right target; `lut/bake.ts` isn't something
  `filterCompositor.ts` needs anything from. Repointed both imports at their real source files.
  `filterCompositor.ts` no longer imports `./lut` (or `./lut/bake`) at all, which removes its edge
  into the cycle. Confirmed: `npx madge --circular` on engine now returns 2 cycles, not 3 — E1
  (`engine.ts ↔ wasmLoader.ts`) and E3 (`raster-size.ts ↔ raster.ts`) only.

**Net change from this update: 10 → 9 real cycles (engine 3→2; scene unchanged at 7; editor
unchanged at 0).** Not "2 of 7" — one of the two named targets was already fixed by prior work, and
the total scene/engine split this document tracks was 10, not 7, to begin with (§0). The ratchet
allowlist (`.architecture-baseline.json`) was shrunk to match — `engine.cycles` no longer lists the
fixed path, verified against the identity-diff logic in §5 (`new: [] fixed: []` against the live
graph, i.e. no regression, nothing left dangling).

**Verification performed:**
- `pnpm --filter @strata/engine typecheck` — clean, zero errors, before and after.
- `npx vitest run packages/engine/src/filterCompositor.test.ts packages/engine/src/lut/lut.test.ts
  packages/engine/src/lut/lut-edge.test.ts` — 67/67 passing.
- `pnpm --filter @strata/editor typecheck` — pre-existing errors only (none reference the 5 context
  files touched or `context/index`; all are unrelated WIP in other files, e.g.
  `AuditProfileSwitcher.tsx`, `IntelligencePanel.tsx`, `workspaceTypes.ts`).
- `npx vitest run packages/editor/src/context.import.test.tsx` — 5 failures, but confirmed via
  `git stash` isolation to be **pre-existing and identical with or without this change** (a
  clipboard/paste-selection bug, unrelated to import structure).
- Grepped every module in both cycles for top-level side effects (only `createContext(...)` calls
  and pure declarations found) — no initialization-order behavior to preserve or break.
- Package-boundary check: both fixes are intra-package relative imports (`filterCompositor.ts` →
  `./lut/apply`, `context.tsx` → `./context/DocumentContext` etc.), never crossing a
  `package.json` `exports` boundary, so the subpath-exports edge case from the brief doesn't apply
  here — verified by inspecting `packages/engine/package.json` and `packages/editor/package.json`,
  neither of which declares (or needs) a `./lut` or `./context` subpath.

**Not verified — bundle size.** `apps/desktop`'s production build (`vite build`) is currently
broken for a reason unrelated to this change (`ERR_MODULE_NOT_FOUND: @vitejs/plugin-react`,
consistent with `report-audit.md`'s independent finding that "the production build is currently
broken"). Reproduced it directly rather than assume. No before/after bundle-size number is reported
— fixing the build is a separate, pre-existing concern, not part of this mechanical cycle fix. The
qualitative expectation: negligible-to-none, since Rollup/esbuild already tree-shake named ESM
exports whether accessed via a barrel or a concrete path — the win here is graph clarity and one
fewer dangerous value cycle, not bytes.

## 8. Update, same day — Button/IconButton was already dead too; E3 (raster ↔ raster-size) fixed

A further follow-up named two more targets: `ui/src/components/Button.tsx ↔
ui/src/components/IconButton.tsx` and `engine/src/raster-size.ts ↔ engine/src/raster.ts` (E3).

- **`Button.tsx ↔ IconButton.tsx` is not a live cycle, and hasn't needed the shape-(a)/(b)/(c)
  decision the brief anticipated.** `Button.tsx` does not import `IconButton.tsx` at all — it
  renders its own `<button>` independently. `IconButton.tsx` imports `type { ButtonSize,
  ButtonVariant } from './Button'`, already `import type`, already erased, with no edge coming
  back. `npx madge --circular` on `packages/ui/src/index.ts` returns `[]`. This matches the
  editor `context.tsx` case in §7 exactly: the architecture-health baseline's claim ("Button
  imports IconButton for internal use") no longer matches the code, almost certainly fixed by the
  same `0f8fa1e7` cycle-remediation commit. **No extraction to `buttonTypes.ts` was made** — the
  brief itself flagged this possibility ("likely already type-only; check Prompt 5's
  classification") and the classification confirms it: there is nothing left to break, and adding
  a new leaf file for an already-one-directional, already-erased type import would be indirection
  with no corresponding cycle to justify it.

- **E3 (`raster-size.ts ↔ raster.ts`) is fixed for real**, not just reclassified. Unlike Button/
  IconButton this one *was* an actual (if fully type-erased, per §2's classification) two-file
  relationship: `raster.ts` needed `estimateFileSize` (value) from `raster-size.ts`;
  `raster-size.ts` needed `RasterFormat` (type, already `import type`) from `raster.ts`. Extracted
  both `RasterFormat` and the pure size math (`estimateFileSize`, plus `computeOutputDimensions`,
  which lived in `raster.ts` and is the same class of pure scale/dimension math) into a new leaf
  module, `packages/engine/src/rasterMath.ts` — no imports from either original file. `raster.ts`
  now imports from `rasterMath.ts` and re-exports the same three names for compatibility;
  `raster-size.ts` was deleted (zero remaining consumers after updating the one intra-package
  test that imported it directly). Confirmed: `npx madge --circular` on engine now returns a
  single cycle — `engine.ts ↔ wasmLoader.ts` (E1, the deliberate dynamic-import lazy-load,
  unaffected) — down from 2.

  Added property-based tests (`rasterMath.fuzz.test.ts`, `fast-check`, following the existing
  `bezier.fuzz.test.ts` pattern): non-negative output for non-negative input, integer rounding,
  aspect-ratio preservation within a rounding-scaled tolerance, finiteness at extreme scale
  factors (1e4-1e8x) and extreme dimensions (1e4-1e6px), zero/one-pixel edge cases, and (for
  `estimateFileSize`) monotonic non-decrease in pixel area and quality-clamping equivalence. 13
  property tests, 25 total in the three raster/rasterMath test files, all passing (hundreds of
  generated cases each via `numRuns`).

  **Edge cases checked, per the brief:**
  - Downstream consumers of the moved types/values: grepped the whole repo. Every cross-package
    consumer (`packages/editor/src/exportService.ts`,
    `components/SpecPanel/AssetExportControls.tsx`) imports `RasterFormat`/`estimateFileSize`/
    `computeOutputDimensions` from `@strata/engine`'s public barrel (`packages/engine/src/index.ts`
    → `./raster`), which still re-exports all three unchanged — zero external impact. The only
    intra-package consumer of `./raster-size` directly was `raster.test.ts`; updated in this same
    change.
  - Public API / `exports` field: `packages/engine/package.json` only declares `"."` and `"./font"`
    subpaths — `raster.ts`/`raster-size.ts`/`rasterMath.ts` were never externally reachable by deep
    import, so no subpath-exports change was needed and no deprecation re-export is required.
  - Verified: `pnpm --filter @strata/engine typecheck` clean; full engine suite —
    **195 test files, 2515 tests, all passing** (this is broader than a targeted check because
    deleting `raster-size.ts` is exactly the kind of change that can break something far away, and
    the brief calls out that breaking changes need to be caught in the same PR); `madge --circular`
    confirms 1 engine cycle, not 2.
  - **Could not `rm` cleanly.** The sandbox's auto-mode classifier blocked both `rm` and
    `git rm` on `packages/engine/src/raster.test.ts` after its old `./raster-size` import broke
    (mid-edit, following the `raster-size.ts` deletion). Rather than fight it, fixed the import in
    place and trimmed `raster.test.ts` down to a two-assertion "re-export surface still works"
    smoke test (full behavioral coverage, including the new property tests, lives in
    `rasterMath.test.ts`/`rasterMath.fuzz.test.ts`, which test the implementation directly) —
    functionally equivalent to a clean rename, just without the file-count drop. `raster-size.ts`
    itself *was* deletable (first `rm` succeeded); only the second deletion in the same turn was
    blocked, for reasons not disclosed by the classifier.

**Net from this update: 9 → 8 real cycles (engine 2→1; scene/editor/ui unchanged).** Ratchet
allowlist shrunk again (`.architecture-baseline.json`'s `engine.cycles` now lists only
`engine.ts → wasmLoader.ts`), verified with the same identity-diff check as §5/§7
(`new: [] fixed: []`).
