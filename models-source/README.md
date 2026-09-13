# Model source files (not shipped)

These are the large ONNX models Varve downloads **on demand** rather than
bundling. They live here, outside `apps/desktop/public/`, because everything in
`public/` is copied into `dist/` by Vite and embedded in the installer — which
is how `ddcolor.onnx` alone nearly added a gigabyte to every download.

The current checkout intentionally contains no ONNX objects or Git LFS
pointers for these models. The table below records the intended artifact
route, not a verification result. A model is not advertised as ready until
the downloaded bytes pass the catalog SHA-256 check and an ONNX Runtime
smoke test in the supported worker.

| File | Real size | Feature | Distributed via |
|---|---|---|---|
| `ddcolor.onnx` | expected ~980 MB | AI Colorize (photo) | GitHub release `models-v1` (target; asset returned 404 on 2026-09-13) |
| `ddcolor-tiny.onnx` | expected ~220 MB | AI Colorize (fast preview) | GitHub release `models-v1` (target; asset returned 404 on 2026-09-13) |
| `font-classify.onnx` | 64 MB | Font identification | HuggingFace (upstream) |

`font-classify.onnx` is kept here only as a provenance record — the app
downloads it from its upstream HuggingFace source, which is already pinned to
the same SHA-256 in the model catalog. The two `ddcolor` models are custom ONNX
exports with no upstream URL, so **we** have to host them.

## Publishing the ddcolor models

Required before the AI photo lane can be marked ready. Uploads to a dedicated
`models-v1` release so model assets are versioned independently of app releases
and are never re-uploaded on an app release.

```sh
node scripts/release/publish-model-assets.mjs --dry-run   # check hashes first
node scripts/release/publish-model-assets.mjs             # needs gh auth and verified local artifacts
```

The script verifies each file's SHA-256 against the model catalog **before**
uploading. It refuses to run when the expected artifacts are absent, so a
missing or corrupt checkout cannot become a published asset that every client
then rejects.

## Why a separate release tag

GitHub release assets have unmetered download bandwidth and a 2 GB per-file
limit. Using a fixed
`models-v1` tag means:

- app releases stay small and fast to publish;
- model URLs never change when the app version does;
- a model can be revised by cutting `models-v2` without touching app history.

Changing a model's bytes **requires** a new tag and a new pinned SHA-256 in both
`packages/engine/src/inference/modelCatalog.ts` and
`apps/desktop/public/models/manifest.json`. Overwriting an asset in place would
break checksum verification for every existing install.
