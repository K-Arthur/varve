import type { EffectStackKind } from '@varve/scene';

export type EffectStackInspectorTab = 'properties' | 'adjustments';
export type EffectStackInspectorSection = 'effects' | 'smart-filters';

export interface EffectStackInspectorTarget {
  tab: EffectStackInspectorTab;
  section: EffectStackInspectorSection;
  destinationLabel: string;
}

/**
 * Keep layer-row badges aligned with the editor that owns each persisted stack.
 * Object Filters are the editable implementation stack behind Effect Studio,
 * while Layer Effects are the separate appearance-stage effect model.
 */
export function getEffectStackInspectorTarget(kind: EffectStackKind): EffectStackInspectorTarget {
  if (kind === 'object-filters') {
    return {
      tab: 'adjustments',
      section: 'smart-filters',
      destinationLabel: 'Adjustments > Object Filters',
    };
  }

  return {
    tab: 'properties',
    section: 'effects',
    destinationLabel: 'Design > Layer Effects',
  };
}
