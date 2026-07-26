import type { OverlayContext, OverlayPrimitive, OverlayProvider } from '../types';

const OVERLAY_Z_ORDER = 30;

interface DpiWarning {
  nodeId: string;
  intrinsicW: number;
  intrinsicH: number;
  renderedW: number;
  renderedH: number;
  exportScales: number[];
}

export function createDpiWarningProvider(): OverlayProvider {
  return {
    id: 'dpi-warnings',
    label: 'DPI Warnings',
    zOrder: OVERLAY_Z_ORDER,
    interactive: false,
    enabled: true,
    getPrimitives(ctx: OverlayContext): OverlayPrimitive[] {
      const primitives: OverlayPrimitive[] = [];
      const warnings = scanDpiWarnings(ctx);

      for (const w of warnings) {
        if (ctx.hiddenNodeIds.has(w.nodeId)) continue;

        const bounds = ctx.getWorldBounds(w.nodeId);
        if (!bounds) continue;

        const effectiveDpi = (w.intrinsicW / w.renderedW) * 72;
        const severity: 'error' | 'warning' | 'suggestion' =
          effectiveDpi < 72 ? 'error' : effectiveDpi < 150 ? 'warning' : 'suggestion';

        const scalesText =
          w.exportScales.length > 0 ? ` @${w.exportScales.map((s) => `${s}x`).join(', ')}` : '';

        primitives.push({
          kind: 'badge',
          anchor: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h + 12 },
          text: `${Math.round(effectiveDpi)} DPI${scalesText}`,
          severity,
          findingId: `dpi-${w.nodeId}`,
          screenSpaceSize: true,
        });

        primitives.push({
          kind: 'rect',
          bounds,
          style: {
            strokeColor:
              severity === 'error'
                ? 'var(--color-feedback-danger, #d32f2f)'
                : 'var(--color-feedback-warning, #f57c00)',
            strokeWidth: 1.5,
            fillColor:
              severity === 'error'
                ? 'var(--color-feedback-danger, #d32f2f)'
                : 'var(--color-feedback-warning, #f57c00)',
            fillOpacity: 0.05,
            dashPattern: [5, 3],
          },
          findingId: `dpi-${w.nodeId}-rect`,
        });
      }

      return primitives;
    },
  };
}

function scanDpiWarnings(ctx: OverlayContext): DpiWarning[] {
  const warnings: DpiWarning[] = [];

  for (const [nodeId, node] of Object.entries(ctx.document.nodes)) {
    if (ctx.hiddenNodeIds.has(nodeId)) continue;
    if (node.kind !== 'shape') continue;

    const shape = node.shape;
    if (shape.kind !== 'rect' && shape.kind !== 'ellipse' && shape.kind !== 'image') continue;

    const fills =
      (
        node as {
          fills?: {
            type?: string;
            image?: { src?: string; imageWidth?: number; imageHeight?: number };
          }[];
        }
      ).fills ?? [];
    const imageFill = fills.find((f) => f.type === 'image')?.image;
    if (!imageFill?.imageWidth || !imageFill.imageHeight) continue;

    const bounds = ctx.getWorldBounds(nodeId);
    if (!bounds) continue;

    warnings.push({
      nodeId,
      intrinsicW: imageFill.imageWidth,
      intrinsicH: imageFill.imageHeight,
      renderedW: bounds.w,
      renderedH: bounds.h,
      exportScales: [1, 2],
    });
  }

  return warnings;
}
