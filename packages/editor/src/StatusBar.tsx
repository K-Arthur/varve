/**
 * Status bar — tool, zoom, selection count.
 * F1: uses selectedNodes() which works for nested nodes (doc.nodes lookup).
 * A12: zoom is editable; Fit button zoom-to-fit-all (Shift+1).
 * P3: Fit now actually fits (pan+zoom) instead of just resetting zoom to 1.
 */
import { useEditor } from './context';

export function StatusBar() {
  const { state, setZoom, revealSelection, selectedNodes, rootNodes } = useEditor();
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
          width: 52,
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
