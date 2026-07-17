import { optimizeFlutter } from './flutter';
import { optimizeReact } from './react';
import { optimizeSwiftUI } from './swiftui';
import type { OptContext, OptimizationRule } from './types';

export type { OptContext, OptimizationResult, OptimizationRule } from './types';
export { createOptContext } from './types';

export function optimizeCode(code: string, platform: string, ctx: OptContext): string {
  if (ctx.verbose) return code;

  if (platform === 'flutter') {
    return optimizeFlutter(code) ?? code;
  }
  if (platform === 'swiftui') {
    return optimizeSwiftUI(code) ?? code;
  }
  if (platform === 'react' || platform === 'tailwind') {
    return optimizeReact(code) ?? code;
  }

  return code;
}

export function getRulesForPlatform(_platform: string): OptimizationRule[] {
  return [];
}
