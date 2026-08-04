import { computeFloatingOrigin } from '@varve/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getEditorViewport } from '../../canvas/cameraState';
import { useEditor } from '../../context';
import { nodeWorldBounds } from '../../scene/world';
import './alignment-overlay.css';

interface GuideLine {
  axis: 'vertical' | 'horizontal';
  position: number;
}

const GUIDE_DURATION_MS = 800;

export function showAlignmentGuides(lines: GuideLine[]) {
  window.dispatchEvent(new CustomEvent<GuideLine[]>('strata:alignment-guide', { detail: lines }));
}

export function AlignmentGuideOverlay() {
  const { state } = useEditor();
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [visible, setVisible] = useState(false);
  const fadeRef = useRef<number | null>(null);

  const onGuide = useCallback((e: Event) => {
    const detail = (e as CustomEvent<GuideLine[]>).detail;
    setGuides(detail);
    setVisible(true);
    if (fadeRef.current !== null) {
      clearTimeout(fadeRef.current);
    }
    fadeRef.current = window.setTimeout(() => {
      setVisible(false);
      fadeRef.current = null;
    }, GUIDE_DURATION_MS);
  }, []);

  useEffect(() => {
    window.addEventListener('strata:alignment-guide', onGuide);
    return () => {
      window.removeEventListener('strata:alignment-guide', onGuide);
      if (fadeRef.current !== null) {
        clearTimeout(fadeRef.current);
      }
    };
  }, [onGuide]);

  if (!visible || guides.length === 0) return null;

  const zoom = state.zoom;
  const pan = state.pan;
  const width = typeof window !== 'undefined' ? window.innerWidth : 99999;
  // These guide lines are drawn purely axis-aligned (no camera-rotation
  // support), so only the floating-origin translation needs correcting here
  // — not a full 2D worldToScreen, which would also rotate the line.
  const origin = computeFloatingOrigin({ zoom, pan, rotation: 0 }, getEditorViewport());

  return (
    <svg className="alignment-guide-overlay" aria-hidden="true">
      <title>Alignment guides</title>
      {guides.map((guide, _i) => {
        const originAxis = guide.axis === 'vertical' ? origin[0] : origin[1];
        const pos =
          (guide.position - originAxis) * zoom + (guide.axis === 'vertical' ? pan.x : pan.y);
        return (
          <line
            key={`guide-${guide.axis}-${guide.position}`}
            x1={guide.axis === 'vertical' ? pos : 0}
            y1={guide.axis === 'vertical' ? 0 : pos}
            x2={guide.axis === 'vertical' ? pos : Math.max(width, 99999)}
            y2={guide.axis === 'vertical' ? Math.max(width, 99999) : pos}
            className={`alignment-guide__line ${visible ? '' : 'alignment-guide__line--fade'}`}
          />
        );
      })}
    </svg>
  );
}

export function showAlignmentGuidesFromSelection(
  doc: import('@varve/scene').Document,
  sel: string[],
) {
  if (sel.length < 2) return;
  const bounds = sel
    .map((id) => nodeWorldBounds(doc, id))
    .filter((b): b is NonNullable<typeof b> => b !== null);
  if (bounds.length < 2) return;

  const minX = Math.min(...bounds.map((b) => b.x));
  const maxX = Math.max(...bounds.map((b) => b.x + b.w));
  const minY = Math.min(...bounds.map((b) => b.y));
  const maxY = Math.max(...bounds.map((b) => b.y + b.h));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  showAlignmentGuides([
    { axis: 'vertical', position: centerX },
    { axis: 'horizontal', position: centerY },
    { axis: 'vertical', position: minX },
    { axis: 'vertical', position: maxX },
    { axis: 'horizontal', position: minY },
    { axis: 'horizontal', position: maxY },
  ]);
}
