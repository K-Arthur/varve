/**
 * Video export scaffold — OffscreenCanvas frame loop + WebCodecs (Phase 4).
 *
 * Full MP4 muxing deferred; this module defines the export contract.
 */

export interface VideoTimelineRef {
  id: string;
  duration: number;
}

export interface VideoExportOptions {
  width: number;
  height: number;
  fps: number;
  codec?: 'h264' | 'vp9';
}

export interface VideoExportResult {
  /** Encoded video bytes when WebCodecs is available. */
  bytes: Uint8Array | null;
  frameCount: number;
  supported: boolean;
}

/**
 * Export a timeline to video frames.
 * Returns null bytes when WebCodecs/OffscreenCanvas unavailable (browser stub).
 */
export async function exportTimelineToVideo(
  _doc: unknown,
  timeline: VideoTimelineRef,
  options: VideoExportOptions,
): Promise<VideoExportResult> {
  const frameCount = Math.ceil((timeline.duration / 1000) * options.fps);
  const hasWebCodecs = typeof globalThis.VideoEncoder !== 'undefined';
  const hasOffscreen =
    typeof OffscreenCanvas !== 'undefined' || typeof HTMLCanvasElement !== 'undefined';

  return {
    bytes: null,
    frameCount,
    supported: hasWebCodecs && hasOffscreen,
  };
}
