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
import { NumberField } from '../controls/NumberField';

interface HalftoneState {
  type: 'none' | 'halftone';
  pattern: 'dot' | 'line' | 'cross' | 'circle';
  frequency: number;
  angle: number;
  dotShape: 'round' | 'elliptical' | 'square' | 'diamond' | 'line';
  channel: 'k' | 'c' | 'm' | 'y' | 'cmyk';
  method: 'am' | 'fm';
}

export interface HalftoneSectionProps {
  nodes: SceneNode[];
}

const PATTERN_OPTIONS: { value: string; label: string }[] = [
  { value: 'dot', label: 'Dot' },
  { value: 'line', label: 'Line' },
  { value: 'cross', label: 'Cross' },
  { value: 'circle', label: 'Circle' },
];

const DOT_SHAPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'round', label: 'Round' },
  { value: 'elliptical', label: 'Elliptical' },
  { value: 'square', label: 'Square' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'line', label: 'Line' },
];

const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'k', label: 'Black (K)' },
  { value: 'c', label: 'Cyan (C)' },
  { value: 'm', label: 'Magenta (M)' },
  { value: 'y', label: 'Yellow (Y)' },
  { value: 'cmyk', label: 'CMYK' },
];

const METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'am', label: 'AM (Traditional)' },
  { value: 'fm', label: 'FM (Stochastic)' },
];

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
    <DisclosureSection label="Halftone" defaultOpen={false}>
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
