import type { UpscaleOptions } from '../imageEnhancement';
import type { RasterTraceOptions, RasterTraceResult } from '../rasterTrace';

export interface UpscaleProvider {
  id: string;
  label: string;
  isAvailable(options: UpscaleOptions, signal?: AbortSignal): boolean | Promise<boolean>;
  upscale(imageData: ImageData, options: UpscaleOptions, signal?: AbortSignal): Promise<ImageData>;
  /**
   * Optional per-job metadata channel. Providers that can observe the actual
   * native/runtime executor implement this alongside `upscale`; the plain
   * method remains the compatibility contract for browser and older native
   * providers.
   */
  upscaleWithMetadata?(
    imageData: ImageData,
    options: UpscaleOptions,
    signal?: AbortSignal,
  ): Promise<UpscaleProviderResult>;
}

export interface UpscaleProviderResult {
  imageData: ImageData;
  /** The executor that produced this result, not merely the selected route. */
  executionProvider?: string;
}

export interface TraceProvider {
  id: string;
  label: string;
  isAvailable(options: RasterTraceOptions, signal?: AbortSignal): boolean | Promise<boolean>;
  trace(
    imageData: ImageData,
    options: RasterTraceOptions,
    signal?: AbortSignal,
  ): Promise<RasterTraceResult>;
}
