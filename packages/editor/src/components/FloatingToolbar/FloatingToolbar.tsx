import type { BooleanOpKind } from '@varve/scene';
import type { IconName, MenuEntry } from '@varve/ui';
import { ContextMenu, Icon, TOOL_ICONS, Toolbar, Tooltip, TooltipProvider } from '@varve/ui';
import { useState } from 'react';
import { type ToolId, useEditor } from '../../context';
import { toolShortcutLabel } from '../../shortcuts';
import { useEffectiveWorkspaceConfig } from '../../workspace/useWorkspaceConfig';
import { ToolOptionsPopover } from './ToolOptionsPopover';
import './FloatingToolbar.css';
import { toolLabel } from '../../workspace/toolLabels';

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

/** Tools hidden in structured-layout modes (Print, Design): raster painting
 *  and photo retouching aren't part of page-layout or UI-component work —
 *  those live in Drawing and Image Editing mode respectively. */
const STRUCTURED_MODE_HIDDEN_TOOLS = new Set<ToolId>([
  'paint',
  'eraser',
  'cloneStamp',
  'healBrush',
  'spotHeal',
  'patch',
  'pencil',
  'smudge',
]);

/** Tools hidden in Image Editing mode: artboard creation isn't relevant when
 *  editing an existing photo (retouch/mask tools stay — see INDIVIDUAL_TOOLS). */
const IMAGE_HIDDEN_TOOLS = new Set<ToolId>(['frame']);

/** Tools for the drawing toolbar subset (painting tools at front). */
const DRAWING_TOOLS: { id: ToolId; groupStart?: boolean }[] = [
  { id: 'paint', groupStart: true },
  { id: 'eraser' },
  { id: 'smudge' },
  { id: 'pen', groupStart: true },
  { id: 'pencil' },
  { id: 'line' },
  { id: 'arrow' },
  { id: 'select', groupStart: true },
  { id: 'lasso' },
  { id: 'hand' },
  { id: 'zoom' },
  { id: 'text' },
  { id: 'eyedropper' },
  { id: 'frame' },
  { id: 'table' },
  { id: 'warp' },
  { id: 'sam2Segment', groupStart: true },
];

const INDIVIDUAL_TOOLS: { id: ToolId; groupStart?: boolean }[] = [
  { id: 'table', groupStart: true },
  { id: 'line' },
  { id: 'arrow' },
  { id: 'text' },
  { id: 'pen', groupStart: true },
  { id: 'pencil' },
  { id: 'frame' },
  { id: 'select', groupStart: true },
  { id: 'lasso' },
  { id: 'hand' },
  { id: 'zoom' },
  { id: 'slice' },
  { id: 'eyedropper' },
  { id: 'scale' },
  { id: 'inspect' },
  { id: 'warp' },
  { id: 'sam2Segment', groupStart: true },
  { id: 'crop', groupStart: true },
  { id: 'paint', groupStart: true },
  { id: 'eraser' },
  { id: 'smudge' },
  { id: 'cloneStamp', groupStart: true },
  { id: 'healBrush' },
  { id: 'spotHeal' },
  { id: 'patch' },
];

interface ToolButtonProps {
  id: ToolId;
  groupStart?: boolean;
}

function iconName(id: string): IconName {
  return ((TOOL_ICONS as Record<string, string>)[id] ?? 'MousePointer2') as IconName;
}

function ToolButton({ id, groupStart }: ToolButtonProps) {
  const { state, setTool } = useEditor();
  const label = toolLabel(id);
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
  const {
    state,
    setTool,
    booleanOp,
    selectedNodes,
    workspaceMode,
    setTouchMultiSelect,
    openCreateTableFromDataDialog,
  } = useEditor();
  const [shapeMenuPos, setShapeMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [booleanMenuPos, setBooleanMenuPos] = useState<{ x: number; y: number } | null>(null);
  const canBoolean = selectedNodes().filter((n) => n.kind === 'shape').length >= 2;

  // Resolve through the effective config, not the raw WORKSPACE_CONFIGS map:
  // that map has no entry for an unrecognized mode, so a stale persisted or
  // future mode id silently removed the entire toolbar. The resolver falls
  // back to Design and merges the user's overrides.
  const config = useEffectiveWorkspaceConfig(workspaceMode);
  if (!config.floatingToolbar) return null;

  const currentBoolean = (BOOLEAN_SUB_TOOLS as readonly ToolId[]).includes(state.tool as ToolId)
    ? state.tool
    : ('booleanUnion' as ToolId);
  const isDrawingMode = workspaceMode === 'drawing';
  const isPrintMode = workspaceMode === 'print';
  const isImageMode = workspaceMode === 'image';
  const isDesignMode = workspaceMode === 'design';
  const activeTools = isDrawingMode ? DRAWING_TOOLS : INDIVIDUAL_TOOLS;
  const configuredTools = new Map(config.toolbar.tools.map((tool) => [tool.toolId, tool]));
  const filteredTools = activeTools
    .filter((t) => {
      if (!configuredTools.has(t.id)) return false;
      if ((isPrintMode || isDesignMode) && STRUCTURED_MODE_HIDDEN_TOOLS.has(t.id)) return false;
      if (isImageMode && IMAGE_HIDDEN_TOOLS.has(t.id)) return false;
      return true;
    })
    .map((tool) => ({
      ...tool,
      groupStart: configuredTools.get(tool.id)?.groupStart ?? tool.groupStart,
    }));
  const visibleShapeTools = SHAPE_SUB_TOOLS.filter((id) => configuredTools.has(id));
  const currentShape = (visibleShapeTools as readonly ToolId[]).includes(state.tool as ToolId)
    ? state.tool
    : (visibleShapeTools[0] ?? ('rect' as ToolId));
  const showBooleanTools =
    config.toolbar.flyouts?.some((flyout) => flyout.id === 'boolean') ?? false;

  const shapeItems: MenuEntry[] = visibleShapeTools.map((id) => ({
    id,
    label: toolLabel(id),
    onAction: () => {
      setTool(id);
      setShapeMenuPos(null);
    },
  }));

  const booleanItems: MenuEntry[] = BOOLEAN_SUB_TOOLS.map((id) => ({
    id,
    label: toolLabel(id),
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
            {state.tool === 'table' && (
              <button
                type="button"
                className="floating-toolbar__btn floating-toolbar__btn--group-start"
                aria-label="Table from data"
                title="Create a table from pasted spreadsheet data"
                data-tool="tableFromData"
                onClick={() => openCreateTableFromDataDialog?.()}
              >
                <Icon name="FileSpreadsheet" size={16} />
              </button>
            )}
            {visibleShapeTools.length > 0 && (
              <>
                <Tooltip label={toolLabel(currentShape)}>
                  <button
                    type="button"
                    className={`floating-toolbar__btn${state.tool === currentShape ? ' floating-toolbar__btn--active' : ''} floating-toolbar__btn--group-start`}
                    aria-pressed={state.tool === currentShape}
                    aria-label={toolLabel(currentShape)}
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
              </>
            )}
            {filteredTools.map((t) => (
              <ToolButton key={t.id} id={t.id} groupStart={t.groupStart} />
            ))}
            {showBooleanTools && (
              <>
                <Tooltip
                  label={canBoolean ? toolLabel(currentBoolean) : 'Select 2+ shapes for boolean'}
                  disabledReason={!canBoolean ? 'Select 2+ shapes for boolean' : undefined}
                >
                  <button
                    type="button"
                    className="floating-toolbar__btn floating-toolbar__btn--group-start"
                    aria-pressed={false}
                    aria-label={toolLabel(currentBoolean)}
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
