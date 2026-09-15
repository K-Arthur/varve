# Email template system — current-state audit

Date: 2026-08-20 (baseline audit; repairs landed afterward)
Branch: `master`
Method: static inspection of `packages/{scene,codegen,editor}` plus an end-to-end
probe that ran `compileEmail` → `emitEmailHtml` over a real two-column `Document`.

## 1. What already existed

An email scaffold was already committed:

| File | Lines | Role |
|---|---|---|
| `packages/scene/src/emailTypes.ts` | 308 | `EmailProfile`, `EmailSemanticMap`, `EmailLink`, `EmailVariable`, diagnostics |
| `packages/scene/src/version-migrations-v221.ts` | 12 | v2.20 → v2.21, adds optional email fields |
| `packages/codegen/src/email-ir-types.ts` | 308 | `EmailDocumentIr` and node types |
| `packages/codegen/src/email-compiler.ts` | 789 | Design IR → Email IR |
| `packages/codegen/src/email-html.ts` | 581 | Email IR → HTML |
| `packages/codegen/src/email-preflight.ts` | 191 | Diagnostics |
| `packages/codegen/src/email-security.ts` | 266 | URL validation, HTML/CSS sanitizer |
| `packages/codegen/src/email-plain-text.ts` | 48 | Plain-text fallback |
| `packages/codegen/src/email-provider.ts` | 46 | Provider adapter interface |
| `packages/editor/src/.../panels/EmailPanel.tsx` | 600 | Inspector tab |
| `packages/codegen/src/email.test.ts` | 93 | 4 tests, IR-level only |

The architecture (scene metadata → semantic IR → emitter → provider) is sound and
worth keeping. The *implementation* did not work.

## 2. Probe result

A document with `row → [column → text, column → text]`, a container link and a
text-range link compiled to HTML in which:

- both columns were emitted as **full-width stacked tables** — no columns on desktop;
- the container link was **silently dropped**;
- the text-range link was **silently dropped**;
- every text node received `background-color` equal to its own text colour,
  rendering copy invisible;
- Outlook conditional comments were **nested**, terminating early and leaking a
  stray `<![endif]-->` into the body;
- preflight reported **zero diagnostics** for all of the above.

## 3. Current-state matrix

| Capability | Scene model | Editor UI | Codegen | Persistence | Tests | Status |
|---|---|---|---|---|---|---|
| Web HTML export | n/a | yes | `html.ts` | n/a | yes | **Working** |
| Links (model) | yes | partial | yes | yes | no | **Partial** |
| Text-range links | yes | index-entry only | runs-only path | yes | no | **Broken** |
| Container/shape links | yes | yes | dropped by emitter | yes | no | **Broken** |
| Components | yes | yes | yes | yes | yes | **Working** (unused by email) |
| Design tokens | yes | yes | yes | yes | yes | **Working** (not resolved for email) |
| Responsive layout (email) | flags only | one select | not implemented | yes | no | **Missing** |
| Rows / columns | kinds exist | selectable | not implemented | yes | no | **Missing** |
| Asset export | yes | data-URL only | partial | yes | no | **Partial** |
| Local-URL leak guard | n/a | none | none in emitter | n/a | no | **Missing** |
| Code editor | n/a | `<pre>` | n/a | n/a | no | **Scaffold** |
| HTML preview | n/a | sandboxed iframe | n/a | n/a | no | **Partial** |
| Custom code block | yes | textarea | sanitized | yes | partial | **Partial** |
| Email export | yes | button | works | yes | no | **Partial** |
| Provider templates | types only | select | passthrough no-op | yes | no | **Scaffold** |
| Merge variables | yes | add-only | regex substitution | yes | no | **Partial** |
| Email preflight | yes | list | 8 checks | yes | 1 test | **Partial** |
| Plain text | yes | 240-char peek | works | yes | 1 test | **Working** |
| CSS inlining | n/a | n/a | not implemented | n/a | no | **Missing** |
| Compatibility DB | n/a | n/a | hard-coded `if`s | n/a | no | **Missing** |
| Source maps | n/a | none | none | n/a | no | **Missing** |
| Nested-anchor guard | n/a | n/a | partial (text only) | n/a | no | **Partial** |

## 4. Verdict

Keep the architecture, replace the layout/link/asset/provider internals, and add
the compatibility layer that was never written. `compileEmail` had no test at all;
the four existing tests only exercise hand-authored IR, which is why none of the
defects above were caught.

## 5. Post-audit repair note

The baseline defects above were subsequently addressed in the semantic compiler,
HTML emitter, preflight checks, provider interface, and Email inspector. The
follow-up implementation adds regression coverage for a real Varve flex row,
responsive table-cell output, text-range links, linked-container behavior,
local-image rejection, sandboxed desktop/mobile preview controls, the
read-only generated-code ownership boundary, source maps, safe CSS inlining, and
Mailchimp editable-region diagnostics. See
`docs/architecture/email-template-system.md` for the current guarantees and
remaining limits; the matrix above intentionally remains the historical audit
record rather than claiming that deferred compatibility-DB, import, or exact
client-rendering work is complete.
