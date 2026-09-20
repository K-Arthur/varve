# Comic lettering research synthesis (2026-09-19)

This research supports the comic, manga, and webtoon lettering work in Varve.
It deliberately includes failure reports, because a bubble that merely exists is
not a professional lettering workflow.

## Applications and workflows studied

- [Clip Studio Paint balloons](https://help.clip-studio.com/en-us/manual_en/540_comic/Balloons.htm)
  and [text in balloons](https://tips.clip-studio.com/en-us/articles/835): the
  mature reference workflow keeps balloon and text tools close, supports drawing
  a balloon over existing text, and treats tails as editable balloon operations.
- [Krita text flow](https://docs.krita.org/en/user_manual/working_with_text.html):
  the current text tool can flow text into a shape, expose shape padding, and
  move the shape independently. This is a useful separation of source text and
  container geometry, but it also increases the importance of a clear selection
  model.
- [MediBang text layers](https://medibangpaint.com/en/use/2023/11/protext/):
  text remains editable in the native document and becomes non-editable after
  rasterization. That is a good warning for SFX design: effects must not make
  rasterization the default escape hatch.
- [Illustrator area and path text](https://helpx.adobe.com/illustrator/using/add-text-work-with-type-objects.html),
  [type on a path](https://helpx.adobe.com/illustrator/using/creating-type-path.html),
  and [envelope distortion](https://helpx.adobe.com/illustrator/desktop/manage-objects/reshape-transform-objects/distort-objects-with-envelopes.html):
  professional vector workflows reuse one text model for area, path, and
  editable distortion. Overflow is visible rather than silently discarded.
- [InDesign text-frame style practice](https://community.adobe.com/questions-671/how-to-create-comic-book-word-balloons-in-indesign-easily-891546),
  Jessica Abel's [visual scripting workflow](https://jessicaabel.com/visual-scripting-using-indesign-to-write-comics/),
  and [Mike Armstrong's lettering workflow](https://mike-armstrong.com/blog/how-i-do-the-letters):
  repeatable object/paragraph styles, named story order, and a print-ready
  vector/text separation matter more than a special bubble object.
- [MediBang's manga tutorial](https://medibangpaint.com/en/use/2021/11/mangatutorialforbeginners08/),
  [Blambot-informed lettering conventions](https://tocomix.com/articles/lettering),
  and [letter-stack guidance](https://www.lettermycomic.com/blog/stacking-dialogue-and-balloon-shapes):
  line breaks are a visual composition decision, margins need consistency, and
  the longest line commonly sits near the middle of a round balloon.

## Recurring failures and what Varve can realistically solve

| Observed failure | Evidence | Varve response | Scope decision |
| --- | --- | --- | --- |
| Rectangular wrapping cuts words or creates ugly stacks | [CSP complaint](https://www.reddit.com/r/ClipStudio/comments/1ah9uut), [Tony Cliff's workflow notes](https://tonycliff.squarespace.com/blog/comic-lettering-in-clip-studio-and-photoshop) | Keep the canonical Unicode/word-aware layout, expose explicit fit and overflow states, and make fit a command rather than silent font shrinking | Implement now: fit policy and diagnostics. Defer contour-aware optimization until a measured layout contract exists |
| Balloon size, padding, and text alignment have to be repaired by hand | [CSP sizing complaint](https://www.reddit.com/r/ClipStudio/comments/1ul7omg/need_help_with_text-box-and-balloon-tool/), [professional spacing guidance](https://tocomix.com/articles/lettering) | Store padding in the relationship, fit the ordinary body around the existing text container, and preserve manual geometry after detach | Implement now |
| Text and balloon selection fight each other | [CSP users keeping text and balloons separate](https://www.reddit.com/r/ClipStudio/comments/1ah9uut) and [material replacement discussion](https://www.reddit.com/r/ClipStudio/comments/1j2p2lb) | Use a structured group with ordinary body, tail, and text children. Whole-object selection is the group; layer-tree/deep selection reaches children | Implement in the existing scene model; no second selection mode |
| Tails are hard to reshape or become detached after transforms | [CSP tail discussion](https://www.reddit.com/r/ClipStudio/comments/1ah9uut), [official tail tool docs](https://help.clip-studio.com/en-us/manual_en/810_subtools/B.htm) | Keep tail paths as children with explicit endpoints, update their base when fitting, and expose numeric fallback controls | Implement now; speaker-object targeting deferred |
| Changing a balloon style means deleting and rebuilding it | [CSP style replacement complaint](https://www.reddit.com/r/ClipStudio/comments/1j2p2lb) | Change the recipe/style while retaining node IDs and text source; allow explicit geometry detachment | Implement now |
| Effects push users toward outlines or raster pixels | [MediBang text-layer contract](https://medibangpaint.com/en/use/2023/11/protext/), [Illustrator envelope editing](https://helpx.adobe.com/illustrator/desktop/manage-objects/reshape-transform-objects/distort-objects-with-envelopes.html) | Use existing text strokes, effects, and warp. SFX remain TextNodes and only unsupported export targets may flatten with a warning | Implement/expose existing systems; no comic renderer |
| Localization expands dialogue dramatically | [webtoon localization workflow](https://feelslocal.com/blog/webtoon-bubble-fit-translation-workflow) | Preserve text/balloon relationships, keep fit explicit, and report overflow instead of shrinking text | Implement relationship persistence and status; batch translation UI deferred |
| Japanese and CJK text needs different breaks and direction | [Krita shape flow docs](https://docs.krita.org/en/user_manual/working_with_text.html), [CSP text docs](https://tips.clip-studio.com/en-us/articles/835) | Reuse Varve's existing writing mode, Unicode line-break, vertical layout, and ruby source ranges | Implement as an integration test surface; do not fork a CJK layout engine |
| Font browsing is a workflow bottleneck | [Krita font-picker complaint](https://www.reddit.com/r/krita/comments/1uac9q1/anyone_else_cant_get_the_hang_of_the_new_text_tool/) | Reuse the existing font browser and document font provenance; comic presets must not bundle unlicensed fonts | Improve existing typography only; no comic-only browser |

## Architecture conclusions

1. **Text remains authoritative text.** A balloon never owns a copy of the
   dialogue string. SFX use the same TextNode, stroke, effect, and warp systems
   as all other display type.
2. **A balloon is a structured group recipe over ordinary nodes.** The group
   records semantic relationship and authored policy; body, tail, and text are
   still regular scene nodes for rendering, hit testing, history, clipboard, and
   export. This takes the useful part of CSP's attached tail workflow without
   creating a fourth text renderer.
3. **Fit is explicit and reversible.** The initial policy is to preserve font
   size and line breaks, fit body geometry around the text container, and show a
   diagnostic when layout exceeds the usable interior. Any future auto-scaling
   path must be an explicit bounded command.
4. **The first quality bar is predictable composition, not automatic art
   direction.** The software may suggest or fit geometry, but it must not silently
   reword, shrink, move, or reorder carefully lettered pages.
5. **No Comic workspace is required.** The existing document profile, Print/Draw
   page surfaces, presets, and shared tools match the strongest competitor
   pattern: workflow defaults without hiding capabilities behind a mode.

## Feature admission matrix

| Feature | Evidence/user problem | Reuse | Cost | Decision |
| --- | --- | --- | --- | --- |
| Speech/caption callout group | Repeated manual text + balloon grouping | Scene group, shape, path, text | Medium | Implement |
| Editable tail with multiple endpoints | Tail reshaping and multi-speaker workflows | Path node + group relationship | Medium | Implement |
| Fit balloon to dialogue | Padding and expansion complaints | Canonical text geometry | Medium | Implement |
| Overflow/near-overflow status | Silent clipping and forced shrinking | Canonical layout metrics | Low | Implement |
| Thought, whisper, shout, caption recipes | Professional voice conventions | Ordinary stroke/fill/shape styles | Low | Implement as recipes |
| Contour-aware/diamond line optimization | High quality potential, but language-sensitive | Requires canonical layout extension | High | Defer; offer manual line control |
| Speaker-object target | Useful but hidden smart state is risky | Requires persistent target relationship | High | Defer |
| Joined balloons | Common and script-friendly | Multiple group members/connectors | Medium | Defer after core relationship is stable |
| Per-glyph jitter/radial SFX | Common display lettering, but easy to make slow | Existing glyph adjustments/warp | High | Expose existing warp; defer new effect |
| Automatic placement/AI lettering | Can destroy authored composition | No safe existing contract | High | Reject for core workflow |
| Full script editor/importer | Real need, but a separate product surface | Story metadata only | High | Decision gate; not part of core slice |

## Real-world scenarios required for validation

The browser scenario is intentionally not a synthetic “ellipse exists” fixture.
It must create editable text in the real editor, wrap it as a balloon, extend the
dialogue, fit it, inspect the selected group and its children, and capture light,
dark, narrow, and zoomed-out states. The scene/unit scenarios additionally cover:

- four dialogue balloons with different lengths and multiple tails;
- a longer localization replacement with the same text identity;
- vertical Japanese text with punctuation and a ruby annotation;
- SFX with a live text stroke and warp configuration;
- a transformed parent and a detached custom tail;
- copy/serialization and undo grouping at the document boundary;
- a 15–25 balloon page and a webtoon slice plan without full-height bitmap
  allocation.

The remaining scenarios are recorded as deferred gates rather than claimed as
complete until the corresponding frontend/export surfaces exist.

## Failure research pass (2026-09-20)

This pass deliberately looked for what other tools get wrong, not for feature
lists. Each finding is paired with what Varve does about it.

### Balloon-shaped wrapping does not exist where users expect it

- Clip Studio Paint's "Wrap text at frame" wraps to the **text frame**, not the
  balloon; users report that resizing the balloon leaves the text box
  unchanged, and that Western text is broken mid-word because the frame wrap is
  character-based ([r/ClipStudio](https://www.reddit.com/r/ClipStudio/comments/bpp2u4/is_there_any_way_to_arrange_text_for_speech/),
  [r/ClipStudio](https://www.reddit.com/r/ClipStudio/comments/qbtein/does_clip_studio_have_word_wrap_in_speech_bubbles/)).
  A user asking for text that "fits to the shape of a balloon" was told the
  feature does not exist.
- There is no balloon-to-text auto-resize: "That would be handy feature, but
  one Celsys hasn't implemented" ([r/ClipStudio](https://www.reddit.com/r/ClipStudio/comments/1mgr9ns/is_there_any_way_to_auto_resize_text_inside_a/)).
- Varve response: a contour profile derived from the actual line count, applied
  by the same canonical layout used for selection and paint; word integrity is
  preserved and a whole word moves to a wider line rather than breaking.

### Fitting is unpredictable and silently ruins type

- Users describe the balloon ending up too big, word wrap making text
  invisible, and letters being cut instead of wrapped
  ([r/ClipStudio](https://www.reddit.com/r/ClipStudio/comments/1ah9uut/making_speech_balloons_with_text_is/)).
- Typography guidance treats a balloon whose text touches the edge, or that
  distorts to fit badly composed text, as a layout failure
  ([Graphic Novel Authority](https://graphicnovelauthority.com/lettering-in-graphic-novels)).
- Varve response: fit is explicit, bounded, never reduces the font size, and
  reports `overflow` before silently clipping; a fitted body reads as `fit`.

### Tails are welded to the balloon in practice

- CSP users cannot edit only the tail's stroke, cannot move the tail to another
  layer, and find that selecting the balloon selects the tail
  ([r/ClipStudio](https://www.reddit.com/r/ClipStudio/comments/1ti8o03/how_do_i_edit_a_balloon_tail_separately_from_rest/)).
- Tail taper is the only length control for connecting balloons; users are told
  to add and drag control points by hand
  ([r/ClipStudio](https://www.reddit.com/r/ClipStudio/comments/11yv669/is_there_a_way_to_adjust_the_speech_bubble_tail/)).
- Professional convention: a standard tail points at the mouth and stops
  50–60% of the way to the head; thought tails are at least three decreasing
  circles aimed at the head ([Blambot](https://blambot.com/pages/comic-book-grammar-tradition)).
- Varve response: the tail is a child node with a logical record; curve, width,
  flip, and remove are first-class, thought chains are real circles, and the
  tip stays fixed across fits.

### Text tools are the reason artists leave (Krita)

- The Krita text tool is repeatedly described as a slog with a popup editor,
  no dynamic boundary resizing, broken reflow, and performance problems; some
  users recommend Inkscape for comic text
  ([r/krita](https://www.reddit.com/r/krita/comments/1desk0u/am_i_just_missing_something_or_does_the_text_tool/),
  [r/krita webcomics](https://www.reddit.com/r/krita/comments/1qsoro4/is_krita_any_good_for_webcomics/)).
- Varve response: no separate comic renderer; balloon text is the normal
  editable text node edited in the existing overlay, with the existing
  typography inspector.

### Localization breaks hand-lettered pages

- English/German/French expansions of 20–30% (and more for compounds) are
  documented across localization vendors; without layout-aware typesetting the
  text overflows or is shrunk to unreadable sizes
  ([gtelocalize](https://gtelocalize.net/comic-translation/),
  [DEV](https://dev.to/peterslab/german-compound-words-vs-speech-bubble-layout-engines-22ic)).
- Varve response: text and balloon relationship persists across replacement,
  overflow is visible, and recovery is one fit command; the parity tests
  include a German expansion.

### Vertical CJK cannot be faked by rotating horizontal text

- Rotation-based vertical text produces wrong advances, wrong punctuation, and
  fake column flow; the correct approach pushes direction into shaping and
  layout ([Koharu](https://koharu.rs/explanation/text-rendering-and-vertical-cjk-layout/)).
  Krita's community workaround for vertical Japanese is character-by-character
  positioning, which breaks editing
  ([Krita Artists](https://krita-artists.org/t/lazy-text-tool-plugin-and-japanese-vertical-text/28001)).
- Varve response: the existing logical vertical layout and replay are reused;
  contour columns are deferred rather than approximated, and vertical balloons
  stay rectangular today.
