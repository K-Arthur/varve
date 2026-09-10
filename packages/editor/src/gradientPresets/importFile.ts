/**
 * Gradient preset file-picking + parsing bridge.
 *
 * Keeps the browser file picker thin: reads the file, then delegates to the
 * isolated `@varve/import` parser (never mutates document/library state).
 */
import {
  type GradientImportResult,
  importGradientPresets,
  toGradientImportError,
} from '@varve/import';

export interface PickedGradientFile {
  name: string;
  data: Uint8Array;
}

export type GradientFileParseResult =
  | { ok: true; result: GradientImportResult }
  | { ok: false; code: string; message: string };

/** Open a file picker for gradient preset files. Resolves null on cancel. */
export function openGradientFilePicker(): Promise<PickedGradientFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept =
      '.grd,.json,.varve-gradient.json,.varve-gradients.json,.strata-gradient.json,.strata-gradients.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file
        .arrayBuffer()
        .then((buf) => resolve({ name: file.name, data: new Uint8Array(buf) }));
    };
    input.click();
  });
}

/** Parse a picked gradient file into presets (no state mutation). */
export function parseGradientFile(file: PickedGradientFile): GradientFileParseResult {
  try {
    return { ok: true, result: importGradientPresets(file.data, file.name) };
  } catch (err) {
    const mapped = toGradientImportError(err);
    return { ok: false, code: mapped.code, message: mapped.message };
  }
}
