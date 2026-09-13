# Clipboard System

Status: current (2026-09-11)

Varve has one system object clipboard for layer transfer and deliberately
separate application buffers for properties, effect stacks, guides, tables,
and other specialist workflows. `Duplicate` is a document operation; it does
not use the system clipboard or overwrite content copied from another app.

## Command ownership

The canvas owns Copy, Cut, and Paste only when the active target is not a
native text/input editing surface. `TextEditOverlay`, table editors, search
fields, inspector fields, and dialogs retain browser/native text semantics.
The global paste listener snapshots a live `ClipboardEvent` and then invokes
the editor command. Each gesture receives a typed `TransferRequest`; its
snapshot and delayed fallback are keyed by operation and gesture identity.
The shortcut fallback is delayed only for engines that do not deliver a paste
event to a non-editable canvas; arrival of the real event cancels that
request's fallback, so repeated gestures remain distinct.

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
- the source document identity for distinguishing in-document and foreign
  rich pastes;
- placed-world `worldAnchor` transforms for each root;
- referenced image assets, raster-mask assets, icon assets, and mockup
  templates when the supported closure can carry them;
- referenced components and masters, styles, shared paints, variable
  collections and aliases, prototype interactions, linked text stories, and
  supported motion timelines/extensions;
- raster tile data encoded through the scene tile codec rather than relying on
  a live `Map` surviving JSON serialization.

Clipboard JSON is bounded and validated before it reaches editor state. The
current limits are 64 MiB encoded JSON, 100,000 nodes, and 256 levels of
nested ownership. Malformed or
unsupported fragments are ignored without suppressing a valid SVG, image, or
plain-text representation.

On insertion, node and supported resource IDs are freshly allocated through the
existing document allocator. Each carried reference is remapped from the
complete source map; dependency-only nodes remain hidden from the paste roots.
External references that are outside the supported closure are dropped and
reported as fidelity loss rather than resolved from the destination by display
name. Imported assets and document resources are merged through
`mergeImportedResources`; the source document is never used as mutable
destination state.

## Prepared insertion contract

Paste, File > Import, and canvas Drop now prepare their acquired artifacts as
`PreparedFragment` values before touching editor state. The shared
`commitPreparedFragmentDocument` loop clones each logical item in source order,
allocates one mapping per item, applies the route's placement callback, merges
resources, and returns the actual committed roots. Paste retains world-anchor
placement and editable text handling; Import and Drop retain their center,
cascade, and mask semantics. The editor wraps that loop in one undo transaction
and publishes the resulting root count, so parsing and placement cannot create
partially visible intermediate batches.

## Representation selection

One logical clipboard item is resolved in this order:

1. validated Varve data;
2. validated SVG text through the existing import service;
3. one raster image representation;
4. bounded HTML rich text (paragraphs, breaks, and supported inline formatting);
5. plain text for a native text editor or the canvas text importer.

The DOM paste path snapshots strings, HTML, and `File` references synchronously while
the event is alive. It does not retain the event or reread a dead
`DataTransfer`. Files with the same filename remain separate items. An SVG
string suppresses only a byte-identical SVG file representation; distinct SVG
files remain separate items. A Varve
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

Paste has one explicit destination and one explicit placement policy. The
destination is resolved synchronously, before clipboard reads or image
decoding can change the editor state:

1. A single visible, unlocked selected frame or group is the destination
   container. Its world-space bounds center is the placement center. An empty
   group uses its world transform origin.
2. Any ambiguous selection (multiple containers, mixed container/content
   selection, or a locked/hidden container) uses the active page/design-canvas
   content root and the captured center of the visible `.editor-canvas`.

The center is converted with the live editor camera, including CSS viewport
size, pan, zoom, rotation, and floating-origin handling. The camera is never
changed by Paste, so an off-screen world-preserving paste remains discoverable
through the selected layer and the existing Fit Selection command.

Current same-document Varve copies carry both `sourceDocumentId` and root
`worldAnchor` transforms. With no explicit selected container, they preserve
the copied roots' placed-world pose and rebase those transforms into the
active content root. When a frame/group is explicitly selected, the anchors
preserve relative spacing and transformed geometry while one shared world
translation centers the fragment inside that destination.

Foreign Varve fragments, legacy fragments without a source identity/anchor,
external images, and SVGs have no trustworthy destination-independent pose.
Their whole imported fragment is translated so its visual bounds center lands
at the selected container center or viewport center. Multiple external items
cascade by 40 world units while retaining their individual sizes and
appearance. No automatic scaling is applied when an item is larger than its
target frame; the frame's existing clipping setting determines whether
overflow is visible.

An external import artifact is inserted as one ordered root batch. The importer
supplies `nodeIds` in source display order; the batch receives one shared
translation based on the union of its visual bounds, so sibling spacing and
transforms survive placement. The 40-unit cascade is applied only between
separate files or other logical artifacts. Existing SVG groups remain groups,
with their child order and hierarchy intact.

All final positions are translated in placed world space and written as
parent-local transforms. The selected destination is never chosen merely
because it appeared first in a multi-selection.

Paste and Cut commit through the existing transaction/history path. File-picker
and canvas-drop imports capture the initiating document/session/revision and
selection revision and cancel before their single batch commit if that context
has changed. Import batches decode with at most two workers and restore input
order in their reports while progress reflects completed files. Undo Cut
restores the source document without rewriting the system clipboard. Redo
replays the committed document result and does not reread the clipboard.

Import feedback uses one report bridge for the three ingestion routes. File
picker imports keep their existing report state; clipboard paste and canvas
drop publish a report only when conversion has warnings, unsupported content,
partial output, or failures. Publication happens after the atomic scene commit
and includes the route and the number of committed roots, so the Import Results
dialog reports what reached the document rather than only what the transport
offered. Stale or cancelled sessions do not publish a success count.
When a report includes committed roots, the dialog also offers **Reveal
selection**. That action selects only roots still present in the active
document and fits their world bounds, so an offscreen or cascaded import can
be found without changing the insertion transaction.

## Fidelity and limitations

| Source or destination | Current behavior | Evidence / limitation |
| --- | --- | --- |
| Varve layer → Varve layer | editable hierarchy, transforms, supported resources, masks, templates, components, styles, paints, variables, interactions, linked stories, and supported motion tracks | editor/scene closure and remapping tests; unsupported external references are dropped with fidelity loss |
| Varve layer → text editor | names-only `text/plain` representation | intentionally not an editable Varve transfer |
| PNG/JPEG/WebP and clipboard image files → Varve | routed through `ImportService` as image nodes | decoder/import fidelity follows the existing importer |
| SVG → Varve | validated SVG routed through `ImportService` | unsafe/arbitrary XML is not treated as SVG |
| plain text → native text editor | browser owns insertion, Unicode, caret, and IME behavior | canvas does not steal text-editor focus |
| bounded HTML → canvas text | editable paragraphs and supported bold/italic/decoration/font/color runs | unsupported embeds and formatting are omitted with warnings |
| guides/properties/effects → their specialist command | separate app-local buffers/formats | these buffers do not replace object clipboard data |
| browser/Tauri | DOM event, async API, and native Tauri MIME bridge on Wayland; PNG compatibility fallback | host permissions and compositor clipboard ownership still apply; native reads are bounded and cancellable, with packaged ownership covered by the desktop lane |
| Figma/Illustrator/Office private formats | not claimed | no undocumented proprietary decoder is emitted |

## Verification

Focused evidence currently includes clipboard transport tests, current/legacy
event reads, event snapshot lifetime, repeated same-name image files, SVG
validation, raster tile round-trip, truthful Cut outcomes, delayed paste
cancellation, subtree insertion, world-pose conversion, mockup-template
ID remapping, and the Wayland native-rich fallback contract. Real browser and
visual checks belong to the focused Playwright clipboard and website feature
specs; native desktop and external-application interoperability are separate
validation lanes. The 2026-09-09 focused milestone ran 55 editor/import
tests; browser, WebKitGTK/Tauri, Wayland native transport, and external
Firefox evidence are separate lanes and are not implied by those tests.

Implementation map:

- `packages/editor/src/clipboard.ts` — transport, validation, typed transfer
  requests, request-bound snapshots, and representation negotiation;
- `packages/editor/src/context.tsx` — command ownership, target binding,
  prepared-fragment commit, target binding, placement, and history;
- `packages/editor/src/importing/preparedFragment.ts` — shared prepared
  fragment contract and atomic insertion loop;
- `packages/editor/src/import/mergeImportedResources.ts` — fresh resource IDs
  and reference remapping;
- `packages/editor/src/propertyClipboard.ts` and `guideClipboard.ts` —
  deliberately separate specialist buffers.

## Native transport lifetime

The Tauri clipboard bridge keeps the webview command queue responsive. Each
read or write carries an operation ID, moves the blocking Wayland transfer to
a worker, bounds payloads at 64 MiB, and returns after five seconds at most.
Linux reads poll a nonblocking pipe in short intervals, checking cancellation
between chunks; a canceled or stalled owner therefore closes its pipe on the
terminal path. The frontend bridge creates an ID per native gesture and can
send `cancel_clipboard_operation` for an in-flight operation. This transport
contract does not claim that browser permission prompts or an unavailable
compositor provide content; those outcomes remain explicit capability results.

## Command surfaces

The Edit menu, canvas context menu, and action palette expose Copy Text, Copy
as SVG, Copy as PNG, Paste as Plain Text, and Paste SVG Markup. These commands
have no default keyboard bindings, so existing shortcuts remain unchanged.
Copy Text uses the selected nodes' text or names. Copy as SVG serializes a
selection snapshot with a transparent backdrop. Selected nested roots are
lifted to their accumulated world transform before serialization, so copying
from inside a frame does not lose the frame's offset. When multiple roots are
selected, their source order is retained and the wrapper `viewBox` is the
union of their world-space bounds, so negative coordinates, gaps, and rotated
placement are not clipped or collapsed into an arbitrary 1000×1000 canvas.
It falls back to plain text when the browser denies a rich write. Paste SVG
Markup sends bounded source text through `ImportService` and commits the
resulting artifacts through the same batch insertion API as file import. PNG
scale selection is delegated to the renderer callback (1× by default, with 2×
and 3× choices); `ExportLayer` snapshots the selection, rasterizes a
transparent world-space SVG union, lifts nested roots to accumulated world
transforms, enforces dimension/pixel limits before encoding, and writes the
resulting PNG through the same serialized queue.

Every representation write, including these command-specific formats, enters
the generation-keyed clipboard queue. Native and browser fallbacks recheck the
operation after each asynchronous write, so a superseded gesture cannot publish
late data or be mistaken for a committed editable transfer.

Both interactive command surfaces use the shared `PromptDialog` rather than a
blocking browser prompt. The dialog preserves focus, Escape cancellation, and
screen-reader labeling; canceling PNG scale or SVG markup entry performs no
clipboard write or import. SVG markup remains size-bounded before the importer
is invoked, and parser failures are announced through the normal command
feedback path.

Keyboard paste ownership is request-bound from dispatch through insertion. Each
shortcut creates one `TransferRequest` per gesture and keeps its fallback timer
keyed by that request. The DOM paste listener claims the oldest pending request
synchronously, snapshots its `DataTransfer`, cancels only that request's
fallback, and passes the same identity into the editor paste command. Menu and
palette calls create a fresh read when no captured snapshot belongs to them, so
an earlier gesture cannot leak into a later operation.

Plain-text paste captures the document identity, revision, selection scope,
destination parent, and initiating canvas center before awaiting the browser
clipboard read. A navigation, unrelated edit, or selection change therefore
cancels the insertion instead of moving text into a different document or
placing it from a stale canvas query.

## Frontend operation ownership (2026-09-12)

The frontend keeps asynchronous ingestion tied to the gesture that started it.
`useFileImport` allocates an operation ID and `AbortController` for each file
picker change. A later picker gesture aborts the earlier decode; only the
current owner may update progress, clear the input, publish Import Results, or
commit the prepared batch. Unmounting the editor aborts the owner as well.

`CanvasArea` applies the same lifetime contract to HTML5 and native Tauri
file drops. The drop position, document identity, session, revision, and mask
target are captured before `ImportService` starts. A superseded drop or a
document change releases its controller and cannot append stale roots or
reports. `ImportService` checks cancellation immediately before progress and
report callbacks, so a late worker result cannot repaint UI for a newer
operation.

File > Import captures its destination parent and initiating canvas world
center before invoking the file picker. The picker may return after camera,
selection, page, or workspace changes, but the operation remains bound to the
captured context and is canceled if the document scope no longer matches.

Menu Paste as Plain Text and Paste SVG Markup use the same request-bound
snapshot and prepared-fragment path as keyboard paste. They capture the
selection, destination parent, active page, workspace, and canvas center before
opening a prompt or reading the clipboard, then reject a result whose document
scope changed. SVG markup warnings and partial conversion are published through
the Import Results bridge with the actual committed root IDs. This keeps the
visible frontend feedback aligned with the one undoable scene transaction.

SVG and SVGZ file imports use the same bounded parser and preserve ordered
logical roots and nested groups. TIFF is normalized from its first IFD to an
embedded PNG; PSD/PSB and AI remain explicitly partial routes with material
losses in Import Results.
