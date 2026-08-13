import type { BooleanOpKind } from '@varve/scene';
import type { IconName, MenuEntry } from '@varve/ui';
import { ContextMenu, Icon, TOOL_ICONS, Toolbar, Tooltip, TooltipProvider } from '@varve/ui';
import { useState } from 'react';
import { type ToolId, useEditor } from '../../context';
import { toolShortcutLabel } from '../../shortcuts';
import { composeToolbar, type ToolbarFlyoutSlot } from '../../workspace/toolbarComposition';
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

/** Flyouts whose members are commands applied to the selection rather than
 *  tools that become active. Boolean operations need 2+ selected shapes. */
const ACTION_FLYOUT_ID = 'boolean';

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

interface FlyoutButtonProps {
  slot: ToolbarFlyoutSlot;
  /** Tool id shown on the primary button. */
  current: ToolId;
  /** Whether the primary button reflects the active tool. */
  pressed: boolean;
  disabledReason?: string;
  onActivate: (toolId: ToolId) => void;
  onToggleMenu: (rect: DOMRect) => void;
}

/**
 * A grouped tool: a primary button for the current member plus a chevron that
 * opens the member menu. Replaces the previously hard-coded shape and boolean
 * groups so every workspace's declared flyouts render the same way.
 */
function FlyoutButton({
  slot,
  current,
  pressed,
  disabledReason,
  onActivate,
  onToggleMenu,
}: FlyoutButtonProps) {
  const disabled = disabledReason !== undefined;
  return (
    <>
      <Tooltip
        label={disabled ? disabledReason : toolLabel(current)}
        disabledReason={disabledReason}
      >
        <button
          type="button"
          className={`floating-toolbar__btn${pressed ? ' floating-toolbar__btn--active' : ''}${slot.groupStart ? ' floating-toolbar__btn--group-start' : ''}`}
          aria-pressed={pressed}
          aria-label={toolLabel(current)}
          data-tool={current}
          aria-disabled={disabled || undefined}
          onClick={() => {
            if (!disabled) onActivate(current);
          }}
        >
          <Icon name={iconName(current)} size={16} />
        </button>
      </Tooltip>
      <Tooltip label={`${slot.label} menu`} disabledReason={disabledReason}>
        <button
          type="button"
          className="floating-toolbar__chevron"
          aria-label={`${slot.label} menu`}
          disabled={disabled}
          onClick={(e) => {
            if (disabled) return;
            onToggleMenu(e.currentTarget.getBoundingClientRect());
          }}
        >
          <Icon name="ChevronDown" size={12} />
        </button>
      </Tooltip>
    </>
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
  const [openMenu, setOpenMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const canBoolean = selectedNodes().filter((n) => n.kind === 'shape').length >= 2;

  // Resolve through the effective config, not the raw WORKSPACE_CONFIGS map:
  // that map has no entry for an unrecognized mode, so a stale persisted or
  // future mode id silently removed the entire toolbar. The resolver falls
  // back to Design and merges the user's overrides.
  const config = useEffectiveWorkspaceConfig(workspaceMode);
  if (!config.floatingToolbar) return null;

  const isDrawingMode = workspaceMode === 'drawing';
  // Order, grouping and flyout membership all come from the workspace config.
  // The toolbar owns no tool list of its own — see `toolbarComposition.ts`.
  const slots = composeToolbar(config.toolbar);

  /** Apply a boolean flyout member as a command; select any other member. */
  const activate = (flyoutId: string, toolId: ToolId) => {
    if (flyoutId === ACTION_FLYOUT_ID) {
      const op = BOOLEAN_OP_MAP[toolId];
      if (op && canBoolean) {
        booleanOp(op);
        setTool('select');
      }
      return;
    }
    setTool(toolId);
  };

  const openFlyout = slots.find(
    (slot): slot is ToolbarFlyoutSlot => slot.kind === 'flyout' && slot.id === openMenu?.id,
  );
  const menuItems: MenuEntry[] = (openFlyout?.tools ?? []).map((id) => ({
    id,
    label: toolLabel(id),
    onAction: () => {
      if (openFlyout) activate(openFlyout.id, id);
      setOpenMenu(null);
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
            {slots.map((slot) => {
              if (slot.kind === 'tool') {
                return (
                  <ToolButton key={slot.toolId} id={slot.toolId} groupStart={slot.groupStart} />
                );
              }
              const isAction = slot.id === ACTION_FLYOUT_ID;
              // The primary button shows the active member when one is active,
              // so the toolbar reflects the current tool rather than resetting
              // to the first member on every render.
              const current = slot.tools.includes(state.tool as ToolId)
                ? (state.tool as ToolId)
                : slot.tools[0];
              if (!current) return null;
              return (
                <FlyoutButton
                  key={slot.id}
                  slot={slot}
                  current={current}
                  pressed={!isAction && state.tool === current}
                  disabledReason={
                    isAction && !canBoolean ? 'Select 2+ shapes for boolean' : undefined
                  }
                  onActivate={(toolId) => activate(slot.id, toolId)}
                  onToggleMenu={(rect) =>
                    setOpenMenu((prev) =>
                      prev?.id === slot.id ? null : { id: slot.id, x: rect.left, y: rect.top },
                    )
                  }
                />
              );
            })}
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
        items={menuItems}
        // Guard on the resolved flyout, not just the stored id: a workspace
        // switch or customization can remove the open flyout, and an empty
        // popup would otherwise linger at the last position.
        position={openFlyout && openMenu ? { x: openMenu.x, y: openMenu.y } : null}
        onClose={() => setOpenMenu(null)}
        label={openFlyout?.label ?? ''}
      />
    </>
  );
}
