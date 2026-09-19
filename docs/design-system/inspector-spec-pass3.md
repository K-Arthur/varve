# Inspector Design-System Specification — Pass 3 (2026-09-19)

> Pass-3 amendment to the Inspector design-system contract. Read with
> `inspector-spec.md` (pass 1) and `inspector-spec-pass2.md` (pass 2); where
> this document conflicts with either, **this document wins** for the scoped
> typography contract. Everything else in the earlier specs stands.
>
> Derived from `docs/audits/inspector-design-tab-audit-2026-09-19-pass3.md`
> (`IA-028`) and
> `docs/research/inspector-design-tab-case-research-2026-09-19.md`
> (`RES-201`–`RES-203`).

## 1. The typography hierarchy (revised)

Pass-2 §1.4 pinned uppercase for section titles and labels. That pin is
**withdrawn**: it was never justified by a case study and it contradicted
accessibility style-guide guidance once audited (`IA-028`).

The Design tab's type contract is now:

| Role | Size | Weight | Case | Tracking | Color |
|---|---|---|---|---|---|
| Section / disclosure title | 13px (`--insp-value-size`) | 700 | authored (sentence/Title case from registry) | `--tracking-micro` | `--color-text-primary` |
| Subsection / group heading | 11–12px | 600 | authored | `--tracking-micro` | `--color-text-secondary` |
| Property label | 12px (`--insp-label-size`) | 600 | authored | `--tracking-micro` | `--color-text-muted` |
| Value / input text | 13px (`--insp-value-size`) | 400, tabular numerics | authored | normal | `--color-text-primary` |
| Micro label / badge / legend | 11px (`--font-size-2xs`) | 500–600 | authored | `--tracking-micro` | muted / semantic |
| Helper / hint | 11–12px | 400 | authored | normal | `--color-text-muted` |

Rules:

1. **No `text-transform: uppercase` in any Inspector stylesheet.** Case is
   authored in the registry/section code; CSS does not change the voice of
   the panel. Enforced by `audit-inspector-css` E5 (error).
2. **No `font-variant-caps` other than `normal`.** Small caps carry the same
   shape-recognition cost (`RES-202`).
3. `text-transform: capitalize` remains permitted only for normalizing
   machine enum values (mask type, swatch role, tab ids); it must never
   transform user content.
4. **The hierarchy must survive without caps.** Size (13/12/11), weight
   (700/600/500), color (primary/secondary/muted), and card containment are
   the hierarchy carriers. A future change that flattens any of these may not
   lean on case to restore it.
5. **Tracking is a legibility aid, not a caps compensation.** `--tracking-wide`
   (0.05em) was used under caps; mixed-case titles move to
   `--tracking-micro` (0.02em). Labels keep `--tracking-micro` (BDA guidance
   supports modest positive tracking for dyslexic readers).
6. **Acronyms authored in caps stay.** Removing a transform does not rewrite
   authored copy ("WCAG 2.1", "AI", "DPI"); such strings are data, not case
   styling.

## 2. Enforcement (R10 extension)

`scripts/quality/audit-inspector-css.mjs`:

| Rule | Level | Check |
|---|---|---|
| E5 | error | `text-transform: uppercase` (and non-`normal` `font-variant-caps`) in Inspector stylesheets |

Exception mechanism: the existing `/* audit-inspector-css: allow <reason> */`
marker on the declaration line. A future uppercase role must carry both the
marker and a stated reason in review, so the decision is recorded rather than
ambient.

## 3. Traceability

| Req | Findings | Implementation | Validation |
|---|---|---|---|
| Sentence-case hierarchy (no block capitals) | IA-028, RES-201, RES-202 | 29 declarations removed across 5 stylesheets; 17 title/micro rules retracked wide→micro | after-matrix `caseCensus` = 0 uppercase roles; gate E5 clean; before/after screenshots |
| Hierarchy independent of case | IA-028, RES-203 | no size/weight/color changes; card containment unchanged | measured type census vs baseline; visual inspection |
| Enforcement | IA-028 | gate E5 | `pnpm audit:inspector-css` |

## 4. Scope of this amendment

This spec governs the Inspector Design tab and its shared stylesheets. The
Audit-tab `insp-panel__score-issue-cat` uppercase rule lives in `editor.css`
(shared, concurrently edited) and is **not** covered; it is recorded as a
follow-up in the pass-3 report.
