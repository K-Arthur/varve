/**
 * Tool panel — archived.
 *
 * Replaced by FloatingToolbar in Session 12+.
 */
import { IconButton, SOLID_TOOL_ICONS, Toolbar, Tooltip } from '@strata/ui';
import { type ToolId, useEditor } from './context';

const TOOLS: { id: ToolId; label: string; shortcut: string }[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'frame', label: 'Frame', shortcut: 'F' },
  { id: 'rect', label: 'Rectangle', shortcut: 'R' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O' },
  { id: 'polygon', label: 'Polygon', shortcut: 'U' },
  { id: 'star', label: 'Star', shortcut: 'S' },
  { id: 'line', label: 'Line', shortcut: 'L' },
  { id: 'pen', label: 'Pen', shortcut: 'P' },
  { id: 'text', label: 'Text', shortcut: 'T' },
  { id: 'hand', label: 'Hand', shortcut: 'H' },
  { id: 'zoom', label: 'Zoom', shortcut: 'Z' },
];

/** @deprecated Use FloatingToolbar instead. */
export function ToolPanel() {
  const { state, setTool } = useEditor();
  return (
    <div className="editor-toolbar">
      <Toolbar label="Drawing tools">
        {TOOLS.map((t) => (
          <Tooltip key={t.id} label={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}>
            <IconButton
              icon={SOLID_TOOL_ICONS[t.id]}
              solid
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
