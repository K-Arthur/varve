import type { PathPoint } from '@varve/engine';
import type { ShapeNode } from '@varve/scene';
import {
  deleteSelectedAnchorsFromPath,
  insertPointOnPath,
  nodeModeForPoint,
  type PathNodeMode,
  pathPointAtIndex,
  pathRings,
  remapSelectionAfterInsertion,
  remapSelectionAfterRingReverse,
  reversePathShape,
  setNodeModeAtIndex,
  updatePathPointAtIndex,
} from '@varve/shared';
import { useState } from 'react';
import { useEditor } from '../context';
import { findPathTopologyDependency } from '../pathTopologyDependencies';
import './NodeEditControls.css';

interface NodeEditControlsProps {
  targetId: string;
  selectedAnchors: ReadonlySet<number>;
  setSelectedAnchors: (anchors: ReadonlySet<number>) => void;
  setTargetId: (id: string | null) => void;
}

const MODES: readonly { value: PathNodeMode; label: string; shortcut: string }[] = [
  { value: 'corner', label: 'Corner', shortcut: '⇧C' },
  { value: 'smooth', label: 'Smooth', shortcut: '⇧S' },
  { value: 'symmetric', label: 'Symmetric', shortcut: '⇧Y' },
  { value: 'automatic', label: 'Automatic', shortcut: '⇧A' },
];

function selectedPoint(
  shape: Extract<ShapeNode['shape'], { kind: 'path' }>,
  selected: ReadonlySet<number>,
): PathPoint | null {
  if (selected.size !== 1) return null;
  return pathPointAtIndex(pathRings(shape), [...selected][0]!);
}

export function NodeEditControls({
  targetId,
  selectedAnchors,
  setSelectedAnchors,
  setTargetId,
}: NodeEditControlsProps) {
  const editor = useEditor();
  const node = editor.state.document.nodes[targetId];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (node?.kind !== 'shape' || node.shape.kind !== 'path') return null;
  const shape = node.shape;
  const topologyDependency = findPathTopologyDependency(editor.state.document, targetId);
  const topologyBlocked = topologyDependency !== null;
  const topologyTitle = topologyDependency
    ? `Unavailable: ${topologyDependency.reason}. Detach or convert the dependent feature first.`
    : undefined;
  const singlePoint = selectedPoint(shape, selectedAnchors);
  const selectedModes = [...selectedAnchors]
    .map((index) => pathPointAtIndex(pathRings(shape), index))
    .filter((point): point is PathPoint => point !== null)
    .map((point) => nodeModeForPoint(point));
  const activeMode =
    selectedModes.length > 0 && selectedModes.every((mode) => mode === selectedModes[0])
      ? selectedModes[0]
      : null;

  const commitShape = (
    nextShape: Extract<ShapeNode['shape'], { kind: 'path' }>,
    nextSelection?: ReadonlySet<number>,
    announcement?: string,
  ) => {
    editor.beginTransaction();
    editor.updateNode(targetId, (current) => {
      if (current.kind !== 'shape' || current.shape.kind !== 'path') return current;
      return { ...current, shape: nextShape };
    });
    editor.commitTransaction();
    if (nextSelection) setSelectedAnchors(new Set(nextSelection));
    if (announcement) editor.announce(announcement);
  };

  const applyMode = (mode: PathNodeMode) => {
    let nextShape = shape;
    for (const index of selectedAnchors) nextShape = setNodeModeAtIndex(nextShape, index, mode);
    commitShape(nextShape, undefined, `${mode} node mode applied.`);
  };

  const convertToLine = () => {
    let nextShape = shape;
    for (const index of selectedAnchors) {
      nextShape = updatePathPointAtIndex(nextShape, index, (point) => ({
        ...point,
        handleIn: null,
        handleOut: null,
        mode: 'corner',
      }));
    }
    commitShape(nextShape, undefined, 'Selected nodes converted to corners.');
  };

  const convertToCurve = () => applyMode('smooth');

  const deleteNodes = () => {
    const result = deleteSelectedAnchorsFromPath(shape, selectedAnchors);
    if (!result) {
      editor.announce('The selected nodes cannot be deleted without invalidating the contour.');
      return;
    }
    commitShape(result.shape, result.selection, 'Selected nodes deleted.');
  };

  const reverse = () => {
    const nextSelection = remapSelectionAfterRingReverse(selectedAnchors, pathRings(shape));
    commitShape(reversePathShape(shape), nextSelection, 'Path direction reversed.');
  };

  const insertAfterSelection = () => {
    if (selectedAnchors.size !== 1) return;
    const index = [...selectedAnchors][0]!;
    const rings = pathRings(shape);
    let offset = 0;
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
      const ring = rings[ringIndex]!;
      if (index >= offset && index < offset + ring.length) {
        const pointIndex = index - offset;
        const isLastOpenPoint = !shape.closed && pointIndex === ring.length - 1;
        if (isLastOpenPoint) return;
        const segmentIndex = pointIndex;
        const result = insertPointOnPath(shape, ringIndex, segmentIndex, 0.5);
        if (!result) return;
        const nextSelection = remapSelectionAfterInsertion(selectedAnchors, result.insertedIndex);
        nextSelection.add(result.insertedIndex);
        commitShape(result.shape, nextSelection, 'Node inserted at the curve midpoint.');
        return;
      }
      offset += ring.length;
    }
  };

  const setClosed = (closed: boolean) => {
    if (shape.closed === closed) return;
    commitShape({ ...shape, closed }, undefined, closed ? 'Path closed.' : 'Path opened.');
  };

  const updateNumber = (key: string, value: number) => {
    if (!singlePoint || !Number.isFinite(value)) return;
    const index = [...selectedAnchors][0]!;
    const nextShape = updatePathPointAtIndex(shape, index, (point) => {
      if (key === 'x' || key === 'y') {
        return { ...point, [key]: value };
      }
      const [which, axis] = key.split('.') as ['handleIn' | 'handleOut', 'x' | 'y'];
      const current = point[which] ? ([...point[which]!] as [number, number]) : [0, 0];
      current[axis === 'x' ? 0 : 1] = value;
      return { ...point, [which]: current };
    });
    commitShape(nextShape);
  };

  const numberField = (label: string, key: string, value: number | null) => {
    const draft = drafts[key];
    return (
      <label className="node-edit-controls__field">
        <span>{label}</span>
        <input
          aria-label={`${label} (local px)`}
          inputMode="decimal"
          type="number"
          step="0.1"
          value={draft ?? (value === null ? '' : String(Math.round(value * 100) / 100))}
          placeholder={value === null ? '—' : undefined}
          disabled={!singlePoint}
          onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
          onBlur={(event) => {
            const parsed = Number(event.target.value);
            setDrafts((current) => {
              const next = { ...current };
              delete next[key];
              return next;
            });
            if (Number.isFinite(parsed)) updateNumber(key, parsed);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
          }}
        />
      </label>
    );
  };

  const handleIn = singlePoint?.handleIn ?? null;
  const handleOut = singlePoint?.handleOut ?? null;
  return (
    <section
      className="node-edit-controls"
      data-testid="node-edit-controls"
      aria-label="Node editing"
    >
      <div className="node-edit-controls__heading">
        <span className="node-edit-controls__title">Edit path</span>
        <span className="node-edit-controls__count" aria-live="polite">
          {selectedAnchors.size} node{selectedAnchors.size === 1 ? '' : 's'} selected
        </span>
      </div>
      <fieldset className="node-edit-controls__modes">
        <legend className="node-edit-controls__visually-hidden">Node mode</legend>
        {MODES.map((mode) => (
          <button
            type="button"
            key={mode.value}
            className={activeMode === mode.value ? 'is-active' : undefined}
            aria-pressed={activeMode === mode.value}
            title={`${mode.label} (${mode.shortcut})`}
            disabled={selectedAnchors.size === 0}
            onClick={() => applyMode(mode.value)}
          >
            {mode.label}
          </button>
        ))}
      </fieldset>
      <fieldset className="node-edit-controls__coordinates">
        <legend className="node-edit-controls__visually-hidden">Selected node coordinates</legend>
        {numberField('X', 'x', singlePoint?.x ?? null)}
        {numberField('Y', 'y', singlePoint?.y ?? null)}
        {numberField('In X', 'handleIn.x', handleIn?.[0] ?? null)}
        {numberField('In Y', 'handleIn.y', handleIn?.[1] ?? null)}
        {numberField('Out X', 'handleOut.x', handleOut?.[0] ?? null)}
        {numberField('Out Y', 'handleOut.y', handleOut?.[1] ?? null)}
      </fieldset>
      <fieldset className="node-edit-controls__operations">
        <legend className="node-edit-controls__visually-hidden">Path operations</legend>
        <button
          type="button"
          onClick={insertAfterSelection}
          disabled={selectedAnchors.size !== 1 || topologyBlocked}
          title={topologyTitle}
        >
          Insert
        </button>
        <button
          type="button"
          onClick={deleteNodes}
          disabled={selectedAnchors.size === 0 || topologyBlocked}
          title={topologyTitle}
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => setClosed(true)}
          disabled={shape.closed || topologyBlocked}
          title={topologyTitle}
        >
          Close
        </button>
        <button
          type="button"
          onClick={() => setClosed(false)}
          disabled={!shape.closed || topologyBlocked}
          title={topologyTitle}
        >
          Open
        </button>
        <button
          type="button"
          onClick={reverse}
          disabled={shape.points.length < 2 || topologyBlocked}
          title={topologyTitle}
        >
          Reverse
        </button>
        <button type="button" onClick={convertToLine} disabled={selectedAnchors.size === 0}>
          Line
        </button>
        <button type="button" onClick={convertToCurve} disabled={selectedAnchors.size === 0}>
          Curve
        </button>
        <button
          type="button"
          disabled
          title="Splitting into separate objects is not available in single-path editing yet."
        >
          Break path
        </button>
      </fieldset>
      <div className="node-edit-controls__footer">
        <span className="node-edit-controls__hint">
          Coordinates are path-local px; handles are relative vectors.
        </span>
        <button
          type="button"
          className="node-edit-controls__exit"
          onClick={() => {
            setTargetId(null);
            editor.setTool('select');
          }}
        >
          Done
        </button>
      </div>
    </section>
  );
}
