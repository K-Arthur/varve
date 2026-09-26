# DTCG 2025.10 — Interoperability Evidence Ledger and Coverage Matrix

- **Date:** 2026-09-25
- **Status:** Accepted (research + audit record for the DTCG completion pass)
- **Scope:** Primary-source verification of the standards baseline, third-party
  interoperability evidence, and a module-by-module coverage matrix of Varve's
  implementation. Written before the repair pass so defects are recorded against
  a fixed baseline.

## 0. Standards baseline (verified, not assumed)

| Source | Accessed | Version / status | Requirement or behavior |
| --- | --- | --- | --- |
| `https://www.designtokens.org/technical-reports/` | 2026-09-25 | **2025.10 — Stable, published 2025-10-28**; "Preview" is separately listed as *Experimental* | 2025.10 is the stable target; `/TR/drafts/` is explicitly experimental and must never be implemented as stable |
| `https://www.designtokens.org/TR/2025.10/format/` | 2026-09-25 | **Final Community Group Report, 28 October 2025**, "considered stable"; *"not a W3C Standard nor … on the W3C Standards Track"* | Format module normative text (names, `$type` inheritance, `$root`, `$extends`, references, types) |
| `https://www.designtokens.org/TR/2025.10/color/` | 2026-09-25 | Final Community Group Report, 28 October 2025, stable | 14 color spaces; `components` elements MUST be number or `none`; `alpha` optional, defaults to 1; `hex` optional 6-digit **fallback** |
| `https://www.designtokens.org/TR/2025.10/resolver/` | 2026-09-25 | Final Community Group Report, 28 October 2025, stable | Resolver documents: `version`, `sets`, `sources`, `modifiers`, `resolutionOrder` |
| `https://www.designtokens.org/schemas/2025.10/format.json` | 2026-09-25 | Official-domain schema (DTCG repo, PR #412, 2026-06-10); **draft-07**; self-describes `$schema` as *"not part of the official DTCG specification"*; the frozen 2025.10 report still carries the editor's note *"exploring the addition of a JSON Schema"* | Useful as an **independent consumer check**, never as the normative definition |
| DTCG repo history (`git log -S '$version'`, 2021-02-03 → 2026-09-08) | 2026-09-25 | all versions | **`$version` has never existed in DTCG**; official schema rejects it at token and document level |

Normative vs non-normative: only `MUST` / `MUST NOT` / `MAY` (BCP 14) are
normative. Component **range tables** in the Color module sit without a `MUST`
to reject, and §5 "Gamut mapping" opens *"This section is non-normative."*
There is **no normative requirement to reject out-of-range components**;
behavior on `hex`/`components` mismatch is **not specified**.

### Correction applied in this pass

Earlier project text called the Format module a *"Draft Community Group Report
(published 2026-07-30 snapshot)"* (`docs/tokens/dtcgsync-architecture.md`,
`packages/tokens/src/spec.ts`). Both the report type and the date were wrong.
Corrected to Final Community Group Report, 2025-10-28.

## 1. Third-party evidence ledger

Access date for all rows: 2026-09-25. "Version it refers to" is the format the
source actually describes, not the label it uses.

| Source | Date | Version it actually refers to | Observed behavior / requirement | Relevance to Varve | Proposed acceptance test |
| --- | --- | --- | --- | --- | --- |
| styledictionary.com/info/dtcg | 2026-09-25 | v4 = pre-2025.10 draft; 2025.10 = WIP in v5 | "First-class DTCG since v4"; *"the latest format 2025.10 does not have full support yet"* | Do not equate "Style Dictionary supports DTCG" with 2025.10 | N/A (external) |
| Style Dictionary #1590 | opened 2025-11-04, live 2026-09-18 | 2025.10 | color/border/shadow/dimension shipped; **gradient, duration, `$extends`, JSON Pointer `$ref`, resolvers unsupported** | Confirms `$extends`/`$ref` are the discriminating 2025.10 features; Varve must keep them | Fixture with `$extends` + `$ref` parses, resolves, and round-trips in Varve |
| Style Dictionary probe (SD 5.5.5) | 2026-09-25 | 2025.10 | `$root` OK; **`$ref` token silently dropped**; `$extends` not applied; `$version` silently ignored | A "successful" round trip through a weak consumer proves nothing | Independent-consumer check must be paired with a strict parser (Varve's own + official schema) |
| docs.tokens.studio/manage-settings/token-format | 2026-09-25 | unversioned (links living draft) | "W3C DTCG" = `$`-prefix + name rules; default is legacy format; *"additional token types … future releases"* | Tokens Studio's "DTCG" toggle ≠ 2025.10; Varve must not claim Tokens Studio = 2025.10 | Adapter capability report marks Tokens Studio profile as partial |
| Tokens Studio #3615 / PR #3640 | 2025-10-03 / 2025-10-13 (PR closed unmerged) | group `$description` | Group-level `$description` unsupported | Lost descriptions are a live ecosystem failure | Fixture: group `$description` survives Varve import → edit → export |
| Tokens Studio #3465 | 2025-07-22, open | `number` type | Numbers saved as JSON strings | Type fidelity check | `number.$value` must be a JSON number in export |
| Tokens Studio #3778 | 2026-02-16, open | aliases | Export flattens alias references | Flattening is the top interop complaint class | Alias fixture exports with `{…}` references intact (default profile) |
| Figma help "Modes for variables" | edited 2026-06-24, updated 2026-09-24 | **2025.10** (links `TR/2025.10/format`) | Native DTCG **import**; limited type set (sRGB/HSL colors, px-only dimension, single-string fontFamily, s-only duration); slash-normalizes names and **drops duplicates silently**; export format unspecified | Vendor dialect limits must be reported per type, not as one boolean | Capability matrix records Figma profile: partial types, duplicate-drop warning |
| Figma forum 48474 | 2025-12-10, unresolved | "DTCG based Variables Export" | `description` missing from variables export | Complaint (not verified product behavior); motivates description-preservation tests | Description round-trip test (scenario D) |
| Penpot forum 10544 | 2026-05-04 (+staff 2026-05-05) | 2025.10 vs Tokens Studio | Export is **Tokens Studio multi-set**, not 2025.10; 9 transforms needed | Penpot's "DTCG" claim and its output shape diverge | N/A (external); informs adapter profile naming |
| Penpot forum 9946 | 2025-10-06; Penpot reply 2025-10-07 | `$extensions` | Extensions **preserved but never applied** | Preserve-without-interpretation is the correct default | Unknown `$extensions` survive import → edit → export |
| Penpot blog / help | 2026-04-14 / 2026-09-25 | claims 2025.10 | Documents `$metadata`/`$themes` (Tokens Studio envelope) | Claim ≠ shape; same failure mode Varve must avoid in its own labels | Varve export must not carry a version field it does not understand |
| terrazzo.app/docs + releases | 2026-09-25; 2.0 shipped 2026-03-17 | 2025.10 | Strongest vendor claim; `$extends` merged 2025-12-15; font-weight 1–1000 fix open (#842, 2026-09-18) | Best candidate for an independent consumer check | Optional: validate Varve export with `tz check` when runnable |
| DTCG official schema probe (ajv) | 2026-09-25 | 2025.10 schema | **`$version` INVALID at token and top level**; valid inside `$extensions` | Directly falsifies Varve's previous UI export | `dtcgExport()` must validate clean against the official schema |

### Sources not accessible

- Authenticated Figma / Penpot / Tokens Studio runs were not performed; those
  rows are docs/forum/issue evidence only.
- Figma's exported file contents (format, presence of `description`) remain
  **unverified** — the help article names no export format.
- Terrazzo was not executed against a 2025.10 corpus in this session.

### Sync, merge, and conversion failure ledger (retrieved 2026-09-25)

Second research round, focused on how other tools *fail* at the
update/conflict path that this pass implements. These are observed symptoms
in their stated context, not proof of current product-wide behavior. Dates
are as shown on the retrieved page; where a page did not display a creation
date it is marked "not shown".

| Source | Date | Observed behavior / complaint | Relevance to Varve | Proposed acceptance test |
| --- | --- | --- | --- | --- |
| Tokens Studio plugin-docs, "Pull from provider" | current docs, retrieved 2026-09-25 | Pulling **replaces** every token already in the plugin and states they "can not be recovered" — no preview of incoming changes, no merge | Documented whole-library overwrite with an unrecoverable warning is the exact failure Varve's preview + three-way merge forbids | Spec: applying an update never removes local edits; only a decision per token removes a value |
| Tokens Studio #640 (GitHub integration, push overwrites) | date not shown | A second user's push silently overwrites changes already on the remote; maintainer thread asks for pull-and-merge with in-plugin conflict resolution but calls the in-plugin UI "cluttered" | Confirms both the demand for merge and the reason most tools punt it to branches — Varve keeps it in-product but scoped to per-token decisions | Scenario H: local and remote edit the same token; neither side wins without an explicit choice |
| Tokens Studio #2348 / #2375 (multiplayer) | 2023-10-31 (#2348) | Simultaneous editing in one file overwrites the other editor's tokens; "changes from B are gone"; reported as a "massive pain point" | Same data-loss class, on the document side. Varve's store is single-author but the merge path must never adopt last-writer-wins | Unit: `threeWayMerge` never emits last-writer-wins for differing edits |
| Tokens Studio #3287 (import creates new sets) | PRs #3295 / #3400 referenced | Renaming a collection/mode made import create a **new** set + theme instead of updating the existing one, forcing users to re-apply tokens | The identity-on-rename failure of scenario E. Varve renames through stable ids and path-matches identity-less remotes instead of creating duplicates | Spec: rename one side + edit the other combines (rename preserved, id preserved) |
| Tokens Studio #3144 (import diff noise) | 2024-09-18 | Imported changes produced a list containing **unchanged** tokens, and the import did not trigger the expected remote update | A diff that inflates its own change count is not trustworthy; Varve's summary separates added/updated/deleted/unchanged and reports a match as a no-op | Component: unchanged-only preview reports a no-op and disables Apply |
| Style Dictionary #1398 (dimension corruption) | 2024-11-25 | A spec-conformant `dimension` object value emitted **two** CSS variables (`-value: 1`, `-unit: 0px`) instead of one; users had to drop to a non-spec string to get correct output | Composite-value conversion is where "DTCG support" silently breaks. Varve keeps composites intact and reports conversion loss instead of splitting a value | Round trip: a `dimension` token exports as `{value, unit}`, never as two tokens |
| Style Dictionary #1563 (reference resolution) | PR #1577, released 5.1.1 | References to tokens whose name started with `value` failed to resolve — the implementation stripped `.value` from the reference string | String surgery on reference paths instead of parsing them. Varve resolves curly aliases and JSON Pointer refs by parsed segments with `~0`/`~1` escapes | Unit: pointer escaping + a token literally named `value…` still resolves |
| Style Dictionary #1590 (2025.10 alignment) | opened 2025-11-04, live 2026-09-18 | Gradient, duration, `$extends`, JSON Pointer `$ref`, and resolvers still unsupported; `styledictionary.com/info/dtcg` states 2025.10 "does not have full support yet" | Reinforces that a "DTCG" label is not 2025.10 coverage. Varve's capability report stays per-type, never one boolean | Fixture with `$extends` + `$ref` parses, resolves, and round-trips |
| Style Dictionary #1398 discussion thread (unversioned spec drift) | 2024-11-25 | Adopters report building against a silently-changed, unversioned spec: "many token types won't build" while docs still claimed first-class DTCG support | This is the labeling failure the task forbids: a version claim without a pinned spec version. Varve pins `2025.10` in `spec.ts` and refuses draft labels | Doc audit: no current-state text calls the Format module a draft snapshot |

### Varve behavior vs. the observed failures

| Observed failure elsewhere | Varve's counter-measure | Status |
| --- | --- | --- |
| Pull replaces the whole library, unrecoverable | Preview-first apply; only reviewed tokens change; one undoable transaction | implemented (`78c28571b` and prior) |
| Push overwrites the other side | base/local/remote three-way merge, per-token conflict decision | implemented (`78c28571b`) |
| Rename re-imported as a new duplicate | stable ids preserved across rename; path fallback for identity-less files | implemented |
| Diff lists unchanged tokens as changed | unchanged counted separately; a match reports a no-op with Apply disabled | implemented |
| Composite value split during conversion | composites kept intact; unsupported conversion reported, never performed silently | implemented for the documented types; per-target conversion loss reported |
| Spec claimed without a pinned version | `DtcgSpecificationVersion = '2025.10'` and Final-Community-Group-Report wording everywhere | implemented |

## 2. Varve coverage matrix (baseline, 2026-09-25)

Cells: **V** verified · **P** partial · **X** unsupported · **B** broken ·
**U** unverified. "Retained without interpretation" is not rendering support.

| Module / workflow | parse | validate | retain | resolve | edit | bind | render | serialize | external interop |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Format: tokens, `$type` inheritance, names, `$root` | V | V | V | V | X | P | U | V | U |
| Format: `$extends` groups | V | V | P | V | X | X | U | P | U |
| Format: curly `{path}` aliases | V | V | V | V | P | P | U | V | U |
| Format: JSON Pointer `$ref` | V | V | V | V | X | X | U | V | U |
| Color module (14 spaces, `none`, `hex` fallback) | V | P (range errors over-strict; hex-string form silent) | V | V | X | P | P | V | U |
| Composites (border/shadow/gradient/transition/typography/strokeStyle) | V | V | V | P | X | P | P | V | U |
| `$description` / `$deprecated` / `$extensions` retention | V | V | V | – | X | – | U | P (canonical path) | U |
| Resolver module (sets/modifiers/`resolutionOrder`) | V (engine) | V | U | V (engine) | X | X | U | U | **B — never routed from the UI** |
| Document ↔ token store (`tokenSync`) | – | – | V | – | P | P | U | V (doc round-trip) | – |
| Import workflow (first use) | P | P | P | – | – | – | – | – | **B — no source/store initialization path** |
| Import workflow (existing source) | P | P | P | – | – | – | – | – | P (first-source selection only) |
| Preview identity / freshness / cancel | – | – | – | – | – | – | – | – | **B — session-global cache keyed by file name** |
| Export document tokens to DTCG | – | – | – | – | – | – | – | **X — no app path** | **X** |
| Varve UI-token DTCG export (`@varve/ui`) | – | – | – | – | – | – | V (tokens.css) | **B — `$version`, timestamp, unnamespaced extensions** | B |
| Three-way merge / conflict review | V | V | V | V | U | – | – | U | U |
| File watching / atomic writes | U (engine + reducer implemented; **no platform wiring**) | | | | | | | | |

Rows marked **B** are the ranked defect list for this pass (see §3).

## 3. Ranked defects (baseline severity)

| Rank | Defect | Class | Evidence |
| --- | --- | --- | --- |
| 1 | First import into a fresh document is unreachable: nothing in application code ever creates `VariableStore.tokenSync` or a token source | workflow blockage | `addSource` / `createEmptyTokenSynchronization` have zero non-test callers; `buildImportPreview` returns `added: 0` + "No token source connected yet" |
| 2 | Apply announces success even when the transaction was a no-op | data-integrity / trust | `TokenSyncPanel.tsx` returns `doc` unchanged when `tokenSync` is missing, then `announce("Imported…")` |
| 3 | `.resolver.json` is accepted by the picker but parsed by `parseFormatDocument` | workflow blockage / standards | `parseResolverDocument` has no application caller |
| 4 | Apply silently uses the first source in the map | correctness | `Object.keys(sync.store.sources)[0]` |
| 5 | Preview cache is module-global and keyed by `file.name` | data-loss / identity | two same-named files, documents, or windows collide; cancel never releases bytes |
| 6 | `dtcgExport()` emits `$version` (out-of-spec), a `Date` timestamp (non-deterministic), and non-namespaced `$extensions` keys | standards correctness | official 2025.10 schema rejects `$version`; DTCG requires vendor-namespaced extension keys |
| 7 | No export path from document tokens to a DTCG file | workflow blockage | `renderCanonical` / `patchSerialize` have no application caller |
| 8 | Color codec reports out-of-range components as **errors** and normalizes bare-hex `$value` strings without a diagnostic | standards correctness / silent conversion | Color module has no `MUST` to reject ranges; hex-string form is not the 2025.10 structured form |
| 9 | No conflict-resolution UI; counters only | **repaired 2026-09-25** | `TokenSyncPanel` renders an explicit conflict review (Keep Varve / Use source per token); Apply stays disabled until every conflict is decided |
| 10 | Watcher/atomic-write engine unwired to any platform | workflow (deferred) | `sources.ts` / `watcherEvents.ts` consumed only by their own tests |

## 4. Risk-based scenario selection

Full Cartesian coverage is deliberately avoided. Selected lanes:

- **A fresh-project onboarding** — automated (E2E): new document → import →
  bind → edit → undo/redo → reopen.
- **D metadata round trip** — automated (unit): descriptions, deprecation,
  nested groups, `$root`, aliases, `$ref`, unknown extensions survive
  import → edit → export.
- **F preview races** — automated (unit/component): two same-named files,
  cancel, stale preview rejection.
- **G resolver project** — automated (unit): internal sources resolve; missing
  inputs and cycles produce actionable diagnostics. External `$ref` loading is
  reported as unsupported rather than silently dropped.
- **I adversarial/recovery** — automated (unit, existing): malformed JSON,
  duplicate keys, size/depth bounds, watcher bursts.
- **B/C/E/H/J** — covered where the existing suites already pin them; new
  permutations deferred and reported as untested rather than claimed.

## 5. Repairs delivered (2026-09-25)

The §2 matrix and §3 defect list record the baseline this pass started
from. The rows below were repaired; everything else in §2/§3 stands
unchanged, and cells not listed here are still at their baseline status.

| # | Defect | Status | Commit | Evidence |
| --- | --- | --- | --- | --- |
| 1 | First import into a fresh document unreachable | **fixed** | `527f62faa`, `3f6e375cd` | `ensureImportSource` creates store + source; empty state says so; E2E `token-sync-import.spec.ts` "fresh document can import" |
| 2 | Apply announced success on a no-op | **fixed** | `3f6e375cd` | Apply plans outside `updateDoc`, announces real counts, reports a no-op as a no-op; component test "reports a no-op instead of announcing success" |
| 3 | `.resolver.json` parsed by `parseFormatDocument` | **fixed** | `3f6e375cd` | Content-first routing → `parseResolverDocument`, per-modifier context Select, lazy single-permutation resolve; 5 resolver tests |
| 4 | Apply silently used the first source | **fixed** | `3f6e375cd` | Explicit destination `Select` (existing sources + "New source for …"); `sourceOptions`/`defaultSourceChoice` tests |
| 5 | Preview cache module-global, keyed by `file.name` | **fixed** | `3f6e375cd` | The preview *is* the state: parsed document + FNV-1a content hash held in component state; cancel clears it; same-name/different-revision test |
| 6 | `dtcgExport()` `$version`, timestamp, unnamespaced extensions | **fixed** | `bafeddc7c` | Cross-package test: strict parse with 0 diagnostics, only defined `$`-properties, byte-identical repeated calls |
| 7 | No export path for document tokens | **fixed** | `3f6e375cd`, `06d9c4f86` | `exportTokensToDtcg` + Export button; E2E download assertion; scenario-D round-trip test |
| 8 | Color range/alpha over-strict; hex normalization silent | **fixed** | `a40a424c6` | Range and alpha → warnings that retain the authored value; hex-string → `codec.color.hex-string-form` warning; codecs never transform |
| 9 | No conflict-resolution UI | **implemented** | `78c28571b` | `TokenSyncPanel` conflict review (Keep Varve / Use source per token, semantic `<fieldset>` groups); `applyConflictResolutions` keeps the plan invalid until every conflict is decided; component test "requires an explicit decision for a concurrent edit" |
| 10 | Watcher/atomic-write engine unwired to any platform | **deferred** | – | `sources.ts`/`watcherEvents.ts` still consumed only by their own tests |

### Additional defects found while repairing

| Defect | Status | Commit | Evidence |
| --- | --- | --- | --- |
| Codec layer never called from the parser — any `$value` passed | **fixed** | `a40a424c6` | `validateTokenValue` wired into `buildToken`; parse-level value tests |
| Null-prototype parser values reaching the document store → `Cannot convert object to primitive value` (whole-editor error boundary after an import) | **fixed** | `a40a424c6`, `20e511860` | `toPlainJson` at the parser boundary + `formatVariableValue` in `VariablePanel`; caught by E2E, not by unit tests |
| Backing-variable writes mutated the store the undo stack still references → undo could not remove imported variables | **fixed** | `527f62faa` | `writableVariableStore` clone; "does not mutate the document variable store while planning" |
| Token-level `$ref` imported with `value: undefined` (reference lost) | **fixed** | `527f62faa`, `3f6e375cd` | Retained as `{ $ref }`, replayed as token-level `$ref` on export |
| Group `$description`/`$deprecated`/`$extensions` dropped at import | **fixed** | `527f62faa`, `3f6e375cd` | `store.groupMeta` + replay; round-trip test asserts them after re-parse |
| `$type` written onto pure references could contradict the target | **fixed** | `3f6e375cd` | Export omits `$type` when the value is a pure reference |

### External-update pass (2026-09-25, later session)

Re-importing a connected source was an additive-only path: every colliding
token path was skipped, so an edited upstream token could never reach the
document. Repairing that required fixing the merge engine itself.

| Defect | Status | Commit | Evidence |
| --- | --- | --- | --- |
| Three-way merge could not express deletion — a one-sided deletion with the other side unchanged **resurrected the stale value** (`accept-local` with `result: baseToken`, and the inverse), so "the source deleted this token" silently re-applied it | **fixed** | `78c28571b` | `deleted`/`localDeleted`/`remoteDeleted` on `TokenMerge`, `plan.deletedCount`; three new merge tests |
| An identity-less remote (the common DTCG file: no `org.varve.*` id) was treated as a **deletion** against the id-bearing local store, because identity matching only looked up by id in the remote index | **fixed** | `78c28571b` | Pass 1 falls back to canonical-path matching; update-plan tests use identity-less documents |
| Base snapshots stored only hashes (`tokenHashes`), so base/local/remote could not be separated: a local edit and an external edit were indistinguishable and every re-import would have been a source-wins overwrite | **fixed** | `78c28571b` | `TokenBaseSnapshot.tokenBases` captured on import and after every clean apply; `captureBaseSnapshot` |
| No update path at all — `applyImportToSync` skipped existing paths, so external updates, deletions and conflicts never surfaced anywhere in the UI | **fixed** | `78c28571b` | `previewDocumentSync`/`applyDocumentSync`; `planSourceUpdate`; E2E `token-sync-update.spec.ts` |

Coverage-matrix deltas from this pass (cells that were **X**/**P** at the
baseline): "Import workflow (existing source)" update column moves to **V**
for parse/resolve/serialize via the browser spec; three-way merge /
conflict review moves from **U** to **V** (unit) with the UI surface
covered by component tests. Deleting a token on one side moves from **X**
to **V**. Still open at the same status: vendor adapters, watcher
platform wiring, and Git-backed sources.

### Verification record

```text
Changed scope: packages/tokens, packages/scene (src/tokens), packages/ui,
packages/editor (VariablePanel, tokenSync, components/TokenSync, variableValueFormat),
docs/tokens, docs/README.md, tests/e2e/inspector
Unit (targeted): 293 passed — packages/tokens + scene/src/tokens + ui/src/tokens +
  editor/src/tokenSync + editor/components/TokenSync
Typecheck: @varve/tokens, @varve/scene, @varve/ui, @varve/editor — clean
Biome (touched): clean
E2E: npx playwright test tests/e2e/inspector/token-sync-import.spec.ts
  --project=chromium --workers=1 (heavy-lease) — 4/4 passed
Screenshots inspected: docs/screenshots/token-sync-import/import-preview.png,
  docs/screenshots/token-sync-import/import-applied.png
Commits: 6735e4b3a, a40a424c6, bafeddc7c, 527f62faa, 20e511860,
  3f6e375cd, 06d9c4f86, 252034da7, 19eb39ffa
Full suite run: no — see docs/quality/validation-strategy.md
```

### Affected plan executed

`pnpm verify:plan --since c77948d31` then
`pnpm verify:affected --since c77948d31` (the base is the session's starting
HEAD, so the plan covers this pass rather than only the still-uncommitted
working tree):

| Tier | Result |
| --- | --- |
| 0 format/lint/emoji/docs/spacing/sizing/tokens | **all pass** |
| 1 `typecheck:e2e` + 10 unit-file lanes (TokenSync, import/export workflow, interop, variableValueFormat, syncApply, codecs, parse, json, dtcg) | **all pass** |
| 1 e2e lanes `asset-similarity`, `keyboard-nav`, `token-sync-import`, `switcher-review` | **all pass** (`token-sync-import` 105.0s) |
| 2 `@varve/website` unit + typecheck | **pass** |
| 2 `@varve/editor` unit | 7890/7891 pass; the single failure is `backgroundRemoval/maskRenderCache.test.ts` (`addRasterMaskRenderSources is not a function`) inside another session's **uncommitted** edit of that file — unrelated, recorded as a foreign in-flight failure |
| 2 `@varve/scene` `@varve/tokens` `@varve/ui` unit (260 tests) + typecheck (4 packages incl. editor) | **pass** (run directly because the plan fail-fasts at the foreign editor failure) |
| 3 11 package typechecks + 135 test files (1450 tests) | **pass** |
| 4 `website-unit`, `e2e:visual` (28/28) | **pass** |
| 4 `website-e2e` | 579 passed, 1 flake (`contact.spec.ts` on `ghpages` only; the same test passed on `custom-domain` and passes 8/8 on a leased rerun) |

Two failure classes were load- or contention-induced and were re-verified in
isolation: an earlier editor run failed 8 tests (PromptDialog, SpotlightOverlay,
workloadCorpus, ShortcutPalette, FloatingToolbar, FontBrowser) that pass 98/98
when re-run alone, and the website contact flake above. A first
`verify:affected` attempt was voided because wrapping it in `heavy-lease`
deadlocked against the planner's own internal E2E lease; the tool manages its
lease itself and must not be nested.
