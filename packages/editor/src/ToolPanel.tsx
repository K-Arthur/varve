/**
 * Tool panel — the primary toolbar (Strata plan §5.3).
 *
 * Uses the APG Toolbar component with roving tabindex.
 */
import { IconButton, TOOL_ICONS, Toolbar } from '@strata/ui';
import { type ToolId, useEditor } from './context';

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'frame', label: 'Frame' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'pen', label: 'Pen' },
  { id: 'text', label: 'Text' },
  { id: 'hand', label: 'Hand' },
  { id: 'zoomIn', label: 'Zoom in' },
];

export function ToolPanel() {
  const { state, setTool } = useEditor();
  return (
    <div className="editor-toolbar">
      <Toolbar label="Drawing tools">
        {TOOLS.map((t) => (
          <IconButton
            key={t.id}
            icon={TOOL_ICONS[t.id]}
            label={t.label}
            size="sm"
            pressed={state.tool === t.id}
            onClick={() => setTool(t.id)}
          />
        ))}
      </Toolbar>
    </div>
  );
}
