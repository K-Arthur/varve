/**
 * Align/Distribute toolbar — multi-selection alignment and distribution.
 *
 * 6 alignment buttons + 2 distribute buttons.
 * Uses the batch alignSelected/distributeSelected context methods.
 *
 * Research basis: Figma/Sketch align toolbar; APG Toolbar pattern; pill-chip pattern.
 */
import { useEditor } from '../../../context';

interface AlignIconProps {
  type: 'alignLeft' | 'alignCenterH' | 'alignRight' | 'alignTop' | 'alignCenterV' | 'alignBottom';
}

function AlignIcon({ type }: AlignIconProps) {
  const color = 'currentColor';
  const strokeW = 1.8;
  if (type === 'alignLeft') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <line
          x1="3"
          y1="2"
          x2="3"
          y2="14"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
        <rect x="5" y="4" width="6" height="3" rx="0.5" fill={color} opacity="0.5" />
        <rect x="5" y="9" width="8" height="3" rx="0.5" fill={color} opacity="0.5" />
      </svg>
    );
  }
  if (type === 'alignCenterH') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <line
          x1="8"
          y1="2"
          x2="8"
          y2="14"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
        <rect x="4" y="4" width="8" height="3" rx="0.5" fill={color} opacity="0.5" />
        <rect x="3" y="9" width="10" height="3" rx="0.5" fill={color} opacity="0.5" />
      </svg>
    );
  }
  if (type === 'alignRight') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <line
          x1="13"
          y1="2"
          x2="13"
          y2="14"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
        <rect x="5" y="4" width="6" height="3" rx="0.5" fill={color} opacity="0.5" />
        <rect x="3" y="9" width="8" height="3" rx="0.5" fill={color} opacity="0.5" />
      </svg>
    );
  }
  if (type === 'alignTop') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <line
          x1="2"
          y1="3"
          x2="14"
          y2="3"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
        <rect x="4" y="5" width="3" height="6" rx="0.5" fill={color} opacity="0.5" />
        <rect x="9" y="5" width="3" height="8" rx="0.5" fill={color} opacity="0.5" />
      </svg>
    );
  }
  if (type === 'alignCenterV') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <line
          x1="2"
          y1="8"
          x2="14"
          y2="8"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
        <rect x="4" y="4" width="3" height="8" rx="0.5" fill={color} opacity="0.5" />
        <rect x="9" y="5" width="3" height="6" rx="0.5" fill={color} opacity="0.5" />
      </svg>
    );
  }
  if (type === 'alignBottom') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <line
          x1="2"
          y1="13"
          x2="14"
          y2="13"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
        <rect x="4" y="5" width="3" height="6" rx="0.5" fill={color} opacity="0.5" />
        <rect x="9" y="3" width="3" height="8" rx="0.5" fill={color} opacity="0.5" />
      </svg>
    );
  }
  return null;
}

function DistributeIcon({ type }: { type: 'horizontal' | 'vertical' }) {
  const color = 'currentColor';
  if (type === 'horizontal') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <line x1="2" y1="8" x2="14" y2="8" stroke={color} strokeWidth={0.8} strokeDasharray="2 2" />
        <rect x="3" y="5" width="2" height="6" rx="0.5" fill={color} opacity="0.5" />
        <rect x="7" y="4" width="2" height="8" rx="0.5" fill={color} opacity="0.5" />
        <rect x="11" y="5" width="2" height="6" rx="0.5" fill={color} opacity="0.5" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <line x1="8" y1="2" x2="8" y2="14" stroke={color} strokeWidth={0.8} strokeDasharray="2 2" />
      <rect x="5" y="3" width="6" height="2" rx="0.5" fill={color} opacity="0.5" />
      <rect x="4" y="7" width="8" height="2" rx="0.5" fill={color} opacity="0.5" />
      <rect x="5" y="11" width="6" height="2" rx="0.5" fill={color} opacity="0.5" />
    </svg>
  );
}

export function AlignDistributeBar() {
  const { alignSelected, distributeSelected } = useEditor();

  return (
    <div className="insp-align-bar" role="toolbar" aria-label="Align and distribute">
      <button
        type="button"
        className="pill-group__btn"
        aria-label="Align left edges"
        title="Align left edges"
        onClick={() => alignSelected('left')}
      >
        <AlignIcon type="alignLeft" />
      </button>
      <button
        type="button"
        className="pill-group__btn"
        aria-label="Align horizontal centers"
        title="Align horizontal centers"
        onClick={() => alignSelected('centerH')}
      >
        <AlignIcon type="alignCenterH" />
      </button>
      <button
        type="button"
        className="pill-group__btn"
        aria-label="Align right edges"
        title="Align right edges"
        onClick={() => alignSelected('right')}
      >
        <AlignIcon type="alignRight" />
      </button>
      <div className="insp-separator" />
      <button
        type="button"
        className="pill-group__btn"
        aria-label="Align top edges"
        title="Align top edges"
        onClick={() => alignSelected('top')}
      >
        <AlignIcon type="alignTop" />
      </button>
      <button
        type="button"
        className="pill-group__btn"
        aria-label="Align vertical centers"
        title="Align vertical centers"
        onClick={() => alignSelected('centerV')}
      >
        <AlignIcon type="alignCenterV" />
      </button>
      <button
        type="button"
        className="pill-group__btn"
        aria-label="Align bottom edges"
        title="Align bottom edges"
        onClick={() => alignSelected('bottom')}
      >
        <AlignIcon type="alignBottom" />
      </button>
      <div className="insp-separator" />
      <button
        type="button"
        className="pill-group__btn"
        aria-label="Distribute horizontal spacing"
        title="Distribute horizontal spacing"
        onClick={() => distributeSelected('horizontal')}
      >
        <DistributeIcon type="horizontal" />
      </button>
      <button
        type="button"
        className="pill-group__btn"
        aria-label="Distribute vertical spacing"
        title="Distribute vertical spacing"
        onClick={() => distributeSelected('vertical')}
      >
        <DistributeIcon type="vertical" />
      </button>
    </div>
  );
}
