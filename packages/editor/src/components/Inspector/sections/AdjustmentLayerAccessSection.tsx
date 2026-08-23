/**
 * AdjustmentLayerAccessSection — discoverable entry point for scoped
 * adjustment layers. The layer remains a scene node, but creation starts from
 * the object/frame selection so the resulting scope is visible and predictable.
 */
import { isAdjustmentEligible, type SceneNode } from '@varve/scene';
import { Button } from '@varve/ui';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

import './adjustmentLayerAccess.css';

export interface AdjustmentLayerAccessSectionProps {
  nodes: SceneNode[];
}

export function AdjustmentLayerAccessSection({ nodes }: AdjustmentLayerAccessSectionProps) {
  const { createAdjustmentLayer } = useEditor();

  const targetDescription = useMemo(() => {
    if (nodes.length > 1) return `Affects the ${nodes.length} selected objects only.`;
    const node = nodes[0];
    if (!node) return '';
    if (node.kind === 'frame' || node.kind === 'group') {
      return `Affects the contents of ${node.name} only.`;
    }
    return `Affects ${node.name} only and stays with it when moved.`;
  }, [nodes]);

  if (
    nodes.length === 0 ||
    nodes.some((node) => node.kind === 'adjustment' || !isAdjustmentEligible(node))
  ) {
    return null;
  }

  return (
    <DisclosureSection title="Adjustment Layer" sectionId="adjustment-layer-access">
      <div className="insp-adjustment-access">
        <p className="insp-adjustment-access__description">{targetDescription}</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => createAdjustmentLayer()}
          aria-label={
            nodes.length === 1 && (nodes[0]?.kind === 'frame' || nodes[0]?.kind === 'group')
              ? `Add adjustment layer to ${nodes[0]?.name ?? 'container'}`
              : 'Add adjustment layer'
          }
        >
          Add adjustment layer
        </Button>
      </div>
    </DisclosureSection>
  );
}
