import { type BooleanOpKind, isBooleanOperand } from '@varve/scene';
import type { IconName, MenuEntry } from '@varve/ui';
import { ContextMenu, Icon, Toolbar, Tooltip, TooltipProvider } from '@varve/ui';
import { useMemo, useState } from 'react';
import { type ToolId, useEditor } from '../../context';
import { toolShortcutLabel } from '../../shortcuts';
import { getToolDefinition } from '../../tools/toolRegistry';
import {
  composeToolbar,
  getToolbarSlotToolIds,
  type ToolbarFlyoutSlot,
  type ToolbarGroup,
  type ToolbarSlot,
} from '../../workspace/toolbarComposition';
import { useEffectiveWorkspaceConfig } from '../../workspace/useWorkspaceConfig';
import { ToolOptionsPopover } from './ToolOptionsPopover';
import './FloatingToolbar.css';
import { toolIconName, toolLabel } from '../../workspace/toolLabels';
import { useToolbarOverflow } from './useToolbarOverflow';

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
const RESPONSIVE_MORE_ID = 'responsive-more-tools';
interface ToolButtonProps {
  id: ToolId;
  groupStart?: boolean;
}

function iconName(id: string): IconName {
  return toolIconName(id as ToolId);
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

interface ToolbarSlotViewProps {
  slot: ToolbarSlot;
  activeTool: ToolId;
  canBoolean: boolean;
  onActivate: (flyoutId: string, toolId: ToolId) => void;
  onToggleMenu: (id: string, rect: DOMRect) => void;
}

function ToolbarSlotView({
  slot,
  activeTool,
  canBoolean,
  onActivate,
  onToggleMenu,
}: ToolbarSlotViewProps) {
  if (slot.kind === 'tool') {
    return <ToolButton id={slot.toolId} groupStart={slot.groupStart} />;
  }

  const isAction = slot.id === ACTION_FLYOUT_ID;
  // The primary button shows the active member when one is active, so the
  // toolbar reflects the current tool rather than resetting to the first
  // member on every render.
  const current = slot.tools.includes(activeTool) ? activeTool : slot.tools[0];
  if (!current) return null;

  return (
    <FlyoutButton
      slot={slot}
      current={current}
      pressed={!isAction && activeTool === current}
      disabledReason={
        isAction && !canBoolean ? 'Select 2+ closed, unlocked vector shapes' : undefined
      }
      onActivate={(toolId) => onActivate(slot.id, toolId)}
      onToggleMenu={(rect) => onToggleMenu(slot.id, rect)}
    />
  );
}

function categoryLabel(category: string): string {
  if (category === 'ai') return 'AI-assisted';
  return category.replace(/^./, (letter) => letter.toUpperCase());
}

function getOverflowMenuItems(
  groups: ToolbarGroup[],
  canBoolean: boolean,
  onActivate: (flyoutId: string, toolId: ToolId) => void,
  onClose: () => void,
): MenuEntry[] {
  const byCategory = new Map<string, MenuEntry[]>();

  for (const group of groups) {
    for (const slot of group.slots) {
      const sourceId = slot.kind === 'flyout' ? slot.id : 'tool';
      for (const toolId of getToolbarSlotToolIds(slot)) {
        const category = getToolDefinition(toolId)?.category ?? 'other';
        const entries = byCategory.get(category) ?? [];
        entries.push({
          id: `${RESPONSIVE_MORE_ID}-${sourceId}-${toolId}`,
          label: toolLabel(toolId),
          disabled: sourceId === ACTION_FLYOUT_ID && !canBoolean,
          onAction: () => {
            onActivate(sourceId, toolId);
            onClose();
          },
        });
        byCategory.set(category, entries);
      }
    }
  }

  return [...byCategory].map(([category, submenu]) => ({
    id: `${RESPONSIVE_MORE_ID}-${category}`,
    label: categoryLabel(category),
    submenu,
    type: 'submenu' as const,
  }));
}

interface MoreToolsButtonProps {
  expanded: boolean;
  onToggle: (rect: DOMRect) => void;
}

function MoreToolsButton({ expanded, onToggle }: MoreToolsButtonProps) {
  return (
    <Tooltip label="More tools">
      <button
        type="button"
        className="floating-toolbar__btn floating-toolbar__more"
        aria-label="More tools"
        aria-haspopup="menu"
        aria-expanded={expanded}
        data-testid="toolbar-more-tools"
        onClick={(event) => onToggle(event.currentTarget.getBoundingClientRect())}
      >
        <Icon name="Ellipsis" size={16} />
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
  const [openMenu, setOpenMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const booleanSelection = selectedNodes();
  const canBoolean = booleanSelection.length >= 2 && booleanSelection.every(isBooleanOperand);

  // Resolve through the effective config, not the raw WORKSPACE_CONFIGS map:
  // that map has no entry for an unrecognized mode, so a stale persisted or
  // future mode id silently removed the entire toolbar. The resolver falls
  // back to Design and merges the user's overrides.
  const config = useEffectiveWorkspaceConfig(workspaceMode);
  // Keep composition and responsive grouping derived from the same effective
  // config. The hook intentionally runs before the early returns so switching
  // into/out of a modal tool cannot change hook ordering.
  const slots = useMemo(() => composeToolbar(config.toolbar), [config.toolbar]);
  const { rootRef, visibleGroups, collapsedGroups } = useToolbarOverflow(
    slots,
    state.tool as ToolId,
  );
  if (!config.floatingToolbar) return null;
  // Modal image-edit tools provide their own focused handles and completion
  // actions. Keeping the global palette mounted here would cover the lower
  // perspective corners and steal pointer input from the active transform.
  if (state.tool === 'perspective') return null;
  if (state.tool === 'crop') {
    // CropOverlay owns the handles, but crop-specific actions (Protect Faces,
    // trim, and bounds reset) still need a reachable options entry point.
    // The old early return removed ToolOptionsPopover together with the main
    // palette, leaving those actions inaccessible in crop mode.
    return (
      <div className="floating-toolbar floating-toolbar--modal-options">
        <ToolOptionsPopover />
      </div>
    );
  }

  const isDrawingMode = workspaceMode === 'drawing';

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
  const isMoreToolsOpen = openMenu?.id === RESPONSIVE_MORE_ID;
  const overflowMenuItems = getOverflowMenuItems(collapsedGroups, canBoolean, activate, () =>
    setOpenMenu(null),
  );
  const contextMenuItems = isMoreToolsOpen ? overflowMenuItems : menuItems;
  const contextMenuLabel = isMoreToolsOpen ? 'More tools' : (openFlyout?.label ?? '');

  return (
    <>
      <div ref={rootRef} className="floating-toolbar" data-testid="toolbar">
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
            {collapsedGroups.length > 0 && (
              <MoreToolsButton
                expanded={isMoreToolsOpen}
                onToggle={(rect) =>
                  setOpenMenu((prev) =>
                    prev?.id === RESPONSIVE_MORE_ID
                      ? null
                      : { id: RESPONSIVE_MORE_ID, x: rect.left, y: rect.top },
                  )
                }
              />
            )}
            {visibleGroups.map((group) =>
              group.slots.map((slot) => (
                <ToolbarSlotView
                  key={slot.kind === 'tool' ? slot.toolId : slot.id}
                  slot={slot}
                  activeTool={state.tool as ToolId}
                  canBoolean={canBoolean}
                  onActivate={activate}
                  onToggleMenu={(id, rect) =>
                    setOpenMenu((prev) =>
                      prev?.id === id ? null : { id, x: rect.left, y: rect.top },
                    )
                  }
                />
              )),
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
        items={contextMenuItems}
        // Guard on the resolved flyout, not just the stored id: a workspace
        // switch or customization can remove the open flyout, and an empty
        // popup would otherwise linger at the last position.
        position={
          (openFlyout || isMoreToolsOpen) && openMenu ? { x: openMenu.x, y: openMenu.y } : null
        }
        onClose={() => setOpenMenu(null)}
        label={contextMenuLabel}
      />
    </>
  );
}
