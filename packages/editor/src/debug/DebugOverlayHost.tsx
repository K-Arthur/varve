/**
 * DebugOverlayHost — React component that renders SVG debug overlays on top
 * of the canvas. Uses `pointer-events: none` and is excluded from the
 * accessibility tree. Disabled entirely when debug overlays are off or
 * in production builds.
 */

import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';
import { useEditor } from '../context';
import { isDebugBuild } from './DebugSnapshotProvider';

export function DebugOverlayHost() {
  const { state } = useEditor();
  const enabled = state.debugOverlay.enabled;

  const isDev = isDebugBuild();
  if (!isDev || !enabled) return null;

  const ch = state.debugOverlay.channels;
  const hasAnyChannel =
    ch.geometry || ch.hitTest || ch.spatialIndex || ch.performance;

  if (!hasAnyChannel) return null;

  return (
    <svg
      role="presentation"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX + 1,
      }}
    />
  );
}
