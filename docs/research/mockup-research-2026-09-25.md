# Mockup / Smart-Object System Research — 2026-09-25

Scope: research to support improving Varve's mockup editing/creation system (placing
artwork onto photo/quad surfaces with projective warps, template authoring, source
bindings, smart-object-like replacement).

All sources accessed **2026-09-25** unless noted. Source type is labeled explicitly:
**spec** (normative standard), **draft spec**, **implemented API docs**, **vendor docs**,
**forum/UX evidence** (user reports, may be stale), **tutorial/secondary**, **marketing**.
Nothing below is treated as a capability claim unless a primary document states it.

---

## 1. Sources table

| # | URL | Accessed | Type / version | Key findings (one line) |
|---|-----|----------|----------------|--------------------------|
| 1 | https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/create-mockups-for-images.html | 2026-09-25 | Vendor doc (page published 2025-10-27). **Direct fetch 403; content obtained via search index of the same URL** | Illustrator mockup workflow: select vector art + image together, Create Mockup, drag to reposition, deselect to fix, "Edit Content" to re-enter |
| 2 | https://www.adobe.com/learn/photoshop/web/photoshop-linked-smart-objects | 2026-09-25 | Vendor tutorial (page dated 2026-08-07). **Direct fetch returned JS shell only; title/structure via search index; behaviors verified on sibling helpx pages (see 2a–2c)** | Linked Smart Objects: auto-update while open, stale-marker + "Update Modified Content" when reopened, relink for missing files, embed for portability |
| 2a | https://helpx.adobe.com/photoshop/desktop/create-manage-layers/smart-objects/update-linked-smart-objects.html | 2026-09-25 | Vendor doc (2026-02-23) | "Photoshop only checks the file directly linked to the Smart Object. A linked file won't update automatically if nested inside another Smart Object." |
| 2b | https://helpx.adobe.com/photoshop/desktop/create-manage-layers/smart-objects/embed-linked-smart-objects.html | 2026-09-25 | Vendor doc (2025-10-27) | Embed Linked / Embed All Linked makes document self-contained; link icon disappears |
| 2c | https://developer.adobe.com/firefly-services/docs/photoshop/guides/photoshop-v2/v1-to-v2/guides-v2/smart-object-workflow | 2026-09-25 | Implemented API docs (Adobe Photoshop API) | PSD manifest exposes smart object `transform` as **4 corner pairs**, `isLinked`, relative `path`; server-created linked SOs produce "missing file" prompts locally (documented as expected) |
| 3 | https://docs.opencv.org/4.x/da/d54/group__imgproc__transform.html | 2026-09-25 | Implemented API docs (serves OpenCV 4.13.0) | Reverse (dst→src) mapping, `getPerspectiveTransform` 4-point solve, interpolation/border flags, `INTER_AREA` moiré-free decimation, `warpPerspective` restricts flags |
| 4 | https://www.w3.org/TR/compositing-1/ | 2026-09-25 | **Candidate Recommendation Draft, 21 March 2024** | Porter-Duff operators (source-over etc.), 17 blend modes, isolation/group rules, "blending calculations must not use pre-multiplied color values", premultiplied `co` for source-over |
| 5 | https://www.w3.org/TR/filter-effects-1/ | 2026-09-25 | **Working Draft, 18 December 2018** (not a Recommendation) | Filter region defaults `-10%/-10%/120%/120%`; `color-interpolation-filters` initial value **linearRGB**; filter *functions* forced to sRGB; `feDisplacementMap` formula + inverse-map semantics |
| 6 | https://www.w3.org/TR/SVG2/ + https://www.w3.org/TR/SVG2/implnote.html | 2026-09-25 | **Candidate Recommendation, 4 October 2018** (SVG2 never reached Recommendation) | Real-number precision is **single precision**; Appendix B.3 gives a tiling recipe for higher effective precision; CTM must be at least double precision |
| 7 | https://github.com/Agamnentzar/ag-psd (+ README_PSD.md raw) | 2026-09-25 | Implemented library (README on `master`, 723 stars) | Reads/writes PSD incl. `placedLayer` smart objects (4-corner `transform`, `warp`, `linkedFiles`); 8-bit RGB only, no PSB, incomplete text, no composite regeneration, alpha-premultiplication corruption warning |
| 8 | https://onnxruntime.ai/docs/execution-providers/ (+ WebGPU EP page) | 2026-09-25 | Implemented API docs | EP matrix: browser = WASM CPU + WebGPU/WebNN; Linux desktop native = CPU, oneDNN, OpenVINO, CUDA/TensorRT, ROCm (deprecated), WebGPU (Dawn→Vulkan) |
| 9 | https://onnxruntime.ai/docs/tutorials/web/large-models.html | 2026-09-25 | Implemented API docs | Browser limits: ~2 GB ArrayBuffer (Chrome), 2 GB protobuf, **4 GB WASM memory — no models >4 GB in ORT Web**; external-data loading pattern; Cache API/OPFS caching |
| 10 | https://community.adobe.com/announcements-651/design-mockups-in-illustrator-with-real-life-objects-805903 | 2026-09-25 | Vendor announcement (2023-10-10) | Illustrator Mockup GA: full limitation list (no raster/linked art, no mockup-in-mockup, GPU required, symbol conversion, template migration breaks pre-28.5 templates) |
| 11 | https://creativepro.com/creating-quick-mockups-in-illustrator/ | 2026-09-25 | Tutorial/secondary | Confirms re-entry path: select mockup → "Edit Content" in Contextual Task Bar / Properties; photo can be saved as template (+) |
| 12 | https://www.reddit.com/r/photoshop/comments/1ncg0rx/prevent_warp_transform_resetting/ | 2026-09-25 | Forum/UX evidence (2025-09-09) | Smart-object warp **resets when content inside the SO is edited** (reports on Ps 26.7; another user says 26.10 does not) |
| 13 | https://www.reddit.com/r/photoshop/comments/1k9jevn/ | 2026-09-25 | Forum/UX evidence (2025-04-28) | Mockup author cannot fit image into smart object without cropping; "I have the same issue" reply |
| 14 | https://www.reddit.com/r/photoshop/comments/h01kmx/ | 2026-09-25 | Forum/UX evidence (2020-06-10) | Transform preview looks sharp, committed resize degrades — resampling happens on commit |
| 15 | https://www.reddit.com/r/photoshop/comments/64jx1h/ | 2026-09-25 | Forum/UX evidence (2017-04-10) | Repeated duplicate+transform of embedded SO "loses quality" each cycle; terminology confusion embedded vs linked |
| 16 | https://www.reddit.com/r/photoshop/comments/1errwiw/ | 2026-09-25 | Forum/UX evidence (2024-08-14) | Nested linked-SO update latency "sometimes 1 second, sometimes 30+" — unpredictable propagation |
| 17 | https://www.reddit.com/r/photoshop/comments/zpmo16/ | 2026-09-25 | Forum/UX evidence (2022-12-19) | Must open each smart object individually to "Update Modified Content"; no master-document bulk update |
| 18 | https://community.adobe.com/questions-712/error-could-not-update-smart-object-files-because-the-file-was-not-found-whemn-psd-file-moved-1086125 | 2026-09-25 | Vendor forum (2019-12-30) | Moving a PSD breaks linked SO: "Could not update smart object files because the file was not found"; fix = Relink/Replace Contents |
| 19 | https://www.reddit.com/r/photoshop/comments/4hulxj/ | 2026-09-25 | Forum/UX evidence (2016-05-04) | Downloaded PSD templates → "Cannot locate linked assets"; linked vs embedded confusion |
| 20 | https://www.reddit.com/r/PhotoshopTutorials/comments/xmy2ui/ | 2026-09-25 | Forum/UX evidence (2022-09-24) | "My image doesn't appear on the mockup" — user Saved-As instead of Save inside SO tab; save semantics unclear |
| 21 | https://www.reddit.com/r/photoshop/comments/1kv5enb/ | 2026-09-25 | Forum/UX evidence (2025-05-25) | Place Linked + Convert to Smart Object spawns hidden `.psb` that "resizes itself, cuts off edges" |
| 22 | https://www.github.com/photopea/photopea/issues/6772 | 2026-09-25 | Implemented-library issue tracker (Photopea) | **PSD has no per-smart-object interpolation field**; Photopea forces bilinear, Photoshop uses per-install preferences → same file renders differently per machine |
| 23 | https://github.com/photopea/photopea/issues/3997 , /issues/7416 , /issues/2228 ; https://www.reddit.com/r/photopea/comments/166l4uo/ | 2026-09-25 | Issue tracker / forum | Smart-object save no-op, save freeze, "must be rasterized first", Perspective Warp unsupported (issue #5059 referenced) |
| 24 | https://illustrator.uservoice.com/forums/601447-illustrator-desktop-bugs/suggestions/51171808-exif-rotation-information-is-not-reflected-in-the | 2026-09-25 | Vendor bug tracker (2026-04-07) | **EXIF rotation honored on first place, ignored on replace** — orientation differs between place and substitution (broke between AI 26.5.3 and later; HEIC case) |
| 25 | https://illustrator.uservoice.com/forums/939477-illustrator-desktop-beta-bugs/suggestions/47051593-multipule-mockups-in-one-document-bug | 2026-09-25 | Vendor bug tracker (2023-08-05) | Second mockup in a document mis-detects region (uses whitespace); editing first mockup re-triggers corruption; undo does not restore |
| 26 | https://www.reddit.com/r/AdobeIllustrator/comments/193aney/mockup_doesnt_work/ | 2026-09-25 | Forum/UX evidence (2024-01-10) | Mockup "unknown error" then **deletes everything** |
| 27 | https://raleighswebsitedesign.com/web-design-tips/new-mockup-feature-in-adobe-illustrator/ | 2026-09-25 | Tutorial/secondary (2023-12-04) | Mockup converts art to a **symbol**; four controls (Edit mockup group / Edit image / Edit content / Release); image inside mockup cannot be edited |
| 28 | https://www.viget.com/articles/linked-smart-objects-in-photoshop | 2026-09-25 | Tutorial/secondary (2010) | Historic script-based linking: no relative paths, center reference point shifts content on resize |
| 29 | https://ca.trustpilot.com/review/placeit.net ; https://www.reddit.com/r/Placeit/comments/1n0rtii/ ; /r/Etsy/comments/m3w769/ ; /r/printondemand/comments/uhejez/ ; /r/Placeit/comments/15j84fi/ | 2026-09-25 | Forum/review evidence (2021–2025) | Placeit: blurry mockups, exports below Etsy's 2000 px guidance, watermarks on free tier, paid plan with placement controls missing, billing complaints |
| 30 | https://www.reddit.com/r/CapCut/comments/1jbgfau/ , /1h7q6jc/ , /1nqcxvw/ , /1mltbyw/ | 2026-09-25 | Forum/UX evidence (2025) | CapCut: watermark + export paywall, weekly export caps, features migrated to Pro |
| 31 | https://psdmate.com/blog/displacement-maps-realistic-mockups | 2026-09-25 | Tutorial/secondary (2026-08-26) | Three-layer stack (displacement + Multiply shadows + Screen/Soft-Light highlights); "white text vanishes: artwork layer set to Multiply"; map blur ratio ~1 px per 1000 px width |
| 32 | https://community.adobe.com/questions-712/white-artwork-on-a-t-shirt-1069558 | 2026-09-25 | Vendor forum (2018-08-21) | Multiply mockup technique fails for white artwork — canonical user complaint |
| 33 | https://photific.com/how-to/troubleshooting/my-design-looks-glitchy-distorted/ | 2026-09-25 | Tutorial/vendor troubleshooting (2022-08-20) | "Adobe's displacement map bug": designs glitch until Edit Smart Filter + reselect map file + Save |
| 34 | https://graphicdesign.stackexchange.com/questions/94222/ ; https://community.adobe.com/questions-712/displacement-map-confusion-1155045 | 2026-09-25 | Q&A/secondary | Displacement needs opaque greyscale; "Maximize File Compatibility" must be Always for maps to load; map shifts whole layer if contrast is flat |
| 35 | https://computergraphics.stackexchange.com/questions/3842/why-shouldnt-bump-normal-and-displacement-maps-be-gamma-corrected | 2026-09-25 | Q&A/secondary (2016) | Displacement/normal/bump maps hold **geometric** data — gamma encoding (1/2.2 burnt into 8-bit files) corrupts their interpretation; linear is correct |
| 36 | https://graphicdesign.stackexchange.com/questions/31106/why-does-photoshop-auto-rotate-images-when-opening ; https://github.com/processwire/processwire-issues/issues/1154 | 2026-09-25 | Q&A / issue tracker | EXIF orientation honored by some apps and not others; lossless rotate strips the flag; browsers (Chrome ≥81) auto-orient → double-rotation class of bugs |
| 37 | https://www.cambridgeincolour.com/tutorials/image-resize-for-web.htm | 2026-09-25 | Tutorial/secondary | Downscale aliasing = moiré; sinc/Lanczos best; pre-blur before decimation; stepwise 10% reductions; sharpness-vs-moiré trade-off |
| 38 | https://discourse.threejs.org/t/mipmap-generation-failing-on-certain-texture-sizes-causing-minification-aliasing/78787 | 2026-09-25 | Forum/engineering evidence (2025-02) | Minification moiré when mipmaps missing/failing; "no renderer setting will fix" bad prefiltering |
| 39 | https://matplotlib.org/3.6.0/gallery/images_contours_and_fields/image_antialiasing.html | 2026-09-25 | Implemented-library docs | Subsample → smooth first then subsample; `nearest` produces moiré even when *up*sampling by non-integer factors |
| 40 | https://www.pbr-book.org/4ed/Textures_and_Materials/Texture_Coordinate_Generation | 2026-09-25 | Textbook (PBRT 4th ed.) | `CylindricalMapping`: `s = (π + atan2(y,x))/2π`, `t = z`, with analytic texture-coordinate derivatives `ds/dp = (-y, x, 0)/(2π(x²+y²))` |
| 41 | https://www.vrarchitect.net/anu/cg/Texture/coordinateGeneration3.en.html ; https://docs.otoy.com/blender/CylindricalProjection.html ; https://experienceleague.adobe.com/en/docs/substance-3d-painter/using/painting/fill-projections/cylindrical-projection | 2026-09-25 | Teaching / vendor docs | Cylindrical map: θ→u, height→v; angle+span controls; seam visibility; backface/hardness controls in Substance |
| 42 | https://en.wikipedia.org/wiki/Coons_patch ; https://farinhansford.com/dianne/materials/FarinHansford1999.pdf ; https://doi.org/10.3390/mca30020030 | 2026-09-25 | Secondary + peer-reviewed (CAGD 1999; MCA 2025) | Bilinearly blended Coons patch `C = Lc + Ld − B`; regularity (Jacobian nowhere zero) fails for wavy boundaries → foldovers |
| 43 | https://keithp.com/~keithp/porterduff/p253-porter.pdf (also doi 10.1145/800031.808606) | 2026-09-25 | Primary paper (SIGGRAPH '84, Porter & Duff, pp. 253–259) | Premultiplied storage rationale: `(0.5,0,0,0.5)` = red half-covering; `co = cA·aA + cB·aB·(1−aA)`; un-premultiply loses precision as α→0 |
| 44 | https://docs.gimp.org/2.10/en/gimp-tool-perspective.html ; https://docs.gimp.org/3.0/en/gimp-tools-transform.html ; https://invent.kde.org/tymond/docs-krita-org/-/blob/master/reference_manual/tools/transform.rst ; https://inkscape.org/gallery/item/31132/ | 2026-09-25 | Implemented-tool docs | GIMP Perspective: 4-corner handles, Normal vs Corrective direction, live preview, guides, matrix dialog, reset-handles-while-keeping-transform; Krita adds vanishing-point handle; Inkscape needs an extension for raster perspective |
| 45 | https://rotato.app/help/figma-frame-mockup ; https://rotato.app/help/adjusting-3d-perspective | 2026-09-25 | Vendor docs (product) | Figma plugin flow: select frame → render → "Place on Page"; 3D device auto-detect from frame size; perspective = camera FOV. (Render-then-place, not in-canvas warp) |
| 46 | https://en.wikipedia.org/wiki/Alpha_compositing | 2026-09-25 | Secondary summary | Premultiplied advantages: correct interpolation/filtering (no RGB bleed from A=0 regions); Porter-Duff simple only in premultiplied form |

---

## 2. Verified reference findings (the 9 starting URLs)

### 2.1 Illustrator "Create mockups for images" (Adobe helpx)

**Fetch status:** direct `webfetch` → HTTP 403 (Adobe bot protection). Content recovered
from the search-engine index of the *same URL* (page published 2025-10-27), plus the
official Adobe Community announcement (2023-10-10) and CreativePro tutorial.
Treat exact wording as approximate; the workflow steps are corroborated by 3 sources.

Documented workflow:
1. `Window > Mockup` opens the Mockup panel. Either use a curated template or place your
   own raster image (`File > Place`).
2. **Select the vector art and the image together** with the Selection tool →
   `Create Mockup`. The art is applied to the image and "auto-adjusts according to the
   geometry of the object."
3. Drag the art on canvas; it re-adapts live. Deselect to fix it in place.
4. Re-entry: select the mockup → `Edit Content` (Properties panel or Contextual Task Bar).
   `Release` detaches art from image.
5. Photos can be saved as templates (`+`), up to 20 across all documents, listed under
   "Your Mockups"; templates from Illustrator 28.5 or earlier must be released and
   recreated.

Verified limitations (Adobe's own list, community announcement 2023-10-10):
- Unsupported as mockup *art*: mesh, gradient mesh, freeform gradient, placed art,
  non-native art, raster, raster effects, clip groups (incl. patterns) — command greyed
  out or warns of "appearance mismatch".
- No mockup inside a mockup; no mockup over multiple images; artwork is converted to a
  **Symbol** (edits propagate through the symbol).
- Effects menu vector effects cannot be applied directly inside a mockup group (must edit
  the symbol).
- **Linked Illustrator files are not supported — must embed.**
- GPU required. Quality issues on reflective surfaces, small grooves, sky images.
- The *image* inside a mockup cannot be edited (secondary source #27).

Assessment: this is a **planar auto-wrap** feature, not a general corner-pin tool. Adobe
publishes no algorithm spec — "auto-adjusts to geometry" is a **marketing/behavioral
claim**, not a documented contract. Nothing here should be cited as a technical standard.

### 2.2 Photoshop linked Smart Objects (Adobe learn + sibling helpx pages)

**Fetch status:** the `adobe.com/learn` URL returned a JS shell on direct fetch; search
index confirms the page title "Work more efficiently with Linked Smart Objects"
(2026-08-07). The *behaviors* below were verified on sibling Adobe helpx pages (#2a, #2b)
and Adobe's Photoshop API docs (#2c), which are more precise anyway.

Verified semantics:
- Linked Smart Objects reference an external file; embedded Smart Objects carry the bytes
  inside the document.
- **While the document is open**, linked SOs update automatically when the source changes.
- **When reopened**, changed sources are *highlighted* in the Layers panel; the user must
  right-click → `Update Modified Content`, or `Layer > Smart Objects > Update All Modified
  Content`. (i.e. update-on-open is explicit, not automatic.)
- **Nesting gap (official):** "Photoshop only checks the file directly linked to the Smart
  Object. A linked file won't update automatically if nested inside another Smart Object."
- Missing sources are flagged; fix via right-click → `Relink to File`. Missing-linked SOs
  still print if "Maximize PSD and PSB File Compatibility" was on at save (a flattened
  fallback exists), but **cannot be modified** (#28/jkost tips corroborate).
- `Embed Linked` / `Embed All Linked` converts to embedded for portability ("document
  remains intact even if the external source files are moved or deleted").
- Related operations Adobe documents as first-class: View properties, Package, Convert
  embedded↔linked, Filter Layers panel by Smart Object, Replace contents, Reset Smart
  Object transforms, Export contents.
- Photoshop API manifest (`#2c`): smart object `transform` is serialized as **four
  [x, y] corner pairs** — i.e. Adobe's own wire format for a placed smart object is a
  corner-pin quad, plus `isLinked` + path. Also documents that server-side generated
  linked PSDs *will* prompt "missing file" locally — expected, not a bug.

### 2.3 OpenCV `getPerspectiveTransform` / `warpPerspective` (docs.opencv.org 4.x → 4.13.0)

Normative for our reference implementation only as "one well-known implementation"; it is
**implemented API docs**, not a standard.

- **Reverse mapping is mandatory.** "To avoid sampling artifacts, the mapping is done in
  the reverse order, from destination to source": `dst(x,y) = src(fx(x,y), fy(x,y))`.
  If you specify a forward mapping, OpenCV first computes the inverse and then samples.
- `getPerspectiveTransform(src[4], dst[4], solveMethod=DECOMP_LU)` solves
  `[t·x', t·y', t]ᵀ = M · [x, y, 1]ᵀ` for the 4 corresponding quadrangle vertices.
  Points are indexed `i = 0,1,2,3`; the docs **do not mandate a corner order** — only
  that `src(i)` corresponds to `dst(i)`. (Convention in practice: TL, TR, BR, BL.)
  `solveMethod` is passed to `cv::solve`; degenerate configurations (collinear/coincident
  points) produce an ill-conditioned solve — the docs do not promise validation.
- `warpPerspective(src, dst, M, dsize, flags, borderMode, borderValue)`:
  - Without `WARP_INVERSE_MAP`, M is treated as **forward** and is inverted internally
    before the sampling formula is applied.
  - Formula when `WARP_INVERSE_MAP` set: `dst(x,y) = src((M11x+M12y+M13)/(M31x+M32y+M33), ...)`.
  - `flags` for `warpPerspective` are documented as **INTER_LINEAR or INTER_NEAREST**
    plus optional `WARP_INVERSE_MAP` (narrower than `warpAffine`, which also lists
    `INTER_CUBIC` via resize guidance).
  - `borderMode`: `BORDER_CONSTANT` or `BORDER_REPLICATE` for warpPerspective;
    `BORDER_TRANSPARENT` (outliers leave dst untouched) exists for `remap`/`warpAffine`.
  - Cannot operate in-place.
- Section preamble: geometrical transforms do not work with `CV_8S` / `CV_32S` images;
  `remap` inputs/outputs must be < 32767×32767.
- Interpolation guidance (from `resize`, same group): **shrinking prefers `INTER_AREA`
  ("moi​ré-free results")**, enlargement prefers `INTER_CUBIC` (or `INTER_LINEAR`).
  `INTER_AREA`, `INTER_LINEAR_EXACT`, `INTER_NEAREST_EXACT` are **not supported by
  `remap`**.

### 2.4 W3C Compositing and Blending Level 1 (CR Draft 2024-03-21)

- Order of graphical operations: **filter effect → clipping → masking → blending →
  compositing** (same as SVG).
- Porter-Duff operators defined: Clear, Copy, Destination, **Source Over**, Destination
  Over, Source In, Destination In, Source Out, Destination Out, Source Atop, Destination
  Atop, XOR, Lighter.
- Blend modes: separable (normal, multiply, screen, overlay, darken, lighten, color-dodge,
  color-burn, hard-light, soft-light, difference, exclusion) + non-separable
  (hue, saturation, color, luminosity). `mix-blend-mode` grammar lists exactly these 17.
- **Isolation rules (verified text):**
  - CSS/HTML: everything that creates a stacking context is an isolated group.
  - SVG: elements default to *non-isolated*; but `opacity`, filters, 3D transforms
    (2D transforms must NOT cause isolation), blending, and masking force isolation.
  - CSS background images and `<img>`-referenced SVG always render into isolated groups.
- Simple alpha compositing: `co` is the **premultiplied** pixel after compositing;
  source-over is `Cs·αs + Cb·αb·(1−αs)`.
- **Critical constraint for blend implementations:** "The blending calculations must not
  use pre-multiplied color values." (§ on blending) — un-premultiply → blend → recompose.
  This is the standards-level statement that resolves the premultiplied-vs-straight
  question: *compositing* runs on premultiplied values; *blend functions* run on
  non-premultiplied values.
- The spec extends the Canvas 2D `globalCompositeOperation` attribute — so Canvas
  `multiply` etc. is normatively defined here (usable as an interop reference).

### 2.5 W3C Filter Effects Module Level 1 (WD 2018-12-18 — DRAFT)

- **Filter region:** `filterUnits` = userSpaceOnUse | objectBoundingBox; region attributes
  `x, y, width, height` default to `x="-10%" y="-10%" width="120%" height="120%"` (padding
  exists because effects spill past the tight bbox). Filter primitive subregions default
  to the union of referenced subregions, else the whole filter region.
- **`color-interpolation-filters`:** initial value **`linearRGB`**, while
  `color-interpolation` initial value is `sRGB`. "In the default case, filter effects
  operations occur in the linearRGB color space, whereas all other color interpolations
  occur by default in the sRGB color space."
  BUT: **filter functions** (`blur()`, `drop-shadow()`, …) are forced to sRGB —
  `color-interpolation-filters` has no effect on them.
- **`feDisplacementMap` (verified formula):**
  `P'(x,y) ← P( x + scale·(XC(x,y) − .5), y + scale·(YC(x,y) − .5) )`
  - "The displacement map [in2] defines the **inverse** of the mapping performed."
  - `in` (the image being displaced) **stays premultiplied**; channel math on `in2` uses
    non-premultiplied values.
  - `color-interpolation-filters` applies **only to in2**, not to `in`.
  - `scale` initial 0; `xChannelSelector`/`yChannelSelector` initial `A`.
  - Interpolation method when sampling is **explicitly unspecified**
    ("A future version of this spec will define the interpolation method") and can be
    influenced by `image-rendering`. Open issue: csswg #113 "Implementations do not match
    specification."
- Compositing order restated: filters apply before clipping/masking/opacity.

### 2.6 SVG 2 (CR 2018-10-04) — determinism-relevant points

- Status: Candidate Recommendation; **not** a W3C Recommendation. Several features "at
  risk". Implementation report absent at CR time.
- **§4.2.1 / Appendix B.3 (verified):** "The real number precision of SVG is
  single-precision." Conforming generators handling technical data are *encouraged* to:
  split content into tiles so each tile's coordinates fit single precision, emit a
  per-tile transform matrix (each element within single-precision range), transform content
  into tile space, and attach an inverse transform on the tile group.
  Presentation above single precision is possible because "at least double-precision
  floating point must be used when generating a CTM" (Conforming SVG Viewers section).
- Appendix B.2 gives exact elliptical-arc endpoint↔center conversion equations and
  out-of-range radius correction (useful if mockup artwork contains arcs; guarantees the
  radicand never goes negative).
- Implication for Varve: **SVG output cannot round-trip arbitrary double-precision warp
  matrices losslessly.** Store warps at double precision in the Varve document; when
  emitting SVG, either quantize knowingly or apply the tile+transform recipe. Never assume
  a serialized `matrix(...)` equals the in-memory homography.

### 2.7 ag-psd — actual PSD read/write capability

Implemented library (TypeScript), per README/README_PSD on `master`:

Supported:
- Read/write PSD structure, layers, groups, masks, blend modes, opacity, clipping,
  artboards, guides, image resources, XMP, ICC reference, adjustment layers,
  vector masks (`vectorFill`/`vectorStroke`), document patterns (raw/RLE RGB/Gray only).
- **Smart objects:** `placedLayer` = `{ id, placed, type: 'unknown'|'vector'|'raster'|'image stack',
  transform: number[8] (x,y of 4 corners), nonAffineTransform?: number[8], width, height,
  resolution, warp?: Warp, crop? }`, linked through `psd.linkedFiles[]`
  (`{ id, name, type, creator, data?, time?, childDocumentID, assetModTime, assetLockedState }`).
  Read option `skipLinkedFilesData` skips linked-file payloads — i.e. **embedded linked-file
  bytes are present and controllable**.
- Layer effects: dropShadow, innerShadow, outerGlow, innerGlow, bevel, solidFill, satin,
  stroke, gradientOverlay (multi-instance capable in recent PS versions).

Explicitly NOT supported (library's own Limitations list):
- Indexed/CMYK/Multichannel/Duotone/LAB read (converted to RGB); any write mode other than
  RGB; **16 bits per channel**; **PSB (Large Document Format)**; color palettes; animations;
  zip-compressed patterns; Pattern Overlay effect (name/id only); 3D effects; "some new
  features from latest versions of Photoshop"; **"not all filters on smart layers"**;
  incomplete text layers (vertical text can write a file that *crashes Photoshop*; no
  Paragraph/Character Styles; written text layers trigger a Photoshop "update" prompt).
- **The library never re-renders composites or layer bitmaps.** "This library does NOT
  generate new composite canvas based on the layer data… changing layer order, adding or
  removing layers or changing layer canvas data, or blending mode… will cause the composite
  image and thumbnail to not be valid anymore." Same for layer-level: changing text/vector/
  smart-object properties does not update `layer.canvas`.
- Canvas round-trip hazard: image data loaded into a canvas gets **alpha-premultiplied**,
  corrupting pixel values on rewrite → use `useImageData: true` for fidelity.
- Security guidance for untrusted PSDs: `useRawData`, dimension/layer limits before
  decoding (PSD canvas can declare up to 300000×300000), decode is synchronous and
  memory-heavy (default 2 GB total memory limit), decode off the main thread.

Verdict: ag-psd is viable for **reading** mockup-template PSDs (including smart-object
corner-pin transforms, warp descriptors, and linked-file payloads) and for **writing**
simple RGB/8-bit PSDs. It is not a Photoshop-compatible renderer; any "update the smart
object and show the result" flow must re-render on our side and (if exporting PSD) supply
fresh composite/layer bitmaps ourselves.

### 2.8 ONNX Runtime execution providers (what actually applies)

From the EP summary table + WebGPU EP page:
- **Browser (onnxruntime-web):** WASM CPU EP by default; `webgpu` backend (historically via
  JSEP) and WebNN EP available. No CUDA/DirectML/OpenVINO in a browser.
- **Desktop Linux native:** default CPU EP; **oneDNN (DNNL)**; **OpenVINO** (Intel);
  **CUDA / TensorRT** (NVIDIA); **ROCm marked *deprecated***; **WebGPU EP via Dawn →
  Vulkan on Linux** (cross-vendor, no vendor SDK needed); XNNPACK (mobile/CPU-oriented).
  DirectML is Windows-only; CoreML is macOS (listed *preview*); NNAPI Android; QNN
  Qualcomm. Community EPs (ACL, ArmNN, TVM, RKNPU, CANN) are preview.
- Same API across EPs; provider list is ordered by priority with CPU fallback.
- WebGPU EP ships as a plugin EP (`onnxruntime_providers_webgpu.so`); for ORT Web, import
  `onnxruntime-web/webgpu` and list `'webgpu'` in `executionProviders`. Note (docs): the
  browser path currently ships the JSEP-based build; native `--use_webgpu` and `--use_jsep`
  coexist transitionally and are expected to become mutually exclusive — re-check at
  implementation time.

### 2.9 ONNX Runtime Web — large-model realities

Verified limits and mechanics:
- **ArrayBuffer:** no hard JS limit, but per-browser caps — Chrome ~0x7fe00000 bytes
  (~2 GB). `response.arrayBuffer()` on huge files can fail. ORT Web builds >2 GB buffers
  via `new WebAssembly.Memory()`, which is **not transferable** → incompatible with the
  `Proxy` feature.
- **Protobuf:** ONNX serialized format max 2 GB → larger models must use *external data*
  (separate `.data` files referenced by location/offset/length).
- **WebAssembly memory: 4 GB (32-bit addressing). "Currently, there is no way for
  ONNX Runtime Web to run models larger than 4 GB."**
- External data in the browser must be passed explicitly:
  `ort.InferenceSession.create(modelUrl, { externalData: [{ path, data: url|Blob|Uint8Array }] })`.
  Renaming the external data file breaks loading (protobuf `location` mismatch).
- Caching recommendations: Cache API or Origin Private File System; IndexedDB storage is
  shown for model+external data blobs.

---

## 3. Competitor workflows worth borrowing (interaction principles only)

These are *interaction* observations, not algorithm claims.

1. **Select-everything-to-create (Illustrator).** The user selects artwork *and* surface
   image in one gesture; the tool derives the relationship. No mode, no "pick source then
   pick target" wizard. Principle: creation must be a single selection + one command.
2. **Drag-to-reposition with live re-fit (Illustrator).** While dragging, the artwork
   re-adapts to the surface geometry; deselecting commits. Principle: warp editing is
   direct manipulation with continuous feedback, and *commit is just deselection*.
3. **Three-way edit granularity (Illustrator):** "Edit mockup group" / "Edit image" /
   "Edit content", plus an explicit **Release**. Principle: make the three edit targets
   (composite, surface, artwork) and detachment first-class, discoverable commands — Adobe
   users' biggest complaints (#27, #26) stem from ambiguity about *what is selected*.
4. **Content edits never mutate placement (Photoshop's *intended* contract, violated in
   practice per #12).** Warp/transform lives on the placement, not the source. Principle:
   store `placement` (quad/warp/opacity/blend) separately from `source` (bytes) in the
   document model, and make replacement operations structurally incapable of touching it.
5. **Stale-source surfacing (Photoshop).** Changed sources are *highlighted* in the layer
   panel with a badge and require explicit "Update Modified Content"; missing sources get a
   relink path. Principle: staleness must be visible per-instance and resolvable in bulk —
   Photoshop's gap is that nested links are never checked (#2a) and bulk update is missing
   (#17).
6. **Embed-vs-link as an explicit, reversible choice (Photoshop).** Link for shared
   sources, Embed for portability, convert either way, "package" for hand-off. Principle:
   template authors should be able to hand a single self-contained file to someone else
   with one command.
7. **Normal vs Corrective direction (GIMP Perspective).** Same tool, two intents: apply a
   drawn quad (place artwork) or trace an existing quad and *remove* its perspective.
   Principle: expose direction explicitly; mockup authors need both (author a surface vs.
   extract a surface).
8. **Live preview + numeric matrix + guide grid (GIMP).** The tool shows the transform
   matrix, offers guides over the frame, and can reset handles while keeping the current
   transform (chained steps). Principle: offer precision affordances (grid, numeric readout,
   reset-handles-without-losing-state) alongside direct manipulation.
9. **Vanishing-point handle (Krita Perspective).** Beyond 4 corner handles, Krita lets you
   drag a designated vanishing point. Principle: for architectural surfaces, a vanishing
   point affordance is more ergonomic than free corner dragging.
10. **Render-then-place plugins (Rotato for Figma).** They don't warp inside Figma — they
    render externally and drop a bitmap back. Principle: acceptable for device mockups,
    *not* what Varve needs (we need live, editable, non-destructive warps in-canvas); but
    note the auto-detect device-from-frame-size and preset export sizes as nice template
    affordances.
11. **"Design" vs "Add" distinction (Placeit UX complaint #29).** Placeit users were
    confused that "Add" just layers an image while "Design" warps it to look natural.
    Principle: name the warping action explicitly ("Place on surface") and never bury it.
12. **Placeholder/template gallery with preview-on-hover (Illustrator Mockup panel;
    "Preview Mockup" before committing).** Principle: template authoring should preview
    artwork on candidate surfaces before creating an object.

---

## 4. User complaints / market failures we can realistically resolve

Each item: evidence → what our system should do differently. All are *reports*, not
guarantees about current app versions.

| # | Complaint (evidence) | What Varve should do instead |
|---|---|---|
| C1 | **Warp resets when smart-object content is edited** — "every time I make a change inside the smart object, the warp transformation resets to its initial shape" (Ps 26.7; #12). Community splits on whether newer versions fix it. | Store the warp/quad exclusively on the placement record; content replacement must be a pure `source` swap. Add an E2E regression test: replace content → quad, warp, blend, opacity byte-identical. |
| C2 | **Cannot fit an image into a mockup SO without cropping** — "My smart object size is significantly bigger than my image. When I resize to fit… portions are cropped" (2025-04-28, #13). | Expose explicit fit modes on replacement: Fill / Fit (contain) / Stretch / Pad, with a visible aspect-lock toggle, applied *within* the destination quad. Default should be Fit for template replacement. |
| C3 | **Preview-vs-commit quality jump** — transform preview sharp, committed resize degrades (#14, 2020); interpolation setting buried in preferences and not per-object. | Render the on-canvas preview through the same resampling path as the final frame (no cheap preview path), document the resampling policy, and expose a per-placement quality/interpolation choice rather than a global hidden preference. |
| C4 | **Quality loss accumulates across duplicate/transform cycles** — "each time I duplicate the smart object/layer it loses some quality" (#15); "scale down then up, it will not suffer from the initial downscaling" is the *only* benefit users report (r/photoshop 2026-03-18). | Never bake transformed pixels into the source. Every render samples the original source through the current transform (the "loan against an authoritative frame" principle already in AGENTS.md). |
| C5 | **Nested linked sources never auto-update (documented Adobe limitation)** — "A linked file won't update automatically if nested inside another Smart Object" (#2a). | Our source-binding graph should propagate invalidation transitively (source → all dependents, including nested containers), or explicitly mark nested dependents stale. |
| C6 | **Unpredictable update latency** — nested SO saves take "1 second… sometimes 30+" (#16); bulk updates require opening each SO (#17). | Deterministic, queued, observable updates: one "sources" panel listing every binding with stale/clean state and a single Update-all; progress must be synchronous-feeling (local-first — no network). |
| C7 | **Broken links after moving files** — "Could not update smart object files because the file was not found" (#18); downloaded templates → "Cannot locate linked assets" (#19). | Content-address sources or embed template content by default; keep a cached raster so a missing source still *renders* (Photoshop's flattened fallback), and offer one-click relink with search-by-hash. |
| C8 | **Save semantics inside the SO editor are unclear** — "my image doesn't appear… Did you Save or Save As?" (#20). "Save As" silently forks. | The content editor should auto-apply with visible confirmation ("Applied to 3 placements"), never require a File→Save, and never fork a new document on save. |
| C9 | **Hidden derived `.psb` files that resize/crop themselves** (#21). | No hidden intermediate documents. Source editing should happen in a first-class editor surface over the same document model. |
| C10 | **Photoshop PSDs render differently per machine** — "In the PSD format, smart objects always have a bilinear interpolation… I don't think PSD files should look different on each device" (Photopea author, #22); Photoshop uses per-install preferences for SO interpolation. | Persist the interpolation/sampling method *with the placement* in our format so a document renders identically everywhere. |
| C11 | **Photopea smart-object breakage** — save does nothing (#3997), freeze on save (#7416), "must be rasterized first" (#2228), Perspective Warp unsupported (#23). | These define the failure modes of a compatibility-focused clone: we should test *replace/transform/update* as atomic, idempotent operations with explicit error states, and refuse unsupported operations loudly instead of half-applying them. |
| C12 | **Illustrator converts artwork to a Symbol, losing original structure** — recommend "working with a copy of your vector art rather than the original… compromising its original integrity" (2023 beta write-up, #1); artwork becomes a symbol on Create Mockup (#27, #10). | Mockup creation must not mutate the artwork node's type or identity; the mockup is a *relationship* (placement referencing artwork), releasable back to the exact original nodes. |
| C13 | **Illustrator mockup: unknown error deletes everything** (#26); second mockup in a document mis-detects surface and corrupts the first, undo doesn't restore (#25). | Long operations must be transactional (validate first, apply atomically, undo restores exactly); per-instance detection state must be isolated so one mockup cannot mutate another. |
| C14 | **Template/version migration breaks templates** — "Mockup from Illustrator 28.5 or earlier must be released and recreated" (#10). | Version our template schema with forward migration and a documented stability guarantee for placement records. |
| C15 | **EXIF orientation inconsistent between place and replace** (Illustrator bug, 2026-04-07, #24); broader double-rotation history (#36). | Normalize orientation at import time (apply EXIF orientation once, reset flag to 1) and store the normalized pixels — then place and replace are identical by construction. |
| C16 | **Placeit: blurry / low-res mockups** — "The mockup is unusable, very blurry" (#29); exports too small for Etsy's 2000 px guidance (#29); free-tier watermarks; paid plan still missing placement controls; billing complaints (Trustpilot 2.6/5 per a competitor's write-up — **marketing source**, treat cautiously). | Local-first, no watermark, no export cap, full-resolution export at document DPI; placement controls always available. Keep a "export resolution" indicator (source px vs export px) so users know when they're upscaling. |
| C17 | **CapCut-style paywalls on basics** — export/watermark/high-res gated, weekly export caps (#30, 2025). | Not applicable to us operationally, but it is the market gap: core mockup export must never be a paid feature. |
| C18 | **Multiply washes out white artwork** — "for white artwork, it doesn't work" (Adobe forum 2018, #32); "White text vanishes → artwork layer set to Multiply" (#31); print-preview washout reports (#31, Printful help). | Ship a documented **ink stack** preset: shadow layer (Multiply) + highlight layer (Screen/Soft Light) clipped to the artwork, artwork itself in Normal by default, with a "white ink on dark surface" preset that switches to the correct combination. Never make a single Multiply toggle the default. |
| C19 | **Displacement map workflow fragility** — requires a *separate saved PSD file*, "Maximize File Compatibility must be Always" or maps silently fail (#34), glitchy results billed as "Adobe's displacement map bug" (#33), wrong scale smears artwork, flat maps shift the whole layer (#31, #34). | Keep displacement maps inside our document (no external file), bake mid-gray = zero-shift semantics explicitly, auto-blur maps relative to resolution (the 1 px/1000 px heuristic from #31 is a reasonable default), and clamp/warn on excessive scale. |
| C20 | **Displacement gamma/color-space trap** — displacement maps are geometric data but 8-bit files carry sRGB gamma; loading them as color data changes displacement (#35); SVG spec reads map channels in `color-interpolation-filters` space (linearRGB by default!) (#5). | Read displacement fields **linearly** (never through sRGB decode, never through premultiplied canvas paths), document that the map channel value 0.5 = no shift, and make preview and export use the identical decode path. |
| C21 | **Moiré/aliasing in warped previews and downscaled art** — downscale moiré (#37), minification moiré when prefiltering is missing (#38), `nearest` moiré even on non-integer *up*scales (#39). | Prefilter by the warp's sampling footprint (area/mip-style) for any minifying warp; supersample on export; provide a per-placement "sharp vs smooth" trade-off only if measured — default to moiré-free. |
| C22 | **Source-file placement errors** — "Could not place… parser module cannot parse", "…input-only color profile", JPEG marker errors (forum threads, #search-26). | Import must pre-validate decode + color profile and report a specific, actionable error per file; never fail the whole placement op. |

---

## 5. Algorithm & standards decisions

### 5.1 Projective mapping semantics (corner-pin)

- **Never forward-scatter.** Build the destination by inverse lookup:
  `dst(x,y) = src(fwd⁻¹(x,y))`. This is OpenCV's documented rule (#3) and mirrors
  `feDisplacementMap`, whose map "defines the inverse of the mapping" (#5). A forward
  scatter leaves holes.
- **Corner order:** OpenCV only requires `src(i) ↔ dst(i)` correspondence; it does not
  fix an order. Adopt and document **TL, TR, BR, BL** (matching Adobe's smart-object
  `transform` serialization in #2c: 4 corner pairs, top-left → top-right → bottom-right →
  bottom-left), and validate non-self-intersecting (crossing) quads at authoring time.
- **Degenerate quads:** `getPerspectiveTransform` silently LU-solves; collinear/crossed
  points yield garbage or huge values. Our implementation must detect near-degenerate
  configurations (e.g. |det| or triangle-area checks) and refuse with a user-visible
  message instead of rendering. (This is our engineering requirement; OpenCV documents no
  validation.)
- **Forward vs inverse matrix storage:** store the *forward* (source→surface) homography
  in the document (it is what the user authored via corners), invert at render time, and
  guard the inversion (a singular matrix means the quad collapsed). Alternatively store
  corners and recompute — corners are the more robust, human-meaningful representation and
  survive float drift better than a serialized 3×3.
- **Flag parity:** if we mirror OpenCV, remember `warpPerspective` supports only
  `INTER_LINEAR`/`INTER_NEAREST` (+ `WARP_INVERSE_MAP`) — for higher-quality magnification
  we need bicubic/Lanczos ourselves (Canvas `drawImage` gives us bilinear only; a custom
  kernel or GPU path is required for parity with `INTER_CUBIC`).
- **SVG round-trip:** because SVG real-number precision is single precision (#6), never
  rely on emitted SVG to carry exact warp matrices (see §2.6).

### 5.2 Bilinear vs homography vs Coons/free-form

- **Bilinear (4-corner tensor interpolation)** is *not* a perspective transform: it maps
  straight lines to straight lines only in the affine special case; it cannot represent
  foreshortening where non-parallel edges must converge. Use bilinear only when explicitly
  modeling a "bend without perspective" (and say so in the UI).
- **Coons patch (bilinearly blended):** `C(s,t) = Lc(s,t) + Ld(s,t) − B(s,t)` — ruled
  interpolation along both axis pairs minus the corner bilinear surface (#42). This
  interpolates four *boundary curves*, so it is the right primitive for free-form warps
  where the user drags edge curves (not just corners) — e.g. warping a label onto a wavy
  fabric edge.
- **Regularity caution:** a Coons map is only a valid (invertible) parameterization when
  its Jacobian never vanishes; wavy boundaries produce foldovers (#42, peer-reviewed 2025).
  Any edge-curve warp must check `det(J) > 0` over the domain (sample it) and clamp/
  warn — a folded patch inverts sampling and produces mirrored garbage.
- **Barycentric triangle warp** remains the simplest robust fallback for two-triangle
  quad warps.

### 5.3 Sampling / minification (anti-moiré)

- Ground truth hierarchy for our warps:
  1. Estimate the source-space footprint of each destination pixel (the Jacobian of the
     inverse map). If footprint > 1 texel → **minification**: prefilter (area average or
     mip level) before sampling. OpenCV's own guidance: `INTER_AREA` is "moiré-free" for
     decimation (#3).
  2. If footprint ≤ 1 → magnification: bilinear (bicubic/Lanczos where quality demands).
  3. For export, supersample (render at 2×–4× then area-downsample) — cheaper than perfect
     per-pixel filtering and matches the "pre-blur then downscale" finding (#37).
- Failure evidence: missing/failing prefilter → moiré that "no renderer setting will fix"
  (#38); non-integer upsampling with `nearest` also moirés (#39).
- Practical note from the Photoshop community: single-pass bicubic uses a 4×4 support
  window, so large decimation in one step aliases; stepwise reduction or pre-blur expands
  effective support (#37 comment thread). Our area/mip prefilter solves this structurally.
- **Accumulation rule:** never resample a *resampled* buffer (Photoshop's duplicate+transform
  degradation, C4). Always sample the original source.

### 5.4 Alpha: premultiplied vs straight (with standards citations)

- **Storage/compositing: premultiplied.** Porter & Duff's original argument (#43): storing
  `(0.5,0,0,0.5)` for "full red covering half the pixel" avoids multiplying by alpha in
  every op; "The pleasant result that the color channels are handled with the same
  computation as alpha can be traced back to our decision to store pre-multiplied RGBA."
  Un-premultiplying as α→0 destroys precision.
- **Filtering/interpolation: premultiplied.** Interpolating straight alpha leaks RGB from
  fully transparent regions, creating colored fringes at artwork edges after a warp (#46).
  → **Warp (resample) premultiplied, composite premultiplied.**
- **Blending: NOT premultiplied.** compositing-1 (CRD 2024) states blending calculations
  must not use premultiplied values (#4): un-premultiply → apply blend function →
  recompose. Source-over composite itself is `co = Cs·αs + Cb·αb·(1−αs)` (premultiplied).
- Operation order to implement exactly: **filter → clip → mask → blend → composite**
  (compositing-1 §3.1), with group isolation per §2.4 (a mocked surface with a blend mode
  must be isolated from the photo unless blending *into* the photo is intended).
- Canvas2D interop: `globalCompositeOperation` is normatively defined by compositing-1 —
  but Canvas composites premultiplied internally; if we compute blends ourselves we must
  follow the un-premultiply rule for parity.

### 5.5 Blend-mode defaults for mockups (the white-ink problem)

- `multiply` on artwork makes white fully transparent — canonical complaint (#32) and the
  documented failure table entry "White text vanishes → artwork layer set to Multiply" (#31).
- Recommended stack (derived from #31/#34, both *tutorial* sources — validate visually
  before committing):
  - artwork layer: Normal (or Linear Burn at reduced opacity for light surfaces),
  - shadow copy of surface luminance: Multiply, clipped to artwork, 50–80%,
  - highlight copy: Screen 20–40% or Soft Light 40–70%, clipped to artwork,
  - displacement: surface-following geometry only (it does **not** carry light).
- "Displacement handles geometry, not light" (#31) is the correct mental model to encode
  in the template authoring UI.

### 5.6 Displacement gamma trap (detailed)

- SVG's `feDisplacementMap` reads map channels and applies `scale·(C − 0.5)`; with
  `color-interpolation-filters` defaulting to **linearRGB**, sRGB-encoded map bytes are
  decoded to linear first → *different displacement magnitudes* than a naive 0–255/255 read
  (#5). Filter *functions* are sRGB — so mixing primitives and functions shifts color
  spaces mid-graph.
- Domain knowledge (#35): displacement/normal/bump maps are geometric data; gamma
  encoding "burnt in" by 8-bit save corrupts their interpretation; blur applied in gamma
  space differs from blur in linear space.
- Photoshop-specific fragility: external map files + "Maximize File Compatibility" gating
  (#34) + re-select-the-map workaround for the "displacement bug" (#33).
- **Decision:** our displacement fields are read as raw linear channel values (0.5 = no
  shift), never gamma-decoded, never alpha-premultiplied, stored inside our document
  (no external files), and the preview path and export path must share one decode
  function (add a golden test asserting preview hash == export hash at same camera).

### 5.7 Cylindrical mapping (labels around a cylinder)

Verified formulations:
- **PBRT (#40):** `s = (π + atan2(y, x)) / 2π`, `t = z`, with derivative
  `ds/dp = (−y, x, 0) / (2π(x² + y²))`, `dt/dp = (0, 0, 1)` — those derivatives are exactly
  what we need for footprint-based filtering (§5.3) on a cylindrical wrap.
- **Teaching reference (#41):** convert (x,y,z) → (r, θ, height); θ → texture u,
  height → texture v. Warning: near the cylinder axis caps, texels squeeze into "pie
  slices" (minification → moiré risk).
- **Practical controls (Substance/OTOY, #41):** explicit `theta` start + `span` (degrees
  the label covers), repeat/clamp horizontally, seam visibility note, backface culling +
  softness at grazing angles.
- **Authoring model for Varve:** a cylindrical placement = (axis, θ0, span, height range,
  radius). Inverse sampling: for each screen pixel inside the projected cylinder, compute
  θ = atan2, u = (θ − θ0)/span (clamp or wrap), v = (height − h0)/H, then sample the label
  with footprint-aware filtering; handle the **seam** explicitly (wrap vs clamp is a
  user-visible property) and skip |cos θ| below a threshold (grazing) to avoid the
  "pie-slice" aliasing.

### 5.8 ONNX decisions (for any AI-assisted mockup features)

- Browser: WASM CPU + optional WebGPU/WebNN only; **models must be <4 GB total WASM
  memory, and practically <2 GB for single-buffer fetch**; >2 GB needs external-data
  chunking (#9). Cache with Cache API/OPFS to avoid refetch.
- Linux desktop (primary dev OS): CPU default; oneDNN/OpenVINO/CUDA as opt-in; ROCm is
  deprecated; **WebGPU EP (Dawn→Vulkan)** is the one cross-vendor GPU path worth betting
  on for both native Linux and the browser (#8).
- Keep ADR-0237's honesty rule: capability stages must be *discovered → runtime-loadable
  → device-usable → execution-verified*, never assumed from an EP being listed.

---

## 6. Uncertainties and things NOT verified

1. **Adobe helpx/learn pages were not fetched directly.** helpx returned 403; the learn URL
   returned a JS shell. Their content came from search-engine indexes of those URLs plus
   sibling Adobe pages. Wording and version-specific behavior should be re-checked in a
   browser before being quoted verbatim in docs.
2. **Blinn "What is a texel?" primary source NOT located.** Searches did not surface a
   verifiable IEEE/CGA citation; I did not confirm the paper exists as titled. Substitute
   primary/quality sources used instead: OpenCV `INTER_AREA` docs (#3), Cambridge in Colour
   resize analysis (#37), matplotlib antialiasing docs (#39), PBRT 4th ed. (#40).
   **Heckbert's texture-mapping survey was not fetched** — listed as a future citation only.
3. **Figma "Angle" plugin** — not researched (only Rotato's docs were verified). Any claim
   about Angle's mechanics is unverified.
4. **Crop.create and VistaCreate complaints** — searches returned no relevant material;
   no findings recorded. Do not assume any behavior for those products.
5. **CapCut/Placeit/Trustpilot claims** are user reviews and (in the Bulk Mockup case) a
   competitor's marketing page — billing/quality claims are unverified hearsay; only the
   *existence and nature* of complaints is evidence.
6. **All Reddit/forum complaints may be fixed or stale** in current app versions (several
   threads contain contradicting version reports, e.g. #12 Ps 26.7 vs 26.10). Use them as
   failure-mode evidence, not as current-bug claims.
7. **Illustrator Mockup's algorithm is undisclosed.** "Auto-adjusts to geometry" is a
   behavioral/marketing claim; no spec, no parameters, no accuracy guarantee is published.
8. **ag-psd round-trip of `placedLayer.warp` was not tested** — README_PSD documents the
   fields; whether a warp written by ag-psd opens cleanly in Photoshop is unverified.
9. **Photoshop displacement "bug" (#33)** is a vendor tutorial's diagnosis, not an Adobe
   acknowledgement; the underlying cause was not verified.
10. **Photopea issue states** (open/closed/fixed) were not re-checked against the live app.
11. **ORT Web JSEP vs native WebGPU EP flag evolution** (#8) — docs say a future change will
    make `--use_webgpu` and `--use_jsep` mutually exclusive; verify at implementation time.
12. **compositing-1 is a Candidate Recommendation Draft** and **filter-effects-1 a Working
    Draft** — neither is a W3C Recommendation; behavior may still change (filter-effects-1
    is from 2018 and explicitly leaves feDisplacementMap interpolation unspecified).
13. **SVG2 is a Candidate Recommendation that never became a Recommendation** — treat its
    precision rules as strong guidance, not deployed law; SVG 1.1 remains what browsers
    largely implement for rendering.
14. **No benchmark or prototype work was done in this research pass** — all algorithm
    recommendations in §5 are design inputs, not measured results in Varve.
