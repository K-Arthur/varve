import { Icon, TOOL_ICONS, Tooltip } from '@strata/ui';
import { type ToolId, useEditor } from '../../context';
import './FloatingToolbar.css';

interface ToolDef {
  id: ToolId;
  label: string;
  shortcut?: string;
}

const SHAPE_TOOLS: ToolDef[] = [
  { id: 'rect', label: 'Rectangle', shortcut: 'R' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'star', label: 'Star' },
  { id: 'line', label: 'Line', shortcut: 'L' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'text', label: 'Text', shortcut: 'T' },
];

const DRAW_TOOLS: ToolDef[] = [
  { id: 'pen', label: 'Pen', shortcut: 'P' },
  { id: 'pencil', label: 'Pencil' },
  { id: 'image', label: 'Image' },
  { id: 'frame', label: 'Frame', shortcut: 'F' },
];

const UTILITY_TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'hand', label: 'Hand', shortcut: 'H' },
  { id: 'zoom', label: 'Zoom', shortcut: 'Z' },
  { id: 'slice', label: 'Slice' },
  { id: 'eyedropper', label: 'Eyedropper' },
  { id: 'scale', label: 'Scale' },
  { id: 'inspect', label: 'Inspect', shortcut: 'I' },
];

function ToolGroup({ tools }: { tools: ToolDef[] }) {
  const { state, setTool } = useEditor();
  return (
    <div className="floating-toolbar__group" role="group">
      {tools.map((t) => (
        <Tooltip
          key={t.id}
          content={
            <span>
              {t.label}
              {t.shortcut && (
                <span
                  style={{
                    marginLeft: 6,
                    opacity: 0.65,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {t.shortcut}
                </span>
              )}
            </span>
          }
        >
          <button
            className={`floating-toolbar__btn${state.tool === t.id ? ' floating-toolbar__btn--active' : ''}`}
            aria-pressed={state.tool === t.id}
            aria-label={t.label}
            onClick={() => setTool(t.id)}
          >
            <Icon name={TOOL_ICONS[t.id]} size={16} />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

export function FloatingToolbar() {
  return (
    <div className="floating-toolbar" role="toolbar" aria-label="Drawing tools">
      <ToolGroup tools={SHAPE_TOOLS} />
      <ToolGroup tools={DRAW_TOOLS} />
      <ToolGroup tools={UTILITY_TOOLS} />
    </div>
  );
}
