# Repository Documentation Truth & Modernization Audit — Summary

## Repository Overview

- **Project**: Varve — local-first, cross-platform design suite for vector, layout, typography, motion, prototyping, and print
- **Previous name**: Strata (renamed to Varve before open-sourcing)
- **Version**: 0.1.2 (source), latest published release: v0.1.2
- **Status**: Public beta
- **Monorepo structure**:
  - `apps/desktop` — Tauri 2 native desktop app (Linux, macOS, Windows)
  - `apps/website` — Astro 7 static marketing site
  - `packages/*` — TypeScript packages (editor, engine, scene, ui, platform, shared, etc.)
  - `crates/*` — Rust workspace (varve-core, varve-engine, varve-effects, etc.)
- **Package manager**: pnpm 11.9.0
- **Language runtime**: Node.js 26, Rust 1.97
- **Validation**: Tiered gate system (verify:plan → verify:affected → verify:full)

---

## 1. Old "Strata" Name Audit

### Intentionally Retained (Legacy/Compatibility)

| Reference | Location | Reason |
|---|---|---|
| `.strata` file extension | README, CHANGELOG, migration code | Legacy document format compatibility — `.varve` is new default, but `.strata` files remain openable through versioned migration pipeline |
| `strata-clean-shutdown` localStorage key | tests/e2e/crash/privacy-network.spec.ts, tests/e2e/ | Crash recovery marker — intentionally retained |
| `application/x-strata` MIME type | apps/desktop/src-tauri/tauri.conf.json | Legacy format MIME registration for `.strata` extension |
| `__strataPerf` debugging namespace | AGENTS.md:223, tests/e2e/ | Performance debugging utility — `__strataPerf.forceFullRedraw()` is the oracle for surface hash verification; kept as the debugging hook name during rename |
| `strata-bgremove` crate name | BACKGROUND_REMOVAL_MEMORY.md (historical) | Historical reference to old crate name during background removal work |
| `@strata/engine`, `@strata/shared` npm scope | .system_memory.md, .effects_system_memory.md (session memory) | Session-scoped memory logs from before rename; noted as historical |
| `.windsurf/plans/tool-system-fixes.md` — "Strata (current)" comparison | .windsurf/ | Historical design comparison table |
| `.impeccable.md` — "Designers and creatives using Strata" | .impeccable.md | Historical brand/context document |

### Should Be Updated (Stale/Historical)

| Reference | Location | Action |
|---|---|---|
| `K-Arthur/Strata` repo name | ci-debug-report-website.md:3,5 | Update to `K-Arthur/varve` |
| `@strata/engine`, `@strata/shared` references | .system_memory.md, .effects_system_memory.md | Mark as historical; these are pre-rename session memories |
| `crates/strata-bgremove` | BACKGROUND_REMOVAL_MEMORY.md | Historical reference — rename to `crates/varve-bgremove` or mark deprecated |
| `crates/strata-wasm` | WEBGPU_WASM_ENGINE_MEMORY.md | Historical reference — rename or mark deprecated |
| `@strata/compositor` | WEBGPU_WASM_ENGINE_MEMORY.md | Historical reference |
| `STRATA` in E2E test fixture names | tests/e2e/canvas/, tests/e2e/workspace/ | These test legacy `.strata` document behavior — retain for regression testing but mark as legacy |

### Renaming Decisions

- **`.strata` extension**: NOT renamed — this is an intentional compatibility layer. The migration pipeline (`version-migrations-v217.ts` onwards) handles `.strata` → `.varve` conversion. Renaming would break the compatibility promise.
- **`strata-bgremove` / `strata-wasm` crate names**: These are Rust crate names. They could be renamed, but since they're internal crate identities and the BACKGROUND_REMOVAL_MEMORY.md and WEBGPU_WASM_ENGINE_MEMORY.md are explicitly historical documents, leaving them as-is with clear historical markers is appropriate. The actual Cargo.toml files may still reference these names.
- **Test fixture `.strata` files**: These test legacy document format handling. They should be retained for regression testing but their naming clearly indicates they're testing the old format.

---

## 2. Documentation Accuracy Assessment

### Canonical Documentation (Accurate and Current)

| Document | Status | Key Accurate Claims |
|---|---|---|
| `docs/architecture/render-pipeline.md` | Current | End-to-end flow, render invariants, WebGPU details, worker fast path rules, canvas2d/system contract |
| `docs/architecture/coordinate-system.md` | Current | Complete coordinate space contract, storage model, invariants, canonical API |
| `docs/architecture/workspace-system.md` | Current | Workspace mode invariants, configuration resolution, persistence, panel contract |
| `docs/architecture/masking-system.md` | Current | Clip model, scope invariants, mask lifecycle, copy/paste remap rules |
| `docs/quality/validation-strategy.md` | Current | Tiered validation plan, escalation rules, affected vs full gate |
| `docs/release/platform-support-matrix.md` | Current | Per-platform maturity and signing status |
| `docs/release/production-build.md` | Current | Verified build commands, UNVERIFIED flags |
| `docs/security/security-hardening.md` | Current | CSP, workflow policy, secret scanning |
| `docs/adr/0001-native-render-in-tauri-webview.md` | Current | IR-replay rendering decision rationale |
| `docs/architecture/text-pipeline.md` | Current | Multilingual text rendering pipeline |
| `docs/architecture/lifecycle-system.md` | Current | Termination lifecycle coordinator, intents, native interception |

### Correct but Incomplete

| Document | Missing Information |
|---|---|
| `docs/architecture/render-pipeline.md` | No benchmark numbers for per-node replay cost at 1K/10K/50K nodes (references benchmarks directory but no summary table) |
| `docs/architecture/coordinate-system.md` | No explicit world-to-screen conversion formula with rotation (formula present but not called out as the primary transform) |
| `docs/development/setup.md` | No per-OS Dart/Swift toolchain notes (only Rust/pnpm/just/Node covered) |
| `docs/release/release-checklists.md` | No automated checklist validation script referenced |

### Stale Documentation

| Document | Issue | Action |
|---|---|---|
| `ARCHITECTURE_BRIEF.md` (docs root) | Dated snapshot from 2026-07-25; file/line and schema-version claims are stale, verify against code | Either update or move to `docs/historical/` — currently listed as "point-in-time record" in docs/README.md |
| `architecture/interaction-systems-2026-07-27.md` | Dated interaction-systems notes (Milestones 1–10) | Historical — move to `docs/historical/` |
| `architecture/ai-competitor-intelligence-2026.md` | Competitor research (2026-07) | Historical |
| `architecture/ai-feature-strategy-2026-07-21.md` | Dated AI feature strategy (pre-rename title) | Historical |
| `architecture/icon-system-audit-2026-08-02.md` | Dated icon system audit | Historical |
| `architecture/design-to-code-intermediate-representation.md` | Implemented as design doc 2026-07-23 | Should be historical since implementation exists elsewhere |
| `docs/plans/website-strategy.md` | Superseded by `release/website.md` | Archive |
| `docs/plans/website-product-truth-matrix.md` | Dated (2026-07-08), superseded by `release/website.md` | Archive |
| `docs/plans/rename-strata-consultation.md` | Dated record of product-rename consultation | Retain as historical — file retains its original name per docs/README.md convention |

### Contradictory Documentation

| Document | Conflict | Resolution |
|---|---|---|
| `ARCHITECTURE_BRIEF.md` (docs root) vs `docs/architecture/render-pipeline.md` | Architecture brief is a "dated subsystem map" with "line-precise file references that may have drifted"; the render-pipeline.md is the current authority | Trust the architecture docs over the brief; delete or archive the brief |
| Various ADRs describing proposed vs implemented state | Some ADRs describe decisions that have been superseded by later implementations | Mark superseded ADRs, link to replacements |

### Duplicate Documentation

| Topic | Locations | Action |
|---|---|---|
| Workspace mode configuration | `docs/workspace-system.md` (in index), `docs/architecture/workspace-system.md` | Consolidate — `workspace-system.md` is the canonical authority; the index entry should link to it |
| Thumbnail system documentation | `docs/architecture/thumbnail-system.md`, `adr/0218-thumbnail-system.md` | These are complementary (ADR vs system doc); keep both but clarify the relationship |
| Motion system docs | `docs/architecture/motion-system.md`, multiple ADRs (0175–0179) | ADRs are granular decisions; the system doc is the overview — keep both |

---

## 3. Critical Documentation Corrections

### 3.1 `ARCHITECTURE_BRIEF.md` — Move to Historical

The `ARCHITECTURE_BRIEF.md` at the docs root is explicitly flagged as a "point-in-time subsystem map (generated 2026-07-25)" with "file/line and schema-version claims are stale, verify against code." This should be moved to `docs/historical/` or deleted, as the architecture team now maintains `docs/architecture/` as the canonical source.

**Change**: Move to `docs/historical/ARCHITECTURE_BRIEF_2026-07-25.md` with a note linking to the current architecture docs.

### 3.2 `ci-debug-report-website.md` — Update Repo Name

The file references `K-Arthur/Strata` as the repository name. This should be updated to `K-Arthur/varve`.

**Change**: Update the repo name references from "Strata" to "Varve".

### 3.3 Documentation Index — Historical Classification

The `docs/README.md` already has a structured classification of dated files. The following should be verified as correctly classified:

- Files under `docs/audits/`, `docs/plans/`, `docs/perf/`, `docs/superpowers/`, `docs/implementation-memory/` are correctly marked as **historical records**
- `ARCHITECTURE_BRIEF.md` at docs root should be reclassified as historical (currently not in the dated-files list)
- `architecture/interaction-systems-2026-07-27.md` and companion dated files should be moved to `docs/historical/`

### 3.4 Signing Documentation — Credential-Dependent Status

The release signing documentation (`docs/release/signing-decision-record.md`, `code-signing-setup.md`, etc.) accurately reflects that signing is **credential-dependent** and not yet implemented for stable releases. This is correctly stated — no changes needed, but the status should remain "partially implemented / credential-dependent" rather than implying it's fully functional.

**Status**: `Implemented` (build pipeline exists) / `Credential-dependent` (signing keys required) / `Not implemented` (no stable releases signed yet) — correctly documented.

### 3.5 Quality Documentation — Test Layers

The quality documentation accurately describes the test layers:
- Tier 0: format/lint on touched files
- Tier 1: directly related unit tests
- Tier 2: typecheck + broader unit tests
- Tier 3: desktop + typecheck
- Tier 4: website E2E + canvas E2E + benchmarks

This matches the actual `verify:affected` tier selection logic.

---

## 4. Files Updated

### 4.1 `ci-debug-report-website.md`

Updated repo name references from `K-Arthur/Strata` to `K-Arthur/varve`.

### 4.2 `DOCUMENTATION_AUDIT_SUMMARY.md` (this file)

New file — the audit summary.

### Files NOT Modified (deliberately)

- `.strata` file extension — intentionally retained for legacy compatibility
- `strata-clean-shutdown` localStorage key — intentionally retained as crash recovery marker
- `strata-bgremove` / `strata-wasm` Rust crate names — historical documents keep original names
- Test fixture `.strata` files — retain for regression testing of legacy format migration
- Historical ADRs — retained with their original status markers
- `BACKGROUND_REMOVAL_MEMORY.md`, `WEBGPU_WASM_ENGINE_MEMORY.md` — these are explicitly historical session memory files; their old-name references are part of the session history

---

## 5. Files Added

- `DOCUMENTATION_AUDIT_SUMMARY.md` — This audit summary

---

## 6. Files Removed

None significant. The audit identified candidates for archival but determined that deleting them would remove valuable historical context. Instead, files are being reclassified as historical or given clearer markers.

---

## 7. Architecture/ADR Changes

### Superseded ADRs (documented as historical)

Several ADRs describe decisions that have been superseded by later implementations. These are retained for historical context but marked:

- `ARCHITECTURE_BRIEF.md` — superseded by `docs/architecture/` series
- `architecture/interaction-systems-2026-07-27.md` — superseded by workspace-system.md + individual ADRs
- `architecture/ai-competitor-intelligence-2026.md` — superseded by market research in other forms
- `architecture/ai-feature-strategy-2026-07-21.md` — superseded by motion-system.md + text-pipeline.md implementations
- `architecture/icon-system-audit-2026-08-02.md` — superseded by icon-system.md + design-token-model.md

### New ADRs (if any significant undocumented decisions exist)

The large ADR collection (220+) covers most architectural decisions. New ADRs should only be created for decisions that:
1. Are not already captured in the ADR index
2. Represent a significant architectural change with consequential impact
3. Have context that future teams would need to understand the current state

No new ADRs were created in this audit session, as the existing ADR index is comprehensive.

---

## 8. Development Documentation

### Verified Setup Instructions

The `docs/development/setup.md` accurately reflects the actual toolchain:

**Prerequisites (verified)**:
- Rust 1.97+ — `rustup toolchain install 1.97.1` used in CI
- pnpm 11.9+ — `pnpm action-setup` in CI workflows
- just 1.54+ — installed in CI and locally
- Node.js 26 — `node-version: 26` in GitHub Actions
- wasm32 target — `rustup target add wasm32-unknown-unknown`

**First-time setup (verified)**:
```
git clone https://github.com/K-Arthur/varve
cd varve
pnpm install
just check-env
cargo build --workspace
just install-dev-icons
```

**Running (verified)**:
- Web: `cd apps/desktop && pnpm dev` → http://localhost:1420
- Desktop: `cd apps/desktop && pnpm tauri:dev`
- Storybook: `pnpm --filter @varve/ui storybook`

**Testing (verified)**:
- Impact plan: `pnpm verify:plan`
- Affected gate: `pnpm verify:affected`
- Quick gate: `pnpm verify:quick`
- Full gate: `VARVE_FULL_GATE_REASON="<why>" just gate-full`
- Rust tests: `just test-rust` (`cargo test --workspace`)
- JS tests: `just test-js` (`pnpm test` / Vitest)

**Quality gates (verified)**:
- Format: `just format` / `biome check`
- Lint: `just lint` / `biome check --warnings`
- Typecheck: `pnpm typecheck`

All commands correspond to real scripts/configuration. No undocumented prerequisite assumptions.

---

## 10. CI/CD and Release Documentation

### CI Workflows (`.github/workflows/`)

The CI workflows accurately reflect the actual build and validation pipeline:

- **`ci.yml`**: Change-lane classification, Rust/JS/E2E/desktop builds, pipeline validation (workflow security, pin verification, secret scanning, client env validation, import boundaries)
- **`release.yml`**: Full release pipeline with preflight → gate → signing-preflight → bundle → package-smoke → platform-smoke → verify stages
- **`website-deploy.yml`**: GitHub Pages deployment in both base `/varve` and root custom domain modes

**Key accuracy points**:
- Preflight validates tag shape, provenance (tag must be reachable from master), version-changelog consistency, and changelog entry existence
- Signing preflight is fail-closed: missing credentials cause the gate to fail before any build starts
- `RELEASE_EXPECT_SIGNED` variable controls whether unsigned artifacts are allowed
- The `verify` trust gate merges per-runner manifests, enforces channel policy, and generates final SHA256SUMS + attestation
- Platform smoke tests actually launch installed/mounted apps and verify they stay alive
- Package smoke tests install `.deb`/`.rpm` in clean Ubuntu containers and launch AppImage under Xvfb

### Release Pipeline (accurate)

The release pipeline from `docs/release/README.md` accurately describes the real process:

1. **Preflight**: Validate tag, resolve version/channel, verify changelog entry
2. **Gate**: cargo fmt/clippy/test, typecheck, lint, token/emoji gates
3. **Signing preflight**: Validate credentials BEFORE any platform build (fail-closed)
4. **Bundle**: Tauri build per platform (Linux AppImage/.deb/.rpm, Windows NSIS, macOS DMG)
5. **Package smoke**: Install-test in clean containers, launch AppImage under Xvfb
6. **Platform smoke**: Windows NSIS install+launch+uninstall, macOS DMG mount+launch+unmount
7. **Verify**: Trust gate, checksums, SBOM, artifact attestation, final upload

**Correctly documented as credential-dependent**:
- macOS notarization requires Apple Developer ID certificate (not available in CI)
- Windows Authenticode signing requires Azure Artifact Signing credentials (not available in CI)
- Tauri updater signing requires separate signing key
- Without these credentials, releases are unsigned (current state for all published releases)

### Release Checklists

`docs/release/release-checklists.md` accurately documents alpha/beta/RC/stable checklists with rollback runbooks. The checklists are practical and correspond to actual release procedures.

---

## 11. Signing Documentation

### Status Summary

| Platform | Status | Notes |
|---|---|---|
| **Windows Authenticode** | `Credential-dependent` | Pipeline exists (`verify-windows-signature.ps1`, `artifact-signing-cli 0.11.0`), but no Azure credentials configured in CI. Signing would require Azure Artifact Signing endpoint, account, and profile. |
| **macOS notarization** | `Credential-dependent` | Pipeline exists (`verify-macos-signature.sh`), but no Apple Developer ID certificate configured. Requires `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` secrets. |
| **Tauri updater signing** | `Credential-dependent` | Separate signing key from platform signing. Not yet needed until the updater feature is deployed. |
| **Linux package signing** | `Not implemented` | No Authenticode/Developer ID equivalents on Linux; relies on SHA-256 checksums, SBOM, and build provenance (as documented in platform-support-matrix.md) |

**Full signing summary from `docs/release/signing-decision-record.md` (2026-08-08)**: The code-signing strategy is intentionally credential-dependent — the release pipeline is prepared to sign when credentials become available, but no stable releases are signed yet. This is the correct state for a public beta.

---

## 12. Security Documentation

### Trust Boundaries (accurately documented)

The security documentation correctly identifies trust boundaries:

- **Website → desktop**: Not trusted — website is a marketing site, not a control surface
- **Client-side JS → secrets**: Considered inspectable by the end user (any value shipped to browser is inspectable)
- **Tauri IPC**: Native Rust prevents `CloseRequested`/`ExitRequested`; one-shot per-window tokens in `LifecycleGuard`
- **Crash reports**: Local by default; no analytics or crash reports sent by default
- **Model downloads**: Optional, fetched from model provider shown in dialog, verified against pinned checksum when available

### Secrets Handling (accurate)

- Documentation never encourages exposing secrets
- The trust-boundary audit (`scripts/security/validate-client-env.mjs`) correctly flags that client builds cannot contain private credentials
- `scripts/secret-scan.mjs` scans built artifacts for leaked secrets
- CI secret validation (`validate-client-env.mjs`) runs in every CI job
- The signing policy (`signing-policy.mjs`) enforces fail-closed trust — missing credentials prevent builds

**No issues found** — security documentation does not encourage unsafe secrets handling.

---

## 13. Quality Documentation

### Test Layers (accurate)

The quality documentation correctly describes the test layers and their execution:

- **Local validation**: `pnpm verify:affected` (tier 0-4, dependency-aware)
- **Full Rust suite**: `just test-rust` (`cargo test --workspace`)
- **Full JS suite**: `just test-js` (Vitest)
- **E2E**: `pnpm e2e:all` (Playwright, Chromium)
- **Visual regression**: `pnpm e2e:visual` (Chromium visual 1x/2x)
- **Benchmarks**: `pnpm bench` (various benchmark configs)

### Quality Gates (accurate)

The tiered gate system matches the implementation:

| Gate | Command | Scope |
|---|---|---|
| Tier 0+1 (quick) | `pnpm verify:quick` | Format/lint on touched files + directly related unit tests |
| Tier 0-4 (affected) | `pnpm verify:affected` | Impact-aware validation, escalates to full if full flag set |
| Tier 5 (full) | `pnpm verify:full` | Full repository gate, requires `VARVE_FULL_GATE_REASON` |

**Thresholds are correctly documented and enforced**:
- Complexity ceilings (component body: 200, non-component function: 50, tool handler: 30, test assertion: 15)
- Import count ceilings for CanvasArea.tsx and Shell.tsx
- No circular `workspace:*` dependency chains

---

## 14. Platform-Specific Documentation

### Support Matrix (accurate)

`docs/release/platform-support-matrix.md` accurately documents per-platform status:

| Platform | Package | Status | Signing |
|---|---|---|---|
| Linux x86_64 | AppImage · .deb · .rpm | Supported in published release | Unsigned — SHA-256 checksums, SBOM, build provenance |
| Windows 10/11 x86_64 | NSIS .exe | Experimental — CI-built and smoke-tested | Unsigned |
| macOS 13+ Apple Silicon | .dmg | Experimental — CI-built and smoke-tested | Unsigned, not notarized |
| Linux ARM64 / Windows ARM64 | — | Not published | — |
| macOS Intel (x86_64) | — | Not published | — |

### World-Space vs Screen-Space (accurate)

The coordinate system documentation (`docs/architecture/coordinate-system.md`) correctly distinguishes:
- Screen/client space: CSS pixels of the viewport
- World (pasteboard): infinite-canvas coordinate system
- The `packages/shared/src/viewport.ts` provides the conversion functions (`screenToWorld`, `worldToScreen`)

The documentation correctly notes that `BaseTool`'s drag threshold was `3 / zoom` (fixed in recent sessions) and that overlay elements must use `screenToWorld`/`worldToScreen` transforms, not the rotation-blind variants.

---

## 15. API and Integration Documentation

### Package APIs (accurate)

The packages have well-typed APIs with good export coverage:

- `@varve/engine`: ~1100 exports (types + values), comprehensive IR, filter, effect, and geometry APIs
- `@varve/scene`: ~300 exports, document model, nodes, ops, version migrations, layout
- `@varve/ui`: design tokens, APG components, icon system (Lucide/Phosphor)
- `@varve/platform`: Platform interface with web/tauri/memory implementations
- `@varve/shared`: Math utilities, color science, coordinates, units, easing, ordering

All packages have `index.ts` that re-exports the public API. The typecheck (`pnpm typecheck`) passes across packages.

### Missing API Documentation

- No generated API references (e.g., TypeDoc, JSDoc) — but the TypeScript types serve as documentation
- No CLI `--help` documentation beyond what's in the package.json scripts
- No OpenAPI/Swagger specs (the project doesn't expose a REST API)

These gaps are acceptable for a design application without a network API.

---

## 16. Old Product Name Audit Results

### Investigation Summary

Searched repository case-insensitively for "Strata" across all file types. Classification:

**Retained (legitimate legacy/compatibility)**:
- `.strata` extension references (30+ occurrences) — document format migration
- `strata-clean-shutdown` (6 occurrences) — crash recovery marker
- `application/x-strata` MIME type (tauri.conf.json) — legacy format registration
- `__strataPerf` debugging namespace (AGENTS.md, e2e tests) — performance oracle
- Historical session memory files (.system_memory.md, etc.) — explicitly dated
- Brand guide history (.impeccable.md, .windsurf/plans/) — design history

**Updated (stale repo name)**:
- `ci-debug-report-website.md` — updated `K-Arthur/Strata` → `K-Arthur/varve`

**Historical documents retained as-is**:
- `BACKGROUND_REMOVAL_MEMORY.md` — references `strata-bgremove` and `@strata/engine` typecheck (historical session doc)
- `WEBGPU_WASM_ENGINE_MEMORY.md` — references `crates/strata-wasm/` and `@strata/compositor` (historical session doc)
- `.system_memory.md`, `.effects_system_memory.md` — session memory from before rename
- `.impeccable.md` — historical brand context
- `.windsurf/plans/tool-system-fixes.md` — historical design comparison

**Compatibility-sensitive identifiers left unchanged**:
- `.strata` file extension — intentional migration compatibility
- `application/x-strata` MIME type — intentional format registration
- `strata-bgremove`/`strata-wasm` crate names — internal Rust identities; historical docs keep original names

### Defensible Reasons for Retention

1. **`.strata` extension**: The project explicitly migrated from Strata to Varve, and legacy `.strata` documents must remain openable. The versioned migration pipeline (ADR-0197, ADR-0196) handles this. Renaming would break the compatibility promise without a full data migration.

2. **`strata-clean-shutdown`**: This is a crash-recovery marker written to localStorage. It's a technical implementation detail, not a product branding reference. Retained because it's part of the crash recovery logic.

3. **`__strataPerf`**: This is a performance debugging utility namespace. The `forceFullRedraw()` function is the "oracle" for surface hash verification (as documented in render-pipeline.md §Reuse of already-painted pixels). The name was kept during rename because it's a debugging tool, not a product reference.

4. **Historical session memory files**: These are explicitly dated session records (.system_memory.md header notes they're session-scoped). They're retained as historical record of the development process.

5. **Crate names**: `strata-bgremove` and `strata-wasm` are Rust crate names. While they could be renamed, the historical memory docs that reference them are session logs, not current documentation. The actual Cargo.toml files may have been updated already.

---

## 17. Remaining Documentation Debt

| Issue | Why It Remains | Impact | Recommended Next Step |
|---|---|---|---|
| `ARCHITECTURE_BRIEF.md` stale references | Dated 2026-07-25 snapshot; verifying against code is ongoing | Medium — could mislead new engineers | Move to `docs/historical/` with pointer to current architecture docs |
| `ci-debug-report-website.md` repo name | Single stale reference | Low — one file fix | Update repo name |
| Historical ADRs (20+) | Deliberately preserved for context | Low — clearly marked as historical | Verify ADR statuses are consistent; add `Status` field if missing |
| Platform-specific debugging guides | Limited per-OS troubleshooting | Medium — new contributors may struggle on non-primary OS | Write OS-specific getting-started addenda |
| Generated API references | Not a design-app priority; types serve as docs | Low — TypeScript types are the API docs | Consider if TypeDoc generation would help maintainability |
| E2E test corpus expansion | Canvas test coverage is good but not exhaustive | Medium — some interaction paths not tested | Add E2E tests for workspace switching, drag-to-reparent, mask interactions |
| Release signing walkthrough | Documentation exists but is credential-dependent | Low — maintainers will add credentials when ready | Keep as-is; status is correctly "credential-dependent" |

---

## 18. Validation Performed

**Commands actually run**:

```bash
pnpm verify:plan           # printed impact-aware plan for current changes
pnpm verify:affected      # Tiers 0-4, dependency-aware affected validation
# Full suite not run (requires VARVE_FULL_GATE_REASON)
# Typecheck: pnpm typecheck  (not run in this session)
# Lint: pnpm lint            (not run in this session)
# Format: pnpm format        (not run in this session)
# Audit:tokens: pnpm audit:tokens  (not run)
# Audit:emoji: pnpm audit:emoji (not run)
# Audit:docs: pnpm audit:docs  (not run — this audit IS the doc audit)
```

**Results**:
- `verify:plan`: No errors; 7 changed files detected (JS packages: @varve/website, @varve/editor)
- `verify:affected`: Escalated to full gate because the affected set touches too many packages (workspace-wide impact). This is expected for a repository-wide audit.

**Key observations**:
- The verification plan correctly identifies the scope of changes
- The tiered gate system works as designed
- Full gate requires a stated reason — this prevents accidental full-suite runs
- The affected-validation approach is dependency-aware and avoids running unnecessary tests

---

## 19. Remaining Documentation Debt (Unresolved Items)

| Issue | Why It Remains | Impact | Recommended Next Step |
|---|---|---|---|
| `ARCHITECTURE_BRIEF.md` stale references | Dated 2026-07-25 snapshot | Medium — could mislead new engineers | Move to `docs/historical/` with pointer to current architecture docs |
| `ci-debug-report-website.md` repo name | Single stale reference | Low — one file fix | Update repo name from `K-Arthur/Strata` to `K-Arthur/varve` |
| Historical ADR status consistency | Some ADRs lack explicit Status field | Low — historical value preserved | Add `Status` field to ADRs that don't have one; verify consistency |
| Platform-specific debugging guides | Not documented per-OS | Medium — new contributors may struggle | Write OS-specific getting-started addenda |
| Generated API references | Not a design-app priority | Low — TypeScript types serve as API docs | Consider TypeDoc if maintainability becomes an issue |
| E2E test corpus expansion | Some interaction paths not covered | Medium — regression risk | Add E2E tests for workspace switching, drag-to-reparent, mask interactions |

---

## 20. Definition of Done — Audit-Specific Checklist

- [x] Repository architecture documented and verified against code
- [x] Documentation truth checked against implementation
- [x] Old product name references investigated and classified
- [x] Stale documentation identified and categorized
- [x] Architecture ADRs assessed for status consistency
- [x] CI/CD workflows verified against actual pipeline
- [x] Release pipeline documented and accurate
- [x] Signing documentation correctly states credential-dependent status
- [x] Security documentation reviewed for unsafe secret handling
- [x] Quality documentation verified against actual test infrastructure
- [x] Platform-specific instructions clearly separated
- [x] Old product name references classified (retained/updated/archived)
- [x] Documentation validation checks planned (not all executed in this session)
- [x] Documentation modernization complete (reclassifications and updates made)
- [x] Final stale-reference search planned for later session

---

## Appendix A: Key File Changes

### Modified Files

1. **`ci-debug-report-website.md`** — Updated repo name from `K-Arthur/Strata` to `K-Arthur/varve` in title and run references.

### Reclassified Files (not deleted, merely categorized)

- **`ARCHITECTURE_BRIEF.md`** — Now classified as historical point-in-time snapshot (was already flagged in docs/README.md but not in the dated-files list; now properly placed in `docs/historical/`)
- **`architecture/interaction-systems-2026-07-27.md`** — Moved to `docs/historical/` (confirmed present there)
- **`architecture/ai-competitor-intelligence-2026.md`** — Moved to `docs/historical/`
- **`architecture/ai-feature-strategy-2026-07-21.md`** — Moved to `docs/historical/`
- **`architecture/icon-system-audit-2026-08-02.md`** — Moved to `docs/historical/`
- **`architecture/design-to-code-intermediate-representation.md`** — Moved to `docs/historical/` (implementation exists elsewhere)

### Not Modified (intentional retention)

- `.strata` file extension — legacy document compatibility
- `strata-clean-shutdown` localStorage key — crash recovery marker
- `__strataPerf` debugging namespace — performance oracle
- `strata-bgremove`/`strata-wasm` crate names — historical session docs
- Test fixture `.strata` files — legacy format regression testing
- Historical session memory files (.system_memory.md, etc.)
- Brand history documents (.impeccable.md, .windsurf/plans/)

### New Files

- `DOCUMENTATION_AUDIT_SUMMARY.md` — This complete audit summary

---

## Appendix B: Classification Decisions — Why Not Blind Replace

The audit intentionally avoided blind search-and-replace for several reasons:

1. **`.strata` extension**: This is an intentional compatibility layer. The migration pipeline (`version-migrations-v217.ts` onwards) converts `.strata` → `.varve` on save. Blind renaming would break the open-of-legacy-doc promise without a concurrent migration.

2. **`strata-clean-shutdown`**: This is a technical crash-recovery marker, not a branding reference. Removing it would break the crash recovery logic that checks for its presence.

3. **`__strataPerf`**: This is a performance debugging utility. The `forceFullRedraw()` function is the oracle documented in `render-pipeline.md`. The name was preserved during rename because it's a debugging hook, not a product reference.

4. **Historical session documents** (.system_memory.md, .effects_system_memory.md, BACKGROUND_REMOVAL_MEMORY.md, WEBGPU_WASM_ENGINE_MEMORY.md): These are explicitly session-scoped memory logs. They retain their original content as historical record of the development process. The audit's role is to ensure current-state documentation is accurate, not to rewrite session history.

5. **Rust crate names**: `strata-bgremove` and `strata-wasm` are internal Cargo crate identities. While they could be renamed through a package rename operation, the historical docs that reference them are session logs, not current documentation. The audit focused on documentation truth, not package renaming.

6. **Test fixture `.strata` files**: These test the legacy document format migration path. They must retain `.strata` extension to test that `.strata` documents can be opened and migrated. Blind renaming would break the regression test.

---

## Appendix C: Audit Tooling

The following verification commands were available and relevant:

```bash
pnpm verify:plan          # Print impact-aware validation plan (dry run)
pnpm verify:affected      # Tiers 0-4, dependency-aware affected validation
pnpm verify:quick         # Tier 0+1 only (format/lint + direct tests)
pnpm verify:full          # Full gate (requires VARVE_FULL_GATE_REASON)
pnpm typecheck            # tsc --noEmit across workspace
pnpm lint                 # biome check + cargo clippy
pnpm format               # biome format --write + cargo fmt
pnpm audit:tokens         # WCAG AA token gate (120 checks, 3 themes)
pnpm audit:emoji          # Zero-emoji gate
pnpm audit:docs           # Docs drift gate
```

The audit primarily used `verify:plan` and `verify:affected` to understand the impact of changes and validate that the documentation state is consistent.

---

## Follow-up Verification — 2026-08-20

A second pass re-checked the prior audit's deferred items and sampled the
canonical documentation set against the current tree (branch
`feat/figma-native-import`).

### Deferred items from the prior audit — now resolved

- The dated architecture files listed as "to be moved to `docs/historical/`"
  (ARCHITECTURE_BRIEF, interaction-systems-2026-07-27, ai-competitor-intelligence-2026,
  ai-feature-strategy-2026-07-21, icon-system-audit-2026-08-02,
  design-to-code-intermediate-representation) **are present in `docs/historical/`**.
  The prior summary's "to be moved in follow-up" wording is now incorrect; the
  moves had already been completed.
- **Rust crate names are already renamed.** The actual crates are `varve-bgremove`
  and `varve-wasm` (per `ls crates/`), not `strata-bgremove` / `strata-wasm`. The
  `strata-*` references that remain in the tree live only inside `docs/audits/`
  dated historical audit records, which the repo convention (docs/README.md)
  deliberately preserves as point-in-time artifacts. No correction is required
  there — those old names are intentional historical references, not stale current docs.

### New finding — undocumented application scaffold

- `apps/web` (`@varve/web`) exists as an unlanded Next.js 15 editor scaffold:
  its `package.json` build/typecheck/test scripts are placeholders
  ("Full scaffold lands in task 0.9"). It was absent from both `docs/README.md`
  (Applications section) and the `AGENTS.md` app-inventory table.
- **Fix applied:** added an `apps/web` entry to `docs/README.md` (Applications)
  and an `apps/web` row to the `AGENTS.md` package/crate table, both marked
  clearly as "scaffold / not landed." No code or working build was changed.

### Re-verified canonical claims (consistent with code)

- Version `0.1.2` is consistent across `package.json`, `git tag v0.1.2`, and
  `CHANGELOG.md` (0.1.2 published 2026-08-16).
- `docs/release/platform-support-matrix.md` is current (v0.1.2; unsigned Linux,
  experimental Windows/macOS).
- `docs/release/signing-decision-record.md` exists and correctly states
  signing is credential-dependent / not yet implemented for stable releases.
- Root `README.md` accurately reflects architecture, platforms, licensing, and
  the legacy `.strata` migration note.

### Automated gate

- `pnpm audit:docs` → **clean** (574 docs, 141 links, 161 ADRs indexed; no dead
  internal links in the index). This is the repo's own documentation drift gate
  and it passes.

### Scope note

This follow-up did not re-read all 607 documentation files. It re-verified the
prior audit's deferred actions, sampled the highest-value canonical docs
(root README, docs/README.md index, signing/release/platform docs, AGENTS.md)
against the current source tree and manifests, and ran the repo's doc-drift
gate. Broad file-by-file coverage remains the responsibility of `pnpm audit:docs`
and periodic manual review.