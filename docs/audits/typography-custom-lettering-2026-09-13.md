# Typography, ligatures, and artistic text audit

**Date:** 2026-09-13
**Repository state:** `master`; the baseline was captured at `07f4340` and the
shared worktree subsequently advanced through unrelated agent commits. The
implementation slices below are recorded by commit so this audit does not
mistake the moving shared HEAD for an isolated branch.
**Integration owner:** Codex
**Scope:** OpenType features, shaping, glyph identity, variable axes, editing
anchors, artistic/path text, outlining, persistence/export, frontend access,
and truthful website claims.

This is a current-state audit, not a promise that every font or renderer can
support every feature. The source of truth remains logical Unicode text and
rich-text ranges. Glyph arrays, positioned outlines, path placements, and
deformations are derived values and must be invalidated when their inputs
change.

## Executive findings

The repository already has useful pieces: a source-index map, a lazy
HarfBuzz/WASM adapter, Rustybuzz print shaping, font artifact references,
variable-axis metadata, a canonical layout snapshot, real monochrome glyph
extraction for loaded fonts, text-on-path placement, and per-grapheme wordmark
adjustments. They are not yet one end-to-end pipeline.

The highest-impact defects are:

1. The live browser layout path measures graphemes with Canvas2D and emits
   `glyphId: 0`; this is a measurement approximation, not glyph identity.
2. The canonical painter often converts each shaped record back to a source
   substring and calls `fillText` separately. That can split a ligature or
   destroy joining context even when its width was measured as a whole word.
3. `textToOutlines()` uses `charToGlyph()` for loaded fonts. It therefore
   outlines source characters rather than the substituted glyphs returned by
   HarfBuzz/Rustybuzz. It is explicitly documented as incomplete today.
4. Feature values are effectively Boolean in scene/engine maps. This cannot
   represent indexed `ss##`/`cv##` choices, ranges, or the distinction between
   inherited/unset and explicit off.
5. The WASM adapter does not populate cluster ends, reports requested `ltr`
   when direction was inferred, and does not release its native/WASM resources.
6. Rust print shaping accepts only whole-run feature strings and defaults to
   LTR/`DFLT`; its outline path performs raw character lookup. Native PDF
   output is therefore not yet safe to describe as ligature-accurate.
7. The existing glyph-adjustment UI is useful for simple LTR wordmarks but
   correctly disables some unsafe cases; it still keys edits by grapheme index
   rather than durable UTF-16 source ranges and has no alternate browser.
8. The website and older architecture/session documents overstate browser
   feature/glyph support and describe placeholder outlining as a completed
   phase. Current claims need to distinguish Canvas fallback, HarfBuzz layout,
   and actual outline/export capabilities.

### Reproduced baseline

The following read-only command was run from the repository root against the
pinned OpenSans fixture:

```text
node_modules/.bin/tsx -e "import { readFileSync } from 'node:fs'; import { createHarfBuzzWasmBackend } from './packages/engine/src/shapingBackend.ts'; import { textToOutlines } from './packages/engine/src/textOutlines.ts'; void (async()=>{ const bytes=readFileSync('./crates/varve-print/fixtures/OpenSans-Regular.ttf'); const data=bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength); const backend=createHarfBuzzWasmBackend(); const on=await backend.shape({text:'fi ffi',fontData:data,fontSize:100,features:{liga:true}}); const off=await backend.shape({text:'fi ffi',fontData:data,fontSize:100,features:{liga:false}}); const raw=textToOutlines('fi ffi',{fontSize:100,fontFamily:'Open Sans',fontData:data}); console.log(JSON.stringify({on:on.glyphs.map(g=>({id:g.glyphId,c:g.clusterUtf16,e:g.sourceEnd,a:g.xAdvance})),off:off.glyphs.map(g=>({id:g.glyphId,c:g.clusterUtf16,e:g.sourceEnd,a:g.xAdvance})),rawGlyphs:raw.glyphs.length,rawChars:raw.glyphs.map(g=>g.char),direction:on.direction,script:on.script,upem:on.unitsPerEm},null,2)); })();"
```

Observed output (abridged):

```json
{
  "on": [{"id":907,"c":0,"a":59},{"id":3,"c":2,"a":26},{"id":909,"c":3,"a":92}],
  "off": [{"id":73,"c":0,"a":34},{"id":76,"c":1,"a":25},{"id":3,"c":2,"a":26},{"id":73,"c":3,"a":34},{"id":73,"c":4,"a":34},{"id":76,"c":5,"a":25}],
  "rawGlyphs": 6,
  "rawChars": ["f","i"," ","f","f","i"],
  "direction":"ltr",
  "upem":2048
}
```

The current Canvas bridge was separately reproduced with a deterministic
`measureText` stub: `shapeText('fi', ...)` returns two records, both with
`glyphId: 0`, while the measured width is the width of the whole `fi` string.
This is the specific “correct measurement, incorrect painted glyph identity”
failure that the implementation must remove from the canonical path.

## Baseline runtime dispatch audit (before implementation slices)

| Path | Current behavior | Classification |
|---|---|---|
| Inspector / floating text bar → scene node | Controls write family, weight/style, spacing, some Boolean features, axis values, and grapheme adjustments. | Partially integrated; feature values/ranges and glyph browser are missing. |
| Scene node → engine primitive | `sceneToEngine.ts` carries `openTypeFeatures`, `variableAxes`, path settings, and adjustments into the text primitive. | Working field transport for existing fields; no font bytes or resolved face identity enters the primitive. |
| Browser point text layout | `shapeText` uses UAX/BiDi/script segmentation and Canvas2D measurement; glyph IDs are synthetic zeroes. | Incorrect for glyph identity and advanced shaping; acceptable only as an explicitly labelled paint fallback. |
| Browser canonical replay | Uses the layout snapshot but generally paints source clusters with Canvas2D. Complex runs have a whole-run exception; Latin ligature runs do not. | Incorrect for optional ligature preservation in per-glyph replay. |
| Browser path text | Uses canonical measured runs and places source cluster strings on a path. | Partially working: baseline placement works; actual glyph-outline bending is unsupported and mark/ligature fidelity depends on the source-run fallback. |
| WASM HarfBuzz adapter | Produces real IDs and positions; supports Boolean features and variations; clusters have no `sourceEnd`; inferred direction is reported as LTR. | Backend exists, not fully normalized, not selected by live replay. |
| Native Rustybuzz shaper | Produces real glyph IDs and positions for print calls; direction/script defaults and feature range contract are incomplete. | Backend-only / partially integrated. |
| Text-to-outlines | Requires font bytes and extracts real Bezier contours, counters, and variation outlines; looks up by source character. | Real geometry for simple text; incorrect for substitutions/complex scripts; safe conversion must reject missing data. |
| Rust PDF outline | Uses `ab_glyph` raw character lookup in the current outline helper. | Incorrect for shaped sequences; not a proof of accessible/searchable text. |
| Persistence | Font references, axes, and existing feature maps have schema support; newer feature-range/custom override fields are not yet present. | Partially integrated; migration and unknown-field preservation required. |
| Website/docs | Several pages and historical records call Boolean controls/OpenType support complete. | Documentation drift; claims must be narrowed to verified behavior. |

### Hypotheses versus reproduced defects

Reproduced defects are the `glyphId: 0` Canvas result, the HarfBuzz-versus-
`charToGlyph` outline mismatch, missing WASM `sourceEnd`, and feature values
being reduced to Boolean settings. The following are implementation risks to
verify with tests before claiming support: Rustybuzz cluster units for every
runtime, TTC face bounds, cross-style contextual shaping, actual color-glyph
painting, and PDF extraction/tagging. They are not treated as working merely
because an API or metadata table exists.

### Post-implementation status

The following status supersedes the “not yet integrated” portions of the
baseline matrix above. It is intentionally narrower than the complete product
goal: the browser still paints through Canvas2D, while exact glyph identity is
used where a font-byte shaping path can actually consume it.

| Capability | Current behavior | Root cause / boundary | Affected layers | User impact | Implemented response | Verification |
|---|---|---|---|---|---|---|
| Feature values and ranges | Boolean, numeric/indexed, and UTF-16-ranged values survive scene → backend conversion | Canvas2D cannot portably address ranged glyph IDs; native/WASM adapters can | shared, engine, scene, editor, Rust shaper | A value can otherwise be silently reduced to on/off | normalized shared map, structured native wire request, required-feature warning | shared/engine/native contract tests |
| Live ligature painting | Whole source runs are painted through Canvas2D; per-cluster replay refuses to split likely active standard ligatures | Canvas2D does not expose arbitrary glyph drawing | engine replay, path/warp | `fi`/`ffi` can lose their joined form when adjusted | source-run replay, conservative cluster guard, explicit `liga`-off instruction | replay/path/warp tests and browser close-up |
| Exact outline conversion | Shaped glyph IDs, offsets, source spans, axes, and face identity are used for supported monochrome faces | `opentype.js` contour API must be fed a shaped glyph, not `charToGlyph`; collection/color faces remain unsupported | engine, scene, editor | Outline conversion can otherwise change a wordmark or create fake boxes | HarfBuzz WASM plus native desktop adapter, provenance metadata, refusal on incomplete data | OpenSans `fi`, multiline, corrupt-font, conversion tests |
| Artistic/path text | Path placement is cluster-aware and baseline-only; bounded warp and per-cluster edits stay source-backed | Bending outlines and required script clusters need a distinct operation | scene, engine, editor | Missing paths or ligatures can disappear or be torn apart | detach/reset fallback, cluster grouping, invalidation on source edits, warp preflight | path/warp/invalidation tests and UI E2E |
| PDF fidelity | Shaping-sensitive nodes use a live-rendered raster PDF fallback; simple eligible text can use native operators | Native PDF writer still emits source characters/raw outlines and does not consume the shared shaped run | compositor, editor export, Rust print | A visually plausible PDF can otherwise differ while retaining misleading ToUnicode metadata | compositor preflight for ligatures, non-Latin, rich/features/axes/spacing/manual edits with explicit searchability trade-off | compositor/export tests, PDF byte/artifact inspection |
| Native desktop route | Tauri outline conversion prefers `shape_text_command`, then local WASM on command failure | Live editor renderer remains Canvas2D; native PDF is a separate path | editor, engine, Tauri | A desktop-only control can appear to work while using a different face/metrics | injected adapter copies exact bytes once, reads face metrics, reports fallback | adapter contract/typecheck; Tauri GUI remains pending |

## Standards and implementation decisions

The following sources were checked on 2026-09-13. URLs are recorded so the
decision can be rechecked when specifications or bindings change.

| Source | Relevant finding | Decision supported |
|---|---|---|
| [OpenType registered features](https://learn.microsoft.com/en-us/typography/opentype/spec/featurelist) (OpenType 1.9.1 registry page; page updated 2024-05-31) | Registered tags include `liga`, `dlig`, `hlig`, `calt`, `rlig`, `salt`, `swsh`, `cswh`, `titl`, `ss01`–`ss20`, `cv01`–`cv99`, `smcp`, numeral/fraction features, and script-required tags. | Discover tags from the exact face; expose Boolean and indexed settings without fabricating unsupported features. |
| [OpenType feature behavior](https://learn.microsoft.com/en-us/typography/opentype/spec/features_ae) and [features F–J](https://learn.microsoft.com/en-us/typography/opentype/spec/features_fj) | `aalt` is a substitution feature, and contextual/script features are not interchangeable with a generic optional-ligature switch. | Preserve required/script shaping; make optional ligature changes local and explicit before separate letter manipulation. |
| [HarfBuzz shaping API](https://harfbuzz.github.io/harfbuzz-hb-shape.html) | Shaping consumes a buffer plus font, direction, script, language, and `hb_feature_t` ranges; overlapping features use the last feature. | Normalize every request before shaping; serialize feature ranges in source coordinates and define precedence. |
| [HarfBuzz buffer API](https://harfbuzz.github.io/harfbuzz-hb-buffer.html) and [cluster model](https://harfbuzz.github.io/clusters.html) | Output glyph infos/positions carry clusters; clusters are shaping/layout units, not user-visible characters. | Keep grapheme boundaries, caret stops, shaping clusters, and glyph count as separate concepts. |
| [HarfBuzz OT layout queries](https://harfbuzz.github.io/harfbuzz-hb-ot-layout.html) | GSUB lookup APIs can query/collect glyph alternates; feature/lookup metadata is face-specific. | A glyph browser may offer exact-face previews; alternate choices remain tied to font artifact, face, script, language, and range. |
| [HarfBuzz variation API](https://harfbuzz.github.io/harfbuzz-hb-font.html) and [variable-font guidance](https://harfbuzz.github.io/fonts-and-faces-variable.html) | Axes have min/default/max; setting variations replaces the font’s variation coordinates; named instances come from `fvar`. | Resolve one axis map once, clamp to actual face ranges, and never apply it twice or tie optical size to zoom. |
| [Unicode UAX #29](https://www.unicode.org/reports/tr29/) | Extended grapheme clusters are recommended user-editing units; code points do not equal user characters. | Selection, deletion, and direct manipulation use grapheme-aware source ranges while preserving UTF-16 DOM offsets. |
| [Unicode UAX #9](https://www.unicode.org/reports/tr9/) | Paragraph direction and visual order are resolved separately from source order. | Store the resolved direction, do not report LTR after automatic RTL inference. |
| [Unicode UAX #14](https://www.unicode.org/reports/tr14/) | Combining sequences affect line-break opportunities. | Line breaking and marks stay attached to their source/shaping cluster. |
| [CSS Fonts Level 4](https://www.w3.org/TR/css-fonts-4/) | `font-feature-settings` accepts numeric values; `@font-feature-values` maps font-specific indexes to names; required defaults include `rlig`, `liga`, `clig`, `calt`, `locl`, `ccmp`, `mark`, and `mkmk`; unsupported features are ignored. | Do not expose arbitrary numeric values as portable names; generic “disable ligatures” must not turn off required shaping. |
| [SVG 2 text](https://www.w3.org/TR/SVG2/text.html) | `<textPath>` positions glyphs along a curve’s baseline; that is not the same as deforming each outline. | Label path text as baseline placement and expose outline deformation as a separate bounded effect. |
| [WHATWG Canvas](https://html.spec.whatwg.org/multipage/canvas.html) | Canvas has font kerning/stretch/caps/letter-spacing/word-spacing and direction members, but no portable glyph-ID drawing API or general feature-range IDL. | Use Canvas2D as a truthful source-run fallback; use HarfBuzz plus font outlines where glyph identity is required. |
| [rustybuzz API](https://docs.rs/rustybuzz/latest/rustybuzz/) and [ttf-parser API](https://docs.rs/ttf-parser/latest/ttf_parser/) | Installed Rust crates are rustybuzz 0.20.1 and ttf-parser 0.25.1; both support safe font parsing/shaping primitives. | Keep native shaping behind the same normalized contract and add explicit face/cluster tests. |
| [opentype.js](https://github.com/opentypejs/opentype.js) | Installed version is 2.0.0; useful for font parsing and outline commands, but its documented `getPath` feature support is limited and it is not the HarfBuzz glyph-ID layout seam. | Use it for contour extraction only after a shaped glyph array supplies glyph IDs; do not present `charToGlyph` as full shaping. |

Installed/runtime observations on this machine: Node `v22.23.2`, pnpm
`11.9.0`, rustc `1.97.1`, system HarfBuzz `14.4.0`, `harfbuzzjs 1.6.0`,
`rustybuzz 0.20.1`, `ttf-parser 0.25.1`, `opentype.js 2.0.0`, and
`wawoff2 2.0.1`. The repository’s declared AGENTS toolchain records Rust
1.97/Node 26 as the intended environment; this audit run used the available
Node 22 process and will state that limitation in validation results.

## Real-world failure patterns worth fixing

These are anecdotal user reports and product documentation, not normative
evidence. They identify failure modes that Varve can realistically avoid:

| Reported failure | Why users care | Varve response |
|---|---|---|
| [Illustrator Touch Type cannot split a ligature](https://community.adobe.com/questions-652/direct-selection-of-how-to-move-a-single-text-character-797423) | A designer wants to move one visible letter but the app treats the ligature as an indivisible object or requires a confusing workaround. | Keep the logical source; show cluster boundaries; offer an explicit local “separate optional ligature for editing” operation with undo and a warning when script-required joining would be damaged. |
| [Illustrator text-on-path can disappear after reopen](https://community.adobe.com/questions-652/text-on-path-curve-is-disappearing-after-reopening-the-file-in-illustrator-v27-7-804415) | A live path reference or transform is not stable across persistence. | Persist path node identity, side/flip/offsets, and operation order; validate missing/deleted paths and provide detach-to-baseline/outline recovery. |
| [Illustrator reports disappearing text when outlined](https://community.adobe.com/questions-652/text-disappearing-when-outlined-adobe-illustrator-27-7-804277) and [outline conversion reports](https://community.adobe.com/questions-652/illustrator-text-disappears-when-outlined-789732) | A destructive conversion can silently change or lose glyphs, especially in transformed, variable, or complex-script text. | Refuse conversion without exact font bytes/shaping support; retain a source copy option; compare source/shaped glyph counts and inspect exported paths. |
| [Figma users requested editable text on paths](https://forum.figma.com/suggest-a-feature-11/make-text-follow-a-path-or-a-circle-34880) | Plugin/raster workarounds lose editability and provide poor live preview. | Keep path text as text with live source editing and make outline bending a distinct destructive/derived operation. |
| [Figma OpenType alternates API is read-only](https://forum.figma.com/suggest-a-feature-11/writable-opentype-alternates-in-the-figma-plugin-api-51707) | A visible UI control is not useful if plugins/workflows cannot author the setting while preserving text. | Store semantic feature/range settings in the document, not only a preview glyph. |
| [Figma custom variable axes are not surfaced](https://forum.figma.com/suggest-a-feature-11/support-variables-for-variable-font-axes-e-g-round-width-weight-54572) | Named instances hide the actual expressive range of a font. | Read axes from the exact face, include custom tags, defaults, limits, and named instances, and show unavailable/mixed states. |
| [Figma users report inaccurate text-on-path centers](https://forum.figma.com/report-a-problem-6/index41.html) | Isolated-character remeasurement drifts from the shaped run, especially with kerning/ligatures. | Place path text from canonical shaped advances/clusters, never from independent character widths. |
| [Affinity users report feature availability confusion](https://forum.affinity.serif.com/index.php?%2Ftopic%2F57024-text-on-path-not-working%2F=) | A control that appears universal but is workspace/backend-dependent creates false expectations. | Capability UI names the runtime/font limitation and never reports color-font detection as color rendering. |

## Audit matrix and implementation plan

| Capability | Root cause | Affected layers | Fix | Verification |
|---|---|---|---|---|
| Feature Boolean/indexed/range values | Scene and engine maps reduce values to Boolean | scene schema, commands, shaping, UI, persistence | Add backward-compatible normalized settings and UTF-16 ranges; map to HarfBuzz/Rustybuzz feature ranges | Unit normalization, save/reopen, feature-on/off glyph IDs, mixed-selection UI |
| Correct live ligatures | Canonical painter draws source clusters individually | engine replay, layout, path text | Paint complete shaped source runs in Canvas fallback; use glyph-ID geometry when available | Replay semantic calls, pixel close-up, `fi/ffi`, contextual script corpus |
| Alternate browser | Metadata only lists tags; no exact glyph collection UI | font parser/registry, inspector | Add face-aware feature metadata and virtualized browser with insertion/apply distinction | Keyboard/a11y tests, exact-face fixture, preview cancel/history |
| Glyph-accurate outlines | `charToGlyph` ignores GSUB/GPOS | engine outline, scene conversion, export | Add shaped-glyph outline API; use glyph ID and offsets; refuse unsupported conversion | `fi/ffi`, Arabic, Devanagari, counters, transformed export |
| Variable axes | UI writes axes but Canvas only honors `wght`; double-resolution risk | font registry, engine, outline, export | Resolve one exact face/axis map; apply to shaping, Canvas CSS where possible, outlines, PDF | advance/outline/export parity at min/default/max/custom axis |
| Caret and direct manipulation | grapheme index is not durable after edits; ligature caret data absent | editor overlay, scene ops, layout | use UTF-16 source-range anchors and HarfBuzz ligature caret when available; explicit fallback | insert/delete/undo, ligature caret, combining/emoji/RTL tests |
| Text on paths | source strings are placed after isolated measurement; persistence failure modes | path layout, replay, scene codec | consume canonical clusters/advances, stable path refs, clear baseline-vs-bend label | circles/open curves/reversal/zero-length/deletion/reopen screenshots |
| Non-destructive deformation | existing warp is cluster approximation and not broadly exposed | warp/effects, renderer, inspector | bounded arc/bend/wave operation with source-edit mode and invalid-value rejection | handles/reset/extremes/export geometry |
| Appearance and effects | per-glyph paint paths can leave stale coverage/masks | replay/effects/export | invalidate on glyph coverage changes; preserve counters/fill rule and operation order | shadow/counter/clip/transparent-background visual and raster checks |
| Export/persistence honesty | native outline/PDF paths remeasure source characters | scene codec, Rust print, SVG/PDF/raster | share resolved shaped result or explicitly outline with exact glyph IDs; report editability/accessibility | artifact parse/render/text extraction; old-file migration |

Dependency-aware order and completed slices:

1. `6efb218d8` and `de0cd84d6` landed the shared feature-value/source-range
   contract and whole-run Canvas replay guard.
2. `00544184d` and `62d80db95` landed glyph-ID outline extraction, shaped
   conversion, provenance, multiline baselines, and refusal of incomplete data.
3. `339be47f5` integrated the Advanced Typography inspector, rich-span CSS,
   variable-axis controls, hover-preview cancellation, and explicit conversion.
4. `680c8ae89` and `542366ae2` repaired native feature/direction/cluster
   normalization and invalidation of edits after source changes.
5. `89aca9d0d` protected ligatures across replay, path, and deformation; the
   current export slice `8c335cd9b` rasterizes shaping-sensitive PDF nodes, and
   `163640101` connects desktop outline conversion to native shaping.
6. Remaining validation is the browser/UI screenshot, exported artifact,
   persistence and platform matrix described below; native Tauri GUI and
   physical ARM/low-memory testing are not available in this environment.

The pre-existing shared worktree means `pnpm verify:plan` currently selects
Tiers 0–4 and reports `FULL-SUITE ESCALATION: YES` for workspace/validation
impact. That is recorded as the repository baseline, not a reason to hide
unrelated failures. Feature changes will use narrow checks inside the inner
loop and the full gate only at the final foundational/schema checkpoint.

## Acceptance gates

- No UI setting is called supported unless the selected face/backend can honor
  it; unknown, loading, missing-font, mixed, and unsupported states are visible.
- Source text survives every non-destructive operation; glyph IDs are derived
  and invalidated by font artifact, face index, variation, feature, script,
  language, direction, and text revision changes.
- Outlining never succeeds with placeholder rectangles or missing font bytes.
- Canvas fallback paints shaped source runs; glyph-ID export uses actual
  substituted glyphs and positions, not source character lookup.
- Semantic assertions (text/ranges/features/history), geometry assertions
  (glyphs/advances/caret/bounds/transforms), and visual/artifact inspection
  all pass for the supported corpus.
- Browser Chromium validation is labelled as browser validation; it is not a
  claim about the Linux Tauri WebKitGTK runtime or physical low-memory/ARM
  hardware.
