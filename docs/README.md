# Documentation Index

This is the source-of-truth index for documentation in the Varve project. Every
doc the project touches or creates is listed here so future updates know what
exists.

Dated documents under `docs/audits/`, `docs/plans/`, `docs/perf/`,
`docs/superpowers/`, and `docs/implementation-memory/` are **historical
records** — they describe the state of the project at the time they were
written and are not updated retroactively. Current guidance lives in
`docs/architecture/`, `docs/release/`, `docs/development/`, and this index.

## Entry points

Current image-enhancement architecture and evidence requirements are documented
in [`architecture/image-enhancement-system.md`](architecture/image-enhancement-system.md)
and [`quality/image-enhancement-benchmark.md`](quality/image-enhancement-benchmark.md).

| Doc | Purpose |
|-----|---------|
| [README.md](../README.md) (root) | What Varve is, quick start, key packages |
| [AGENTS.md](../AGENTS.md) (root) | AI agent instructions — cross-project rules for automation |
| [CONTRIBUTING.md](../CONTRIBUTING.md) (root) | Contribution status, current ways to help, and future code workflow |
| [development/contributing.md](development/contributing.md) | Current contribution status, ways to help now, project map, validation, and future PR workflow |
| [CHANGELOG.md](../CHANGELOG.md) (root) | Release notes — source for `release-notes.mjs` |
| [brand/github-repository-presence.md](brand/github-repository-presence.md) | Canonical GitHub metadata, social preview, and public-content maintenance |

## Architecture Decision Records

| Doc | Purpose |
|-----|---------|
| `adr/0001-native-render-in-tauri-webview.md` | IR-replay rendering decision |
| `adr/0002-design-tokens.md` | Design token system rationale |
| `adr/0003-compositor-backend-selection.md` | Canvas2D vs WebGPU backend |
| `adr/0004-wasm-crate-boundary.md` | WASM crate boundary decisions |
| `adr/0005-offline-model-bundling.md` | Offline model bundling for AI features |
| `adr/0008-accessibility-remediation.md` | Accessibility remediation |
| `adr/0009-document-color-architecture.md` | Document colour architecture |
| `adr/0010-coordinate-architecture.md` | Coordinate architecture |
| `adr/0011-design-system-governance.md` | Design system governance |
| `adr/0012-runtime-capability-abstraction.md` | Runtime capability abstraction |
| `adr/0013-canonical-audit-finding-contract.md` | Canonical audit finding contract |
| `adr/0014-font-detection-architecture.md` | Font detection architecture |
| `adr/0015-mockup-system.md` | Non-destructive mockup system (Level 1+2 implemented) |
| `adr/0016-tables-and-color-modifiers.md` | Tables and colour modifiers |
| `adr/0122-canonical-editor-session-ownership.md` | One canonical editing session per application session |
| `adr/0123-state-partitioning-across-windows.md` | State scope taxonomy for multi-window sync |
| `adr/0124-panel-registry.md` | Declarative panel registry and lifecycle contract |
| `adr/0125-stable-window-and-panel-instance-identity.md` | Durable ids for windows/panels/transactions |
| `adr/0126-dock-tree-representation.md` | Normalized dock-tree model and pure operations |
| `adr/0127-native-window-service-boundary.md` | Platform window service abstraction |
| `adr/0128-cross-window-protocol.md` | Versioned, typed session envelope protocol |
| `adr/0129-snapshot-and-incremental-synchronization.md` | Snapshot + revisioned patch sync |
| `adr/0130-command-routing.md` | Broker-routed validated mutations |
| `adr/0131-undo-redo-ownership.md` | Single authoritative undo stack |
| `adr/0132-selection-and-active-document-semantics.md` | Shared selection; panels follow active document |
| `adr/0133-focus-and-shortcut-routing.md` | Window-aware shortcut classification |
| `adr/0134-atomic-panel-transfer.md` | Transactional detach/reattach state machine |
| `adr/0135-window-close-behavior.md` | Coordinated close policy per platform |
| `adr/0136-auxiliary-window-recovery.md` | Generation-based reload/crash recovery |
| `adr/0137-workspace-persistence.md` | Versioned named workspace layouts |
| `adr/0138-monitor-matching-and-placement-restoration.md` | Display fingerprint matching and safe placement |
| `adr/0139-browser-fallback.md` | Honest single-window browser fallback |
| `adr/0140-dialog-and-overlay-ownership.md` | Window-local vs session modal coordination |
| `adr/0141-drag-and-drop-across-native-windows.md` | Command-first, progressive drag layers |
| `adr/0142-canvas-window-deferral.md` | Canvas windows deferred to a later phase |
| `adr/0143-rendering-and-worker-isolation.md` | Minimal auxiliary bundles; centralized runtimes |
| `adr/0144-collaboration-behavior.md` | One collaboration connection per session |
| `adr/0145-security-and-capability-scoping.md` | Narrow per-window Tauri capabilities + validation |
| `adr/0146-multimodal-proposal-boundary.md` | Typed, validated AI workspace plans |
| `adr/0147-test-architecture.md` | Multi-layer multi-window test pyramid |
| `adr/0017-authoritative-mutation-pipeline.md` | Typed command dispatcher for all document mutations |
| `adr/0018-operation-vs-transaction.md` | Atomic operation vs transaction representation |
| `adr/0019-undo-redo-semantics.md` | Undo/redo: movable cursor with branch-on-divergence |
| `adr/0020-persistent-operation-storage.md` | Append-only log + atomic refs across runtimes |
| `adr/0021-snapshot-content-addressing.md` | SHA-256 content-addressed snapshots |
| `adr/0022-revision-dag.md` | Immutable revision DAG (genesis/one-parent/two-parent) |
| `adr/0023-branch-checkpoint-refs.md` | Branch heads and checkpoint references |
| `adr/0024-version-history-migration.md` | Existing version-history migration |
| `adr/0025-persistent-identity-format.md` | Collision-resistant persistent IDs |
| `adr/0026-legacy-id-migration.md` | Legacy sequential-ID migration |
| `adr/0027-canonical-serialization.md` | Schema-aware canonical serialization |
| `adr/0028-git-working-representation.md` | Single canonical text file as Git representation |
| `adr/0029-portable-package.md` | Portable package representation |
| `adr/0030-binary-asset-strategy.md` | Content-addressed binary asset strategy |
| `adr/0031-semantic-diff-granularity.md` | Property-level semantic diff granularity |
| `adr/0032-text-diff-strategy.md` | Grapheme-aware text diff strategy |
| `adr/0033-ordered-child-merge-strategy.md` | Ordered-child merge strategy |
| `adr/0034-three-way-conflict-rules.md` | Deterministic three-way conflict rules |
| `adr/0035-conflict-representation.md` | Unresolved conflict representation |
| `adr/0036-git-diff-driver.md` | Git text-conversion diff driver |
| `adr/0037-git-merge-driver.md` | Git semantic merge driver |
| `adr/0038-review-artifact-format.md` | Offline design review artifacts |
| `adr/0039-collaboration-integration.md` | Operation log as collaboration protocol |
| `adr/0040-browser-support.md` | Browser support for persistent history |
| `adr/0041-compaction-gc.md` | Compaction and garbage collection |
| `adr/0042-privacy-multimodal-consent.md` | Privacy and remote multimodal consent |
| `adr/0043-history-panel-architecture.md` | History panel architecture |
| `adr/0044-historical-preview-isolation.md` | Historical preview isolation |
| `adr/0045-schema-operation-migrations.md` | Schema and operation migrations |
| `adr/0046-failure-recovery.md` | Failure recovery and repair |
| `adr/0100-design-token-model.md` | Canonical internal design-token model |
| `adr/0101-variables-token-relationship.md` | Varve Variables vs DTCG tokens relationship |
| `adr/0102-token-identity-path-mapping.md` | Stable identity and path mapping |
| `adr/0103-source-preserving-parsing.md` | DTCG source-preserving parsing and serialization |
| `adr/0104-reference-graph-expression-separation.md` | Reference graph and expression separation |
| `adr/0105-resolver-documents.md` | DTCG resolver document support |
| `adr/0106-modes-themes-platforms-density.md` | Modes, themes, brands, platforms, density |
| `adr/0107-source-connection-model.md` | Token source connection model |
| `adr/0108-three-way-semantic-merge.md` | Three-way semantic merge |
| `adr/0109-rename-move-detection.md` | Rename and move detection |
| `adr/0110-deletion-tombstones.md` | Deletion and tombstone semantics |
| `adr/0111-local-file-watching.md` | Local file watching |
| `adr/0112-atomic-filesystem-writes.md` | Atomic filesystem writes |
| `adr/0113-git-integration-boundary.md` | Git integration boundary |
| `adr/0114-adapter-architecture.md` | Token adapter architecture |
| `adr/0115-generated-code-ownership.md` | Generated-code ownership |
| `adr/0116-undo-redo-transactions.md` | Undo, redo, transaction semantics |
| `adr/0117-collaboration-behavior.md` | Collaboration behavior |
| `adr/0118-multimodal-proposal-boundary.md` | Multimodal proposal boundary |
| `adr/0119-secret-storage-permissions.md` | Secret storage and permissions |
| `adr/0120-browser-tauri-capability-model.md` | Browser vs Tauri capability model |
| `adr/0121-performance-indexing.md` | Performance and indexing strategy |
| `adr/0170-image-trace-native-engine.md` | Native Image Trace (raster-to-vector) engine |
| `adr/0155-persistent-geometry-modifier-model.md` | Persistent geometry-modifier (warp) model |
| `adr/0156-warp-operation-order.md` | Warp operation order |
| `adr/0157-warp-coordinate-spaces.md` | Warp coordinate-space model |
| `adr/0158-warp-envelope-representation.md` | Four-edge Bézier envelope representation |
| `adr/0159-warp-mesh-interpolation.md` | Mesh warp interpolation |
| `adr/0160-warp-stroke-behavior.md` | Warp stroke behavior |
| `adr/0161-warp-gradient-and-pattern-behavior.md` | Warp gradient and pattern behavior |
| `adr/0162-warp-text-behavior.md` | Warped editable text |
| `adr/0163-warp-group-and-component-behavior.md` | Warp groups and components |
| `adr/0164-warp-layout-boundary-behavior.md` | Warp layout-boundary behavior |
| `adr/0165-warp-hit-testing-strategy.md` | Warp hit testing |
| `adr/0166-warp-export-and-expansion-policy.md` | Warp export and Expand Appearance policy |
| `adr/0167-warp-compute-ownership.md` | CPU / WASM / worker / GPU ownership for warp |
| `adr/0168-warp-multimodal-proposal-boundary.md` | Multimodal warp proposal boundary |
| `adr/0169-warp-collaboration-granularity.md` | Warp collaboration granularity |
| `adr/0171-page-vs-frame-semantics.md` | Page versus frame semantics |
| `adr/0172-page-local-vs-world-coordinates.md` | Page-local versus world coordinates |
| `adr/0173-pasteboard-page-placement.md` | Pasteboard page placement |
| `adr/0174-page-order-vs-visual-placement.md` | Page order versus visual placement |
| `adr/0175-page-ownership-of-scene-nodes.md` | Page ownership of scene nodes |
| `adr/0176-global-and-pasteboard-content.md` | Global and pasteboard-only content |
| `adr/0177-explicit-vs-derived-spreads.md` | Explicit versus derived spreads |
| `adr/0178-facing-page-topology.md` | Facing-page topology |
| `adr/0179-mixed-page-sizes.md` | Mixed page sizes |
| `adr/0180-section-and-numbering-model.md` | Section and numbering model |
| `adr/0181-master-projection.md` | Master projection |
| `adr/0182-master-override-representation.md` | Master override representation |
| `adr/0183-multiple-master-layers.md` | Multiple master layers |
| `adr/0184-master-inheritance-and-cycle-prevention.md` | Master inheritance and cycle prevention |
| `adr/0185-story-and-frame-separation.md` | Story and frame separation |
| `adr/0186-text-composition-engine.md` | Text composition engine |
| `adr/0187-persisted-vs-derived-text-ranges.md` | Persisted versus derived text ranges |
| `adr/0188-incremental-reflow.md` | Incremental reflow |
| `adr/0189-text-exclusion-and-shape-support.md` | Text exclusion and shape support |
| `adr/0190-page-level-print-geometry.md` | Page-level print geometry |
| `adr/0191-print-mark-representation.md` | Print-mark representation |
| `adr/0192-pdf-page-box-mapping.md` | PDF page-box mapping |
| `adr/0193-shared-canvas-rendering.md` | Shared canvas rendering |
| `adr/0194-spatial-indexing-and-culling.md` | Spatial indexing and culling |
| `adr/0195-selection-across-pages.md` | Selection across pages |
| `adr/0196-page-movement-and-reordering.md` | Page movement and reordering |
| `adr/0197-legacy-document-migration.md` | Legacy document migration |
| `adr/0198-undo-and-history-integration.md` | Undo and history integration |
| `adr/0199-semantic-diff-and-merge.md` | Semantic diff and merge behavior |
| `adr/0200-collaboration-behavior.md` | Collaboration behavior |
| `adr/0201-multimodal-proposal-pipeline.md` | Multimodal proposal pipeline |
| `adr/0202-browser-vs-desktop-capabilities.md` | Browser versus desktop capabilities |
| `adr/0203-performance-and-memory-limits.md` | Performance and memory limits |
| `adr/0204-multi-window-canonical-session.md` | Canonical session in multi-window |
| `adr/0205-multi-window-state-partitioning.md` | Multi-window state partitioning |
| `adr/0206-multi-window-dock-tree.md` | Multi-window dock tree |
| `adr/0207-multi-window-protocol.md` | Multi-window protocol |
| `adr/0208-multi-window-transfer.md` | Multi-window panel transfer |
| `adr/0209-multi-window-focus-shortcuts.md` | Multi-window focus and shortcuts |
| `adr/0210-multi-window-persistence.md` | Multi-window persistence |
| `adr/0211-multi-window-close-recovery.md` | Multi-window close recovery |
| `adr/0212-multi-window-browser-fallback.md` | Multi-window browser fallback |
| `adr/0213-multi-window-multimodal-pipeline.md` | Multi-window multimodal pipeline |
| `adr/0214-multi-resolution-tiled-pyramid.md` | Multi-resolution tiled raster pyramid (display LOD) |
| `adr/0215-animated-image-media-system.md` | Animated image media system |
| `adr/0216-termination-lifecycle-coordinator.md` | Termination lifecycle coordinator |
| `adr/0217-raster-colour-management.md` | Canonical raster colour encoding + colour-managed raster pipeline |
| `adr/0218-thumbnail-system.md` | Unified thumbnail system (see `architecture/thumbnail-system.md`) |
| `adr/0219-parent-local-coordinates.md` | Parent-local scene coordinates (see `architecture/coordinate-system.md`) |
| `adr/0220-object-selection-runtime.md` | Model-independent Object Selection runtime boundary |
| `adr/0221-local-asset-search-ranking-and-model-gate.md` | Hybrid local asset search and checkpoint gate |
| `adr/0222-vision-runtime-selection.md` | Capability-driven visual-awareness runtime boundary |
| `adr/0223-palette-extraction-derived-analysis.md` | Palette extraction as derived, versioned analysis (see `architecture/palette-extraction-system.md`) |
## Architecture Docs (current state)

| Doc | Purpose |
|-----|---------|
| `ARCHITECTURE_BRIEF.md` | High-level architecture brief (docs root) — **dated snapshot (2026-07-25)** with line-precise file references that may have drifted; verify against code before relying on line numbers |
| `architecture/render-pipeline.md` | Canvas rendering pipeline |
| `architecture/adaptive-render-residency.md` | Adaptive visibility, residency, raster representation, fidelity, and budget policy |
| `architecture/wasm-backends.md` | WASM backend architecture |
| `architecture/motion-system.md` | Motion/animation architecture |
| `architecture/text-pipeline.md` | Multilingual text rendering and layout |
| `architecture/loading-system.md` | Loading experience system |
| `architecture/workspace-system.md` | Workspace mode contract, resolution, and persistence |
| `architecture/lifecycle-system.md` | Quit/close/exit lifecycle and shutdown architecture |
| `architecture/logo-system.md` | Logo workspace system |
| `architecture/icon-system.md` | Icon infrastructure |
| `architecture/typography-platform.md` | Typography platform |
| `architecture/colour-management.md` | Colour management and ICC |
| `architecture/security-csp.md` | Content Security Policy |
| `architecture/onboarding-help-system.md` | Help/onboarding system |
| `architecture/frame-encapsulation.md` | Frame clipping and containment |
| `architecture/canvas2d-system.md` | Canvas 2D system contract |
| `architecture/image-lifecycle.md` | Raster ingestion, asset, decode, cache, worker, compositor, and lifecycle contract |
| `architecture/image-geometry.md` | Image crop, placement, and transform contract |
| `architecture/raster-assets.md` | Canonical raster asset architecture: metadata, resource handles, worker residency, export barrier |
| `architecture/image-trace-system.md` | Native raster-to-vector tracing (silhouette/centerline/pixel-art) |
| `architecture/palette-extraction-system.md` | Deterministic local image palette, harmony, and WCAG pair analysis |
| `architecture/thumbnail-system.md` | Unified thumbnail system (ADR-0218) |
| `architecture/coordinate-system.md` | Coordinate-space contract: spaces, storage, composition, reparenting, migration (ADR-0219) |
| `architecture/asset-search-system.md` | Asset Browser retrieval lanes, vector identity, model/runtime gate, and degradation contract |
| `architecture/visual-awareness-system.md` | Demand-driven face, hand, pose, object, and segmentation capability boundary |
| `architecture/masking-system.md` | Clipping/alpha/luminance mask model and compositing contract |
| `architecture/mockup-system.md` | Non-destructive mockup system (Level 1+2) |
| `architecture/alpha-aware-shadows.md` | Alpha-aware shadow rendering |
| `architecture/animated-image-media-system.md` | GIF/APNG/WebP media pipeline |
| `architecture/live-effects-system.md` / `architecture/effect-rendering.md` | Live effect model and render-parity contract |
| `architecture/gradient-map-system.md` | Gradient map adjustment system |
| `architecture/warp-system.md` | Persistent geometry modifier (warp) model (ADRs 0155–0169) |
| `architecture/persistent-history.md` | Version history architecture (milestones 1–14 landed) |
| `architecture/save-destinations.md` | Save destination model |
| `architecture/new-design-creation.md` | New Design / document creation contract |
| `architecture/pages-layers-frames-shapes-system.md` | Pages, layers, frames, shapes model |
| `architecture/pen-pencil-tools.md` | Pen/pencil tool architecture |
| `architecture/polygonal-lasso.md` | Polygonal lasso |
| `architecture/skew-transforms.md` | Skew transform contract |
| `architecture/touch-multi-select.md` | Touch and multi-select |
| `architecture/viewport-guides-system.md` | Viewport guides contract |
| `architecture/focus-navigation.md` | Focus and keyboard navigation contract |
| `architecture/input-system-behavior-matrix.md` | Input behavior matrix |
| `architecture/inspector-feature-ownership.md` | Inspector feature ownership |
| `architecture/icon-library.md` / `architecture/icon-system-naming.md` | Icon library and naming contract |
| `architecture/onnx-inference-architecture.md` | ONNX inference architecture |
| `architecture/semantic-asset-similarity.md` | Local image-to-image similarity, duplicate lanes, model/runtime boundaries, and current limitations |
| `quality/semantic-asset-similarity-benchmark.md` | Exact-search scale baseline and held-out retrieval evaluation contract |
| `architecture/object-selection-system.md` | Object Selection prompts, transient masks, runtime boundary, and persistence |
| `architecture/int8-quantization.md` | INT8 model quantization |
| `architecture/realesrgan-packaging.md` | Real-ESRGAN model packaging |
| `architecture/debug-overlays.md` | Debug overlay contract |
| `architecture/workspace-navigation.md` | Workspace navigation behavior |
| `architecture/filesystem-boundary.md` | Cross-platform directory, path, storage, and native filesystem boundary |
| `architecture/website-theme-contrast.md` | Website theme and WCAG contrast architecture |
| `architecture/multi-window-workspaces.md` | Detachable panels and native multi-monitor workspaces |
| `architecture/halftone-system.md` | Halftone screening: canonical parameters, coordinates, tone mapping, export parity |

### Dated point-in-time records under `docs/architecture/`

The files below live in `docs/architecture/` but are **point-in-time records**
(dated investigations, design proposals, or manual verification checklists),
not current-state guidance. Treat them like the dated files in
`docs/audits/`/`docs/plans/`: verify against current code before acting.

- `ARCHITECTURE_BRIEF.md` (docs root) — point-in-time subsystem map (generated 2026-07-25); file/line and schema-version claims are stale, verify against code
- `architecture/interaction-systems-2026-07-27.md` — dated interaction-systems notes (Milestones 1–10)
- `architecture/ai-competitor-intelligence-2026.md` — competitor research (2026-07)
- `architecture/ai-feature-strategy-2026-07-21.md` — dated AI feature strategy (pre-rename title)
- `architecture/icon-system-audit-2026-08-02.md` — dated icon system audit
- `architecture/raster-pyramid-audit.md` — audit-phase record of the raster-pyramid work
- `architecture/coordinate-spaces-research.md` — coordinate-space research matrix
- `architecture/webgpu-manual-verification.md` — manual WebGPU verification checklist (run on real hardware)
- `architecture/design-to-code-intermediate-representation.md` — design-to-code IR (implemented; written as a design doc 2026-07-23)

## Release Engineering (current state)

| Doc | Purpose |
|-----|---------|
| `release/README.md` | Overview of the release pipeline and tooling |
| `release/platform-support-matrix.md` | Which OSes/architectures are supported vs claimed |
| `release/production-build.md` | Verified production build commands |
| `release/release-checklists.md` | Alpha/beta/RC/stable checklists + rollback runbooks |
| `release/ci-secrets.md` | Secret names, permissions, enrolment |
| `release/update-strategy.md` | Updater status and future key management |
| `release/website.md` | Website architecture and launch plan |
| `release/budget-plan.md` | Launch budget (CAD $200) and purchase triggers |
| `release/distribution-decision-matrix.md` | Distribution channel decisions |

### Release Engineering — historical records

- `release/release-readiness-audit.md` — point-in-time release readiness audit (2026-08-03); records state at audited commit, not current guidance.

## Development Guide

| Doc | Purpose |
|-----|---------|
| `development/setup.md` | Setup, running, testing, and quality gates |
| `development/provenance.md` | Git identity and contribution provenance |
| `development/tooltip-guide.md` | Tooltip system authoring patterns |

## Design & Brand

| Doc | Purpose |
|-----|---------|
| `design/elevation-system.md` | Elevation/shadow system |
| `design/visual-direction.md` | Visual direction & polish |
| `design/design-principles.md` | Design principles |
| `design/component-status.md` | Component implementation status |
| `design/migration-debt.md` | Design migration debt |
| `brand-guide.md` | Brand guide (mark, wordmarks, usage) — current |
| `brand/varve-brand-guide.md` | Superseded v1.0 brand guide (pre-rework mark); retained as a historical record |

## Privacy & Security

| Doc | Purpose |
|-----|---------|
| `privacy/consent-state.md` | Consent state for telemetry/crash reporting |
| `privacy/crash-audit.md` | Crash reporting data audit |
| `privacy/ingestion.md` | Data ingestion inventory |
| `privacy/redaction.md` | Redaction rules |
| `privacy/retention.md` | Retention policy |
| `privacy/runbooks.md` | Privacy operations runbooks |
| `crash-reporting/README.md` | Crash reporting architecture |
| `security/security-hardening.md` | Security hardening contract and policy (CSP, workflow policy, secret scanning) |

## Quality

| Doc | Purpose |
|-----|---------|
| `quality/test-reality.md` | What tests actually cover |
| `quality/tauri-command-audit.md` | Tauri command surface audit |
| `quality/editorprovider-surface.md` | EditorProvider surface |
| `quality/validation-strategy.md` | **Canonical validation policy** — impact-aware planning, tiers, escalation rules |
| `quality/render-path-verification.md` | Render-path verification contract |
| `quality/cycles.md` / `quality/scene-cycle-report.md` / `quality/section-registry-cycle-report.md` / `quality/wasm-engine-cycle.md` | Dependency cycle reports (dated records, 2026-07) |
| `quality/report-audit.md` | Audit report quality review (dated record, 2026-07-25) |

## Testing

| Doc | Purpose |
|-----|---------|
| `testing/real-image-validation-corpus.md` | Real-image corpus plan for model-quality testing (corpus not yet generated) |
| `testing/sam2-lineart-validation-2026-07-21.md` | Dated SAM2/lineart validation record |

## Design Tokens

| Doc | Purpose |
|-----|---------|
| `tokens/dtcgsync-audit.md` | DTCG sync milestone audit (dated record, 2026-08-05) |
| `tokens/dtcgsync-architecture.md` | DTCG sync architecture record (dated record, 2026-08-05) |

## Implementation Ledgers (historical)

| Doc | Purpose |
|-----|---------|
| `implementation/cross-platform-menubar-progress.md` | Menubar buildout progress ledger |
| `implementation/cross-platform-menubar-strategies.md` | Menubar strategy record |
| `implementation/export-infrastructure-progress.md` | Export infrastructure progress ledger |
| `implementation/export-pipeline-progress.md` | Export pipeline milestones ledger (dated 2026-08-02) |
| `implementation/gradient-map-progress.md` | Gradient map system progress ledger |

## CI/CD & Operations

| Doc | Purpose |
|-----|---------|
| `CI_CD_RESILIENCE.md` | CI/CD failure modes and mitigations |
| `desktop-runtime.md` | Desktop runtime (Tauri 2, WebKitGTK/WebView2) |
| `menu-capability-matrix.md` | Menu items and required capabilities — generated from `menu/defs.ts` (`scripts/regenerate-menu-matrices.mjs`) |
| `menu-workspace-matrix.md` | Menu items per workspace — generated from `menu/defs.ts` (`scripts/regenerate-menu-matrices.mjs`) |
| `menu-performance.md` | Menu performance notes |

## Performance

| Doc | Purpose |
|-----|---------|
| `perf/ledger.md` | Performance benchmark ledger |
| `perf/findings.md` | Performance findings |
| `perf/*.md` | Dated performance investigations |

## Plans (historical)

| Doc | Purpose |
|-----|---------|
| `plans/website-operations-guide.md` | **Operating guide:** how to add releases and platforms (keep current) |
| `plans/website-progress-tracker.md` | Website implementation progress |
| `plans/website-strategy.md` | Website marketing strategy |
| `plans/website-research-findings.md` | Competitor research |
| `plans/website-product-truth-matrix.md` | Dated (2026-07-08) product capability audit — superseded by `release/website.md` |
| `plans/rename-strata-consultation.md` | Dated record of the product-rename consultation (file retains its original name) |
| Other `plans/*.md` | Per-session implementation plans and deferred-work records |
| `plans/archived/*.md` | Completed/superseded plans, archived per the convention in `session-04-packaging.md` |

## Audits (historical)

`docs/audits/` contains dated audit reports (canvas, motion, typography,
accessibility, platform UX, inference, and more). They are point-in-time
records; check the current code before acting on their findings.

| `audits/color-quantization-boundary-inventory.md` | Current high-precision color quantization-boundary inventory |
| `audits/filesystem-hardening-2026-08-13.md` | Cross-OS directory/path hardening pass: findings fixed, storage map, limitations |

## Website-specific (current state)

| Area | Location | Purpose |
|------|----------|---------|
| Source code | `apps/website/` | Astro 5 static site (42 pages) |
| Release manifest | `apps/website/src/data/release-manifest.json` | Download data for the release pages |
| Deployment workflow | `.github/workflows/website-deploy.yml` | GitHub Pages auto-deploy |
| Website build | `pnpm --filter @varve/website build` | Build command (astro check + astro build) |
| Website dev | `cd apps/website && pnpm dev` | Development server at localhost:4321 |

## Applications

| Doc | Purpose |
|-----|---------|
| `apps/desktop/README.md` | Tauri 2 desktop app — architecture, running, building |
| `apps/website/README.md` | Astro 5 marketing site — architecture, running, testing |

## AI-Assisted Development

| Doc | Purpose |
|-----|---------|
| `agents/README.md` | Why and how AI tooling is used in this project |
| `agents/continuation.md` | Historical session-5 continuation context (see file header) |
| `agents/session-history.md` | Detailed per-session development records |

## Implementation Memory (historical)

| Doc | Purpose |
|-----|---------|
| `implementation-memory/BACKGROUND_REMOVAL_MEMORY.md` | Background removal pipeline execution memory |
| `implementation-memory/BG_REMOVAL_QUEUE_MEMORY.md` | Background removal queue fix documentation |
| `implementation-memory/WEBGPU_WASM_ENGINE_MEMORY.md` | WebGPU/WASM acceleration state log |
| `implementation-memory/GITHUB_PIPELINE_MEMORY.md` | GitHub pipeline status and configuration |
| `implementation-memory/system_memory.md` | System architecture memory |
| `implementation-memory/alignment_memory.md` | Alignment system discovery |
| `implementation-memory/color_system_memory.md` | Color system architecture |
| `implementation-memory/effects_system_memory.md` | Effects system architecture |
| `implementation-memory/select_scale_memory.md` | Selection & transform engine |
| `implementation-memory/impeccable.md` | Design context and brand personality |
| `implementation-memory/select-move-overhaul.md` | Selection and move overhaul |
| `implementation-memory/typography-overhaul.md` | Typography system overhaul |
| `implementation-memory/ui-ux-redesign-memory.md` | UI/UX neo-bento redesign session memory |
| `implementation-memory/layers-panel-completion-memory.md` | Layers panel completion memory |

Mirrored copies of several memory files also exist at the repository root
(`.system_memory.md`, `.effects_system_memory.md`, etc.) for session-scoped
AI tooling; the `docs/implementation-memory/` copies are the canonical ones.

The root-level `CONTINUATION.md` (a pre-rename Session 5 artifact) was removed;
its updated copy lives at `docs/agents/continuation.md`.
