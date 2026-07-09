/**
 * Strategy interface for background-removal inference backends.
 * Each provider implements one execution path (Worker ONNX, Tauri IPC, etc.).
 */
import type { BackgroundRemovalOptions, BackgroundRemovalResult } from '../types';

export interface RemovalProvider {
  readonly id: string;
  /** Whether this provider can run in the current environment for the given options. */
  isAvailable(options: BackgroundRemovalOptions, signal?: AbortSignal): boolean | Promise<boolean>;
  remove(
    imageData: ImageData,
    options: BackgroundRemovalOptions,
    signal?: AbortSignal,
  ): Promise<BackgroundRemovalResult>;
}
