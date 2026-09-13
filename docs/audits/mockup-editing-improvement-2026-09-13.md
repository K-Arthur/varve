# Mockup Editing & Creation — Audit, Research, and Improvement Plan (2026-09-13)

Status: active. Scope: improve the existing Level 1–2 mockup system in place
(no new workspace, route, mode, or parallel document model).

Canonical architecture: `docs/architecture/mockup-system.md`, ADR-0015.
Prior audits: `docs/audits/mockup-capability-audit-2026-08-05.md`,
`docs/audits/mockup-vertical-slice-report-2026-08-05.md`.

## 1. Research record

Primary sources consulted (accessed 2026-09-13):

| Source | Version / status | Finding that shaped a decision |
|---|---|---|
| Adobe Illustrator — Create mockups for images | Live help page (403 on fetch; workflow documented from Figma/Photoshop references and the repo's own audit) | Replaceable-surface workflow: place art, transform once, replace content non-destructively. |
| Adobe — Photoshop linked/embedded smart objects | Live help page | Replacement inherits the existing transform; transforms do not compound across replacements. |
| OpenCV — Geometric Image Transformations | 4.13.0 docs, `warpPerspective`/`getPerspectiveTransform`/`remap` | Mapping is destination→source (inverse), so our per-pixel inverse homography is the correct family; border handling must be explicit (`BORDER_TRANSPARENT` = leave destination untouched). |
| W3C Compositing and Blending Level 1 | CR Draft 2024-03-21 | Order is filter → clip/mask → blend/composite; masks/blending/filters create isolated groups; coverage is applied exactly once. Drives surface composition order. |
| W3C Filter Effects Level 1 | Recommendation-track spec | Feather/blur are filters applied before compositing; bounded radii. |
| W3C SVG 2 | Recommendation-track spec | `mix-blend-mode`/`isolation`/`<image>` semantics for SVG export honesty: a rasterized surface in SVG is a bitmap, not a live projective mapping. |
| ag-psd (upstream repo + README) | master, read 2026-09-13 | Explicit limitations: no PSB, no 16-bit, no CMYK/Multichannel/Lab, limited pattern support, incomplete text, smart-filter coverage partial. Must not be presented as a Photoshop renderer. |
| ONNX Runtime — execution providers / large models | Official docs | WASM fallback is the portable path; WebKitGTK lacks WebGL EP; native providers are separate. No new model is required for this task. |
| Installed repo dependencies | `packages/import` uses `@webtoon/psd`; `packages/import`/`editor` use `fflate`; inference uses `onnxruntime-web`/native | Verified before deciding; no new dependency added. |

Community failure modes (what users complain about in existing tools) and
how this work responds:

| Reported failure | Root cause in other tools | Response here |
|---|---|---|
| Replaced art is squashed (“50% of mockups are messed up”) | Template implicitly stretches source; no fit policy, no aspect preservation | Explicit `contain/cover/stretch/native` + alignment; replacement preserves chosen fit and surface geometry; `stretch` is never the default. |
| Art lands in a random spot after replacement | Transform lives in the template layer, replacement replaces the whole slot | Surface geometry/preview live in the template; content fit is separate (`fitRect`); overrides are scoped per surface. |
| Design changes break curvature/displacement silently | Displacement maps are separated from the rendered flat preview; web tools ignore them | Curved/displacement capabilities stay explicit and reject as reserved until a complete data→UI→render→save→export path exists; no false “3D” labels. |
| Rotating the source touches the whole scene | Smart-object canvas edits flow into the parent transform | Source edits are ordinary document edits; mockup frames only read the source subtree (digest-invalidated) and never mutate it. |
| Rounded/soft edges and occluders lost | Mask assets not packaged with the template | Templates carry clip/occluder raster masks; the plate image stays untouched. |
| Deeply nested smart objects break web renderers | Tools resolve only the outermost object | Our links are a direct node reference; ancestor/self/indirect cycles are rejected, and depth is irrelevant. |
| Linked external files silently vanish | No offline policy | Mockup bindings are embedded live-node references or embedded snapshots; no external-file link is simulated. |
| Exports look soft | Preview raster upscaled to output | Export re-bakes sources at output scale with its own cache bucket (`qualityScale`), never upscales preview pixels. |

## 2. Current-state audit (verified against the working tree)

Reproduction method: code trace + the existing E2E spec + targeted unit
tests. Capability classifications:

| # | User task | Evidence | Root cause | Owner | Status |
|---|---|---|---|---|---|
| 1 | Apply a mockup and see it on canvas | `tests/e2e/canvas/mockups.spec.ts` passes; flat surfaces bake through `decorateMockupIr` | — | editor `render/mockup/mockupIr.ts` | Verified |
| 2 | Edit the linked source and see the mockup update | digest-keyed cache; E2E nudge step | — | scene `computeMockupSourceDigest` | Verified |
| 3 | Export the mockup as PNG/JPG/WebP | `exportNodeAsRaster` (`components/SpecPanel/export.ts:173`) never calls `decorateMockupIr` | Export path bypasses decoration; only the flatten-boundary route decorates | editor export | **Incorrect** (exports frame gray rect) |
| 4 | Export to PDF | browser/native paths rasterize via `exportNodeAsRaster` | same as #3 | editor export | **Incorrect** |
| 5 | Quad (perspective) mockup on a worker-eligible document | `paintWarpedImage` calls `document.createElement` (`mockup/warpReplay.ts:254,274`); `sceneNeedsStructuralCompositing` has no mockup branch (`render/sceneCompositing.ts:18-59`) | Worker replays quad warp, throws, permanently disables worker | editor render | **Incorrect** (hard crash path) |
| 6 | Cache correctness after moving/resizing a mockup or a surface override | cache key omits frame `w/h` and override geometry (`mockupIr.ts:632`) | stale surface rasters drawn at new geometry | editor render | **Incorrect** |
| 7 | Rotation/flip overrides | validated (`scene/mockup/validate.ts:458`), ignored by `effectiveSurface` | no renderer support | editor render | **Unreachable** |
| 8 | `backgroundColor`, overlay `blendMode`, `dark` | declared in schema, never read by renderer | no renderer support | editor render | **Unreachable** |
| 9 | Snapshot capture (embedded snapshot binding) | `bindingForSource` can create snapshots, no capture action | UI missing | editor mockup | **Unreachable** |
| 10 | Detach / flatten | `markMockupDetached` exists; no caller | UI + flatten op missing | editor mockup | **Unreachable** |
| 11 | Replace/swap source for any surface | inspector replaces the first surface only; `replaceSource` uses selection excluding frame | per-surface targeting missing | editor inspector | **Partially integrated** |
| 12 | Delete a bound source | `removeNode` does not clear live bindings; `isAssetReferenced` ignores snapshot bindings | dangling live binding + snapshot asset pruned on load | scene assets/document-nodes | **Incorrect** (data loss) |
| 13 | Author a template from a photo (base plate, clip, occluder) | reserved `clipMaskAssetId`/`occlusionMaskAssetId` rejected; no plate image, no authoring UI | never implemented | scene + editor | **Unsupported** (reserved) |
| 14 | Save/reuse a user template | template JSON helper exists (`buildTemplateFromJson`), no import/export UI or storage | wiring missing | editor mockup | **Unreachable** |
| 15 | Multi-surface linked/independent duplication, template replace with slot remap | `setMockupTemplate` exists (clears overrides, no slot mapping); no duplicate UI | ops + UI missing | scene + editor | **Partially integrated** |
| 16 | Batch variants export | documented deferred (`mockup-system.md:199`); no runner | not implemented | editor export | **Unsupported** |
| 17 | Curved (cylindrical) surface | `'cylindrical'` reserved and rejected by validator | not implemented | engine + scene | **Unsupported** (reserved) |
| 18 | Background/photographic plate render | no raster plate field | not implemented | scene + editor | **Unsupported** |
| 19 | Thumbnails / Home covers for mockup frames | thumbnail pipeline has no mockup decoration | same class as #3 | editor thumbnails | **Incorrect** |
| 20 | Worker/partial-redraw with mockup live sources offscreen | no mockup-aware dirty/culling | source IR absent on partial frames | editor render | **Incorrect** (mitigated by #5 fix) |

Documentation discrepancies found and corrected by this work:

- `mockup-system.md` claims `sceneNeedsStructuralCompositing` returns true
  for mockups; the code does not (fixed).
- `mockup-system.md` claims user templates are “stored through the
  app-settings KV substrate”; no such storage exists (templates live in
  `Document.mockupTemplates`, now with explicit export/import).
- The vertical-slice report claims `removeNode`/`isAssetReferenced` cover
  snapshot bindings; they do not (fixed).
- The slice report lists quad-corner canvas overlay handles as deferred;
  the inspector already advertises them (fixed: overlay added).

## 3. Implementation plan

Dependency-ordered slices, each leaving a working workflow:

1. **Correctness core** — export parity for raster (and therefore PDF),
   worker/structural routing for mockups, cache identity, ignore-free
   overrides (rotation/flip/backgroundColor/overlay blend), asset-GC and
   dangling-binding repair, stale last-good preview for deleted sources
   (preview only; export warns and never silently reuses stale pixels).
2. **Surface editing workflow** — canvas surface selection + handles,
   per-surface inspector (geometry, fit, alignment, rotation, flip,
   shadow/glow, replace/reconnect/snapshot/clear), flatten-to-image
   detach, source editing shortcut, drop-to-replace.
3. **Photographic templates** — raster base plate + clip/occlusion mask
   assets with explicit channel/invert/feather semantics, authoring from a
   selected photo/scene node, mask from selection, template JSON
   import/export with bounded assets, persistence/closure/GC.
4. **Multi-surface reuse** — slot-identity template replacement, duplicate
   linked/independent, make-unique, batch variant export through the
   existing export service.
5. **Curved surface slice** — bounded cylindrical mapping exposed only
   with a complete data→UI→render→save→export path and explicit
   limitations.
6. **Docs/website/E2E/visual evidence** accompany every slice.

## 4. Acceptance criteria

- Selecting a mockup frame and exporting PNG produces the composed mockup
  (plate + fitted source + masks + overlays), not the frame background.
- A quad mockup never crashes or disables the render worker.
- Moving/resizing a mockup or editing surface geometry never draws a stale
  raster.
- Deleting a bound source keeps the surface usable: last-good preview in
  the editor, explicit missing-source state, export warning, no silent
  stale pixels.
- Replacing artwork on any surface preserves that surface's geometry,
  fit, mask and appearance.
- A photo can become a reusable document-embedded template with one or
  more surfaces, a clip mask and a foreground occluder; the template can
  be exported, re-imported, and reused with unrelated artwork.
- Save/reopen preserves templates, bindings, overrides, plate assets and
  mask assets; no resource is pruned or leaked.
- All new UI is keyboard reachable, labelled, theme-token styled, and
  works in narrow panels.
- Validation evidence: affected unit tests, focused E2E, inspected
  screenshots, and independent export inspection.

## 5. Implementation status (updated as work lands)

Landed in `fix(mockup): render mockups in raster exports, route worker safely,
honor overrides` (commit 4b7fdd7e5):

- Export parity: raster (and therefore PDF rasterization) exports decorate
  mockups through the shared `mockupExport.ts`; stale previews are disabled
  for export and missing surfaces are warnings.
- Worker safety: mockup frames force structural compositing.
- Cache identity: frame size, geometry, rotation/flip and mask settings are
  part of the key; per-document cache identity avoids cross-document reuse.
- Instance overrides now render (rotation/flip), plus `backgroundColor` and
  overlay blend modes.
- Export surface bake scales with output instead of upscaling previews.
- Missing live sources keep a labelled last-good preview on canvas.
- Scene schema: `plateImage`, alpha clip/occlusion masks, `maskOptions`,
  library templates; validation, normalization and asset retention updated.

Landed in the surface-editing slice:

- Canvas surface overlay (chips + rect/quad handles, per-gesture transactions,
  Escape abort, Reset).
- Inspector: per-surface source actions (Replace, Edit source, Snapshot,
  Reconnect, Clear), placement/appearance/geometry controls, mask authoring
  from selection, surface rename/reorder/remove, template replacement with
  slot-identity remap and unbound reporting, duplicate linked/independent,
  flatten-to-image.
- Template authoring from selection; portable `.varve-mockup.json` bundles
  with bounded import validation; library templates retained across reloads;
  instance edits auto-scope to a private template copy.

Still deferred with explicit rejection: mesh surfaces, cylindrical surfaces,
displacement maps, luminance mask coverage, PSD smart-object replacement, and
model-assisted surface proposals.
