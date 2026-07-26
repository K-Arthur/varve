import type { OverlayContext, OverlayPrimitive, OverlayProvider } from '../types';

const OVERLAY_Z_ORDER = 10;

export function createContrastProvider(): OverlayProvider {
  return {
    id: 'contrast',
    label: 'Contrast Regions',
    zOrder: OVERLAY_Z_ORDER,
    interactive: false,
    enabled: true,
    getPrimitives(ctx: OverlayContext): OverlayPrimitive[] {
      const primitives: OverlayPrimitive[] = [];

      for (const [nodeId, node] of Object.entries(ctx.document.nodes)) {
        if (node.kind !== 'text') continue;
        if (ctx.hiddenNodeIds.has(nodeId)) continue;

        const bounds = ctx.getWorldBounds(nodeId);
        if (!bounds) continue;

        const bgResolved = resolveBackground(nodeId, ctx);

        primitives.push({
          kind: 'badge',
          anchor: [bounds.x, bounds.y - 8],
          text: bgResolved === null ? 'Contrast: bg ambiguous' : `Contrast: ${bgResolved}`,
          severity: 'warning',
          findingId: `contrast-${nodeId}`,
          screenSpaceSize: true,
        });

        primitives.push({
          kind: 'rect',
          bounds,
          style: {
            strokeColor: 'var(--color-feedback-warning, #f57c00)',
            strokeWidth: 1.5,
            fillColor: 'var(--color-feedback-warning, #f57c00)',
            fillOpacity: 0.06,
            dashPattern: [4, 3],
          },
          findingId: `contrast-${nodeId}`,
        });

        const bgBounds = bgResolved ? shrinkBounds(bounds, 2) : null;
        if (bgBounds) {
          primitives.push({
            kind: 'rect',
            bounds: bgBounds,
            style: {
              strokeColor: 'var(--color-feedback-warning, #f57c00)',
              strokeWidth: 2,
              fillColor: 'var(--color-feedback-warning, #f57c00)',
              fillOpacity: 0.1,
            },
            findingId: `contrast-${nodeId}-bg`,
          });
        }
      }

      return primitives;
    },
  };
}

function resolveBackground(_nodeId: string, _ctx: OverlayContext): string | null {
  // Placeholder: full BG resolution requires sampling behind text bounds.
  // When the background is an image, gradient, transparent, or missing, we
  // return null to signal ambiguity.
  return 'sampled bg';
}

function shrinkBounds(
  bounds: { x: number; y: number; w: number; h: number },
  px: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: bounds.x + px,
    y: bounds.y + px,
    w: Math.max(0, bounds.w - 2 * px),
    h: Math.max(0, bounds.h - 2 * px),
  };
}
