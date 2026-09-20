# Comic lettering capability audit — 2026-09-19, updated 2026-09-20

## Scope

This audit covers the editable lettering system: turning existing text into a
balloon group, contour-aware fitting, tails, voice recipes, sound effects,
localization behavior, and the evidence used to call each capability built,
partial, deferred, or defective. It does not claim a complete comic publisher
or a dedicated lettering workspace.

## Capability matrix (verified 2026-09-20)

| Capability | Current evidence | Status |
| --- | --- | --- |
| Reuse existing text | `wrapTextInCallout` moves the selected `TextNode` into a group; it never copies or outlines the source; `callout.test.ts` asserts one text node remains | Built |
| Auto-width stacking | A ribbon of auto-width dialogue is capped to a lettering measure, converted to a fixed container, and fitted once; authored area text keeps its box | Built |
| Contour-aware wrapping | Line-width profile derived once in `@varve/shared/balloonTextLayout.ts`, iterated by both `resolveTextGeometry` and the engine `layoutText`; parity covered by `balloonWrapParity.test.ts` (natural dialogue, short lines, a German expansion) | Built |
| Balloon styles | Speech, thought, caption, whisper, shout recipes over ordinary group/body/tail nodes; kind defaults apply the line shape and switch it on style change | Built |
| Pointed tails | Editable endpoint, signed curve, base width; both sides bow toward a shared control point; tip fixed across fits | Built |
| Thought chains | Chain of decreasing circles sized from the chain's own spacing; last circle is the authored target; fit recomputes the chain | Built |
| Tail operations | Add, flip, remove logical tails; body and text identities preserved; each operation is one Inspector undo entry | Built |
| Fit and overflow | Bounded fixpoint fit (union pass, never clips, never shrinks type); `fit`/`near-overflow`/`overflow` status; a fitted body reports `fit` | Built |
| Text stroke parity | `paintCanonicalTextStroke` strokes wrapped text on the canonical line boxes; regression `replay.textStroke.test.ts` | Built |
| Comic document setup | Optional print, manga, and vertical-webtoon profiles supply editable defaults for page and export planning | Built foundation |
| Long-page export | Deterministic slice planning and publisher-limit validation exist; streaming export and final packaging remain separate work | Partial |
| Localization | Relationship survives a 4x dialogue expansion; overflow is reported and `Fit balloon to text` recovers; E2E capture `02-localization-*` | Built |
| Vertical/CJK | Vertical writing keeps logical text and rectangular wrap by design; contour columns are deferred | Partial (documented) |
| RTL | The shared Unicode/BiDi pipeline is unchanged; the contour profile is direction-agnostic per line. No comic-specific RTL E2E fixture yet | Partial (documented) |
| Sound effects | Editing text + stroke + warp + effects reuse; SFX remain `TextNode`s; no packaged SFX preset library yet | Built foundation |
| Joined balloons | Not modelled; multiple tails and grouped balloons are the current tooling | Deferred |
| Publisher delivery | Limits dated and source-linked; no automatic upload or claim of permanent platform compatibility | Partial |

## Visual validation (2026-09-20)

Captured by `tests/e2e/canvas/comic-lettering.spec.ts`, stored in
`docs/screenshots/comic-lettering/`:

| Capture | What it proves |
| --- | --- |
| `01-speech-balloon-inspector.png` | A 30-word dialogue stacks to four lines with the longest line mid-stack; the Comic balloon panel shows endpoint, curve, base width, fit, add/flip/remove |
| `02-localization-overflow.png` / `-recovered.png` | A one-word balloon re-lettered with a long German replacement reports overflow, then fits without recreating the balloon |
| `03-thought-balloon.png` | Thought style draws a separated chain of decreasing circles under the body |
| `04-lettered-panel-100.png` / `-fit.png` | A four-balloon panel at 100% and zoomed out; balloons stay legible as masses |
| `05-dark-*.png` / `05-high-contrast-*.png` | The balloon, Inspector, and canvas read in dark and high-contrast themes |

### Known visual defect: square corners on the live canvas

Observed in every capture and reproduced by pixel sampling: a speech balloon
body whose IR carries `cornerRadius: 28` renders with a sharp, straight top
edge (black from the left corner to the right corner at y=101 in
`04-lettered-panel-100.png`). A unit probe against the same document shows the
engine node carrying `cornerRadius: 28`, the built primitive carrying
`cornerRadius: 28`, and `replayIr` emitting `roundRect` + `fill` + `roundRect`
+ `stroke` for it. The live editor frame path therefore loses the radius
somewhere the probe does not cover. This is pre-existing (it affects every
rounded shape, not just callouts) and is recorded here rather than hidden;
fixing it is a follow-up outside the lettering slice.

## Performance (2026-09-20)

`pnpm bench:lettering` (`packages/scene/src/__benchmarks__/callout.bench.ts`),
Node 22, 3-round averages:

| Balloons | Contour layout (all texts) | Fit (all balloons) | Fit status |
| --- | --- | --- | --- |
| 1 | 0.13 ms | 0.34 ms | 0.13 ms |
| 20 | 2.10 ms | 5.49 ms | 1.20 ms |
| 100 | 3.50 ms | 11.40 ms | 3.56 ms |
| 500 | 11.82 ms | 1084.78 ms | 11.11 ms |

Layout is sub-linear per balloon (0.13 ms for one, 0.024 ms at 500) because a
balloon's text is short; fit is user-invoked and its 500-balloon cost is
dominated by the immutable node-map copy of the scene model, not the fit math.
Fit status is derived on demand and stays linear.

## Failure modes converted into requirements

The research pass (below) found recurring complaints in other tools. Each is
answered or explicitly deferred:

- Words cut or hidden, then manual balloon resizing → word-integrity wrapping
  with a visible overflow status and an explicit fit command.
- Padding and fit hard to predict → authored padding, one shared geometry
  derivation, and a status that never contradicts the fitted result.
- Tails hard to reshape without changing the balloon → logical tails with
  curve/width/flip/remove that preserve the tip and the body.
- Style changes replacing authored composition → kind changes preserve node
  identities, text source, and explicit wrap-shape overrides.
- Rasterization ending the edit path → composition stays text + vector nodes.
- Translated dialogue outgrowing the balloon → relationship survives,
  overflow reported, one-command recovery.
- Vertical CJK treated as rotated Latin → existing logical vertical path kept;
  contour columns deliberately deferred rather than faked.

## External evidence used

- [Clip Studio Paint balloon documentation](https://help.clip-studio.com/en-us/manual_en/540_comic/Balloons.htm)
- [Clip Studio Paint text wrapping guidance](https://tips.clip-studio.com/en-us/articles/835)
- [Clip Studio Paint: no balloon-shaped auto-wrap, mid-word breaks](https://www.reddit.com/r/ClipStudio/comments/bpp2u4/is_there_any_way_to_arrange_text_for_speech/)
- [Clip Studio Paint: balloon too big, no auto-fit to text](https://www.reddit.com/r/ClipStudio/comments/1ah9uut/making_speech_balloons_with_text_is/)
- [Clip Studio Paint: can't edit a tail separately](https://www.reddit.com/r/ClipStudio/comments/1ti8o03/how_do_i_edit_a_balloon_tail_separately_from_rest/)
- [Krita text tool complaints](https://www.reddit.com/r/krita/comments/1desk0u/am_i_just_missing_something_or_does_the_text_tool/)
- [Krita webcomic tooling discussion](https://www.reddit.com/r/krita/comments/1qsoro4/is_krita_any_good_for_webcomics/)
- [Blambot: comic book grammar and tradition](https://blambot.com/pages/comic-book-grammar-tradition)
- [Nate Piekos: properly stacking text in a dialogue balloon](https://www.reddit.com/r/comicbooks/comments/2i48y9/how_to_properly_stack_text_in_a_dialogue_balloon/)
- [WEBTOON CANVAS publishing checklist](https://webtoons-static.pstatic.net/creator101/en/pdf/Before-You-Publish-Checklist-2024.pdf?dt=2024011001)
- [Tapas episode publishing specification](https://help.tapas.io/hc/en-us/articles/1260802028970-Series-Basics-How-to-publish-a-comic-episode-on-Tapas)
- [Koharu: vertical CJK layout and why rotating horizontal text fails](https://koharu.rs/explanation/text-rendering-and-vertical-cjk-layout/)
- [German compound words vs speech-bubble layout engines](https://dev.to/peterslab/german-compound-words-vs-speech-bubble-layout-engines-22ic)
- [Comic localization: 20–30% text expansion in bubbles](https://gtelocalize.net/comic-translation/)

## Validation commands used

```bash
pnpm vitest run packages/shared/src/balloonTextLayout.test.ts \
  packages/shared/src/textGeometry.test.ts \
  packages/engine/src/balloonWrapParity.test.ts \
  packages/engine/src/textLayoutSnapshot.test.ts \
  packages/engine/src/replay.textStroke.test.ts \
  packages/scene/src/callout.test.ts
pnpm vitest run packages/engine/src/text packages/engine/src/replay
pnpm bench:lettering
VARVE_E2E_PORT=1520 node scripts/quality/heavy-lease.mjs "e2e: comic lettering" -- \
  npx playwright test tests/e2e/canvas/comic-lettering.spec.ts --project=chromium --workers=1
```

All passed on 2026-09-20 (355 engine text/replay tests, 83 focused tests, 5 E2E
scenarios, bench within bounds). The engine workspace typecheck carries a
pre-existing failure in `packages/engine/src/lut/*.test.ts` at HEAD, unrelated
to lettering.
