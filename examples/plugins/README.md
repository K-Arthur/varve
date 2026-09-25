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
packages to ignored `examples/plugins/dist/`. Each `.varveplugin` contains only
`manifest.json` and `module.wasm`. Run
`node examples/plugins/build.mjs --package-only` to repeat packaging and the
ABI smoke test without recompiling.
Cargo's locked dependencies are in this directory's `Cargo.lock`.
Run `node --experimental-strip-types scripts/plugins/validate.mjs examples/plugins/dist/style-audit.varveplugin`
from the repository root for a static package/manifest/import check. The
validator does not execute the guest; installation compiles the module in a
short-lived worker without instantiating it. Guest execution begins only when
the user runs a command.
For a local development loop, rebuild, choose the newer-version package in
the manager, review its changed permissions, and use the manager's Stop,
Disable, and Restore actions. The file picker is explicit; there is no folder
watcher or automatic execution after editing a source file. Update the
manifest version before replacing an installed copy.

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
has `id`, `expectedName`, and `name`. The guest exports `alloc(length)`,
`run(pointer, length)`, and `result_len()`. Only the host can mutate artwork.
