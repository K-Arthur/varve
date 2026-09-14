import type { FontReference } from '@varve/engine/font';

/**
 * A face the runtime has actually registered and can apply to authored text.
 * Family names alone are intentionally insufficient for this contract: the
 * reference keeps collection members and same-family artifacts distinct.
 */
export interface FontFaceSelection {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  postScriptName?: string;
  fontReference?: FontReference;
  variableAxes?: Record<string, number>;
  namedInstanceName?: string;
}
