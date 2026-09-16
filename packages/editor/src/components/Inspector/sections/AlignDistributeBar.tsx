/**
 * Align/Distribute toolbar — multi-selection alignment and distribution.
 *
 * 6 alignment buttons + 2 distribute buttons + advanced controls.
 * Uses the batch alignment and distribution commands from EditorContext.
 *
 * Research basis: Figma/Sketch align toolbar; APG Toolbar pattern; pill-chip pattern.
 */

import { convertDocumentUnit, type DocumentUnit, type TidyLayoutOptions } from '@varve/shared';
import { FloatingPortal, NumberInput, Tooltip, TooltipProvider } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import {
  type AlignmentReference,
  getAlignmentCapabilities,
} from '../../../scene/selectionArrangement';

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

function TidyUpPopover({
  onApply,
  onClose,
}: {
  onApply: (columns: number, options: TidyLayoutOptions) => void;
  onClose: () => void;
}) {
  const [columns, setColumns] = useState(4);
  const [rowGap, setRowGap] = useState(0);
  const [columnGap, setColumnGap] = useState(0);

  return (
    <div
      className="insp-align-popover insp-tidy-popover"
      role="dialog"
      aria-label="Tidy up options"
      style={{ position: 'static' }}
    >
      <div className="insp-align-popover__header">
        <span>Tidy up options</span>
        <button
          type="button"
          className="insp-align-popover__close"
          aria-label="Close Tidy up options"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <p className="insp-tidy-popover__description">
        One-time grid arrangement; spacing does not create auto layout.
      </p>
      <div className="insp-tidy-popover__field">
        <span>Columns</span>
        <NumberInput
          label="Columns"
          value={columns}
          min={1}
          max={12}
          step={1}
          onChange={setColumns}
        />
      </div>
      <div className="insp-tidy-popover__field">
        <span>Column gap</span>
        <NumberInput
          label="Column gap (px)"
          value={columnGap}
          min={0}
          max={99999}
          step={1}
          onChange={setColumnGap}
        />
      </div>
      <div className="insp-tidy-popover__field">
        <span>Row gap</span>
        <NumberInput
          label="Row gap (px)"
          value={rowGap}
          min={0}
          max={99999}
          step={1}
          onChange={setRowGap}
        />
      </div>
      <button
        type="button"
        className="insp-tidy-popover__apply"
        onClick={() => onApply(columns, { rowGap, columnGap })}
      >
        Apply Tidy Up
      </button>
    </div>
  );
}

export function AlignDistributeBar() {
  const {
    alignSelected,
    obbAlignSelected,
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
  const tidyBtnRef = useRef<HTMLButtonElement>(null);
  const distributionBtnRef = useRef<HTMLButtonElement>(null);
  const capabilities = getAlignmentCapabilities(state.document, state.selection);
  const effectiveKeyObjectId =
    keyObjectId && capabilities.eligibleRootIds.includes(keyObjectId) ? keyObjectId : null;
  const gapUnit: DocumentUnit = state.document.documentUnit ?? 'px';
  const displayDistributionGap = convertDocumentUnit(distributionGap, 'px', gapUnit);

  // Progressive disclosure: a single selection can only align to its frame or
  // the page, so the distribute/gap/key-object/tidy/OBB clusters are omitted
  // entirely instead of rendering an all-disabled second toolbar (the
  // "dead toolbar" complaint from the 2026-09-15 competitor research).
  const showSelectionTarget = capabilities.canAlign;
  const showContainerTarget = capabilities.canAlignToContainer;
  const showPageTarget = capabilities.canAlignToPage;
  const showDistributionCluster = capabilities.canSetGap;
  const showKeyObject = state.selection.length >= 2 && capabilities.canAlign;
  const showTidy = capabilities.canTidy;
  const showObb = state.selection.length >= 2 && capabilities.canAlign;

  // The stored reference can outlive its target (a frame was ungrouped, the
  // second layer was deselected). Resolve it against live capabilities so the
  // active segment and the alignment command always agree.
  const effectiveReference: AlignmentReference = useMemo(() => {
    if (alignmentReference === 'selection' && !capabilities.canAlign) {
      return capabilities.canAlignToContainer ? 'container' : 'page';
    }
    if (alignmentReference === 'container' && !capabilities.canAlignToContainer) {
      return capabilities.canAlignToPage ? 'page' : 'selection';
    }
    if (alignmentReference === 'page' && !capabilities.canAlignToPage) {
      return capabilities.canAlignToContainer ? 'container' : 'selection';
    }
    return alignmentReference;
  }, [
    alignmentReference,
    capabilities.canAlign,
    capabilities.canAlignToContainer,
    capabilities.canAlignToPage,
  ]);

  const canAlign =
    effectiveReference === 'page'
      ? capabilities.canAlignToPage
      : effectiveReference === 'container'
        ? capabilities.canAlignToContainer
        : capabilities.canAlign;
  const canRunDistribution =
    capabilities.canDistribute || (distributionMode === 'fixedGap' && capabilities.canSetGap);
  // Every align command names its live target in the accessible name, so the
  // buttons never silently mean something different after a selection change.
  const targetName =
    effectiveReference === 'container'
      ? 'parent frame'
      : effectiveReference === 'page'
        ? 'page'
        : 'selection';
  const alignLabels = {
    left: `Align left edges to ${targetName}`,
    centerH: `Align horizontal centers to ${targetName}`,
    right: `Align right edges to ${targetName}`,
    top: `Align top edges to ${targetName}`,
    centerV: `Align vertical centers to ${targetName}`,
    bottom: `Align bottom edges to ${targetName}`,
  };
  // The target row is always present: the three reference options stay
  // visible (dimmed with a reason when unavailable) so the active alignment
  // mode is never invisible.

  useEffect(() => {
    if (alignToPage) setAlignmentReference('page');
    else setAlignmentReference((current) => (current === 'page' ? 'selection' : current));
  }, [alignToPage]);

  useEffect(() => {
    if (keyObjectId && !effectiveKeyObjectId) setKeyObject(null);
  }, [effectiveKeyObjectId, keyObjectId, setKeyObject]);

  const chooseAlignmentReference = useCallback(
    (reference: AlignmentReference) => {
      setAlignmentReference(reference);
      setAlignToPage(reference === 'page');
    },
    [setAlignToPage],
  );

  const doAlign = useCallback(
    (axis: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => {
      if (obbEnabled) {
        obbAlignSelected(axis, effectiveReference);
      } else {
        alignSelected(axis, effectiveReference);
      }
    },
    [alignSelected, effectiveReference, obbAlignSelected, obbEnabled],
  );

  const handleDistribute = useCallback(
    (axis: 'horizontal' | 'vertical') => {
      if (distributionMode === 'fixedGap') {
        distributeWithGap(axis, distributionGap);
      } else {
        distributeWithMode(axis, distributionMode);
      }
    },
    [distributionGap, distributionMode, distributeWithGap, distributeWithMode],
  );

  const handleToggleKeyObject = useCallback(() => {
    const sel = state.selection;
    if (effectiveKeyObjectId) {
      setKeyObject(null);
    } else if (sel.length >= 2 && state.primaryId) {
      setKeyObject(state.primaryId);
    }
  }, [effectiveKeyObjectId, setKeyObject, state.primaryId, state.selection]);

  const handleTidyUp = useCallback(
    (columns: number, options: TidyLayoutOptions) => {
      if (columns === 0) {
        setShowTidyMenu(false);
        return;
      }
      tidySelected(columns, options);
      setShowTidyMenu(false);
    },
    [tidySelected],
  );

  // A locked/hidden node or a flow-managed auto-layout child has no manual
  // position to change. Its Properties controls explain the governing state;
  // an all-disabled alignment toolbar would imply a command is merely blocked.
  if (!capabilities.canAlignToPage) return null;

  return (
    <section className="insp-align-section" aria-labelledby="align-distribute-heading">
      <div className="insp-align-section__header">
        <h2 id="align-distribute-heading" className="insp-align-section__title">
          Align &amp; distribute
        </h2>
      </div>
      {!showDistributionCluster && (
        <p className="sr-only">
          Distribute, gap, tidy up, key object, and oriented bounding box options become available
          with two or more selected layers.
        </p>
      )}
      <TooltipProvider>
        <div className="insp-align-bar" role="toolbar" aria-label="Align and distribute">
          <div className="insp-align-group">
            <Tooltip label={alignLabels.left}>
              <button
                type="button"
                className="pill-group__btn"
                aria-label={alignLabels.left}
                onClick={() => doAlign('left')}
                disabled={!canAlign}
              >
                <AlignIcon type="alignLeft" />
              </button>
            </Tooltip>
            <Tooltip label={alignLabels.centerH}>
              <button
                type="button"
                className="pill-group__btn"
                aria-label={alignLabels.centerH}
                onClick={() => doAlign('centerH')}
                disabled={!canAlign}
              >
                <AlignIcon type="alignCenterH" />
              </button>
            </Tooltip>
            <Tooltip label={alignLabels.right}>
              <button
                type="button"
                className="pill-group__btn"
                aria-label={alignLabels.right}
                onClick={() => doAlign('right')}
                disabled={!canAlign}
              >
                <AlignIcon type="alignRight" />
              </button>
            </Tooltip>
            <div className="insp-separator" />
            <Tooltip label={alignLabels.top}>
              <button
                type="button"
                className="pill-group__btn"
                aria-label={alignLabels.top}
                onClick={() => doAlign('top')}
                disabled={!canAlign}
              >
                <AlignIcon type="alignTop" />
              </button>
            </Tooltip>
            <Tooltip label={alignLabels.centerV}>
              <button
                type="button"
                className="pill-group__btn"
                aria-label={alignLabels.centerV}
                onClick={() => doAlign('centerV')}
                disabled={!canAlign}
              >
                <AlignIcon type="alignCenterV" />
              </button>
            </Tooltip>
            <Tooltip label={alignLabels.bottom}>
              <button
                type="button"
                className="pill-group__btn"
                aria-label={alignLabels.bottom}
                onClick={() => doAlign('bottom')}
                disabled={!canAlign}
              >
                <AlignIcon type="alignBottom" />
              </button>
            </Tooltip>
            {showDistributionCluster && (
              <>
                <div className="insp-separator" />
                <Tooltip label="Distribute horizontal spacing">
                  <button
                    type="button"
                    className="pill-group__btn"
                    aria-label="Distribute horizontal spacing"
                    onClick={() => handleDistribute('horizontal')}
                    disabled={!canRunDistribution}
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
                    disabled={!canRunDistribution}
                  >
                    <DistributeIcon type="vertical" />
                  </button>
                </Tooltip>
              </>
            )}
          </div>
          {showDistributionCluster && (
            <div className="insp-align-options">
              <Tooltip label="Distribution options">
                <button
                  type="button"
                  ref={distributionBtnRef}
                  className={`pill-group__btn ${showDistributionMenu ? 'pill-group__btn--active' : ''}`}
                  aria-label="Distribution options"
                  aria-expanded={showDistributionMenu}
                  onClick={() => setShowDistributionMenu((open) => !open)}
                  disabled={!capabilities.canSetGap}
                >
                  Gap
                </button>
              </Tooltip>
              <FloatingPortal
                anchorRef={distributionBtnRef}
                open={showDistributionMenu}
                kind="popover"
                placement="bottom-end"
                fallbackPlacements={['top-end', 'bottom-start', 'top-start']}
                onClose={() => setShowDistributionMenu(false)}
                dismissOnEscape
                initialFocus
                yieldTabToAnchor
                className="varve-floating-layer"
              >
                <div
                  className="insp-align-popover"
                  role="dialog"
                  aria-label="Distribution options"
                  style={{ position: 'static' }}
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
                      label={`Gap (${gapUnit})`}
                      value={displayDistributionGap}
                      min={-99999}
                      max={99999}
                      step={1}
                      onChange={(value) =>
                        setDistributionGap(convertDocumentUnit(value, gapUnit, 'px'))
                      }
                    />
                  )}
                  <p>Negative gaps intentionally overlap items.</p>
                </div>
              </FloatingPortal>
            </div>
          )}
        </div>
        <div
          className="insp-align-bar insp-align-bar--advanced"
          role="toolbar"
          aria-label="Alignment target and advanced options"
        >
          <div className="insp-align-group">
            {showKeyObject && (
              <Tooltip
                label={
                  effectiveKeyObjectId
                    ? 'Key object set. Click to clear'
                    : 'Set key object from selection'
                }
              >
                <button
                  type="button"
                  className={`pill-group__btn ${effectiveKeyObjectId ? 'pill-group__btn--active' : ''}`}
                  aria-label={
                    effectiveKeyObjectId ? 'Clear key object' : 'Set key object from selection'
                  }
                  onClick={handleToggleKeyObject}
                  disabled={!capabilities.canAlign}
                >
                  <KeyObjectIcon />
                  {effectiveKeyObjectId && <span className="insp-badge" />}
                </button>
              </Tooltip>
            )}
            {/* All three references stay visible so the alignment mode is
                  never a hidden state; unavailable options are announced as
                  disabled and explain themselves on hover. */}
            <div className="insp-align-targets" role="radiogroup" aria-label="Alignment reference">
              <Tooltip
                label={
                  showSelectionTarget
                    ? 'Align to selection bounds'
                    : 'Unavailable with one layer — select two or more'
                }
              >
                <button
                  type="button"
                  className={`pill-group__btn ${effectiveReference === 'selection' ? 'pill-group__btn--active' : ''}`}
                  aria-label={
                    effectiveReference === 'selection'
                      ? 'Align to selection bounds (active)'
                      : 'Align to selection bounds'
                  }
                  aria-pressed={effectiveReference === 'selection'}
                  aria-disabled={!showSelectionTarget || undefined}
                  title={
                    showSelectionTarget
                      ? 'Align to selection bounds'
                      : 'Select two or more layers to align to the selection bounds'
                  }
                  onClick={() => {
                    if (showSelectionTarget) chooseAlignmentReference('selection');
                  }}
                >
                  Selection
                </button>
              </Tooltip>
              <Tooltip
                label={
                  showContainerTarget
                    ? 'Align to parent frame bounds'
                    : 'Unavailable — no shared containing frame'
                }
              >
                <button
                  type="button"
                  className={`pill-group__btn ${effectiveReference === 'container' ? 'pill-group__btn--active' : ''}`}
                  aria-label={
                    effectiveReference === 'container'
                      ? 'Align to parent frame (active)'
                      : 'Align to parent frame'
                  }
                  aria-pressed={effectiveReference === 'container'}
                  aria-disabled={!showContainerTarget || undefined}
                  title={
                    showContainerTarget
                      ? 'Align to parent frame bounds'
                      : 'This selection has no shared containing frame'
                  }
                  onClick={() => {
                    if (showContainerTarget) chooseAlignmentReference('container');
                  }}
                >
                  Frame
                </button>
              </Tooltip>
              <Tooltip
                label={
                  showPageTarget
                    ? 'Align to active page / canvas bounds'
                    : 'Unavailable for this selection'
                }
              >
                <button
                  type="button"
                  className={`pill-group__btn ${effectiveReference === 'page' ? 'pill-group__btn--active' : ''}`}
                  aria-label={
                    effectiveReference === 'page' ? 'Align to page (active)' : 'Align to page'
                  }
                  aria-pressed={effectiveReference === 'page'}
                  aria-disabled={!showPageTarget || undefined}
                  title={
                    showPageTarget
                      ? 'Align to active page / canvas bounds'
                      : 'Aligning to the page is unavailable for this selection'
                  }
                  onClick={() => {
                    if (showPageTarget) chooseAlignmentReference('page');
                  }}
                >
                  <PageIcon />
                  <span className="insp-align-target-label">Page</span>
                </button>
              </Tooltip>
            </div>
          </div>
          {(showTidy || showObb) && (
            <div className="insp-align-group">
              <div className="insp-separator" />
              {showTidy && (
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
                  <FloatingPortal
                    anchorRef={tidyBtnRef}
                    open={showTidyMenu}
                    kind="popover"
                    placement="bottom-end"
                    fallbackPlacements={['top-end', 'bottom-start', 'top-start']}
                    onClose={() => setShowTidyMenu(false)}
                    dismissOnEscape
                    initialFocus
                    yieldTabToAnchor
                    className="varve-floating-layer"
                  >
                    <TidyUpPopover onApply={handleTidyUp} onClose={() => setShowTidyMenu(false)} />
                  </FloatingPortal>
                </div>
              )}
              {showObb && (
                <Tooltip label="Toggle oriented bounding box alignment">
                  <button
                    type="button"
                    className={`pill-group__btn ${obbEnabled ? 'pill-group__btn--active' : ''}`}
                    aria-label={obbEnabled ? 'OBB alignment on' : 'OBB alignment off'}
                    onClick={() => setObbEnabled(!obbEnabled)}
                  >
                    <OBBIcon />
                  </button>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      </TooltipProvider>
    </section>
  );
}
