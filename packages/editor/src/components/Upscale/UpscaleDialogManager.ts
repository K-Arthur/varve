/**
 * UpscaleDialogManager — singleton dialog controller for image upscaling.
 *
 * Follows the PromptDialog singleton pattern: a module-level setter lets
 * any caller open the dialog without prop-drilling. The dialog loads the
 * source image, shows a before/after preview, and applies the result.
 */

import type { UpscaleModeId } from '@strata/engine';

export interface UpscaleDialogOptions {
  /** Initial mode to select. */
  mode?: UpscaleModeId;
  /** Whether to replace the source image instead of creating a new layer. */
  replaceSource?: boolean;
}

type ResolveFn = (result: UpscaleDialogResult | null) => void;

interface UpscaleDialogState {
  options: UpscaleDialogOptions;
  resolve: ResolveFn;
}

export interface UpscaleDialogResult {
  mode: UpscaleModeId;
  scale: number;
  replaceSource: boolean;
}

let setState: ((s: UpscaleDialogState | null) => void) | null = null;

/**
 * Open the upscale dialog. Resolves with the chosen settings when the user
 * applies, or null when they cancel.
 */
export function openUpscaleDialog(
  options: UpscaleDialogOptions = {},
): Promise<UpscaleDialogResult | null> {
  return new Promise((resolve) => {
    if (setState) {
      setState({ options, resolve });
    } else {
      resolve(null);
    }
  });
}

export function UpscaleDialogManager() {
  // The actual dialog rendering is handled by UpscaleDialogHost,
  // which reads from this singleton via a custom event.
  return null;
}

export function useUpscaleDialogManager(
  onOpen: (options: UpscaleDialogOptions, resolve: ResolveFn) => void,
) {
  useEffect(() => {
    setState = (s) => {
      if (s) {
        onOpen(s.options, s.resolve);
      }
    };
    return () => {
      setState = null;
    };
  }, [onOpen]);
}

import { useEffect } from 'react';
