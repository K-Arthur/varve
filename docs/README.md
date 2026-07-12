# Documentation Index

This is the source-of-truth index for all documentation in the Strata project.
Every doc the project touches or creates is listed here so future updates know what exists.

## Architecture Decision Records
| Doc | Purpose |
|-----|---------|
| `adr/0001-native-render-in-tauri-webview.md` | IR-replay rendering decision |
| `adr/0002-design-tokens.md` | Design token system rationale |
| `adr/0003-compositor-backend-selection.md` | Canvas2D vs WebGPU backend |
| `adr/0004-wasm-crate-boundary.md` | WASM crate boundary decisions |
| `adr/0005-offline-model-bundling.md` | Offline model bundling for AI features |

## Architecture Docs
| Doc | Purpose |
|-----|---------|
| `architecture/frame-encapsulation.md` | Frame clipping and containment |
| `architecture/loading-system.md` | Loading experience system |
| `architecture/motion-system.md` | Motion/animation architecture |
| `architecture/render-pipeline.md` | Canvas rendering pipeline |
| `architecture/wasm-backends.md` | WASM backend architecture |

## Audits
| Doc | Purpose | Last Updated |
|-----|---------|-------------|
| `audits/background-removal-audit.md` | Background removal pipeline audit |
| `audits/canvas-system-audit.md` | Canvas system architecture audit |
| `audits/color-management-print-audit.md` | Color management & print audit |
| `audits/effects-halftone-audit.md` | Effects & halftone audit |
| `audits/home-workspace-architecture-audit.md` | Home/workspace architecture |
| `audits/image-text-manipulation-audit.md` | Image & text manipulation audit |
| `audits/import-export-compatibility-audit.md` | Import/export compatibility |
| `audits/intelligence-audit-2026.md` | Design intelligence audit |
| `audits/loading-experience-audit.md` | Loading experience audit |
| `audits/motion-system-audit.md` | Motion system audit |
| `audits/typography-system-audit.md` | Typography system audit |
| `audits/ui-ux-redesign-memory.md` | UI/UX redesign memory |
| `audits/ui-ux-review-jul-2026.md` | July 2026 UI/UX review |

## Design
| Doc | Purpose |
|-----|---------|
| `design/elevation-system.md` | Elevation/shadow system |
| `design/visual-direction.md` | Visual direction & polish |
| `brand-guide.md` | Strata brand guide (colors, logo, usage) |
| `brand/strata-brand-guide.md` | Detailed brand guidelines |

## Plans
| Doc | Purpose |
|-----|---------|
| `plans/website-product-truth-matrix.md` | Product capability audit (source of truth for marketing claims) |
| `plans/website-strategy.md` | Full website marketing strategy |
| `plans/website-research-findings.md` | Competitor research findings |
| `plans/website-progress-tracker.md` | Implementation progress tracker |
| `plans/website-operations-guide.md` | **How to add new releases and platforms** |
| `plans/phase1-plan.md` | Phase 1 execution plan |
| `plans/phase2-plan.md` | Phase 2 execution plan |
| Various session plans | Per-session implementation plans |

## Performance
| Doc | Purpose |
|-----|---------|
| `perf/ledger.md` | Performance benchmarks and tracking |

## CI/CD & Operations
| Doc | Purpose |
|-----|---------|
| `CI_CD_RESILIENCE.md` | CI/CD failure modes and mitigations |

## Website-specific
| Area | Location | Purpose |
|------|----------|---------|
| Source code | `apps/website/` | Astro static site (42 pages) |
| Release manifest | `apps/website/public/releases.json` | Single source of truth for download data |
| Deployment workflow | `.github/workflows/deploy-website.yml` | GitHub Pages auto-deploy |
| Website build | `pnpm --filter @strata/website build` | Build command (astro check + astro build) |
| Website dev | `cd apps/website && pnpm dev` | Development server at localhost:4321 |

## Operations Guides
| Doc | Purpose |
|-----|---------|
| `plans/website-operations-guide.md` | Step-by-step: adding releases and platforms |

## Development Guide
| Doc | Purpose |
|-----|---------|
| `AGENTS.md` (repo root) | Main development guide with toolchain, commands, architecture |
