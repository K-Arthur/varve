# Repository Documentation Truth & Modernization Audit

**Audit date:** 2026-09-02
**Scope:** repository documentation, release and CI guidance, architecture
orientation, public website claims, and current-state naming
**Status:** completed point-in-time audit

This audit records the truth pass that accompanied the September 2026
documentation modernization work. It is a historical evidence record; current
instructions belong in the linked architecture, development, quality, and
release documents.

## Executive result

The repository is in a healthy state for documentation-led maintenance after
the corrections in this audit. The public website's committed fallback data
now matches the published `v0.2.1` release, the current architecture has a
single entry point, and stale operational guidance was removed or corrected.
The website remains an Astro static site with 69 routes, and its release data
is generated from the published GitHub release rather than hand-maintained.

No product behavior or document schema was changed by this audit.

## Evidence reviewed

- Root entry points: `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, and
  `CHANGELOG.md`.
- The documentation index and current-state documentation under
  `docs/architecture/`, `docs/development/`, `docs/quality/`, and
  `docs/release/`.
- The dated audit/plan corpus, which is retained as historical evidence.
- Release workflows and scripts, including release manifest generation,
  website release-data fetching, checksums, SBOMs, signing, and deployment.
- Workspace manifests, product-status data, package/crate boundaries, and
  public website pages/components/data.
- Published GitHub release `v0.2.1` and its attached release artifacts.

At audit time, the documentation gate indexed 658 Markdown documents, 201
internal links, and 170 ADRs. These counts are evidence from the checker, not
permanent documentation requirements.

## Findings and actions

| Finding | Impact | Action |
|---|---|---|
| Website fallback release data was behind the published release (`v0.2.0` versus `v0.2.1`). | Local builds and public-facing fallback data could advertise stale artifacts. | Regenerated `src/data/release-manifest.json` and `public/updates/stable.json` from the published release using `fetch-website-release.mjs`. |
| Website documentation and agent guidance said the site had 64 or 42 pages. | Contributors could misread the deployment surface and test scope. | Updated the source-of-truth descriptions to 69 routes. |
| The old website-operations plan described a retired manual `public/releases.json` flow. | Release operators could follow a dead path. | Removed the obsolete plan and made `docs/release/website.md` the canonical release-data guide. |
| The production-build guide instructed contributors and CI to use Git LFS for models. | A clean checkout could follow invalid setup instructions. | Replaced the LFS flow with the bundled-asset verification script and documented the five currently bundled models. |
| The local workspace contains six ignored, downloaded runtime models beneath `apps/desktop/public/models/`. | The bundled-asset guard correctly rejects them because Astro/Vite would copy them into an installer if they were present at build time. | Recorded as local release hygiene debt; these files must be removed or kept outside `public/` before a production build. They are ignored and were not included in this audit's commits. |
| Current release strategy wording described the updater as not yet introduced. | Release readiness and beta behavior were ambiguous. | Documented the implemented infrastructure and the current unsigned/manual-download beta boundary. |
| A small set of current source comments still named old `strata-*` crates. | Search results and code navigation were misleading. | Corrected the comments; retained intentional legacy storage keys, file associations, migration paths, and historical documents. |
| Architecture entry points were distributed across root prose and older plans. | New contributors lacked a concise topology and change-routing guide. | Added `docs/architecture/overview.md` and linked it from root and the documentation index. |

## Canonical information architecture

- `README.md`: product identity, quick start, supported runtime, and major
  feature status.
- `docs/README.md`: documentation index and distinction between current
  guidance and historical records.
- `docs/architecture/overview.md`: runtime topology, package ownership,
  boundaries, data flow, and change-routing.
- `docs/development/`: contributor setup and development workflow.
- `docs/quality/`: validation strategy and test-selection policy.
- `docs/release/`: production builds, platform support, website release data,
  signing, and deployment.
- `apps/website/README.md`: website-local structure, tests, and generated
  release-data workflow.

The ADR index remains the historical decision record. This audit did not
rewrite or renumber ADRs, and it did not convert implementation plans into
current architecture guidance.

## Marketing website truth

The website is a separate Astro static content and release surface. Product
status and download claims are sourced from repository data and generated
release artifacts. The v0.2.1 refresh updated version, artifact sizes,
checksums, platform entries, SBOM references, and the stable updater feed as a
single generated operation. The website build and unit suite passed after the
refresh.

The public beta boundary remains deliberate: the application is downloadable,
but platform installer signing/notarization and automatic updater rollout are
not represented as complete where the release artifacts do not prove them.
Website copy must continue to avoid implying collaboration, browser parity,
mobile support, or signed installers beyond the current evidence.

## Validation record

Passed during this audit:

- `pnpm audit:docs`
- `pnpm audit:emoji`
- `pnpm audit:product-truth`
- `node scripts/release/website-release-data-check.mjs`
- `pnpm test:website`
- `pnpm build:website`
- `pnpm exec vitest run --maxWorkers=1 packages/engine/src/upscaleGoldenParity.test.ts`
- `pnpm typecheck:e2e` (rerun directly after the full-gate wrapper stopped at
  this step; passed)
- Commit checkpoints, including staged formatting, health, secret, contacts,
  docs, and import-boundary checks.

`node scripts/release/check-bundled-assets.mjs` was also run and correctly
failed in this shared workspace because six ignored runtime-download models are
present under `apps/desktop/public/models/`. A clean checkout does not contain
those files. The failure is retained in the record because a production build
must not proceed with them in the public asset tree.

`pnpm verify:plan` was run against the shared worktree. It selected a broad
affected closure because other concurrent editor, UI, and E2E changes were
already present, and escalated to the full gate. The full gate ran formatting,
linting, architecture checks, audits, and all workspace package typechecks, but
its chained E2E typecheck step returned exit 1 without diagnostics. The exact
`pnpm typecheck:e2e` command was then rerun and passed. The gate therefore did
not reach the full Vitest/Cargo suites, browser E2E matrix, native GUI matrix,
packaging, signing, or benchmark lanes; those remain appropriate for their own
integration or release checkpoints.

## Deferred debt and risk register

1. Platform support confidence still depends on real GUI validation on the
   documented Tier 2/Tier 3 operating-system matrix. Local Linux evidence does
   not substitute for Windows and macOS hardware coverage.
2. Platform installer signing and macOS notarization remain credential- and
   release-environment-dependent. The release pipeline has the checks and
   report surfaces, but the website must not imply completion without signed
   artifacts.
3. The bundled-asset gate is red in this workspace until the six ignored
   runtime-download models are removed from `apps/desktop/public/models/` or
   the runtime cache is relocated outside the public asset tree. This is a
   release-environment issue, not a committed-file change from this audit.
4. The committed website release files are intentional local fallback
   snapshots. Deployment refreshes them from the selected published release;
   a future improvement could add an explicit freshness check for the
   committed snapshot so local drift is detected earlier.
5. `apps/web` remains a non-shipping placeholder. Browser compatibility is
   provided through the shared facade and `/try` demo path, not a second fully
   supported web application.
6. Historical plans, audits, ADRs, licensing records, migration identifiers,
   and legacy file associations retain old product names or versions where
   that history is part of their meaning. They should not be mass-renamed.

## Commits

- `d702e7a11` — `docs: sync published release truth across website`
- `23e429b28` — `docs: establish current architecture entry point`
- `d19db5ce4` — `docs: refresh current build and legacy references`
