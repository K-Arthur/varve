# Publishing page layout guides

Varve has two related but distinct layout systems:

- `FrameNode` auto-layout controls how authored children flow inside a design
  surface.
- `PageLayoutSettings` describes the composition area of a publishing page.

Page layout values are canonical document pixels and resolve in this order:

```text
document.pageLayout
  → assigned master.layout
  → page.layout
  → zero-margin, one-column default
```

The resolver maps inside/outside margins to physical edges for facing pages,
including RTL binding. It returns usable page bounds and equal-width columns;
it does not change node transforms or content ownership. Invalid structural
values are rejected by `page.set-layout`; margins or gutters that do not fit
are retained as an explicit warning for the inspector/preflight to surface.

The Page inspector writes page-local overrides through the typed page
operation. The Page-tool overlay draws the resolved usable area and columns as
view-only SVG geometry. It never enters the scene graph, layer tree, hit-test
index, persistence as a node, or export payload.

This distinction keeps page-layout publishing workflows separate from
Figma-style frame organization. Full text reflow, column snapping, parent-page
editing, and PDF spread consumption are later vertical slices and must use
this resolver rather than introducing parallel arithmetic.
