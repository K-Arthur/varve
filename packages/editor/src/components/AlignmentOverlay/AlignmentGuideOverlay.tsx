import { useCallback, useEffect, useRef, useState } from 'react';
import { getEditorViewport } from '../../canvas/cameraState';
import { guideLineScreenEndpoints } from '../../canvas/guideGeometry';
import { useEditor } from '../../context';
import type { AlignmentFeedback, AlignmentGuideLine } from '../../scene/selectionArrangement';
import './alignment-overlay.css';

export type GuideLine = AlignmentGuideLine;

const GUIDE_DURATION_MS = 800;
const GUIDE_EVENT = 'varve:alignment-guide';
const LEGACY_GUIDE_EVENT = 'strata:alignment-guide';

export function showAlignmentGuides(lines: GuideLine[]) {
  window.dispatchEvent(new CustomEvent<GuideLine[]>(GUIDE_EVENT, { detail: lines }));
}

export function showAlignmentGuidesFromResult(feedback: AlignmentFeedback | null): void {
  if (!feedback || feedback.lines.length === 0) return;
  showAlignmentGuides([...feedback.lines]);
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
    window.addEventListener(GUIDE_EVENT, onGuide);
    return () => {
      window.removeEventListener(GUIDE_EVENT, onGuide);
      if (fadeRef.current !== null) clearTimeout(fadeRef.current);
    };
  }, [onGuide]);

  useEffect(() => {
    window.addEventListener(LEGACY_GUIDE_EVENT, onGuide);
    return () => window.removeEventListener(LEGACY_GUIDE_EVENT, onGuide);
  }, [onGuide]);

  if (!visible || guides.length === 0) return null;

  const viewport = getEditorViewport();
  const camera = {
    zoom: state.zoom,
    pan: state.pan,
    cameraRotation: state.cameraRotation,
  };

  return (
    <svg
      className="alignment-guide-overlay"
      aria-hidden="true"
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
    >
      <title>Alignment guides</title>
      {guides.map((guide) => {
        const line = guideLineScreenEndpoints(guide, camera, viewport);
        return (
          <g key={`guide-${guide.axis}-${guide.position}-${guide.label ?? ''}`}>
            <line
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              className={`alignment-guide__line ${visible ? '' : 'alignment-guide__line--fade'}`}
            />
            {guide.label && (
              <text
                x={(line.x1 + line.x2) / 2 + 4}
                y={(line.y1 + line.y2) / 2 - 4}
                className="alignment-guide__label"
              >
                {guide.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
