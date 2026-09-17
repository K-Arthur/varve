import type { GridItemPlacement, SceneNode } from '@varve/scene';
import { getParent } from '@varve/scene';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { InspectorFieldGroup } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed } from '../selection/selectionState';
import './GridPlacementFields.css';

/**
 * Grid item placement is a child capability, not a property of every frame.
 * Keep the fields in one small, reusable surface so frame children and other
 * grid-capable nodes get the same labels, value semantics, and geometry.
 */
export function GridPlacementFields({ nodes }: { nodes: SceneNode[] }) {
  const { state, setSelectedGridPlacement } = useEditor();
  const parent = useMemo(() => {
    const parentIds = nodes.map((node) => getParent(state.document, node.id));
    if (parentIds.length === 0 || parentIds.some((id) => id !== parentIds[0])) return undefined;
    const candidate = parentIds[0] ? state.document.nodes[parentIds[0]] : undefined;
    return candidate?.kind === 'frame' ? candidate : undefined;
  }, [nodes, state.document]);

  const hasGridParent = parent?.layoutStyle?.mode === 'grid';
  const hasAuthoredPlacement = nodes.some((node) => node.gridPlacement != null);
  if (!hasGridParent && !hasAuthoredPlacement) return null;

  const gridColumnStart = commonValue(nodes, (node) => node.gridPlacement?.gridColumnStart);
  const gridColumnEnd = commonValue(nodes, (node) => node.gridPlacement?.gridColumnEnd);
  const gridRowStart = commonValue(nodes, (node) => node.gridPlacement?.gridRowStart);
  const gridRowEnd = commonValue(nodes, (node) => node.gridPlacement?.gridRowEnd);

  const patchGrid = (partial: Partial<GridItemPlacement>) => {
    const base: GridItemPlacement = {
      gridColumnStart: !isMixed(gridColumnStart) ? gridColumnStart : undefined,
      gridColumnEnd: !isMixed(gridColumnEnd) ? gridColumnEnd : undefined,
      gridRowStart: !isMixed(gridRowStart) ? gridRowStart : undefined,
      gridRowEnd: !isMixed(gridRowEnd) ? gridRowEnd : undefined,
    };
    setSelectedGridPlacement({ ...base, ...partial });
  };

  const draftKey = nodes
    .map((node) => node.id)
    .sort()
    .join(',');

  return (
    <div className="insp-grid-placement">
      <div className="insp-grid-placement__title">Grid placement</div>
      {!hasGridParent && hasAuthoredPlacement && (
        <p className="insp-panel__color-mode-note" role="note">
          This placement is stored on the layer and will apply when it is inside a grid frame.
        </p>
      )}
      <InspectorFieldGroup columns={2} className="insp-grid-placement__fields">
        <NumberField
          label="Column start"
          value={isMixed(gridColumnStart) ? 0 : (gridColumnStart ?? 0)}
          mixed={isMixed(gridColumnStart)}
          min={0}
          labelWrap
          draftKey={`${draftKey}:grid-column-start`}
          onChange={(value) => patchGrid({ gridColumnStart: value || undefined })}
        />
        <NumberField
          label="Column end"
          value={isMixed(gridColumnEnd) ? 0 : (gridColumnEnd ?? 0)}
          mixed={isMixed(gridColumnEnd)}
          min={0}
          labelWrap
          draftKey={`${draftKey}:grid-column-end`}
          onChange={(value) => patchGrid({ gridColumnEnd: value || undefined })}
        />
        <NumberField
          label="Row start"
          value={isMixed(gridRowStart) ? 0 : (gridRowStart ?? 0)}
          mixed={isMixed(gridRowStart)}
          min={0}
          labelWrap
          draftKey={`${draftKey}:grid-row-start`}
          onChange={(value) => patchGrid({ gridRowStart: value || undefined })}
        />
        <NumberField
          label="Row end"
          value={isMixed(gridRowEnd) ? 0 : (gridRowEnd ?? 0)}
          mixed={isMixed(gridRowEnd)}
          min={0}
          labelWrap
          draftKey={`${draftKey}:grid-row-end`}
          onChange={(value) => patchGrid({ gridRowEnd: value || undefined })}
        />
      </InspectorFieldGroup>
    </div>
  );
}
