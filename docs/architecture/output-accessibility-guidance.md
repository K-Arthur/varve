# Output Accessibility Guidance

**Status:** Current guidance for the public-beta export system  
**Last reviewed:** 2026-09-09

Varve can preserve some semantic intent from a design document, but an export
is not automatically an accessible experience. Accessibility depends on the
target format, the authored content, the consuming application or email
client, and the final integration. Treat this document as the handoff
boundary between what Varve can expose and what the author or integrator must
verify.

## Format matrix

| Output | What Varve can preserve or check | Required author/integrator review |
|---|---|---|
| HTML and web code (React, Tailwind, CSS Modules, web components) | Generated HTML can carry semantic tags, labels, roles, live-region state, focusability, and image `alt` or presentation intent when those values exist in the export IR. | Inspect the generated DOM. Confirm heading and landmark structure, keyboard order, focus visibility, control names, responsive reflow, contrast, reduced-motion behavior, and meaningful image alternatives in the host application. Run an automated scan and a keyboard plus screen-reader pass on the integrated page. |
| Flutter and SwiftUI code | The visual hierarchy and text/content structure are exported as native widget code where the target supports it. | Add and verify platform semantics, labels, traits, focus order, dynamic type behavior, contrast, and reduced-motion behavior in the native application. Generated code is a starting point, not a platform accessibility approval. |
| Email HTML | Email compilation preserves live copy and links where possible, generates a plain-text projection, and preflight reports missing image alternatives, decorative-image decisions, invalid or nested links, and compatibility fallbacks. | Review every diagnostic. Confirm meaningful `alt` text or an intentional decorative mark, link purpose, heading order, text size, colour contrast, and the plain-text version. Send test messages through the actual clients and screen readers used by the audience. |
| SVG | Geometry, text, fills, strokes, and transforms are preserved. | A standalone SVG should be treated as visual content unless the consuming document adds an accessible name and appropriate `role`, `title`/`desc`, focus behavior, and keyboard interaction. Do not assume a design-layer name becomes a usable accessible description. |
| PDF and PDF/X | Print geometry, text rendering, colour management, bleed, and production marks are the export authority. Text may optionally be outlined. | Verify reading order, tags, document language, title, bookmarks, alternate text, and keyboard/screen-reader behavior with a PDF accessibility checker when an accessible PDF is required. PDF/X print compliance does not imply tagged-PDF accessibility; outlined text cannot be read as text. |
| Raster (PNG, JPEG, WebP, AVIF, BMP, GIF, and similar) | Pixels, dimensions, and the selected image format are exported. | Pixels do not contain a usable accessible name. Supply `alt` text, a caption, or a nearby text alternative wherever the asset is placed. Mark purely decorative use in the consuming HTML or content system. Check resolution, contrast, and animation independently. |

Interactive prototype and animation outputs have the same boundary: a visual
preview or generated shell does not establish keyboard, focus, timing, or
screen-reader behavior in the final runtime. Test the deployed integration.

## Author checklist

Before export:

- Give meaningful names to frames, controls, images, and other authored
  content. Use explicit accessibility labels or roles where the target
  supports them.
- Mark decorative images and visual-only artwork deliberately. Do not use a
  layer name as a substitute for a useful image description.
- Keep headings, body copy, links, and control labels as live content when
  they need to be read or operated. Avoid outlining or flattening essential
  text.
- Check contrast, focus indication, target size, reading order, and reflow in
  the design and in the intended output context.

After export:

- Record the output format, target runtime/client, colour profile, and any
  preflight warnings or fallbacks.
- For web output, run axe or an equivalent structural check, then use only a
  keyboard and a screen reader to complete the key task.
- For email, resolve preflight accessibility diagnostics, inspect the plain
  text alternative, and test the real delivery clients at desktop and mobile
  widths.
- For SVG and raster, verify the surrounding HTML or asset catalogue supplies
  the accessible name and decorative state.
- For PDF, run a tagged-PDF/reading-order checker when accessibility is a
  requirement; separately verify print-production fidelity.
- Re-test after replacing assets, changing text, switching export targets, or
  allowing a target-specific rasterization fallback.

## What this guidance does not promise

Varve does not promise that every user-authored design, generated code sample,
email, SVG, PDF, or raster asset is accessible without review. Automated
preflight and browser checks are evidence for specific conditions; they do
not replace user testing or establish WCAG, ADA, Section 508, EN 301 549, or
procurement conformance. See the public [accessibility information
statement](../../apps/website/src/pages/accessibility.astro) at `/accessibility`
for the current authoring-tool test boundary and feedback path.
