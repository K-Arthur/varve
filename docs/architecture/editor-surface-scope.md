# Editor surface scope

Status: current architecture (2026-09-08)

Varve stores several kinds of content in one `Document`: Design Canvas roots,
publishing pages, master sources, global pasteboard objects, and legacy flat
roots. An editor-facing label or overlay must describe the scene the user is
currently viewing, not the complete `document.nodes` map.

## Contract

`packages/scene/src/editorSceneScope.ts` resolves an immutable
`ResolvedEditorSceneScope` from the document and view state. It has four tagged
base surfaces:

- `designCanvas:<id>` — the active Design Canvas in non-Print workspaces;
- `publishing:allPlacedPages` — the Print publishing pasteboard;
- `master:<id>` — the source subtree while a master is being edited;
- `legacyFlatPasteboard` — the explicit zero-page, zero-canvas fallback.

The resolver reuses `multipageNodeInstances`, preserves qualified master
occurrence ids, filters effective ancestor visibility, applies isolation, and
re-roots depth at an isolation boundary. Metadata-owned content roots are not
user artwork. Invalid Design Canvas ids recover to the first persisted canvas;
malformed or cyclic child graphs terminate safely.

The invariant for current-surface producers is:

```text
emitted occurrence ids ⊆ scope.interactiveOccurrenceIds
```

Development builds call `assertOccurrencesInScope` from the visible label,
accessibility, minimap, and export-region producers. Production builds keep
the guard inert.

## Consumer policy

| Consumer | Scope | Intentional difference |
| --- | --- | --- |
| Main renderer | `scope.occurrences` | Paints the selected surface; Print also paints publishing page decoration. |
| Canvas name labels | `scope.occurrences` | Presentation is a separate policy: persistent top-level frames, transient nested/ordinary names, deterministic collision and density rules. |
| Accessibility tree | `scope.occurrences` | Remains available as semantic DOM even when visual editing labels are hidden in preview. |
| Minimap | `scope.occurrences` | Print adds placed-page outlines; Design Canvas mode does not add page bands. |
| Hit testing | Supplied `sceneScope` | Spatial indexes may remain document-wide for broad-phase speed, but only scoped occurrences are eligible. |
| Export-region overlay | `scope.occurrences` | Export regions are editor chrome and remain outside authored pixels. |
| Layers and document search | Existing hierarchy/search contracts | Layers may expose document management surfaces; whole-document search may find inactive content, but current-surface selection must validate or navigate to its owner. |

Publishing page number/name bands are a separate Print decoration policy in
`canvas/pageDecorations.ts`. They are not object-name labels and are never
drawn for a Design Canvas. Editor labels are SVG/DOM chrome, not scene nodes,
serialized SVG text, export pixels, clipboard artwork, or undo operations.

## Geometry and state

Label candidates retain the qualified occurrence id, authored node id, surface
key, logical depth, paint order, and transformed world bounds. Projection uses
the owning canvas viewport and the full camera rotation transform. Display
names are one line and bounded, while the sanitized full name remains in the
SVG `<title>` and accessibility label.

Surface changes clear or revalidate selection and the editor's surface-bound
targets before commands act. Local hover/edit state is additionally checked
against the resolved scope at overlay composition time, so a stale asynchronous
target cannot create a label for an inactive canvas.

Future surface-owned records (comments, collaboration presence, prototype
links, and tool annotations) must carry or resolve a surface key before they
are painted. Document-wide workflows should remain explicitly document-wide;
they must not silently use their result as a current-surface overlay.

## Tests and maintenance

Keep mixed Page + multi-Design-Canvas fixtures in the scene scope tests. When a
new editor overlay displays a node name or occurrence, pass the existing scope
from `CanvasOverlays` or resolve it at the owning surface boundary. Do not add
a private `rootChildren`, `activePageNodes`, or `Object.values(doc.nodes)` walk
inside an overlay component.

The root-cause history and original producer audit are recorded in
`docs/audits/canvas-label-isolation-2026-09-08.md`.
