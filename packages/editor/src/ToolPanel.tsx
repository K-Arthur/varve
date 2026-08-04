/**
 * Tool panel — archived.
 *
 * Replaced by FloatingToolbar in Session 12+.
 */
import { IconButton, TOOL_ICONS, Toolbar, Tooltip } from '@varve/ui';
import { type ToolId, useEditor } from './context';
import { toolShortcutLabel } from './shortcuts';

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'frame', label: 'Frame' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'star', label: 'Star' },
  { id: 'line', label: 'Line' },
  { id: 'pen', label: 'Pen' },
  { id: 'text', label: 'Text' },
  { id: 'hand', label: 'Hand' },
  { id: 'zoom', label: 'Zoom' },
];

/** @deprecated Use FloatingToolbar instead. */
export function ToolPanel() {
  const { state, setTool } = useEditor();
  return (
    <div className="editor-toolbar">
      <Toolbar label="Drawing tools">
        {TOOLS.map((t) => (
          <Tooltip key={t.id} label={t.label} shortcut={toolShortcutLabel(t.id)}>
            <IconButton
              icon={TOOL_ICONS[t.id as keyof typeof TOOL_ICONS]}
              label={t.label}
              size="sm"
              pressed={state.tool === t.id}
              onClick={() => setTool(t.id)}
            />
          </Tooltip>
        ))}
      </Toolbar>
    </div>
  );
}
