# Font semantic implementation audit — 2026-09-01

## Scope

This audit records the first implementation slice for semantic font
intelligence: ontology, provenance-bearing enrichment, local query parsing,
deterministic ranking, family relations, recommendations, user tags, legacy
tag migration, editor integration, and website messaging.

## Evidence

| Area | Evidence |
|---|---|
| Canonical data | `packages/engine/src/font/semantic/semanticTypes.ts`, `semanticEnrichment.ts`, `semanticCatalog.ts` |
| Ontology | 80+ stable namespaced tags, aliases, parent validation, and ontology tests |
| Provider boundary | Shipped 2,100-family Fontsource snapshot; runtime metadata search is local; exact install remains explicit and version-pinned |
| Query/ranking | Hard constraints, soft preferences, exclusions, unknown state, metric ranges, availability, and family-reference relations |
| Recommendation lanes | Separate similarity, alternatives, and pairing functions with reason objects |
| User state | Versioned local storage for tags, project tags, hidden overrides, favorites, and recents |
| Migration | Legacy face tags group by normalized family and merge without mutating the legacy catalog |
| Editor | Compact selector searches installed semantic records only; full browser exposes natural-language interpretation, explicit install, reasons, coverage, license, personal tags, and distinct Similar / Alternatives / Pairings lanes |
| Website | Typography feature/docs pages explain intent search, provenance, offline catalog behavior, and explicit desktop installs |

## Validation run

Passed:

- `pnpm --filter @varve/engine typecheck`
- `pnpm --filter @varve/editor typecheck`
- `pnpm exec vitest run packages/engine/src/font/semantic packages/editor/src/components/FontBrowser/FontSelector.test.tsx` — 13 tests
- `pnpm exec vitest bench --run packages/engine/src/font/semantic/semanticSearch.bench.ts`
- `pnpm --filter @varve/website typecheck`
- `pnpm audit:docs`
- `pnpm build:website`
- `pnpm build:website:pages`
- `pnpm exec playwright test tests/e2e/canvas/font-selector.spec.ts --project=chromium --reporter=list --grep "searches the installed|full browser"` — 2 passed
- `pnpm exec playwright test -c playwright.website.config.ts --project=ghpages --reporter=list --grep "typography page light" --update-snapshots` — 1 passed; baseline committed at `apps/website/tests/e2e/visual.spec.ts-snapshots/typography-light-ghpages-linux.png`
- `pnpm exec playwright test -c playwright.website.config.ts --project=ghpages --reporter=list --grep "typography page light|Font provider marketing copy"` — marketing assertions passed and the typography visual passed against the baseline

The full editor font-selector spec was also run once. Its first attempt
exposed an over-specific test assumption about a particular machine font; the
assertion was corrected to verify the shared contract (local search, no
provider metadata requests, no implicit install), and the focused rerun passed.

The semantic benchmark measured the 2,100-family snapshot on this machine at
approximately 9.4 ms mean for natural-language intent, 5.3 ms for hard
coverage/variable constraints, and 4.6 ms for exact family plus provider
constraint in the Node lane. These are engineering measurements, not a
quality claim about semantic relevance.

## Model decision

No font embedding or language model is shipped in this slice. There is no
representative, licensed specimen corpus or reviewed pairwise relevance set in
the repository that could justify a model-quality claim. The deterministic
baseline is measurable, explainable, offline, and small. A future local model
must pass the documented recall/precision, pairwise preference, latency,
memory, and footprint gate before it can become an additional ranking signal.

## Known gaps

- Most catalog families do not yet have measured glyph-shape vectors until
  local font bytes are parsed.
- Visual descriptors are bounded curated/derived signals, not universal truths.
- License display is informational and not legal advice.
- Rich editable facet controls, variable-instance browsing, and a reviewed
  pairing corpus remain follow-up work.
- Full repository validation and native desktop GUI matrices were not run;
  they are unrelated to this focused slice unless the impact planner escalates.
