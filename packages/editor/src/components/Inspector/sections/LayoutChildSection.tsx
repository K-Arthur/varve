import type { LayoutAlign, LayoutPosition, LayoutSizing, SceneNode } from '@varve/scene';
import { getParent } from '@varve/scene';
import { Select } from '@varve/ui';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed } from '../selection/selectionState';
import { GridPlacementFields } from './GridPlacementFields';

const SIZING_OPTIONS: { value: LayoutSizing; label: string }[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'hug', label: 'Hug contents' },
  { value: 'fill', label: 'Fill container' },
  { value: 'relative', label: 'Relative %' },
];

const POSITION_OPTIONS: { value: LayoutPosition; label: string }[] = [
  { value: 'flow', label: 'Flow' },
  { value: 'absolute', label: 'Absolute' },
];

const ALIGN_OPTIONS: { value: LayoutAlign; label: string }[] = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'stretch', label: 'Stretch' },
];

/** Child-owned layout controls. Parent container controls stay in LayoutSection. */
export function LayoutChildSection({ nodes }: { nodes: SceneNode[] }) {
  const {
    setSelectedLayoutAlign,
    setSelectedLayoutPosition,
    setSelectedLayoutSizingHeight,
    setSelectedLayoutSizingWidth,
    setSelectedLayoutRelativeWidth,
    setSelectedLayoutRelativeHeight,
    setSelectedMinWidth,
    setSelectedMaxWidth,
    setSelectedMinHeight,
    setSelectedMaxHeight,
    state,
  } = useEditor();
  const parent = useMemo(() => {
    const parentIds = nodes.map((node) => getParent(state.document, node.id));
    if (parentIds.length === 0 || parentIds.some((id) => id !== parentIds[0])) return undefined;
    const candidate = parentIds[0] ? state.document.nodes[parentIds[0]] : undefined;
    return candidate?.kind === 'frame' && candidate.layoutStyle ? candidate : undefined;
  }, [nodes, state.document]);

  const hasAuthoredGridPlacement = nodes.some((node) => node.gridPlacement != null);
  if (!parent && !hasAuthoredGridPlacement) return null;
  const width = commonValue(
    nodes,
    (node) => node.layoutSizingWidth ?? node.layoutSizing ?? 'fixed',
  );
  const height = commonValue(
    nodes,
    (node) => node.layoutSizingHeight ?? node.layoutSizing ?? 'fixed',
  );
  const position = commonValue(nodes, (node) => node.layoutPosition ?? 'flow');
  const align = commonValue(nodes, (node) => node.layoutAlign ?? 'inherit');
  const minWidth = commonValue(nodes, (node) => node.minWidth);
  const maxWidth = commonValue(nodes, (node) => node.maxWidth);
  const minHeight = commonValue(nodes, (node) => node.minHeight);
  const maxHeight = commonValue(nodes, (node) => node.maxHeight);
  const relativeWidth = commonValue(nodes, (node) => node.layoutRelativeWidth);
  const relativeHeight = commonValue(nodes, (node) => node.layoutRelativeHeight);
  const draftKey = nodes
    .map((node) => node.id)
    .sort()
    .join(',');

  return (
    <DisclosureSection title="Layout child" sectionId="layout-child">
      {parent && (
        <>
          <FieldRow label="Position">
            <Select
              label="Layout position"
              value={isMixed(position) ? '' : position}
              placeholder={isMixed(position) ? 'Mixed' : undefined}
              options={POSITION_OPTIONS}
              onChange={(value) => setSelectedLayoutPosition(value as LayoutPosition)}
            />
          </FieldRow>
          <FieldRow label="Width">
            <Select
              label="Child width sizing"
              value={isMixed(width) ? '' : width}
              placeholder={isMixed(width) ? 'Mixed' : undefined}
              options={SIZING_OPTIONS}
              onChange={(value) => setSelectedLayoutSizingWidth(value as LayoutSizing)}
            />
          </FieldRow>
          <FieldRow label="Height">
            <Select
              label="Child height sizing"
              value={isMixed(height) ? '' : height}
              placeholder={isMixed(height) ? 'Mixed' : undefined}
              options={SIZING_OPTIONS}
              onChange={(value) => setSelectedLayoutSizingHeight(value as LayoutSizing)}
            />
          </FieldRow>
          <FieldRow label="Align">
            <Select
              label="Child cross-axis alignment override"
              value={isMixed(align) ? '' : align}
              placeholder={isMixed(align) ? 'Mixed' : undefined}
              options={ALIGN_OPTIONS}
              onChange={(value) => setSelectedLayoutAlign(value as LayoutAlign)}
            />
          </FieldRow>
          {!isMixed(width) && width === 'relative' && (
            <NumberField
              label="Width share"
              unit="%"
              value={isMixed(relativeWidth) ? 0 : (relativeWidth ?? 100)}
              mixed={isMixed(relativeWidth)}
              min={0}
              step={0.1}
              draftKey={`${draftKey}:relative-width`}
              onChange={setSelectedLayoutRelativeWidth}
            />
          )}
          {!isMixed(height) && height === 'relative' && (
            <NumberField
              label="Height share"
              unit="%"
              value={isMixed(relativeHeight) ? 0 : (relativeHeight ?? 100)}
              mixed={isMixed(relativeHeight)}
              min={0}
              step={0.1}
              draftKey={`${draftKey}:relative-height`}
              onChange={setSelectedLayoutRelativeHeight}
            />
          )}
          <NumberField
            label="Min W"
            unit="px"
            value={isMixed(minWidth) ? 0 : (minWidth ?? 0)}
            mixed={isMixed(minWidth)}
            min={0}
            disabled={!isMixed(width) && width === 'fixed'}
            draftKey={`${draftKey}:min-width`}
            onChange={setSelectedMinWidth}
          />
          <NumberField
            label="Max W"
            unit="px"
            value={isMixed(maxWidth) ? 0 : (maxWidth ?? 0)}
            mixed={isMixed(maxWidth)}
            min={0}
            disabled={!isMixed(width) && width === 'fixed'}
            draftKey={`${draftKey}:max-width`}
            onChange={setSelectedMaxWidth}
          />
          <NumberField
            label="Min H"
            unit="px"
            value={isMixed(minHeight) ? 0 : (minHeight ?? 0)}
            mixed={isMixed(minHeight)}
            min={0}
            disabled={!isMixed(height) && height === 'fixed'}
            draftKey={`${draftKey}:min-height`}
            onChange={setSelectedMinHeight}
          />
          <NumberField
            label="Max H"
            unit="px"
            value={isMixed(maxHeight) ? 0 : (maxHeight ?? 0)}
            mixed={isMixed(maxHeight)}
            min={0}
            disabled={!isMixed(height) && height === 'fixed'}
            draftKey={`${draftKey}:max-height`}
            onChange={setSelectedMaxHeight}
          />
          {((!isMixed(width) && width === 'fixed') || (!isMixed(height) && height === 'fixed')) && (
            <p className="insp-panel__color-mode-note" role="note">
              Fixed axes keep bounds for later mode changes; bounds are inactive until the axis
              becomes flexible.
            </p>
          )}
        </>
      )}
      <GridPlacementFields nodes={nodes} />
    </DisclosureSection>
  );
}
