# Import System

**Canonical doc for File > Import and the ingestion pipeline behind it.**

## Open and Import are different commands

This distinction is the whole architecture, and getting it wrong is what
caused the defect this document was written after.

| | **File > Open** | **File > Import** |
|---|---|---|
| Means | Load a Varve document *as* a document | Insert external artwork *into* the document already open |
| Formats | `.varve`, legacy `.strata`, Varve `.json` | Images, SVG, and the design formats below |
| Result | A new tab | Scene nodes in the current document, selected |
| Hidden input | `#file-open-input` | `#file-import-input` |
| Owner | `Shell.tsx` | `importing/useFileImport.ts` |

The two hidden inputs both live in `Shell`, and for a period both commands
clicked the same ref — the document one. Every route to Import (menu,
shortcut, command palette) therefore offered only `.varve`/`.strata`/`.json`,
so an ordinary image or SVG could not be selected at all. The entire import
pipeline behind the second input was correct and simply unreachable.

Two guards exist so it cannot come back:

- `packages/editor/src/importPickerWiring.test.tsx` asserts the inputs have
  disjoint `accept` filters, that Import activates the asset input and never
  the document one, and the converse for Open.
- `tests/e2e/canvas/file-import.spec.ts` clicks the real menu item. A
  service-level test cannot catch this class of bug: `ImportService` worked
  perfectly throughout the entire time Import was unusable.

## Pipeline

All ingestion routes converge on one parser stack, so fidelity and reporting
cannot diverge between them.

```
File > Import ─┐
canvas drop  ──┼──> ImportService.importFiles() ──> parser registry ──> Document fragment
paste        ──┤         (per-file report)              │                      │
icon insert  ──┘                                        │                      v
                                                        │            editor.batchImportNodes()
                                                        v                      │
                                              validateImport()                 v
                                            (preflight fidelity)      placement, selection,
                                                                       single undo entry
```

| Route | Entry point |
|---|---|
| File > Import | `packages/editor/src/importing/useFileImport.ts` |
| Canvas drag-drop (HTML5 and native Tauri) | `CanvasArea.tsx` → `importDroppedFiles` |
| Clipboard paste | `context.tsx` |
| Icon library | `context/useIconAssets.ts` |

LUT files (`.cube`, `.3dl`, `.clf`, `.ctf`) are the one exception: they carry
no scene content, so `useFileImport` peels them off and routes them to the
adjustment handler before calling `ImportService`.

## The format registry is the single source of truth

`packages/import/src/registry.ts` derives what the picker advertises from what
the pipeline can actually ingest:

- `listSupportedExtensions()` = every registered parser's extensions, plus
  `RASTER_IMPORT_EXTENSIONS` (the content-sniffed raster formats that have no
  parser of their own).
- `getImportAcceptString()` = that list plus `LUT_IMPORT_EXTENSIONS`, rendered
  as the picker `accept` string.

Importing `@varve/import` registers every built-in parser as a module side
effect, so the string is complete from the first render. Never hand-maintain a
parallel list in a component — that is exactly the drift this replaced.

One override exists. The Figma parser claims `json` so content lookup works,
but advertising bare `.json` under Import puts Varve's own documents in the
artwork picker. The picker offers `.fig.json` instead; browsers match `accept`
by filename suffix, so real Figma exports still resolve.

A Varve document that reaches Import anyway (drag-drop, or the OS dialog's
"All files") is detected by its `formatVersion` stamp and reported as
*"... is a Varve document. Use File > Open ..."* rather than failing as an
opaque Figma decode.

## Format support — tested reality

Verified through the real Import menu action in Chromium against the Vite dev
server (`tests/e2e/canvas/file-import.spec.ts`, snapshots inspected).

| Format | Status | Notes |
|---|---|---|
| PNG | Full | Alpha, ICC, EXIF orientation preserved |
| JPEG | Full | EXIF orientation applied to displayed dimensions |
| WebP | Full | Extended-format dimension probe fixed 2026-08-27. Animated WebP retained as animated media |
| GIF | Full | Animation retained, not flattened to a first frame |
| BMP | Full | |
| TIFF | Full | Transcoded to PNG on ingest (`utif` + `upng-js`) because browsers do not decode TIFF in an `<img>` |
| AVIF | Full | `ispe` box probe now recurses through `iprp`/`ipco` |
| SVG / SVGZ | Editable vector | See fidelity matrix; `.svgz` is gunzipped by content sniff |
| PSD / PSB | Partial | Layers import; effects, adjustment layers and smart objects are reported as unsupported |
| PDF | Partial | Basic paths and text; gradients approximated, fonts substituted |
| AI | Partial | PDF-compatible AI only |
| EPS | Partial | Basic paths |
| Sketch | Partial | Symbols, shared styles and constraints not preserved |
| Figma | Partial | REST/plugin JSON only. Native `.fig` binary reports unsupported |

Animated GIF and WebP are not flattened on import. `inspectRasterBytes`
probes the container, persists `AnimatedAssetMetadata` on the asset, and the
media system resolves frames from the editor's media clock — never browser
`<img>` autoplay. See `architecture/animated-image-media-system.md`.

**Not verified in this pass:** the Tauri desktop shell (the E2E runs the same
editor frontend over Vite, not the packaged app), the built `/try` bundle,
Firefox, and WebKit. The pipeline is platform-independent TypeScript with no
native calls, so it is expected to hold, but that is an inference and not a
measurement.

`/try` **is** verified: `tests/e2e/browser/try-demo.spec.ts` imports a PNG and
an SVG into the demo. Import is deliberately not among the demo's withheld
capabilities — it is entirely client-side, and the demo should prove Varve can
take real artwork.

## SVG fidelity

| Feature | Support | Degradation |
|---|---|---|
| `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path` | Full | — |
| Groups, nested transforms | Full | Flattened to a Varve frame with a composed affine |
| `viewBox`, `width`/`height`, units (px/pt/mm/cm/in) | Full | — |
| Fill, stroke, opacity, fill-rule | Full | — |
| Linear/radial gradients | Supported | Warned as "may not render identically" |
| `clipPath`, `mask` | Supported | Mapped to Varve clip/alpha/luminance masks |
| `use` / `symbol` | Local refs only | Cyclic refs detected and skipped; external refs refused |
| `text` | Basic | `text-anchor` honoured; missing fonts surface in the font dialog |
| `image` (`data:`) | Full | Becomes a managed embedded asset |
| `image` (remote) | **Refused** | Reported; see security below |
| `filter`, `pattern` | Dropped | Reported |
| `script`, `foreignObject`, `style` | Dropped | Reported |
| Animation (`animate`, `set`, ...) | Dropped | Reported |

Everything dropped is named in `ImportResult.unsupportedFeatures` and reaches
the Import Results dialog. A silent drop reads identically to corrupt output,
which is why the reporting matters as much as the parsing.

## Security

SVG is untrusted, active document content. Two properties are pinned by
`packages/import/src/svg-security.test.ts`:

**Nothing executes.** The parser is a string-based recursive descent walk that
builds scene nodes; it never constructs DOM or hands markup to `innerHTML`.
`<script>` and inline `on*` handlers therefore cannot run — they are dropped
and reported. This is a property of the parsing strategy, so a future rewrite
to `DOMParser` would need to re-establish it deliberately.

**Nothing is fetched.** `svg/resourcePolicy.ts` holds the rule: inline the
bytes the file carries, fetch nothing else. This is not theoretical — an
`<image>` href used to survive parsing verbatim into an image fill `src`, and
`imageCache` loads any non-inline source with `new Image()`. Opening an SVG
someone sent you issued a silent outbound request to whatever URL it named,
carrying the referrer and any identifier in the query string.

| href | Decision |
|---|---|
| `data:image/*` | Embedded as a managed asset |
| `http(s):`, `//host/...`, `/path`, `../path` | Refused, reported |
| `javascript:`, `vbscript:`, `file:`, `data:text/html` | Refused, reported |

`/try` also carries `img-src 'self' data: blob:` in its CSP, which would block
a remote load. Desktop and the ordinary web build have no such backstop, which
is why the policy lives in the parser rather than relying on CSP.

Other limits already in place: `MAX_RASTER_ENCODED_BYTES` (128 MB),
`MAX_RASTER_PIXELS` (64 MP) and `MAX_RASTER_DIMENSION` (65535) gate raster
decode; cyclic `<use>` is detected by a visited-id set.

## Placement, selection and undo

`batchImportNodes` in `context.tsx` is the single positioning authority.

- **Placement.** A drop supplies its world point; the picker supplies none, so
  items land at the viewport centre, cascaded 40px per item. Ten imported
  images do not stack on one point.
- **Destination.** With exactly one unlocked, visible frame or group selected,
  imports are reparented into it, rebasing the world transform first so a
  translated or rotated container does not teleport its new children.
- **Fit.** An image whose natural size disagrees with its frame gets a
  `suggestFit` pass rather than a stretched fill.
- **Selection.** Every imported root ends up selected, so the Inspector and
  transform handles apply immediately.
- **Undo.** One entry per import call, pushed before the loop — a ten-file
  batch is one undo, not ten, and never dozens for an SVG's internal nodes.

## Entry points

| File | Role |
|---|---|
| `packages/editor/src/importing/useFileImport.ts` | File > Import: picker, progress, report, abort |
| `packages/import/src/service.ts` | Orchestration and per-file compatibility report |
| `packages/import/src/registry.ts` | Parser registry, canonical `accept` string |
| `packages/import/src/import.ts` | Raster fallback: node, asset, ICC, EXIF |
| `packages/import/src/svg.ts`, `svg/elements.ts` | SVG parse and element conversion |
| `packages/import/src/svg/resourcePolicy.ts` | What an imported SVG may reference |
| `packages/import/src/validation.ts` | Preflight fidelity estimate |
| `packages/editor/src/context.tsx` | `batchImportNodes`: placement, selection, undo |

## Testing

- Unit: `packages/import/src/*.test.ts` (registry, raster, SVG, security,
  format honesty, service), `packages/editor/src/importPickerWiring.test.tsx`.
- E2E: `tests/e2e/canvas/file-import.spec.ts` (real menu action, six specs
  with visual snapshots), `tests/e2e/browser/try-demo.spec.ts` (demo import).
