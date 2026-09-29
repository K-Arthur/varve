import type { CoordSpace } from './dither';
import type { EffectQuality } from './quality';

export type LiveEffectKind =
  | 'dither'
  | 'paletteSnap'
  | 'bloom'
  | 'rgbSplit'
  | 'crt'
  | 'vhs'
  | 'lightShafts'
  | 'lensFlare'
  | 'lightLeak'
  | 'caustics';

export interface EffectDispatchRequest {
  effect: LiveEffectKind;
  width: number;
  height: number;
  /** Caller render tier ('auto' params resolve against it, as in the kernels). */
  quality: EffectQuality;
  coordSpace?: CoordSpace;
  params: Record<string, unknown>;
}

export interface LiveEffectProvider {
  readonly id: string;
  readonly label: string;
  isAvailable(): Promise<boolean>;
  apply(request: EffectDispatchRequest, rgba: Uint8ClampedArray): Promise<Uint8ClampedArray>;
}
