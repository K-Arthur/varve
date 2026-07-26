# The scene package "16-file cycle" — reduced graph, before any structural work

The original report described a 16-file mega-cycle across `packages/scene` (types, document,
assets, bindings, motion-types, and others) — "the most depended-upon code in the product."
Per instructions: report the reduced graph *before* doing any structural work, and only do the
"real value cycle" structural fix (leaf `core-types.ts`, layering, AGENTS.md) if one actually
exists after type-only classification. **One doesn't.** This document is the reduced graph and the
reasoning for stopping short of restructuring, plus the one small fix that was real.

## The reduced graph

Full edge-by-edge classification already exists in `docs/quality/cycles.md` §2/§8 (produced for a
separate cycle-ratchet task, reused here since it already answers exactly this question). Live
`madge --circular` against `packages/scene/src/index.ts` right now, **after** the one fix below:

```
adjustmentScope.ts → bindings.ts → document.ts → types.ts
bindings.ts → component-sync.ts → document.ts → types.ts
component-sync.ts → types.ts
bindings.ts → document.ts → types.ts → typography.ts
types.ts → typography.ts
brush.ts → document.ts
```

**6 cycles, spanning 6 files** (`adjustmentScope`, `bindings`, `document`, `types`,
`component-sync`, `typography`, `brush`) — not 16. Before this fix there were 7 cycles / 7 files
(the 7th, `auditFinding.ts ↔ suppressions.ts`, is the one real fix in this pass — §3). The other 9
files the original report bundled into "16" (`assets`, `motion-types`, `library`, `clone`,
`linterTypes`, `version`, etc.) have **no cycle at all** as of the current working tree — either
already fixed by earlier remediation (`0f8fa1e7`) or never actually cyclic; `docs/quality/cycles.md`
§0 has the trend (5 → 19 → 10 → 9 → 8 → 7 → now 6, tracked across this session).

## Is there a real value cycle? No.

Every one of the 6 remaining cycles has at least one edge that's fully erased at compile time
(`import type`, or an inline `import('./x').Y` type query — both confirmed erased against
`verbatimModuleSyntax: true` in `cycles.md` §1). Concretely, all 6 reduce to **one real value edge**
shared across three of them (`document.ts → bindings.ts`, for `stripBindingForVariable`) plus a
type-only spine, and **three cycles that are 100% type-only in both directions** and were never
runtime cycles at all (`component-sync.ts ↔ types.ts`, `types.ts ↔ typography.ts`,
`brush.ts ↔ document.ts`). Full per-edge classification, including exact line numbers, is in
`cycles.md` §2 — not repeated here.

**There is no set of edges, among these 6, that are all real values forming a closed loop.**
Per the brief's own framing: this means the "IF THERE IS A REAL VALUE CYCLE" branch (visualize,
find feedback edges, extract `core-types.ts`, declare a strict intra-package layering in
AGENTS.md, enforce it) **does not apply.** Doing that work anyway — splitting `types.ts`'s
`AdjustmentScope`/`SyncBaseline`/`RichText` references into a new leaf file, declaring a 5-layer
intra-package hierarchy, wiring a new layer-enforcement pass for it — would be exactly the
"restructure 16 files for a compile-time-erased cycle" the brief explicitly says not to do. Not
done, on purpose.

The document.ts↔bindings.ts/types.ts fan-out (S1/S2/S4 in `cycles.md`) is a legitimate long-term
graph-hygiene item (`types.ts` reaching into `adjustmentScope`/`component-sync`/`typography` via
inline type queries is inverted — a foundational type module shouldn't reach into domain modules)
but it is zero-risk today and `cycles.md` §6 already scores it **no-go, not now** — 4-8h of type
relocation for a CI-count win, not a bug fix. Revisit opportunistically when touching `types.ts`/
`document.ts` for unrelated reasons, not as a standalone PR.

## The one real fix: `auditFinding.ts ↔ suppressions.ts`

This was the one cycle in the set built from an actual anti-pattern rather than an erasure
artifact: `auditFinding.ts` re-exported `suppressions.ts`'s public API as a barrel
(`export { applySuppressions, buildSuppression, isSuppressed } from './suppressions';`) while
`suppressions.ts` needed `AuditFinding` as a type. `cycles.md` §4 fully diagnosed this and scored it
**"Go — do this one, it's nearly free."** Done in this pass, as its own single-concern change:

- Removed the re-export from `auditFinding.ts` (it had zero internal use — pure facade).
- Added `export * from './suppressions';` to `packages/scene/src/index.ts` (the package's real
  public barrel) so `@strata/scene`'s external surface is unchanged.
- Repointed the one internal consumer that relied on the barrel path —
  `auditEngine.ts` imported `isSuppressed` and the `SuppressionEntry` type from `./auditFinding`;
  both now come from `./suppressions` directly.
- Grepped the whole repo for other consumers of `SuppressionEntry`/`applySuppressions`/
  `buildSuppression`/`isSuppressed`: `packages/editor/src/panels/IntelligencePanel.tsx` imports
  `SuppressionEntry` from `@strata/scene` (the package barrel, unaffected by this change) — no
  other internal or cross-package consumer existed.

`madge --circular` on scene: 7 → 6. Verified: `pnpm --filter @strata/scene typecheck` shows zero
new errors (pre-existing errors are all in `findReplace.test.ts`, unrelated WIP, confirmed absent
from this diff's files); `auditFinding.test.ts` (21), `suppressions.test.ts` (32),
`auditEngine.test.ts` (30) — 83/83 passing; full scene suite — 1579/1583 passing, the 3 failures in
`state-machine-runtime.test.ts` confirmed via `git stash` isolation to be pre-existing and identical
with or without this change (unrelated WIP on that file, non-deterministic ID generation).

## The lint rule: extended the existing mechanism, not a new one

Per instruction, extended `scripts/audit-architecture.mjs` (which already runs `checkCycles` and
`checkLayers` as part of the same gate) rather than inventing new tooling. Added
`checkTypeOnlyEdges()` — a narrow, sharp check for exactly the risk that matters here: **the
general cycle ratchet (`checkCycles`, added in an earlier pass) can't tell a type-only edge from a
value edge at all**, since `madge` doesn't distinguish them (`cycles.md` §1). That means if one of
the 6 allowlisted cycles' type-only edges silently became a real value import, the cycle-identity
ratchet would see the *same cycle path string* and wave it through — an allowlisted harmless cycle
turning into a real one, with no signal. `checkTypeOnlyEdges()` hard-asserts, for each of the 7
specific edges classified as type-only in `cycles.md` §2, that the import statement targeting that
module is still `import type` (or every named specifier carries its own `type` modifier) — not
gated behind the baseline/allowlist machinery, since this isn't a metric to gradually improve, it's
an invariant that must always hold:

```js
const TYPE_ONLY_EDGES = [
  { file: 'packages/scene/src/adjustmentScope.ts', from: './document' },
  { file: 'packages/scene/src/bindings.ts', from: './types' },
  { file: 'packages/scene/src/component-sync.ts', from: './document' },
  { file: 'packages/scene/src/component-sync.ts', from: './types' },
  { file: 'packages/scene/src/typography.ts', from: './document' },
  { file: 'packages/scene/src/typography.ts', from: './types' },
  { file: 'packages/scene/src/suppressions.ts', from: './auditFinding' },
];
```

Wired into `main()` unconditionally (cheap — a handful of file reads, not a `madge` invocation) and
its violations feed directly into the same `errors` array that fails the script — no `--ci` flag
needed, this runs and fails on any invocation.

**Verified against two cases:** the real current source (`checkTypeOnlyEdges()` → `[]`, confirmed
via the actual script's own console output: `✓ all known type-only edges are still type-only`),
and a constructed regression (mutated `bindings.ts`'s `import type { PropertyBinding, SceneNode }`
into a mixed `import type { PropertyBinding }` + a bare `import { SceneNode }`, ran the check,
confirmed it reported the violation by file/edge/specifier, then restored the file — confirmed via
`git diff` showing zero residual change).

Deliberately **not** added: `core-types` extraction, an intra-package `AGENTS.md` layering
declaration, or a general intra-package layer-enforcement pass mirroring the package-level one
(`checkLayers`, 0 violations across the 10-package layering). There's no real value cycle here to
justify that machinery; building it now would be inventing structure for a problem that doesn't
exist, which is exactly the failure mode this whole exercise was scoped to avoid.

## Edge cases checked

- **Recursive/mutually-recursive types:** none of the 6 remaining cycles were "fixed" by splitting
  a type union across files — per instruction, that would hurt readability for no runtime gain, and
  none of the type-only edges here are unions needing that treatment anyway (they're single-type
  references: `Document`, `NodeId`, `PropertyBinding`, `SceneNode`, `AuditFinding`,
  `AdjustmentScope`, `SyncBaseline`, `RichText`-family types).
- **Import-time registry registration:** `auditEngine.ts` (touched by the S7 fix, adjacent to it)
  has exactly this pattern — a `rules = new Map<string, AuditRuleDef>()` registry with
  `registerRule()`. Checked: it's called only from `registerBuiltinRules()` in `auditAdapter.ts`,
  an explicit function documented "call once on editor startup" — not at module import time.
  **Separately found: `registerBuiltinRules()` is never actually called anywhere in the repo** —
  the registry is currently unpopulated in the running app. This is a real, pre-existing bug, but
  it's unrelated to the cycle work (not caused by it, not fixable by touching imports) and out of
  scope for this pass — flagging it here rather than silently fixing or silently ignoring it.
- **Migrations depending on live current types instead of versioned snapshots:** checked
  `version.ts` (the migration file, `CURRENT_DOCUMENT_VERSION`/`migrateDocument`/
  `migrateDocumentDetailed`). It imports only `{ createEmbeddedAsset, mimeTypeFromDataUrl }` from
  `./assets` — every migration function signature operates on `unknown` / `Record<string,
  unknown>`, never on the live `Document`/`SceneNode` types from `document.ts`/`types.ts`. This is
  already the correct pattern; nothing to fix. (Noted in passing: an untracked
  `packages/scene/src/version.ts.partial` file exists alongside `version.ts` — a leftover snippet
  from unrelated concurrent work-in-progress in this shared tree, not touched here.)
- **FFI / golden IR fixture sync:** checked whether any type touched by the S7 fix
  (`AuditFinding`, `SuppressionEntry`) crosses the Rust FFI boundary or appears in the golden-IR
  fixture suite (`packages/engine/src/traceContractGolden.test.ts`,
  `packages/engine/src/__goldens__/goldenReplay.test.ts`, `upscaleGoldenParity.test.ts`,
  `packages/compositor/src/webgpu/golden.test.ts`). None reference `AuditFinding` or
  `SuppressionEntry` — those are audit/linting concepts local to `packages/scene`, never
  serialized across the render/IPC boundary. Not applicable to this specific change.
- **Small, revertable PRs:** this pass is one PR (`auditFinding.ts`/`auditEngine.ts`/`index.ts` +
  the ratchet), independently revertable from the wasm-cycle and raster-cycle fixes committed
  earlier this session. There was only one real feedback edge to remove in scene, so this is
  already the smallest unit — no further splitting needed.

## Running total

`docs/quality/cycles.md`'s tracked count: 10 → 9 (E2) → 8 (E3, Button/IconButton dead) → 7 (E1,
wasm cycle) → **6** (this fix). Scene: 7 → 6. Engine: 0 (fully clean, previous pass). Editor: 0.
UI: 0.
