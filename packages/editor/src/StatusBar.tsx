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

  const selText =
    sel.length === 1
      ? `${sel[0]?.name ?? 'unknown'}`
      : sel.length > 1
        ? `${sel.length} selected`
        : `${rootNodes().length} layers`;

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
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          font: 'inherit',
          fontSize: 'var(--font-size-xs)',
          cursor: 'pointer',
          padding: 0,
          outline: 'none',
        }}
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
        style={{
          background: state.pixelGridEnabled ? 'var(--color-interactive-default)' : 'none',
          border: 'none',
          color: state.pixelGridEnabled ? 'var(--color-text-on-accent)' : 'var(--color-text-muted)',
          cursor: 'pointer',
          borderRadius: 'var(--radius-sm)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          padding: 0,
        }}
      >
        <Icon name="Grid3x3" size={12} />
      </button>
      <button
        type="button"
        aria-pressed={state.snapEnabled}
        onClick={() => setSnapEnabled(!state.snapEnabled)}
        aria-label="Toggle snapping"
        style={{
          background: state.snapEnabled ? 'var(--color-interactive-default)' : 'none',
          border: 'none',
          color: state.snapEnabled ? 'var(--color-text-on-accent)' : 'var(--color-text-muted)',
          cursor: 'pointer',
          borderRadius: 'var(--radius-sm)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          padding: 0,
        }}
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
        style={{
          width: 44,
          background: 'none',
          border: 'none',
          color: 'inherit',
          font: 'inherit',
          fontSize: 'var(--font-size-xs)',
          textAlign: 'right',
          cursor: 'text',
          padding: 0,
        }}
      />
      <span style={{ color: 'var(--color-text-muted)' }}>%</span>
      <button
        type="button"
        onClick={() => revealSelection({ fit: true })}
        aria-label="Fit selection to viewport"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 'var(--font-size-xs)',
          padding: '0 var(--space-1)',
        }}
      >
        Fit
      </button>
      <span style={{ marginLeft: 'auto' }}>{selText}</span>
    </div>
  );
}
