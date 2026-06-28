/**
 * Status bar — tool, coordinates, zoom, selection count (Strata plan §5.7).
 */
import { useEditor } from './context';

export function StatusBar() {
  const { state } = useEditor();
  return (
    <div className="editor-status">
      <span>{state.tool}</span>
      <span>—</span>
      <span>zoom {Math.round(state.zoom * 100)}%</span>
      <span style={{ marginLeft: 'auto' }}>{state.selection ? '1 selected' : 'no selection'}</span>
    </div>
  );
}
