# Email Template System — Architecture

**Status**: Semantic compiler, responsive preview, safe code workflow, source mapping, preflight, local package export, and Mailchimp region mapping implemented; broad client-compatibility database and arbitrary HTML import remain deferred
**ADR**: Pending (will be ADR-02XX)

## Overview

Varve's email template system enables designing, compiling, and exporting
email-compatible HTML templates directly from the Varve design editor. It
leverages normal Varve design primitives (frames, text, images, components,
tokens) augmented with email-specific semantics.

## Architecture

```
Varve Scene (Document)
  + emailProfile (document-level settings)
  + emailSemantics (per-node email meaning)
        |
        v
  Email Compiler (email-compiler.ts)
    - Semantic kind resolution
    - Link/image/asset compilation
    - Compatibility classification
    - Style translation via the compatibility database
        |
        v
  Compatibility database (email-compat.ts)
    - Per-profile CSS support, fallbacks, and rationale
    - Web-safe font stacks
        |
        v
  Email IR (email-ir-types.ts)
    - EmailIrNode tree
    - EmailDocumentIr
    - Compatibility classifications + degraded declarations
        |
        v
  Layout pass (email-layout.ts)
    - Bands side-by-side geometry into rows and columns
    - Resolves column widths and reading order
    - Reports overlap email cannot layer
        |
        v
  Email HTML Emitter (email-html.ts)
    - Table-based layout
    - Safe simple-selector CSS inlining
    - MSO conditionals
    - Responsive media queries
    - Preheader support
        |
        v
  Email HTML / Plain Text / Asset Manifest / Source Map
        |
        +--> Provider adapter (generic / limited Mailchimp mapping)
        |
        +--> Sandboxed browser preview
```

## Key Design Decisions

### Email Profile (Document-Level)

An optional `emailProfile` field on `Document` captures document-wide email
settings. When absent, the document is a normal Varve design with no email
semantics.

```typescript
interface EmailProfile {
  version: number;
  subject?: string;
  preheader?: string;
  language: string;          // ISO 639-1
  direction: 'ltr' | 'rtl';
  contentWidth: number;      // Default 600px
  mobileBreakpoint: number;  // Default 480px
  compatibilityProfile: 'conservative' | 'modern' | 'provider-specific';
  provider: 'generic' | 'mailchimp';
  customCss?: string;
}
```

### Email Semantic Metadata (Per-Node)

`Document.emailSemantics` stores a map keyed by node ID containing
email-specific meaning for each node.

```typescript
interface EmailSemanticMap {
  nodes: Record<string, EmailSemanticMetadata>;
  textRangeLinks: Record<string, EmailTextRangeLink>;
  variables: EmailVariable[];
  customHtmlBlocks: Record<string, EmailCustomHtmlBlock>;
  assets: Record<string, EmailAssetInfo>;
  diagnostics: EmailDiagnostic[];
}
```

### Semantic Kind Resolution

The compiler infers email semantic kinds from:
1. **Explicit user assignment** (via Email inspector tab)
2. **Design IR semantic roles** (button → button, header → hero, etc.)
3. **Node content type** (text → paragraph, image → image)
4. **Default fallback** → container

### Compatibility Classification

Each compiled node receives a classification:
- **native**: Directly representable in email HTML
- **converted**: Mapped to an email-compatible construct (e.g., flex → table)
- **approximated**: Approximated with available CSS
- **rasterized**: Converted to an image (with explicit warning)
- **unsupported**: Cannot be represented (warning shown)

### Link Model

Links are first-class email constructs:
```typescript
interface EmailLink {
  url: string;
  kind: 'web' | 'email' | 'tel' | 'anchor' | 'merge-tag';
  target?: '_blank' | '_self';
  title?: string;
  tracking?: EmailTrackingParams;
}
```

Text-range links are stored separately and resolved during compilation.

### Custom HTML Blocks

User-authored HTML blocks are stored as `EmailCustomHtmlBlock` entries in
the semantic map. They survive recompilation and are sanitized for email
safety (stripped of `<script>`, event handlers, `javascript:` URLs).

## Email Workspace

The 8th workspace mode (`Ctrl+Shift+7`) provides:
- **Layers panel**: Standard layer tree
- **Inspector**: Properties + Email tab + Appearance + Export + Audit + Fonts
- **Status bar**: Preflight warnings, cursor position, zoom
- **Toolbar**: Select, hand, zoom, frame, shapes, text, line, arrow, scale, inspect

The Email inspector is mounted as a real top-level inspector tab. It supports
enabling a normal Varve document as an email, template settings, semantic node
assignment, whole-node links, text-range links, custom HTML blocks,
personalization variables, a sandboxed browser preview, generated HTML
inspection with syntax highlighting/find/replace, source-mapped generated ranges,
preflight diagnostics, optional UTM tracking, a plain-text preview, and local
HTML/text/manifest/embedded-asset export.

The preview has explicit desktop/mobile viewport controls, and generated HTML
is read-only; user-authored custom HTML remains a separate preserved source
block.

## Files

### Scene Model
| File | Purpose |
|------|---------|
| `packages/scene/src/emailTypes.ts` | All email type definitions |
| `packages/scene/src/document.ts` | Document interface (emailProfile, emailSemantics) |
| `packages/scene/src/version.ts` | Schema v2.20 → v2.21 migration |
| `packages/scene/src/version-migrations-v221.ts` | Migration implementation |

### Codegen / Compiler
| File | Purpose |
|------|---------|
| `packages/codegen/src/email-ir-types.ts` | Email IR type definitions |
| `packages/codegen/src/email-compiler.ts` | Scene → Email IR compiler |
| `packages/codegen/src/email-compat.ts` | Per-profile CSS support table, fallbacks, font stacks |
| `packages/codegen/src/email-layout.ts` | Row/column inference from geometry, overlap reporting |
| `packages/codegen/src/email-html.ts` | Email IR → HTML emitter |
| `packages/codegen/src/email-css.ts` | Conservative simple-selector CSS inliner |
| `packages/codegen/src/email-security.ts` | URL, HTML, CSS, and provider-attribute safety |
| `packages/codegen/src/email-provider.ts` | Generic/Mailchimp provider adapters |

### Editor / Workspace
| File | Purpose |
|------|---------|
| `packages/editor/src/workspace/workspaceTypes.ts` | Email workspace config |
| `packages/editor/src/shortcuts/ShortcutManager.ts` | Ctrl+Shift+7 binding |
| `packages/editor/src/actions/createActionHandlers.ts` | workspaceEmail handler |
| `packages/editor/src/menu/defs.ts` | View > Workspace > Email |
| `packages/editor/src/Menubar.tsx` | Email workspace menu entry |
| `packages/editor/src/components/Inspector/panels/EmailPreflightPanel.tsx` | Grouped, severity-ranked preflight results |
| `packages/editor/src/components/Inspector/panels/EmailNodeCompatibility.tsx` | Per-object compilation readout |

### Tests
| File | Purpose |
|------|---------|
| `tests/e2e/email/visual.spec.ts` | Playwright visual verification |
| `packages/codegen/src/email.test.ts` | URL, HTML sanitization, plain text, and preflight invariants |
| `packages/codegen/src/email-layout.test.ts` | Row inference, column widths, reading order, overlap, profile reporting |

## Schema Migration

v2.20 → v2.21 adds optional fields:
- `emailProfile?: EmailProfile` on Document
- `emailSemantics?: EmailSemanticMap` on Document

Both fields are optional — existing documents open unchanged.

## Compatibility Profiles

| Profile | Layout | CSS | Borders | Gradients | Position |
|---------|--------|-----|---------|-----------|----------|
| Conservative | Converted presentation tables | Inline | Solid only | Solid fallback | No |
| Modern | Flex + tables | Inline + style | Full | Linear/radial | Relative |
| Provider-specific | Adapter-dependent | Adapter-dependent | Adapter | Adapter | Adapter |

## Provider Adapters

The architecture supports pluggable provider adapters:
```typescript
interface EmailProviderAdapter {
  compile(ir: EmailDocumentIr): string;
  validate(ir: EmailDocumentIr): EmailDiagnostic[];
  mapVariable(var: EmailVariable): string;
  requiredMetadata(): string[];
}
```

Generic and Mailchimp adapters are isolated in `email-provider.ts`. Mailchimp
variables map to `*|TAG|*` syntax. Stable editable-region metadata emits
`mc:edit` and optional `mc:label`; repeat regions emit named `mc:repeatable`
attributes. Preflight rejects duplicate, unsafe, missing, or nested editable
regions. Direct authenticated publishing is not part of this implementation;
export remains local and credential-free. Provider-side conditional execution,
full Mailchimp template validation, and transactional-provider semantics remain
deferred.

## What's NOT Included (By Design)

- No campaign sending or subscriber management
- No ESP account integration
- No JavaScript execution in templates
- No automatic round-trip from arbitrary HTML back to design
- No claim of exact email-client rendering (browser preview only)

The current preview is a sandboxed iframe with scripting disabled. Remote
images may be blocked by the browser sandbox; the exported asset manifest
identifies package-relative assets for an explicit hosting step.

## Current guarantees and known limits

The repaired compiler now covers the highest-risk baseline cases:

- side-by-side design geometry is banded into rows and columns automatically,
  so a two-column layout survives without the designer hand-tagging every
  container; author-tagged rows still win over inferred ones;
- column widths are split in proportion to the design and always sum to the row,
  and columns stack on mobile by default;
- normal Varve flex rows compile to desktop table cells with mobile stacking;
- live text remains live, including text-range links without rich-text runs;
- linked containers are retained when they do not contain another link;
- nested anchor scopes, invalid links, unsafe custom markup/CSS, and local image
  paths produce diagnostics and are not emitted as executable content;
- inline styles escape attribute content, and generic HTML, plain text, and a
  package manifest can be exported together.

Generated code is exposed through a read-only, syntax-highlighted editor with
line numbers, find/replace, and source-range selection. Custom HTML and CSS use
the same controlled editor and remain preserved source blocks; they are never
silently overwritten by design recompilation. The compiler produces deterministic
HTML source maps and inlines simple safe selectors while retaining media-query
rules.

Compatibility decisions live in one table (`email-compat.ts`) rather than in
scattered profile checks. Every declaration the compiler emits is judged against
it, and anything dropped or substituted is recorded on the node, reported by
preflight with its reason, and shown against the selected object in the
inspector. Effects with no email equivalent — rotation, blend modes, shadows,
blur — are declared precisely so they can be reported rather than vanishing
silently.

Preflight findings and emission warnings share one grouped panel, ranked by
severity within and across categories, with severity named in words as well as
colour.

Detached HTML ownership, imported-HTML round tripping, and exact
Gmail/Outlook render verification remain future work. The browser preview is
labelled as a browser preview rather than client proof; nothing in Varve
verifies how a specific mail client renders a message.

## Testing

### Unit Tests
- `workspaceBaseline.test.ts`: Verifies email mode panel visibility
- `version.test.ts`: Verifies schema v2.21 migration
- `workspaceStore.test.ts`: Verifies persistence with 8 modes

### E2E Tests
- `email/visual.spec.ts`: Playwright visual regression for email workspace
- `packages/codegen/src/email.test.ts`: security, output, plain text, and preflight invariants
- `packages/editor/src/components/Inspector/panels/EmailCodeEditor.test.tsx`: code editing, replacement, read-only ownership, and source-range selection
- `packages/codegen/src/email-layout.test.ts`: row inference, proportional column widths, reading order, mobile stacking, overlap severity, and profile font behaviour, all driven through `compileEmail` from real geometry
- `packages/editor/src/components/Inspector/panels/EmailPreflightPanel.test.tsx`: severity ranking, counts, navigation, and stale-node handling
- `packages/editor/src/components/Inspector/panels/EmailNodeCompatibility.test.tsx`: classification readout, column description, and degraded-style explanations

### Type Safety
- All new types are fully typed (no `any`)
- Schema migration is forward-compatible
- Email IR types are structurally validated
