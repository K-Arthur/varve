import type { NodeId, SceneNode } from '@strata/scene';
import { CHROME_ICONS, Icon } from '@strata/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from './context';

export function LayersPanel() {
  const { state, setSelection, renameSelected, moveNode } = useEditor();
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
      if (nodes[i]) {
        setSelection(nodes[i]?.id);
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
        const next = clampFocus(focusIdx + delta);
        selectAndFocus(next);
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const n = nodes[focusIdx];
        if (n?.kind === 'frame' && !expanded.has(n.id)) {
          toggleExpand(n.id);
        }
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = nodes[focusIdx];
        if (n?.kind === 'frame' && expanded.has(n.id)) {
          toggleExpand(n.id);
        }
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
            const next = (focusIdx + 1 + i) % len;
            selectAndFocus(next);
            return;
          }
        }
      }
    },
    [nodes, focusIdx, expanded, clampFocus, selectAndFocus, toggleExpand],
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
          const selected = n.id === state.selection;
          const focused = i === focusIdx;
          const depth = entries.depths[i] ?? 0;
          const isFrame = n.kind === 'frame';
          const expandedNode = expanded.has(n.id);
          return (
            <div
              key={n.id}
              role="treeitem"
              data-node-id={n.id}
              aria-selected={selected}
              aria-expanded={isFrame ? expandedNode : undefined}
              tabIndex={focused ? 0 : -1}
              draggable
              onDragStart={(e) => handleDragStart(e, n.id)}
              onClick={() => {
                setSelection(n.id);
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
                padding: 'var(--space-1) var(--space-2)',
                paddingLeft: `calc(var(--space-2) * ${depth + 1})`,
                borderRadius: 'var(--radius-sm)',
                cursor: 'grab',
                background: selected ? 'var(--color-interactive-default)' : 'transparent',
                color: selected ? 'var(--color-text-on-accent)' : 'var(--color-text-primary)',
                outline: focused ? '2px solid var(--color-interactive-focus-ring)' : 'none',
                outlineOffset: -2,
              }}
            >
              {isFrame && (
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
                    fontSize: 'var(--font-size-xs)',
                  }}
                >
                  {expandedNode ? '\u25BC' : '\u25B6'}
                </button>
              )}
              {!isFrame && <span style={{ width: '1em' }} />}
              <Icon name={CHROME_ICONS.visibility} size="0.85em" label="" />
              <span style={{ flex: 1, fontSize: 'var(--font-size-sm)' }}>{n.name}</span>
              {isFrame && n.componentId && (
                <span
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-text-muted)',
                    background: 'var(--color-surface-sunken)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0 var(--space-1)',
                  }}
                >
                  instance
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
