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
| CLIP-05 | Application / graph | All ordered roots share one ID map during clone, preserving supported sibling references. **Resolved for the supported document closure; unsupported external references remain fidelity losses.** | `scene/clone.ts`; `documentCodec.test.ts`; `mergeImportedResources.test.ts` |
| CLIP-06 | Application / destination | Clipboard fragments no longer construct a temporary document by spreading the destination document. **Resolved for destination-resource leakage.** | `context.tsx`; import tests |
| CLIP-07 | Transport / ownership | Composed focus paths retain input, textarea, select, dialog, contenteditable, textbox, and embedded editor ownership. Canvas paste prevents the browser default only after it claims the event. **Resolved in unit coverage; native Firefox/WebKit evidence open.** | `isNativeClipboardTarget`; Shell listener |
| CLIP-08 | Parser / SVG | XML declaration/BOM/comment handling, repeated path tuples, Q/T conversion, bounded arcs, malformed-tag progress, root transforms, and non-zero viewBox mapping are covered. **Resolved in the parser; a packaged visual screenshot for root-transform/viewBox output remains evidence work.** | `packages/import/src/svg.test.ts`; SVG browser evidence |
| CLIP-09 | Application / lifetime | File-picker and drop imports capture document/session/revision/selection identity and cancel before commit when it changes. **Resolved in the guard and focused regression; real picker/drop cancellation remains platform evidence.** | `isSessionCurrent`; `dropUtils.test.ts` |
| CLIP-10 | Application / feedback | Partial and failed import reporting now reaches the shared Import Results surface for paste and drop, with the committed layer count attached to each report. **Resolved in the browser/application path; picker/drop cancellation and native transport evidence remain separate.** | `context.tsx`, `CanvasArea.tsx`, `ImportResults.tsx`; `ImportResults.test.tsx` |
| CLIP-11 | Parser / rich text | Canvas plain text and bounded HTML now insert editable text nodes. Paragraphs, line breaks, whitespace, bold/italic/decoration, font family, and CSS color are supported; unsafe or omitted content produces warnings. **Resolved for the supported subset.** | `clipboardRichText.test.ts`; `context.import.test.tsx` |
| CLIP-12 | Transport / item identity | File objects are deduplicated by object identity; an SVG string and equivalent SVG file no longer create two logical items. **Resolved for the DOM snapshot route; same-name external application coverage open.** | `clipboard.ts` snapshot tests |
| CLIP-13 | Figma transport | Ordinary Figma Copy envelope is **unsupported/unverified**. Copy as SVG remains the documented interoperability route until a bounded Firefox fixture proves a safe adapter. | `figma-import-system.md`; fixture lane open |
| CLIP-14 | Native decode / permission | Native `.fig` decoding and dynamic decompression behavior under the packaged Tauri CSP are **open**. The browser converter and local file route are separate from clipboard. | `docs/architecture/figma-import-system.md`; desktop lane open |
| CLIP-15 | Native transport / lifetime | Bounded streaming reads, operation IDs, cancellation cleanup, a five-second deadline, and native image dimension/pixel checks are implemented in the command and frontend wrapper; focused wrapper tests pass. **Packaged Wayland/WebKitGTK ownership and the explicit WDIO lane remain open.** | `apps/desktop/src-tauri/src/lib.rs`; `packages/platform/src/tauri.ts`, `tauri.test.ts`; WDIO lane open |

### Requirement-to-test mapping

| Requirement | Current evidence | Remaining evidence |
| --- | --- | --- |
| Recoverable Cut and exact payload validation | `clipboard.test.ts`, 55 focused editor/import tests | Native permission-denied Cut; actual undo/reopen capture |
| One operation per gesture and fresh event data | Shell ownership code and snapshot tests | Chromium + Firefox keyboard/menu workflow; WebKitGTK native event |
| Editable text/SVG and bounded malformed parsing | `context.import.test.tsx`, `svg.test.ts` | Rich-text formatting, large SVG timing, visual geometry screenshots |
| Cross-root references and resource closure | clone/import tests | components/styles/variables/interactions/motion fixtures |
| Import lifetime and cancellation | `isSessionCurrent` checks | stale picker/drop regression and native cancellation cleanup |
| Figma interoperability boundary | qualified docs only | owned Firefox captures for Copy, Copy as SVG, Copy as PNG |
| Marketing claims and help | website/help changes and inspected clipboard-page captures on both deployment bases | broader website visual matrix outside the focused clipboard route |

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
transport and Firefox-owned Figma captures remain open and are not claimed as
complete.

The stale destination guard now has a dedicated `dropUtils.test.ts` regression
covering unchanged sessions and document, tab, document-revision, and
selection-revision changes. Its focused run passed 25 tests; this closes the
unit-test gap in CLIP-09 while the delayed real picker/drop browser lane remains
platform-dependent.

### Rich-text paste follow-up — 2026-09-10

CLIP-11 is resolved for the bounded supported HTML subset. The editor now has
an integration regression proving that a captured HTML clipboard item becomes
an editable text node with paragraph content, line breaks, bold runs, and CSS
color formatting. The parser continues to omit executable, external, and
unsupported content and reports those losses.

Evidence:

```text
cd /tmp/varve-rich && VARVE_TEST_WORKERS=1 \
  /home/kevina/CodingProjects/varve/node_modules/.bin/vitest run \
  packages/editor/src/context.import.test.tsx \
  packages/editor/src/clipboardRichText.test.ts --maxWorkers=1 --reporter=dot
18 tests passed
/home/kevina/CodingProjects/varve/node_modules/.bin/biome check \
  packages/editor/src/context.import.test.tsx \
  packages/editor/src/clipboardRichText.ts \
  packages/editor/src/clipboardRichText.test.ts
passed
```

Native browser ownership and rich-text shaping across every font/script remain
separate validation work. Paste and drop now publish material import losses and
failures through the same Import Results dialog used by the file picker; the
dialog includes the number of layers committed by the route.

### Paste/drop reporting follow-up — 2026-09-10

The shared report bridge is registered by `Shell` and is fed by both the
clipboard paste transaction and canvas drop import. Reports are only surfaced
for warnings, partial conversion, unsupported content, or failures, so a clean
transfer keeps the established announcement-only feedback. The report is
published after the atomic commit and carries `route` plus `insertedCount`;
complete failures publish with `insertedCount: 0`, and stale sessions publish
nothing, so the dialog cannot claim layers that were not inserted.

Evidence:

```text
cd /tmp/varve-report && \
  /home/kevina/CodingProjects/varve/node_modules/.bin/biome check \
  packages/editor/src/context/sessionGlobals.ts \
  packages/editor/src/context.tsx packages/editor/src/CanvasArea.tsx \
  packages/editor/src/Shell.tsx packages/editor/src/components/ImportResults.tsx \
  packages/editor/src/components/ImportResults.test.tsx
passed
cd /tmp/varve-report && VARVE_TEST_WORKERS=1 \
  /home/kevina/CodingProjects/varve/node_modules/.bin/vitest run \
  packages/editor/src/components/ImportResults.test.tsx --maxWorkers=1 --reporter=dot
10 tests passed
```

The editor integration regression also covers a malformed clipboard SVG with no
inserted artifacts; it publishes the report with a zero inserted count. The
combined context and dialog run passed 26 tests.

### Native transport cancellation follow-up — 2026-09-10

The Tauri platform wrapper now gives native reads the same five-second deadline
as the Rust command. A timed-out or aborted read sends its operation ID to
`cancel_clipboard_operation` before returning, while the Rust pipe reader polls
in bounded chunks and checks cancellation between polls. This prevents a
blocked compositor transfer from being left as an untracked frontend promise.
The native image reader and packaged desktop ownership still require the
Wayland/WebKitGTK run; this change does not claim that external platform lane.

Evidence:

```text
cd /tmp/varve-native && \
  /home/kevina/CodingProjects/varve/node_modules/.bin/biome check \
  packages/platform/src/platform.ts packages/platform/src/tauri.ts \
  packages/platform/src/tauri.test.ts
passed
cd /tmp/varve-native && VARVE_TEST_WORKERS=1 \
  /home/kevina/CodingProjects/varve/node_modules/.bin/vitest run \
  packages/platform/src/tauri.test.ts --maxWorkers=1 --reporter=dot
6 tests passed
```

### Final validation record — 2026-09-09

The final task commit sequence is on `master` (`0e9b637af` through
`cf8fc0105`, including the final audit and website-claim commits), with the concurrent Inspector, grid, generative-edit, and
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
and native Wayland/WebKitGTK transport and cancellation cleanup.

The final focused rerun covered `clipboard.test.ts`, `context.import.test.tsx`,
`dropUtils.test.ts`, and `svg.test.ts`: 82 tests passed in 21.39 seconds.

### Follow-up implementation update — 2026-09-09

The current `master` tip for this update is `8b9734fbe`. The concurrent
Inspector, grid, generative-edit, and website snapshot work remains in the
shared working tree. The request and import milestones were built in isolated
worktrees and attached to `master` without restoring the shared index.

The new stable findings are:

| ID | Boundary | Finding and status | Evidence |
| --- | --- | --- | --- |
| CLIP-16 | Transport / request ownership | **Resolved for browser acquisition.** Typed `TransferRequest`, `ClipboardSnapshot`, capability, and outcome contracts key captured snapshots and fallback timers by operation/gesture identity; repeated keyboard gestures no longer share one timer or global event slot. | `packages/editor/src/clipboard.ts`, `packages/editor/src/clipboard.test.ts`, commit `ed3ee32b3` |
| CLIP-17 | Transport / item identity | **Resolved.** An SVG string suppresses only a byte-identical file representation; distinct same-name SVG files remain separate logical items. | `packages/editor/src/clipboard.test.ts`, commit `da45957af` |
| CLIP-18 | Parser / rich text | **Resolved for the bounded subset.** HTML is snapshotted synchronously and converted into editable canvas paragraphs, line breaks, bold/italic/decoration, font, and RGB color runs. Unsafe embeds and unsupported formatting produce warnings; plain text remains the fallback. | `packages/editor/src/clipboardRichText.test.ts`, commit `b84ef71ad` |
| CLIP-19 | Import / throughput | **Resolved for batch decoding.** Import workers are capped at two, preserve input order in the final report, and report progress as individual files complete. | `packages/import/src/service.test.ts`, commit `8b9734fbe` |
| CLIP-20 | Application / shared insertion | **Resolved locally.** Paste, file import, and canvas drop prepare `PreparedFragment` records and commit through one atomic insertion loop; platform cancellation evidence remains open. | `context.tsx`, `CanvasArea.tsx`, `useFileImport.ts`, commit `d4f8de4a` |
| CLIP-21 | Native transport / deadline | **Resolved in the native bridge.** Tauri reads/writes carry operation IDs, bounded streaming, cancellation, and a five-second deadline; packaged ownership and the explicit Wayland WDIO lane remain external evidence. | `apps/desktop/src-tauri/src/lib.rs`, `packages/platform/src/tauri.ts`, commit `5e5a80c1` |
| CLIP-22 | Native decode / CSP | **Open.** Packaged `.fig` decoding still requires a production CSP run proving the schema interpreter/decompression path does not reach dynamic code. | `packages/import/src/figma/native.ts`, desktop validation lane |
| CLIP-35 | Application / command discovery | **Resolved.** The rendered Edit menu now exposes the same representation commands as the action registry and canvas context menu; selection gating is consistent. | `packages/editor/src/Menubar.tsx`, `tests/e2e/canvas/clipboard.spec.ts`, commit `e1c0fa5e` |
| CLIP-36 | Transport / write ownership | **Resolved.** The final text-only fallback rechecks the generation after both resolve and reject, so superseded writes cannot report success. | `packages/editor/src/clipboard.ts`, `packages/editor/src/clipboard.test.ts`, commit `e71cbb56` |
| CLIP-37 | Application / placement | **Resolved.** Plain-text paste captures destination scope and canvas geometry before the browser read and cancels when document, revision, design, or selection scope changes. | `packages/editor/src/actions/createActionHandlers.ts`, `packages/editor/src/actions/createActionHandlers.test.ts`, commits `2aa86ae1`, `d4ed3526` |
| CLIP-38 | Application / SVG placement | **Resolved.** Copying a selected child now lifts that root to its accumulated world transform before export, retaining the original offset when pasted outside its parent frame. | `packages/editor/src/actions/createActionHandlers.ts`, `packages/editor/src/actions/createActionHandlers.test.ts`, commits `3e9416b3`, `df893fa9` |
| CLIP-39 | Application / PNG placement | **Resolved.** Copy as PNG applies the same accumulated world transform to nested selected roots before rasterization, keeping the raster output aligned with its world-space bounds. | `packages/editor/src/components/Shell/ExportLayer.tsx`, commit `9f79c41f` |

The capability boundary remains explicit: ordinary Figma Copy is unsupported
until a synthetic design is captured from Firefox with provenance and a bounded
envelope is demonstrated. Copy as SVG, Copy as PNG, and REST/plugin JSON remain
the documented interoperability routes. No external Figma account or private
clipboard payload was inferred from parser tests.

### Command and closure follow-up — 2026-09-09

CLIP-23 is **resolved for supported closure records**. Version-2 fragments
retain generative edit records whose source or result nodes are in the copied
closure; the existing resource merge path allocates destination identities and
remaps those records on paste. A regression covers round-trip preservation.

CLIP-24 is **resolved for command registration and supported routes**. Copy
Text, Copy as SVG, Copy as PNG, Paste as Plain Text, and Paste SVG Markup are
registered in the Edit menu, canvas context menu where applicable, and the
palette registry. They remain unassigned in shortcut customization. SVG
markup is size-bounded and passes through `ImportService`; plain text creates
an editable text node through the editor import path. PNG rendering remains a
renderer callback because the action layer does not own a render engine.

Evidence:

```text
VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/editor/src/clipboard.test.ts --maxWorkers=1 --reporter=dot
25 tests passed
/home/kevina/CodingProjects/varve/node_modules/.bin/biome check <changed editor/codegen files>
passed
```

The isolated editor typecheck exceeded its 60-second validation budget and was
not treated as a pass. The repository affected planner is the authoritative
next check after this commit. CLIP-22 (packaged `.fig` CSP/decompression) and
owned Firefox Figma captures remain open.

### Native transport follow-up — 2026-09-09

CLIP-21 is now **resolved for the Wayland native bridge**. Tauri clipboard
commands accept an operation ID, run blocking transfer work outside command
processing, enforce a five-second deadline, cap payloads at 64 MiB, and expose
cancellation. Linux pipe reads use nonblocking polling so cancellation and the
deadline terminate a stalled owner transfer instead of abandoning a blocked
promise. The frontend bridge supplies an ID for every native read/write.

Evidence from the isolated desktop crate:

```text
cargo check --lib                         passed (after supplying the existing local native model/helper fixtures)
cargo test --lib native_clipboard_pipe     2 passed
```

The native Wayland test fixture covers bounded reads and cancellation. The
explicit `tests/wdio/clipboard-wayland.e2e.ts` lane and real Firefox ownership
transfer remain environment-dependent and were not inferred from these unit
tests. CLIP-22 remains open until packaged `.fig` decoding is verified under
the production Tauri CSP without dynamic schema compilation.


### Native decoder update — 2026-09-10

CLIP-14 is resolved for the browser/native decoder implementation. The
previous path delegated Kiwi schema decoding to `kiwi-schema.compileSchema`,
which constructs a decoder with `new Function` and is incompatible with the
production Tauri CSP. `packages/import/src/figma/native.ts` now bounds schema
nesting and interprets the schema/message wire format directly, while keeping
`openfig-core` only for node identifiers and reusable vector geometry helpers.
The checked-in `OpenFigs.fig` fixture still converts to editable nodes, and a
regression disables `globalThis.Function` during decoding to prove the route
does not depend on dynamic code generation.

Evidence:

```text
./node_modules/.bin/tsc -p packages/import/tsconfig.json --noEmit --pretty false
passed
VARVE_TEST_WORKERS=1 ./node_modules/.bin/vitest run packages/import/src/figma.test.ts packages/import/src/service.test.ts --maxWorkers=1 --reporter=dot
22 tests passed
pnpm build:website
84 pages built
```

CLIP-14 remains externally unverified only for the packaged Tauri WebView's
actual decompression/resource behavior. CLIP-13 (owned Firefox Figma clipboard
captures) and CLIP-15 (Wayland native transport/cancellation lane) remain open;
ordinary Figma Copy is still unsupported and no private envelope is inferred
from the native file fixture.
### Validation follow-up — 2026-09-10

The current `master` checkout was rechecked after the native decoder change:

```text
./node_modules/.bin/tsc -p packages/import/tsconfig.json --noEmit --pretty false
passed
VARVE_TEST_WORKERS=1 ./node_modules/.bin/vitest run packages/import/src/figma.test.ts packages/import/src/service.test.ts --maxWorkers=1 --reporter=dot
23 tests passed
VARVE_TEST_WORKERS=1 ./node_modules/.bin/vitest run packages/import/src/svg.test.ts packages/editor/src/clipboard.test.ts packages/editor/src/clipboardRichText.test.ts packages/editor/src/context.import.test.tsx packages/editor/src/dropUtils.test.ts --maxWorkers=1 --reporter=dot
86 tests passed
pnpm typecheck:e2e
passed
```

The website build completed with 84 generated pages. `pnpm verify:plan`
selected a full gate because the shared checkout contains concurrent lock,
toolchain, and validation changes. `pnpm verify:affected` stopped at that
required escalation. The full gate completed the architecture scan and all
workspace package typechecks but stopped at its E2E typecheck invocation with
exit code 1; the exact standalone command above passed immediately afterward.
The gate also reported pre-existing concurrent formatter and health diagnostics
in website changelog, Inspector, and editor context files. Those files were
left untouched to preserve the other workstreams.

### Request ownership follow-up — 2026-09-10

CLIP-06 is resolved for the browser gesture hand-off. The keyboard path now
creates one `TransferRequest` per gesture, keeps fallback timers keyed by that
request, and passes the identity into `EditorProvider.paste`. The synchronous
DOM listener claims the matching pending request before reading
`ClipboardEvent.clipboardData`, cancels only that request, and forwards the
captured snapshot to the same operation. A read without a captured request
starts a fresh operation instead of reusing a completed gesture's state.

The existing request-isolation regression in
`packages/editor/src/clipboard.test.ts` covers two same-session snapshots and
distinct operation IDs; the ordered-claim regression now also verifies that
queued DOM events consume those requests in gesture order. Real Chromium/Firefox repeated-keyboard and native
Wayland ownership runs remain external validation lanes; no browser result is
claimed from this contract-level repair.

Validation for this follow-up also ran `pnpm audit:docs` (clean, 728 docs),
`pnpm audit:emoji` (clean), `pnpm audit:tokens` (153 pairs across three
themes), and `node scripts/audit-architecture.mjs --ci` (the established
14-cycle and hub-budget diagnostics, with no layer or type-only ratchet
violations). The ordered-claim regression passed in the isolated clipboard
harness. The required full gate completed package typechecks but stopped at
the unrelated concurrent E2E fixture error in
`tests/e2e/canvas/font-toolbar-visual.spec.ts`; the shared workstream file was
left untouched.

### Accessible command dialog follow-up — 2026-09-10

CLIP-25 is resolved for the clipboard command entry points. Copy as PNG scale
selection and Paste SVG Markup now use the shared `PromptDialog`, so keyboard
focus, Escape cancellation, and accessible labeling are consistent with the
rest of the editor. A canceled dialog returns before any renderer callback or
import operation; SVG markup is still bounded before `ImportService` runs, and
dialog/import failures produce the existing live announcement.

Evidence:

```text
/home/kevina/CodingProjects/varve/node_modules/.bin/biome check \
  packages/editor/src/actions/createActionHandlers.ts \
  packages/editor/src/actions/createActionHandlers.test.ts
passed
cd /tmp/varve-current && VARVE_TEST_WORKERS=1 \
  /home/kevina/CodingProjects/varve/node_modules/.bin/vitest run \
  packages/editor/src/actions/createActionHandlers.test.ts --maxWorkers=1 --reporter=dot
34 tests passed
```

The focused dialog assertions are included in
`packages/editor/src/actions/createActionHandlers.test.ts`. A complete
isolated package run was not claimed because the temporary archive required
the workspace's direct dependency links; the focused action-handler suite
passed after supplying those existing links. Package typechecks and the
repository affected/full-gate results remain recorded above. External
Firefox/Figma, Wayland, and packaged Tauri CSP lanes are unchanged.

### Supported dependency closure follow-up — 2026-09-10

CLIP-26 is resolved for the supported document closure. Clipboard version-2
fragments now carry referenced component masters, styles, shared paints,
variable collections and aliases, interactions, linked text stories, motion
timelines, and node-owned motion extensions/presets. Dependency nodes are
serialized for remapping but remain excluded from the ordered paste roots.
The existing merge path allocates one resource map before cloning and remaps
node, story, interaction, variable, paint, component, and timeline references;
missing external references are omitted rather than resolved by destination
name or coincident id.

Evidence:

```text
cd /tmp/varve-current && VARVE_TEST_WORKERS=1 \
  /home/kevina/CodingProjects/varve/node_modules/.bin/vitest run \
  packages/scene/src/documentCodec.test.ts \
  packages/editor/src/import/mergeImportedResources.test.ts \
  packages/editor/src/clipboard.test.ts --maxWorkers=1 --reporter=dot
50 tests passed
/home/kevina/CodingProjects/varve/node_modules/.bin/biome check \
  packages/scene/src/documentCodec.ts \
  packages/scene/src/documentCodec.test.ts \
  packages/editor/src/clipboard.ts \
  packages/editor/src/context.tsx \
  packages/editor/src/import/mergeImportedResources.ts \
  packages/editor/src/import/mergeImportedResources.test.ts
passed
```

The isolated editor typecheck still reports unrelated concurrent codegen,
engine, and missing optional type-declaration diagnostics; the new closure
files produced no diagnostics. The affected planner continues to escalate
because the shared checkout contains workspace and validation changes.
Firefox/Figma captures, Wayland ownership, and packaged Tauri CSP remain open.

### SVG artifact order and grouping follow-up — 2026-09-10

CLIP-27 is resolved for the editor's clipboard SVG route. A single import
artifact now clones all of its ordered roots through one complete id mapping
and places the union of those roots with one world-space translation. Separate
files still receive the established cascade. This prevents the old per-root
40-unit cascade from changing SVG spacing or display order, while preserving
existing `<g>` frames and their child order.

Evidence:

```text
cd /tmp/varve-svg && VARVE_TEST_WORKERS=1 \
  /home/kevina/CodingProjects/varve/node_modules/.bin/vitest run \
  packages/editor/src/context.import.test.tsx --maxWorkers=1 --reporter=dot
14 tests passed
/home/kevina/CodingProjects/varve/node_modules/.bin/biome check \
  packages/editor/src/dropUtils.ts \
  packages/editor/src/context.tsx \
  packages/editor/src/context.import.test.tsx
passed
```

The regression pastes an SVG containing a nested group and a second root,
asserting source root order, shared parent placement, preserved sibling
spacing, and the group's two editable children. Browser and desktop clipboard
ownership evidence remains separate from this parser/insertion regression.

Browser evidence for the same behavior:

```text
VARVE_E2E_PORT=1480 pnpm exec playwright test \
  tests/e2e/canvas/clipboard.spec.ts -g "SVG paste preserves" \
  --project=chromium --workers=1 --reporter=line
1 passed (1.2m)
```

The inspected artifact is
`test-results/run-65344-1480/canvas-clipboard-SVG-paste-80bb0-r-spacing-and-nested-groups-chromium/clipboard-svg-order-and-groups.png`.
It shows the grouped root and its sibling selected together on the canvas; the
test also asserts their serialized order, editable group children, and world
spacing. Wayland ownership and packaged Tauri transport remain open.

### Validation checkpoint — 2026-09-10

The required impact planner selected the full closure because the shared
checkout contains concurrent workspace and validation changes. The targeted
checks for this follow-up passed: `pnpm audit:docs`, `pnpm audit:emoji`,
`pnpm audit:tokens`, the platform typecheck, the Tauri wrapper/dialog tests,
the 26-test editor context/report run, and the 49-test Figma/SVG/import run.
The architecture audit completed with the repository's existing cycle,
instability, and hub-budget baseline findings.

The recorded full-gate command was:

```text
VARVE_FULL_GATE_REASON="clipboard/import reliability follow-up: paste-drop Import Results, native clipboard cancellation, and concurrent workspace validation escalation" pnpm verify:full
```

It reached all workspace package typechecks and `tests/e2e/tsconfig.json`,
then exited 1 on concurrent lint/health diagnostics in the website changelog,
Inspector/Crop/Table surfaces, generated Inspector captures, and the existing
`packages/editor/src/context.tsx` line ceiling (`10569 > 10554`). No
clipboard/import typecheck failure was reported. The native Wayland/WebKitGTK
WDIO lane, packaged `.fig` CSP smoke, and owned Firefox Figma captures remain
external evidence blockers and are intentionally not marked complete.

### SVG viewport mapping follow-up — 2026-09-10

The SVG entry point now carries a validated root transform into every child and
maps a non-zero `viewBox` origin into the declared viewport. It honors the
default `xMidYMid meet`, `slice`, and `none` alignment modes, keeps output page
dimensions in viewport units, and rejects non-finite root matrices before
conversion. Existing group ordering and shared-root placement are unchanged.

Evidence:

```text
cd /tmp/varve-figma && VARVE_TEST_WORKERS=1 \
  /home/kevina/CodingProjects/varve/node_modules/.bin/vitest run \
  packages/import/src/figma.test.ts packages/import/src/svg.test.ts \
  packages/import/src/service.test.ts --maxWorkers=1 --reporter=dot
49 tests passed
/home/kevina/CodingProjects/varve/node_modules/.bin/biome check \
  packages/import/src/svg.ts packages/import/src/svg.test.ts
passed
```

### Native image budget follow-up — 2026-09-10

The `arboard` PNG fallback now rejects empty images, dimensions above 32,768px,
and images above 64 megapixels before constructing an RGBA image or encoding
PNG. This closes the native dimension-bomb gap; packaged execution and the
Wayland ownership lane remain external evidence.

### Completion status reconciliation — 2026-09-10

The local browser/application implementation is substantially repaired, but the
clipboard/import effort is **not fully complete**. The following items remain
open and must not be described as shipped or verified:

- Paste, file import, and canvas drop now share the local `PreparedFragment`
  preparation and atomic insertion contract (CLIP-20 resolved). Real picker,
  drop, and packaged cancellation still need platform evidence.
- Permission-denied Cut, stale/superseded Cut, save/reopen, and real picker/drop
  cancellation still need end-to-end evidence.
- Packaged Tauri Wayland/WebKitGTK clipboard ownership, external Firefox
  transfers, and the explicit `tests/wdio/clipboard-wayland.e2e.ts` lane remain
  unrun. The native wrapper unit tests do not substitute for those checks.
- Packaged `.fig` decoding still needs a production-CSP smoke test. The
  browser/native decoder has a no-dynamic-code regression, but the packaged
  WebView resource and decompression path is not verified.
- Owned Firefox captures for the synthetic Figma design (ordinary Copy, Copy as
  SVG, and Copy as PNG) are absent. Ordinary Figma Copy therefore remains
  unsupported/unverified; Copy as SVG remains the documented interoperability
  route.
- Same-name/identical files from an external application and native permission
  outcomes need transport coverage. Root-transform/viewBox needs a packaged
  visual capture in addition to parser tests.

The exact `master` desktop-crate command attempted for the native image guard
was:

```text
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml native_clipboard --lib
```

It stopped during the existing desktop build script because the isolated
checkout did not contain `apps/desktop/src-tauri/onnxruntime-libs/**/*`; no
native clipboard test result was claimed from that run. The focused JS/import
and wrapper checks recorded above remain valid, but they do not close the
external platform lanes listed here.

### Prepared-fragment insertion milestone — 2026-09-11

CLIP-20 is resolved for the local editor implementation. Paste, File > Import,
and canvas Drop now produce `PreparedFragment` records and call the shared
`commitPreparedFragmentDocument` loop. The loop preserves acquisition order,
clones each logical artifact with its complete source mapping, applies the
route-specific placement callback, merges resources, and returns the roots that
actually committed. Paste still preserves world anchors and editable text;
Import and Drop still preserve their center/cascade and mask behavior.

Evidence from an isolated checkout based on `master`:

```text
/home/kevina/CodingProjects/varve/node_modules/.bin/biome check \
  packages/editor/src/importing/preparedFragment.ts \
  packages/editor/src/importing/preparedFragment.test.ts \
  packages/editor/src/importing/useFileImport.ts \
  packages/editor/src/context/sessionGlobals.ts \
  packages/editor/src/components/ImportResults.tsx \
  packages/editor/src/dropUtils.ts packages/editor/src/CanvasArea.tsx \
  packages/editor/src/context/types.ts packages/editor/src/context.tsx
passed
VARVE_TEST_WORKERS=1 /home/kevina/CodingProjects/varve/node_modules/.bin/vitest run \
  packages/editor/src/context.import.test.tsx \
  packages/editor/src/importing/preparedFragment.test.ts \
  --maxWorkers=1 --reporter=dot
18 tests passed
/home/kevina/CodingProjects/varve/node_modules/.bin/tsc \
  -p packages/editor/tsconfig.json --noEmit --pretty false
clipboard/import files passed; the command also reports pre-existing \
codegen/SVG and missing Prism declaration diagnostics
```

The implementation is committed as `d4f8de4a`. The earlier CLIP-20 row in the
milestone table is superseded by this section. External evidence remains open
for packaged Wayland/WebKitGTK ownership, Firefox/Figma transfers, permission
denials, picker/drop cancellation, packaged `.fig` CSP behavior, and the
required visual captures; those lanes are not inferred from the shared-loop
tests.

### Artifact-root grouping follow-up — 2026-09-11

The first PreparedFragment implementation still flattened every imported
artifact to one item per node in File > Import and Drop. That changed the
placement unit for SVGs that contain ordered sibling roots: the siblings could
receive separate cascade offsets and lose their logical grouping. The parser
already returned artifact boundaries, so this was an application/placement
defect rather than a transport or SVG-tokenizer defect (CLIP-27).

File > Import and Drop now preserve each artifact's ordered `rootIds` as one
`PreparedFragmentItem`. The shared commit loop clones that complete root set in
one mapping, while separate files and separate parser artifacts remain separate
items. Drop image-mask detection examines every root, and Import Results reports
the number of roots that actually committed. Paste's existing grouped artifact
path remains unchanged.

Evidence:

```text
pnpm exec biome check \
  packages/editor/src/importing/preparedFragment.ts \
  packages/editor/src/importing/preparedFragment.test.ts \
  packages/editor/src/dropUtils.ts packages/editor/src/CanvasArea.tsx \
  packages/editor/src/importing/useFileImport.ts
passed
pnpm exec vitest run \
  packages/editor/src/importing/preparedFragment.test.ts \
  packages/editor/src/context.import.test.tsx \
  packages/editor/src/dropUtils.test.ts --maxWorkers=1
44 tests passed
```

The follow-up is committed as `755fda79a`. The browser visual capture for SVG
ordering and nested groups remains the separate evidence for Paste; a real
Firefox/Wayland Drop capture and the packaged visual lane are still open.

### Rich representation write ownership — 2026-09-12

The command-specific Copy Text and Copy as SVG paths previously wrote directly
through a local helper. That left them outside the serialized clipboard queue:
if a second gesture superseded a pending rich write, the first promise could
resolve as editable after the newer operation had started. This was an
application/transport ownership defect (CLIP-16), and it could authorize a
destructive caller that trusted the outcome.

All rich representation writes now use the same generation-keyed queue as the
Varve fragment writer. Native, prefixed browser, unprefixed browser, and
text-only fallbacks check ownership both before and after every await. A stale
operation returns `write-failed` and cannot issue a late fallback write. The
SVG markup helper also commits grouped parser artifacts through the shared
PreparedFragment path.

Evidence:

```text
pnpm exec biome check \
  packages/editor/src/clipboard.ts packages/editor/src/clipboard.test.ts \
  packages/editor/src/actions/createActionHandlers.ts
passed
pnpm exec vitest run packages/editor/src/clipboard.test.ts --maxWorkers=1 --reporter=dot
27 tests passed
pnpm exec vitest run \
  packages/editor/src/menu/__tests__/commandIntegrity.test.ts \
  packages/editor/src/actions/createActionHandlers.test.ts \
  --maxWorkers=1 --reporter=dot
40 tests passed
```

The implementation is committed as `63c19047`. Menu snapshot refresh remains
with the concurrent menu workstream; the existing baseline already predates
the earlier command additions, while the new command-integrity check passes.

### Frontend representation completion — 2026-09-12

The follow-up audit reopened two application/placement defects that were easy
to miss behind command registration: Copy as PNG had an action callback but no
renderer-owned implementation, and multi-root Copy as SVG wrapped all roots in
an arbitrary `0 0 1000 1000` viewBox. Plain-text command paste also bypassed the
shared prepared-fragment insertion transaction. These defects could produce an
unavailable command, clipped or displaced SVG in another editor, and history
behavior different from ordinary paste (CLIP-31, CLIP-32, CLIP-33).

`ExportLayer` now snapshots the selected document and roots, renders a
transparent PNG at an explicit 1×/2×/3× scale, enforces dimension and pixel
budgets before encoding, and publishes through the serialized representation
writer. Copy as SVG computes a world-space union viewBox while retaining the
selection order and each root's transform. Plain text creates a prepared text
item and commits through the same atomic insertion path. SVG viewBox parsing
also rejects missing/nonfinite tuple components without leaving an invalid
source in the parser.

Evidence:

```text
pnpm exec biome check --write \
  packages/editor/src/actions/createActionHandlers.ts \
  packages/editor/src/actions/createActionHandlers.test.ts \
  packages/editor/src/components/Shell/ExportLayer.tsx
passed
pnpm exec vitest run packages/editor/src/actions/createActionHandlers.test.ts \
  --maxWorkers=1 -t 'clipboard dialogs'
4 tests passed
VARVE_E2E_PORT=1480 pnpm exec playwright test \
  tests/e2e/canvas/clipboard.spec.ts -g 'SVG paste preserves' \
  --project=chromium --workers=1 --reporter=line
1 passed; inspected test-results/run-797825-1480/.../clipboard-svg-order-and-groups.png
```

The implementation is committed as `8d57aaf8`. Firefox/Wayland external
transfers, packaged WebKitGTK `.fig` decoding, native PNG transport, and the
full deployment visual matrix remain open verification lanes; this local
browser evidence does not imply those platforms.

### Drop artifact cascade correction — 2026-09-12

The grouped-root follow-up still used the file index when choosing a cascade
offset. A single file can yield more than one parser artifact, so those
artifacts could be placed on top of one another even though their roots were
correctly grouped internally. This was an application/placement defect
(CLIP-34), not a parser or transport failure.

Drop placement now offsets by the ordered parsed-artifact index. Roots within
one artifact retain one position and one mapping; only distinct artifacts
receive the 40-unit cascade.

The correction is committed as `d5cf54e6`. It has no effect on File > Import
center/cascade behavior or same-document Paste world-anchor placement.

### Website claim and visual check — 2026-09-12

The marketing and file-format pages were rebuilt from both deployment bases so
their claims match the implemented behavior: SVG is a bounded editable subset
with ordered/grouped placement, Copy as PNG is transparent and scale-selected,
and ordinary Figma Copy remains unsupported. The focused website route passed
on GitHub Pages and custom-domain builds in light/dark desktop and mobile
layouts; the generated captures were inspected for clipping, overflow, table
readability, and contrast.

```text
pnpm build:website                 # 84 pages built; 0 Astro errors
pnpm build:website:pages            # 84 pages built; 0 Astro errors
VARVE_WEBSITE_E2E_PORT=4431 \
VARVE_WEBSITE_E2E_PORT_ROOT=4432 \
pnpm --dir apps/website exec playwright test \
  -c ../../playwright.website.config.ts tests/e2e/clipboard-feature.spec.ts \
  --project=ghpages --project=custom-domain --project=touch --workers=2
8 passed
```

Inspected captures include the `test-results/clipboard-feature-clipboard-feature-
desktop-{light,dark}-layout-{ghpages,custom-domain}/` images and the matching
`clipboard-feature-mobile` captures. This is visual evidence for the website
surface; it does not substitute for native WebKitGTK/Tauri, Firefox/Wayland,
or external Figma transfer evidence.

### Rendered menu ownership correction — 2026-09-12

The command definitions and canvas context menu listed the representation
commands, but the rendered `Menubar` used a separate legacy Edit-menu array and
omitted them. This was a frontend command-discovery defect (CLIP-35): users
could reach Copy as PNG only through an unadvertised route, so the feature was
effectively absent from the main menu.

The rendered Edit menu now exposes all five representation commands with the
same selection gating as the context menu. A browser E2E test selects a real
layer, opens Edit, chooses Copy as PNG, confirms the accessible scale dialog,
and verifies an `image/png` clipboard item. The menu unit test asserts the
labels directly.

Evidence:

```text
pnpm exec biome check --write \
  packages/editor/src/Menubar.tsx packages/editor/src/Menubar.test.tsx \
  tests/e2e/canvas/clipboard.spec.ts
passed
pnpm exec vitest run packages/editor/src/Menubar.test.tsx \
  --maxWorkers=1 -t 'Edit menu contains'
1 passed
VARVE_E2E_PORT=1482 pnpm exec playwright test \
  tests/e2e/canvas/clipboard.spec.ts -g 'Edit menu Copy as PNG' \
  --project=chromium --workers=1 --reporter=line
1 passed
```

The correction is committed as `e1c0fa5e`. The E2E exercises Chromium's
browser transport; native Tauri clipboard ownership and Firefox/Wayland
external transfers remain separate verification lanes.

### Final fallback ownership correction — 2026-09-12

The serialized writer already rejected superseded rich writes before their
fallbacks, but its final `writeText` path returned `text-only` without checking
ownership after the await. A delayed names-only write could therefore report a
successful outcome after a newer gesture had begun (CLIP-36).

The final text fallback now rechecks the generation on both resolve and reject.
The regression holds the first fallback open, starts a second representation
write, releases the first, and verifies that only the second can report a
terminal outcome. This keeps Cut ineligible for a stale fallback.

```text
pnpm exec biome check --write packages/editor/src/clipboard.ts packages/editor/src/clipboard.test.ts
passed
pnpm exec vitest run packages/editor/src/clipboard.test.ts --maxWorkers=1
28 passed
```

The correction is committed as `e71cbb56`.

### Plain-text destination ownership correction — 2026-09-12

The command-specific plain-text action read the browser clipboard before it
captured its destination. A delayed read could therefore insert into a new
document, changed selection, or a different canvas center (CLIP-37). This was
an application/placement race rather than a browser permission failure.

The action now snapshots the initiating document, revision, active design,
selection revision, eligible frame/group parent, and canvas center before the
await. It revalidates that scope immediately before committing the editable
text fragment through `commitPreparedFragment`; stale work is canceled and
announced. The focused regression asserts the shared insertion payload and its
captured center.

```text
pnpm exec biome check --write \
  packages/editor/src/actions/createActionHandlers.ts \
  packages/editor/src/actions/createActionHandlers.test.ts
passed
pnpm exec vitest run packages/editor/src/actions/createActionHandlers.test.ts \
  --maxWorkers=1 -t 'clipboard dialogs'
4 passed
```

The correction is committed as `2aa86ae1`.

The delayed-read cancellation regression was added in `d4ed3526`:

```text
pnpm exec vitest run packages/editor/src/actions/createActionHandlers.test.ts \
  --maxWorkers=1 -t 'plain text' --reporter=dot
2 passed
```

### Nested SVG placement correction — 2026-09-12

The multi-root SVG export used world-space bounds for its wrapper, but a child
selected inside a translated frame still serialized only its local transform.
That mismatch could place the artwork at the wrong location when pasted into a
different document (CLIP-38), an application/placement defect rather than an
SVG parser failure.

The exporter now snapshots each selected root with its accumulated world
transform before emitting the fragment. Descendants retain their local
transforms, so nested groups remain grouped while the root's original world
placement and sibling order remain intact. The focused regression verifies the
world-space viewBox and transform for a nested child.

```text
pnpm exec biome check --write \
  packages/editor/src/actions/createActionHandlers.ts \
  packages/editor/src/actions/createActionHandlers.test.ts
passed
pnpm exec vitest run packages/editor/src/actions/createActionHandlers.test.ts \
  --maxWorkers=1 -t 'SVG|plain text'
3 passed
```

The implementation is committed as `3e9416b3`; the follow-up assertion syntax
correction is committed as `df893fa9`.

The same placement rule now applies to PNG clipboard output. `ExportLayer`
passes accumulated world transforms for nested selected roots into its bounded
SVG raster source before encoding, so transparent PNG bounds cannot be filled
from local coordinates while the wrapper is in world coordinates (CLIP-39).
The implementation is committed as `9f79c41f`; the existing real Copy as PNG
Chromium test continues to pass.

```text
VARVE_E2E_PORT=1484 pnpm exec playwright test \
  tests/e2e/canvas/clipboard.spec.ts -g 'Edit menu Copy as PNG' \
  --project=chromium --workers=1 --reporter=line
1 passed
```

The browser visual rerun after the correction also passed:

```text
VARVE_E2E_PORT=1483 pnpm exec playwright test \
  tests/e2e/canvas/clipboard.spec.ts -g 'SVG paste preserves' \
  --project=chromium --workers=1 --reporter=line
1 passed
```

Inspected evidence: `test-results/run-1006991-1483/canvas-clipboard-SVG-
paste-80bb0-r-spacing-and-nested-groups-chromium/clipboard-svg-order-and-
groups.png`. The screenshot shows the imported group and sibling rectangle in
their separate positions with the group selected; geometry and layer-order
assertions pass alongside the visual capture.

### Final local reliability rerun — 2026-09-12

The final focused browser/application rerun on `master` commit
`43195596fe1c83181d95131b753ac3afffe92897` passed 93 clipboard/import tests
across the action handlers, serialized writer, prepared-fragment insertion,
and SVG parser. The affected planner was run first; it selected the full
workspace closure because concurrent work touched shared packages. Its Tier 0
formatter check stopped on the unrelated concurrent
`apps/website/tests/e2e/chromeos-linux.spec.ts` import/order and wrapping
diagnostics, so that file was left untouched.

```text
pnpm verify:plan
Full-suite escalation: NO
pnpm verify:affected
blocked at format:touched by unrelated chromeos-linux.spec.ts diagnostics
pnpm exec vitest run \
  packages/editor/src/actions/createActionHandlers.test.ts \
  packages/editor/src/clipboard.test.ts \
  packages/editor/src/importing/preparedFragment.test.ts \
  packages/import/src/svg.test.ts --maxWorkers=1 --reporter=dot
4 files, 93 tests passed
pnpm audit:docs
clean (746 docs, 346 links, 173 ADRs)
pnpm audit:emoji
clean (4304 files)
pnpm audit:tokens
all 153 pairs pass across 3 themes
node scripts/audit-architecture.mjs --ci
complete; 14 known cycles, no layer/type-only/dead-export ratchet
```

The focused website build and eight-route light/dark/mobile clipboard-page
visual checks remain recorded above. Native Wayland WDIO, external Firefox
Figma ownership, and packaged Tauri CSP remain explicitly unverified external
lanes.

The affected Menubar unit lane initially raced the FloatingPortal's measured
visibility and reported four false negatives while querying a hidden wrapper.
The assertions now wait for the named visible menu; the complete 21-test
Menubar file passes. This is test synchronization evidence, not a change to
clipboard behavior.

```text
pnpm exec biome check --write packages/editor/src/Menubar.test.tsx
passed
pnpm exec vitest run packages/editor/src/Menubar.test.tsx --maxWorkers=1 --reporter=dot
21 passed
```

The test-only correction is committed as `8054c425`.

The post-synchronization affected rerun passed all selected formatter, lint,
docs, emoji, E2E typecheck, and targeted unit lanes, including the 21 Menubar
tests and all clipboard/import regressions. The clipboard E2E lane then could
not start because the shared concurrent desktop server already owned port
`1420`; the standalone Chromium SVG and Copy as PNG runs recorded above used
isolated ports and passed.

```text
pnpm verify:affected
Tier 0, typecheck:e2e, and selected unit lanes passed
e2e:file:tests/e2e/canvas/clipboard.spec.ts — blocked: http://localhost:1420 already used
```

After selecting an isolated E2E port, a final affected rerun reached the
current concurrent engine work and stopped at its untouched formatter changes:

```text
VARVE_E2E_PORT=1490 pnpm verify:affected
blocked at format:touched by packages/engine/src/generativeEdit/diffusionFrame.ts
  and diffusionFrame.test.ts formatting diagnostics
```

The clipboard/import files remain clean under the same formatter and lint
checks, and their direct unit and isolated browser E2E commands passed.

The direct editor typecheck also reports no clipboard/import diagnostics:

```text
pnpm exec tsc -p packages/editor/tsconfig.json --noEmit --pretty false
3 unrelated concurrent diagnostics in AIStatusIndicator, ContextAwareShortcuts,
and the in-flight font catalog projection; zero clipboard/import errors
```

With `VARVE_E2E_PORT=1490`, the planner-launched clipboard E2E lane completed
all five Chromium tests (including real paste, Copy as PNG, grouped SVG paste,
frame placement, and rotated viewport placement). The next concurrent CAF lane
stopped on a four-pixel visual snapshot drift and did not run its remaining 16
tests; no clipboard failure was reported.

### CLIP-40 — Import feedback could not reveal committed results (2026-09-12)

**Classification:** Application / frontend feedback. **Resolved locally.**

The shared Import Results surface previously received only counts and warning
text. An offscreen paste, file import, or drop could therefore succeed while
leaving the user without a direct way to find the inserted roots. The report
now carries the actual committed root IDs. Shell filters those IDs against the
current document, selects the surviving roots, and fits their world bounds from
an accessible **Reveal selection** button. The SVG markup helper also captures
its destination before the prompt/parser awaits and cancels if the document
scope changes before commit.

Evidence:

```text
packages/editor/src/components/ImportResults.tsx
packages/editor/src/components/ImportResults.test.tsx
packages/editor/src/context/sessionGlobals.ts
packages/editor/src/context.tsx
packages/editor/src/CanvasArea.tsx
packages/editor/src/importing/useFileImport.ts
packages/editor/src/Shell.tsx
packages/editor/src/actions/createActionHandlers.ts
packages/editor/src/actions/createActionHandlers.test.ts
```

The native Wayland ownership lane, packaged Tauri CSP/.fig decode, and owned
Firefox Figma captures remain external verification lanes recorded in CLIP-13,
CLIP-15, and CLIP-22.

Validation for CLIP-40 and the frontend/marketing surface:

```text
pnpm exec biome check \
  packages/editor/src/actions/createActionHandlers.ts \
  packages/editor/src/actions/createActionHandlers.test.ts \
  packages/editor/src/components/ImportResults.tsx \
  packages/editor/src/components/ImportResults.test.tsx \
  packages/editor/src/context/sessionGlobals.ts \
  packages/editor/src/importing/useFileImport.ts
passed

pnpm exec vitest run \
  packages/editor/src/components/ImportResults.test.tsx \
  packages/editor/src/actions/createActionHandlers.test.ts \
  --maxWorkers=1 --reporter=dot
2 files, 51 tests passed

pnpm verify:affected (VARVE_E2E_PORT=1490)
all selected clipboard/import unit lanes and E2E typecheck passed;
stopped in unrelated CAF screenshot drift (4 pixels), 16 CAF tests did not run

pnpm build:website && pnpm build:website:pages
86 pages built for each deployment base; 0 errors, 5 existing Astro hints

pnpm --dir apps/website exec playwright test \
  -c ../../playwright.website.config.ts \
  tests/e2e/clipboard-feature.spec.ts \
  --project=ghpages --project=custom-domain --project=touch --reporter=list
8 passed; inspected desktop light/dark and mobile screenshots
```

The final editor typecheck and architecture health check were also rerun after
the report bridge change:

```text
pnpm exec tsc -p packages/editor/tsconfig.json --noEmit --pretty false
passed

node scripts/audit-architecture.mjs --ci
completed with the repository's existing 14 dependency cycles and known hub/
instability warnings; no new layer, type-only-edge, or dead-export violation
```

After the drop root-ID correction (`a1dfdbeb`), the planner was rerun. The
affected gate stopped at `format:touched` on two unrelated concurrent editor
files (`AIStatusIndicator.tsx` and `ContextAwareShortcuts.tsx`); no clipboard,
import, or report file was implicated. The clean editor typecheck and focused
79-test rerun above are the targeted evidence for that correction.

An isolated Chromium rerun of `tests/e2e/canvas/clipboard.spec.ts` passed the
live paste, Copy as PNG, grouped SVG order/spacing/nested-group, and selected
frame placement cases (4 passed). The final rotated-camera case could not
start because the canvas content layer never became visible within 60 seconds
after the concurrent editor server restarted; it timed out during navigation,
before any clipboard assertion. The grouped SVG screenshot from that run was
inspected and shows the grouped artwork and sibling selection together on the
canvas.

### CLIP-41 — Reveal action could outlive its source document (2026-09-12)

**Classification:** Application / session ownership. **Resolved locally.**

Import reports now carry the receiving document ID alongside committed root
IDs. Before selecting or fitting anything, Shell rejects a report whose source
document is no longer active; this prevents a delayed report from targeting a
coincidentally reused ID in another open document.

Evidence: `context/sessionGlobals.ts`, `context.tsx`, `CanvasArea.tsx`,
`importing/useFileImport.ts`, `Shell.tsx`, and the `ImportResults` callback test.

Validation:

```text
pnpm exec biome check \
  packages/editor/src/context/sessionGlobals.ts \
  packages/editor/src/components/ImportResults.tsx \
  packages/editor/src/components/ImportResults.test.tsx \
  packages/editor/src/Shell.tsx packages/editor/src/context.tsx \
  packages/editor/src/CanvasArea.tsx packages/editor/src/importing/useFileImport.ts
passed

pnpm exec vitest run packages/editor/src/components/ImportResults.test.tsx \
  packages/editor/src/actions/createActionHandlers.test.ts --maxWorkers=1 --reporter=dot
2 files, 51 tests passed

pnpm exec tsc -p packages/editor/tsconfig.json --noEmit --pretty false
passed
```
