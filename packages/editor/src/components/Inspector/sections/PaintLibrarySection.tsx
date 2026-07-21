/**
 * PaintLibrarySection — inspector section for shared paint entities.
 *
 * Displays all Paint entries from Document.paints. Supports:
 * - Search/filter by paint name
 * - "Add to library" from selected node's current fill
 * - Delete paint (with reassign warning when in-use)
 * - Apply paint to selection
 * - Detach paint back to inline fills
 * - Drag-to-apply via HTML5 drag and drop
 */
import type { Fill, Paint, SceneNode } from '@strata/scene';
import { addPaintToDocument, removePaintFromDocument } from '@strata/scene';
import { managedColorToRgba } from '@strata/shared';
import { Icon } from '@strata/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

function paintSwatchBg(paint: Paint): string {
  const fill = paint.fill;
  if (fill.type === 'solid' && fill.color) {
    const [r, g, b, a] = managedColorToRgba(fill.color);
    return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
  }
  if (fill.type === 'gradient' && fill.gradient) {
    const stops = fill.gradient.stops
      .map((s) => {
        const [r, g, b, a] = managedColorToRgba(s.color);
        return `rgba(${r},${g},${b},${(a / 255).toFixed(2)}) ${(s.position * 100).toFixed(0)}%`;
      })
      .join(', ');
    return `linear-gradient(90deg, ${stops})`;
  }
  if (fill.type === 'image' && fill.image?.src) {
    return `url(${fill.image.src}) center/cover`;
  }
  return 'var(--color-surface-sunken)';
}

function paintTypeLabel(fill: Fill): string {
  switch (fill.type) {
    case 'solid':
      return 'Solid';
    case 'gradient':
      return fill.gradient?.type ?? 'Gradient';
    case 'image':
      return 'Image';
    case 'pattern':
      return 'Pattern';
  }
}

/** Find all node IDs in a document that reference a given paint. */
function findPaintUsers(doc: { nodes: Record<string, SceneNode> }, paintId: string): string[] {
  const users: string[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.paintRefs?.includes(paintId)) {
      users.push(id);
    }
  }
  return users;
}

export function PaintLibrarySection() {
  const { state, selectedNodes, updateDoc, announce, showToast } = useEditor();
  const doc = state.document;
  const paints = doc.paints ?? {};
  const [search, setSearch] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const paintEntries = useMemo(() => {
    return Object.values(paints).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  }, [paints, search]);

  const selected = selectedNodes();

  const activePaintRef = useMemo(() => {
    if (selected.length !== 1) return null;
    const refs = selected[0]?.paintRefs;
    if (!refs || refs.length === 0) return null;
    return refs[0];
  }, [selected]);

  const hasSelection = selected.length > 0;

  const addToLibrary = useCallback(() => {
    const node = selected[0]!;
    if (!node) return;

    const fills =
      node.fills ??
      (node.fill
        ? [
            {
              type: 'solid' as const,
              color: node.fill,
              opacity: 1,
              blendMode: 'normal' as const,
              visible: true,
            },
          ]
        : []);
    if (fills.length === 0) return;

    const fill = fills[0];
    if (!fill) return;

    updateDoc((d) => {
      const id = `paint-${Date.now()}`;
      const name = node.name;
      const paint: Paint = { id, name, fill };
      return addPaintToDocument(d, paint);
    });
    announce('Paint added to library');
  }, [selected, updateDoc, announce]);

  const applyPaint = useCallback(
    (paintId: string) => {
      updateDoc((d) => {
        const nodes = { ...d.nodes };
        for (const node of selected) {
          const existing = nodes[node.id];
          if (existing) {
            const { fills: _fills, fill: _fill, paintRefs: _oldRefs, ...rest } = existing;
            nodes[node.id] = {
              ...rest,
              fills: undefined,
              fill: _fill,
              paintRefs: [paintId],
            } as SceneNode;
          }
        }
        return { ...d, nodes };
      });
      announce('Paint applied');
    },
    [selected, updateDoc, announce],
  );

  const detachPaint = useCallback(() => {
    updateDoc((d) => {
      const nodes = { ...d.nodes };
      for (const node of selected) {
        const existing = nodes[node.id];
        if (!existing?.paintRefs?.length) continue;

        const resolvedFills: Fill[] = [];
        for (const refId of existing.paintRefs) {
          const p = d.paints?.[refId];
          if (p) resolvedFills.push(p.fill);
        }

        const { paintRefs: _refs, ...rest } = existing;
        nodes[node.id] = {
          ...rest,
          fills: resolvedFills.length > 0 ? resolvedFills : existing.fills,
        } as SceneNode;
      }
      return { ...d, nodes };
    });
    announce('Paint detached');
  }, [selected, updateDoc, announce]);

  const deletePaint = useCallback(
    (paintId: string) => {
      const users = findPaintUsers(doc, paintId);
      if (users.length > 0) {
        setConfirmDeleteId(paintId);
        showToast({
          message: `Paint is in use by ${users.length} node(s). Detach them first to delete.`,
          type: 'warning',
        });
        return;
      }
      updateDoc((d) => {
        return removePaintFromDocument(d, paintId);
      });
      announce('Paint deleted');
    },
    [doc, updateDoc, announce, showToast],
  );

  const confirmDeleteWithDetach = useCallback(() => {
    if (!confirmDeleteId) return;
    updateDoc((d) => {
      const nodes = { ...d.nodes };
      for (const [nodeId, node] of Object.entries(d.nodes)) {
        if (node.paintRefs?.includes(confirmDeleteId)) {
          const resolvedFills: Fill[] = [];
          for (const refId of node.paintRefs) {
            const p = d.paints?.[refId];
            if (p) resolvedFills.push(p.fill);
          }
          const { paintRefs: _refs, ...rest } = node;
          nodes[nodeId] = { ...rest, fills: resolvedFills } as SceneNode;
        }
      }
      return removePaintFromDocument({ ...d, nodes }, confirmDeleteId);
    });
    setConfirmDeleteId(null);
    announce('Paint deleted and nodes detached');
  }, [confirmDeleteId, updateDoc, announce]);

  const cancelDelete = useCallback(() => {
    setConfirmDeleteId(null);
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, paintId: string) => {
    e.dataTransfer.setData('application/strata-paint', paintId);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  return (
    <DisclosureSection title="Paint Library">
      <div className="insp-paint-library">
        <div className="insp-paint-library__search">
          <input
            type="text"
            className="insp-paint-library__search-input"
            placeholder="Filter paints..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Filter paint library"
          />
        </div>

        {hasSelection && (
          <button
            type="button"
            className="insp-paint-library__add-btn"
            onClick={addToLibrary}
            aria-label="Add current fill to paint library"
          >
            <Icon name="Plus" label={undefined} size="0.85em" />
            <span>Add to Library</span>
          </button>
        )}

        {paintEntries.length === 0 && (
          <div className="insp-empty-message">
            {search ? 'No paints match your filter' : 'No paints in library'}
          </div>
        )}

        <ul className="insp-paint-library__list" aria-label="Paint library entries">
          {paintEntries.map((paint) => {
            const isActive = activePaintRef === paint.id;
            return (
              <li
                key={paint.id}
                className="insp-paint-library__entry"
                draggable
                onDragStart={(e) => handleDragStart(e, paint.id)}
                data-paint-id={paint.id}
              >
                <div
                  className="insp-paint-library__swatch"
                  style={{ background: paintSwatchBg(paint) }}
                  aria-hidden
                />
                <div className="insp-paint-library__info">
                  <span className="insp-paint-library__name">{paint.name}</span>
                  <span className="insp-paint-library__badge">{paintTypeLabel(paint.fill)}</span>
                </div>
                <div className="insp-paint-library__actions">
                  {isActive && (
                    <button
                      type="button"
                      className="insp-paint-library__action-btn"
                      onClick={detachPaint}
                      aria-label="Detach paint"
                      title="Detach"
                    >
                      <Icon name="Unlink" label={undefined} size="0.85em" />
                    </button>
                  )}
                  {hasSelection && (
                    <button
                      type="button"
                      className="insp-paint-library__action-btn"
                      onClick={() => applyPaint(paint.id)}
                      aria-label="Apply paint to selection"
                      title="Apply"
                    >
                      <Icon name="Check" label={undefined} size="0.85em" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="insp-paint-library__action-btn insp-paint-library__action-btn--danger"
                    onClick={() => deletePaint(paint.id)}
                    aria-label="Delete paint"
                    title="Delete"
                  >
                    <Icon name="Trash2" label={undefined} size="0.85em" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {activePaintRef && paints[activePaintRef] && (
          <div className="insp-paint-library__status">
            <Icon name="Link" label={undefined} size="0.75em" />
            <span>Referenced — changes update all uses</span>
          </div>
        )}
      </div>

      {confirmDeleteId && (
        <div className="insp-paint-library__confirm">
          <p className="insp-paint-library__confirm-message">
            Paint is in use. Detach all uses and delete?
          </p>
          <div className="insp-paint-library__confirm-actions">
            <button
              type="button"
              className="insp-paint-library__confirm-btn insp-paint-library__confirm-btn--danger"
              onClick={confirmDeleteWithDetach}
            >
              Detach & Delete
            </button>
            <button
              type="button"
              className="insp-paint-library__confirm-btn"
              onClick={cancelDelete}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </DisclosureSection>
  );
}
