import { Icon, NumberInput } from '@strata/ui';
import { useSyncExternalStore } from 'react';
import { PreflightWarnings } from './components/PreflightWarnings';
import { useEditor } from './context';
import {
  getCompositorDiagnosticsSnapshot,
  subscribeCompositorDiagnostics,
} from './render/compositorDiagnosticsStore';
import { getWorkspaceConfig } from './workspace/workspaceTypes';

export function StatusBar() {
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
  const showPreflight = getWorkspaceConfig(state.workspaceMode).statusSections?.preflight ?? false;

  return (
    <div className="editor-status">
      <span>{state.tool}</span>
      {showPreflight && <PreflightWarnings />}
      {compositorDiag?.deviceLost && (
        <span
          className="editor-status__info editor-status__info--warning"
          title="The GPU device was lost mid-session (driver reset, OS suspend/resume, or another app claiming the GPU). Rendering continues on Canvas2D; reload if you want to re-acquire the GPU."
        >
          GPU lost — using Canvas2D
        </span>
      )}
      {compositorDiag && !compositorDiag.deviceLost && (
        <span
          className="editor-status__info"
          title={`GPU ${compositorDiag.gpuActive ? 'active' : compositorDiag.adapterIsFallback ? 'fallback (software adapter declined)' : 'fallback'} · pool ${compositorDiag.vertexPoolEntries} · bundles ${compositorDiag.bundleCacheEntries}`}
        >
          {compositorDiag.backendId}
          {compositorDiag.gpuActive ? '' : ' (cpu)'}
        </span>
      )}
      {state.cursorPos && (
        <span>
          X: {Math.round(state.cursorPos.x)} Y: {Math.round(state.cursorPos.y)}
        </span>
      )}
      {state.cameraRotation !== 0 && (
        <span title="View rotation">{Math.round((state.cameraRotation * 180) / Math.PI)}°</span>
      )}
      <span aria-hidden>—</span>
      <select
        value={state.unitType}
        onChange={(e) => setUnitType(e.target.value as typeof state.unitType)}
        aria-label="Units"
        className="editor-status__unit-select"
      >
        <option value="px">px</option>
        <option value="pt">pt</option>
        <option value="cm">cm</option>
        <option value="mm">mm</option>
        <option value="in">in</option>
        <option value="%">%</option>
      </select>
      <button
        type="button"
        aria-pressed={state.pixelGridEnabled}
        onClick={() => setPixelGridEnabled(!state.pixelGridEnabled)}
        aria-label="Toggle pixel grid"
        className={`editor-status__toggle${state.pixelGridEnabled ? ' editor-status__toggle--active' : ''}`}
      >
        <Icon name="Grid3x3" size={12} />
      </button>
      <button
        type="button"
        aria-pressed={state.snapEnabled}
        onClick={() => setSnapEnabled(!state.snapEnabled)}
        aria-label="Toggle snapping"
        className={`editor-status__toggle${state.snapEnabled ? ' editor-status__toggle--active' : ''}`}
      >
        <Icon name="Magnet" size={12} />
      </button>
      <span className="editor-status__snap-grid" title="Snap grid spacing (px)">
        <NumberInput
          value={state.snapGrid}
          min={1}
          max={256}
          step={1}
          onChange={setSnapGrid}
          label="Snap grid"
        />
      </span>
      <button
        type="button"
        aria-pressed={state.rulerMode === 'artboard'}
        onClick={() => setRulerMode(state.rulerMode === 'artboard' ? 'global' : 'artboard')}
        aria-label="Toggle artboard ruler origin"
        className={`editor-status__toggle${state.rulerMode === 'artboard' ? ' editor-status__toggle--active' : ''}`}
        title="Artboard ruler (Alt+;)"
      >
        AB
      </button>
      <button
        type="button"
        aria-pressed={state.gridOverlayMode === 'baseline'}
        onClick={() =>
          setGridOverlayMode(state.gridOverlayMode === 'baseline' ? 'none' : 'baseline')
        }
        aria-label="Toggle baseline grid overlay"
        className={`editor-status__toggle${state.gridOverlayMode === 'baseline' ? ' editor-status__toggle--active' : ''}`}
        title="Baseline grid"
      >
        <Icon name="AlignVerticalSpaceAround" size={12} />
      </button>
      {state.cameraRotation !== 0 && (
        <button
          type="button"
          onClick={() => resetViewRotation()}
          aria-label="Reset view rotation"
          className="editor-status__fit-btn"
          title="Reset view rotation (Shift+R)"
        >
          Reset rot
        </button>
      )}
      {state.document.guides && state.document.guides.length > 0 && (
        <button
          type="button"
          onClick={() => clearAllGuides()}
          aria-label="Clear all guides"
          className="editor-status__toggle"
          title="Clear all guides"
        >
          <Icon name="RemoveFormatting" size={12} />
        </button>
      )}
      <span aria-hidden>—</span>
      <div className="editor-status__zoom-chip">
        <button
          type="button"
          onClick={zoomOut}
          aria-label="Zoom out"
          className="editor-status__toggle"
          title="Zoom out (−)"
        >
          <Icon name="Minus" size={10} />
        </button>
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
        <button
          type="button"
          onClick={zoomIn}
          aria-label="Zoom in"
          className="editor-status__toggle"
          title="Zoom in (+)"
        >
          <Icon name="Plus" size={10} />
        </button>
      </div>
      <button
        type="button"
        onClick={fitActivePage}
        aria-label="Fit active page"
        className="editor-status__fit-btn"
        title="Fit page (Shift+3)"
      >
        Fit page
      </button>
      <button
        type="button"
        onClick={fitAll}
        aria-label="Fit all to viewport"
        className="editor-status__fit-btn"
        title="Fit all (Shift+1)"
      >
        Fit all
      </button>
      <button
        type="button"
        onClick={() => revealSelection({ fit: true })}
        aria-label="Fit selection to viewport"
        className="editor-status__fit-btn"
        title="Fit selection (Shift+2)"
      >
        Fit sel
      </button>
      <span className="editor-status__info">
        {singleSel ? (
          <span>{sel[0]?.name ?? 'unknown'}</span>
        ) : (
          <>
            <span className="num-display">{sel.length > 1 ? sel.length : rootNodes().length}</span>
            <span className="num-display__suffix">{sel.length > 1 ? 'selected' : 'layers'}</span>
          </>
        )}
      </span>
    </div>
  );
}
