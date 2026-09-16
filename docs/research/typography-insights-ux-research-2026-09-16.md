# Typography + Insights inspector UX research (2026-09-16)

Scope: the Design tab's **Typography** section (and its popovers — the font
picker, the OpenType panel, the binding menu) and the document-level
**Insights** section (review / contrast / spacing / naming / governance /
debt / linter tabs and their empty states). This record explains which
competitor behaviors were treated as evidence, which user complaints were
fixable in Varve, and which were deliberately left alone.

Method: first-party documentation where it exists; forum and community
threads only as evidence of failure modes, never as product guarantees.
Checked 2026-09-16. Prior records this builds on:

- `docs/research/font-typography-ux-research-2026-09-12.md` — font
  discovery, missing fonts, variable fonts, packaging.
- `docs/research/inspector-design-tab-competitor-failures-2026-09-15.md` —
  align/position/radius/image/mask/selection-color failures.
- `docs/research/inspector-design-tab-review-2026-09-15.md` — rendered
  measurement of the whole Design tab.

## 1. Typography panel failure modes users report

### 1.1 Units and terminology: "1% of what?"

The clearest, longest-running typography complaint in design tools is
letter-spacing and line-height expressed in a unit the user cannot map to
their code. Figma's percentage-based letter spacing produced a multi-year
thread with hundreds of votes: users cannot convert `1%` to pixels, junior
developers ship `letter-spacing: 1%` in CSS because of it, and number
variables cannot hold the percentage at all.

Sources:

- <https://forum.figma.com/suggest-a-feature-11/letter-spacing-should-not-be-percentage-based-33344>
- <https://forum.figma.com/ask-the-community-7/what-is-the-unit-of-the-number-variables-for-line-and-letter-spacing-26730>
- <https://forum.figma.com/suggest-a-feature-11/letter-spacing-variables-44313>

**Applied to Varve.** Varve already stores `letterSpacing` in px and
`tracking` per-mille of the em, and the controls show their units — but that
is exactly what created the next complaint: two adjacent rows, "Letter
spacing" (px) and "Tracking" (‰), with no statement of which one scales with
the font size. The 2026-09-16 change keeps both (removing either would lose a
real authoring capability), shows px and ‰ units on the fields, moves
tracking into the collapsed Advanced subsection, and adds one explanatory
line: tracking scales with font size; letter spacing is a fixed pixel
offset.

The same threads point at a word-spacing gap in Figma. Varve has no
word-spacing control either; unlike letter spacing it is not expressible
through the existing per-run model, so it is recorded as missing rather than
half-implemented.

### 1.2 Icon-only and single-letter controls

UX research across two decades is consistent: unlabeled icons are guesses,
and tooltips alone do not repair them, because tooltips do not exist on
touch and force an interrogation loop on desktop. Design tools keep
re-learning this at the icon level (Wix Studio's align-centre icons, Adobe's
distribute icons, FileMaker's resize-height icons).

Sources:

- Wikimedia Phabricator T95233 — unlabeled toolbar icons reduce usability.
- <https://forum.wixstudio.com/t/wix-studio-editor-ui-mistake-alignment-icons/78123>
- <https://community.adobe.com/questions-671/align-distribute-horizontal-vertical-centers-buttons-on-ai-id-ps-are-misleading-1616656>
- <https://community.claris.com/en/s/idea/0870H000000fyYXQAY/detail>
- <https://trevorcalabro.substack.com/p/every-icon-needs-a-label>

**Applied to Varve.** The Typography section used single letters where it
should not have: `L/C/R/J` for alignment, `T/M/B` for vertical alignment,
`U/S` for decoration, `Aa/AA/aa/A` for case, `Reg/Ital` for style. The
2026-09-16 change replaces them with the canonical alignment icon family
(named accessible labels plus tooltips), decoration icons, and
self-describing case labels (`None / ABC / abc / Abc`). Font style becomes
`Regular / Italic`. The rule kept from the research: an icon may replace a
label only when its meaning is the industry-standard glyph *and* the
accessible name and tooltip are present.

### 1.3 OpenType features: buried, ambiguous, or dishonest

Klim Type Foundry's "Towards an ideal OpenType user interface" is the
reference critique: show only the features the selected font actually
supports; do not use ambiguous icons; keep basic type controls separate from
OpenType features; and be honest about what a menu option does. Practitioner
threads add that features are easy to miss when nested under panel menus,
and that greyed-out features are the honest way to signal unsupported ones.

Sources:

- <https://klim.co.nz/blog/towards-an-ideal-opentype-user-interface/>
- <https://typedrawers.com/discussion/4211/why-my-opentype-features-are-not-visible-in-the-quick-access-dropdown-in-indesign>
- <https://www.reddit.com/r/graphic_design/comments/1utkr3/opentype_features/>

**Applied to Varve.** Varve already gates on font metadata and labels
features in plain language. Two gaps were fixed: the feature rows used a
**native `<select>`** (the repository forbids it, and it is visually and
accessibly inconsistent with the rest of the inspector — now the shared
`Select`), and required shaping features (`rlig`, `ccmp`, `locl`, `mark`, …)
were listed as permanently disabled rows under a "required for script
shaping" note. They are not user decisions; they are now hidden, and the
collapsed subsection header carries a count of features the user has
actually changed away from the font default ("2 on").

### 1.4 The panel shows the wrong rows for the current text

Photoshop's Properties panel has shipped repeated regressions where the
panel shows mask or shape controls instead of the properties for the
selected object (2021–2025 threads). The typography-shaped version of that
failure is offering controls that cannot act on the current text: vertical
alignment on point text (no box to align in), and vertical orientation on
horizontal writing.

**Applied to Varve.** Vertical alignment now renders only when the
selection has a text container (`textResizing !== 'autoWidth'`), and
vertical orientation only when the selection is written vertically. Both
properties remain fully editable the moment they become meaningful.

### 1.5 Dense panels are scanned, not read

Blender's own T54951 documents its properties editor as "hard to scan"
before it was reorganized. The pragmatic conclusion for a character panel is
that the common path (family, weight, style, size, line-height, alignment)
must not be separated by rows a designer touches once a year (list style,
overflow, text resizing, writing mode).

**Applied to Varve.** The Typography section keeps the seven-row spine
visible and moves eleven rarer rows into a single collapsed "Advanced
typography" subsection. A badge ("3 set") reports how many of those
properties the current selection already uses, so a collapsed subsection
still tells the truth about a layer that was authored with them.

## 2. Insights / review panel failure modes users report

### 2.1 False positives destroy trust faster than noise annoys

Design-lint and accessibility tooling lives or dies on precision. Published
failure reports:

- FigmaLint flagged fills inside SVG artwork as hard-coded values, creating
  "a lot of noise" until vector geometry was exempted.
- `design.md`'s orphaned-tokens rule fired on every MD3 semantic token in
  its own shipped examples — 33–43 warnings per example, zero true errors.
- A production a11y engine audit (`plumb`) reduced one reference site from
  686 findings to 361 by adding real-world guards; the remaining 325 were
  noise, not signal.
- Lighthouse's stale axe-core link produces a 12% false-positive rate and CI
  flakiness, which teams describe as training them to ignore the tool.

Sources:

- <https://www.figma.com/community/plugin/1521241390290871981/figmalint>
- <https://github.com/google-labs-code/design.md/issues/46>
- <https://github.com/aram-devdocs/plumb/issues/302>
- <https://johal.in/we-stopped-using-lighthouse-2026-accessibility-axe-40>

**Applied to Varve.** The review tab's "Auto-fix" button was removed: it
announced "Auto-fixing: …" and re-ran the scan without applying any fix.
A control that appears to repair but does not is the worst kind of review
noise. The real contrast auto-fix in the Contrast tab remains, because it
actually mutates the document. Review findings keep their honest evidence
line and their suppress action, and suppressions now have a visible count
and a Restore control so "dismissed" is never a one-way door.

### 2.2 Alert fatigue from tabs that lead nowhere

Accessibility tooling guidance converges on triage: don't present a wall of
findings, do present the ones that apply. The inspector version of a wall is
a tab bar whose tabs open onto "select a frame to see suggestions" or a
disabled primary button.

**Applied to Varve.** Insights tabs are filtered by applicability: Spacing
requires two or more selected layers, Names requires a selection, Auto
layout requires a selected frame, Prototype requires prototype data. The
active tab falls back to Review when its target disappears. Tabs the current
workspace treats as secondary (Spacing and Names in Design) stay reachable
through the More menu's Analysis and Quality groups instead of having no
entry point. "Similar layers" deliberately stays available with no selection
because its empty state is a working natural-language search field.

### 2.3 Jargon in navigation

Tab labels leaked internal identifiers: `review`, `audit`, `debt`,
`linter`, `similar`. "Audit" and "review" in particular name the same idea
twice while one of them is only WCAG text contrast. Labels are now
Review / Contrast / Spacing / Names / Governance / Design debt / Prototype /
Auto layout / Components / Similar layers / Linter.

### 2.4 Empty sections that claim to have content

An expanded disclosure whose body renders nothing is a small but real dead
end; the cognitive-load section had exactly this shape (a section header
whose indicator returns null at score 0). The Insights panel now renders the
cognitive-load disclosure only when the score is non-zero. The same review
made Insights a registry-managed section, so a user who never wants review
chrome can hide it like any other optional section.

## 3. Deliberate limits

- **Word spacing** is not added; the per-run model has no word-spacing
  channel, and a fake per-space letter-spacing workaround is exactly what
  Figma users complain about.
- **A live "N issues" badge on the collapsed Insights header** was
  considered and rejected: computing the full review on every document
  commit risks competing with interaction, and the cheap contrast-only
  count would misrepresent the panel's contents. The section remains
  collapsed by default with an honest title.
- **Auto-expanding Advanced typography** when a non-default property is
  detected was rejected for the same reason the badge was added: it fights
  the user's explicit collapse preference. The badge is the compromise.
- **Severity chips** only appear when the report actually mixes severities;
  a single-severity report cannot be narrowed by a filter.
- **Suite-wide type scale** changes are out of scope; this review uses the
  inspector's existing scoped scale.

## 4. Sources

Primary / first-party documentation:

- [Figma: Explore text properties](https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties)
- [Figma: Browse and apply fonts](https://help.figma.com/hc/en-us/articles/360041308034-Browse-and-apply-fonts)
- [Adobe: OpenType features](https://helpx.adobe.com/fonts/using/use-open-type-features.html)
- [W3C: ARIA combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [W3C: WCAG 2.2 SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

Community evidence (failure modes only):

- [Figma forum: letter-spacing should not be percentage based](https://forum.figma.com/suggest-a-feature-11/letter-spacing-should-not-be-percentage-based-33344)
- [Figma forum: word spacing feature](https://forum.figma.com/suggest-a-feature-11/word-spacing-feature-32876)
- [Figma forum: number-variable units for line and letter spacing](https://forum.figma.com/ask-the-community-7/what-is-the-unit-of-the-number-variables-for-line-and-letter-spacing-26730)
- [Klim Type Foundry: Towards an ideal OpenType UI](https://klim.co.nz/blog/towards-an-ideal-opentype-user-interface/)
- [TypeDrawers: OpenType features not visible in quick access](https://typedrawers.com/discussion/4211/why-my-opentype-features-are-not-visible-in-the-quick-access-dropdown-in-indesign)
- [Wikimedia Phabricator T95233: unlabeled toolbar icons](https://phabricator.wikimedia.org/T95233)
- [Wix Studio forum: alignment icons confusion](https://forum.wixstudio.com/t/wix-studio-editor-ui-mistake-alignment-icons/78123)
- [Adobe community: distribute icons are misleading](https://community.adobe.com/questions-671/align-distribute-horizontal-vertical-centers-buttons-on-ai-id-ps-are-misleading-1616656)
- [FigmaLint: hard-coded values inside SVG noise](https://www.figma.com/community/plugin/1521241390290871981/figmalint)
- [design.md issue #46: orphaned-tokens false positives](https://github.com/google-labs-code/design.md/issues/46)
- [plumb issue #302: real-world false-positive reduction](https://github.com/aram-devdocs/plumb/issues/302)
- [Lighthouse axe-core staleness and false positives](https://johal.in/we-stopped-using-lighthouse-2026-accessibility-axe-40)
- [Nielsen Norman Group: icons and labels](https://www.nngroup.com/articles/icon-usability/)
