import { Icon, NumberInput, Select, Tooltip, TooltipProvider } from '@varve/ui';
import { useSyncExternalStore } from 'react';
import { AuditBadge } from './components/AuditBadge';
import { DebtBadge } from './components/DebtBadge';
import { PreflightWarnings } from './components/PreflightWarnings';
import { DocumentInfoDialog } from './components/Shell';
import { LayoutScoreIndicator } from './components/StatusBar/LayoutScoreIndicator';
import { SaveStatusIndicator } from './components/StatusBar/SaveStatusIndicator';
import { useEditor } from './context';
import { ShortcutTipChip } from './intelligence/ShortcutTipChip';
import { useShortcutTips } from './intelligence/useShortcutTips';
import {
  getCompositorDiagnosticsSnapshot,
  subscribeCompositorDiagnostics,
} from './render/compositorDiagnosticsStore';
import { formatShortcut, getEffectiveBinding } from './shortcuts/ShortcutManager';
import { useEffectiveWorkspaceConfig } from './workspace/useWorkspaceConfig';
import { getVisibleStatusSections } from './workspace/workspaceTypes';

interface StatusBarProps {
  onOpenPalette?: (shortcutId?: string) => void;
}

export function StatusBar({ onOpenPalette }: StatusBarProps) {
  const {
    state,
    setZoom,
    setUnitType,
    setPixelGridEnabled,
    setSnapEnabled,
    setSnapGrid,
    setRulerMode,
    setGridOverlayMode,
    revealSelection,
    zoomIn,
    zoomOut,
    fitAll,
    fitActivePage,
    resetViewRotation,
    selectedNodes,
    rootNodes,
    clearAllGuides,
  } = useEditor();
  const effectiveConfig = useEffectiveWorkspaceConfig(state.workspaceMode);
  const compositorDiag = useSyncExternalStore(
    subscribeCompositorDiagnostics,
    getCompositorDiagnosticsSnapshot,
    () => null,
  );
  const sel = selectedNodes();

  function handleZoomInput(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseFloat(e.target.value);
    if (!Number.isNaN(v) && v > 0) setZoom(v / 100);
  }

  function handleZoomKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
  }

  const singleSel = sel.length === 1;
  const statusSectionIds = getVisibleStatusSections(state.workspaceMode, effectiveConfig);
  const showPreflight = statusSectionIds.includes('preflight');
  const showDebtBadge = statusSectionIds.includes('debt');
  const showTipChip = statusSectionIds.includes('shortcutTip');
  const { currentTip, dismiss } = useShortcutTips(state.workspaceMode, showTipChip);

  const sc = (id: string) => formatShortcut(getEffectiveBinding(id));

  return (
    <TooltipProvider>
      {/* Document Info renders from the status bar: a native <dialog> sits in
          the top layer, so DOM position is irrelevant and Shell.tsx (a hub
          file over its import budget) stays untouched. */}
      <DocumentInfoDialog />
      <div className="editor-status">
        <span>{state.tool}</span>
        {showPreflight && <PreflightWarnings />}
        {showDebtBadge && <DebtBadge />}
        <AuditBadge />
        {compositorDiag?.deviceLost && (
          <span className="editor-status__info editor-status__info--warning">
            GPU lost — using Canvas2D
          </span>
        )}
        {compositorDiag && !compositorDiag.deviceLost && (
          <span className="editor-status__info">
            {compositorDiag.backendId}
            {compositorDiag.gpuActive ? '' : ' (cpu)'}
          </span>
        )}
        {state.cursorPos && (
          <span>
            X: {Math.round(state.cursorPos.x)} Y: {Math.round(state.cursorPos.y)}
          </span>
        )}
        <LayoutScoreIndicator />
        <SaveStatusIndicator />
        {state.cameraRotation !== 0 && (
          <span>{Math.round((state.cameraRotation * 180) / Math.PI)}°</span>
        )}
        {currentTip && (
          <ShortcutTipChip
            tip={currentTip}
            onDismiss={dismiss}
            onOpenPalette={(id) => onOpenPalette?.(id)}
          />
        )}
        <span aria-hidden>—</span>
        <Select
          label="Units"
          value={state.unitType}
          options={[
            { value: 'px', label: 'px' },
            { value: 'pt', label: 'pt' },
            { value: 'cm', label: 'cm' },
            { value: 'mm', label: 'mm' },
            { value: 'in', label: 'in' },
            { value: '%', label: '%' },
          ]}
          onChange={(v) => setUnitType(v as typeof state.unitType)}
        />
        <Tooltip label="Toggle pixel grid">
          <button
            type="button"
            aria-pressed={state.pixelGridEnabled}
            onClick={() => setPixelGridEnabled(!state.pixelGridEnabled)}
            aria-label="Toggle pixel grid"
            className={`editor-status__toggle${state.pixelGridEnabled ? ' editor-status__toggle--active' : ''}`}
          >
            <Icon name="Grid3x3" size={12} />
          </button>
        </Tooltip>
        <Tooltip
          label={state.snapEnabled ? 'Disable snapping' : 'Enable snapping'}
          shortcut={sc('toggleSnap')}
        >
          <button
            type="button"
            aria-pressed={state.snapEnabled}
            onClick={() => setSnapEnabled(!state.snapEnabled)}
            aria-label={state.snapEnabled ? 'Disable snapping' : 'Enable snapping'}
            className={`editor-status__toggle${state.snapEnabled ? ' editor-status__toggle--active' : ''}`}
          >
            <Icon name="Magnet" size={12} />
          </button>
        </Tooltip>
        <span className="editor-status__snap-grid">
          <NumberInput
            value={state.snapGrid}
            min={1}
            max={256}
            step={1}
            onChange={setSnapGrid}
            label="Snap grid spacing (px)"
          />
        </span>
        <Tooltip label="Artboard ruler" shortcut={sc('toggleRulerMode')}>
          <button
            type="button"
            aria-pressed={state.rulerMode === 'artboard'}
            onClick={() => setRulerMode(state.rulerMode === 'artboard' ? 'global' : 'artboard')}
            aria-label="Toggle artboard ruler origin"
            className={`editor-status__toggle${state.rulerMode === 'artboard' ? ' editor-status__toggle--active' : ''}`}
          >
            AB
          </button>
        </Tooltip>
        <Tooltip label="Baseline grid" shortcut={sc('gridOverlayBaseline')}>
          <button
            type="button"
            aria-pressed={state.gridOverlayMode === 'baseline'}
            onClick={() =>
              setGridOverlayMode(state.gridOverlayMode === 'baseline' ? 'none' : 'baseline')
            }
            aria-label="Toggle baseline grid overlay"
            className={`editor-status__toggle${state.gridOverlayMode === 'baseline' ? ' editor-status__toggle--active' : ''}`}
          >
            <Icon name="AlignVerticalSpaceAround" size={12} />
          </button>
        </Tooltip>
        {state.cameraRotation !== 0 && (
          <Tooltip label="Reset view rotation" shortcut={sc('resetViewRotation')}>
            <button
              type="button"
              onClick={() => resetViewRotation()}
              aria-label="Reset view rotation"
              className="editor-status__fit-btn"
            >
              Reset rot
            </button>
          </Tooltip>
        )}
        {state.document.guides && state.document.guides.length > 0 && (
          <Tooltip label="Clear all guides">
            <button
              type="button"
              onClick={() => clearAllGuides()}
              aria-label="Clear all guides"
              className="editor-status__toggle"
            >
              <Icon name="RemoveFormatting" size={12} />
            </button>
          </Tooltip>
        )}
        <span aria-hidden>—</span>
        <div className="editor-status__zoom-chip">
          <Tooltip label="Zoom out" shortcut={sc('zoomOut')}>
            <button
              type="button"
              onClick={zoomOut}
              aria-label="Zoom out"
              className="editor-status__toggle"
            >
              <Icon name="Minus" size={10} />
            </button>
          </Tooltip>
          <label htmlFor="status-zoom" className="sr-only">
            Zoom
          </label>
          <input
            id="status-zoom"
            type="number"
            min={1}
            max={1000}
            step={1}
            value={Math.round(state.zoom * 100)}
            onChange={handleZoomInput}
            onKeyDown={handleZoomKey}
            aria-label={`Zoom ${Math.round(state.zoom * 100)}%`}
            className="editor-status__zoom-value"
          />
          <span aria-hidden>%</span>
          <Tooltip label="Zoom in" shortcut={sc('zoomIn')}>
            <button
              type="button"
              onClick={zoomIn}
              aria-label="Zoom in"
              className="editor-status__toggle"
            >
              <Icon name="Plus" size={10} />
            </button>
          </Tooltip>
        </div>
        <Tooltip label="Fit page" shortcut={sc('fitActivePage')}>
          <button
            type="button"
            onClick={fitActivePage}
            aria-label="Fit active page"
            className="editor-status__fit-btn"
          >
            Fit page
          </button>
        </Tooltip>
        <Tooltip label="Fit all" shortcut={sc('fitAll')}>
          <button
            type="button"
            onClick={fitAll}
            aria-label="Fit all to viewport"
            className="editor-status__fit-btn"
          >
            Fit all
          </button>
        </Tooltip>
        <Tooltip label="Fit selection" shortcut={sc('fitSelection')}>
          <button
            type="button"
            onClick={() => revealSelection({ fit: true })}
            aria-label="Fit selection to viewport"
            className="editor-status__fit-btn"
          >
            Fit sel
          </button>
        </Tooltip>
        <span className="editor-status__info">
          {singleSel ? (
            <span>{sel[0]?.name ?? 'unknown'}</span>
          ) : (
            <>
              <span className="num-display">
                {sel.length > 1 ? sel.length : rootNodes().length}
              </span>
              <span className="num-display__suffix">{sel.length > 1 ? 'selected' : 'layers'}</span>
            </>
          )}
        </span>
      </div>
    </TooltipProvider>
  );
}
