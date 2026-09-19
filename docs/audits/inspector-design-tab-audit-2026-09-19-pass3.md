# Inspector Design Tab — Audit Addendum (2026-09-19, pass 3)

> Focused pass-3 audit. The pass-2 audit
> (`inspector-design-tab-audit-2026-09-19-pass2.md`, `IA-###`) stands as the
> architectural baseline; this addendum records **new findings** from a
> direct-maintainer report and a fresh census, plus the validation state of
> the pass-2 implementation units at the moment pass 3 took over.
>
> Finding ids continue the pass-2 sequence (`IA-028`+). Research ids resolve
> in `docs/research/inspector-design-tab-case-research-2026-09-19.md`
> (`RES-201`+).

## 1. New finding

### IA-028 — Capital-letter overuse (P1, maintainer-reported)

**Statement.** The Design tab sets *every* section title and *every* property
label in block capitals, plus micro labels, badges, legends, and category
chips. This is not a scoped hierarchy device; it is the panel's default voice.

**Census (HEAD at pass-3 start).**

| Location | `text-transform: uppercase` declarations |
|---|---|
| `inspector.css` | 23 |
| `sections/effectStudio.css` | 1 |
| `sections/smartFilters.css` | 3 |
| `sections/imageTuning.css` | 1 |
| `sections/effects/effects.css` | 1 |
| **Total** | **29** |

Roles affected: section/disclosure titles (7 rules), field labels (1 rule —
the highest-volume text role in the panel), panel title and sub-tabs (2),
micro labels, legends, badges, category chips, and group headings (19).
Strings transformed include multi-word phrases: "Position & Size",
"Object Filters", "Letter spacing (px)", "Effective resolution".

**Impact.** Block capitals remove ascender/descender word-shape cues; the
accessibility style-guide consensus (GOV.UK, GCA, British Dyslexia
Association) recommends sentence case for labels and headings, and the
glanceable-isolated-word advantage reported by Arditi & Cho / Sawyer et al.
does not transfer to a dense panel read word-by-word (`RES-201`/`RES-202`).
The transform was also redundant: section titles already carry 13px/700 +
primary text color over 12px/600 muted labels, separated by card
containment.

**Root cause.** The uppercase treatment entered as an un-tokenized default in
early inspector CSS, was pinned by pass-1 without a case rationale, and
pass-2 audited only label *size*. No gate measured case.

**Resolution.** See `docs/design-system/inspector-spec-pass3.md`:
remove the transform from all 29 sites; normalize title tracking
`--tracking-wide` → `--tracking-micro`; keep authored case; enforce with
`audit-inspector-css` rule E5 (error, with an annotated-exception marker).

## 2. Pass-2 implementation status at pass-3 takeover

The pass-2 plan (`docs/plans/inspector-design-tab-redesign.md`) recorded
IMPL-1..IMPL-5 as "pending". Pass 3 found **IMPL-1 and parts of IMPL-2/4
already applied in the working tree, uncommitted**:

| Unit | State at pass-3 takeover | Pass-3 action |
|---|---|---|
| IMPL-1 tokens: focus-ring geometry (`sizing.ts` + generated `tokens.css`) | applied, uncommitted | adopted and committed |
| IMPL-1 component tokens `--insp-icon-size(-lg)` / `--insp-row-height` | applied (inspector.css) | adopted and committed |
| IMPL-1 wrap-label line-height → `--type-interface-label-line-height` (IA-002) | applied | adopted and committed |
| IMPL-1 type ramp fixed rem (IA-021) + stale clamp comment removed | applied | adopted and committed |
| IMPL-1 gate E4/W2/W3/W4 + raw font-size literal removal | applied | adopted and committed |
| IMPL-2 icon-step normalization (W3) | **not applied** — 72 off-step icon-size sites remain in Inspector TSX (gate W3: 64 em-relative + 8 numeric) | deferred, recorded (§3) |
| IMPL-2 segmented selected-state unification (IA-012) | not applied | deferred, recorded |
| IMPL-2 Weight/Style row + ContrastIndicator (IA-010/011) | not applied | deferred, recorded |
| IMPL-3 pair-row trailing slot (IA-008) | not applied | deferred, recorded |
| IMPL-4 bounded layout repairs (IA-009/013/014/015) | partially applied (satellite CSS) | adopted; remainder deferred |
| IMPL-5 DocumentPanel numerics (IA-024) | not applied | deferred, recorded |
| Inspector-scoped literal-fallback removals (`var(--token, literal)` → `var(--token)`) | applied in working tree by the concurrent repo-wide token-hygiene workstream | adopted and committed (references only HEAD-defined tokens; verified) |

## 3. Deferred (unchanged from pass-2 unless noted)

- Icon-step normalization across 86 `size="0.85em"`-class sites: mechanical
  but layout-affecting per surface; needs its own visual-validation slice.
  Gate W3 keeps the inventory visible.
- `IA-012` one segmented selected-state, `IA-010/011` typography row
  alignment, `IA-008` pair trailing slot, `IA-024` DocumentPanel numerics:
  recorded in the pass-2 spec §9 map; not landed in pass 3.
- `IA-016` Image-section grouping, `IA-023` `prototype-flow` reachability:
  recorded product decisions.
- Storybook for editor-local primitives: documented deviation (pass-2 spec
  §7).

## 4. Accessibility state after pass 3

- `audit:inspector-css` — clean, including the new E5 block-capitals rule.
- `pnpm --filter @varve/ui audit:tokens` — 309/309 pairs pass across 3 themes.
- `pnpm --filter @varve/ui typecheck` — pass; `@varve/editor` typecheck fails
  on **pre-existing** errors across files this pass did not touch (Menubar,
  tools, workspace, scene-type consumers, and Inspector files such as
  `MockupsSection.tsx` whose working-tree state comes from concurrent
  workstreams). No changed file contributes a type error (changed files are
  CSS/token sources plus style-prop-only TSX edits).
- Unit lane: Inspector directory 79/83 files pass; 4 failing files were
  verified unrelated to this pass's changes —
  `VariableAxes.test.tsx`, `bgRemovalFeatures.test.tsx` (recorded
  pre-existing in the pass-2 report) and
  `AiToolsHintSection.test.tsx`, `ImageTuningSection.test.tsx` (fail at HEAD
  in files this pass did not modify; the ImageTuning failures are a
  `PhotoSourceSection` context-shape crash, the AiToolsHint failures are
  copy/name mismatches).
- Screen-reader and real-device lanes remain unperformed in this environment
  (honest gap, carried).

## 5. Enforcement added

`scripts/quality/audit-inspector-css.mjs` rule **E5**:

- Error: `text-transform: uppercase` in any Inspector stylesheet.
- Error: `font-variant-caps` set to anything but `normal`.
- Exception: the existing `/* audit-inspector-css: allow <reason> */`
  marker on the declaration line; the reason is required by convention so a
  future exception is a recorded decision.
