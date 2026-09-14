# Mockup Editing & Creation — Audit, Research, and Improvement Plan (2026-09-13)

Status: completed for the supported scope (2026-09-13). Remaining limits are
explicitly unsupported/deferred below. Scope: improve the existing mockup
system in place (no new workspace, route, mode, or parallel document model).

Canonical architecture: `docs/architecture/mockup-system.md`, ADR-0015.
Prior audits: `docs/audits/mockup-capability-audit-2026-08-05.md`,
`docs/audits/mockup-vertical-slice-report-2026-08-05.md`.

## 1. Research record

Primary sources consulted (accessed 2026-09-13):

| Source | Version / status | Finding that shaped a decision |
|---|---|---|
| [Adobe Illustrator — Create mockups for images](https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/create-mockups-for-images.html) | Live official help, accessed 2026-09-13 (crawler access was inconsistent) | Replaceable-surface workflow: place art, transform once, replace content non-destructively. |
| [Adobe — Edit mockups](https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/edit-mockups.html) and [Photoshop linked smart objects](https://www.adobe.com/learn/photoshop/web/photoshop-linked-smart-objects) | Live official help, accessed 2026-09-13 | Replacement inherits the existing transform; transforms do not compound across replacements. |
| [OpenCV — Geometric Image Transformations](https://docs.opencv.org/4.13.0/da/d54/group__imgproc__transform.html) | 4.13.0 docs, accessed 2026-09-13; `warpPerspective`/`getPerspectiveTransform`/`remap` | Mapping is destination→source (inverse), so our per-pixel inverse homography is the correct family; border handling must be explicit (`BORDER_TRANSPARENT` leaves destination untouched). |
| [W3C Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/) | CR Draft 2024-03-21, accessed 2026-09-13 | Order is filter → clip/mask → blend/composite; masks/blending/filters create isolated groups; coverage is applied exactly once. Drives surface composition order. |
| [W3C Filter Effects Level 1](https://www.w3.org/TR/filter-effects-1/) | Recommendation-track specification, accessed 2026-09-13 | Feather/blur are filters applied before compositing; radii must be bounded. |
| [W3C SVG 2](https://www.w3.org/TR/SVG2/) | Recommendation-track specification, accessed 2026-09-13 | `mix-blend-mode`/`isolation`/`<image>` semantics support export honesty: a rasterized surface in SVG is a bitmap, not a live projective mapping. |
| [ag-psd](https://github.com/Agamnentzar/ag-psd) upstream README | master, accessed 2026-09-13 | Explicit limitations: no PSB, no 16-bit, no CMYK/Multichannel/Lab, limited pattern support, incomplete text, smart-filter coverage partial. Must not be presented as a Photoshop renderer. |
| [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/) and [web large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html) | Official docs, accessed 2026-09-13 | WASM fallback is the portable path; provider availability is runtime-specific. No new model is required for deterministic mockup placement. |
| Installed repo dependencies | `packages/import` uses `@webtoon/psd`; `packages/import`/`editor` use `fflate`; inference uses `onnxruntime-web`/native | Verified before deciding; no new dependency added. |

The following community reports were used as anecdotal failure-mode evidence,
not as specifications or prevalence measurements: [Photoshop smart-object
replacement/warp](https://www.reddit.com/r/PhotoshopRequest/comments/1ett2h1),
[confusing smart-object setup](https://www.reddit.com/r/graphic_design/comments/1igg1yz),
[multi-face source tradeoffs](https://www.reddit.com/r/photoshop/comments/140xr35),
[perspective-warp crashes](https://community.adobe.com/questions-712/perspective-warp-and-smart-objects-in-photoshop-cc-1149554),
[cylinder-wrap mismatch](https://www.reddit.com/r/graphic_design/comments/1mx9bd2),
[Canva warp accuracy concerns](https://www.reddit.com/r/canva/comments/1jzc95),
[blurry product output](https://www.reddit.com/r/printful/comments/lrhpe7), and
[flattened Placeit downloads](https://help.placeit.net/hc/en-us/articles/37882558377369-Am-I-going-to-be-able-to-edit-my-mockup-after-I-complete-the-download).
They shaped bounded fit policies, explicit source modes, stable slot identity,
honest flattening, output-scale capture, and a deliberately limited cylinder
slice. Reddit/community observations can be deleted, edited, or biased; exact
URLs and access date are retained so this uncertainty is visible.

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
| 3 | Export the mockup as PNG/JPG/WebP | Existing export E2E decodes plate/background pixels; `mockupExport.ts` is called by raster export | Previously the export route bypassed decoration | editor export | **Verified** |
| 4 | Export to PDF | PDF rasterization shares the export decoration boundary; unit coverage checks missing-source/export policy | Previously shared the same bypass as #3 | editor export | **Verified for rasterized PDF boundary** |
| 5 | Quad (perspective) mockup on a worker-eligible document | structural-routing branch is covered; quad renderer uses DOM canvas APIs and focused warp tests pass | Worker replay was an invalid host for DOM-dependent baking | editor render | **Verified; structural path** |
| 6 | Cache correctness after moving/resizing a mockup or a surface override | geometry key includes frame size, quad/rect, fit/alignment, masks, cylinder, and placement | Previous key omitted frame/override geometry | editor render | **Verified** |
| 7 | Rotation/flip overrides | `effectiveSurface`/placement path and inspector controls are rendered in focused IR tests | Validated fields were previously ignored | editor render | **Verified** |
| 8 | `backgroundColor`, overlay `blendMode`, `dark` | background and overlay items are emitted; dark remains a template decoration flag | Declared fields previously had no renderer consumer | editor render | **Verified for background/overlay; dark is descriptive** |
| 9 | Snapshot capture (embedded snapshot binding) | Inspector Snapshot action and capture tests; assets remain embedded | UI/action path was missing | editor mockup | **Verified** |
| 10 | Detach / flatten | Inspector Flatten to image action uses canonical export decoration and one transaction | UI + flatten op were missing | editor mockup | **Verified** |
| 11 | Replace/swap source for any surface | Selected surface inspector + canvas chip targets a stable surface id; replacement preserves overrides | Previous action always targeted the first surface | editor inspector | **Verified** |
| 12 | Delete a bound source | source binding is retained, inspector says Missing source, canvas may show labelled last-good preview, export uses a placeholder/warning | Previous cleanup pruned or hid required references | scene assets/document-nodes | **Verified recovery semantics** |
| 13 | Author a template from a photo (base plate, clip, occluder) | Create from selection, mask-from-selection, embedded plate/mask assets, and authoring E2E | Reserved fields had no complete path | scene + editor | **Verified for alpha masks** |
| 14 | Save/reuse a user template | document-embedded library templates plus bounded `.varve-mockup.json` import/export | JSON helper was previously unreachable | editor mockup | **Verified** |
| 15 | Multi-surface linked/independent duplication, template replace with slot remap | business-card E2E, linked/independent actions, stable source-slot remap tests | Ops/UI were incomplete | scene + editor | **Verified** |
| 16 | Batch variants export | `MockupVariantsPanel` uses existing raster export service with bounded sequential jobs, deterministic names, collision suffixes, progress/cancel | No runner existed | editor export | **Verified in unit/export path; browser destination is download** |
| 17 | Curved (cylindrical) surface | schema 2, `warpImageToCylinder`, inspector controls, renderer/export tests, production E2E | No bounded mapping existed | engine + scene + editor | **Verified bounded front-facing arc** |
| 18 | Background/photographic plate render | plate image is an embedded asset drawn beneath surfaces; authoring uses untouched source | No raster plate field/path existed | scene + editor | **Verified** |
| 19 | Thumbnails / Home covers for mockup frames | canvas and export are decorated; Home thumbnail parity remains untested | Thumbnail pipeline has no dedicated mockup decoration contract | editor thumbnails | **Deferred / not claimed** |
| 20 | Worker/partial-redraw with mockup live sources offscreen | mockup documents force structural compositing; focused E2E exercises live updates | Source capture cannot safely be absent from a worker frame | editor render | **Verified structural fallback; oracle still required for future reuse changes** |

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

Implemented for this session: the 16-template subject catalog, bounded
front-facing cylindrical surfaces, production subject filters, output-footprint
source capture, and narrow-inspector cylinder control reflow. Still deferred
with explicit rejection: mesh surfaces, calibrated displacement maps,
luminance mask coverage, PSD smart-object replacement, model-assisted surface
proposals, and Home-thumbnail mockup decoration.

## 6. Validation log (2026-09-13)

| Check | Command | Result |
|---|---|---|
| Scene mockup suite | `pnpm vitest run packages/scene/src/mockup/__tests__/mockup.test.ts` | 23/23 pass |
| Editor surface decoration | `pnpm vitest run packages/editor/src/render/mockup/__tests__/mockupIr.test.ts` | 10/10 pass |
| Export decoration | `packages/editor/src/render/mockup/__tests__/mockupExport.test.ts` | 2/2 pass |
| Template bundles | `packages/editor/src/mockup/mockupTemplatePackage.test.ts` | 4/4 pass |
| Inspector RTL | `packages/editor/src/components/Inspector/sections/MockupsSection.test.tsx` | 4/4 pass |
| Panel RTL | `packages/editor/src/components/Mockups/MockupsPanel.test.tsx` | 6/6 pass |
| Focused mockup regression set | scene, engine, editor, package, panel, inspector, and action tests | 9 files / 83 tests pass |
| E2E typecheck (clean baseline) | `pnpm typecheck:e2e` | pass before the later concurrent master changes; retained as baseline evidence |
| Format/lint | `pnpm biome check` on all touched files | pass |
| Docs audit | `pnpm audit:docs` | clean; no documentation drift or broken-link violations |
| Emoji audit | `pnpm audit:emoji` | clean; no emoji violations |
| Token audit | `pnpm audit:tokens` | 153/153 across 3 themes |
| Scene typecheck | `pnpm exec tsc -p packages/scene/tsconfig.json --noEmit` | only a pre-existing unrelated test error |
| Editor typecheck | `pnpm exec tsc -p packages/editor/tsconfig.json --noEmit` | 23 errors, all in unrelated in-flight files; zero in mockup/touched files |
| Browser E2E | `tests/e2e/canvas/mockups.spec.ts` on a production build (`vite build` + `vite preview`, port 1453) | 6/6 pass in 1.4 min: full workflow (apply/link/update/save-reopen/export/replace/remove/undo-redo), multi-surface business card, export composition (decoded PNG contains 162 283 template-background px and 22 949 phone-plate px across 85 quantized colours), overlay drag + one-step undo (x 300 → 364 → 300), missing-source reporting after deleting the bound source, template authoring from selection. Zero console/page errors. Artifacts: `reports/mockup-review/` (`export-phone-mockup.png` inspected: bezel, screen with fitted source, shadow, template background). |
| Production subject/cylinder E2E | `VARVE_E2E_PORT=1487 VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/canvas/mockup-production-workflows.spec.ts --project=chromium --workers=1 --reporter=line` | pass in 2.9 min: editable text source, Apparel/Signage/Stationery/Packaging filters, cylinder axis/arc/crop controls, real PNG download. Artifact files were written to `reports/mockup-review-2026-09-13/` and inspected. |
| Production subject/cylinder E2E rerun after source-capture/UI hardening | `VARVE_E2E_PORT=1488 VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/canvas/mockup-production-workflows.spec.ts --project=chromium --workers=1 --reporter=line` | blocked before app startup by unrelated in-flight `ColorizeSection.tsx` parse failure and `groupEffectStages.ts` export mismatch; no mockup assertion ran. |
| Clean committed-tree browser probe | temporary sparse archive of the committed `master` tree; Chromium, port 1491 | passed the catalog filters, cylinder controls, and real Export dialog; the harness then timed out waiting for a browser download after clicking Export. The screenshot shows a single `873x600` cylinder export job; no mockup assertion failed. |

The clean committed-tree probe needed two unrelated, uncommitted repairs from
the shared worktree (`shared/presetRegistry.ts` and `components/Shell/index.ts`)
to boot the current master snapshot; those files were copied only into the
temporary archive and were not included in this work. The remaining download
timeout is therefore recorded as an export-harness/platform boundary, not as
proof that the cylinder compositor failed. The passing production run above
is the independent end-to-end evidence for the real browser download path.

Observed unrelated defect (handoff, not introduced here): a real
right-click on the canvas currently targets the tool-hint overlay
(`.micro-hint`, pointer-events: auto) that floats over the canvas, so the
canvas context-menu handler never receives the event (a synthetic
`contextmenu` dispatched on the canvas opens the menu correctly). The E2E
drives Resources → Mockups and the Object/panel paths instead; the hint
overlay's pointer behavior should be fixed by its owner.

Perf note: the protected replay hot path (`replaySubtreeToCtx`, `replayIr`)
was not restructured. Changes are (a) a per-document boolean scan in
`sceneNeedsStructuralCompositing` (memoized by document reference), (b) a
document-id guard in the mockup decoration block, and (c) export-only
decoration. No per-node-per-frame dispatch changed.
