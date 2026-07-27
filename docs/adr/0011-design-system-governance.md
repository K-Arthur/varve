# ADR-0011: Design System Governance — component lifecycle, contribution rules, enforcement

- **Status:** Accepted
- **Date:** 2026-07-27
- **Related:** ADR-0002 (tokens), ADR-0008 (accessibility), `docs/design/design-principles.md`

## Context

Strata's UI is built on `@strata/ui`, a shared component library consumed by
the editor, home, settings, and export surfaces. Until now, no formal process
governed how components are added, matured, deprecated, or removed. This created
duplicate implementations, inconsistent prop APIs, and unchecked token bypasses.

This ADR establishes the rules for evolving the design system without
introducing regressions or drift.

## Decisions

### 1. Component maturity states

Every component in `@strata/ui` has an explicit maturity, encoded in its source
file as a `/** @maturity */` JSDoc tag:

| State | Meaning | Consumers may depend on it? |
|---|---|---|
| `experimental` | API unstable, not yet in real workflows | No — only the authoring surface |
| `beta` | API mostly stable, limited production use | Yes — with the understanding that breaking changes may occur |
| `stable` | API locked, used in multiple surfaces | Yes |
| `deprecated` | Still works, but a replacement exists | No new consumers — existing consumers must migrate |
| `removed` | Exported as a type-only stub that throws at runtime | No |

Maturity is tracked in `packages/ui/src/components/index.ts` barrel comments and
in `docs/design/component-status.md`.

### 2. Contribution rules

To add a new component or token:

1. **Check for duplicates first.** Search `@strata/ui`, `packages/editor`, and
   `packages/home` for existing implementations. If a similar component exists,
   extend it rather than creating a new one.
2. **Use semantic tokens.** No hardcoded hex, rgb, hsl, or palette-step values
   in component CSS. Every color, space, radius, shadow, and motion value
   traces to a token in `tokens.css`.
3. **Define a typed variant API.** No untyped Boolean prop combinations
   (`<Button primary large round block inverse />`). Use discriminated unions:
   `variant: 'primary' | 'secondary' | 'danger'`, `size: 'sm' | 'md' | 'lg'`.
4. **Keyboard + screen-reader from day one.** Every interactive component must
   ship with correct `role`, `aria-*` state attributes, keyboard navigation,
   and visible focus. Accessibility is not a follow-up PR.
5. **Ship with a Storybook story.** Every `stable` component has at least one
   `.stories.tsx` file covering default, variants, sizes, and states.
6. **Ship with a unit test.** Every component has at least one `.test.tsx`
   covering rendering, interaction, and a critical a11y assertion.

### 3. Deprecation policy

When replacing a component or token:

1. Add a `@deprecated` JSDoc tag with the replacement name and migration note.
2. Add a `console.warn` in development when the deprecated API is used.
3. Update `docs/design/component-status.md` with the deprecation.
4. Migrate all existing consumers before removal.
5. Remove only after zero consumers remain (verified by `knip` dead-code analysis).

Never delete a commonly used primitive without a migration path.

### 4. Token compatibility aliases

Some editor CSS uses legacy token names that don't match the canonical
`color.ts` naming. Rather than rewrite 39 call sites in one pass, the generator
emits **compatibility aliases** — secondary names that point to the canonical token:

```css
/* generator output */
--color-surface-default: var(--color-surface-base);     /* alias */
--color-on-accent: var(--color-text-on-accent);         /* alias */
--color-accent-hover: var(--color-interactive-hover);   /* alias */
```

Aliases are:
- Generated only from a named `COMPATIBILITY_ALIASES` map in the generator script.
- Documented in `docs/design/token-aliases.md`.
- Removed once all consumers migrate to the canonical name (tracked by audit rule).

New code must use canonical names. Aliases exist only for incremental migration.

### 5. Automated enforcement

| Rule | Tool | Fail CI? |
|---|---|---|
| Hardcoded color values in CSS | stylelint `color-no-hex` + custom | Yes (post-migration baseline) |
| Hardcoded spacing outside tokens | stylelint `property-disallowed-list` | Yes (post-migration baseline) |
| `tabIndex > 0` | Biome `noPositiveTabindex` | Yes |
| Missing accessible name on icon-only controls | Biome + Storybook a11y addon | Yes |
| Token drift (CSS ≠ TS source) | `tokens.test.ts` drift guard | Yes |
| WCAG 2.2 AA contrast | `audit-tokens.ts` (123 pairs) | Yes |
| Duplicate component implementations | `knip` + manual audit | Warning |
| Deprecated component usage | `knip` dead-code + JSDoc `@deprecated` | Warning (fails after migration deadline) |

New violations fail CI once the migration baseline is established. Legacy
violations are tracked in `docs/design/migration-debt.md` — not ignored.

### 6. Z-index architecture

Named layers prevent arbitrary `z-index: 99999`:

| Layer | Token | Value |
|---|---|---|
| Base | `--elevation-z-sunken` | 0 |
| Default | `--elevation-z-default` | 1 |
| Raised | `--elevation-z-raised` | 100 |
| Overlay / scrim | `--elevation-z-overlay` | 1000 |
| Dialog | `--z-dialog` | 1100 |
| Modal (nested) | `--z-modal` | 1150 |
| Toast | `--z-toast` | 1200 |
| Tooltip | `--z-tooltip` | 1300 |

New layers are added via the token system — never as raw numbers in component CSS.

### 7. Density modes

Three modes adjust control sizing without redefining logic:

| Mode | When | Effect |
|---|---|---|
| `comfortable` | Default | Full padding, 36px control height |
| `compact` | User preference or narrow window | Reduced padding, 28px control height |
| `touch` | Touch-primary device | Enlarged padding, 44px control height |

Density changes `--space-*` and `--radius-*` scale via CSS custom properties scoped
to `[data-density="compact"]`. It never reduces touch targets below 24×24px.

## Consequences

- All new UI routes through `@strata/ui` — no one-off components.
- Token drift is caught by CI within one commit.
- Deprecations are explicit, tracked, and reversible.
- The 39-call-site `--color-surface-default` migration can proceed incrementally
  instead of requiring a single risky PR.

## Migration tracking

See `docs/design/migration-debt.md` for the per-surface migration status.
