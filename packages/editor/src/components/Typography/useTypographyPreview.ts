import { useCallback, useEffect, useRef } from 'react';
import type { TypographyTextChanges } from './typographyCommand';

export interface TypographyPreviewOptions {
  /** Start an undo transaction in presentation-only mode. */
  beginPreview?: () => void;
  /** Commit the active preview as one authored transaction. */
  commitPreview?: () => void;
  /** Restore the document captured before the active preview. */
  abortPreview?: () => void;
  /** Clear a preview when the editing target changes. */
  resetKey?: string;
}

/**
 * Keep font-family/face previews temporary across every typography surface.
 *
 * The callbacks are held in refs so a document render cannot accidentally
 * abort a live hover preview. A preview can only start when all transaction
 * boundaries are available; this prevents a late or partially wired surface
 * from applying a presentation edit without a reliable restore path.
 */
export function useTypographyPreview(
  applyChanges: (changes: TypographyTextChanges) => void,
  options: TypographyPreviewOptions = {},
) {
  const activeRef = useRef(false);
  const previousKeyRef = useRef(options.resetKey);
  const applyRef = useRef(applyChanges);
  const optionsRef = useRef(options);
  applyRef.current = applyChanges;
  optionsRef.current = options;

  const clearPreview = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    optionsRef.current.abortPreview?.();
  }, []);

  useEffect(() => {
    if (previousKeyRef.current !== options.resetKey) {
      previousKeyRef.current = options.resetKey;
      clearPreview();
    }
  }, [clearPreview, options.resetKey]);

  useEffect(() => clearPreview, [clearPreview]);

  const previewChanges = useCallback((changes: TypographyTextChanges) => {
    const current = optionsRef.current;
    if (!current.beginPreview || !current.commitPreview || !current.abortPreview) return;
    if (!activeRef.current) {
      current.beginPreview();
      activeRef.current = true;
    }
    applyRef.current(changes);
  }, []);

  const commitChanges = useCallback((changes: TypographyTextChanges) => {
    if (!activeRef.current) {
      applyRef.current(changes);
      return;
    }
    applyRef.current(changes);
    activeRef.current = false;
    optionsRef.current.commitPreview?.();
  }, []);

  return { previewChanges, commitChanges, clearPreview };
}
