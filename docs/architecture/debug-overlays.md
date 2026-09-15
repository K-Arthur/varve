# Debug Overlay Architecture

The debug overlay subsystem provides developer-only canvas diagnostics without
affecting production builds or user content.

## Architecture

```
DebugOverlayRegistry.ts  →  Type definitions and snapshot schemas
DebugSnapshotProvider.ts →  Read-only adapters from editor state
DebugOverlayHost.tsx     →  React SVG overlay renderer
```

### Channels

Each channel is independently togglable via `EditorState.debugOverlay.channels`:

| Channel | Renders | Data source |
|---------|---------|-------------|
| geometry | World bounds, transform origins, labels | TransformCache |
| hitTest | Tolerance circle, candidates, selected node | HitTestEngine |
| spatialIndex | Grid cells, query region, staleness | SpatialIndex |
| interaction | Pointer position, tool, modifiers | EditorState |
| selection | Selected IDs, primary, mode | EditorState |
| performance | Frame timing HUD | Performance timers |

### Production gating

`isDebugBuild()` checks `process.env.NODE_ENV === 'development'`. In production
builds `DebugOverlayHost` returns `null`. The overlay uses `pointer-events: none`
and `aria-hidden="true"` so it never intercepts canvas interaction or appears in
accessibility trees.

### Adding a new channel

1. Add channel name to `DebugOverlayChannel` union in `DebugOverlayRegistry.ts`
2. Create snapshot interface and add field to `DebugSnapshot`
3. Add channel toggle to `EditorState.debugOverlay.channels`
4. Add render function in `DebugOverlayHost.tsx`
