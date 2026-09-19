# Inspector Design Tab — Letter-Case Research Addendum (2026-09-19, pass 3)

> Pass-3 research addendum for the Inspector Design tab. It answers one
> question the pass-1/2 corpora left open: **should the Design tab set
> section titles and property labels in block capitals?**
>
> Pass-1 pinned the uppercase treatment (`docs/design-system/inspector-spec.md`
> §typography) and pass-2 weighed only the *size* of those labels
> (`inspector-design-tab-research.md` §D, "Uppercase micro-labels keep a
> 12px floor"). Neither pass evaluated the case transform itself against
> legibility research. The maintainer flagged the result as capital-letter
> overuse; this addendum records the evidence before the change.
>
> Finding ids: `RES-201`+ (pass 3). Verified facts carry a source URL;
> inferences are marked **[inference]**.

## 1. What the legibility literature actually says

### RES-201 — The science is size-dependent, not a blanket ban

- **Arditi & Cho, "Letter case and text legibility in normal and low vision"**
  (*Vision Research* 47(19):2499–2505, 2007; PMC2016788). Verified: size
  thresholds for identifying 5-letter strings were *lower* (better) for
  all-uppercase than lower/mixed case, and reading speeds were higher for
  uppercase at an acuity reserve of 2 (small text). **The uppercase advantage
  disappeared at the larger sizes** tested with normally-sighted readers
  (acuity reserve 10). The authors explicitly note the result contradicts
  Tinker's classic reading-speed work and that uppercase is "more legible,
  albeit less aesthetically appealing" only when point size is fixed and
  text is visually small. URL:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2016788/
- **Sawyer, Dobres, Chahine & Reimer (2017), summarised by NN/g** in
  "Typography for Glanceable Reading: Bigger Is Better" (2017-11-26).
  Verified: uppercase beat lowercase for *glancing at a single word in
  isolation*; the effect is essentially a size effect (lowercase letterforms
  are roughly ¾ the cap height). The same article states NN/g "generally
  don't recommend using all-caps text for longer passages where users consume
  multiple words… all-caps text can indeed contribute to reduced legibility
  and greater letter confusion", and advises larger headings rather than case
  changes. URL: https://www.nngroup.com/articles/glanceable-fonts/
- **Tinker (1963), cited in Arditi & Cho.** Verified from that citation:
  all-caps text is perceived at a greater distance but has a "retarding
  effect" on reading speed, especially over long intervals, and was preferred
  by only 10% of readers vs 90% for lower-case.
- **[inference]** A professional property panel is neither a passage nor a
  set of isolated glanceable words: labels are *scanned repeatedly* in
  competition with each other, and readers must distinguish long phrases
  ("Effective resolution", "Letter spacing (px)") as quickly as short ones.
  The isolated-word advantage of caps does not transfer to that task; the
  word-shape cost does.

### RES-202 — Accessibility style guidance is unanimous and unambiguous

- **GOV.UK content guidance, A to Z style guide** (fetched 2026-09-19).
  Verified: "DO NOT USE BLOCK CAPITALS FOR LARGE AMOUNTS OF TEXT AS IT'S QUITE
  HARD TO READ." and "Always use sentence case, even in page titles and
  service names." The Technical A to Z entry is stronger: "Do not use block
  capitals. It's an accessibility issue, and user research shows that it does
  not help users recognise and understand requirements."
  URL: https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/
- **GOV.UK Design in government, "Tips for creating good typography"**
  (2015-09-16). Verified: "DON'T USE BLOCK CAPITALS FOR LARGE AMOUNTS OF TEXT
  AS IT'S QUITE HARD TO READ. Block capitals are only acceptable if it's a
  constraint of the data being pulled into the service."
  URL: https://designnotes.blog.gov.uk/2015/09/16/tips-for-creating-good-typography/
- **Government Commercial Agency style guide, "How to write accessible
  content"** (fetched 2026-09-19). Verified: "Many readers with low visibility
  or dyslexia read by recognising the shape of the word instead of reading
  each individual letter. These readers will struggle to read block capitals…
  because it changes the usual shape of the letters"; "use sentence case for
  headings (not Title Case or CAPITALS)".
  URL: https://www.gca.gov.uk/government-commercial-agency-style-guide/writing-accessible-content
- **British Dyslexia Association Style Guide** (2018; reviewed by University
  of Southampton researchers). Verified: "AVOID TEXT IN BLOCK CAPITALS: this
  is much harder to read. For headings, use larger font size in bold, lower
  case." and "Avoid text in uppercase / capital letters and small caps, which
  can be less familiar to the reader and harder to read."
  URL: https://iped-editors.org/wp-content/uploads/2021/05/British-Dyslexia-Association-Style-Guide-2018.pdf
- **BDA-derived style guide (WordWise Dyslexia, 2023)**. Verified: "Avoid
  using capital letter and uppercase letters for continuous text. Lower case
  letters are easier to read."
  URL: https://www.wordwisedyslexia.com/_files/ugd/5e0f03_86eab40dc64d42c1895fe24ea5615f97.pdf

- **[inference]** These are practitioner style guides, not controlled
  experiments, and they target documents and web content rather than dense
  tool chrome. Their shared mechanism (word-shape recognition) applies to any
  surface read word-by-word, and Varve's panel is read by users who include
  the same low-vision/dyslexic population. The cost of following the
  convention is zero (the panel keeps its hierarchy through size and weight);
  the cost of ignoring it lands on the users least able to absorb it.

### RES-203 — What current professional tools do

- **Figma UI3** (Figma blog, 2024-06-26, "Inside the Redesigned Figma";
  Figma Learn "Navigating UI3"). Verified: the properties panel's hierarchy is
  carried by grouping, weight, and a label-visibility option rather than by
  block capitals; the redesign's stated goals included making the panel
  "easier to use" by improving "placement, grouping, and how they adapt to
  different contexts".
  URLs: https://www.figma.com/blog/behind-our-redesign-ui3/ ,
  https://help.figma.com/hc/en-us/articles/23954856027159-Navigating-UI3
- **Figma forum, "Make component property nested section titles darker
  (UI3)"** (2024-era thread). Verified complaint: when only font-weight
  separates section headers from property names, "the sections blend into the
  list of component props". **[inference]** This is the real failure mode to
  avoid after removing caps: if hierarchy relied on caps alone, removing them
  would flatten it. In Varve, section titles keep 13px/700 + full-strength
  text color over 12px/600 muted labels, and card containment separates
  sections — the case transform was redundant emphasis, not the only cue.
- **Sketch Inspector** (sketch.com docs; "What's New"). Verified: sections
  and property labels render in sentence case with weight/size hierarchy; no
  uppercase transform is part of the Inspector's type contract.
  URL: https://www.sketch.com/docs/
- **Penpot** (community.penpot.app thread 248, recorded in pass-2 research
  §A4) reports right-panel *clutter* as its top complaint; uppercase is not
  part of its answer to it.

## 2. Why Varve's current usage exceeds any defensible uppercase role

Measured from the pass-2 baseline corpus (`reports/inspector-redesign/baseline-matrix/`,
2026-09-19 05:11–05:25) and a code census at HEAD (`git show HEAD:…`):

- 29 `text-transform: uppercase` declarations in the Design-tab stylesheets
  (23 in `inspector.css`, 6 in section stylesheets).
- The transform applied to **every section title** and **every property
  label** — the two highest-volume text roles in the panel — plus micro
  labels, badges, legends, and category chips.
- The transformed strings are frequently multi-word phrases
  ("EFFECTIVE RESOLUTION", "LETTER SPACING (PX)", "POSITION & SIZE",
  "COGNITIVE LOAD"), i.e. exactly the case NN/g says all-caps hurts.
- 0 of the 29 sites were annotated as deliberate exceptions, and no token
  named the uppercase role; it was ambient, not a decision.

The uppercase transform was therefore **not a hierarchy device with a scope;
it was the default voice of the panel**.

## 3. Decision (adopted into `inspector-spec-pass3.md`)

1. Section titles, property labels, micro labels, badges, legends, and panel
   chrome render in their **authored case** (sentence case from the registry
   and section code); no `text-transform: uppercase` in Design-tab
   stylesheets.
2. Hierarchy is carried by size (13/12/11px), weight (700/600/500), color
   (primary/secondary/muted), and card containment — all of which already
   exist.
3. Letter-spacing compensation for caps is removed with the caps: the eight
   title rules move `--tracking-wide` (0.05em) → `--tracking-micro`
   (0.02em). `--tracking-micro` stays on labels: modest positive tracking is
   an evidence-backed legibility aid (BDA style guide recommends increased
   inter-letter spacing), and it is invisible at 0.02em.
4. Uppercase may return only as an explicit, annotated exception (e.g. a
   future data-constrained badge), enforced by `audit-inspector-css` rule E5.
5. Acronyms already authored in caps ("WCAG 2.1") are unaffected — removing a
   transform cannot and should not change authored data.

## 4. What was rejected and why

| Candidate | Verdict | Reason |
|---|---|---|
| Keep uppercase for section titles only | Rejected | Titles are the longest strings in the panel ("Position & Size", "Object Filters"); the shape/reading cost is highest there, and the UI3 complaint above warns that weight-only differentiation needs the *color* contrast Varve already applies. |
| Keep uppercase for ≤3-character labels (X/Y/W/H) | Rejected as a rule | The letters are already authored in caps; a rule with a length predicate would be unenforceable in CSS and would reintroduce ambient casing. |
| Add a user preference for label casing | Rejected | Same reasoning as pass-2's label-visibility rejection: an option multiplies theme/test surface with no demonstrated failure. The fix is one coherent default. |
| Restore "small caps" instead | Rejected | BDA explicitly lists small caps alongside uppercase as harder to read; it also lowers letter-height contrast. |

## Sources

All URLs fetched 2026-09-19 unless a publication date is given above.

- Arditi, A. & Cho, J. (2007). Letter case and text legibility in normal and
  low vision. *Vision Research* 47(19), 2499–2505. PMC2016788.
- Nielsen Norman Group (2017-11-26). Typography for Glanceable Reading:
  Bigger Is Better.
- GOV.UK content and publishing guidance. A to Z style guide; Technical A to
  Z style guide.
- GOV.UK Design in government blog (2015-09-16). Tips for creating good
  typography.
- Government Commercial Agency style guide. How to write accessible content;
  How to format your content.
- British Dyslexia Association (2018). Dyslexia Style Guide.
- WordWise Dyslexia (2023). Dyslexia Style Guide.
- Figma (2024-06-26). Inside the Redesigned Figma.
- Figma Learn. Navigating UI3.
- Figma Forum. Make component property nested section titles darker (UI3).
- Sketch. Documentation and What's New.
