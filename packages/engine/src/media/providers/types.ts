/**
 * Decoder provider contract.
 *
 * A provider decodes *source frames* (rect-sized RGBA + disposal/blend
 * hints) for one or more animated formats. Providers that cannot expose raw
 * frames (WebP, Chromium ImageDecoder) return `preComposited` full canvases
 * which the shared compositor pastes verbatim — composition semantics stay
 * in exactly one place regardless of provider.
 */

import type { DecodedSourceFrame, MediaFormat } from '../types';

export interface DecodeRange {
  start: number;
  end: number;
}

export interface MediaDecoderProvider {
  readonly id: string;
  /** Formats this provider can decode at all (capability, sync). */
  supports(format: MediaFormat): boolean;
  /** Runtime availability for a format (async capability check). */
  isAvailable(format: MediaFormat, signal?: AbortSignal): Promise<boolean> | boolean;
  /** Decode source frames `[start, end]` (inclusive). */
  decodeFrames(
    bytes: Uint8Array,
    range: DecodeRange,
    format: MediaFormat,
    signal?: AbortSignal,
  ): Promise<DecodedSourceFrame[]>;
}
