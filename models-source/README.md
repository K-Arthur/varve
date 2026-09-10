# Model source files (not shipped)

These are the large ONNX models Varve downloads **on demand** rather than
bundling. They live here, outside `apps/desktop/public/`, because everything in
`public/` is copied into `dist/` by Vite and embedded in the installer — which
is how `ddcolor.onnx` alone nearly added a gigabyte to every download.

They are Git LFS objects. `git clone` gives you 133-byte pointer files; run
`git lfs pull` to get the real content.

| File | Real size | Feature | Distributed via |
|---|---|---|---|
| `ddcolor.onnx` | 980 MB | AI Colorize (photo-realistic) | GitHub release `models-v1` |
| `ddcolor-tiny.onnx` | 220 MB | AI Colorize (fast preview) | GitHub release `models-v1` |
| `font-classify.onnx` | 64 MB | Font identification | HuggingFace (upstream) |

`font-classify.onnx` is kept here only as a provenance record — the app
downloads it from its upstream HuggingFace source, which is already pinned to
the same SHA-256 in the model catalog. The two `ddcolor` models are custom ONNX
exports with no upstream URL, so **we** have to host them.

## Publishing the ddcolor models

Required once, before colorization works for any user. Uploads to a dedicated
`models-v1` release so model assets are versioned independently of app releases
and are never re-uploaded on an app release.

```sh
git lfs pull --include="models-source/*.onnx"
node scripts/release/publish-model-assets.mjs --dry-run   # check hashes first
node scripts/release/publish-model-assets.mjs             # needs gh auth
```

The script verifies each file's SHA-256 against the model catalog **before**
uploading, so a corrupt LFS checkout cannot become a published asset that every
client then rejects.

## Why a separate release tag

GitHub release assets have unmetered download bandwidth, a 2 GB per-file limit,
and do not consume the 10 GB/month Git LFS bandwidth allowance. Using a fixed
`models-v1` tag means:

- app releases stay small and fast to publish;
- model URLs never change when the app version does;
- a model can be revised by cutting `models-v2` without touching app history.

Changing a model's bytes **requires** a new tag and a new pinned SHA-256 in both
`packages/engine/src/inference/modelCatalog.ts` and
`apps/desktop/public/models/manifest.json`. Overwriting an asset in place would
break checksum verification for every existing install.
