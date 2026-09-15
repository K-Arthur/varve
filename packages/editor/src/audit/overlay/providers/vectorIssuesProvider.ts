import type { OverlayContext, OverlayPrimitive, OverlayProvider } from '../types';

const OVERLAY_Z_ORDER = 20;

interface VectorIssue {
  type: 'open-path' | 'self-intersection' | 'tiny-segment';
  nodeId: string;
  position?: { x: number; y: number };
}

export function createVectorIssuesProvider(): OverlayProvider {
  return {
    id: 'vector-issues',
    label: 'Vector Issues',
    zOrder: OVERLAY_Z_ORDER,
    interactive: false,
    enabled: true,
    getPrimitives(ctx: OverlayContext): OverlayPrimitive[] {
      const primitives: OverlayPrimitive[] = [];
      const nodeIssues = scanVectorIssues(ctx);

      for (const [nodeId, issues] of nodeIssues) {
        if (ctx.hiddenNodeIds.has(nodeId)) continue;

        const bounds = ctx.getWorldBounds(nodeId);
        if (!bounds) continue;

        const total = issues.length;

        primitives.push({
          kind: 'badge',
          anchor: [bounds.x + bounds.w + 12, bounds.y],
          text: `${total} issue${total === 1 ? '' : 's'}`,
          severity: total > 5 ? 'error' : 'warning',
          findingId: `vector-${nodeId}-badge`,
          screenSpaceSize: true,
        });

        primitives.push({
          kind: 'rect',
          bounds,
          style: {
            strokeColor: 'var(--color-feedback-danger, #d32f2f)',
            strokeWidth: 1,
            fillColor: 'var(--color-feedback-danger, #d32f2f)',
            fillOpacity: 0.04,
            dashPattern: [3, 3],
          },
          findingId: `vector-${nodeId}-rect`,
        });

        for (const issue of issues) {
          if (issue.position) {
            primitives.push({
              kind: 'point',
              at: [issue.position.x, issue.position.y],
              style: {
                strokeColor:
                  issue.type === 'self-intersection'
                    ? 'var(--color-feedback-danger, #d32f2f)'
                    : 'var(--color-feedback-warning, #f57c00)',
                strokeWidth: 2,
                fillColor:
                  issue.type === 'self-intersection'
                    ? 'var(--color-feedback-danger, #d32f2f)'
                    : 'var(--color-feedback-warning, #f57c00)',
              },
              findingId: `vector-${nodeId}-${issue.type}-${issue.position.x}-${issue.position.y}`,
            });
          }
        }
      }

      return primitives;
    },
  };
}

function scanVectorIssues(ctx: OverlayContext): Map<string, VectorIssue[]> {
  const results = new Map<string, VectorIssue[]>();

  for (const [nodeId, node] of Object.entries(ctx.document.nodes)) {
    if (ctx.hiddenNodeIds.has(nodeId)) continue;
    if (node.kind !== 'shape') continue;

    const issues: VectorIssue[] = [];
    const shape = node.shape;

    if (shape.kind === 'path' || shape.kind === 'line') {
      const points = shape.kind === 'path' ? (shape.points ?? []) : [];
      if (points.length >= 2) {
        const lastPt = points[points.length - 1];

        if (shape.kind === 'path' && !isClosed(shape) && points.length > 2) {
          issues.push({ type: 'open-path', nodeId, position: lastPt });
        }

        for (let i = 0; i < points.length; i++) {
          const p = points[i]!;
          const prev = points[(i - 1 + points.length) % points.length]!;
          const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
          if (dist < 1 && points.length > 2) {
            issues.push({ type: 'tiny-segment', nodeId, position: p });
          }
        }

        for (let i = 0; i < points.length; i++) {
          const pi = points[i]!;
          const pi1 = points[(i + 1) % points.length]!;
          for (let j = i + 2; j < points.length; j++) {
            const pj = points[j]!;
            const pj1 = points[(j + 1) % points.length]!;
            if (segmentsIntersect(pi, pi1, pj, pj1)) {
              issues.push({
                type: 'self-intersection',
                nodeId,
                position: {
                  x: (pi.x + pj.x) / 2,
                  y: (pi.y + pj.y) / 2,
                },
              });
              break;
            }
          }
        }
      }
    }

    if (issues.length > 0) {
      results.set(nodeId, issues);
    }
  }

  return results;
}

function isClosed(shape: { points?: { x: number; y: number }[]; closed?: boolean }): boolean {
  return shape.closed === true;
}

function segmentsIntersect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const d1x = b.x - a.x;
  const d1y = b.y - a.y;
  const d2x = d.x - c.x;
  const d2y = d.y - c.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return false;
  const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / denom;
  const u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
