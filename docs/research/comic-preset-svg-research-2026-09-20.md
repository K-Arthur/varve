# Comic preset and SVG asset research (2026-09-20)

This pass answers a direct question: can packaged bubble, text-effect, and SFX
presets — and the well-structured SVG art that exists online — improve the
comic workflow, and under what license can any of it ship?

Scope: balloon/word-balloon presets, display-text and sound-effect presets, and
the decorative vector shapes (bursts, action lines, halftone accents) those
presets need. It does not repeat the lettering failure research in
`docs/research/comic-lettering-research-2026-09-19.md`.

## Sources reviewed

| Source | What it offers | License | Usable as |
| --- | --- | --- | --- |
| [Openclipart](https://openclipart.org/detail/345672/comic-burst-speech-bubble-white) | Speech bubbles, burst bubbles, comic clouds, word-balloon sets | CC0 / public domain | Reference structure; derivation is unencumbered |
| [publicdomainvectors.org](https://publicdomainvectors.org/en/free-clip-art-speech-bubble) | 500+ speech-bubble vectors, rectangular and sketched variants | Public domain | Reference structure |
| [freesvg.org](https://freesvg.org/vector-graphics-of-vintage-comic-pow-sound-effect) | Vintage POW/BAM lettering, halftone phrases | Public domain (Openclipart origin) | Reference conventions |
| [Kenney assets](https://kenney.nl/support) | UI and emote packs with balloon-style vector sources | CC0 | Reference structure; attribution optional |
| [game-icons.net](https://game-icons.net/about.html) | Comic/impact icon set | CC BY 3.0 | Attribution required — not bundled |
| [FontToolbox Sound FX](https://www.fonttoolbox.com/fonts/sound-fx) | 75+ comic SFX as a dingbat font | Free for non-commercial use only | **Rejected** — non-commercial restriction |
| [LlamaGen Comic SFX Maker](https://llamagen.ai/tools/comic-sfx-maker) | Live-text SFX SVG export with outline, shadow, rotation, skew | Proprietary tool | Reference for control vocabulary only |

## What the well-structured SVGs actually teach

Reading the CC0/public-domain sets, the shapes people expect are
**parametric families**, not bespoke outlines:

- Speech balloons are a rounded rectangle or ellipse; thought balloons are a
  chain of decreasing circles; bursts are a star polygon with roughly 12–18
  points and an inner radius around 0.6–0.75 of the outer radius; clouds are
  the same star family with a shallow inner radius (0.85–0.95) so the points
  read as scallops rather than spikes.
- Comic action accents (impact bursts, speed lines) are generated from the
  same few parameters — point count, inner ratio, line count, spread, length —
  and every published pack varies those numbers rather than the topology.
- Halftone accents are a dot pattern, which Varve already has as a first-class
  screentone/halftone system.
- SFX lettering is display **type**: fill, thick contrasting outline, case,
  weight, and a transform (rotate/skew/warp). None of the good sources ship
  outlined glyphs as the editable form; the live-text tool above is explicitly
  a live-text SVG for that reason.

The structure that makes these files reusable is the parameterization. Copying
one vendor's fixed path would import a shape Varve could not resize, reflow,
recolor, or fit — and would put a third-party license in the document format.

## Decision

1. **Ship presets, not assets.** Bubbles, text effects, and SFX become preset
   registries over the existing scene/text/effect systems. No third-party SVG
   path data, fonts, or images are bundled. This keeps the comic workflow
   editable, resizable, theme-aware, and free of asset-license obligations.
2. **Derive bubble shapes natively.** Burst and cloud balloons use the engine's
   `star` geometry (point count + inner/outer radius), so they resize with the
   balloon and fit the text through the same canonical derivation as speech
   balloons. No new node kind, no path import.
3. **SFX stay editable text.** A sound effect is a `TextNode` with a preset
   style (weight, case, alignment, spacing, stroke) — never outlined glyphs and
   never a raster. This follows the existing `comic-workflow.md` contract.
4. **If third-party art is ever bundled**, the allowlist is CC0/public domain
   (Openclipart, freesvg, Kenney) with a bundled-assets license file; CC BY
   sources require in-product attribution, and non-commercial font licenses are
   disallowed outright.
5. **Action lines and halftone accents reuse existing systems** (path/pattern
   fills and the halftone engine) rather than importing decorative SVGs.

## Consequences

- The preset registries are small data tables with tests, not asset pipelines.
- Shape quality is bounded by the engine's star/polygon geometry; a future
  "import balloon outline as SVG path" feature is the escape hatch for authors
  who want bespoke outlines, and it would live on the ordinary path node.
- The `burst` and `cloud` kinds extend the semantic kind union; transcripts and
  dialogue ordering are unaffected because kind is a display convention, and
  speech-like kinds remain dialogue.
