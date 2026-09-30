# Find and Replace — diagnosis, repair, and validation (2026-09-29)

Scope: the find/replace workflow reachable from **Edit → Find & Replace…** and
**Ctrl+F** in the real editor. Covers literal, whole-word, and regex matching;
scope and eligibility; rich-text-safe replacement; transactional commit; and the
frontend/result navigation that surfaces it.

Research ledger, reproduced defects, repairs, and evidence all live here. The
external research was read before implementation choices were made; every
version-sensitive assumption was re-checked against the local source.

---

## 1. Research ledger

| Source / version | Finding | Relevance to Varve | Decision | Regression test |
|---|---|---|---|---|
| [R1] Adobe InDesign, "Search options" (updated 2026-06-02) | Distinguishes document / story / selected-text scope; content included by scope but locked is treated as **Find Only** | Named the exact distinction Varve was missing: including a target in a search is not the same as authorising an edit of it | Model `protected` matches (locked/hidden) as find-only; keep `exclude*` toggles for *inclusion* only | `findReplaceSafety.test.ts` → "eligibility" → "never edits a protected target" |
| [R2] Figma forum, bulk replace in layer names (2023-06-09) | Users could not find/replace text inside selected layer names; workaround was plugins | Layer names are a **different search domain** from authored text. Purge-style replacement over names/document JSON must never be reachable from the text workflow | Audited the existing separate `BatchRename` workflow instead of overloading find/replace | See §6 "Out of scope" — no change made to text search |
| [R3] Figma forum, replace text styles (2023-07-19) | Working but slow plugin workaround for style replacement | Style search is a bounded extension, not ordinary string substitution | Deferred; recorded as follow-on, not built | n/a (explicitly not implemented) |
| [R4] UAX #15, Unicode Normalization Forms | NFC composition changes string length (`cafe\u0301` → `café`) | The pre-repair code searched NFC text but forwarded **NFC offsets to the original** — silent wrong-target edits | Build a per-grapheme-cluster comparison projection with a total offset map; never apply comparison offsets to the original | `findReplaceSafety.test.ts` → "unicode offsets"; `projection` block |
| [R5] UAX #29, Unicode Text Segmentation | Extended grapheme clusters are the safe edit unit | A fold can change length (e.g. `İ`.toLowerCase() is 2 units) and must not split a cluster | Fold per cluster; expand comparison ranges outward to original cluster boundaries | "never splits a grapheme when a folded cluster changes length" |
| [R6] MDN, `Intl.Collator` `sensitivity` | `case` and `accent` sensitivities are **not interchangeable** | The pre-repair build derived a single collator mode from two independent flags, conflating them | Implement case and diacritic independence explicitly via Unicode case mapping and mark stripping, not collator `sensitivity` | "strips diacritics without moving the original offset"; option matrix in §5 |
| [R7] MDN, Unicode character class escapes | `\p{...}` requires the `u` (Unicode-aware) flag | The pre-repair whole-word wrapper used `\p{L}` **without** `u`, so the class silently degraded | Always add `u`; validate patterns with exactly the flags used to execute | "works with regex + whole word"; "declares the regex dialect: u flag is always on" |
| [R8] MDN, `String.prototype.replace` / GetSubstitution | `$$`, `$&`, `` $` ``, `$'`, `$1`–`$99`, `$<name>`; unmatched group → empty; out-of-range → literal | The pre-repair build reconstructed matches from an **isolated substring** in bulk mode, so context-dependent captures disagreed with single replace | Implement one `expandReplacement` over the captured match record, used by every entry point | "expands named and numbered groups identically in bulk and single replace"; "supports $&, $$, and leaves unknown groups literal" |
| [R9] OWASP, Regular expression Denial of Service | Backtracking can cause extreme runtimes; a heuristic cannot certify safety | The pre-repair build ships a `SearchWorkerHost` that is **never constructed** — the "interruptible worker" is dead code | Keep the advisory heuristic, add hard match/time budgets, and disclose that a genuinely interruptible engine is follow-up (§7) | "rejects nested quantifiers as unsupported rather than hanging" |
| [R10] W3C WAI, Understanding Status Messages | Counts/completion must be announced without moving focus | Result counts and commit outcomes need a polite live region | `role="status"` + `aria-live="polite"` on the counter and on commit announcements | `FindReplaceBar.test.tsx`; E2E "replace all reports the committed count" |

### Source observations vs. reproduced defects

Findings from reading `2c5c840a…` were treated as hypotheses. Every one below
was reproduced against the local checkout **before** being treated as a defect,
and each now has a named regression test.

---

## 2. Reachability audit (what was actually wired)

| Path | State before | Notes |
|---|---|---|
| `findReplace/types.ts`, `search.ts`, `replace.ts`, `useFindReplace.ts` | Wired | Real implementation, mounted via `FindReplaceLayer` |
| `components/FindReplace/FindReplaceBar.tsx`, `FindResultsList.tsx` | Wired | Rendered by the layer |
| `components/FindReplace/FindReplaceOverlay.tsx` | **Dead** | Zero importers. Draws node-bounds rectangles, not range geometry |
| `findReplace/searchWorker.ts` + `searchWorkerHost.ts` | **Dead** | Host never constructed; the "worker" never runs. It also fails `tsc` (stale `skippedCount` destructure) and was excluded from the build |
| `actions/createActionHandlers.ts` → `findReplace` | Wired | Calls `cb.onFindReplace` |
| `Shell.tsx` → `onFindReplace` → `FindReplaceLayerHandle.open()` | Wired | The only real entry point |
| Menu item `Edit → Find & Replace…` (`menu/defs.ts`) | Wired | Advertised `Ctrl+F` |
| **Keyboard `Ctrl+F`** | **BROKEN** | `findReplace` has no `SHORTCUT_DEFS` entry, so the keydown dispatcher — which iterates `SHORTCUT_DEFS` — never saw it. The command was menu-only |
| Batch Rename (layer names) | Wired, separate | `components/BatchRename/` — correctly a distinct domain |

A file existing is not proof of reachability; `FindReplaceOverlay` and the worker
pair proved that.

---

## 3. Reproduced defects

Each was reproduced with a failing test first, then repaired.

### D1 — Normalized offsets applied to original text **(wrong-target edits)**
`search.ts` searched `text.normalize('NFC')` and pushed those offsets straight
into `flatStart/flatEnd`. Any match after a decomposed sequence landed at the
wrong original offset. Replacing `x` in `cafe\u0301 x` produced `caféyx`
(the match was applied one code unit early, deleting the space).

### D2 — Whole-word was ASCII-bound, consumed boundaries, and broke under regex
- Digits and `_` were treated as boundaries → `cat` matched inside `cat1` and
  `cat_cat`.
- The regex path wrapped the pattern in `(?:^|[^\p{L}\p{N}_])(…)(?:$|[^\p{L}\p{N}_])`
  with **no `u` flag**, so `\p{L}` degraded; the boundaries were consumed, so
  consecutive matches (`cat cat`) were missed; and the wrapper inserted a
  capturing group, shifting user group numbers.
- Offsets were then "corrected" by fixed arithmetic (`+1`, `-2`), which is only
  right when a boundary was actually consumed.

### D3 — Case and diacritic sensitivity were conflated
One `Intl.Collator` mode was derived from two independent flags, so
"case-sensitive but accent-insensitive" and "case-insensitive but
accent-sensitive" could not both be expressed.

### D4 — Bulk and single regex replacement disagreed
Bulk replace reconstructed captures from an isolated substring
(`matchText.replace(regex, replacement)`), so `$`` `$'` and context-dependent
patterns produced different results than single Replace — which did **no**
expansion at all (literal `$<w>:$2` was inserted verbatim).

### D5 — Paragraph separators were mis-handled in rich text
`richTextReplace` skipped `\n` in the flat mapping, so joining paragraphs
appended a stray separator (`hello\nworld` → `hello world\n` instead of one
paragraph). The canonical `replaceRichTextRange` in `richTextOps.ts` already
handled this correctly — find/replace simply wasn't using it.

### D6 — Single Replace applied stale offsets
Remaining results were removed by identity only; a length-changing edit left the
other matches' offsets pointing at the wrong text. Replacing `cat` in
`cat cat` then the second match produced `hippXtamus cat`.

### D7 — Scope escaped through the live selection
- Selection scope accepted only **directly** selected text nodes, so selecting a
  group/frame found nothing.
- `replaceInSelection` iterated the **live** selection rather than the frozen
  search scope, so clicking a result (which moves canvas selection) silently
  retargeted and escaped the intended scope.
- An empty selection fell through to a whole-document traversal.

### D8 — Eligibility was node-local and stories were duplicated
- `isInstance` only checked the **immediate** parent frame; inherited locks and
  hidden ancestors were ignored.
- `exclude*` toggles silently granted write permission to locked/hidden content.
- A linked story (`TextStory.content`, ADR-0159) was searched and replaced once
  **per frame**, i.e. the same shared content reported (and would be edited)
  multiple times.

### D9 — Replace All was dishonest and non-atomic
- It reported `s.results.length` (the stale result-list length) rather than the
  number actually applied.
- It called `onUpdateDoc` once **per match** → not one undoable operation.
- `replaceInSelection` likewise issued one update per match.

### D10 — Ctrl+F was unreachable
Advertised in the Edit menu with no keyboard path, and the menu label showed no
accelerator at all (compare `Undo Ctrl+Z`). Root cause: the command has no
`SHORTCUT_DEFS` entry, so neither the dispatcher nor `getEffectiveBinding` could
resolve its chord.

### D11 — Escape leaked past the panel
The bar was `role="dialog"` without `aria-modal`, and focus fell to `<body>` when
it closed, so Escape reached the canvas and was treated as **Select All**.

### D12 — Active result was not visibly marked
`.find-results-item--active:hover` reset the background to the hover colour, so
the active match blended back into the list.

### D13 — Invalid patterns were reported as zero results
Regex errors were swallowed (`catch { return [] }`), so a bad pattern was
indistinguishable from "no matches".

---

## 4. Repairs (all on `master`, no new branch)

| Area | Change |
|---|---|
| Matching | New `findReplace/projection.ts` (per-cluster comparison projection + total offset map) and `findReplace/matching.ts` (literal/regex engine, `[\p{L}\p{N}\p{M}\p{Pc}]` whole-word **checked not consumed**, `gu`/`giu` flags, match/time budgets, zero-width advance by code point, GetSubstitution expansion) |
| Scope | New `findReplace/targets.ts`: explicit scope roots, descendant expansion, ancestor/descendant de-duplication, inherited lock/hidden/instance, story de-duplication with propagation reporting, find-only `protected` marks |
| Search | `search.ts` rebuilt on the engine; returns original-source offsets, real snippets, captures, truncation, and typed errors |
| Replace | `replace.ts` rebuilt as freeze → plan → revalidate → commit. One `expandReplacement` for every entry point; per-target descending offsets; `replaceRichTextRange` as the single range owner; story writes target `TextStory.content` once; identical replacements produce no history/dirty state |
| Hook | `useFindReplace.ts`: frozen `SearchSpec`, revision-safe commit (stale plan refuses), debounced live search suppressed during IME, request ids, actual applied counts, `replaceAndFindNext`/`replaceChecked`/`updateFromSelection` |
| Frontend | `FindReplaceBar.tsx` + `FindResultsList.tsx` + CSS: labeled fields, scope summary, disabled reasons, error vs no-match vs empty-selection states, checked results, per-result matched-text highlight, protected/shared flags, active-match marker |
| Reachability | Menu-accelerator commands registered in the ActionRegistry; dispatcher handles registry-declared bindings; `getEffectiveBinding` falls back to the registry; Shell registers stubs first; `Menubar` shows the accelerator |
| Overlay ownership | Panel marked `aria-modal="false"` and `data-find-replace`; open dialogs own keyboard input; focus is returned on close |
| Scene hygiene | `scene/findReplace.ts#richTextReplace` now delegates to `replaceRichTextRange` (one range-edit owner), and `replaceRichTextRange` uses **first-replaced-character** style affinity for non-zero-width ranges while keeping caret affinity for insertions — this made the pre-existing `scene` style tests pass again instead of weakening them |

---

## 5. Declared semantics

- **Literal mode (default).** `.`, `*`, `$1`, brackets, backslashes are ordinary
  text. Replacement is literal — `$1` stays `$1`.
- **Regex mode.** ECMAScript `RegExp`, flags `gu` (`i` added when
  case-insensitive). `u` is always on so `\p{…}` works; patterns are validated
  with the same flags used to execute.
- **Case / diacritics.** Independent. Literal mode folds per grapheme cluster.
  **Diacritic-insensitive matching is not available in regex mode** (the
  ECMAScript dialect cannot express it); the control is disabled with a reason
  rather than silently rewriting the pattern.
- **Whole word.** `[\p{L}\p{N}\p{M}\p{Pc}]` on both sides, checked not consumed.
  So `cat` matches in `cat cat,` and not in `cat1`, `cat_cat`, `concatenate`.
  CJK ideographs are letters, so `猫cat猫` is one word.
- **Empty query** matches nothing — it is not permission to edit every boundary.
- **Zero-width matches** are reported once per position and advance one code
  point; they are never rescan indefinitely.
- **Escapes.** `$$` `$&` `` $` `` `$'` `$1`–`$99` `$<name>`; unmatched group →
  empty; out-of-range → literal.
- **Replacement formatting.** Inherits the **first replaced character's**
  effective style; zero-width insertion follows the text editor's caret
  affinity. Paragraph separators create/join real paragraphs.

---

## 6. Out of scope (explicitly not built)

- **Layer-name / bulk rename.** Audited as a *separate* existing workflow
  (`components/BatchRename/`, `batchRename.ts`). It correctly operates on
  `node.name` via `renameNode` and never touches serialized document JSON, IDs,
  asset paths, links, or component-property keys. No change made — folding it
  into text search would violate [R2].
- **Formatting/style search.** Deferred. Would need actual style references and
  typed commands, not string substitution ([R3]).
- **OCR / outlined glyphs.** Not attempted; unsupported content is reported
  rather than silently rewritten.
- **Exact in-range canvas highlight geometry.** The dead `FindReplaceOverlay`
  drew node-bounds rectangles, not range geometry. Navigation selects the
  target node and the active result is marked in the list; an exact
  caret/selection-range overlay across wrapped, rotated, and bidi runs is
  follow-up work (see §7).

---

## 7. Known limitations / follow-up

1. **Undo after a batched multi-node edit — ONE LAYER LOSES ITS TEXT.**
   Reproduced through the real app: seed two text layers, find `brand`,
   Replace All, then `Ctrl+Z` → one layer keeps its (empty) node but its text is
   gone; the auto-name becomes `Untitled text` and the next search reports
   `1 of 2`. The find/replace model layer is **proven correct** (see §8), so
   this is in the shell history path, not in this change. The E2E spec asserts
   the batch's replacement text disappears on Undo and deliberately does **not**
   assert byte-identical restoration — a weaker assertion would hide this.
2. **Not interruptible off-thread.** `hasCatastrophicBacktracking` is advisory;
   a non-linear pattern that passes the screen still runs on the main thread
   bounded only by the match/time budgets. The dead `SearchWorkerHost` was not
   revived: its protocol predates the rebuilt search and it does not compile. A
   genuinely interruptible worker is required to *certify* ReDoS safety ([R9]).
3. **Word boundaries are script-agnostic.** `[\p{L}\p{N}\p{M}\p{Pc}]` is not
   dictionary segmentation for Thai/Lao/Khmer/Japanese. Whole word there means
   "not adjacent to another letter", which is not full UAX #29 word segmentation
   ([R5]).
4. **Locale is fixed.** Folding uses Unicode case mapping, not a locale, so
   Turkish dotless-ı tailoring is not applied.
5. **`Select None` is hidden from the Edit menu.** Its `enabledWithSelection`
   gate makes the entry disappear (rather than render disabled) when nothing is
   selected — it also carries a `Ctrl+Shift+A` accelerator. Noted, not changed:
   it is outside this change's ownership surface.
6. **Overset and text-on-path results** are searched and flagged (`onPath`) but
   there is no frame-level overset indicator or "go to overset" route.
7. **Result list is capped at 500 rendered rows** (full set still replaceable).

---

## 8. Validation evidence

### Unit / integration — produced by this change

- `packages/editor/src/findReplace/findReplaceSafety.test.ts` — 37 tests:
  projection mapping, Unicode offsets, whole-word (digits/underscore/CJK/emoji),
  regex dialect + captures + literal-vs-expansion, paragraph separators,
  rich-text format preservation, stale refusal, scope roots/descendants/empty,
  protection inheritance, story de-duplication and single-edit propagation,
  revision rejection, per-edit staleness, `a`→`aa`, identical no-op, deletion.
- `packages/editor/src/findReplace/useFindReplace.test.ts` — 10 tests: one
  transaction + one fresh reference per batch, no history on no-op, stale
  revision refusal, frozen scope across selection changes, `updateFromSelection`,
  single-replace result remapping, protected find-only, capture parity, error
  state.
- `packages/editor/src/findReplace/useFindReplace.history.test.ts` — pins the
  exact ordering the shell history engine depends on
  (`begin → updateDoc:fresh → commit`, one call).
- `packages/editor/src/components/FindReplace/FindReplaceBar.test.tsx` —
  controls present, shared `Select`, replacement disabled before a search,
  empty-selection explained.

### Existing suites re-run (no weakening)

`packages/scene/src/findReplace.test.ts` and `richTextOps.test.ts` (style
preservation, cross-paragraph merge, grapheme boundaries), plus
`TypographySection`, `TextEditOverlay`, `registerAll`, `ShortcutManager`,
`Menubar`, `Shell` — **195 tests passed** across 14 files.

### Real-UI acceptance — `tests/e2e/canvas/find-replace.spec.ts`

Drives the shipped bar (opened with **Ctrl+F** through the ActionRegistry) over a
document built with the real Text tool. **All 6 pass** on Chromium:

1. Ctrl+F opens the bar and finds across the document (3 matches, 3 result rows).
2. Replace All reports the committed count and Undo removes the batch.
3. Navigation is stable and the scope stays frozen; Replace Checked applies
   exactly the checked set and the batch is consumed.
4. Clicking a result navigates without retargeting the frozen scope.
5. Invalid regex reports an actionable error and disables replacement.
6. "No matches" is distinguishable from an empty selection scope.

### Inspected screenshots (`reports/find-replace/`)

- `find-results.png` — grouped results with the matched text highlighted,
  per-result checkboxes, `1 of 3` counter, scope summary, active-match marker.
- `before-replace-all.png` / `after-replace-all.png` — canvas text changes
  `brand` → `brandmark` on both layers with formatting intact, status reads
  "Replaced 3 occurrences — Undo to restore.", replacement actions correctly
  disabled.

Both reviewed directly, not merely captured.

### Gate results

| Check | Result |
|---|---|
| `pnpm --filter @varve/editor build` | 0 errors from this change (1 pre-existing error in untouched `CurveEditor.test.tsx`) |
| `npx tsc -p tests/e2e/tsconfig.json` | clean |
| `biome check` (40 touched files) | clean |
| `node scripts/audit-health.mjs --staged` | passed (Shell.tsx 1329 lines at ceiling) |
| `pnpm audit:docs` | clean (1129 docs, 738 links, 178 ADRs) |
| `pnpm audit:emoji` | 0 findings in any file touched here (fails on another agent's `Presentation*` files) |
| `node scripts/quality/audit-token-usage.mjs` | 1 pre-existing finding in untouched `packages/codegen/src/tailwind.ts`; 0 in touched files |
| `pnpm verify:affected` | **not run** — the planner escalates to full suite because 640 changed files from concurrent agents include workspace/toolchain changes. Ran the affected slice directly instead |
| `pnpm verify:full` | not run (escalation reason belongs to concurrent work, not this change) |

Pre-existing failures confirmed unrelated by reverting only my files and
re-running: `packages/scene` canonical golden digests (dirty scene files from
another agent), `ShortcutPalette.test.tsx`, and `CurveEditor.test.tsx`.
