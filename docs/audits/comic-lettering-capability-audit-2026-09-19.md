# Comic lettering capability audit — 2026-09-19

## Scope

This audit covers the first usable lettering slice: turning existing text into
an editable balloon group, changing the recipe, moving tails, fitting text,
and reviewing overflow. It deliberately does not claim a complete comic
publisher or a dedicated lettering workspace.

## Capability matrix

| Capability | Current evidence | Status |
| --- | --- | --- |
| Reuse existing text | `wrapTextInCallout` moves the selected `TextNode` into a group; it does not copy or outline the source | Built |
| Balloon styles | Speech, thought, caption, whisper, and shout recipes share the ordinary group/body/tail model | Built foundation |
| Tail editing | Tail endpoint fields, additional tails, base recalculation, and recipe detachment are available in the Inspector | Built foundation |
| Fit and overflow | Shared text geometry produces fit, near-overflow, or overflow status; fit-to-text grows the body without shrinking type | Built foundation |
| Sound effects | Existing text stroke, case, weight, alignment, and effect controls are reused | Built foundation |
| Comic document setup | Optional print, manga, and vertical-webtoon profiles supply editable defaults for page and export planning | Built foundation |
| Long-page export | Deterministic slice planning and publisher-limit validation exist; streaming export and final packaging remain separate work | Partial |
| Localization | Text remains editable and story metadata can be referenced; contour-aware fitting and speaker placement remain follow-ups | Partial |
| Publisher delivery | Limits are dated and source-linked; there is no automatic upload or claim of permanent platform compatibility | Partial |

## Failure modes converted into requirements

The research pass found recurring complaints around comic lettering tools:

- word wrapping that cuts or hides words, followed by manual balloon resizing;
- padding and fit behavior that is difficult to predict;
- tails that are hard to reshape without fighting selection or changing the
  balloon unexpectedly;
- style changes that replace rather than preserve the authored composition;
- rasterization that ends the editing and localization path;
- translated dialogue expanding beyond the original balloon;
- vertical and CJK text treated as rotated Latin text rather than logical
  writing modes.

Varve's first response is intentionally narrow: explicit fit policy, derived
fit status, reversible recipe geometry, ordinary editable scene nodes, and the
existing Unicode-aware text path. It does not attempt to guess speaker
locations or silently compress typography. The full evidence and source links
are in [`docs/research/comic-lettering-research-2026-09-19.md`](../research/comic-lettering-research-2026-09-19.md).

## Real-world acceptance scenarios

Before calling the workflow production-ready, validation must cover:

1. A natural dialogue sentence wraps without splitting a grapheme or silently
   reducing font size.
2. Replacing the dialogue with a longer translated sentence reports overflow,
   then succeeds through an explicit fit choice.
3. Moving a tail preserves its endpoint when balloon padding or body geometry
   changes.
4. A caption, whisper, thought, and shout retain ordinary text and path nodes
   after save/reopen and remain discoverable in Layers.
5. CJK vertical text and RTL text remain logical text, not rotated outlines.
6. A vertical episode is sliced deterministically and reports platform limit
   violations before encoded output is accepted.
7. A user can reach the creation and repair controls with keyboard navigation,
   and the fit state is announced as status text rather than color alone.

The first six are scene/export and browser-test responsibilities; the last is
covered by the Inspector contract and accessibility checks. Full publisher
delivery, contour-aware fitting, speaker anchors, joined balloons, and a
dedicated lettering workspace stay out of the current completion claim.

## External evidence used

- [Clip Studio Paint balloon documentation](https://help.clip-studio.com/en-us/manual_en/540_comic/Balloons.htm)
- [Clip Studio Paint text wrapping guidance](https://tips.clip-studio.com/en-us/articles/835)
- [Krita text tool documentation](https://docs.krita.org/en/user_manual/working_with_text.html)
- [MediBang editable text-layer guidance](https://medibangpaint.com/en/use/2023/11/protext/)
- [Adobe Illustrator area and path text](https://helpx.adobe.com/illustrator/using/add-text-work-with-type-objects.html)
- [WEBTOON CANVAS publishing checklist](https://webtoons-static.pstatic.net/creator101/en/pdf/Before-You-Publish-Checklist-2024.pdf?dt=2024011001)
- [Tapas episode publishing specification](https://help.tapas.io/hc/en-us/articles/1260802028970-Series-Basics-How-to-publish-a-comic-episode-on-Tapas)
