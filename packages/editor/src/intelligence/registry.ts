export type IntelligenceCategory =
  | 'audit'
  | 'debt'
  | 'naming'
  | 'spacing'
  | 'governance'
  | 'layout'
  | 'components'
  | 'prototype'
  | 'export';

export interface IntelligenceFeature {
  id: string;
  name: string;
  category: IntelligenceCategory;
  description: string;
  run: () => void;
  autoFix?: () => void;
}

const registry = new Map<string, IntelligenceFeature>();

export function registerFeature(feature: IntelligenceFeature): void {
  registry.set(feature.id, feature);
}

export function getFeature(id: string): IntelligenceFeature | undefined {
  return registry.get(id);
}

export function getAllFeatures(): IntelligenceFeature[] {
  return [...registry.values()];
}

export function getFeaturesByCategory(category: IntelligenceCategory): IntelligenceFeature[] {
  return [...registry.values()].filter((f) => f.category === category);
}

export function unregisterFeature(id: string): boolean {
  return registry.delete(id);
}

export function clearRegistry(): void {
  registry.clear();
}
