/**
 * Per-feature version tracking for new feature badges.
 */

export const FEATURE_VERSIONS: Record<string, string> = {
  'tool:pen': '0.6.0',
  'tool:pencil': '0.6.0',
  'tool:nodeEdit': '0.6.0',
  'tool:arrow': '0.5.0',
  'adjustment-layers': '0.6.0',
  'prototype-transitions': '0.6.0',
  'print-export': '0.7.0',
  variables: '0.7.0',
  intelligence: '0.8.0',
  'onboarding-tutorial': '0.8.0',
  'contextual-help': '0.8.0',
};

export const CURRENT_APP_VERSION = '0.8.0';

/** Compare two semver strings. Returns negative if a < b, positive if a > b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}
