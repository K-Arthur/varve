/**
 * Layers panel — APG Tree View (role=tree, role=treeitem, roving tabindex).
 *
 * A7: type icons (distinct per kind), lock toggle, visibility toggle both wired.
 * F1: uses isSelected() from context so nested nodes highlight correctly.
 */
import type { NodeId, SceneNode, ShapeNode } from '@strata/scene';
import type { IconName } from '@strata/ui';
import { CHROME_ICONS, Icon, TOOL_ICONS } from '@strata/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from './context';
import { VariablePanel } from './VariablePanel';

function nodeTypeIcon(n: SceneNode): IconName {
  if (n.kind === 'frame') return n.componentId ? TOOL_ICONS.component : TOOL_ICONS.frame;
  if (n.kind === 'text') return TOOL_ICONS.text;
  if (n.kind === 'shape') {
    const s = (n as ShapeNode).shape;
    if (s.kind === 'ellipse' || s.kind === 'circle') return TOOL_ICONS.ellipse;
    if (s.kind === 'line') return TOOL_ICONS.line;
    if (s.kind === 'polygon') return TOOL_ICONS.polygon;
    if (s.kind === 'star') return TOOL_ICONS.star;
    return TOOL_ICONS.rect;
  }
  return TOOL_ICONS.rect;
}

export function LayersPanel() {
  const {
    state,
    isSelected,
    setSelection,
    toggleSelection,
    renameSelected,
    moveNode,
    setNodeLocked,
    setNodeVisible,
  } = useEditor();
  const [focusIdx, setFocusIdx] = useState(0);
  const [expanded, setExpanded] = useState<Set<NodeId>>(new Set());
  const treeRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<string | null>(null);
  const typeAheadRef = useRef<{ buf: string; timer: ReturnType<typeof setTimeout> | null }>({
    buf: '',
    timer: null,
  });

  const entries = useMemo(() => {
    const result: SceneNode[] = [];
    const parentIds: (NodeId | null)[] = [];
    const depths: number[] = [];

    function walk(parentId: NodeId | null, ids: NodeId[], depth: number) {
      for (const nid of ids) {
        const n = state.document.nodes[nid];
        if (!n) continue;
        if (parentId && !expanded.has(parentId)) continue;
        result.push(n);
        parentIds.push(parentId);
        depths.push(depth);
        if (n.kind === 'frame' && expanded.has(nid)) {
          walk(nid, n.children, depth + 1);
        }
      }
    }
    walk(null, state.document.rootChildren, 0);
    return { nodes: result, depths, parentIds };
  }, [state.document, expanded]);

  const nodes = entries.nodes;

  const clampFocus = useCallback(
    (i: number) => Math.min(Math.max(0, i), nodes.length - 1),
    [nodes.length],
  );

  const selectAndFocus = useCallback(
    (idx: number) => {
      const i = clampFocus(idx);
      const node = nodes[i];
      if (node) {
        setSelection(node.id);
        setFocusIdx(i);
      }
    },
    [clampFocus, nodes, setSelection],
  );

  const toggleExpand = useCallback((id: NodeId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const len = nodes.length;
      if (len === 0) return;

      const delta = (e.key === 'ArrowDown' ? 1 : 0) - (e.key === 'ArrowUp' ? 1 : 0);
      if (delta !== 0) {
        e.preventDefault();
        selectAndFocus(clampFocus(focusIdx + delta));
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const n = nodes[focusIdx];
        if (n?.kind === 'frame' && !expanded.has(n.id)) toggleExpand(n.id);
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = nodes[focusIdx];
        if (n?.kind === 'frame' && expanded.has(n.id)) toggleExpand(n.id);
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        selectAndFocus(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        selectAndFocus(len - 1);
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectAndFocus(focusIdx);
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault();
        const n = nodes[focusIdx];
        if (n) {
          const name = prompt('Rename layer', n.name);
          if (name) renameSelected(name);
        }
        return;
      }

      if (e.key.length === 1) {
        const ta = typeAheadRef.current;
        ta.buf = (ta.buf + e.key).toLowerCase();
        if (ta.timer) clearTimeout(ta.timer);
        ta.timer = setTimeout(() => {
          ta.buf = '';
          ta.timer = null;
        }, 500);

        for (let i = 0; i < len; i++) {
          const label = nodes[(focusIdx + 1 + i) % len]?.name.toLowerCase();
          if (label?.startsWith(ta.buf)) {
            selectAndFocus((focusIdx + 1 + i) % len);
            return;
          }
        }
      }
    },
    [nodes, focusIdx, expanded, clampFocus, selectAndFocus, toggleExpand, renameSelected],
  );

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    dragRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const fromId = dragRef.current;
      if (!fromId) return;
      const dropTarget = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
      const toId = dropTarget?.dataset.nodeId;
      if (!toId || fromId === toId) return;
      const fromIdx = nodes.findIndex((n) => n.id === fromId);
      const toIdx = nodes.findIndex((n) => n.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      moveNode(fromId, toIdx);
      dragRef.current = null;
    },
    [nodes, moveNode],
  );

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div className="editor-layers">
      <div className="editor-inspector__group-title">Layers</div>
      <div
        ref={treeRef}
        role="tree"
        aria-label="Layers"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        style={{ margin: 0, padding: 0 }}
      >
        {nodes.length === 0 && (
          <div
            style={{
              padding: 'var(--space-3)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-size-sm)',
              textAlign: 'center',
            }}
          >
            No layers
          </div>
        )}
        {nodes.map((n, i) => {
          const selected = isSelected(n.id);
          const focused = i === focusIdx;
          const depth = entries.depths[i] ?? 0;
          const isFrame = n.kind === 'frame';
          const expandedNode = expanded.has(n.id);
          const typeIcon = nodeTypeIcon(n);
          return (
            <div
              key={n.id}
              role="treeitem"
              data-node-id={n.id}
              aria-selected={selected}
              aria-expanded={isFrame ? expandedNode : undefined}
              tabIndex={focused ? 0 : -1}
              draggable={!n.locked}
              onDragStart={(e) => handleDragStart(e, n.id)}
              onClick={(e) => {
                toggleSelection(n.id, e.shiftKey);
                setFocusIdx(i);
              }}
              onDoubleClick={() => {
                if (isFrame) toggleExpand(n.id);
                const name = prompt('Rename layer', n.name);
                if (name) renameSelected(name);
              }}
              onFocus={() => setFocusIdx(i)}
              onKeyDown={() => {}}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                padding: 'var(--space-1) var(--space-1)',
                paddingLeft: `calc(var(--space-2) + ${depth} * var(--space-3))`,
                borderRadius: 'var(--radius-sm)',
                cursor: n.locked ? 'not-allowed' : 'default',
                background: selected ? 'var(--color-interactive-default)' : 'transparent',
                color: selected ? 'var(--color-text-on-accent)' : 'var(--color-text-primary)',
                opacity: n.visible ? 1 : 0.4,
                outline: focused ? '2px solid var(--color-interactive-focus-ring)' : 'none',
                outlineOffset: -2,
              }}
            >
              {/* Expand/collapse disclosure for frames */}
              {isFrame ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(n.id);
                  }}
                  aria-label={expandedNode ? 'Collapse' : 'Expand'}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'inherit',
                    padding: 0,
                    width: '1em',
                    textAlign: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon
                    name={expandedNode ? CHROME_ICONS.chevronDown : CHROME_ICONS.chevronRight}
                    size="0.75em"
                  />
                </button>
              ) : (
                <span style={{ width: '1em', flexShrink: 0 }} />
              )}

              {/* Type icon */}
              <Icon name={typeIcon} size="0.85em" aria-hidden />

              {/* Layer name */}
              <span
                style={{
                  flex: 1,
                  fontSize: 'var(--font-size-sm)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {n.name}
              </span>

              {/* Instance badge */}
              {isFrame && n.componentId && (
                <span
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-text-muted)',
                    background: 'var(--color-surface-sunken)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0 var(--space-1)',
                    flexShrink: 0,
                  }}
                >
                  instance
                </span>
              )}

              {/* Visibility toggle */}
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  setNodeVisible(n.id, !n.visible);
                }}
                aria-label={n.visible ? 'Hide layer' : 'Show layer'}
                aria-pressed={!n.visible}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                  padding: 0,
                  flexShrink: 0,
                  opacity: n.visible ? 0.4 : 1,
                }}
              >
                <Icon
                  name={n.visible ? CHROME_ICONS.visibility : CHROME_ICONS.visibilityOff}
                  size="0.85em"
                />
              </button>

              {/* Lock toggle */}
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  setNodeLocked(n.id, !n.locked);
                }}
                aria-label={n.locked ? 'Unlock layer' : 'Lock layer'}
                aria-pressed={n.locked}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                  padding: 0,
                  flexShrink: 0,
                  opacity: n.locked ? 1 : 0.25,
                }}
              >
                <Icon name={n.locked ? CHROME_ICONS.lock : CHROME_ICONS.unlock} size="0.85em" />
              </button>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-2)',
          borderTop: '1px solid var(--color-border-subtle)',
        }}
      >
        <VariablePanel />
      </div>
    </div>
  );
}
