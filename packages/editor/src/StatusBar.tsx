/**
 * Status bar — tool, coordinates, zoom, selection count (Strata plan §5.7).
 */
import { useEditor } from './context';

export function StatusBar() {
  const { state, rootNodes } = useEditor();
  const selectionName = state.selection
    ? (rootNodes().find((n) => n.id === state.selection)?.name ?? 'unknown')
    : null;

  return (
    <div className="editor-status">
      <span>{state.tool}</span>
      <span>—</span>
      <span>zoom {Math.round(state.zoom * 100)}%</span>
      <span style={{ marginLeft: 'auto' }}>
        {selectionName ? `1 selected: ${selectionName}` : `${rootNodes().length} layers`}
      </span>
    </div>
  );
}
