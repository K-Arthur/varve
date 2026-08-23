/**
 * MediaContext — sub-context for animated-media playback (AGENTS.md
 * sub-context `onReady` pattern).
 *
 * The media clock is the global animated-media clock:
 *  - while the motion timeline plays, media time is slaved to
 *    `motion.currentTime` (one authoritative clock — scrubbing the ruler
 *    scrubs media)
 *  - otherwise the context drives its own RAF job via the coordinated
 *    editor frame scheduler
 * Playback never touches the document: no undo/autosave entries (the motion
 * tick precedent).
 */

import type { Document } from '@varve/scene';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { EditorState } from '../context/types';
import { createEditorFrameKey, requestEditorFrame } from '../performance/editorFrameRuntime';
import { createInitialMediaState, type MediaState } from '../state/media-state';
import {
  bridgeMediaCacheToRedraw,
  installMediaFrameResolver,
  syncMediaSessions,
  tickMediaPresentation,
} from './editorMediaRuntime';

export interface MediaContextValue {
  /** Start self-driven media playback (inspector play). */
  playMedia: () => void;
  /** Pause media playback. */
  pauseMedia: () => void;
  /** Toggle media playback. */
  toggleMedia: () => void;
  /** Seek media time (ms). */
  seekMedia: (timeMs: number) => void;
  /** Step to the previous/next source frame of the focused usage. */
  stepMediaFrame: (direction: 1 | -1) => void;
  /** Whether media playback is active. */
  isMediaPlaying: () => boolean;
  /** Current media time (ms). */
  mediaTime: () => number;
}

interface MediaProviderProps {
  children: ReactNode;
  state: EditorState;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
  stateRef: React.MutableRefObject<EditorState>;
  onReady?: (value: MediaContextValue) => void;
}

export function MediaProvider({
  children,
  state,
  setState,
  stateRef,
  onReady,
}: MediaProviderProps) {
  const frameKeyRef = useRef<string | null>(null);
  const playingRef = useRef(false);
  // Stepping loads the engine helpers asynchronously. A later command (for
  // example Play immediately after three keyboard steps) must invalidate an
  // older step result before it applies a stale seek that pauses playback.
  const commandVersionRef = useRef(0);

  const patch = useCallback(
    (partial: Partial<EditorState>) => setState((s) => ({ ...s, ...partial })),
    [setState],
  );

  const patchMedia = useCallback(
    (partial: Partial<MediaState>) => {
      patch({ media: { ...stateRef.current.media, ...partial } });
    },
    [patch, stateRef],
  );

  // Register sessions for animated assets whenever the document changes.
  useEffect(() => {
    installMediaFrameResolver();
    syncMediaSessions(state.document);
  }, [state.document]);

  // Motion sync: while the motion timeline plays, media follows motion time.
  useEffect(() => {
    const motion = stateRef.current.motion;
    if (motion.isPlaying && stateRef.current.media.source !== 'motion') {
      patchMedia({ source: 'motion', isPlaying: true, currentTime: motion.currentTime });
    }
    if (!motion.isPlaying && stateRef.current.media.source === 'motion') {
      patchMedia({ source: 'media', isPlaying: playingRef.current });
    }
  }, [state.document, stateRef, patchMedia, state.motion.isPlaying]);

  // Follow motion time while slaved (also primes frames + advances the
  // presented stamp — one authoritative clock, no second clock).
  useEffect(() => {
    if (state.media.source === 'motion' && state.media.isPlaying) {
      const time = stateRef.current.motion.currentTime;
      const stamp = tickMediaPresentation(stateRef.current.document, time);
      if (stamp !== stateRef.current.media.presentedStamp) {
        patchMedia({ currentTime: time, presentedStamp: stamp });
      }
    }
  }, [state.motion.currentTime, state.media.source, state.media.isPlaying, patchMedia, stateRef]);

  // Media-driven clock: one RAF job via the coordinated scheduler.
  useEffect(() => {
    if (state.media.source !== 'media' || !state.media.isPlaying) return;
    playingRef.current = true;
    const key = createEditorFrameKey('media');
    frameKeyRef.current = key;
    let lastTs: number | null = null;
    const tick = (timestamp: number): void => {
      if (stateRef.current.media.source !== 'media' || !stateRef.current.media.isPlaying) return;
      if (lastTs === null) {
        lastTs = timestamp;
      } else {
        const delta = Math.min(timestamp - lastTs, 100);
        lastTs = timestamp;
        const next = stateRef.current.media.currentTime + delta;
        patchMedia({ currentTime: next });
        const stamp = tickMediaPresentation(stateRef.current.document, next);
        patch({ media: { ...stateRef.current.media, presentedStamp: stamp } });
      }
      requestEditorFrame(key, 'canvas', tick);
    };
    requestEditorFrame(key, 'canvas', tick);
    return () => {
      playingRef.current = false;
      frameKeyRef.current = null;
    };
  }, [state.media.source, state.media.isPlaying, patchMedia, patch, stateRef]);

  const playMedia = useCallback(() => {
    commandVersionRef.current += 1;
    playingRef.current = true;
    const stamp = tickMediaPresentation(
      stateRef.current.document,
      stateRef.current.media.currentTime,
    );
    // Keep the playback transition and its presentation stamp in one state
    // update. Two queued updates built from stateRef.current can otherwise
    // let the second stale snapshot overwrite isPlaying=true before React
    // commits the first update.
    patch({
      media: {
        ...stateRef.current.media,
        isPlaying: true,
        source: 'media',
        presentedStamp: stamp,
      },
    });
  }, [patch, stateRef]);

  const pauseMedia = useCallback(() => {
    commandVersionRef.current += 1;
    playingRef.current = false;
    patchMedia({ isPlaying: false });
  }, [patchMedia]);

  const toggleMedia = useCallback(() => {
    if (stateRef.current.media.isPlaying) pauseMedia();
    else playMedia();
  }, [pauseMedia, playMedia, stateRef]);

  const seekMedia = useCallback(
    (timeMs: number) => {
      commandVersionRef.current += 1;
      const clamped = Math.max(0, timeMs);
      const stamp = tickMediaPresentation(stateRef.current.document, clamped);
      patch({
        media: {
          ...stateRef.current.media,
          currentTime: clamped,
          presentedStamp: stamp,
          isPlaying: false,
        },
      });
    },
    [patch, stateRef],
  );

  const stepMediaFrame = useCallback(
    (direction: 1 | -1) => {
      const media = stateRef.current.media;
      const commandVersion = ++commandVersionRef.current;
      void import('@varve/engine').then(({ frameIndexForTime, timeForFrame, buildFrameTiming }) => {
        if (commandVersion !== commandVersionRef.current) return;
        const doc = stateRef.current.document;
        if (!doc) return;
        // step on the first animated usage of the first selected animated node
        const selected = stateRef.current.selection;
        const targetId = selected.find((id) => {
          const node = doc.nodes[id];
          return node && isAnimatedUsage(node, doc);
        });
        if (!targetId) return;
        const node = doc.nodes[targetId]!;
        const fills = (node as { fills?: Array<{ type?: string; image?: { assetId?: string } }> })
          .fills;
        for (const fill of fills ?? []) {
          if (fill?.type !== 'image' || !fill.image?.assetId) continue;
          const asset = doc.assets?.[fill.image.assetId];
          const animated = asset?.animated as { frames: Array<{ durationMs: number }> } | undefined;
          if (!animated) continue;
          const timing = buildFrameTiming(animated.frames.map((f) => f.durationMs));
          const current = frameIndexForTime(timing, media.currentTime);
          const next = Math.max(0, Math.min(timing.frameCount - 1, current + direction));
          const { startMs } = timeForFrame(timing, next);
          seekMedia(startMs);
          return;
        }
      });
    },
    [seekMedia, stateRef],
  );

  const value = useMemo<MediaContextValue>(
    () => ({
      playMedia,
      pauseMedia,
      toggleMedia,
      seekMedia,
      stepMediaFrame,
      isMediaPlaying: () => stateRef.current.media.isPlaying,
      mediaTime: () => stateRef.current.media.currentTime,
    }),
    [playMedia, pauseMedia, toggleMedia, seekMedia, stepMediaFrame, stateRef],
  );

  useEffect(() => {
    onReady?.(value);
  }, [onReady, value]);

  // Bridge media frame-cache arrivals (async decode completion) to a redraw.
  useEffect(() => {
    const unsubscribe = bridgeMediaCacheToRedraw(() => {
      const stamp = tickMediaPresentation(
        stateRef.current.document,
        stateRef.current.media.currentTime,
      );
      if (stamp !== stateRef.current.media.presentedStamp) {
        patch({ media: { ...stateRef.current.media, presentedStamp: stamp } });
      }
    });
    return unsubscribe;
  }, [patch, stateRef]);

  return <MediaCtx.Provider value={value}>{children}</MediaCtx.Provider>;
}

function isAnimatedUsage(node: import('@varve/scene').SceneNode, doc: Document): boolean {
  const fills = (node as { fills?: Array<{ type?: string; image?: { assetId?: string } }> }).fills;
  return !!fills?.some(
    (fill) =>
      fill?.type === 'image' &&
      fill.image?.assetId !== undefined &&
      doc.assets?.[fill.image.assetId]?.animated !== undefined,
  );
}

const MediaCtx = createContext<MediaContextValue | null>(null);

/** No-op fallback before MediaProvider mounts (mirrors motion NOOP). */
const MEDIA_NOOP: MediaContextValue = {
  playMedia: () => {},
  pauseMedia: () => {},
  toggleMedia: () => {},
  seekMedia: () => {},
  stepMediaFrame: () => {},
  isMediaPlaying: () => false,
  mediaTime: () => 0,
};

export function useMedia(): MediaContextValue {
  return useContext(MediaCtx) ?? MEDIA_NOOP;
}

export { createInitialMediaState };
