# Website search and section links

**Date:** 2026-09-14
**Scope:** `apps/website` — documentation discoverability (site search, section
anchors), header trigger, 404-adjacent navigation, and the build pipeline that
produces them.
**Status:** implemented and verified locally; E2E runs against both build
variants through `playwright.website.config.ts`.

---

## 1. Findings (evidence before implementation)

The site shipped 104 built pages including ~50 docs, feature, support, and
learn pages with **no search of any kind**. `grep` for `pagefind`, `algolia`,
`docsearch`, `role="search"`, and `type="search"` over `apps/website/src` and
the built output returned nothing. The only navigation affordances were the
header dropdowns and the hand-maintained card index on `/docs`.

Section deep links were equally absent. Extracting heading ids from built
pages: `/docs/tools/typography` had 2 ids for 26 headings, `/docs` and
`/docs/keyboard-shortcuts` had 0. The two ids that existed were hand-written
for cross-page links. A reader could not share or bookmark a section, and no
result could target one.

Both gaps match documented complaints about comparable products:

| Source | Relevant finding | Decision |
|---|---|---|
| Bootstrap issue #41453 (May 2025); Homebrew issue #21577; mage-os devdocs #65; VueUse #5303 | Hosted Algolia/DocSearch deployments repeatedly return zero results or ignore URLs after index drift ("borderline broken", "search not indexed", "can't even search for a section name") | Build and ship the index with the site. No third-party search service, no crawler/index drift, no network dependency at query time |
| Algolia typo-tolerance documentation (accessed 2026-09-14) | "Tolerating typos is fundamental to modern search experiences"; ranking puts fewer typos first | Implement bounded Damerau-Levenshtein matching for title/heading tokens (one edit under 8 characters, two at 8+) |
| Figma forum threads (2026): "far too difficult to navigate", new left panel complaints; Adobe community thread (Apr 2026) | "Important controls are hidden or difficult to discover"; hidden long-press behaviours are "discovered by accident"; users "spend time trying to find" what they need | Put the search control in the persistent header with visible key hints (`/`, Ctrl/Cmd+K), not behind a hidden gesture; keep a visible "Browse all docs" fallback |
| WAI-ARIA Authoring Practices — combobox and dialog patterns; WCAG 2.2 AA (2.4.7 focus visible, 2.5.8 target size, 1.4.10 reflow) | Search with suggestions is a combobox controlling a listbox; modal dialogs trap and restore focus; Escape closes; targets need a 24×24 minima (44×44 preferred for touch) | Native `<dialog>` + `role="combobox"` input + `role="listbox"` results; Escape closes and focus returns to the invoking control; 44px rows on coarse pointers |
| Pagefind documentation and integration guides (2026) | Pagefind is the standard Astro/Starlight static-search choice, but loads WebAssembly in a worker | **Rejected**: the site ships a strict CSP (`script-src 'self' 'unsafe-inline'`, no `wasm-unsafe-eval`, no `worker-src blob:`) and Layout.astro documents that "the default build permits no third-party script or connection at all". Weakening the CSP and adding a ~1 MB WASM payload for 101 pages was not a good trade. `docs/release/website.md` records the alternative |

### Prioritized issues

1. **No site search** (blocks finding content on a 104-page site) — fixed.
2. **No section anchors** (blocks deep links, search targeting, and citation) —
   fixed.
3. **`sr-only`/`aria-hidden` duplicate text and undecoded entities in indexed
   text** (found during implementation: `Available Available`, `&amp;`,
   `&harr;`, `&mdash;`) — fixed in the extractor and guarded by an integrity
   report at build time.
4. 404 page offers only "Go Home"/"Documentation" — the search dialog is now
   reachable from every page including 404 (the header renders there); no
   further 404 change was needed for this slice.

## 2. What was built

**Build pipeline** (`astro:build:done` integration in `apps/website/astro.config.mjs`
calling `apps/website/scripts/search-index.mjs`):

- Injects stable `id`s on every `h2`/`h3` inside `<main>` (1,021 anchors
  across 101 pages), preserving hand-written ids and de-duplicating against
  every existing id in the document (`overview`, `overview-2`, …).
- Writes `search-index.json` at the output root: versioned, page → sections
  with heading, anchor, and plain text. ~629 KB on disk, ~520 KB of text.
  Served lazily; a visitor who never opens search downloads none of it.
- Fails the build below 5 indexed pages (a silently empty index must not
  ship) and logs any undecoded named entity left in indexed text.
- Runs for both build variants (custom domain and the GitHub Pages base
  path) because it is a build hook, not a shell step.

**Client** (`packages/editor`-independent, no new dependencies):

| File | Role |
|---|---|
| `src/lib/search/types.ts` | Versioned index/result contract |
| `src/lib/search/extract.ts` | Pure HTML → sections + anchor transform; entity decoding; `aria-hidden` removal; slugging |
| `src/lib/search/rank.ts` | Pure ranking: title/section/body scoring, phrase bonus, AND terms, bounded Damerau-Levenshtein typo tolerance, snippet window |
| `src/components/SearchDialog.astro` | Native `<dialog>`, combobox + listbox, lazy fetch, prefetch on idle (skipped for `saveData`/2g/3g), loading/no-results/error states, keyboard and pointer paths |
| `src/components/SiteHeader.astro` | Desktop header trigger with `/` hint; "Search docs" row in the mobile sheet |
| `src/layouts/Layout.astro` | One dialog per page |

Both triggers are hidden until the search script marks the document ready, so
a failed script never leaves a dead control. The dialog opens with `/` or
Ctrl/Cmd+K, focuses the input, announces result counts through a polite live
region, supports Home/End/arrow navigation with `aria-activedescendant`, and
restores focus on close to the invoking trigger (falling back to the visible
trigger, then the mobile menu button, when the opener was in the mobile sheet).

## 3. Verification

Commands actually run:

```bash
pnpm vitest run apps/website/src/test/search.test.ts        # 34 tests, passed
pnpm --dir apps/website exec astro check                    # 0 errors
pnpm test:website:e2e                                       # full suite, both variants
node scripts/quality/heavy-lease.mjs website-e2e -- pnpm test:website:e2e
pnpm --filter @varve/website typecheck                      # pre-existing error below
```

Full-suite certification (`TMPDIR=<writable dir> npx playwright test -c
playwright.website.config.ts --workers=2`, both the GitHub Pages and
custom-domain projects): **544 passed, 0 failed**, including the 12 search
tests, every visual baseline, contrast/visibility, reflow at 320 px and
200% text, touch targets, and axe scans.

Earlier in the session the same run reported 540 passed / 4 failed: two
stale content assertions in `depth-aware-effects-feature.spec.ts` (copy
rewritten by the depth-aware work already on `master`) and two long-capture
snapshot crashes under a full `/tmp` tmpfs. Both causes are documented
below; the assertions were aligned with the committed copy and all
baselines were regenerated and inspected.

Real-corpus query check (built index, Node 22, this machine): 20 queries
including `cmyk`, `print pdf`, `background removal`, `variable fonts`,
`chromeos`, `typoraphy`, `genrative`, `export svg`, `offline`; every query
returned relevant pages in 1.6–25 ms with the expected page first for exact
terms and typo queries resolving to the right docs.

Playwright (`apps/website/tests/e2e/search.spec.ts`, 12 tests) covers:
trigger open, real-term ranking with `<mark>` highlights, phrase ranking,
typos, `/` + arrows + Enter navigation, Ctrl+K toggle, Escape focus restore,
no-results message, an intentionally 404'd index showing the honest error
state, axe scan with the dialog open, anchor uniqueness and fragment landing,
390 px mobile sheet flow with zero horizontal overflow, and dark mode.

Visual review: the dialog was captured and inspected in light/dark at 1440 px
and 390 px, the header at 980/1100/1440 px, and a fragment landing on
`/docs/tools/typography#variable-fonts`. The heading anchors sit under the
existing `scroll-padding-top: 5.5rem`, so the sticky header does not cover
them.

### Visual baselines

The stored baselines predated committed content growth on the features,
typography, workspaces, touch-and-pen, and background-removal pages (full-page
heights grew by up to ~1,800 px), so those snapshots were already failing
before the header control. All 18 affected baselines were regenerated at this
revision, and each changed image was measured: old/new size, changed-pixel
count, and diff bounding box. The largest diffs (typography ~11,500 px tall,
features dark) and the homepage were opened and inspected; the new baselines
render the current content intact with the search control in the header.

`docs-light` also reflects a concurrent uncommitted docs index-link reorder
that was present in the worktree during capture; if that change lands
differently the baseline will need a refresh by its owner.

### Pre-existing failures not introduced here (evidence)

- `apps/website/src/test/tokens.test.ts` "contains no legacy or hardcoded
  colors" fails for illustration palettes that are unchanged from `HEAD`:
  10 raw declarations in `pages/features/canvas.astro` and 27 in
  `pages/docs/tools/grids.astro`. These are deliberate mock-artboard colors
  used in both themes; resolving them needs either a small theme-invariant
  illustration token set or an explicit, narrow exemption. Not changed.
- `pnpm --filter @varve/website typecheck` fails in
  `tests/e2e/generative-editing.visual.spec.ts` (`naturalWidth` on
  `HTMLElement | SVGElement`), a committed file owned by the generative-
  editing work. The new search spec type-checks clean.
- The two tests above were already red at `HEAD` (`40f330b26` revert restored
  these page palettes while the stricter token test stayed).

### Commits

| Commit | Contents |
|---|---|
| `76389639a` feat(website): search index and section anchors | `src/lib/search/*`, `scripts/search-index.mjs`, `astro.config.mjs`, 34 unit tests |
| `4947cbae0` feat(website): accessible site search | `SearchDialog.astro`, header triggers, Layout include |
| `ae4e98379` test(website): search/anchor E2E | 12 Playwright tests |
| `b7417f7cc` + `11db54720` test(website): stale feature assertions | depth-aware copy + snapshots, tone-rotation count |
| `a3e128a8f` test(website): visual baselines | 16 regenerated snapshots |
| `d618545af` + `f259776f6` fix(website): undefined tokens | `--surface-raised`, `--font-ui` in three pages |
| `16f33f06e` test(website): typography baseline | font-preview content from `f614c8048` |
| `a7e1e6785` docs(website): this record | README, website architecture doc, audit |

Each commit was staged through an isolated temporary index because the
shared index contained other agents' staged work; commits contain only the
paths listed above, and the shared index was left as found.

### Incident and repair (2026-09-14)

`/tmp` is a 12 GiB tmpfs and filled up during concurrent agent work. One of
this session's commits (`075bdcfe1`) was created from a truncated temporary
index at the moment `/tmp` hit ENOSPC and recorded a repository-wide
deletion. Another agent reverted it as `95337561c` within minutes; the
working tree was never modified, no file content was lost, and all earlier
commits in this series remain ancestors of `master`. The revert also
restored pre-change copies of two of this session's files, which were
re-applied in `f259776f6` and `11db54720`. Subsequent staging used an index
on the root filesystem instead of `/tmp`.

### Environment note for long visual captures

Two full-page snapshot tests (`typography page light`, `download page dark`)
failed in a full run with Chromium `Page.captureScreenshot` crashes
(`GPU process exited unexpectedly`). Playwright launches Chromium with
`--disable-dev-shm-usage`, so shared memory falls back to `$TMPDIR`; with
`/tmp` full, the very tall captures (typography is ~11,600 px) crash the
renderer. Re-running with `TMPDIR` pointed at a writable directory and
`--workers=1` passed. The typography baseline itself was stale for a
separate reason: `f614c8048` changed that page at 11:48, after the previous
baseline capture.

## 4. Deliberate decisions and qualifications

- **No third-party search.** See the table above; this also keeps the trust
  boundary intact (no new origin in CSP, no query data leaving the page).
- **No search analytics.** Queries stay in the tab. The site's consent-gated
  analytics adapter is untouched; search does not log query text anywhere.
- **Index text is limited to `<main>`**, with `nav`, `script`, `style`, `svg`,
  and `aria-hidden` subtrees removed. Header/footer/CTA boilerplate is not
  searchable, which is what keeps "docs" from matching every page.
- **Slugs keep non-Latin letters and `ß`** rather than transliterating; the
  corpus is English today and fragment ids are valid UTF-8.
- **The fuzzy matcher is currently duplicated** with the editor's layer
  search (`packages/editor/.../fuzzySearch.ts`). Both implement bounded
  Damerau-Levenshtein. Consolidating them into `@varve/shared` is worthwhile
  but touches an actively-changing package and is deliberately left as
  follow-up; `rank.ts` says so in place.
- **Search UI is English-only.** The index is built from English content;
  adding locales would need `lang`-scoped indexes.
- **Hardware/AT runs are not claimed.** The axe scan, keyboard paths, and
  viewport checks are Chromium automation. NVDA/VoiceOver/TalkBack and
  physical touch devices remain unverified, as in the 2026-09-02 platform
  audit.

## 5. Remaining work

- Consolidate the two Damerau-Levenshtein implementations into `@varve/shared`
  (editor + website) with shared tests.
- Decide the illustration palette policy for `canvas.astro` / `grids.astro`
  (37 raw declarations, pre-existing token-test failure): either a small
  theme-invariant illustration token set or a narrow, documented exemption.
- Fix the `naturalWidth` type error in
  `tests/e2e/generative-editing.visual.spec.ts` (generative-editing owner).
- Consider query-term synonym aliases (`pdf/x` ↔ `pdfx`, `pen` ↔ `stylus`) if
  observed searches warrant it; not added speculatively.
- Watch index size as the docs grow past ~200 pages; the linear scan is fast
  today but the JSON is already ~630 KB and would benefit from per-section
  chunking before it reaches ~2 MB.
- A 404-page "popular destinations" block could build on the search
  suggestions; not done because the header search is now available there.
- Visible "link to this section" affordances on headings (copy-link) were not
  added; ids alone make fragments shareable and reachable from search.
