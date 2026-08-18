import type { LayoutPosition, LayoutSizing, SceneNode } from '@varve/scene';
import { getParent } from '@varve/scene';
import { Select } from '@varve/ui';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { commonValue, isMixed } from '../selection/selectionState';

const SIZING_OPTIONS: { value: LayoutSizing; label: string }[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'hug', label: 'Hug contents' },
  { value: 'fill', label: 'Fill container' },
];

const POSITION_OPTIONS: { value: LayoutPosition; label: string }[] = [
  { value: 'flow', label: 'Flow' },
  { value: 'absolute', label: 'Absolute' },
];

/** Child-owned layout controls. Parent container controls stay in LayoutSection. */
export function LayoutChildSection({ nodes }: { nodes: SceneNode[] }) {
  const {
    setSelectedLayoutPosition,
    setSelectedLayoutSizingHeight,
    setSelectedLayoutSizingWidth,
    state,
  } = useEditor();
  const parent = useMemo(() => {
    const parentIds = nodes.map((node) => getParent(state.document, node.id));
    if (parentIds.length === 0 || parentIds.some((id) => id !== parentIds[0])) return undefined;
    const candidate = parentIds[0] ? state.document.nodes[parentIds[0]] : undefined;
    return candidate?.kind === 'frame' && candidate.layoutStyle ? candidate : undefined;
  }, [nodes, state.document]);

  if (!parent) return null;
  const width = commonValue(
    nodes,
    (node) => node.layoutSizingWidth ?? node.layoutSizing ?? 'fixed',
  );
  const height = commonValue(
    nodes,
    (node) => node.layoutSizingHeight ?? node.layoutSizing ?? 'fixed',
  );
  const position = commonValue(nodes, (node) => node.layoutPosition ?? 'flow');

  return (
    <DisclosureSection title="Layout child" sectionId="layout-child">
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
    </DisclosureSection>
  );
}
