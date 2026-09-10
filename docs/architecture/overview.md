# Varve architecture overview

**Status:** current-state overview, last verified 2026-09-02

Varve is a local-first design suite in a monorepo. The supported product is a
Tauri 2 desktop application. The same editor frontend can run through Vite for
browser compatibility and development, while a bounded `/try/` demo is staged
into the static marketing site. The Astro website is a separate public-content
and release-download surface; it is not the editor's backend or control plane.

For subsystem-level contracts, use the documents in the [architecture
index](../README.md#architecture-docs-current-state). This page answers the
orientation question: which process owns what, how data moves, and where a
change belongs.

## Runtime topology

```mermaid
flowchart TD
  User[User] --> DesktopUI[Editor frontend\napps/desktop/src]
  User --> Website[Astro static site\napps/website]

  DesktopUI --> Runtime{Runtime facade\n@varve/engine + @varve/platform}
  Runtime -->|Tauri desktop| Native[Native Rust process\napps/desktop/src-tauri]
  Runtime -->|Vite/browser compatibility| Browser[Browser APIs + WASM]

  Native --> Bridge[varve-bridge]
  Bridge --> Core[varve-core / varve-engine]
  Core --> IR[Render IR]
  Browser --> Wasm[varve-wasm]
  Wasm --> IR
  IR --> Compositor[@varve/compositor\nCanvas2D baseline / WebGPU opt-in]
  Compositor --> Canvas[Canvas surface]

  Native --> Storage[User-selected files +\nTauri-resolved app storage]
  DesktopUI --> LocalBrowser[IndexedDB in browser mode]
  Website --> ReleaseData[Published release assets\nchecksums / SBOM / feeds]
```

### Process and trust boundaries

| Boundary | Authority | Contract |
|---|---|---|
| Editor UI → native process | Tauri IPC commands/events | The frontend sends typed intent; native Rust validates paths, performs privileged filesystem/network work, and returns typed results. |
| Scene → renderer | `@varve/engine` facade | Native and WASM implementations produce the same scene/render contract; the webview replays render IR. |
| Renderer → pixels | `@varve/compositor` | Canvas2D is the baseline. WebGPU is capability-gated and falls back when unavailable. |
| Editor → persistence | `@varve/platform`, history, native storage | Desktop persistence is local and Tauri-resolved; browser compatibility storage uses IndexedDB. The frontend must not derive OS application directories. |
| Website → downloads | Release workflow and generated manifest | The website consumes verified published release assets; it does not build, sign, or invent installer metadata. |
| Website → desktop | None | The marketing site is untrusted public content. It has no privileged bridge into the desktop application. |

The detailed filesystem ownership rules are in
[`filesystem-boundary.md`](filesystem-boundary.md), and the client/release
trust zones are in [`../security/trust-boundaries.md`](../security/trust-boundaries.md).

## Repository ownership map

| Area | Owns | Safe starting points |
|---|---|---|
| `apps/desktop/` | Vite entrypoint, Tauri shell integration, native IPC wiring, desktop demo staging | [`apps/desktop/README.md`](../../apps/desktop/README.md), [`desktop-runtime.md`](../desktop-runtime.md) |
| `apps/website/` | Static marketing, public docs, support pages, release/download presentation, SEO and consent UI | [`apps/website/README.md`](../../apps/website/README.md), [`../release/website.md`](../release/website.md) |
| `packages/editor/` | React editor shell, canvas tools, panels, interaction state, shortcuts, lifecycle | [`workspace-system.md`](workspace-system.md), [`lifecycle-system.md`](lifecycle-system.md) |
| `packages/scene/` | Serializable document model, scene graph, pages, operations, derived export/layout contracts | [`pages-layers-frames-shapes-system.md`](pages-layers-frames-shapes-system.md), [`persistent-history.md`](persistent-history.md) |
| `packages/engine/` + `packages/compositor/` | Backend-neutral engine facade, render replay, Canvas2D/WebGPU composition | [`render-pipeline.md`](render-pipeline.md), [`wasm-backends.md`](wasm-backends.md) |
| `packages/shared/` + `packages/ui/` | Cross-package primitives, design tokens, icons, accessible UI components | [`../adr/0002-design-tokens.md`](../adr/0002-design-tokens.md), [`../design/icon-system.md`](../design/icon-system.md) |
| `crates/` | Native geometry, render IR, print, colour, trace, media, effects, sync, and WASM bindings | [`../adr/0004-wasm-crate-boundary.md`](../adr/0004-wasm-crate-boundary.md) |
| `scripts/` | Validation, release assembly, website data refresh, screenshots, and CI diagnostics | [`../quality/validation-strategy.md`](../quality/validation-strategy.md), [`../release/README.md`](../release/README.md) |

Dependency direction is enforced: applications may consume packages and
native bridges, packages must not import applications, and workspace packages
must not form circular `workspace:*` chains. Hub modules such as the editor
shell and canvas have explicit import/complexity budgets; put new integration
in an adapter or leaf module when possible.

## Document and render data flow

1. A user action enters through the editor command/tool path. Document
   mutations are typed operations and are recorded by the authoritative history
   path; UI components do not mutate the scene behind that path.
2. The scene model remains the single document representation across workspace
   modes, pages, selection, viewport state, and undo/history. Switching a mode
   changes editor configuration, not the document or its history.
3. The engine facade chooses native IPC on desktop, WASM in the browser
   compatibility surface, or an in-memory/test implementation where configured.
   The engine computes render IR rather than pushing pixels across IPC.
4. The compositor replays IR into a canvas. Worker and pixel-reuse fast paths
   are conditional optimizations: if a fresh authoritative frame cannot be
   produced, the pipeline falls back to vector replay rather than leaving stale
   pixels on screen.
5. Save, export, print, recovery, and shutdown use their own typed boundaries.
   A successful editor render is not evidence that a file was saved or a PDF
   was produced; those workflows have separate validation and runbooks.

## What is current versus deferred

| Capability | Current truth | Canonical detail |
|---|---|---|
| Desktop editor | Supported product path; native Tauri shell with shared editor frontend | [`render-pipeline.md`](render-pipeline.md) |
| Browser editor | Vite/WASM compatibility and test surface; not a separately packaged full product | [`browser-demo.md`](browser-demo.md), [`../adr/0139-browser-fallback.md`](../adr/0139-browser-fallback.md) |
| `/try/` browser demo | Bounded sample-document demo staged during website deployment | [`browser-demo.md`](browser-demo.md) |
| Collaboration | UI scaffolding only; no real-time transport or wire protocol | [`../adr/0200-collaboration-behavior.md`](../adr/0200-collaboration-behavior.md) |
| `apps/web/` | Placeholder Next.js scaffold, excluded from the workspace and not shippable | `apps/web/package.json` and the application table in [`../README.md`](../README.md) |
| Platform signing | Pipeline and verification exist; published beta artifacts remain unsigned/notarization-free until credentials and a signed release are available | [`../release/signing-decision-record.md`](../release/signing-decision-record.md) |

“Planned”, “experimental”, and “partial” in subsystem documentation describe
the current boundary or a documented gap. They are not promises that a future
implementation is already present.

## Change-routing checklist

Before changing a boundary, identify the owning contract and run the affected
validation plan:

```bash
pnpm verify:plan
pnpm verify:affected
```

Use the nearest subsystem document for invariants, then update that document if
the behavior or ownership changes. Architecture changes also require the
architecture audit described in [`AGENTS.md`](../../AGENTS.md); release,
website, security, and public-product claims must be checked against their
machine-readable source and workflow evidence.
