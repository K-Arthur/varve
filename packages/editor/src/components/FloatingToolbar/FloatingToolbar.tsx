import type { BooleanOpKind } from '@strata/scene';
import type { MenuEntry } from '@strata/ui';
import { ContextMenu, Icon, TOOL_ICONS, Toolbar, Tooltip } from '@strata/ui';
import { useState } from 'react';
import { type ToolId, useEditor } from '../../context';
import './FloatingToolbar.css';

const BOOLEAN_OP_MAP: Record<string, BooleanOpKind> = {
  booleanUnion: 'union',
  booleanSubtract: 'subtract',
  booleanIntersect: 'intersect',
  booleanExclude: 'exclude',
};

const SHAPE_SUB_TOOLS: ToolId[] = ['rect', 'ellipse', 'polygon', 'star'];
const BOOLEAN_SUB_TOOLS: ToolId[] = [
  'booleanUnion',
  'booleanSubtract',
  'booleanIntersect',
  'booleanExclude',
];

const TOOL_LABELS: Partial<Record<ToolId, string>> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  star: 'Star',
  line: 'Line',
  arrow: 'Arrow',
  text: 'Text',
  pen: 'Pen',
  pencil: 'Pencil',
  frame: 'Frame',
  select: 'Select',
  hand: 'Hand',
  zoom: 'Zoom',
  slice: 'Slice',
  eyedropper: 'Eyedropper',
  scale: 'Scale',
  inspect: 'Inspect',
  booleanUnion: 'Union',
  booleanSubtract: 'Subtract',
  booleanIntersect: 'Intersect',
  booleanExclude: 'Exclude',
  cloneStamp: 'Clone Stamp',
  healBrush: 'Healing Brush',
  spotHeal: 'Spot Heal',
  patch: 'Patch Tool',
};

const TOOL_SHORTCUTS: Partial<Record<ToolId, string>> = {
  select: 'V',
  hand: 'H',
  zoom: 'Z',
  frame: 'F',
  rect: 'R',
  ellipse: 'O',
  line: 'L',
  arrow: 'A',
  pen: 'P',
  text: 'T',
  scale: 'S',
  slice: 'K',
  eyedropper: 'I',
  inspect: 'Ctrl',
  cloneStamp: 'J',
  healBrush: 'J 2x',
  spotHeal: 'J 3x',
};

interface ToolButtonProps {
  id: ToolId;
  groupStart?: boolean;
}

function ToolButton({ id, groupStart }: ToolButtonProps) {
  const { state, setTool } = useEditor();
  const label = TOOL_LABELS[id] ?? id;
  const shortcut = TOOL_SHORTCUTS[id];
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        className={`floating-toolbar__btn${state.tool === id ? ' floating-toolbar__btn--active' : ''}${groupStart ? ' floating-toolbar__btn--group-start' : ''}`}
        aria-pressed={state.tool === id}
        aria-label={label}
        onClick={() => setTool(id)}
      >
        <Icon name={TOOL_ICONS[id] ?? 'MousePointer2'} size={16} />
      </button>
    </Tooltip>
  );
}

const INDIVIDUAL_TOOLS: { id: ToolId; groupStart?: boolean }[] = [
  { id: 'line' },
  { id: 'arrow' },
  { id: 'text' },
  { id: 'pen', groupStart: true },
  { id: 'pencil' },
  { id: 'frame' },
  { id: 'select', groupStart: true },
  { id: 'hand' },
  { id: 'zoom' },
  { id: 'slice' },
  { id: 'eyedropper' },
  { id: 'scale' },
  { id: 'inspect' },
  { id: 'cloneStamp', groupStart: true },
  { id: 'healBrush' },
  { id: 'spotHeal' },
  { id: 'patch' },
];

export function FloatingToolbar() {
  const { state, setTool, booleanOp } = useEditor();
  const [shapeMenuPos, setShapeMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [booleanMenuPos, setBooleanMenuPos] = useState<{ x: number; y: number } | null>(null);

  const currentShape = (SHAPE_SUB_TOOLS as readonly ToolId[]).includes(state.tool as ToolId)
    ? state.tool
    : ('rect' as ToolId);
  const currentBoolean = (BOOLEAN_SUB_TOOLS as readonly ToolId[]).includes(state.tool as ToolId)
    ? state.tool
    : ('booleanUnion' as ToolId);

  const shapeItems: MenuEntry[] = SHAPE_SUB_TOOLS.map((id) => ({
    id,
    label: TOOL_LABELS[id] ?? id,
    onAction: () => {
      setTool(id);
      setShapeMenuPos(null);
    },
  }));

  const booleanItems: MenuEntry[] = BOOLEAN_SUB_TOOLS.map((id) => ({
    id,
    label: TOOL_LABELS[id] ?? id,
    onAction: () => {
      const op = BOOLEAN_OP_MAP[id];
      if (op) {
        booleanOp(op);
        setTool('select');
      }
      setBooleanMenuPos(null);
    },
  }));

  return (
    <>
      <div className="floating-toolbar">
        <Toolbar label="Drawing tools">
          <Tooltip label={TOOL_LABELS[currentShape] ?? currentShape}>
            <button
              type="button"
              className={`floating-toolbar__btn${state.tool === currentShape ? ' floating-toolbar__btn--active' : ''} floating-toolbar__btn--group-start`}
              aria-pressed={state.tool === currentShape}
              aria-label={TOOL_LABELS[currentShape] ?? currentShape}
              onClick={() => setTool(currentShape)}
            >
              <Icon name={TOOL_ICONS[currentShape] ?? 'MousePointer2'} size={16} />
            </button>
          </Tooltip>
          <button
            type="button"
            className="floating-toolbar__chevron"
            aria-label="Shapes menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              if (shapeMenuPos) {
                setShapeMenuPos(null);
                return;
              }
              setShapeMenuPos({ x: r.left, y: r.top });
            }}
          >
            <Icon name="ChevronDown" size={12} />
          </button>
          {INDIVIDUAL_TOOLS.map((t) => (
            <ToolButton key={t.id} id={t.id} groupStart={t.groupStart} />
          ))}
          <Tooltip label={TOOL_LABELS[currentBoolean] ?? currentBoolean}>
            <button
              type="button"
              className={`floating-toolbar__btn${state.tool === currentBoolean ? ' floating-toolbar__btn--active' : ''} floating-toolbar__btn--group-start`}
              aria-pressed={state.tool === currentBoolean}
              aria-label={TOOL_LABELS[currentBoolean] ?? currentBoolean}
              onClick={() => {
                const op = BOOLEAN_OP_MAP[currentBoolean];
                if (op) {
                  booleanOp(op);
                  setTool('select');
                }
              }}
            >
              <Icon name={TOOL_ICONS[currentBoolean] ?? 'MousePointer2'} size={16} />
            </button>
          </Tooltip>
          <button
            type="button"
            className="floating-toolbar__chevron"
            aria-label="Boolean operations menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              if (booleanMenuPos) {
                setBooleanMenuPos(null);
                return;
              }
              setBooleanMenuPos({ x: r.left, y: r.top });
            }}
          >
            <Icon name="ChevronDown" size={12} />
          </button>
        </Toolbar>
      </div>
      <ContextMenu
        items={shapeItems}
        position={shapeMenuPos}
        onClose={() => setShapeMenuPos(null)}
        label="Shapes"
      />
      <ContextMenu
        items={booleanItems}
        position={booleanMenuPos}
        onClose={() => setBooleanMenuPos(null)}
        label="Boolean operations"
      />
    </>
  );
}
