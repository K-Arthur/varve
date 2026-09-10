# Clipboard reliability audit — 2026-09-06

## Scope and baseline

This audit traces the production Copy, Cut, Paste, guide clipboard, property
clipboard, text-editing, import, and native image fallback paths. The working
tree was already on `master` with unrelated website, inspector, enhancement,
and visual-snapshot changes; those changes are intentionally outside this
audit's commits.

Baseline commit: `b04787f71` (`test(inspector): cover adjustment panel themes`).

The focused baseline command passed:

```text
pnpm exec vitest run packages/editor/src/clipboard.test.ts \
  packages/editor/src/context.import.test.tsx \
  packages/editor/src/propertyClipboard.test.ts --maxWorkers=1
24 tests passed
```

Passing unit tests cover basic payload writing, image/SVG extraction, raster
mask and image asset payloads, and import routing. They do not prove an OS
clipboard write, a real text-editing target, or the lifetime of a browser
`ClipboardEvent`.

## Production lifecycle

| Stage | Current owner | Finding |
| --- | --- | --- |
| Keyboard command | `useShortcuts` → action registry | Copy/Cut are routed through the action registry; Paste has a delayed fallback for WebKitGTK. Text controls are deliberately left to native editing. |
| Browser paste event | `Shell` window listener → `captureClipboardEvent` | The listener skips input/textarea targets, but stores the event object for later async consumption. |
| Object snapshot | `EditorProvider` `copySelected` / `cutSelected` | Selected roots are expanded with `gatherSubtreeNodes`; `DocumentCodec.collectNodeClosure` supplies image, raster-mask, and icon assets; root world transforms are recorded. |
| Clipboard write | `writeClipboard` | A custom Varve/legacy multi-format write is attempted, then a plain-text names/JSON fallback reports boolean success even though object paste cannot use it. |
| Clipboard read | `readClipboardUnifiedWithFallback` | Async API, captured DOM event, then Tauri image-only fallback. Event and async paths do not recognize the same Varve MIME set. |
| Import | `ImportService.importFiles` | SVG and raster imports share the normal import path and are inserted in one document transaction. |
| Object insertion | `insertImportedSubtree` + `mergeImportedResources` | IDs are remapped through `deepCloneSubtree`; world anchors are rebased into the current selected frame. The insertion target and captured placement center are resolved before async reads. |
| Specialized buffers | `propertyClipboard`, `guideClipboard`, effect-stack state | These are intentionally app-local and separate from the system object clipboard. Guide paste is currently checked before the system clipboard. |

## Confirmed risks

### P0 — Cut deletes before the clipboard write completes

`cutSelected` calls `writeToClipboard(...)` without awaiting its result and
immediately removes the selected roots. A rejected custom-format write can
fall through to a names-only write, and even a total failure cannot prevent
the document deletion. This violates the Cut contract and can lose authored
content.

### P0 — A captured event is retained across an async boundary

`Shell` stores the `ClipboardEvent` itself in module state. `paste()` later
reads from that retained event after an async `navigator.clipboard.read()`.
The data needed for the gesture must be snapshotted while the event is live;
the event object must not be the transport between callbacks. A one-shot
snapshot also prevents a later Paste from consuming an unrelated old event.

### P1 — Event and async MIME negotiation disagree

`readClipboardUnified` accepts current, legacy, and `web `-prefixed Varve MIME
types. `readFromClipboardEvent` asks only for
`application/vnd.strata+json`, so current-format object data delivered through
the reliable DOM route is ignored.

### P1 — File deduplication uses filename rather than item identity

Both image readers collapse items by generated/name keys. Two legitimate
clipboard files with the same filename can therefore become one imported
node. Separately, an image's SVG/text/PNG representations must resolve to one
logical item rather than becoming multiple pasted objects.

### P1 — Paste target is resolved after the read/import delay

The async paste handler reads `stateRef.current` at commit time and chooses
the current selection/document. A selection, page, workspace, or session can
change while the read or image import is pending, redirecting the paste to a
different target. The invocation context must be captured and revalidated at
commit.

### P1 — Copy feedback is unconditional

`copySelected` announces `Copied …` without observing the write outcome. The
names-only fallback is useful for text editors but is not an editable Varve
transfer and must be reported as degraded output; a failed write must not be
reported as a successful object copy.

### P1 — Clipboard closure omits an existing dependency class

`DocumentCodec.collectNodeClosure` already collects referenced mockup
templates, but `ClipboardData` and the paste resource merge do not carry them.
This can leave a pasted mockup referring to a missing template.

## Ownership decisions

- Native input, textarea, contenteditable, dialog, and IME targets retain
  browser ownership for Copy/Cut/Paste. The canvas object commands run only
  when the global shortcut layer owns the target.
- Guides and property/effect buffers remain app-local and do not overwrite the
  user's system object clipboard.
- `Duplicate` remains a document operation and does not use clipboard APIs.
- Ordinary Paste never silently falls back to an old app-local object copy when
  the system clipboard contains newer unsupported content.

## Repair milestones

1. Introduce validated one-shot event snapshots, MIME parity, item-aware
   representation resolution, and truthful write outcomes.
2. Make Cut await a complete/recoverable transfer and revalidate its source
   snapshot before one undoable deletion transaction.
3. Bind Paste to a captured document/session/selection context, carry the
   complete supported resource closure, and preserve one logical item per
   representation.
4. Add focused integration and Playwright coverage, update the clipboard and
   import architecture docs, and publish the verified behavior/limitations on
   the marketing website.

## Wayland follow-up repair

The first repair pass exposed a second WebKitGTK/Wayland-specific gap: the
browser API could return only the names-only `text/plain` representation, and
the non-editable canvas might never receive a DOM `paste` event. That made
both the delayed Ctrl+V shortcut fallback and the right-click Paste command
reach an image-only native fallback, which could not recover an in-app layer
fragment.

The Tauri platform now exposes bounded native MIME reads and writes. On
Wayland these use `wl-clipboard-rs` to publish and request the Varve and
legacy JSON representations before SVG, raster, and text fallbacks. The
editor ignores a text-only browser result while a native structured read is
still available, and both keyboard and context-menu commands share this
resolver. Focused unit coverage proves the read/write ordering; native
WebKitGTK smoke coverage confirms the desktop test harness runs under the
current Wayland session. Paste placement is now explicit for every
destination: one visible/unlocked selected frame/group is centered in its
placed-world bounds; ambiguous or ineligible selection falls back to the
active page/design-canvas root and the captured visible-canvas center.
Same-document rich fragments preserve their world anchors when there is no
explicit container; selecting a frame/group applies one shared translation
that centers the fragment while retaining relative spacing. Foreign/legacy
fragments and external images/SVGs use the same center policy. Final
transforms are rebased into parent-local space, including page placement and
transformed containers; the camera itself is not changed by Paste.

## Verification limits at audit time

The baseline was exercised in Vitest/jsdom only. No claim is made here about
Firefox, WebKitGTK/Tauri, Wayland PRIMARY selection, a clipboard manager, or
cross-application fidelity. Those routes require serialized browser/native
validation after the repairs.

## Fresh follow-up audit — 2026-09-09

This follow-up was performed on `master` at `0e9b637af` (the first repair
milestone), with the concurrent Inspector, grid, generative-edit, and visual
snapshot changes left in the working tree. The checkout is
`/home/kevina/CodingProjects/varve`. The host is Linux/KDE/Wayland
(`WAYLAND_DISPLAY=wayland-0`, `DISPLAY=:0`), with Firefox, Chromium, WebKit
MiniBrowser, and the Tauri desktop preflight available. No private Figma
fixture was found in the checkout and no claim is made about ordinary Figma
Copy until an owned Firefox capture is retained.

The audit separates the failure boundary so a transport failure is not
mistaken for a parser or placement failure:

| ID | Boundary | Finding and status | Evidence |
| --- | --- | --- | --- |
| CLIP-01 | Application / Cut | Exact serialized bytes are parsed against the reader limits before an editable write is published. **Resolved.** | `packages/editor/src/clipboard.test.ts`; commit `0e9b637af` |
| CLIP-02 | Transport / event lifetime | Paste events are synchronously snapshotted; delayed reads never retain `ClipboardEvent` or `DataTransfer`. **Resolved.** | `clipboard.test.ts`; `Shell.tsx` ownership guard |
| CLIP-03 | Transport / MIME negotiation | Current, legacy, and web-prefixed Varve MIME types are read from DOM snapshots and async string items. SVG string MIME and SVG `text/plain` fallbacks are retained. **Resolved for strings; native desktop bridge still unverified.** | `clipboard.ts`; focused 55-test run |
| CLIP-04 | Application / Cut | Names-only text fallback is not treated as an editable transfer. **Resolved in the write contract; end-to-end OS denial coverage remains open.** | `ClipboardWriteOutcome`; Cut tests |
| CLIP-05 | Application / graph | All ordered roots share one ID map during clone, preserving supported sibling references. **Resolved for node graph references; full component/style/variable/motion closure remains open.** | `scene/clone.ts`; `context.import.test.tsx` |
| CLIP-06 | Application / destination | Clipboard fragments no longer construct a temporary document by spreading the destination document. **Resolved for destination-resource leakage.** | `context.tsx`; import tests |
| CLIP-07 | Transport / ownership | Composed focus paths retain input, textarea, select, dialog, contenteditable, textbox, and embedded editor ownership. Canvas paste prevents the browser default only after it claims the event. **Resolved in unit coverage; native Firefox/WebKit evidence open.** | `isNativeClipboardTarget`; Shell listener |
| CLIP-08 | Parser / SVG | XML declaration/BOM/comment handling, repeated path tuples, Q/T conversion, bounded arcs, and malformed-tag progress are covered. **Resolved for the reported hangs and regressions; root-transform/viewBox visual evidence open.** | `packages/import/src/svg.test.ts` |
| CLIP-09 | Application / lifetime | File-picker and drop imports capture document/session/revision/selection identity and cancel before commit when it changes. **Implemented; focused stale-import regression is still to be added.** | `isSessionCurrent`; picker/drop call sites |
| CLIP-10 | Application / feedback | Partial and failed import reporting is available in the Import Report path. **Open for paste/drop UI wiring and actual committed-root counts.** | `useFileImport.ts`; Import Report follow-up |
| CLIP-11 | Parser / rich text | Canvas plain text now inserts an editable text node. Paragraph/line-break and rich-text subset conversion is **open**. | `context.tsx`; no rich-text fixture yet |
| CLIP-12 | Transport / item identity | File objects are deduplicated by object identity; an SVG string and equivalent SVG file no longer create two logical items. **Resolved for the DOM snapshot route; same-name external application coverage open.** | `clipboard.ts` snapshot tests |
| CLIP-13 | Figma transport | Ordinary Figma Copy envelope is **unsupported/unverified**. Copy as SVG remains the documented interoperability route until a bounded Firefox fixture proves a safe adapter. | `figma-import-system.md`; fixture lane open |
| CLIP-14 | Native decode / permission | Native `.fig` decoding and dynamic decompression behavior under the packaged Tauri CSP are **open**. The browser converter and local file route are separate from clipboard. | `docs/architecture/figma-import-system.md`; desktop lane open |
| CLIP-15 | Native transport / lifetime | Bounded streaming reads, image dimension checks, cancellation cleanup, and deadline behavior are **open** for the desktop command path. | `docs/quality/tauri-command-audit.md`; WDIO lane open |

### Requirement-to-test mapping

| Requirement | Current evidence | Remaining evidence |
| --- | --- | --- |
| Recoverable Cut and exact payload validation | `clipboard.test.ts`, 55 focused editor/import tests | Native permission-denied Cut; actual undo/reopen capture |
| One operation per gesture and fresh event data | Shell ownership code and snapshot tests | Chromium + Firefox keyboard/menu workflow; WebKitGTK native event |
| Editable text/SVG and bounded malformed parsing | `context.import.test.tsx`, `svg.test.ts` | Rich-text formatting, large SVG timing, visual geometry screenshots |
| Cross-root references and resource closure | clone/import tests | components/styles/variables/interactions/motion fixtures |
| Import lifetime and cancellation | `isSessionCurrent` checks | stale picker/drop regression and native cancellation cleanup |
| Figma interoperability boundary | qualified docs only | owned Firefox captures for Copy, Copy as SVG, Copy as PNG |
| Marketing claims and help | website/help changes in the documentation milestone | desktop light/dark/mobile captures on both deployment bases |

The exact focused command for the first repair milestone was:

```text
pnpm exec vitest run packages/editor/src/clipboard.test.ts packages/editor/src/context.import.test.tsx packages/import/src/svg.test.ts --maxWorkers=1
55 tests passed
```

The native Wayland WDIO spec (`tests/wdio/clipboard-wayland.e2e.ts`) and the
Firefox external-application lane were not silently treated as passing; they
remain explicit validation work. The next milestone records their exact
commands and any environment or permission failures separately from parser
and application results.

### Validation update — 2026-09-09

The follow-up implementation also validates the serialized fragment graph
before a clipboard write: unknown node kinds, missing container children,
cyclic ownership, malformed raster tiles, invalid resource maps, non-finite
transforms, and UTF-8 payloads over the byte budget are rejected. Paste
announcements now use the number of roots that the commit transaction actually
landed and include partial-fidelity counts. The picker guard's editor seam now
declares the revision state it snapshots, so the affected package typecheck
cannot silently drift from the runtime contract.

Commands and evidence from this checkout:

```text
VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/editor/src/clipboard.test.ts --maxWorkers=1 --reporter=verbose
21 tests passed
VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/editor/src/context.import.test.tsx packages/import/src/svg.test.ts --maxWorkers=1 --reporter=dot
36 tests passed
./node_modules/.bin/tsc -p packages/editor/tsconfig.json --noEmit
passed (the concurrent workspace build still reports unrelated generative/codegen errors)
./node_modules/.bin/tsc -p packages/import/tsconfig.json --noEmit
passed
pnpm build:website
pnpm build:website:pages
both passed; 82 pages generated for each deployment base
VARVE_WEBSITE_E2E_PORT=4341 VARVE_WEBSITE_E2E_PORT_ROOT=4342 pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/clipboard-feature.spec.ts --project=ghpages --project=custom-domain --workers=1 --reporter=list
8 passed; desktop light/dark and mobile screenshots inspected
VARVE_E2E_PORT=1551 VARVE_E2E_WORKERS=1 VARVE_E2E_OUTPUT_DIR=clipboard-audit-2026-09-09 pnpm exec playwright test tests/e2e/canvas/clipboard.spec.ts tests/e2e/canvas/figma-import.spec.ts --project=chromium --reporter=list
clipboard rendering and editor-load cases passed; import-report dismissal is now covered; the run was stopped after concurrent HMR failures from a missing generative-edit module
VARVE_WDIO_SPECS=./tests/wdio/clipboard-wayland.e2e.ts pnpm test:desktop:native
preflight passed; build stopped before the native spec on concurrent TypeScript errors in codegen, scene, and ContentAwareFill
```

Inspected browser evidence includes a pasted vector rectangle with selection
handles, centered rotated placement, and website clipboard capability tables in
light, dark, and mobile layouts. Native `.fig` screenshots show the imported
layers and the expected Import Results report; the report is intentionally
dismissed by the integration spec before canvas assertions. The full native
transport, Firefox-owned Figma captures, rich-text formatting, and paste/drop
Import Results wiring remain open and are not claimed as complete.

The stale destination guard now has a dedicated `dropUtils.test.ts` regression
covering unchanged sessions and document, tab, document-revision, and
selection-revision changes. Its focused run passed 25 tests; this closes the
unit-test gap in CLIP-09 while the delayed real picker/drop browser lane remains
platform-dependent.

### Final validation record — 2026-09-09

The final task commit sequence is on `master` (`0e9b637af` through
`4c4ddd583`), with the concurrent Inspector, grid, generative-edit, and
snapshot work left uncommitted or in its own commits. `pnpm verify:plan`
selected the full closure and reported `FULL-SUITE ESCALATION: YES` because the
worktree includes workspace/toolchain changes. `pnpm verify:affected` therefore
stopped at the required escalation and the explicitly authorized full gate was
run with reason `Clipboard/import serialization, native transport bounds, and
the planner's workspace/toolchain escalation`. That gate reached the affected
typechecks but stopped on the unrelated concurrent
`packages/engine/src/inference/inferenceWorker.ts` `PatchMatchResult` error;
the native build also remains blocked by concurrent codegen, scene, and
generative-helper errors. This is recorded as a validation blocker, not a
clipboard pass.

The documentation, emoji, token, and architecture audits passed. Website
desktop light/dark and mobile captures passed for both GitHub Pages and the
custom-domain base (8 Playwright tests); inspected evidence is retained under
`test-results/clipboard-feature-*`. The remaining open lanes are the owned
Firefox Figma captures, packaged Tauri `.fig` CSP/decompression verification,
rich-text formatting, paste/drop Import Results UI wiring, and native
Wayland/WebKitGTK transport and cancellation cleanup.
