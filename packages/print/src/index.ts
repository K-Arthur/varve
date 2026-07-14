/**
 * @strata/print — TS facade over the strata-print crate.
 *
 * Mirrors the @strata/engine facade pattern: use `createPrintEngine('auto')`
 * to select the native engine when running in Tauri, falling back to the stub
 * for tests and browser-only environments.
 *
 * Research basis: same facade pattern as `createEngine()` in @strata/engine
 * (see packages/engine/src/engine.ts).
 */

import { createStubPrintEngine } from './stub';
import type { PrintEngine } from './types';

export { createNativePrintEngine } from './native';
export { createStubPrintEngine } from './stub';
export type { PdfExportOptions, PdfResult, PrintEngine } from './types';

export {
  createColourEngineFromModule,
  loadColourWasmModule,
  prewarmColourWasm,
} from './colourLoader';
export type { ColourEngine } from './colourLoader';

export const PACKAGE = '@strata/print' as const;

export async function createPrintEngine(
  backend: 'auto' | 'native' | 'stub' = 'auto',
): Promise<PrintEngine> {
  if (backend === 'native') {
    const { createNativePrintEngine } = await import('./native');
    return createNativePrintEngine();
  }
  if (backend === 'stub') {
    return createStubPrintEngine();
  }
  // 'auto': try native, fall back to stub
  try {
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
      const { createNativePrintEngine } = await import('./native');
      return createNativePrintEngine();
    }
  } catch {
    // Not in Tauri
  }
  return createStubPrintEngine();
}
