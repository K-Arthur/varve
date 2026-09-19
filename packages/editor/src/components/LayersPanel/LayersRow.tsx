/**
 * LayersRow — a single treeitem in the layers tree view.
 *
 * Displays: disclosure triangle (if container), indent guide, type icon, name
 * (with inline rename), instance badge, visibility and lock toggles.
 *
 * Research basis: APG Tree View (role=treeitem), type icons per Lucide icon maps.
 */

import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import type {
  AdjustmentNode,
  Document,
  EffectStackKind,
  EffectStackTransferMode,
  InstanceStatus,
  NodeId,
  SceneNode,
} from '@varve/scene';
import {
  activeSmartFilters,
  canReceiveEffectStack,
  documentHasSolo,
  isAnimatedMediaNode,
  isContainer,
  isImageShape,
  nodeHasStyle,
} from '@varve/scene';
import { SOLID_CHROME_ICONS, SolidIcon, Tooltip } from '@varve/ui';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoName } from '../../intelligence/autoNamer';
import {
  hidingAncestorOf,
  isNodeEffectivelyHidden,
  isNodeEffectivelyLocked,
} from '../../scene/world';
import type { LayersBadgeGroup } from '../../workspace/workspaceTypes';
import { summarizeAdjustmentStack } from './adjustmentStackSummary';
import { EffectStackTransferBadge } from './EffectStackTransferBadge';
import {
  layerAccessibleDescription,
  maskTypeLabel,
  resolveLayerPresentation,
} from './layerPresentation';
import type { PresenceData } from './PresenceIndicator';
import { PresenceIndicator } from './PresenceIndicator';
import { useThumbnail } from './useThumbnail';

export interface LayersRowProps {
  node: SceneNode;
  depth: number;
  selected: boolean;
  selectionPreview?: boolean;
  focused: boolean;
  expanded: boolean;
  editing: boolean;
  onToggleExpand: (id: NodeId) => void;
  onExpandSubtree?: (id: NodeId) => void;
  onCollapseSubtree?: (id: NodeId) => void;
  onExpandToDepth1?: (id: NodeId) => void;
  onSelect: (id: NodeId, shift: boolean, ctrl: boolean) => void;
  /** Commit a new name for the row. */
  onRename: (id: NodeId, name: string) => void;
  /** Enter inline edit mode for the row. */
  onRenameStart: (id: NodeId) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameCycle?: (direction: 'next' | 'previous') => void;
  /** Fires when the type icon is double-clicked (zoom-to-layer). */
  onDoubleClickIcon?: (id: NodeId) => void;
  onToggleVisibility: (id: NodeId) => void;
  onToggleLock: (id: NodeId) => void;
  onToggleSolo?: (id: NodeId) => void;
  onFocus: (idx: number) => void;
  idx: number;
  /** Total visible rows (for aria-setsize on virtualized trees). */
  totalRows: number;
  /** 1-based position among the row's logical siblings. */
  siblingIndex?: number;
  /** Number of logical siblings represented by the current filter/tree view. */
  siblingCount?: number;
  style?: React.CSSProperties;
  dragHandleRef?: (element: HTMLElement | null) => void;
  dragHandleListeners?: DraggableSyntheticListeners;
  dragHandleAttributes?: DraggableAttributes;
  onSelectionPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onSelectionClick?: () => boolean;
  /** Optional resolved variant name for component instances. */
  variantName?: string;
  /** Whether this node has animation keyframes in any timeline. */
  hasMotion?: boolean;
  /** Number of keyframes across all timelines for this node. */
  keyframeCount?: number;
  /** Sync status for component instances. */
  syncStatus?: InstanceStatus;
  /** Other users currently present on this node (collaborative editing). */
  presences?: PresenceData[];
  /** Owning document id — scopes the thumbnail cache so nodes with the same
   * id in different open documents (ids are per-document counters starting
   * at `n1`) never share a cached thumbnail. */
  docId?: string;
  /** Document used to compute auto-name suggestions while renaming. */
  doc?: Document;
  /** Relationship to the direct parent's structural mask, when applicable. */
  maskRole?: 'source' | 'content';
  /** Full selection set — used to compute mixed visibility/lock state for toggles. */
  selectedIds?: Set<NodeId>;
  /** Copy a source stack to the layer-tree's currently selected destinations. */
  onCopyEffectStack?: (
    sourceId: NodeId,
    kind: EffectStackKind,
    mode?: EffectStackTransferMode,
  ) => void;
  /** Open the selected layer's matching editor in the Inspector. */
  onOpenEffectStack?: (id: NodeId, kind: EffectStackKind) => void;
  /** Open an adjustment layer's stack editor in the Inspector. */
  onOpenAdjustment?: (id: NodeId) => void;
  /** Stack drag currently hovering this row, if any. */
  effectStackDrop?: {
    sourceId: NodeId;
    kind: EffectStackKind;
    mode: EffectStackTransferMode;
  };
  /** True when the current layer filter matches this row by name. */
  searchMatch?: boolean;
  /**
   * Badge groups the active workspace pins. Groups not listed here are
   * revealed on row hover/focus (CSS-only) and always remain in the row's
   * accessible name. Absent means "pin everything" so isolated row renders
   * (tests, Storybook) keep their previous behaviour.
   */
  pinnedBadgeGroups?: readonly LayersBadgeGroup[];
  /** Whether the solo control is pinned rather than hover/focus-revealed. */
  pinSolo?: boolean;
}

/** Deeper rows keep their real ARIA depth but stop indenting further, so the
 * row's content stays reachable at the panel's minimum width. */
const MAX_VISUAL_INDENT_DEPTH = 8;

export const LayersRow = memo(function LayersRow({
  node,
  depth,
  selected,
  selectionPreview = false,
  focused,
  expanded,
  editing,
  onToggleExpand,
  onExpandSubtree,
  onCollapseSubtree,
  onExpandToDepth1,
  onSelect,
  onRename,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onRenameCycle,
  onDoubleClickIcon,
  onToggleVisibility,
  onToggleLock,
  onToggleSolo,
  onFocus,
  idx,
  totalRows,
  siblingIndex,
  siblingCount,
  style,
  dragHandleRef,
  dragHandleListeners,
  dragHandleAttributes,
  onSelectionPointerDown,
  onSelectionClick,
  variantName,
  hasMotion,
  keyframeCount,
  syncStatus,
  presences,
  docId,
  doc,
  maskRole,
  selectedIds,
  onCopyEffectStack,
  onOpenEffectStack,
  onOpenAdjustment,
  effectStackDrop,
  searchMatch = false,
  pinnedBadgeGroups,
  pinSolo = true,
}: LayersRowProps) {
  const [editValue, setEditValue] = useState(node.name);
  // Workspace projection: badge groups the active workspace does not pin are
  // revealed on row hover/focus (CSS-only) and remain in the accessible name.
  // `undefined` pins every group, keeping isolated row renders (unit tests,
  // Storybook) behaviourally identical to the pre-projection panel.
  const badgeAttrs = (group: LayersBadgeGroup) =>
    ({
      'data-badge-group': group,
      'data-badge-pinned':
        pinnedBadgeGroups === undefined || pinnedBadgeGroups.includes(group) ? 'true' : 'false',
    }) as const;
  const inputRef = useRef<HTMLInputElement>(null);
  const ghostName = useMemo(() => (doc ? autoName(doc, node) : null), [doc, node]);
  const isFrame = node.kind === 'frame';
  const isGroup = node.kind === 'group';
  const isContainerNode = isContainer(node);
  const layerPresentation = resolveLayerPresentation(node, doc);
  const typeIcon = isGroup && expanded ? 'FolderOpen' : layerPresentation.icon;
  const thumbnailDataUrl = useThumbnail(node, docId, doc);
  // Only show a preview chip for real image content — solid-fill frame
  // thumbnails read as unexplained coloured squares next to the type icon.
  const showThumbnail = isImageShape(node) && thumbnailDataUrl != null;
  const isInstance = layerPresentation.category === 'instance';
  // An empty name (a real, if uncommon, document state — e.g. a cleared
  // rename, or certain import paths) previously rendered as literally
  // nothing: the row jumped straight from its type icon to badges, which
  // read as the badges having overwritten the name rather than there never
  // having been visible text at all. Fall back to the same auto-generated
  // name already used as the rename input's placeholder, so the row always
  // carries a visible, distinguishable identity.
  const hasRealName = node.name.trim() !== '';
  const displayName = hasRealName ? node.name : (ghostName ?? node.name);
  const maskLabel = maskTypeLabel(node.mask);
  // Workspace projections read from the document, never from node copies.
  const emailMeta = doc?.emailSemantics?.nodes?.[node.id];
  const isThreadedText = node.kind === 'text' && node.storyBinding?.storyId != null;
  const isEffectivelyLocked = doc ? isNodeEffectivelyLocked(doc, node.id) : node.locked;
  // Visibility inherits down: a child of a hidden group paints nothing even
  // though its own visible flag is still true. Distinguish that inherited
  // state from a directly hidden row (same model as effective lock).
  const isEffectivelyHidden = doc ? isNodeEffectivelyHidden(doc, node.id) : node.visible === false;
  const hiddenByAncestor = isEffectivelyHidden && node.visible !== false;
  const hidingAncestorId = hiddenByAncestor && doc ? hidingAncestorOf(doc, node.id) : null;
  const hidingAncestorName = hidingAncestorId ? doc?.nodes[hidingAncestorId]?.name : null;
  const canReceiveDroppedStack =
    effectStackDrop != null &&
    effectStackDrop.sourceId !== node.id &&
    !isEffectivelyLocked &&
    canReceiveEffectStack(node, effectStackDrop.kind);

  // Compute mixed visibility/lock state for multi-selection toggles.
  // When multiple nodes are selected, the toggle icon reflects whether ALL
  // selected nodes share the same state or whether it's mixed.
  const hasMultiSelection = selectedIds && selectedIds.size > 1;
  const isMixedVisibility = useMemo(() => {
    if (!hasMultiSelection || !selectedIds) return false;
    const vals = [...selectedIds].map((id) => {
      const n = doc?.nodes[id];
      if (!doc || !n) return true;
      return !isNodeEffectivelyHidden(doc, id);
    });
    return vals.some((v) => v !== vals[0]);
  }, [hasMultiSelection, selectedIds, doc]);
  const isMixedLocked = useMemo(() => {
    if (!hasMultiSelection || !selectedIds) return false;
    const vals = [...selectedIds].map((id) => {
      const n = doc?.nodes[id];
      return n ? (doc ? isNodeEffectivelyLocked(doc, id) : 'locked' in n && n.locked) : false;
    });
    return vals.some((v) => v !== vals[0]);
  }, [hasMultiSelection, selectedIds, doc]);

  // Blend mode / opacity badge
  const blendModeLabel =
    node.blendMode !== 'normal' && node.blendMode !== 'passThrough'
      ? node.blendMode.charAt(0).toUpperCase() + node.blendMode.slice(1)
      : null;
  const opacityLabel = node.opacity < 1 ? `${Math.round(node.opacity * 100)}%` : null;
  const badgeText =
    blendModeLabel || opacityLabel
      ? [blendModeLabel, opacityLabel].filter(Boolean).join(' ')
      : null;
  // Full wording for the tooltip and accessible name: the visible chip is
  // compact by necessity and may ellipsize on a narrow rail.
  const appearanceDetail =
    blendModeLabel || opacityLabel
      ? [
          blendModeLabel ? `Blend mode ${blendModeLabel}` : null,
          opacityLabel ? `Opacity ${opacityLabel}` : null,
        ]
          .filter(Boolean)
          .join(', ')
      : null;
  const objectFilterCount = node.smartFilters?.length ?? 0;
  const layerEffectCount =
    'effects' in node && Array.isArray(node.effects) ? node.effects.length : 0;
  // The stack-level bypass (smartFiltersEnabled) is renderer truth — derive
  // the enabled count through the canonical resolver so the badge can never
  // disagree with what sceneToEngine actually draws.
  const enabledObjectFilterCount = objectFilterCount > 0 ? activeSmartFilters(node).length : 0;
  const objectFilterSummary =
    objectFilterCount > 0 ? summarizeAdjustmentStack(node.smartFilters ?? []) : null;
  const adjustmentSummary =
    node.kind === 'adjustment'
      ? summarizeAdjustmentStack((node as AdjustmentNode).adjustments ?? [])
      : null;
  // An empty node.name would otherwise produce a leading ", " with no actual
  // identifying name for assistive technology — the same gap as the visible
  // label, so it gets the same auto-name fallback.
  const accessibleDescription = layerAccessibleDescription(
    hasRealName ? node : { ...node, name: displayName },
    layerPresentation,
    {
      maskRole,
      detail: [
        adjustmentSummary?.tooltip,
        // Restriction states in text, so a screen reader on the row learns
        // them without tabbing into the toggles (WCAG 1.4.1: never state
        // conveyed by appearance alone; the tinted row is the sighted cue).
        node.locked === true ? 'locked' : undefined,
        node.visible === false ? 'hidden' : undefined,
        // Email visibility overrides and print threads are workspace
        // projections; a hover-revealed badge must never be the only way to
        // learn the state.
        emailMeta?.hideOnMobile === true ? 'hidden on mobile' : undefined,
        emailMeta?.hideOnDesktop === true ? 'hidden on desktop' : undefined,
        isThreadedText ? 'threaded text' : undefined,
        appearanceDetail,
        // Effect stacks are visually represented by badges that can be
        // hidden (narrow rails) or revealed (workspace projection); the
        // row's name must carry the fact in every one of those states.
        layerEffectCount > 0
          ? `${layerEffectCount} layer effect${layerEffectCount === 1 ? '' : 's'}`
          : undefined,
        objectFilterCount > 0
          ? `${objectFilterCount} object filter${objectFilterCount === 1 ? '' : 's'}`
          : undefined,
      ]
        .filter((part): part is string => part != null)
        .join(', '),
    },
  );
  const adjustmentBadgeText =
    adjustmentSummary && adjustmentSummary.totalCount > 0
      ? `${adjustmentSummary.activeCount}/${adjustmentSummary.totalCount}`
      : node.kind === 'adjustment'
        ? (node as AdjustmentNode).adjustmentType
        : null;

  /** Keep control gestures out of dnd-kit's hands. */
  const stopDragActivation = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
  }, []);

  const handleIconDoubleClick = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      onDoubleClickIcon?.(node.id);
    },
    [node.id, onDoubleClickIcon],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (onSelectionClick?.()) return;
      onSelect(node.id, e.shiftKey, e.ctrlKey || e.metaKey);
      onFocus(idx);
    },
    [node.id, idx, onSelect, onFocus, onSelectionClick],
  );

  const handleDoubleClick = useCallback(() => {
    if (isContainerNode) onToggleExpand(node.id);
    // Begin editing. This previously reused `onRename` with the node's current
    // name, which left the parent unable to tell "start editing" apart from
    // "save this name" — so it treated every commit as another start and the
    // typed name was never written to the document.
    onRenameStart(node.id);
  }, [isContainerNode, node.id, onToggleExpand, onRenameStart]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed === '') {
      if (ghostName && ghostName !== node.name) {
        onRename(node.id, ghostName);
      }
    } else if (trimmed !== node.name) {
      onRename(node.id, trimmed);
    }
    onRenameCommit();
  }, [editValue, node.id, node.name, onRename, onRenameCommit, ghostName]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Stop these from bubbling to the tree container's own onKeyDown —
      // without it, e.g. Escape-to-cancel-rename also fires the tree's
      // Escape-to-exit-isolation handler in the same keypress.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onRenameCancel();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitRename();
        onRenameCycle?.(e.shiftKey ? 'previous' : 'next');
      }
    },
    [commitRename, onRenameCancel, onRenameCycle],
  );

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const container = isFrame || isGroup;

  // Indentation grows with real hierarchy depth, which is unbounded — an
  // imported file or a deeply nested auto-layout stack can easily reach 15+
  // levels. Left unclamped, indentation alone can consume the entire row at
  // the panel's minimum width (180px), pushing the icon, name, and toggles
  // off-screen before any of them render. The tree's real depth is preserved
  // for ARIA (`aria-level`) and drag/reparent logic; only the visual indent
  // flattens past this depth so the row stays usable.
  const visualDepth = Math.min(depth, MAX_VISUAL_INDENT_DEPTH);

  // Sync edit value when editing state changes
  useEffect(() => {
    if (editing) {
      setEditValue(node.name);
    }
  }, [editing, node.name]);

  const anySolo = doc ? documentHasSolo(doc) : false;
  const isSoloed = node.solo === true;
  const soloDimmed = anySolo && !isSoloed;

  // One faint tick per ancestor level, clamped with the visual indent so
  // rows beyond MAX_VISUAL_INDENT_DEPTH keep a readable cue of their
  // (flattened) nesting lane.
  const indentGuides = Array.from({ length: visualDepth }, (_, level) => {
    const offset = `calc(var(--space-2) + ${level} * var(--space-3))`;
    return (
      <span
        key={offset}
        className="layers-row__indent-guide"
        aria-hidden="true"
        style={{ left: offset }}
      />
    );
  });

  const rowClass = [
    'layers-row',
    selected ? 'layers-row--selected' : '',
    selectionPreview ? 'layers-row--selection-preview' : '',
    focused ? 'layers-row--focused' : '',
    node.visible === false ? 'layers-row--hidden' : '',
    hiddenByAncestor ? 'layers-row--hidden-inherited' : '',
    isEffectivelyLocked ? 'layers-row--locked' : '',
    isSoloed ? 'layers-row--soloed' : '',
    soloDimmed ? 'layers-row--solo-dimmed' : '',
    effectStackDrop
      ? canReceiveDroppedStack
        ? 'layers-row--effect-stack-drop'
        : 'layers-row--effect-stack-drop-invalid'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard at tree level per APG tree view */}
      <div
        role="treeitem"
        data-node-id={node.id}
        data-layer-type={layerPresentation.dataType}
        data-layer-category={layerPresentation.category}
        data-layer-subtype={layerPresentation.subtype}
        data-layer-color={node.layerColor ?? undefined}
        data-search-match={searchMatch || undefined}
        data-selection-preview={selectionPreview || undefined}
        aria-selected={selected}
        aria-expanded={container ? expanded : undefined}
        aria-level={depth + 1}
        aria-setsize={siblingCount ?? totalRows}
        aria-posinset={siblingIndex ?? idx + 1}
        aria-label={!editing ? accessibleDescription : undefined}
        className={rowClass}
        tabIndex={focused ? 0 : -1}
        onClick={handleClick}
        onPointerDown={onSelectionPointerDown}
        onDoubleClick={handleDoubleClick}
        style={
          {
            paddingLeft: `calc(var(--space-2) + ${visualDepth} * var(--space-3))`,
            '--layers-row-color': node.layerColor
              ? `var(--color-layer-tag-${node.layerColor})`
              : undefined,
            ...style,
          } as React.CSSProperties
        }
      >
        {/* Indent guides: one faint tick per ancestor level, clamped with the
            visual indent so rows beyond MAX_VISUAL_INDENT_DEPTH keep a
            readable cue of their (flattened) nesting lane. */}
        {indentGuides}

        {/* Drag handle */}
        <button
          {...dragHandleAttributes}
          ref={dragHandleRef}
          {...dragHandleListeners}
          type="button"
          className="layers-row__drag-handle"
          aria-label="Drag to reorder"
          aria-hidden="true"
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
        >
          <SolidIcon name={SOLID_CHROME_ICONS.gripVertical} size="0.75em" />
        </button>

        {/* Disclosure triangle */}
        {container ? (
          <button
            type="button"
            className="layers-row__disclosure"
            tabIndex={-1}
            onPointerDown={stopDragActivation}
            onClick={(e) => {
              e.stopPropagation();
              if (e.altKey) {
                onExpandSubtree?.(node.id);
              } else if (e.shiftKey) {
                onCollapseSubtree?.(node.id);
              } else if (e.ctrlKey || e.metaKey) {
                onExpandToDepth1?.(node.id);
              } else {
                onToggleExpand(node.id);
              }
            }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <SolidIcon
              name={expanded ? SOLID_CHROME_ICONS.chevronDown : SOLID_CHROME_ICONS.chevronRight}
              size="0.75em"
            />
          </button>
        ) : (
          <span className="layers-row__disclosure-spacer" />
        )}

        {/* Active selection dot indicator */}
        {selected && !editing && <span className="layers-row__selection-dot" aria-hidden="true" />}

        {/* Thumbnail preview (frames and images) */}
        {showThumbnail && (
          <img src={thumbnailDataUrl!} alt="" aria-hidden className="layers-row__thumbnail" />
        )}

        {/* Type icon — double-click zooms to layer */}
        <button
          type="button"
          className="layers-row__icon-area"
          onDoubleClick={handleIconDoubleClick}
          onPointerDown={stopDragActivation}
          aria-label={`Zoom to ${node.name} (${layerPresentation.label})`}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleIconDoubleClick();
            }
          }}
        >
          <SolidIcon
            name={typeIcon}
            size={16}
            aria-hidden
            className={`layers-row__type-icon layers-row__type-icon--${layerPresentation.category} layers-row__type-icon--${layerPresentation.subtype}`}
            style={isInstance ? { opacity: 0.65 } : undefined}
          />
        </button>

        {/* Name or rename input */}
        <span className="layers-row__label">
          {editing ? (
            <input
              ref={inputRef}
              id={`layers-row-rename-${node.id}`}
              name={`layers-row-rename-${node.id}`}
              className="layers-row__name-input"
              value={editValue}
              placeholder={ghostName ?? ''}
              onPointerDown={stopDragActivation}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={handleRenameKeyDown}
              aria-label={`Rename ${displayName}`}
            />
          ) : (
            <Tooltip label={displayName} truncationOnly>
              <span
                className={`layers-row__name${isInstance ? ' layers-row__name--instance' : ''}${searchMatch ? ' layers-row__name--match' : ''}${!hasRealName ? ' layers-row__name--ghost' : ''}`}
              >
                {displayName}
              </span>
            </Tooltip>
          )}

          {!editing && adjustmentSummary && (
            <Tooltip label={adjustmentSummary.tooltip}>
              <button
                type="button"
                className={`layers-row__adjustment-summary${adjustmentSummary.totalCount === 0 ? ' layers-row__adjustment-summary--empty' : ''}`}
                aria-label={adjustmentSummary.tooltip}
                data-adjustment-summary
                onPointerDown={stopDragActivation}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAdjustment?.(node.id);
                }}
              >
                {adjustmentSummary.label}
              </button>
            </Tooltip>
          )}
        </span>

        {/* Secondary badge cluster — type/state metadata that is useful but
            not essential to operating the row. Wrapped so it absorbs and
            clips overflow at narrow panel widths instead of pushing the
            always-needed visibility/lock/solo toggles off-screen. */}
        <span className="layers-row__badges">
          {/* Animated-media badge (subtle, rows without animation unchanged) */}
          {!editing && doc && isAnimatedMediaNode(node, doc) && (
            <span className="layers-row__badge-slot" {...badgeAttrs('media')}>
              <Tooltip label={`Animated media: ${animatedFrameCount(doc, node)} frames`}>
                <span
                  className="layers-row__media-badge"
                  role="status"
                  aria-label={`Animated: ${animatedFrameCount(doc, node)} frames`}
                >
                  Animated · {animatedFrameCount(doc, node)}
                </span>
              </Tooltip>
            </span>
          )}

          {/* Grid layout indicator */}
          {node.kind === 'frame' &&
            (node as { layoutStyle?: { mode?: string } }).layoutStyle?.mode === 'grid' &&
            !editing && (
              <span className="layers-row__badge-slot" {...badgeAttrs('layout')}>
                <Tooltip label="Grid layout">
                  <span className="layers-row__grid-indicator" role="img" aria-label="Grid layout">
                    <SolidIcon name={SOLID_CHROME_ICONS.layoutGrid} size="0.75em" />
                  </span>
                </Tooltip>
              </span>
            )}

          {/* Style indicator */}
          {nodeHasStyle(node) && !editing && (
            <span className="layers-row__badge-slot" {...badgeAttrs('layout')}>
              <Tooltip label="Linked to style">
                <span
                  className="layers-row__style-indicator"
                  role="img"
                  aria-label="Linked to style"
                >
                  <SolidIcon name={SOLID_CHROME_ICONS.palette} size="0.75em" />
                </span>
              </Tooltip>
            </span>
          )}

          {/* Instance badge */}
          {isInstance && !editing && (
            <span className="layers-row__badge-slot" {...badgeAttrs('component')}>
              <span className="layers-row__instance-badge">instance</span>
            </span>
          )}
          {/* Sync status indicator for component instances */}
          {isInstance && !editing && syncStatus && syncStatus !== 'synced' && (
            <span className="layers-row__badge-slot" {...badgeAttrs('component')}>
              <Tooltip
                label={
                  syncStatus === 'overridden'
                    ? 'Has local overrides'
                    : 'Broken — master component not found'
                }
              >
                <span className={`layers-row__sync-badge layers-row__sync-badge--${syncStatus}`}>
                  {syncStatus === 'overridden' ? 'modified' : 'broken'}
                </span>
              </Tooltip>
            </span>
          )}
          {/* Variant badge */}
          {isInstance && !editing && variantName && (
            <span className="layers-row__badge-slot" {...badgeAttrs('component')}>
              <span className="layers-row__variant-badge">{variantName}</span>
            </span>
          )}

          {/* Email: per-block visibility overrides, projected from
              `emailSemantics` (document-scoped, not node state). */}
          {!editing && emailMeta?.hideOnMobile === true && (
            <span className="layers-row__badge-slot" {...badgeAttrs('email')}>
              <Tooltip label="Hidden on mobile">
                <span
                  className="layers-row__email-badge"
                  role="img"
                  aria-label="Hidden on mobile"
                  data-email-visibility="hide-on-mobile"
                >
                  mobile hidden
                </span>
              </Tooltip>
            </span>
          )}
          {!editing && emailMeta?.hideOnDesktop === true && (
            <span className="layers-row__badge-slot" {...badgeAttrs('email')}>
              <Tooltip label="Hidden on desktop">
                <span
                  className="layers-row__email-badge"
                  role="img"
                  aria-label="Hidden on desktop"
                  data-email-visibility="hide-on-desktop"
                >
                  desktop hidden
                </span>
              </Tooltip>
            </span>
          )}

          {/* Print: a text frame bound to a story thread that continues
              across frames. Thread editing stays a text-tool concern; the
              row only states the relationship. */}
          {!editing && isThreadedText && (
            <span className="layers-row__badge-slot" {...badgeAttrs('print')}>
              <Tooltip
                label={
                  node.kind === 'text' && node.storyBinding?.threadIndex != null
                    ? `Story thread frame ${node.storyBinding.threadIndex + 1}`
                    : 'Threaded text frame'
                }
              >
                <span
                  className="layers-row__thread-badge"
                  role="img"
                  aria-label="Threaded text frame"
                  data-thread-frame="true"
                >
                  thread
                </span>
              </Tooltip>
            </span>
          )}

          {/* Adjustment type badge */}
          {node.kind === 'adjustment' && !editing && (
            <span className="layers-row__badge-slot" {...badgeAttrs('mask')}>
              <span
                className="layers-row__adjustment-badge"
                role="img"
                aria-label={
                  adjustmentSummary && adjustmentSummary.totalCount > 0
                    ? `${adjustmentSummary.activeCount} of ${adjustmentSummary.totalCount} adjustments active`
                    : `Legacy adjustment type: ${(node as AdjustmentNode).adjustmentType}`
                }
              >
                {adjustmentBadgeText}
              </span>
            </span>
          )}
          {/* Adjustment scope badge */}
          {node.kind === 'adjustment' &&
            !editing &&
            (() => {
              const adjNode = node as AdjustmentNode;
              const s = adjNode.scope;
              if (!s) return null;
              const label =
                s.mode === 'image-local'
                  ? 'I'
                  : s.mode === 'explicit-targets'
                    ? `T${s.targetNodeIds.length}`
                    : s.mode === 'container-descendant'
                      ? 'C'
                      : 'G';
              const title =
                s.mode === 'image-local'
                  ? 'Targets one image'
                  : s.mode === 'explicit-targets'
                    ? `Targets ${s.targetNodeIds.length} nodes`
                    : s.mode === 'container-descendant'
                      ? 'Container descendants'
                      : 'Document-wide';
              return (
                <span className="layers-row__badge-slot" {...badgeAttrs('mask')}>
                  <span className="layers-row__scope-badge" role="img" aria-label={title}>
                    {label}
                  </span>
                </span>
              );
            })()}

          {/* Motion indicator dot */}
          {hasMotion && !editing && (
            <span className="layers-row__badge-slot" {...badgeAttrs('motion')}>
              <span className="layers-row__motion-dot" role="img" aria-label="Has animation" />
            </span>
          )}

          {/* Keyframe count badge */}
          {keyframeCount != null && keyframeCount > 0 && !editing && (
            <span className="layers-row__badge-slot" {...badgeAttrs('motion')}>
              <span className="layers-row__keyframe-badge">{keyframeCount}</span>
            </span>
          )}

          {/* Mask indicator badge — inactive masks remain visible so the row
            explains the document structure instead of disappearing when the
            mask is toggled off. */}
          {maskLabel && !editing && (
            <span className="layers-row__badge-slot" {...badgeAttrs('mask')}>
              <Tooltip label={maskLabel}>
                <span
                  className={`layers-row__mask-badge layers-row__mask-badge--${node.mask?.type ?? 'clip'}${node.mask?.visible === false ? ' layers-row__mask-badge--disabled' : ''}`}
                  role="img"
                  aria-label={maskLabel}
                >
                  {node.mask?.type === 'clip' ? 'clip mask' : `${node.mask?.type} mask`}
                </span>
              </Tooltip>
            </span>
          )}

          {maskRole && !editing && (
            <span className="layers-row__badge-slot" {...badgeAttrs('mask')}>
              <Tooltip label={maskRole === 'source' ? 'Clipping mask source' : 'Clipped content'}>
                <span
                  className={`layers-row__mask-role layers-row__mask-role--${maskRole}`}
                  role="img"
                  aria-label={maskRole === 'source' ? 'Clipping mask source' : 'Clipped content'}
                  data-mask-role={maskRole}
                >
                  {maskRole === 'source' ? 'mask' : 'clipped'}
                </span>
              </Tooltip>
            </span>
          )}

          {/* Blend mode / opacity badge — the full wording is in the tooltip
              and the row's accessible name, so an ellipsized chip on a narrow
              rail never becomes an unreadable fragment. */}
          {badgeText && appearanceDetail && !editing && (
            <span className="layers-row__badge-slot" {...badgeAttrs('appearance')}>
              <Tooltip label={appearanceDetail}>
                <span className="layers-row__badge" role="img" aria-label={appearanceDetail}>
                  {badgeText}
                </span>
              </Tooltip>
            </span>
          )}

          {/* Effects badge — drop shadow, blur, glow, etc. */}
          {'effects' in node && node.effects && node.effects.length > 0 && !editing && (
            <span className="layers-row__badge-slot" {...badgeAttrs('appearance')}>
              <EffectStackTransferBadge
                sourceId={node.id}
                sourceName={node.name}
                kind="layer-effects"
                count={node.effects.length}
                onCopyToSelected={() => onCopyEffectStack?.(node.id, 'layer-effects')}
                onOpen={
                  onOpenEffectStack ? () => onOpenEffectStack(node.id, 'layer-effects') : undefined
                }
              >
                {node.effects.length}fx
              </EffectStackTransferBadge>
            </span>
          )}

          {/* Object Filter indicator — filters are node-local, so keep their
            presence discoverable in the layer tree without pretending they
            are separate scene nodes. */}
          {objectFilterCount > 0 && !editing && (
            <span className="layers-row__badge-slot" {...badgeAttrs('appearance')}>
              <EffectStackTransferBadge
                sourceId={node.id}
                sourceName={node.name}
                kind="object-filters"
                count={objectFilterCount}
                statusLabel={`${enabledObjectFilterCount} of ${objectFilterCount} Object Filters enabled on ${node.name}: ${objectFilterSummary?.tooltip ?? ''}`}
                onCopyToSelected={() => onCopyEffectStack?.(node.id, 'object-filters')}
                onOpen={
                  onOpenEffectStack ? () => onOpenEffectStack(node.id, 'object-filters') : undefined
                }
              >
                {objectFilterSummary?.label}
                {enabledObjectFilterCount !== objectFilterCount &&
                  ` · ${enabledObjectFilterCount}/${objectFilterCount}`}
              </EffectStackTransferBadge>
            </span>
          )}
        </span>

        {effectStackDrop && !editing && (
          <span className="layers-row__effect-stack-drop-hint" role="status">
            {canReceiveDroppedStack
              ? `${effectStackDrop.mode === 'append' ? 'Append' : 'Replace'} ${
                  effectStackDrop.kind === 'layer-effects' ? 'Layer Effects' : 'Object Filters'
                }`
              : 'Cannot copy stack here'}
          </span>
        )}

        {/* Collaborator presence */}
        {presences && presences.length > 0 && !editing && (
          <PresenceIndicator presences={presences} />
        )}

        {/* Visibility toggle. A row hidden through an ancestor keeps its own
            visible flag but paints nothing; the toggle says so instead of
            presenting as identical to a directly hidden row. */}
        <button
          type="button"
          className={`layers-row__toggle ${
            isMixedVisibility
              ? 'layers-row__toggle--visibility-mixed'
              : node.visible === false
                ? 'layers-row__toggle--visibility-off'
                : hiddenByAncestor
                  ? 'layers-row__toggle--visibility-inherited'
                  : 'layers-row__toggle--visibility-on'
          }`}
          tabIndex={-1}
          onPointerDown={stopDragActivation}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(node.id);
          }}
          aria-label={
            isMixedVisibility
              ? `Mixed visibility for selection`
              : node.visible === false
                ? `Show ${node.name}`
                : hiddenByAncestor
                  ? hidingAncestorName
                    ? `${node.name} is hidden by ${hidingAncestorName}`
                    : `${node.name} is hidden by an ancestor`
                  : `Hide ${node.name}`
          }
          aria-pressed={isMixedVisibility ? undefined : node.visible === false}
        >
          {isMixedVisibility ? (
            <SolidIcon name={SOLID_CHROME_ICONS.minus} size="0.85em" />
          ) : (
            <SolidIcon
              name={
                isEffectivelyHidden
                  ? SOLID_CHROME_ICONS.visibilityOff
                  : SOLID_CHROME_ICONS.visibility
              }
              size="0.85em"
            />
          )}
        </button>

        {/* Lock toggle */}
        <button
          type="button"
          className={`layers-row__toggle ${
            isMixedLocked
              ? 'layers-row__toggle--locked-mixed'
              : isEffectivelyLocked
                ? 'layers-row__toggle--locked-on'
                : 'layers-row__toggle--locked-off'
          }`}
          tabIndex={-1}
          onPointerDown={stopDragActivation}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(node.id);
          }}
          aria-label={
            isMixedLocked
              ? `Mixed lock for selection`
              : isEffectivelyLocked && !node.locked
                ? `${node.name} is locked by an ancestor`
                : isEffectivelyLocked
                  ? `Unlock ${node.name}`
                  : `Lock ${node.name}`
          }
          aria-pressed={isMixedLocked ? undefined : isEffectivelyLocked}
        >
          {isMixedLocked ? (
            <SolidIcon name={SOLID_CHROME_ICONS.minus} size="0.85em" />
          ) : (
            <SolidIcon
              name={isEffectivelyLocked ? SOLID_CHROME_ICONS.lock : SOLID_CHROME_ICONS.unlock}
              size="0.85em"
            />
          )}
        </button>

        {/* Solo toggle — focus the canvas on just this layer (and any others also soloed).
            Where the workspace does not pin it, the control is revealed on
            row hover/focus; it is always reachable from the context menu and
            the bulk bar, and touch devices always render it. A soloed row
            keeps it visible so the active state is never hidden. */}
        {onToggleSolo && (
          <button
            type="button"
            data-row-action="solo"
            data-row-action-pinned={pinSolo || isSoloed ? 'true' : 'false'}
            className={`layers-row__toggle ${
              isSoloed ? 'layers-row__toggle--solo-on' : 'layers-row__toggle--solo-off'
            }`}
            tabIndex={-1}
            onPointerDown={stopDragActivation}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSolo(node.id);
            }}
            aria-label={isSoloed ? `Unsolo ${node.name}` : `Solo ${node.name}`}
            aria-pressed={isSoloed}
          >
            <SolidIcon name={SOLID_CHROME_ICONS.star} size="0.85em" />
          </button>
        )}
      </div>
    </>
  );
});

function animatedFrameCount(
  doc: import('@varve/scene').Document | undefined,
  node: SceneNode,
): number {
  if (!doc || node.kind !== 'shape') return 0;
  for (const fill of node.fills ?? []) {
    if (fill.type !== 'image' || !fill.image?.assetId) continue;
    const animated = doc.assets?.[fill.image.assetId]?.animated;
    if (animated) return animated.frameCount;
  }
  return 0;
}
