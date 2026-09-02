# Varve file-ingestion audit — 2026-09-02

This audit covers local file selection, operating-system drag and drop,
document opening, artwork import, canvas placement, asset-library ingestion,
resource installation, preprocessing, and the one genuinely remote upload
path. It is the inventory and semantic contract for the shared ingestion UI;
it does not replace format-specific parser validation.

## Findings

Varve does not use `react-dropzone`, `FileUpload`, or `useDropzone`. The
current system is a mix of native hidden inputs, bespoke HTML5 handlers, and
the platform's Tauri drag bridge. The parser boundary is already centralized:
`@varve/import` owns format detection, parser selection, content sniffing,
compatibility reports, raster byte/dimension limits, and cancellation. The
main gaps are UI consistency, early user-facing rejection, and silent failure
in the Home asset/library surfaces.

### Flow classification

| Area | Semantic action | Accepted input | Multiplicity | Processing/validation | Current UI and migration decision |
| --- | --- | --- | --- | --- | --- |
| File menu, `Shell.tsx` | Open | `.varve`, legacy `.strata`, `.json` | Single | `FileReader` then document validation/migration in the editor context | Keep specialized document-open input; add shared picker semantics around future visible entry points. |
| Home drop surface | Open single; add to local library for a batch | Platform-recognized document kinds | Single opens; batch stores drafts | Currently extension/kind check and text read | Keep specialized Home drop behavior, but route selection/rejection through shared rules and use Open/Add-to-library copy. |
| File > Import / `useFileImport` | Import artwork into the active document | Parser-backed vector/raster formats plus LUTs | Multiple | `ImportService`, raster inspection, parser reports, abort signal; LUTs use the adjustment parser | Keep the controller and parser path; replace the hidden-input seam with the shared picker adapter where safe. |
| Canvas `CanvasArea` drop | Place/import at a world-space drop point | Artwork files, sanitized icon payloads, native OS paths | Multiple | Native/browser collection, `ImportService`, world-coordinate placement, cascade offset, mask targeting | Keep specialized spatial drop handler. Never route through a centered generic drop card. |
| Home `BulkImportDialog` | Add files to the local draft/library list | Documents and artwork extensions | Multiple | Currently extension-only; non-native formats become blank placeholders | Migrate queue/drop UI. Preserve order and partial results, but make rejection explicit and do not describe this as remote upload. |
| Home `AssetBrowser` | Import asset into local asset library | Images, SVG, fonts | Currently single | Raw bytes sent to `Platform.importAsset`; errors are swallowed | Use compact drop/picker composition, batch-capable queue, useful errors, and reset-safe inputs. |
| Reference image picker | Place/select a local image as a derived analysis reference | Images | Single | Data URL preview, document-image selection, clipboard path | Keep specialized compact control; share picker/drop interaction and report decode failures. |
| Image/pattern fill controls | Place a local image as an embedded fill source | Images | Single | Data URL is intentional because the scene persists the embedded source | Keep specialized inspector controls; use shared picker input contract, retain existing remount-safe change handling. |
| Icon Pack Manager | Install/add sanitized local SVG icons | `.svg` | Multiple | Text read, SVG sanitizer, local storage | Use shared picker button; retain sanitizer and per-file partial success. |
| Brush Library | Install/add local brush presets | `.varvebrush`, JSON | Single | Package parser and schema validation | Keep compact specialized picker; shared reset/error pattern is appropriate. |
| LUT adjustment | Import a LUT into the active document | `.cube`, `.3dl` and related parser-supported text formats | Single | LUT parser, adjustment creation | Keep specialized picker; validation belongs to the LUT parser, not extension matching alone. |
| Palette adjustment | Import palette data | `.gpl`, `.act`, `.ase`, `.aco` | Single | Format-specific parser | Keep specialized picker; share browse/reset affordance only. |
| Token Sync | Import DTCG/resolver token data | `.tokens`, `.tokens.json`, `.resolver.json`, `.json` | Single | Token parser and diagnostics | Keep specialized flow; import copy is correct. |
| Archive restore | Restore/install an archive | `.zip`, `.varve-archive.zip`, legacy archive | Single | Archive validation, manifest inspection, password/decrypt, abortable restore | Keep specialized drop/edit workflow; replace the emoji/file-card presentation with shared icon and error primitives in a later migration. |
| Settings avatar | Choose an avatar image | Images | Single | Local `FileReader` data URL | Use compact picker button; this is not an upload. |
| Crash center | Upload diagnostic report | Network endpoint when user has consented | Single report | Explicit consent, retry/recovery, remote uploader | Genuine Upload; do not rename. |

Fonts, profiles, models, and online providers are not currently general
browser file-upload surfaces. Fonts are primarily catalog/provider driven;
models are bundled or explicitly downloaded; ICC/LUT/profile parsing is
format-specific. They must not be advertised as generic uploads.

## Semantic contract

- **Open** makes a selected Varve/project document the active document or tab.
- **Import** converts file content into the active document or local library.
- **Place** positions content as a canvas element or embedded fill/reference.
- **Install/Add** stores a reusable resource such as an icon pack, brush, or
  model.
- **Upload** is reserved for bytes sent to a remote service, currently the
  consented crash-report path.

HTML `accept` values are picker hints only. A shared picker may reject empty,
oversized, unsupported, or over-count selections early, but parser/content
validation remains authoritative. Two same-named files are not duplicates by
name alone; selection order is preserved and independent batch failures do not
rollback successful files.

## Platform and performance notes

Browser input/drop uses `File.arrayBuffer()` or `File.text()` and the existing
parser boundary. Desktop OS drops on Linux use `Platform.onNativeFileDrop` and
`readFileBytes` because WebKitGTK does not deliver those paths as ordinary DOM
file drops. Native dialogs remain appropriate for Open/Import/Install actions
that need filesystem paths; their visual copy should stay consistent with the
browser picker.

Raster imports already enforce encoded-byte, pixel-count, and dimension limits
before decode. The UI must not turn large files into base64 previews merely to
show metadata. Existing data URLs in image fills and reference images are
intentional persisted/embedded values; generated object URLs elsewhere must be
revoked by their owning component.

## Planned implementation boundary

The design-system layer will provide small composable primitives:

- `FilePickerButton` — labeled browse fallback and reset-safe file input;
- `FileDropZone` — drag enter/leave/drop state, accepted/rejected/disabled
  presentation, and picker fallback;
- `FileQueue` — compact ordered rows with queued/processing/complete/failed/
  cancelled states and retry/remove actions;
- `FileError` — consistent actionable error presentation.

These components do not parse SVG, decode images, open documents, install
fonts, or place nodes. Those remain in the owning feature modules. Large empty
states are reserved for Home/library onboarding and batch import; inspector
controls use compact browse/drop affordances; CanvasArea keeps spatial drop
semantics and the Tauri bridge.

## Post-migration verification inventory

After migration, repository searches must classify every remaining native file
input, custom drop handler, `FileReader`, object URL, and “Upload” string as
canonical, specialized, or genuinely remote. Focused tests must cover empty and
unsupported selections, size/count limits, partial batches, order and duplicate
names, same-file reselection, keyboard picker fallback, drag state, errors,
cancellation, and resource cleanup. Browser tests must exercise real
`DataTransfer` events and capture idle, accepted, rejected, processing, success,
failure, narrow-panel, light, dark, and reduced-motion states.
