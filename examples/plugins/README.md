# Executable plugin examples

These two local packages demonstrate the public Varve API v1. The guests are
Rust WebAssembly modules with one imported, bounded `env.memory`; they do not
import WASI, JavaScript functions, Tauri, or editor implementation files.
Both examples depend on the sibling `varve-plugin-sdk` Rust crate for the
versioned JSON input, selected-layer snapshot, and result types. A new guest
can depend on that crate by path while developing. The crate defines data
types, not an ambient bridge: only the host can read the document or apply an
edit. API v1 compatibility is exact; unsupported API versions are rejected at
installation rather than guessed from a package name.

From the repository root, with Rust's `wasm32-unknown-unknown` target installed:

```sh
node examples/plugins/build.mjs
```

The builder compiles both guests, checks their actual memory imports and ABI
with a mixed frame/text/image selection, then writes reproducible stored ZIP
packages to ignored `examples/plugins/dist/`. Each `.varveplugin` contains
`manifest.json`, `module.wasm`, and optional `thumbnail.png`. The manifest's
`description` is plain text; `thumbnail` names the fixed PNG path and provides
alternative text for the manager. Use a static PNG no larger than 512×512
pixels or 256 KiB. The artwork is presentation metadata and does not identify
or verify its publisher. Run
`node examples/plugins/build.mjs --package-only` to repeat packaging and the
ABI smoke test without recompiling. Cargo's locked dependencies are in this
directory's `Cargo.lock`; the data-only Rust SDK is in `examples/plugins/sdk/`.

## Manifest and compatibility contract

Use the checked-in `style-audit/manifest.json` and
`batch-rename/manifest.json` as complete examples. A v1 manifest has required
`schemaVersion: 1`, reverse-domain lowercase `id`, `name`, self-asserted
`publisher`, semantic `version`, `apiVersion: 1`, and `entry: "module.wasm"`
fields. `description` is optional plain text up to 280 characters. Optional
`thumbnail: { "path": "thumbnail.png", "alt": "..." }` adds one static
package image; remote URLs, SVG, animation, and other asset paths are rejected.
`permissions` has `required` and `optional` arrays using only
`selection.read` and `document.write`; every command receives a selection, so
declare `selection.read` in one of those arrays. A rename command also requires
`document.write`. Declare 1–8 `commands` of kind `analysis` or `rename`; an
optional `inspector` list can contain up to eight host-rendered Properties
sections linked to a declared command, optionally limited to the six current
workspace modes: `design`, `print`, `drawing`, `image`, `motion`, and `email`.
For older manifests, `logo` and `codegen` are accepted as compatibility inputs
and normalized to `design`. Unknown fields, duplicate IDs/permissions,
unsupported versions, and undeclared selection access are rejected.

Compatibility is exact: the host accepts API v1 only. Guests target
`wasm32-unknown-unknown`, import only `env.memory`, and export only these
functions: `alloc(i32) -> i32`, `run(i32, i32) -> i32`, and
`result_len() -> i32`. They return bounded UTF-8 JSON. Packages are limited to
2 MiB, the manifest to 32 KiB, and the module to 1 MiB. GC/reference-valued Wasm
function types are unsupported. The static validator checks the package
contract; the builder's ABI smoke test checks that the sample guest runs with
mixed vector/text/image selection data.

## Development loop

1. Edit guest code and manifest; bump `version` whenever replacing an installed
   package.
2. From the repository root, run `node examples/plugins/build.mjs` to compile,
   run the ABI smoke test, and produce both reproducible archives. For a
   packaging-only rerun, use `node examples/plugins/build.mjs --package-only`.
3. Run `node --experimental-strip-types scripts/plugins/validate.mjs
   examples/plugins/dist/style-audit.varveplugin` and repeat for
   `batch-rename.varveplugin`. The validator does not execute the guest.
4. Inspect the manifest diff and archive contents, then choose the package
   explicitly in Settings → Plugins. Review requested access and checksum
   before installing or updating; test first with noncritical artwork.
5. Use Stop, Disable, Retry, and Restore from the manager. Confirm reviewed
   edits can be undone and remain ordinary document content after removal.

There is no folder watcher, live reload, same-version replacement, automatic
execution after editing, remote catalog, or automatic update feed. Each update
is a deliberate file selection, higher-version package, and fresh permission
review. The publisher label and checksum identify displayed bytes but do not
authenticate the author. Installation compiles a module without instantiating
it; guest code starts only when the user explicitly runs a command.

Install either file through Varve's local package picker. Installation does not
run its command. Grant `selection.read` to run **Selection Style Readiness**;
its Inspector section summarizes selected opacity, blend modes, paint and
stroke counts, and font family/size for selected text. It identifies mixed
values across the selection, along with locks and naming issues. API v1 does
not expose fill/stroke colors or computed styles, so the example makes no
claim about those. It never proposes edits. **Number Selected Layers** previews
numbered names for unlocked selected layers. Its optional `document.write`
permission is needed to run the rename command and apply the preview. Varve
checks the document and names again before one undoable commit. Repeating the
command replaces existing number prefixes instead of stacking them.

Guest input is UTF-8 JSON with `apiVersion`, `commandId`, `documentId`,
`revision`, and `selection` entries containing `id`, `name`, `kind`, `locked`,
and a bounded `style` object with `opacity`, `blendMode`, `paintCount`,
`strokeCount`, and optional text `fontFamily` and `fontSize`. Output is JSON
with `summary`, `lines`, and `renames`; every rename
has `id`, `expectedName`, and `name`. The guest exports the numeric functions
above. Their parameters and return values are signed Wasm `i32`s: `alloc`
returns a guest-memory pointer, `run` receives that pointer and a byte length
and returns a result pointer, and `result_len` returns the result byte length.
Only the host can mutate artwork.
