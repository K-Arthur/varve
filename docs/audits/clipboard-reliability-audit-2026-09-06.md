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
