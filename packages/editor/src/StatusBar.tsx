import { Icon } from '@strata/ui';
import { useEditor } from './context';

export function StatusBar() {
  const {
    state,
    setZoom,
    setUnitType,
    setPixelGridEnabled,
    setSnapEnabled,
    revealSelection,
    selectedNodes,
    rootNodes,
  } = useEditor();
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

  return (
    <div className="editor-status">
      <span>{state.tool}</span>
      {state.cursorPos && (
        <span>
          X: {state.cursorPos.x} Y: {state.cursorPos.y}
        </span>
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
      <span aria-hidden>—</span>
      <label htmlFor="status-zoom" className="visually-hidden">
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
      <span className="num-display__suffix" style={{ marginLeft: 0 }}>
        %
      </span>
      <button
        type="button"
        onClick={() => revealSelection({ fit: true })}
        aria-label="Fit selection to viewport"
        className="editor-status__fit-btn"
      >
        Fit
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
