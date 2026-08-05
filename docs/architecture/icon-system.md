# ADR-0006 — Icon System Architecture

## Status: Accepted (Phase 1 implemented 2026-07-27; Phases 2–3 implemented 2026-08-02)

The user-facing icon library (online discovery, acquisition, cache,
pack manager, licensing) is implemented and documented in
`docs/architecture/icon-library.md` (current state, 2026-08-04).
`docs/architecture/icon-system-audit-2026-08-02.md` is historical
evidence; verify any claim against the code before relying on it.

The four distinct icon categories are:
1. **Internal Varve UI icons** — `packages/ui/src/icons/` (this ADR).
2. **User-inserted document icons** — `packages/engine/src/icon/`,
   `packages/editor/.../IconBrowser/`, `packages/scene/src/iconAsset.ts`.
3. **Application/installer icons** — `apps/desktop/src-tauri/icons/`.
4. **Logo-workspace export icons** — `packages/scene/src/logo/`.

## Context

Varve's icon infrastructure evolved organically across two library families
(Lucide for outline, Phosphor for filled) with a thin wrapper API
(`<Icon>`, `<SolidIcon>`). This was adequate for internal UI chrome but has
several gaps that become critical when expanding to user-facing icon
workflows:

1. **No SVG sanitization** — imported/downloaded SVGs pass through to the
   scene graph without any security review. A malicious SVG could execute
   scripts or load external resources when previewed.
2. **No online provider integration** — users cannot search or download icons
   from online sources like Iconify (300k+ icons, public API).
3. **No document icon model** — icons inserted into documents have no
   semantic identity, no linked/embedded state, and no override system.
4. **No icon creation/audit workflow** — no guides, validation, or export
   presets for authoring icons in Varve.
5. **Inconsistent internal usage** — one direct `lucide-react` import
   bypasses the `<Icon>` accessibility wrapper; one emoji used as functional
   icon violates the zero-emoji policy.

This ADR documents the architecture that addresses these gaps incrementally.

## Decision

### 1. Canonical internal UI icon API

The `<Icon>` (Lucide) and `<SolidIcon>` (Phosphor) wrappers in
`packages/ui/src/icons/` remain the only graphics path for UI affordances.

- All feature code imports from `@varve/ui` — never directly from
  `lucide-react` or `@phosphor-icons/react`.
- `<Icon>` enforces the accessible-name contract: `label` → `role="img"`
  + `aria-label`; no `label` → `aria-hidden` (decorative).
- Curated name maps (`TOOL_ICONS`, `CHROME_ICONS`, `SOLID_*`) group icons
  by surface so toolbars and menus use stable, reviewable name sets.

### 2. SVG sanitization module

A new module `packages/engine/src/icon/svgSanitize.ts` provides
security-focused SVG cleaning for untrusted content.

**Principles:**
- All imported and downloaded SVG is treated as untrusted.
- The module uses a string-based XML parser (no DOMParser) — inherently
  safe from script execution during parsing.
- Dangerous elements (`<script>`, `<style>`, `<foreignObject>`, animations,
  etc.) are removed with their subtrees.
- Dangerous attributes (event handlers, `javascript:` URLs, external
  resource references) are stripped.
- Resource limits protect against denial-of-service (nesting depth, path
  commands, total elements, attribute length).
- The allowed SVG subset is: `svg`, `g`, `path`, `rect`, `circle`,
  `ellipse`, `line`, `polyline`, `polygon`, `defs`, `use`, `symbol`,
  `clipPath`, `mask`, gradients, `stop`, `image`, `title`, `desc`,
  `metadata`.
- Configurable via options: `allowImages`, `allowUse`, `allowGradients`,
  `allowClipMask`, `stripAccessibility`.

**Public API:**
```ts
function sanitizeSvg(svg: string, options?: SanitizeOptions): SanitizeResult;
function isSvgSafe(svg: string): boolean;
function normalizeViewBox(svg: string, targetSize?: number): SanitizeResult;
function applyCurrentColor(svg: string): SanitizeResult;
```

### 3. Icon provider abstraction

A new module `packages/engine/src/icon/iconProviders.ts` defines a uniform
interface for online icon repositories, modeled after the font provider
pattern (`packages/engine/src/font/fontProviders.ts`).

**`IconProvider` interface:**
```ts
interface IconProvider {
  id: string;
  name: string;
  kind: 'public-api' | 'local-filesystem' | 'bundled';
  enabled: boolean;
  requiresNetwork: boolean;
  search(query, options?): Promise<IconProviderResult[]>;
  getDetails(iconId): Promise<IconProviderIconDetails | null>;
  getSvg(iconId, style?): Promise<string | null>;
  getPrefixes?(): Promise<IconPackInfo[]>;
  getCategories?(): Promise<string[]>;
}
```

**`IconProviderRegistry`:** Manages multiple providers, searches all
enabled sources in parallel, deduplicates results.

### 4. Iconify provider

`packages/engine/src/icon/iconifyProvider.ts` implements `IconProvider`
against the public Iconify API (`https://api.iconify.design`).

- Free, no API key required, 300k+ icons from 200+ open-source sets.
- Search endpoint for in-app browser.
- Collection metadata for pack browsing and licensing.
- SVG retrieval for download/insertion.

### 5. Semantic naming

Internal icons use action/concept names (`DeleteIcon`, not
`TrashCanOutlineIcon`). The curated maps are the migration path: feature
code references the semantic key, the map provides the concrete library
name. When a key's visual representation changes, only the map entry
updates — feature code is untouched.

### 6. Document icon asset model

Icons inserted into documents use the existing `FrameNode` component model:

- **Component definition** captures the icon's master representation
  (sanitized SVG serialized to scene nodes).
- **Instance** carries `componentId`, `variant`, `propertyOverrides`.
- **Linked vs. embedded**: embedded stores vector data in the document;
  linked references a provider icon ID with a local fallback.
- **Detach** converts the instance to editable path nodes.

### 7. Icon variants and states

The existing `Variant` model on `ComponentDefinition` supports icon variants
(outline, filled, duotone, etc.). Variant selection updates the instance's
`variant` field and resolves the corresponding master subtree.

## Consequences

### Positive

- **Security**: SVG sanitization prevents XSS and data exfiltration from
  untrusted icon content.
- **Extensibility**: Provider abstraction allows adding new icon sources
  (Simple Icons, custom packs) without UI changes.
- **Consistency**: Centralized icon naming eliminates visual drift across
  toolbars, menus, and panels.
- **Offline-first**: Embedded icons and cached provider SVGs keep documents
  usable without network.

### Neutral

- **Two-library strategy persists** — Lucide for outline, Phosphor for
  filled. Migration to a single library is a separate initiative.
- **No breaking changes** to existing icon usage — the `<Icon>` and
`<SolidIcon>` APIs are unchanged.

### Negative

- **Bundle size**: Adding the sanitization module and provider abstraction
  increases the engine package size (~8KB minified).
- **Provider maintenance**: Online providers may change their APIs; the
  abstraction isolates this risk but requires monitoring.

## Migration plan

1. **Phase 1** (this implementation): SVG sanitization, provider
   abstraction, Iconify provider, fix violations.
2. **Phase 2**: Icon browser UI (reuse FontBrowser patterns), download
   manager integration, local caching.
3. **Phase 3**: Document icon asset model, insertion workflow, variant
   controls.
4. **Phase 4**: Icon creation tools, audit panel, export presets, code
   generation for icon components.

## Implementation status (2026-08-02)

| Phase | Deliverable | Status |
|---|---|---|
| 1 | `svgSanitize.ts`, `iconProviders.ts`, `iconifyProvider.ts`, `iconLicence.ts`, `iconAudit.ts`, `iconExport.ts`, `iconVariants.ts` | **Done** (2026-07-27) |
| 2 | `IconBrowser.tsx` + IndexedDB cache + download manager + debounced search; icon browser dialog; Layers-panel trigger | **Done** (2026-08-02) — browser now reachable from Layers header; downloads fixed to use the provider registry |
| 3 | `Document.iconAssets` + `NodeBase.iconAssetId` + codec validation/pruning; `useIconAssets` insert/replace/detach; inspector Icon section; clipboard provenance | **Done** (2026-08-02) |
| 4 | Icon creation workspace, audit panel UI, export dialog, pack manager, provider settings, virtualized browser | **Deferred** — see the audit doc for scope |

### Canonical internal UI icon API (Phase 2 addition)

`packages/ui/src/icons/semantic.tsx` adds the semantic registry on top of
`<Icon>` / `<SolidIcon>`:

- `SemanticIconName` — typed action/concept names (`Delete`, `Union`,
  `AlignLeft`), PascalCase, no `Alt`/numeric suffixes.
- `SEMANTIC_ICONS` — one table mapping each semantic name to an outline
  (Lucide) and filled (Phosphor) implementation; TypeScript validates both
  names exist.
- `SemanticIcon` component with `label`/decorative contract, `family`
  switch, `size` tokens (`xs`–`xl`), and `mirror` for directional (RTL)
  icons. `DIRECTIONAL_ICONS` lists only meaning-directional icons.
- `validateSemanticIconNames()` — dev/test gate for naming rules.

**Rule:** new feature code should prefer `SemanticIcon`; keep using the
existing curated maps (`TOOL_ICONS` etc.) where already wired. Do not import
`lucide-react` or `@phosphor-icons/react` directly in feature code.

### Document icon asset model (Phase 3 implementation)

- `Document.iconAssets: Record<string, DocumentIconAsset>` — sanitized SVG
  plus provenance (provider, prefix, licence, attribution, tags, viewBox).
  Embedded by default: the vector data travels with the document, so
  provider outages, cache clears, and offline opens never break rendering.
- `NodeBase.iconAssetId` — reference from the inserted scene subtree root.
- `DocumentCodec` validates and prunes unreferenced/invalid icon assets on
  decode; closures carry `iconAssets` for copy/paste and clipboard.
- Editor flows in `packages/editor/src/context/useIconAssets.ts`:
  `insertIconAsset` (sanitize → import pipeline → single undo transaction),
  `replaceIconAsset` (fits the new icon into the old bounds, removes the
  old nodes), `detachIconNodes` (clears provenance, geometry unchanged).
- UI: `IconBrowserDialog` (Insert/Replace modes), Layers panel header
  trigger, inspector `Icon` section (provenance, replace, detach).

## Package boundaries

| Package | Responsibility |
|---------|---------------|
| `@varve/engine/svgSanitize` | SVG security sanitization |
| `@varve/engine/iconProviders` | Provider abstraction + registry |
| `@varve/engine/iconifyProvider` | Iconify API integration |
| `@varve/ui/icons` | `<Icon>`, `<SolidIcon>`, curated maps |
| `@varve/scene` | Document icon component model |
| `@varve/editor` | Icon browser UI, icon creation tools |
| `@varve/import` | SVG import (uses sanitization) |
| `@varve/codegen` | Icon code generation |
