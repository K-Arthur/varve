# Email Template System — Architecture

**Status**: Foundation, compiler, editor authoring, preview, preflight, and local export implemented
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
        |
        v
  Email IR (email-ir-types.ts)
    - EmailIrNode tree
    - EmailDocumentIr
    - Compatibility classifications
        |
        v
  Email HTML Emitter (email-html.ts)
    - Table-based layout
    - Inline CSS
    - MSO conditionals
    - Responsive media queries
    - Preheader support
        |
        v
  Email HTML / Plain Text / Asset Manifest
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
inspection, preflight diagnostics, and local HTML/text/manifest/embedded-asset export.

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
| `packages/codegen/src/email-html.ts` | Email IR → HTML emitter |

### Editor / Workspace
| File | Purpose |
|------|---------|
| `packages/editor/src/workspace/workspaceTypes.ts` | Email workspace config |
| `packages/editor/src/shortcuts/ShortcutManager.ts` | Ctrl+Shift+7 binding |
| `packages/editor/src/actions/createActionHandlers.ts` | workspaceEmail handler |
| `packages/editor/src/menu/defs.ts` | View > Workspace > Email |
| `packages/editor/src/Menubar.tsx` | Email workspace menu entry |

### Tests
| File | Purpose |
|------|---------|
| `tests/e2e/email/visual.spec.ts` | Playwright visual verification |
| `packages/codegen/src/email.test.ts` | URL, HTML sanitization, plain text, and preflight invariants |

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
variables map to `*|TAG|*` syntax, and nodes with explicit editable-region
metadata emit stable `mc:edit` attributes. Direct authenticated publishing is
not part of this implementation; export remains local and credential-free.

## What's NOT Included (By Design)

- No campaign sending or subscriber management
- No ESP account integration
- No JavaScript execution in templates
- No automatic round-trip from arbitrary HTML back to design
- No claim of exact email-client rendering (browser preview only)

The current preview is a sandboxed iframe with scripting disabled. Remote
images may be blocked by the browser sandbox; the exported asset manifest
identifies package-relative assets for an explicit hosting step.

## Testing

### Unit Tests
- `workspaceBaseline.test.ts`: Verifies email mode panel visibility
- `version.test.ts`: Verifies schema v2.21 migration
- `workspaceStore.test.ts`: Verifies persistence with 8 modes

### E2E Tests
- `email/visual.spec.ts`: Playwright visual regression for email workspace
- `packages/codegen/src/email.test.ts`: security, output, plain text, and preflight invariants

### Type Safety
- All new types are fully typed (no `any`)
- Schema migration is forward-compatible
- Email IR types are structurally validated
