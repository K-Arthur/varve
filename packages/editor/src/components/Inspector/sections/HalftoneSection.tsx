/**
 * HalftoneSection — halftone adjustment controls for the Inspector.
 *
 * Controls: pattern type, LPI frequency, screen angle, dot shape,
 * channel selection, AM/FM method toggle.
 *
 * Research basis: Adobe Color Halftone, ISO 12647-2 screen angles.
 */
import type { SceneNode } from '@strata/scene';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';

export interface HalftoneSectionProps {
  nodes: SceneNode[];
}

export function HalftoneSection({ nodes }: HalftoneSectionProps): React.ReactNode {
  // For now: read-only display. Interactive controls deferred to Phase 2.5 full UI.
  const hasHalftone = nodes.some(
    (n) =>
      'filters' in n &&
      Array.isArray((n as Record<string, unknown>).filters) &&
      ((n as Record<string, unknown>).filters as Array<Record<string, unknown>>).some(
        (f) => f.kind === 'halftone',
      ),
  );

  return (
    <DisclosureSection title="Halftone" defaultExpanded={false}>
      <FieldRow label="Status">
        <span>{hasHalftone ? 'Active' : 'Not applied'}</span>
      </FieldRow>
      {!hasHalftone && (
        <FieldRow label="Info">
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
            Add a halftone adjustment filter to apply AM or FM screening.
          </span>
        </FieldRow>
      )}
    </DisclosureSection>
  );
}
