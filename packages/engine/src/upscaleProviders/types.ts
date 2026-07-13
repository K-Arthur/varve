import type { UpscaleOptions } from '../imageEnhancement';
import type { RasterTraceOptions, RasterTraceResult } from '../rasterTrace';

export interface UpscaleProvider {
  id: string;
  label: string;
  isAvailable(options: UpscaleOptions, signal?: AbortSignal): boolean | Promise<boolean>;
  upscale(imageData: ImageData, options: UpscaleOptions, signal?: AbortSignal): Promise<ImageData>;
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
