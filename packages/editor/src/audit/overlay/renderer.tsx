import type { Point, Rect } from '@strata/shared';
import { computeFloatingOrigin, worldToScreen } from '@strata/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../../canvas/overlayZIndex';
import type { LODCluster, OverlayRegistry } from './registry';
import type { OverlayContext, OverlayPrimitive } from './types';

interface AuditOverlayRendererProps {
  registry: OverlayRegistry;
  overlayContext: OverlayContext;
  viewportRect: Rect;
  maxPrimitives?: number;
  clusterThresholdPx?: number;
  onFindingHover?: (findingId: string | null) => void;
  onFindingClick?: (findingId: string) => void;
}

const PERF_OVERCAP_MESSAGE = 'Findings overlay showing %d of %d findings';

export function AuditOverlayRenderer({
  registry,
  overlayContext,
  viewportRect,
  maxPrimitives = 2000,
  clusterThresholdPx = 30,
  onFindingHover,
  onFindingClick,
}: AuditOverlayRendererProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const [result, setResult] = useState<{
    primitives: OverlayPrimitive[];
    clusters: LODCluster[];
    totalAvailable: number;
    displayed: number;
  }>({ primitives: [], clusters: [], totalAvailable: 0, displayed: 0 });

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const r = registry.scan(
        overlayContext,
        viewportRect,
        maxPrimitives,
        clusterThresholdPx,
        overlayContext.zoom,
      );
      setResult(r);
      rafRef.current = null;
    });
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [registry, overlayContext, viewportRect, maxPrimitives, clusterThresholdPx]);

  const camera = useMemo(
    () => ({
      pan: overlayContext.pan,
      zoom: overlayContext.zoom,
      rotation: overlayContext.cameraRotation ?? 0,
    }),
    [overlayContext.pan, overlayContext.zoom, overlayContext.cameraRotation],
  );

  const viewport = useMemo(
    () => ({
      width: overlayContext.viewport.width,
      height: overlayContext.viewport.height,
    }),
    [overlayContext.viewport.width, overlayContext.viewport.height],
  );

  const origin = useMemo(() => computeFloatingOrigin(camera, viewport), [camera, viewport]);

  const toScreen = useCallback(
    (wx: number, wy: number) => {
      return worldToScreen(camera, wx, wy, viewport, origin);
    },
    [camera, viewport, origin],
  );

  const handleBadgeEnter = useCallback(
    (findingId: string) => {
      setHoveredId(findingId);
      onFindingHover?.(findingId);
    },
    [onFindingHover],
  );

  const handleBadgeLeave = useCallback(() => {
    setHoveredId(null);
    onFindingHover?.(null);
  }, [onFindingHover]);

  const handleBadgeClick = useCallback(
    (findingId: string) => {
      onFindingClick?.(findingId);
    },
    [onFindingClick],
  );

  const svgShapes = useMemo(() => {
    return (
      <>
        {/* Non-interactive primitives (rect, path, point) */}
        {result.primitives.map((p) => {
          if (p.kind === 'badge') return null;
          return <PrimitiveShape key={p.findingId} primitive={p} toScreen={toScreen} />;
        })}

        {/* Clusters */}
        {result.clusters.map((c) => {
          const [sx, sy] = toScreen(c.center.x, c.center.y);
          const topSeverity = getTopSeverity(c.severities);
          return (
            <g key={c.findingIds.join('-')}>
              <circle
                cx={sx}
                cy={sy}
                r={14}
                fill={severityColor(topSeverity)}
                fillOpacity={0.85}
                stroke="var(--color-surface-overlay)"
                strokeWidth={1.5}
              />
              <text
                x={sx}
                y={sy + 4}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-text-on-accent)"
                fontFamily="var(--font-body, system-ui, sans-serif)"
                style={{ fontFeatureSettings: "'tnum'" }}
              >
                {c.count}
              </text>
            </g>
          );
        })}

        {/* Badges */}
        {result.primitives.map((p) => {
          if (p.kind !== 'badge') return null;
          const [sx, sy] = toScreen(p.anchor[0], p.anchor[1]);
          const isHovered = hoveredId === p.findingId;
          return (
            // biome-ignore lint/a11y/useSemanticElements: SVG interactive group, not replaceable with HTML button
            <g
              key={p.findingId}
              role="button"
              aria-label={`Finding: ${p.text}`}
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onPointerEnter={() => handleBadgeEnter(p.findingId)}
              onPointerLeave={handleBadgeLeave}
              onPointerDown={() => handleBadgeClick(p.findingId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleBadgeClick(p.findingId);
                }
              }}
            >
              <circle
                cx={sx}
                cy={sy}
                r={isHovered ? 7 : 5}
                fill={severityColor(p.severity)}
                stroke={
                  isHovered ? 'var(--color-interactive-default)' : 'var(--color-surface-overlay)'
                }
                strokeWidth={isHovered ? 2 : 1.5}
                style={{ transition: 'r 0.1s, stroke-width 0.1s' }}
              />
              {isHovered && (
                <g>
                  <rect
                    x={sx + 10}
                    y={sy - 10}
                    width={textWidth(p.text) + 12}
                    height={20}
                    rx={4}
                    fill="var(--color-surface-overlay)"
                    stroke="var(--color-border-default)"
                    strokeWidth={1}
                  />
                  <text
                    x={sx + 16}
                    y={sy + 4}
                    fontSize={11}
                    fill="var(--color-text-default)"
                    fontFamily="var(--font-body, system-ui, sans-serif)"
                  >
                    {p.text}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {result.displayed < result.totalAvailable && (
          <g>
            <rect
              x={8}
              y={8}
              width={220}
              height={24}
              rx={4}
              fill="var(--color-surface-overlay)"
              stroke="var(--color-border-default)"
              strokeWidth={1}
              opacity={0.9}
            />
            <text
              x={16}
              y={24}
              fontSize={11}
              fill="var(--color-text-muted)"
              fontFamily="var(--font-body, system-ui, sans-serif)"
            >
              {PERF_OVERCAP_MESSAGE.replace('%d', String(result.displayed)).replace(
                '%d',
                String(result.totalAvailable),
              )}
            </text>
          </g>
        )}
      </>
    );
  }, [result, hoveredId, toScreen, handleBadgeEnter, handleBadgeLeave, handleBadgeClick]);

  return (
    <svg
      role="presentation"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        width: '100%',
        height: '100%',
        touchAction: 'none',
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX + 1,
      }}
    >
      {/* Pointer events layer for interactive badges */}
      <rect width="100%" height="100%" fill="transparent" style={{ pointerEvents: 'none' }} />
      {svgShapes}
    </svg>
  );
}

interface PrimitiveShapeProps {
  primitive: OverlayPrimitive & { kind: 'rect' | 'path' | 'point' };
  toScreen: (wx: number, wy: number) => Point;
}

function PrimitiveShape({ primitive, toScreen }: PrimitiveShapeProps) {
  switch (primitive.kind) {
    case 'rect': {
      const [x1, y1] = toScreen(primitive.bounds.x, primitive.bounds.y);
      const sw = primitive.bounds.w * (1 / 1);
      const sh = primitive.bounds.h * (1 / 1);
      return (
        <rect
          x={x1}
          y={y1}
          width={sw}
          height={sh}
          fill={primitive.style.fillColor ?? 'none'}
          fillOpacity={primitive.style.fillOpacity ?? 0}
          stroke={primitive.style.strokeColor}
          strokeWidth={primitive.style.strokeWidth}
          strokeDasharray={primitive.style.dashPattern?.join(',')}
          opacity={primitive.style.opacity}
          rx={1}
        />
      );
    }
    case 'path': {
      if (primitive.data.length < 2) return null;
      const pts = primitive.data.map((p) => toScreen(p[0], p[1]));
      const d =
        pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ') +
        (primitive.closed ? ' Z' : '');
      return (
        <path
          d={d}
          fill={primitive.style.fillColor ?? 'none'}
          fillOpacity={primitive.style.fillOpacity ?? 0}
          stroke={primitive.style.strokeColor}
          strokeWidth={primitive.style.strokeWidth}
          strokeDasharray={primitive.style.dashPattern?.join(',')}
          opacity={primitive.style.opacity}
        />
      );
    }
    case 'point': {
      const [sx, sy] = toScreen(primitive.at[0], primitive.at[1]);
      return (
        <circle
          cx={sx}
          cy={sy}
          r={4}
          fill={primitive.style.fillColor ?? primitive.style.strokeColor}
          stroke={primitive.style.strokeColor}
          strokeWidth={1}
          opacity={primitive.style.opacity}
        />
      );
    }
  }
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'error':
      return 'var(--color-feedback-danger, #d32f2f)';
    case 'warning':
      return 'var(--color-feedback-warning, #f57c00)';
    case 'suggestion':
      return 'var(--color-feedback-info, #1976d2)';
    case 'advisory':
      return 'var(--color-feedback-success, #2e7d32)';
    default:
      return 'var(--color-feedback-info, #1976d2)';
  }
}

function getTopSeverity(severities: Map<string, number>): string {
  const order = ['error', 'warning', 'suggestion', 'advisory'];
  for (const sev of order) {
    if ((severities.get(sev) ?? 0) > 0) return sev;
  }
  return 'advisory';
}

function textWidth(text: string): number {
  return text.length * 6.5;
}
