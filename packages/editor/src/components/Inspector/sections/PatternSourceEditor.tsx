import type { Document, PatternDefinition, SceneNode } from '@varve/scene';
import { patternFillForDefinition } from '@varve/scene';
import { useCallback, useMemo, useRef, useState } from 'react';
import { compilePatternPreview } from '../../../patterns/compilePatternPreview';
import {
  setPatternSourceRootRotation,
  translatePatternSourceRoot,
} from '../../../patterns/patternSourceDraft';
import { PatternRepeatPreview } from './PatternRepeatPreview';

export function PatternSourceEditor({
  document,
  definition,
  usageCount,
  onCommit,
  onCancel,
}: {
  document: Document;
  definition: PatternDefinition;
  usageCount: number;
  onCommit: (draft: PatternDefinition, expectedRevision: number) => boolean;
  onCancel: () => void;
}) {
  const expectedRevision = useRef(definition.revision).current;
  const [draft, setDraft] = useState(() => structuredClone(definition));
  const [selectedRootId, setSelectedRootId] = useState(
    definition.source.kind === 'vector' ? (definition.source.rootIds[0] ?? null) : null,
  );
  const preview = useMemo(() => {
    try {
      return { tileSrc: compilePatternPreview(document, draft), error: null };
    } catch (error) {
      return {
        tileSrc: '',
        error: error instanceof Error ? error.message : 'Pattern preview is unavailable.',
      };
    }
  }, [document, draft]);

  const source = draft.source;
  const selectedNode =
    source.kind === 'vector' && selectedRootId ? source.nodes[selectedRootId] : undefined;
  const transform = readNodeTransform(selectedNode);

  const move = useCallback((nodeId: string, dx: number, dy: number) => {
    setDraft((current) => translatePatternSourceRoot(current, nodeId, dx, dy));
  }, []);

  const setTranslation = useCallback(
    (axis: 'x' | 'y', value: string) => {
      if (!selectedRootId) return;
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      const current = readNodeTransform(
        draft.source.kind === 'vector' ? draft.source.nodes[selectedRootId] : undefined,
      );
      move(
        selectedRootId,
        axis === 'x' ? number - current.x : 0,
        axis === 'y' ? number - current.y : 0,
      );
    },
    [draft.source, move, selectedRootId],
  );

  const setRotation = useCallback(
    (value: string) => {
      if (!selectedRootId) return;
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      setDraft((current) => setPatternSourceRootRotation(current, selectedRootId, number));
    },
    [selectedRootId],
  );

  const reset = useCallback(() => {
    if (!selectedRootId) return;
    setDraft((current) => {
      const node =
        current.source.kind === 'vector' ? current.source.nodes[selectedRootId] : undefined;
      const currentTransform = readNodeTransform(node);
      const moved = translatePatternSourceRoot(
        current,
        selectedRootId,
        -currentTransform.x,
        -currentTransform.y,
      );
      return setPatternSourceRootRotation(moved, selectedRootId, 0);
    });
  }, [selectedRootId]);

  if (source.kind !== 'vector') return null;

  return (
    <section className="insp-pattern-source-editor" aria-label={`Edit ${definition.name} source`}>
      <div className="insp-pattern-source-editor__header">
        <strong>Edit source motifs</strong>
        <div>
          <button type="button" className="insp-num__input" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="insp-num__input"
            onClick={() => onCommit(draft, expectedRevision)}
          >
            Done
          </button>
        </div>
      </div>
      <p className="insp-hint">
        Select a copied motif, then change its translation or rotation while watching the repeat
        preview. {usageCount} linked fill{usageCount === 1 ? '' : 's'} will update when you choose
        Done. Cancel discards this draft.
      </p>
      {preview.tileSrc ? (
        <PatternRepeatPreview pattern={patternFillForDefinition(draft, {}, preview.tileSrc)} />
      ) : (
        <p className="insp-hint" role="alert">
          {preview.error}
        </p>
      )}
      <fieldset className="insp-pattern-source-editor__motifs">
        <legend>Source motifs</legend>
        {source.rootIds.map((rootId) => {
          const node = source.nodes[rootId];
          if (!node) return null;
          const selected = selectedRootId === rootId;
          return (
            <button
              key={rootId}
              type="button"
              aria-pressed={selected}
              className="insp-pattern-source-editor__motif"
              onClick={() => setSelectedRootId(rootId)}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 10 : 1;
                if (event.key === 'ArrowLeft') move(rootId, -step, 0);
                else if (event.key === 'ArrowRight') move(rootId, step, 0);
                else if (event.key === 'ArrowUp') move(rootId, 0, -step);
                else if (event.key === 'ArrowDown') move(rootId, 0, step);
                else return;
                event.preventDefault();
              }}
            >
              {node.name || `Motif ${rootId}`}
            </button>
          );
        })}
      </fieldset>
      {selectedNode && selectedRootId && (
        <fieldset className="insp-pattern-source-editor__transform">
          <legend>Selected motif transform</legend>
          <label>
            Translation X
            <input
              aria-label="Motif translation X"
              type="number"
              step="1"
              value={transform.x}
              onChange={(event) => setTranslation('x', event.currentTarget.value)}
            />
          </label>
          <label>
            Translation Y
            <input
              aria-label="Motif translation Y"
              type="number"
              step="1"
              value={transform.y}
              onChange={(event) => setTranslation('y', event.currentTarget.value)}
            />
          </label>
          <label>
            Rotation
            <input
              aria-label="Motif rotation"
              type="number"
              step="1"
              value={selectedNode.rotation ?? 0}
              onChange={(event) => setRotation(event.currentTarget.value)}
            />
          </label>
          <button type="button" onClick={reset}>
            Reset motif transform
          </button>
        </fieldset>
      )}
    </section>
  );
}

function readNodeTransform(node: SceneNode | undefined): { x: number; y: number } {
  const transform =
    node && 'transform' in node && Array.isArray(node.transform) ? node.transform : null;
  return {
    x: typeof transform?.[4] === 'number' && Number.isFinite(transform[4]) ? transform[4] : 0,
    y: typeof transform?.[5] === 'number' && Number.isFinite(transform[5]) ? transform[5] : 0,
  };
}
