# Varve product-design capability map

Status: current-state audit, 2026-08-13

This audit follows the product-design expansion brief in the attached task
specification. It records the systems that already exist before extending
them, so new work does not create a second workspace, inspector, command, or
document model.

## Product-design lifecycle

| Lifecycle stage | Existing Varve system | Assessment | Highest-value gap |
|---|---|---|---|
| Ideation and structure | Home/start surface, pages, frames, layers tree, templates | Implemented and healthy | Improve navigation/search for very large documents |
| Layout and responsive design | `@varve/layout`, frame `layoutStyle`, tables and responsive rules | Implemented but incomplete | More complete editor visualization and breakpoint preview |
| Visual design | Scene nodes, geometry tools, inspector sections, effects, typography and colour systems | Implemented and broad | Continue mixed-value and contextual inspector coverage |
| Reuse and design systems | Components, instances, variants, slots, variables, tokens, libraries | Implemented but incomplete | More discoverable asset/component reuse and safe reference repair UI |
| Interaction and prototype | `@varve/prototype`, prototype inspector, presenter, motion system | Implemented but incomplete | Consolidate flow authoring and preview feedback |
| Review and handoff | Audit panel, codegen, export, preflight, thumbnail and print systems | Implemented but incomplete | Keep contextual handoff controls discoverable without crowding design controls |
| Persistence | Versioned scene migrations, document codec, history, platform settings | Implemented and healthy | Treat workspace layout as a fully reliable application preference |

## Workspace and interaction map

| Area | Evidence | Classification | Current gap / decision |
|---|---|---|---|
| Workspace modes | `packages/editor/src/workspace/workspaceTypes.ts`, `useWorkspaceMode.ts` | Implemented and healthy | Keep one shared document and one switch path |
| Workspace customization | `WorkspaceCustomizeDialog.tsx`, `workspaceStore.ts` | Implemented but incomplete | Visibility is wired; width persistence and toolbar composition need contract fixes |
| Panel sizing | `PanelResizeHandle.tsx`, `useWorkspacePanelWidths.ts`, `editor.css` | Implemented but incomplete | Widths are written to legacy global settings, but per-mode saves currently discard the returned immutable preference object |
| Toolbar discovery | `FloatingToolbar.tsx`, `workspaceTypes.ts`, shortcut registry | Implemented but incomplete | Toolbar renders a hard-coded list; effective workspace tool overrides must be authoritative |
| Layers and selection | `LayersPanel/`, canvas input pipeline, selection commands | Implemented and healthy | Large-tree performance remains an ongoing concern |
| Inspector | `components/Inspector/`, section registry and feature ownership audit | Implemented and broad | Continue contextual/mixed-value improvements; do not add a second property model |
| Commands and history | `actions/`, command helpers, persistent history | Implemented and healthy | New mutations must continue through the canonical action/history path |
| Accessibility | APG tabs, tree, menus, dialogs, canvas announcer, audits | Implemented but incomplete | Verify new workspace controls with keyboard and screen-reader semantics |
| Multimodal editing | `packages/ai`, trace/upscale/background-removal workflows | Partially scaffolded to implemented by feature | Keep provider adapters outside the scene model; plans must be validated and undoable |

## Implementation order for this expansion

1. Close workspace application-state contracts: per-mode widths, safe
   sanitization, and authoritative toolbar composition.
2. Exercise those contracts through keyboard and pointer tests, including
   narrow-window behavior and workspace switching.
3. Improve the most visible product-design workflows on top of existing
   scene/layout/component systems: contextual inspector, responsive preview,
   and reusable resource discovery.
4. Extend multimodal work only through inspectable design-edit plans that are
   validated before normal editor commands apply them.

The first slice deliberately does not introduce a new layout engine, a second
toolbar registry, or document-persisted UI preferences. Workspace state remains
application state; artwork remains in the scene/document model.

## Validation baseline

The worktree was already dirty before this slice. Existing changes include
print/bleed rendering, website analytics, validation-lane updates, and render
surface tests; they are outside this audit slice and must remain untouched.
Future slices follow `pnpm verify:plan` and `pnpm verify:affected`, with browser
tests added for any canvas or pointer interaction change.
