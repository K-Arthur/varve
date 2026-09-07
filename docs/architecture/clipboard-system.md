# Clipboard System

Status: current (2026-09-06)

Varve has one system object clipboard for layer transfer and deliberately
separate application buffers for properties, effect stacks, guides, tables,
and other specialist workflows. `Duplicate` is a document operation; it does
not use the system clipboard or overwrite content copied from another app.

## Command ownership

The canvas owns Copy, Cut, and Paste only when the active target is not a
native text/input editing surface. `TextEditOverlay`, table editors, search
fields, inspector fields, and dialogs retain browser/native text semantics.
The global paste listener snapshots a live `ClipboardEvent` and then invokes
the editor command. The shortcut fallback is delayed only for engines that do
not deliver a paste event to a non-editable canvas; arrival of the real event
cancels that fallback, so one gesture has one owner.

The command and context-menu routes use the same editor actions:

| Command | Owner | System clipboard | Document history |
| --- | --- | --- | --- |
| Copy | canvas selection or native text editor | editable Varve fragment plus `text/plain` when supported | none |
| Cut | canvas selection or native text editor | same as Copy; deletion waits for an editable transfer | one `Cut` transaction |
| Paste | canvas selection or native text editor | reads the current event/API/native representation | one `Paste` transaction when content is inserted |
| Copy/Paste Properties | inspector/layer workflow | app-local property buffer | Paste Properties only |
| Copy/Paste Guides | guide workflow | guide-specific format and session fallback | Paste Guides only |
| Duplicate | canvas selection | does not touch system clipboard | one Duplicate transaction |

## Fragment contract

Layer Copy writes a versioned `varve-clipboard` envelope under the current and
legacy Varve MIME types. Chromium-compatible writes use the `web `-prefixed
custom types first; WebKitGTK-compatible unprefixed types are a fallback.
Older payloads without the envelope remain readable.

The fragment contains:

- explicit `rootIds` in selection order;
- the full descendant node closure, with a parent and selected child copied
  only once;
- placed-world `worldAnchor` transforms for each root;
- referenced image assets, raster-mask assets, icon assets, and mockup
  templates;
- raster tile data encoded through the scene tile codec rather than relying on
  a live `Map` surviving JSON serialization.

Clipboard JSON is bounded and validated before it reaches editor state. The
current limits are 64 MiB encoded JSON and 100,000 nodes. Malformed or
unsupported fragments are ignored without suppressing a valid SVG, image, or
plain-text representation.

On insertion, node and resource IDs are freshly allocated through the existing
document allocator. Components, styles, variables, interactions, and mockup
templates are remapped by identity, not by display name. Imported assets are
merged through `mergeImportedResources`; the source document is never used as
mutable destination state.

## Representation selection

One logical clipboard item is resolved in this order:

1. validated Varve data;
2. validated SVG text through the existing import service;
3. one raster image representation;
4. plain text for a native text editor or the canvas text importer.

The DOM paste path snapshots strings and `File` references synchronously while
the event is alive. It does not retain the event or reread a dead
`DataTransfer`. Files with the same filename remain separate items. A Varve
item is not also imported as its image/text alternatives, avoiding duplicate
objects.

Menu-driven paste first uses `navigator.clipboard.read()`. On Tauri under
Wayland, the native bridge then requests the representations in the same
order—Varve JSON, SVG, raster image, and text—through the compositor's native
clipboard protocol. This matters because WebKitGTK may expose only the
names-only `text/plain` fallback and may not dispatch a DOM `paste` event when
the canvas is not an editable element. The Ctrl+V fallback and right-click
Paste therefore converge on the same native rich read. The older native PNG
reader remains as a final compatibility fallback.

Native writes also publish the unprefixed Varve and legacy MIME types directly
on Wayland before browser Clipboard API fallbacks. No background clipboard
polling or automatic app-local recovery is performed. In particular, the
ordinary object Paste path does not fall back to an old guide buffer; guide
recovery is explicit to the guide command.

## Copy and Cut outcomes

Copy reports success only after the editable MIME write succeeds. If only the
names-only text fallback succeeds, feedback says that the result is text-only.
Cut treats that outcome as failure: it leaves the source in place. A Cut
captures the original document/session/revision/selection, awaits the editable
write, revalidates those values, and deletes the original roots in one
undoable transaction only when they are unchanged. A delayed paste follows the
captured document, page, workspace, selection, and viewport-center context; if
that context changes before commit, it cancels without inserting into the new
target.

## Placement and history

Ordinary Varve Paste preserves each root's placed-world pose. When a frame or
group is selected, that pose is rebased into the destination parent's local
space using the canonical coordinate helpers. Legacy fragments without an
anchor still adopt the selected frame/group; because they do not carry a
world pose, their source local transform is retained. External images and SVGs
are placed at the captured viewport center and then rebased into the selected
container when legal.

Paste and Cut commit through the existing transaction/history path. Undo Cut
restores the source document without rewriting the system clipboard. Redo
replays the committed document result and does not reread the clipboard.

## Fidelity and limitations

| Source or destination | Current behavior | Evidence / limitation |
| --- | --- | --- |
| Varve layer → Varve layer | editable hierarchy, transforms, supported resources, masks, and templates | editor integration tests; browser workflow validation is separate |
| Varve layer → text editor | names-only `text/plain` representation | intentionally not an editable Varve transfer |
| PNG/JPEG/WebP and clipboard image files → Varve | routed through `ImportService` as image nodes | decoder/import fidelity follows the existing importer |
| SVG → Varve | validated SVG routed through `ImportService` | unsafe/arbitrary XML is not treated as SVG |
| plain text → native text editor | browser owns insertion, Unicode, caret, and IME behavior | canvas does not steal text-editor focus |
| guides/properties/effects → their specialist command | separate app-local buffers/formats | these buffers do not replace object clipboard data |
| browser/Tauri | DOM event, async API, and native Tauri MIME bridge on Wayland; PNG compatibility fallback | host permissions and compositor clipboard ownership still apply |
| Figma/Illustrator/Office private formats | not claimed | no undocumented proprietary decoder is emitted |

## Verification

Focused evidence currently includes clipboard transport tests, current/legacy
event reads, event snapshot lifetime, repeated same-name image files, SVG
validation, raster tile round-trip, truthful Cut outcomes, delayed paste
cancellation, subtree insertion, world-pose conversion, mockup-template
ID remapping, and the Wayland native-rich fallback contract. Real browser and
visual checks belong to the focused Playwright clipboard and website feature
specs; native desktop and external-application interoperability are separate
validation lanes.

Implementation map:

- `packages/editor/src/clipboard.ts` — transport, validation, snapshots, and
  representation negotiation;
- `packages/editor/src/context.tsx` — command ownership, target binding,
  insertion, placement, and history;
- `packages/editor/src/import/mergeImportedResources.ts` — fresh resource IDs
  and reference remapping;
- `packages/editor/src/propertyClipboard.ts` and `guideClipboard.ts` —
  deliberately separate specialist buffers.
