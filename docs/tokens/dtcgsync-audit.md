# DTCG Design-Token Synchronization — Current-State Repository Audit

- **Date:** 2026-08-05
- **Status:** Accepted (Milestone 1 of the native DTCG token-sync program)
- **Scope:** Evidence-backed audit of Varve's variable system, editor surfaces,
  platform/Tauri layer, codegen, AI infrastructure, and test tooling, recorded
  BEFORE any synchronization code is written.

## 0. Program status (updated 2026-08-05, end of session)

Milestones M1–M8 are implemented, tested, and committed. The program runs on
branch `feat/token-sync` in worktree `.worktrees/token-sync`; M1–M4 commits
landed on `master` before the worktree switch. M8 lands the first functional
Sync Center slice: per-source status, change summary, and the guided DTCG
import workflow (parse → validate → preview → apply as one undoable
transaction) mounted in the layers panel. M9 (Git), M10 (interop adapters),
M11 (multimodal), and M12 (hardening) remain as documented follow-ups.

### Commit ledger

| Hash | Subject | Files | Validation |
| --- | --- | --- | --- |
| `5dac2347` | test(tokens): capture variable-system baselines | 1 (21 tests) | vitest scene ✓ |
| `f1e83112` | docs(tokens): record DTCG synchronization architecture | 26 (2 docs + 22 ADRs 0100–0121 + README index) | audit:docs ✓, audit:emoji ✓ |
| `8e204378` | feat(scene): add canonical design token model | 7 (tokens/ store, identity, bridge, persistence field) | vitest 21+23 ✓, biome ✓ |
| `900feeb7` | feat(tokens): add DTCG 2025.10 format support | 15 (new @varve/tokens package) | vitest 78 ✓, tsc ✓ |
| `2330ad35` | feat(tokens): add reference graph validation | 6 | vitest 113 ✓, tsc ✓ |
| `ee1690ef` | test(scene): update baseline pins for random variable ids | 1 | vitest ✓ |
| `f5d65cce` | feat(tokens): add semantic token diffing and three-way merge | 4 | vitest 138 ✓, tsc ✓ |
| `bbfbd10b` | feat(platform): add safe local token sources | 9 (sources, atomicWrite, watcherEvents, syncApply) | vitest 192 ✓, biome ✓ |
| `8d15a901` | docs(tokens): record session progress and commit ledger | 2 | audit:docs ✓ |
| `4bda210b` | feat(editor): add token sync panel with DTCG import preview | 8 (panel, selectors, import preview + apply) | vitest 203 ✓, biome ✓ |

Content-attribution notes (concurrent-session index races on shared master):
color bridge + scene package.json dependency landed inside the parallel
session's `1bf0732f`; resolver engine landed inside its `e2836a7a`. Content is
committed, verified, and intact; attribution reflects the race, not intent.
From `f5d65cce` onward all work is committed from the dedicated worktree.

### Concurrency record

A parallel session committed continuously to `master` while this program ran
(table model, mockup system, warp system, persistent-history ADRs 0017–0046,
collision-resistant ids). Handling per the session protocol: dedicated
worktree after M6, explicit pathspec staging, never destructive commands,
pre/post-commit verification, orphaned work recovered via reflog/cherry-pick
(never `reset --hard`). Pre-existing scene typecheck failures (table/warp
in-flight files) are recorded separately from regressions introduced here.

## 1. Executive summary

Varve has a functional but shallow variable system: collections, nested groups,
per-collection modes, name-or-id aliases, and a safe Pratt-parser expression
evaluator all exist in the scene model. It is missing every property that a
standards-based token synchronization workflow requires:

- No stable, collision-resistant identity (process-local counters and a
  `Date.now()`-based editor id are the only mechanisms).
- No provenance, no sources, no base snapshots, no sync state.
- Aliases resolve by name or id through a linear scan; renaming a token breaks
  every `{name}` alias that pointed at it.
- The only merge is a two-way "source wins" overwrite.
- No DTCG parser, serializer, validator, or resolver anywhere in the tree.
- No file watcher for token documents, no atomic-write infrastructure for
  external files, no Git integration, no secure credential storage.
- The editor exposes a flat variable table; collection/group/mode management
  exists in the scene model but has no UI call path.
- No CI/headless token validation, no token diffing, no conflict UI.

This audit pins those facts to specific files and line ranges so the
implementation milestones can be verified against a recorded baseline.

## 2. Test baseline (recorded before implementation)

- `pnpm --filter @varve/scene test`: **2006 passed, 1 skipped, 5 failed**.
- The 5 failures are all in `packages/scene/src/__tests__/table.test.ts` — a
  NEW, untracked file belonging to in-flight table work (uncommitted working
  tree, not part of this program). Pre-existing, unrelated.
- New baseline suite committed: `packages/scene/src/__tests__/variablesBaseline.test.ts`
  (21 tests) pins current variable behavior, including the documented
  limitations (name-alias breakage on rename, two-way merge, counter ids).

## 3. Repository map (relevant surfaces)

| Surface | Files | Role |
| --- | --- | --- |
| Variable model | `packages/scene/src/variables.ts` | `VariableStore`, collections, groups, modes, aliases, expressions, dependency map |
| Property bindings | `packages/scene/src/types.ts:652` (`PropertyBinding`), `bindings.ts` | `variableId` + `expression` + `modifiers`; render-time application |
| Document | `packages/scene/src/document.ts:176` (`variableStore?`), `documentCodec.ts`, `version.ts` | persistence, normalization, migration chain `0.9 → 2.15` |
| Editor variables UI | `packages/editor/src/VariablePanel.tsx` | Flat table; no tree, no collections UI, no search |
| Inspector bindings | `components/Inspector/controls/BindingMenu.tsx`, `sections/*` | Shift/`=`-driven binding menus per property |
| Platform port | `packages/platform/src/platform.ts`, `tauri.ts`, `web.ts`, `memory.ts` | Files, dialogs, settings KV, `listenForChanges` |
| Tauri commands | `apps/desktop/src-tauri/src/lib.rs` | `home_*`, `sync_*`, print, AI stubs; notify watcher on data dir only |
| Codegen | `packages/codegen/src/tokens.ts` | `resolveTokenName` only — no token file generation |
| AI | `packages/ai/src/index.ts` | Mock chat facade; real ONNX lives in `packages/engine` + Rust |
| Tests | root `vitest.config.ts`, `fast-check` ^4.9.0, fuzz tests | jsdom for editor/ui, node for scene |
| ADRs | `docs/adr/NNNN-kebab-slug.md` | Next free number: 0017 |

## 4. Scene and variable model — evidence

### 4.1 Identity

- `variables.ts:283-286`: `let _varIdCounter = 0; nextVarId() => \`v${++_varIdCounter}\``.
  Module-level mutable counter. **Not persisted, not collision-resistant.**
- `variables.ts:78-86`: same pattern for collections (`col-N`) and groups (`grp-N`).
- `packages/editor/src/context.tsx:7105`: the editor's own `addVariable` uses
  `var-${Date.now()}` — a THIRD, inconsistent id scheme that bypasses the store.
- `packages/scene/src/ids.ts:36-49`: `createIdGenerator`/`generateId` per-namespace
  counters for node/style/page ids; `node-id.ts` derives `n${doc.nextId}` from the
  persisted `doc.nextId` counter; pages use `crypto.randomUUID()`.
- Conclusion: **No subsystem provides collision-resistant persistent identity
  for variables.** Ids cannot survive import/copy/paste/merge/concurrent editing.

### 4.2 Names versus identity

- `resolve()` (`variables.ts:357-364`) looks up `store.variables[nameOrId]` by id,
  then falls back to a **linear first-match by name**.
- Alias values are strings like `{base}` (`variables.ts:403-409`); the alias
  parser splits on the token NAME. Renaming `base` breaks every alias.
- `buildVariableDependencyMap` (`variables.ts:516-574`) resolves alias names
  against `store.variables[refName]` OR first-match-by-name, then propagates
  bound node ids transitively (fixed-point loop).
- Baseline test pins the rename-breakage: `variablesBaseline.test.ts` —
  `PINNED LIMITATION: renaming a variable breaks name-based aliases`.

### 4.3 Values

- `VariableType = 'color' | 'number' | 'string' | 'boolean'`; values are
  `string | number | boolean | Record<string, unknown>` (`variables.ts:17-19`).
- Colors are persisted as strings (e.g. `#0066cc`), not as managed-color
  structures; `resolveBoundFill` (`bindings.ts:48`) converts.
- Math expressions are stored as raw strings in `valuesByMode` and evaluated by
  the Pratt parser in `expr.ts` — no `eval`/`Function`. Expressions cannot be
  distinguished from pure references without re-parsing the string.
- Durations, dimensions, typography, shadows, gradients have **no** typed
  representation in the variable model.

### 4.4 Collections, groups, modes

- `VariableCollection` (id, name, modes[], activeMode, variableIds[], groups[])
  and nested `VariableGroup` (`variables.ts:28-49`). Modes are per-collection.
- Aliases can cross collections freely (resolution searches all variables).
- **No editor UI calls the collection/group/mode APIs** (verified: zero
  matches in `packages/editor/src` for `createCollection`, `createGroup`,
  `addModeToCollection`, `setCollectionMode`).

### 4.5 Merge and deletion

- `mergeVariableStores` (`variables.ts:341-349`) is a two-way spread merge —
  source wins per key. No base, no three-way semantics. Used by collab sync
  (`packages/scene/src/__tests__/variables-sync.test.ts`).
- `deleteVariable` (store level) leaves node bindings dangling; document-level
  `deleteVariableFromDocument` (`document.ts:981-1001`) strips bindings via
  `stripBindingForVariable` (`bindings.ts:163-181`, returns `undefined` when empty).
- `getChangedVariableIds` (`variables.ts:467-503`) is the only change detector:
  shallow per-mode value comparison, no path/type/metadata comparison.

### 4.6 Persistence and migrations

- `Document.variableStore?` (`document.ts:176`) is optional; `createDocument()`
  starts with none.
- `serializeDocument` (`version.ts:906-910`) `JSON.stringify`s the whole
  transformed doc — **unknown top-level fields survive**; `normalizeDocument`
  (`documentCodec.ts:509`) also spreads `...doc`. An optional additive field on
  `VariableStore` therefore round-trips without codec changes.
- `CURRENT_DOCUMENT_VERSION = '2.15'` (`version.ts:7`); migration chain entries
  `from: '0.9' … '2.14'` in `version.ts`; `migrateDocument` /
  `migrateDocumentDetailed` / `migrateDocumentJson` are the entry points.

## 5. Editor surfaces — evidence

- `VariablePanel.tsx` (234 lines): flat editable table, add form, inline edit,
  resolved-value preview, mode select only when `modes.length > 1`. **No search,
  no tree, no collections, no mode creation UI.** Mounted inside the layers
  panel (`components/LayersPanel/index.tsx:535`).
- Binding UX: `BindingMenu.tsx` (portaled combobox, search, type filter, math
  expression input); number fields open it on `=`; shift+click on
  typography/position/radius/stroke controls; `setSelectedBinding`
  (`context.tsx:5027-5048`) batches over selection writing `nodeBindings`.
- `TokenBindIndicator.tsx` (bound-variable chip) is **dead code** — never
  imported; bound state is otherwise invisible until the menu opens.
- Dialogs: no central registry — per-dialog state in context (`useDialogState.ts`
  covers export/archive only) and hosts in `Shell.tsx`; programmatic
  `PromptDialog` via module-level bridge.
- Commands: `ActionRegistry.ts` singleton, `registerAllShortcuts` (no-op stubs)
  then `registerEditorActions` (real handlers — ordering is load-bearing),
  `ShortcutManager.ts` definitions, `createActionHandlers.ts` (~150 handlers).
- Toasts via `ToastBridge` → `@varve/ui` ToastProvider; `announce()` for a11y.

## 6. Platform and Tauri — evidence

- `Platform` port (`packages/platform/src/platform.ts:39-289`) with three
  adapters: memory/web/tauri. Covers files, dialogs, settings (string KV),
  `listenForChanges`, clipboard image, print.
- **Absent:** git commands, process execution, secure credential/keychain
  storage, OS-level file watching for arbitrary directories (the only watcher,
  `lib.rs:2202-2237`, watches the app data dir for `.varve`/`.strata` files and
  emits `home:files-changed`).
- `app_get_setting`/`app_set_setting` are plain SQLite string KV — NOT a secure
  store (verified in lib.rs command list; no keychain crate).
- `sync_save`/`sync_load` (`lib.rs:320,331`) are the varve-sync SQLite
  DocumentStore IPC — unrelated to design-token sync (collab/document storage).
- Browser fallback: IndexedDB (`platform/src/web-db.ts`); `listenForChanges` is
  a web stub. File System Access is not used.

## 7. Import/export/codegen — evidence

- `packages/import` parses SVG/PDF/PSD/AI/EPS for design import — no token
  import anywhere.
- `packages/codegen/src/tokens.ts` exposes only `resolveTokenName(bindings,
  property, store)` — binds a node's variable by NAME for generated output.
  **No CSS/SCSS/TS/JSON/Android/Swift token-file generators exist.**
- The app's own UI tokens (`@varve/ui` color.ts → tokens.css) are a separate
  system (ADR-0002) — not document variables, not DTCG.

## 8. AI and multimodal infrastructure — evidence

- `packages/ai` is a mock chat facade with canned responses and
  `INTELLIGENCE_COMMANDS` metadata; no typed structured output, no request-id
  protocol, no cancellation, no consent flow.
- Real on-device inference (ONNX) lives in `packages/engine` (workers) and Rust
  crates (`varve-bgremove`, `varve-upscale`), with consent/download UX for
  bundled models (e.g. `ModelDownloadDialog.tsx`).
- **No image/PDF attachment pipeline exists** for style-guide analysis.

## 9. Tests and tooling — evidence

- Vitest: node env default; jsdom for editor/ui/home; coverage thresholds per
  file (stmts 80 / branches 70 / funcs 80 / lines 80); Stryker configured.
- `fast-check` ^4.9.0 is a root dev dependency; property tests exist in
  engine/editor/scene. No fuzz harness, no Playwright token tests.
- Playwright E2E suite exists (`tests/e2e/`), chromium project, standard
  navigate-to-editor helper in `tests/e2e/shared.ts`.

## 10. Current-state capability matrix

| Capability | Existing | Partial | Missing | Broken | Evidence | Proposed owner |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Stable variable identity | | | | x | counter ids `variables.ts:78-86,283-286`; `var-${Date.now()}` `context.tsx:7105`; collisions unhandled | `@varve/scene` tokens |
| Collections | x | | | | `variables.ts:42-49`, ops `88-178`; no UI path | `@varve/scene` |
| Nested groups | x | | | | `VariableGroup.groups` + `createGroup` | `@varve/scene` |
| Per-collection modes | x | | | | `addModeToCollection`/`setCollectionMode`; no UI | `@varve/scene` + editor |
| Aliases | x | | | | `{name}` strings, `resolveRawValue` | `@varve/tokens` ref graph |
| Reference cycle detection | | x | | | only at resolve time (`variables.ts:366`); no graph | `@varve/tokens` |
| Math expressions | x | | | | Pratt parser `expr.ts`, no eval | `@varve/scene` (bridge) |
| Composite typed values | | | x | | only `Record<string, unknown>` | `@varve/tokens` codecs |
| DTCG Format parsing | | | x | | no parser anywhere | `@varve/tokens` |
| DTCG Color parsing | | | x | | colors are plain strings | `@varve/tokens` + scene color mgmt |
| DTCG Resolver parsing | | | x | | no resolver concept | `@varve/tokens` |
| Lossless unknown extensions | | | x | | nothing to extend yet | `@varve/tokens` |
| Source provenance | | | x | | no source concept | `@varve/scene` tokens |
| Semantic diff | | | x | | only `getChangedVariableIds` shallow | `@varve/tokens` |
| Three-way merge | | | x | | two-way `mergeVariableStores` | `@varve/tokens` |
| Conflict UI | | | x | | none | `@varve/editor` |
| Local file watching | | | x | | watcher only for app data dir | `@varve/platform` |
| Atomic external writes | | | x | | no external-write path | `@varve/platform` |
| Git-backed source | | | x | | no git commands | `@varve/platform` + tauri |
| Generated platform outputs | | | x | | only `resolveTokenName` | `@varve/codegen` |
| Adapter capability reporting | | | x | | none | `@varve/tokens` |
| Undoable synchronization | | | x | | undo is doc-snapshot based; no sync ops | `@varve/editor` |
| Collaboration-safe sync | | | x | | collab merge is two-way | `@varve/collab` + tokens |
| Multimodal token extraction | | | x | | mock AI facade only | `@varve/ai` |
| CI/headless validation | | | x | | no CLI validation entry | `@varve/tokens` + scripts |

## 11. Reuse / migrate / wrap / deprecate analysis (existing variable system)

**Reuse directly**
- `VariableStore` collections/groups/modes data model and ops — the shape maps
  cleanly onto DTCG groups; keep as the persistence layer.
- `expr.ts` Pratt evaluator — safe math; keep for Varve expressions.
- `stripBindingForVariable`, `applyBindingsToNode`, `resolveBinding` — binding
  lifecycle and render-time application stay on variables.
- `PropertyBinding` (`variableId` + `expression` + `modifiers`) — bindings keep
  referring to variables; token import creates/updates the underlying variables.
- `getChangedVariableIds` as a fast path inside the future semantic diff.
- `documentCodec` spread-based normalization and the version migration chain —
  additive fields require no codec change; migration hook exists.

**Migrate (gradually, with compat)**
- Variable identity: add stable UUID ids as a new optional field; keep `vN`
  ids for existing docs; new ids are minted for imported tokens.
- Values: introduce typed token values in the token store while variables keep
  their current value strings; the bridge materializes variable values from
  token values.
- `mergeVariableStores`: replace with the three-way merge in the sync path;
  keep the two-way function for legacy collab call sites until migrated.

**Wrap behind an adapter**
- `resolve` (name-or-id lookup) becomes a thin facade over the token store's
  id/path/pointer indexes; alias resolution moves to the reference graph.
- `buildVariableDependencyMap` is superseded by the token store's bound-node
  index + reference graph (kept for backward compat call sites).

**Deprecate gradually**
- Name-based alias strings inside `valuesByMode` for synchronized tokens:
  imports write id-based or graph-backed references; name-only values remain
  readable but are flagged in Sync Center.
- `var-${Date.now()}` editor id scheme (`context.tsx:7105`).

**Remove only after migration**
- Nothing is removed in this program. The two-way merge is retained as a
  compatibility path until every collab call site is migrated.

## 12. Migration risks

1. **Id collision:** existing docs with `vN`/`col-N` ids can collide with
   imported tokens if import minted counter ids — import must mint UUIDs.
2. **Alias breakage:** name-based aliases that survive into sync must be
   converted to identity-backed references before rename/move detection is
   enabled; otherwise a sync pull can silently break local bindings.
3. **Codec spread contract:** the token state rides on `VariableStore`; any
   future curated serialization must keep the field or the sync state is lost
   (mitigation: schemaVersion + recovery from source on next connect).
4. **Working tree:** scene files carry unrelated in-flight work (table feature);
   token modules are additive-only and avoid editing modified files.
5. **Collab two-way merge:** until migrated, a collab merge can overwrite token
   sync state — the sync state merge must be added to
   `mergeVariableStores`/collab path in the same change that ships sources.

## 13. Performance baseline (recorded)

- No token workloads exist to measure. Future baselines: parse (100/1k/10k/50k
  tokens), reference-graph construction, three-way merge, resolver permutations.
- Existing bench harnesses: `vitest.bench.config.ts` (`pnpm bench`),
  `packages/engine/src/bench/`, `canvas10k.bench.test.ts` — the token benches
  will follow the same conventions (see ADR-0121).
