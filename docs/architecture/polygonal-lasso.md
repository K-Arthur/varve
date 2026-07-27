# Polygonal Lasso

## State Machine

```
idle → onPointerDown → polygonal-placing
polygonal-placing → click near first point → apply selection → idle
polygonal-placing → Enter → apply selection → idle
polygonal-placing → Backspace/Delete → remove last point
polygonal-placing → Escape → idle (cancel)
```

## Mode Selection

`LassoTool.setMode('freehand' | 'polygonal')` switches between drag-to-draw
and click-to-place interaction. The tool defaults to `'freehand'`.

## Selection Operations

| Modifier | Operation |
|----------|-----------|
| None | Replace selection |
| Shift | Add to selection |
| Alt | Subtract from selection |
| Shift+Alt | Intersect with selection |

## Fill Rule

Even-odd ray casting — shared with freehand lasso via `pointInPolygon()`.

## Interaction

- **Click**: place a vertex
- **Click first point**: close polygon (within 8px screen tolerance)
- **Enter**: finish and apply
- **Escape**: cancel
- **Backspace/Delete**: remove last vertex
- **Mouse move**: preview segment from last point to cursor

## Edge Cases

- < 3 points: no selection applied
- Self-intersecting polygons: handled gracefully by even-odd fill rule
- Duplicate points: allowed but degenerate
- Tool switch mid-polygon: polygon dropped, draft cleared
