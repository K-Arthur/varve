import type { OptContext } from './types';

export function isRelevant(platform: string, expected: string): boolean {
  return platform === expected;
}

export function nullIfVerbose(ctx: OptContext): string | null {
  return ctx.verbose ? null : (undefined as unknown as string);
}

export function replaceAll(code: string, pattern: RegExp, replacement: string): string {
  return code.replace(pattern, replacement);
}

export function extractLines(code: string): string[] {
  return code.split('\n');
}

export function joinLines(lines: string[]): string {
  return lines.join('\n');
}
