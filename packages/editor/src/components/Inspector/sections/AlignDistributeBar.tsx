/**
 * Align/Distribute toolbar — multi-selection alignment and distribution.
 *
 * 6 alignment buttons + 2 distribute buttons + advanced controls.
 * Uses the batch alignSelected/distributeSelected context methods.
 *
 * Research basis: Figma/Sketch align toolbar; APG Toolbar pattern; pill-chip pattern.
 */

import { NumberInput, Tooltip, TooltipProvider } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../../../context';
import {
  type AlignmentReference,
  getAlignmentCapabilities,
} from '../../../scene/selectionArrangement';
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

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" role="presentation">
      <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.4" />
      <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.4" />
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
    distributeWithGap,
    distributeWithMode,
    tidySelected,
    setKeyObject,
    keyObjectId,
    alignToPage,
    setAlignToPage,
    state,
  } = useEditor();

  const [showTidyMenu, setShowTidyMenu] = useState(false);
  const [showDistributionMenu, setShowDistributionMenu] = useState(false);
  const [obbEnabled, setObbEnabled] = useState(false);
  const [alignmentReference, setAlignmentReference] = useState<AlignmentReference>(() =>
    alignToPage ? 'page' : 'selection',
  );
  const [distributionMode, setDistributionMode] = useState<'equalGap' | 'equalCenter' | 'fixedGap'>(
    'equalGap',
  );
  const [distributionGap, setDistributionGap] = useState(0);
  const [distributionMenuPosition, setDistributionMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const tidyBtnRef = useRef<HTMLButtonElement>(null);
  const distributionBtnRef = useRef<HTMLButtonElement>(null);
  const capabilities = getAlignmentCapabilities(state.document, state.selection);
  const canAlign =
    alignmentReference === 'page'
      ? capabilities.canAlignToPage
      : alignmentReference === 'container'
        ? capabilities.canAlignToContainer
        : capabilities.canAlign;

  useEffect(() => {
    if (alignToPage) setAlignmentReference('page');
    else setAlignmentReference((current) => (current === 'page' ? 'selection' : current));
  }, [alignToPage]);

  useEffect(() => {
    if (!showDistributionMenu || !distributionBtnRef.current) return;
    const updatePosition = () => {
      const rect = distributionBtnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 220;
      setDistributionMenuPosition({
        top: Math.min(window.innerHeight - 12, rect.bottom + 6),
        left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)),
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [showDistributionMenu]);

  const chooseAlignmentReference = useCallback(
    (reference: AlignmentReference) => {
      setAlignmentReference(reference);
      setAlignToPage(reference === 'page');
    },
    [setAlignToPage],
  );

  const doAlign = useCallback(
    (axis: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => {
      const sel = state.selection;
      const doc = state.document;
      showAlignmentGuidesFromSelection(doc, sel);
      if (obbEnabled) {
        obbAlignSelected(axis, alignmentReference);
      } else {
        alignSelected(axis, alignmentReference);
      }
    },
    [
      alignSelected,
      alignmentReference,
      obbAlignSelected,
      obbEnabled,
      state.selection,
      state.document,
    ],
  );

  const handleDistribute = useCallback(
    (axis: 'horizontal' | 'vertical') => {
      if (distributionMode === 'fixedGap') {
        if (distributeWithGap) distributeWithGap(axis, distributionGap);
        else distributeSelected(axis);
      } else if (distributeWithMode) {
        distributeWithMode(axis, distributionMode);
      } else {
        distributeSelected(axis);
      }
    },
    [distributionGap, distributionMode, distributeSelected, distributeWithGap, distributeWithMode],
  );

  const handleToggleKeyObject = useCallback(() => {
    const sel = state.selection;
    if (keyObjectId) {
      setKeyObject(null);
    } else if (sel.length >= 2 && state.primaryId) {
      setKeyObject(state.primaryId);
    }
  }, [keyObjectId, setKeyObject, state.primaryId, state.selection]);

  const handleTidyUp = useCallback(
    (maxCols: number) => {
      setShowTidyMenu(false);
      tidySelected(maxCols);
    },
    [tidySelected],
  );

  // A locked/hidden node or a flow-managed auto-layout child has no manual
  // position to change. Its Properties controls explain the governing state;
  // an all-disabled alignment toolbar would imply a command is merely blocked.
  if (!capabilities.canAlignToPage) return null;

  return (
    <section className="insp-align-section" aria-labelledby="align-distribute-heading">
      <h2 id="align-distribute-heading" className="insp-align-section__title">
        Align &amp; distribute
      </h2>
      <TooltipProvider>
        <div className="insp-align-bar" role="toolbar" aria-label="Align and distribute">
          <Tooltip label="Align left edges">
            <button
              type="button"
              className="pill-group__btn"
              aria-label="Align left edges"
              onClick={() => doAlign('left')}
              disabled={!canAlign}
            >
              <AlignIcon type="alignLeft" />
            </button>
          </Tooltip>
          <Tooltip label="Align horizontal centers">
            <button
              type="button"
              className="pill-group__btn"
              aria-label="Align horizontal centers"
              onClick={() => doAlign('centerH')}
              disabled={!canAlign}
            >
              <AlignIcon type="alignCenterH" />
            </button>
          </Tooltip>
          <Tooltip label="Align right edges">
            <button
              type="button"
              className="pill-group__btn"
              aria-label="Align right edges"
              onClick={() => doAlign('right')}
              disabled={!canAlign}
            >
              <AlignIcon type="alignRight" />
            </button>
          </Tooltip>
          <div className="insp-separator" />
          <Tooltip label="Align top edges">
            <button
              type="button"
              className="pill-group__btn"
              aria-label="Align top edges"
              onClick={() => doAlign('top')}
              disabled={!canAlign}
            >
              <AlignIcon type="alignTop" />
            </button>
          </Tooltip>
          <Tooltip label="Align vertical centers">
            <button
              type="button"
              className="pill-group__btn"
              aria-label="Align vertical centers"
              onClick={() => doAlign('centerV')}
              disabled={!canAlign}
            >
              <AlignIcon type="alignCenterV" />
            </button>
          </Tooltip>
          <Tooltip label="Align bottom edges">
            <button
              type="button"
              className="pill-group__btn"
              aria-label="Align bottom edges"
              onClick={() => doAlign('bottom')}
              disabled={!canAlign}
            >
              <AlignIcon type="alignBottom" />
            </button>
          </Tooltip>
          <div className="insp-separator" />
          <Tooltip label="Distribute horizontal spacing">
            <button
              type="button"
              className="pill-group__btn"
              aria-label="Distribute horizontal spacing"
              onClick={() => handleDistribute('horizontal')}
              disabled={!capabilities.canDistribute}
            >
              <DistributeIcon type="horizontal" />
            </button>
          </Tooltip>
          <Tooltip label="Distribute vertical spacing">
            <button
              type="button"
              className="pill-group__btn"
              aria-label="Distribute vertical spacing"
              onClick={() => handleDistribute('vertical')}
              disabled={!capabilities.canDistribute}
            >
              <DistributeIcon type="vertical" />
            </button>
          </Tooltip>
          <div className="insp-align-options">
            <Tooltip label="Distribution options">
              <button
                type="button"
                ref={distributionBtnRef}
                className={`pill-group__btn ${showDistributionMenu ? 'pill-group__btn--active' : ''}`}
                aria-label="Distribution options"
                aria-expanded={showDistributionMenu}
                onClick={() => setShowDistributionMenu((open) => !open)}
                disabled={!capabilities.canDistribute}
              >
                Gap
              </button>
            </Tooltip>
            {showDistributionMenu &&
              distributionMenuPosition &&
              createPortal(
                <>
                  <button
                    className="insp-dropdown-backdrop"
                    onClick={() => setShowDistributionMenu(false)}
                    aria-label="Close distribution options"
                    type="button"
                  />
                  <div
                    className="insp-align-popover"
                    role="dialog"
                    aria-label="Distribution options"
                    style={distributionMenuPosition}
                  >
                    <div className="insp-align-popover__header">
                      <span>Distribution options</span>
                      <button
                        type="button"
                        className="insp-align-popover__close"
                        aria-label="Close distribution options"
                        onClick={() => setShowDistributionMenu(false)}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                    <fieldset>
                      <legend>Spacing mode</legend>
                      <label>
                        <input
                          type="radio"
                          name="distribution-mode"
                          checked={distributionMode === 'equalGap'}
                          onChange={() => setDistributionMode('equalGap')}
                        />
                        Equal gaps
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="distribution-mode"
                          checked={distributionMode === 'equalCenter'}
                          onChange={() => setDistributionMode('equalCenter')}
                        />
                        Equal centers
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="distribution-mode"
                          checked={distributionMode === 'fixedGap'}
                          onChange={() => setDistributionMode('fixedGap')}
                        />
                        Fixed gap
                      </label>
                    </fieldset>
                    {distributionMode === 'fixedGap' && (
                      <NumberInput
                        label="Gap (px)"
                        value={distributionGap}
                        min={-99999}
                        max={99999}
                        step={1}
                        onChange={setDistributionGap}
                      />
                    )}
                    <p>Negative gaps intentionally overlap items.</p>
                  </div>
                </>,
                document.body,
              )}
          </div>
        </div>
        <div className="insp-align-bar" role="toolbar" aria-label="Advanced alignment options">
          <Tooltip
            label={keyObjectId ? 'Key object set. Click to clear' : 'Set key object from selection'}
          >
            <button
              type="button"
              className={`pill-group__btn ${keyObjectId ? 'pill-group__btn--active' : ''}`}
              aria-label={keyObjectId ? 'Clear key object' : 'Set key object from selection'}
              onClick={handleToggleKeyObject}
              disabled={!capabilities.canAlign}
            >
              <KeyObjectIcon />
              {keyObjectId && <span className="insp-badge" />}
            </button>
          </Tooltip>
          <div className="insp-align-targets" role="radiogroup" aria-label="Alignment reference">
            <Tooltip label="Align to selection bounds">
              <button
                type="button"
                className={`pill-group__btn ${alignmentReference === 'selection' ? 'pill-group__btn--active' : ''}`}
                aria-label={
                  alignmentReference === 'selection'
                    ? 'Align to selection bounds (active)'
                    : 'Align to selection bounds'
                }
                aria-pressed={alignmentReference === 'selection'}
                onClick={() => chooseAlignmentReference('selection')}
                disabled={!capabilities.canAlign}
              >
                Selection
              </button>
            </Tooltip>
            <Tooltip label="Align to parent frame bounds">
              <button
                type="button"
                className={`pill-group__btn ${alignmentReference === 'container' ? 'pill-group__btn--active' : ''}`}
                aria-label={
                  alignmentReference === 'container'
                    ? 'Align to parent frame (active)'
                    : 'Align to parent frame'
                }
                aria-pressed={alignmentReference === 'container'}
                onClick={() => chooseAlignmentReference('container')}
                disabled={!capabilities.canAlignToContainer}
              >
                Frame
              </button>
            </Tooltip>
            <Tooltip label="Align to active page / canvas bounds">
              <button
                type="button"
                className={`pill-group__btn ${alignmentReference === 'page' ? 'pill-group__btn--active' : ''}`}
                aria-label={
                  alignmentReference === 'page' ? 'Align to page (active)' : 'Align to page'
                }
                aria-pressed={alignmentReference === 'page'}
                onClick={() =>
                  chooseAlignmentReference(alignmentReference === 'page' ? 'selection' : 'page')
                }
                disabled={!capabilities.canAlignToPage}
              >
                <PageIcon />
                <span className="insp-align-target-label">Page</span>
              </button>
            </Tooltip>
          </div>
          <div className="insp-separator" />
          <div style={{ position: 'relative' }}>
            <Tooltip label="Tidy up — arrange in grid">
              <button
                ref={tidyBtnRef}
                type="button"
                className="pill-group__btn"
                aria-label="Tidy up grid"
                onClick={() => setShowTidyMenu(!showTidyMenu)}
                disabled={!capabilities.canTidy}
              >
                <GridIcon />
              </button>
            </Tooltip>
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
                {createPortal(
                  <button
                    className="insp-dropdown-backdrop"
                    onClick={() => setShowTidyMenu(false)}
                    aria-label="Close menu"
                    type="button"
                  />,
                  document.body,
                )}
              </>
            )}
          </div>
          <Tooltip label="Toggle oriented bounding box alignment">
            <button
              type="button"
              className={`pill-group__btn ${obbEnabled ? 'pill-group__btn--active' : ''}`}
              aria-label={obbEnabled ? 'OBB alignment on' : 'OBB alignment off'}
              onClick={() => setObbEnabled(!obbEnabled)}
              disabled={!canAlign}
            >
              <OBBIcon />
            </button>
          </Tooltip>
        </div>
      </TooltipProvider>
    </section>
  );
}
