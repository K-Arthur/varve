/**
 * Align/Distribute toolbar — multi-selection alignment and distribution.
 *
 * 6 alignment buttons + 2 distribute buttons + advanced controls.
 * Uses the batch alignSelected/distributeSelected context methods.
 *
 * Research basis: Figma/Sketch align toolbar; APG Toolbar pattern; pill-chip pattern.
 */
import { useCallback, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { showAlignmentGuidesFromSelection } from '../../AlignmentOverlay/AlignmentGuideOverlay';

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

function KeyObjectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <line
        x1="8"
        y1="0.5"
        x2="8"
        y2="3.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="8"
        y1="12.5"
        x2="8"
        y2="15.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="0.5"
        y1="8"
        x2="3.5"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="12.5"
        y1="8"
        x2="15.5"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <line x1="2" y1="5" x2="14" y2="5" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="1" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1" y="9" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="9" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function OBBIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="4"
        y="3"
        width="9"
        height="11"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.3"
        transform="rotate(15 4 3)"
      />
      <rect x="1.5" y="1" width="3" height="3" rx="0.3" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

export function AlignDistributeBar() {
  const {
    alignSelected,
    obbAlignSelected,
    distributeSelected,
    tidySelected,
    setKeyObject,
    keyObjectId,
    alignToPage,
    setAlignToPage,
    state,
  } = useEditor();

  const [showTidyMenu, setShowTidyMenu] = useState(false);
  const [obbEnabled, setObbEnabled] = useState(false);
  const tidyBtnRef = useRef<HTMLButtonElement>(null);

  const doAlign = useCallback(
    (axis: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => {
      const sel = state.selection;
      const doc = state.document;
      showAlignmentGuidesFromSelection(doc, sel);
      if (obbEnabled) {
        obbAlignSelected(axis);
      } else {
        alignSelected(axis);
      }
    },
    [alignSelected, obbAlignSelected, obbEnabled, state.selection, state.document],
  );

  const handleDistribute = useCallback(
    (axis: 'horizontal' | 'vertical') => {
      distributeSelected(axis);
    },
    [distributeSelected],
  );

  const handleToggleKeyObject = useCallback(() => {
    const sel = state.selection;
    if (keyObjectId) {
      setKeyObject(null);
    } else if (sel.length >= 2 && sel[0]) {
      setKeyObject(sel[0]);
    }
  }, [keyObjectId, setKeyObject, state.selection]);

  const handleTidyUp = useCallback(
    (maxCols: number) => {
      setShowTidyMenu(false);
      tidySelected(maxCols);
    },
    [tidySelected],
  );

  return (
    <>
      <div className="insp-align-bar" role="toolbar" aria-label="Align and distribute">
        <button
          type="button"
          className="pill-group__btn"
          aria-label="Align left edges"
          title="Align left edges"
          onClick={() => doAlign('left')}
        >
          <AlignIcon type="alignLeft" />
        </button>
        <button
          type="button"
          className="pill-group__btn"
          aria-label="Align horizontal centers"
          title="Align horizontal centers"
          onClick={() => doAlign('centerH')}
        >
          <AlignIcon type="alignCenterH" />
        </button>
        <button
          type="button"
          className="pill-group__btn"
          aria-label="Align right edges"
          title="Align right edges"
          onClick={() => doAlign('right')}
        >
          <AlignIcon type="alignRight" />
        </button>
        <div className="insp-separator" />
        <button
          type="button"
          className="pill-group__btn"
          aria-label="Align top edges"
          title="Align top edges"
          onClick={() => doAlign('top')}
        >
          <AlignIcon type="alignTop" />
        </button>
        <button
          type="button"
          className="pill-group__btn"
          aria-label="Align vertical centers"
          title="Align vertical centers"
          onClick={() => doAlign('centerV')}
        >
          <AlignIcon type="alignCenterV" />
        </button>
        <button
          type="button"
          className="pill-group__btn"
          aria-label="Align bottom edges"
          title="Align bottom edges"
          onClick={() => doAlign('bottom')}
        >
          <AlignIcon type="alignBottom" />
        </button>
        <div className="insp-separator" />
        <button
          type="button"
          className="pill-group__btn"
          aria-label="Distribute horizontal spacing"
          title="Distribute horizontal spacing"
          onClick={() => handleDistribute('horizontal')}
        >
          <DistributeIcon type="horizontal" />
        </button>
        <button
          type="button"
          className="pill-group__btn"
          aria-label="Distribute vertical spacing"
          title="Distribute vertical spacing"
          onClick={() => handleDistribute('vertical')}
        >
          <DistributeIcon type="vertical" />
        </button>
      </div>
      <div className="insp-align-bar" role="toolbar" aria-label="Advanced alignment options">
        <button
          type="button"
          className={`pill-group__btn ${keyObjectId ? 'pill-group__btn--active' : ''}`}
          aria-label={keyObjectId ? 'Clear key object' : 'Set key object from selection'}
          title={keyObjectId ? 'Key object set. Click to clear' : 'Set key object from selection'}
          onClick={handleToggleKeyObject}
        >
          <KeyObjectIcon />
          {keyObjectId && <span className="insp-badge" />}
        </button>
        <button
          type="button"
          className={`pill-group__btn ${alignToPage ? 'pill-group__btn--active' : ''}`}
          aria-label={alignToPage ? 'Align to page (active)' : 'Align to page'}
          title="Align to page bounds"
          onClick={() => setAlignToPage(!alignToPage)}
        >
          <PageIcon />
        </button>
        <div className="insp-separator" />
        <div style={{ position: 'relative' }}>
          <button
            ref={tidyBtnRef}
            type="button"
            className="pill-group__btn"
            aria-label="Tidy up grid"
            title="Tidy up — arrange in grid"
            onClick={() => setShowTidyMenu(!showTidyMenu)}
          >
            <GridIcon />
          </button>
          {showTidyMenu && (
            <>
              <div className="insp-dropdown" role="menu" aria-label="Tidy up columns">
                <button
                  type="button"
                  className="insp-dropdown__item"
                  role="menuitem"
                  onClick={() => handleTidyUp(4)}
                >
                  4 columns
                </button>
                <button
                  type="button"
                  className="insp-dropdown__item"
                  role="menuitem"
                  onClick={() => handleTidyUp(6)}
                >
                  6 columns
                </button>
                <button
                  type="button"
                  className="insp-dropdown__item"
                  role="menuitem"
                  onClick={() => handleTidyUp(8)}
                >
                  8 columns
                </button>
              </div>
              <button
                className="insp-dropdown-backdrop"
                onClick={() => setShowTidyMenu(false)}
                aria-label="Close menu"
                type="button"
              />
            </>
          )}
        </div>
        <button
          type="button"
          className={`pill-group__btn ${obbEnabled ? 'pill-group__btn--active' : ''}`}
          aria-label={obbEnabled ? 'OBB alignment on' : 'OBB alignment off'}
          title="Toggle oriented bounding box alignment"
          onClick={() => setObbEnabled(!obbEnabled)}
        >
          <OBBIcon />
        </button>
      </div>
    </>
  );
}
