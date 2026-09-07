import { getEffectStudioTreatment } from '@varve/engine';
import { canHaveSmartFilters, type SceneNode } from '@varve/scene';
import { useMemo } from 'react';
import { EffectStudioLauncher } from '../../EffectStudio/EffectStudioLauncher';
import { DisclosureSection } from '../controls/DisclosureSection';

/**
 * Compact entry point for the full Effect Studio modal. The modal owns the
 * gallery, comparison, and recipe tuning; this section keeps the Adjustments
 * inspector useful without duplicating that long workspace inline.
 */
export function EffectStudioAccessSection({ nodes }: { nodes: SceneNode[] }) {
  const appliedNames = useMemo(() => {
    const ids = new Set(
      nodes.flatMap((node) =>
        (node.smartFilters ?? [])
          .map((filter) => filter.studioTreatment?.treatmentId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    return [...ids]
      .map((id) => getEffectStudioTreatment(id)?.name)
      .filter((name): name is string => Boolean(name));
  }, [nodes]);

  if (nodes.length === 0 || !nodes.every(canHaveSmartFilters)) return null;

  return (
    <DisclosureSection title="Effect Studio" id="effect-studio-adjustments" defaultExpanded>
      <div className="insp-adjustment-access">
        <p className="insp-adjustment-access__description">
          Browse and tune the full creative treatment gallery in the Studio modal. The editable
          Object Filter stack remains available below for direct parameter, order, opacity, and
          blend control.
        </p>
        {appliedNames.length > 0 && (
          <p className="insp-adjustment-access__description">
            Applied treatments: <strong>{appliedNames.join(', ')}</strong>
          </p>
        )}
        <EffectStudioLauncher label="Open Effect Studio" />
      </div>
    </DisclosureSection>
  );
}
