export interface OptimizationRule {
  id: string;
  platform: 'flutter' | 'swiftui' | 'react';
  apply(code: string, ctx: OptContext): string | null;
}

export interface OptContext {
  verbose: boolean;
}

export interface OptimizationResult {
  code: string;
  rulesApplied: string[];
}

export function createOptContext(verbose: boolean): OptContext {
  return { verbose };
}
