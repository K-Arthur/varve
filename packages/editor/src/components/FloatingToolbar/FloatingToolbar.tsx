import type { BooleanOpKind } from '@strata/scene';
import type { IconName, MenuEntry } from '@strata/ui';
import { ContextMenu, Icon, TOOL_ICONS, Toolbar, Tooltip, TooltipProvider } from '@strata/ui';
import { useState } from 'react';
import { type ToolId, useEditor } from '../../context';
import { toolShortcutLabel } from '../../shortcuts';
import { WORKSPACE_CONFIGS } from '../../workspace/workspaceTypes';
import { ToolOptionsPopover } from './ToolOptionsPopover';
import './FloatingToolbar.css';

const TOUCH_MULTISELECT_ACTIVE_CLASS = 'floating-toolbar__touch-multi--active';

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
  paint: 'Paint Brush',
  eraser: 'Eraser',
  cloneStamp: 'Clone Stamp',
  healBrush: 'Healing Brush',
  spotHeal: 'Spot Heal',
  patch: 'Patch Tool',
  smudge: 'Smudge',
  sam2Segment: 'Select Subject',
  lasso: 'Lasso',
};

interface ToolButtonProps {
  id: ToolId;
  groupStart?: boolean;
}

function iconName(id: string): IconName {
  return ((TOOL_ICONS as Record<string, string>)[id] ?? 'MousePointer2') as IconName;
}

function ToolButton({ id, groupStart }: ToolButtonProps) {
  const { state, setTool } = useEditor();
  const label = TOOL_LABELS[id] ?? id;
  const shortcut = toolShortcutLabel(id);
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        className={`floating-toolbar__btn${state.tool === id ? ' floating-toolbar__btn--active' : ''}${groupStart ? ' floating-toolbar__btn--group-start' : ''}`}
        aria-pressed={state.tool === id}
        aria-label={label}
        data-tool={id}
        onClick={() => setTool(id)}
      >
        <Icon name={iconName(id)} size={16} />
      </button>
    </Tooltip>
  );
}

function rgbToHex(rgba: [number, number, number, number]): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rgba[0])}${toHex(rgba[1])}${toHex(rgba[2])}`;
}

function hexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return [r, g, b, 255];
}

function DrawingToolbarControls() {
  const { state, setBrushSetting, setForegroundColor, setBackgroundColor, swapColors } =
    useEditor();

  const fgHex = rgbToHex(state.foregroundColor);
  const bgHex = rgbToHex(state.backgroundColor);

  return (
    <div className="floating-toolbar__drawing">
      <span className="floating-toolbar__drawing-label">Size</span>
      <input
        type="range"
        className="floating-toolbar__drawing-slider"
        min={1}
        max={200}
        value={state.brushSettings.radius}
        onChange={(e) => setBrushSetting('radius', Number(e.target.value))}
        aria-label="Brush size"
        aria-valuetext={`${state.brushSettings.radius}px`}
      />
      <span className="floating-toolbar__drawing-label">Op</span>
      <input
        type="range"
        className="floating-toolbar__drawing-slider"
        min={0}
        max={100}
        value={Math.round(state.brushSettings.opacity * 100)}
        onChange={(e) => setBrushSetting('opacity', Number(e.target.value) / 100)}
        aria-label="Opacity"
        aria-valuetext={`${Math.round(state.brushSettings.opacity * 100)}%`}
      />
      <div className="floating-toolbar__colors">
        <label className="floating-toolbar__color-swatch">
          <input
            type="color"
            value={fgHex}
            onChange={(e) => setForegroundColor(hexToRgba(e.target.value))}
            aria-label="Foreground color"
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
          />
          <span
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              background: fgHex,
              border: 'var(--border-micro)',
              cursor: 'pointer',
            }}
          />
        </label>
        <Tooltip label="Swap colors">
          <button
            type="button"
            className="floating-toolbar__color-swap"
            onClick={swapColors}
            aria-label="Swap colors"
          >
            <Icon name="ArrowDownUp" size={12} />
          </button>
        </Tooltip>
        <label className="floating-toolbar__color-swatch">
          <input
            type="color"
            value={bgHex}
            onChange={(e) => setBackgroundColor(hexToRgba(e.target.value))}
            aria-label="Background color"
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
          />
          <span
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              background: bgHex,
              border: 'var(--border-micro)',
              cursor: 'pointer',
            }}
          />
        </label>
      </div>
    </div>
  );
}

export function FloatingToolbar() {
  const { state, setTool, booleanOp, selectedNodes, workspaceMode, setTouchMultiSelect } =
    useEditor();
  const [shapeMenuPos, setShapeMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [booleanMenuPos, setBooleanMenuPos] = useState<{ x: number; y: number } | null>(null);
  const canBoolean = selectedNodes().filter((n) => n.kind === 'shape').length >= 2;

  const config = WORKSPACE_CONFIGS[workspaceMode];
  if (!config?.floatingToolbar) return null;

  const currentShape = (SHAPE_SUB_TOOLS as readonly ToolId[]).includes(state.tool as ToolId)
    ? state.tool
    : ('rect' as ToolId);
  const currentBoolean = (BOOLEAN_SUB_TOOLS as readonly ToolId[]).includes(state.tool as ToolId)
    ? state.tool
    : ('booleanUnion' as ToolId);
  const isDrawingMode = workspaceMode === 'drawing';
  // Use workspace config as the source of truth for which tools to show
  const filteredTools = config.toolbar.tools;

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
      <div className="floating-toolbar" data-testid="toolbar">
        <TooltipProvider>
          <Toolbar label="Drawing tools">
            <Tooltip label={TOOL_LABELS[currentShape] ?? currentShape}>
              <button
                type="button"
                className={`floating-toolbar__btn${state.tool === currentShape ? ' floating-toolbar__btn--active' : ''} floating-toolbar__btn--group-start`}
                aria-pressed={state.tool === currentShape}
                aria-label={TOOL_LABELS[currentShape] ?? currentShape}
                data-tool={currentShape}
                onClick={() => setTool(currentShape)}
              >
                <Icon name={iconName(currentShape)} size={16} />
              </button>
            </Tooltip>
            <Tooltip label="Shapes menu">
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
            </Tooltip>
            {filteredTools.map((t) => (
              <ToolButton key={t.toolId} id={t.toolId} groupStart={t.groupStart} />
            ))}
            {workspaceMode !== 'drawing' && workspaceMode !== 'image' && (
              <>
                <Tooltip
                  label={
                    canBoolean
                      ? (TOOL_LABELS[currentBoolean] ?? currentBoolean)
                      : 'Select 2+ shapes for boolean'
                  }
                  disabledReason={!canBoolean ? 'Select 2+ shapes for boolean' : undefined}
                >
                  <button
                    type="button"
                    className="floating-toolbar__btn floating-toolbar__btn--group-start"
                    aria-pressed={false}
                    aria-label={TOOL_LABELS[currentBoolean] ?? currentBoolean}
                    data-tool={currentBoolean}
                    aria-disabled={!canBoolean || undefined}
                    onClick={() => {
                      const op = BOOLEAN_OP_MAP[currentBoolean];
                      if (op && canBoolean) {
                        booleanOp(op);
                        setTool('select');
                      }
                    }}
                  >
                    <Icon name={iconName(currentBoolean)} size={16} />
                  </button>
                </Tooltip>
                <Tooltip
                  label="Boolean operations menu"
                  disabledReason={!canBoolean ? 'Select 2+ shapes for boolean' : undefined}
                >
                  <button
                    type="button"
                    className="floating-toolbar__chevron"
                    aria-label="Boolean operations menu"
                    disabled={!canBoolean}
                    onClick={(e) => {
                      if (!canBoolean) return;
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
                </Tooltip>
              </>
            )}
            <ToolOptionsPopover />
            <Tooltip
              label={
                state.touchMultiSelect.active
                  ? 'Multi-select active (tap to toggle)'
                  : 'Touch multi-select'
              }
            >
              <button
                type="button"
                className={`floating-toolbar__btn floating-toolbar__touch-multi${state.touchMultiSelect.active ? ` ${TOUCH_MULTISELECT_ACTIVE_CLASS}` : ''}`}
                aria-pressed={state.touchMultiSelect.active}
                aria-label={
                  state.touchMultiSelect.active
                    ? 'Disable touch multi-select'
                    : 'Enable touch multi-select'
                }
                data-testid="touch-multiselect-toggle"
                onClick={() => setTouchMultiSelect(!state.touchMultiSelect.active)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  <path d="M21 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  <path d="M15 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  <line x1="9" y1="5" x2="15" y2="19" />
                  <line x1="21" y1="5" x2="15" y2="19" />
                </svg>
              </button>
            </Tooltip>
          </Toolbar>
        </TooltipProvider>
        {isDrawingMode && <DrawingToolbarControls />}
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
