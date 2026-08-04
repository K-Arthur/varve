/**
 * @varve/print — TS facade over the strata-print crate.
 *
 * Mirrors the @varve/engine facade pattern: use `createPrintEngine('auto')`
 * to select the native engine when running in Tauri, falling back to the stub
 * for tests and browser-only environments.
 *
 * Research basis: same facade pattern as `createEngine()` in @varve/engine
 * (see packages/engine/src/engine.ts).
 */

import { isTauriRuntime } from '@varve/platform';
import { createStubPrintEngine } from './stub';
import type { PrintEngine } from './types';

export type { ColourEngine, ColourWasmModule } from './colourLoader';
export {
  createColourEngineFromModule,
  loadColourWasmModule,
  prewarmColourWasm,
} from './colourLoader';
export { createNativePrintEngine } from './native';
export { createStubPrintEngine } from './stub';
export type { PdfExportOptions, PdfResult, PrintEngine } from './types';

export const PACKAGE = '@varve/print' as const;

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
    if (isTauriRuntime()) {
      const { createNativePrintEngine } = await import('./native');
      return createNativePrintEngine();
    }
  } catch {
    // Not in Tauri
  }
  return createStubPrintEngine();
}
