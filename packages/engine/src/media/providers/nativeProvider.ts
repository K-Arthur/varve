/**
 * Native decoder provider — Tauri IPC into `crates/varve-media`
 * (`media_decode_frames_binary`, raw body + options header). Primary
 * provider on desktop (WebKitGTK has no ImageDecoder).
 */

import { isTauriRuntime as isTauri } from '@varve/platform';
import type { MediaFormat } from '../types';
import type { DecodeRange, MediaDecoderProvider } from './types';

interface NativeDecodedFrameJson {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs: number;
  blend: 'source' | 'over';
  disposal: 'none' | 'background' | 'previous';
  preComposited: boolean;
  rgba_base64: string;
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i]! = binary.charCodeAt(i);
    return bytes;
  }
  // node (tests): Buffer is available
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

export const nativeMediaProvider: MediaDecoderProvider = {
  id: 'native-media',
  supports() {
    return true; // gif + apng + webp all native
  },
  isAvailable() {
    return isTauri();
  },
  async decodeFrames(bytes, range: DecodeRange, _format: MediaFormat, signal) {
    if (!isTauri()) throw new Error('Native media decode requires the desktop app');
    if (signal?.aborted) throw new Error('cancelled');
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<NativeDecodedFrameJson[]>(
      'media_decode_frames_binary',
      bytes.buffer as ArrayBuffer,
      {
        headers: {
          'x-varve-media-opts': JSON.stringify({ start: range.start, end: range.end }),
        },
      },
    );
    if (signal?.aborted) throw new Error('cancelled');
    return result.map((f: NativeDecodedFrameJson) => ({
      index: f.index,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      durationMs: f.durationMs,
      blend: f.blend,
      disposal: f.disposal,
      preComposited: f.preComposited,
      rgba: decodeBase64(f.rgba_base64),
    }));
  },
};
