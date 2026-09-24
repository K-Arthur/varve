import type { ShapeBuilderAction, ShapeBuilderModel } from '@varve/scene';
import {
  buildShapeBuilderModel,
  explainShapeBuilderEligibility,
  previewShapeBuilderAction,
  previewShapeBuilderSelection,
} from '@varve/scene';
import { Button } from '@varve/ui';
import { useMemo, useState } from 'react';
import type { ShapeBuilderDraft } from '../tools';

interface ShapeBuilderOverlayProps {
  document: import('@varve/scene').Document;
  selection: readonly import('@varve/scene').NodeId[];
  draft: ShapeBuilderDraft;
  canvasSize: { width: number; height: number };
  worldToCanvas: (x: number, y: number) => { x: number; y: number };
  onAction: (action: ShapeBuilderAction) => void;
  onExit: () => void;
  /**
   * Converts visible strokes on the current selection into filled outlines so
   * a stroke-blocked selection can become eligible without leaving the tool.
   * Omitted when the host surface cannot run the editor geometry command.
   */
  onOutlineStrokes?: () => void;
}

const ACTIONS: Array<{
  action: ShapeBuilderAction;
  label: string;
  shortcut: string;
  title: string;
}> = [
  { action: 'merge', label: 'Merge', shortcut: 'M', title: 'Merge selected regions' },
  {
    action: 'erase',
    label: 'Erase',
    shortcut: 'E',
    title: 'Erase selected regions from their sources',
  },
  {
    action: 'extract',
    label: 'Extract',
    shortcut: 'X',
    title: 'Extract selected connected components',
  },
  {
    action: 'create',
    label: 'Create',
    shortcut: 'C',
    title: 'Create a result while retaining sources',
  },
  {
    action: 'divide',
    label: 'Divide',
    shortcut: 'D',
    title: 'Create one editable object per selected region',
  },
];

function pathForRings(
  rings: readonly (readonly { x: number; y: number }[])[],
  worldToCanvas: ShapeBuilderOverlayProps['worldToCanvas'],
): string {
  return rings
    .filter((ring) => ring.length >= 3)
    .map((ring) => {
      const points = ring.map((point) => worldToCanvas(point.x, point.y));
      return `M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`;
    })
    .join(' ');
}

function polylineForPoints(
  points: readonly { x: number; y: number }[],
  worldToCanvas: ShapeBuilderOverlayProps['worldToCanvas'],
): string {
  if (points.length < 2) return '';
  const projected = points.map((point) => worldToCanvas(point.x, point.y));
  return `M ${projected.map((point) => `${point.x} ${point.y}`).join(' L ')}`;
}

function componentKey(component: { outer: readonly { x: number; y: number }[] }): string {
  return component.outer.map((point) => `${point.x}:${point.y}`).join('|');
}

function modelSelection(
  model: ShapeBuilderModel,
  revision: string,
  selectedFaceIds: readonly string[],
) {
  if (model.revision !== revision || model.status !== 'ready') return [];
  const selected = new Set(selectedFaceIds);
  // Bounded empty faces are selectable for Create; they are not artwork, so
  // destructive actions filter them out again in the scene layer.
  return model.faces.filter(
    (face) => selected.has(face.id) && (face.selectable || face.filledBy.length === 0),
  );
}

export function ShapeBuilderOverlay({
  document: doc,
  selection,
  draft,
  canvasSize,
  worldToCanvas,
  onAction,
  onExit,
  onOutlineStrokes,
}: ShapeBuilderOverlayProps) {
  const selectionKey = selection.join('|');
  const model = useMemo(() => buildShapeBuilderModel(doc, selection), [doc, selectionKey]);
  const eligibility = useMemo(
    () => explainShapeBuilderEligibility(doc, selection),
    [doc, selectionKey],
  );
  const canOutlineStrokes =
    model.status === 'unsupported' &&
    eligibility.some((entry) => !entry.eligible && /outline the stroke/i.test(entry.reason ?? ''));
  const selectedFaceKey = draft.selectedFaceIds.join('|');
  const [previewAction, setPreviewAction] = useState<ShapeBuilderAction | null>(null);
  const selectedFaces = useMemo(
    () => modelSelection(model, draft.revision, draft.selectedFaceIds),
    [model, draft.revision, selectedFaceKey],
  );
  const selectedResult = useMemo(
    () =>
      previewShapeBuilderSelection(
        model,
        selectedFaces.map((face) => face.id),
        { includeEmpty: true },
      ),
    [model, selectedFaceKey],
  );
  const actionPreview = useMemo(
    () =>
      previewAction && selectedFaces.length > 0
        ? previewShapeBuilderAction(model, draft.selectedFaceIds, previewAction)
        : null,
    [draft.selectedFaceIds, model, previewAction, selectedFaceKey, selectedFaces.length],
  );
  const selectedIds = new Set(draft.selectedFaceIds);
  const hovered = model.faces.find((face) => face.id === draft.hoveredFaceId);
  const stale = model.revision !== draft.revision;
  const hasFilledSelection = selectedFaces.some((face) => face.selectable);
  const canApply = (action: ShapeBuilderAction): boolean =>
    model.status === 'ready' &&
    !stale &&
    (action === 'create' ? selectedFaces.length > 0 : hasFilledSelection);

  return (
    <>
      <svg
        data-testid="shape-builder-overlay"
        aria-hidden="true"
        width={canvasSize.width}
        height={canvasSize.height}
        viewBox={`0 0 ${Math.max(1, canvasSize.width)} ${Math.max(1, canvasSize.height)}`}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 65,
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        <defs>
          <pattern
            id="shape-builder-selection-pattern"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(35)"
          >
            <rect width="8" height="8" fill="rgba(35, 190, 178, 0.16)" />
            <path d="M 0 0 L 0 8" stroke="rgba(35, 190, 178, 0.9)" strokeWidth="2" />
          </pattern>
        </defs>
        {model.faces.map((face) => (
          <path
            key={face.id}
            d={pathForRings([face.outer, ...face.holes], worldToCanvas)}
            fill={
              selectedIds.has(face.id)
                ? 'url(#shape-builder-selection-pattern)'
                : face.selectable
                  ? 'rgba(35, 190, 178, 0.025)'
                  : 'rgba(120, 130, 145, 0.018)'
            }
            fillRule="evenodd"
            stroke={
              face.id === hovered?.id
                ? 'var(--color-canvas-selection)'
                : face.selectable
                  ? 'rgba(35, 190, 178, 0.62)'
                  : 'rgba(130, 140, 155, 0.4)'
            }
            strokeWidth={face.id === hovered?.id ? 2.5 : 1}
            strokeDasharray={face.selectable ? undefined : '5 4'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {(actionPreview?.output ?? selectedResult.components).map((component) => (
          <path
            key={`result-${componentKey(component)}`}
            d={pathForRings([component.outer, ...component.holes], worldToCanvas)}
            fill="rgba(35, 190, 178, 0.09)"
            fillRule="evenodd"
            stroke="var(--color-canvas-selection)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {actionPreview?.remainders.flatMap(({ sourceId, regions }) =>
          regions.map((region) => (
            <path
              key={`remainder-${sourceId}-${componentKey(region)}`}
              d={pathForRings([region.outer, ...region.holes], worldToCanvas)}
              fill="rgba(245, 158, 11, 0.035)"
              fillRule="evenodd"
              stroke="rgba(245, 158, 11, 0.9)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}
        {draft.sweep.length > 1 && (
          <path
            d={polylineForPoints(draft.sweep, worldToCanvas)}
            fill="none"
            stroke="var(--color-text-primary)"
            strokeOpacity="0.72"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <section
        data-testid="shape-builder-controls"
        aria-label="Shape Builder controls"
        style={{
          position: 'absolute',
          left: 16,
          bottom: 16,
          zIndex: 75,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          minWidth: 280,
          maxWidth: 360,
          padding: 'var(--space-3)',
          border: '1px solid var(--color-accent-primary)',
          borderRadius: 'var(--radius-surface)',
          background: 'var(--elevation-surface-raised)',
          color: 'var(--color-text-primary)',
          boxShadow: 'var(--shadow-lg)',
          pointerEvents: 'auto',
        }}
      >
        <div>
          <strong>Shape Builder</strong>
          <div
            data-testid="shape-builder-status"
            role="status"
            aria-live="polite"
            style={{
              marginTop: 'var(--space-1)',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {model.status === 'unsupported'
              ? model.message
              : stale
                ? 'Source geometry changed; move the pointer to refresh the preview.'
                : actionPreview
                  ? `Previewing ${previewAction}. Amber outlines show source remainders; teal shows the committed output.`
                  : selectedFaces.length > 0
                    ? hasFilledSelection
                      ? `${selectedFaces.length} region${selectedFaces.length === 1 ? '' : 's'} selected. Create retains sources; other actions rebuild them.`
                      : `${selectedFaces.length} empty region${selectedFaces.length === 1 ? '' : 's'} selected. Create fills ${selectedFaces.length === 1 ? 'it' : 'them'}; Merge, Erase, Extract, and Divide need a filled region.`
                    : 'Click a filled region or sweep across several regions.'}
          </div>
          {model.status === 'ready' && (
            <div
              data-testid="shape-builder-style-policy"
              style={{
                marginTop: 'var(--space-1)',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)',
              }}
            >
              Style: first selected source · Create retains sources
            </div>
          )}
        </div>
        {canOutlineStrokes && onOutlineStrokes && (
          <Button
            variant="secondary"
            data-testid="shape-builder-outline-strokes"
            onClick={onOutlineStrokes}
            style={{ minHeight: 32, alignSelf: 'flex-start' }}
          >
            Outline strokes and retry
          </Button>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
          {ACTIONS.map(({ action, label, shortcut, title }) => (
            <Button
              key={action}
              variant="secondary"
              disabled={!canApply(action)}
              aria-label={`${label} selected regions`}
              title={`${title} (${shortcut})`}
              onPointerEnter={() => setPreviewAction(action)}
              onFocus={() => setPreviewAction(action)}
              onPointerLeave={() => setPreviewAction(null)}
              onBlur={() => setPreviewAction(null)}
              onClick={() => onAction(action)}
              style={{ minWidth: 76, minHeight: 32 }}
            >
              {label} <span aria-hidden="true">({shortcut})</span>
            </Button>
          ))}
        </div>
        <Button variant="ghost" onClick={onExit} style={{ alignSelf: 'flex-start', minHeight: 32 }}>
          Exit Shape Builder (Esc)
        </Button>
      </section>
    </>
  );
}
