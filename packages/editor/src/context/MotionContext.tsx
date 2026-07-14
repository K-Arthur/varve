import type { Document, SceneNode } from '@strata/scene';
import {
  addKeyframe,
  addTimelineMarker as addTimelineMarkerDoc,
  addTrack,
  applyMotionPreset as applyMotionPresetDoc,
  createMotionPreset as createMotionPresetDoc,
  createTimeline as createTimelineDoc,
  getNestedValue,
  removeTimeline as removeTimelineDoc,
  removeTimelineMarker as removeTimelineMarkerDoc,
  removeTrack as removeTrackDoc,
  renameTimeline as renameTimelineDoc,
  renameTimelineMarker as renameTimelineMarkerDoc,
  setActiveTimeline as setActiveTimelineDoc,
} from '@strata/scene';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { MotionFacade } from '../motion/MotionFacade';
import type { EditorState } from './types';

export interface MotionContextValue {
  playTimeline: (timelineId?: string) => void;
  pauseTimeline: () => void;
  stopTimeline: () => void;
  seekTimeline: (time: number) => void;
  setActiveTimeline: (id: string | null) => void;
  setPlaybackSpeed: (speed: number) => void;
  toggleLoop: () => void;
  addKeyframeToSelected: (property: string) => void;
  createTimeline: (name?: string, duration?: number) => string;
  removeTimeline: (id: string) => void;
  renameTimeline: (id: string, name: string) => void;
  removeTrack: (timelineId: string, trackId: string) => void;
  toggleTimelinePanel: () => void;
  addTimelineMarker: (timelineId: string, name: string, progress: number) => void;
  removeTimelineMarker: (timelineId: string, markerId: string) => void;
  renameTimelineMarker: (timelineId: string, markerId: string, name: string) => void;
  createMotionPresetFromTimeline: (timelineId: string, name: string) => string;
  applyMotionPreset: (presetId: string, timelineId: string) => void;
  toggleAutoKeyframe: () => void;
}

const MotionCtx = createContext<MotionContextValue | null>(null);

export function useMotion(): MotionContextValue {
  const ctx = useContext(MotionCtx);
  if (!ctx) throw new Error('useMotion must be used within EditorProvider');
  return ctx;
}

interface MotionProviderProps {
  children: ReactNode;
  state: EditorState;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
  stateRef: React.MutableRefObject<EditorState>;
  updateDoc: (fn: (doc: Document) => Document) => void;
  invalidateSamplerCache: () => void;
  onReady?: (value: MotionContextValue) => void;
}

export function MotionProvider({
  children,
  state,
  setState,
  stateRef,
  updateDoc,
  invalidateSamplerCache,
  onReady,
}: MotionProviderProps) {
  const motionFacadeRef = useRef<MotionFacade | null>(null);

  const patch = useCallback(
    (partial: Partial<EditorState>) => setState((s) => ({ ...s, ...partial })),
    [setState],
  );

  const playTimeline = useCallback(
    (timelineId?: string) => {
      const s = stateRef.current;
      const tlId = timelineId ?? s.motion.activeTimelineId;
      if (!tlId) return;
      const timeline = s.document.timelines?.[tlId];
      if (!timeline) return;

      let facade = motionFacadeRef.current;
      if (!facade) {
        facade = new MotionFacade({
          onFrame: (time) => {
            patch({ motion: { ...stateRef.current.motion, currentTime: time } });
          },
          onFinish: () => {
            patch({ motion: { ...stateRef.current.motion, isPlaying: false } });
          },
        });
        motionFacadeRef.current = facade;
      }

      facade.setLoop(s.motion.loop);
      facade.setSpeed(s.motion.playbackSpeed);
      facade.play(timeline);
      patch({ motion: { ...s.motion, isPlaying: true, activeTimelineId: tlId } });
    },
    [patch, stateRef],
  );

  const pauseTimeline = useCallback(() => {
    motionFacadeRef.current?.pause();
    patch({ motion: { ...stateRef.current.motion, isPlaying: false } });
  }, [patch, stateRef]);

  const stopTimeline = useCallback(() => {
    motionFacadeRef.current?.stop();
    patch({ motion: { ...stateRef.current.motion, isPlaying: false, currentTime: 0 } });
  }, [patch, stateRef]);

  const seekTimeline = useCallback(
    (time: number) => {
      const clamped = Math.max(0, time);
      motionFacadeRef.current?.seek(clamped);
      patch({ motion: { ...stateRef.current.motion, currentTime: clamped } });
    },
    [patch, stateRef],
  );

  const setActiveTimeline = useCallback(
    (id: string | null) => {
      updateDoc((doc) => setActiveTimelineDoc(doc, id));
      motionFacadeRef.current?.stop();
      patch({
        motion: {
          ...stateRef.current.motion,
          activeTimelineId: id,
          currentTime: 0,
          isPlaying: false,
        },
      });
    },
    [patch, stateRef, updateDoc],
  );

  const setPlaybackSpeed = useCallback(
    (speed: number) => {
      motionFacadeRef.current?.setSpeed(speed);
      patch({ motion: { ...stateRef.current.motion, playbackSpeed: speed } });
    },
    [patch, stateRef],
  );

  const toggleLoop = useCallback(() => {
    const nextLoop = !stateRef.current.motion.loop;
    motionFacadeRef.current?.setLoop(nextLoop);
    patch({ motion: { ...stateRef.current.motion, loop: nextLoop } });
  }, [patch, stateRef]);

  const addKeyframeToSelected = useCallback(
    (property: string) => {
      const tlId = state.motion.activeTimelineId;
      if (!tlId || state.selection.length === 0) return;
      updateDoc((doc) => {
        let d = doc;
        const timeline = d.timelines?.[tlId];
        if (!timeline) return d;
        const progress = timeline.duration > 0 ? state.motion.currentTime / timeline.duration : 0;
        for (const nodeId of state.selection) {
          const node = d.nodes[nodeId];
          if (!node) continue;
          const existingTrack = timeline.tracks.find(
            (t) => t.nodeId === nodeId && t.property === property,
          );
          if (existingTrack) {
            d = addKeyframe(d, tlId, existingTrack.id, {
              progress,
              value: getPropertyValueAt(node, property),
            });
          } else {
            const { doc: d2, trackId } = addTrack(d, tlId, nodeId, property);
            d = addKeyframe(d2, tlId, trackId, {
              progress,
              value: getPropertyValueAt(node, property),
            });
          }
        }
        return d;
      });
      invalidateSamplerCache();
    },
    [
      state.motion.activeTimelineId,
      state.motion.currentTime,
      state.selection,
      updateDoc,
      invalidateSamplerCache,
    ],
  );

  const createTimeline = useCallback(
    (name = 'Timeline 1', duration = 5000) => {
      let newId = '';
      updateDoc((doc) => {
        const { doc: next, id } = createTimelineDoc(doc, name, duration);
        newId = id;
        return setActiveTimelineDoc(next, id);
      });
      invalidateSamplerCache();
      motionFacadeRef.current?.stop();
      patch({
        motion: {
          ...stateRef.current.motion,
          activeTimelineId: newId,
          currentTime: 0,
          isPlaying: false,
        },
      });
      return newId;
    },
    [patch, stateRef, updateDoc, invalidateSamplerCache],
  );

  const removeTimeline = useCallback(
    (id: string) => {
      const wasActive = stateRef.current.motion.activeTimelineId === id;
      updateDoc((doc) => removeTimelineDoc(doc, id));
      invalidateSamplerCache();
      if (wasActive) {
        motionFacadeRef.current?.stop();
        patch({
          motion: {
            ...stateRef.current.motion,
            activeTimelineId: null,
            currentTime: 0,
            isPlaying: false,
          },
        });
      }
    },
    [patch, stateRef, updateDoc, invalidateSamplerCache],
  );

  const renameTimeline = useCallback(
    (id: string, name: string) => {
      updateDoc((doc) => renameTimelineDoc(doc, id, name));
    },
    [updateDoc],
  );

  const removeTrack = useCallback(
    (timelineId: string, trackId: string) => {
      updateDoc((doc) => removeTrackDoc(doc, timelineId, trackId));
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const addTimelineMarker = useCallback(
    (timelineId: string, name: string, progress: number) => {
      const markerId = `mk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      updateDoc((doc) => addTimelineMarkerDoc(doc, timelineId, { id: markerId, name, progress }));
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const removeTimelineMarker = useCallback(
    (timelineId: string, markerId: string) => {
      updateDoc((doc) => removeTimelineMarkerDoc(doc, timelineId, markerId));
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const renameTimelineMarker = useCallback(
    (timelineId: string, markerId: string, name: string) => {
      updateDoc((doc) => renameTimelineMarkerDoc(doc, timelineId, markerId, name));
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const createMotionPresetFromTimeline = useCallback(
    (timelineId: string, name: string) => {
      let presetId = '';
      updateDoc((doc) => {
        const { doc: next, id } = createMotionPresetDoc(doc, timelineId, name);
        presetId = id;
        return next;
      });
      invalidateSamplerCache();
      return presetId;
    },
    [updateDoc, invalidateSamplerCache],
  );

  const applyMotionPreset = useCallback(
    (presetId: string, timelineId: string) => {
      updateDoc((doc) => applyMotionPresetDoc(doc, presetId, timelineId));
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const toggleAutoKeyframe = useCallback(() => {
    patch({
      motion: {
        ...stateRef.current.motion,
        autoKeyframe: !stateRef.current.motion.autoKeyframe,
      },
    });
  }, [patch, stateRef]);

  const toggleTimelinePanel = useCallback(() => {
    patch({ timelinePanelVisible: !stateRef.current.timelinePanelVisible });
  }, [patch, stateRef]);

  const value = useMemo<MotionContextValue>(
    () => ({
      playTimeline,
      pauseTimeline,
      stopTimeline,
      seekTimeline,
      setActiveTimeline,
      setPlaybackSpeed,
      toggleLoop,
      addKeyframeToSelected,
      createTimeline,
      removeTimeline,
      renameTimeline,
      removeTrack,
      toggleTimelinePanel,
      addTimelineMarker,
      removeTimelineMarker,
      renameTimelineMarker,
      createMotionPresetFromTimeline,
      applyMotionPreset,
      toggleAutoKeyframe,
    }),
    [
      playTimeline,
      pauseTimeline,
      stopTimeline,
      seekTimeline,
      setActiveTimeline,
      setPlaybackSpeed,
      toggleLoop,
      addKeyframeToSelected,
      createTimeline,
      removeTimeline,
      renameTimeline,
      removeTrack,
      toggleTimelinePanel,
      addTimelineMarker,
      removeTimelineMarker,
      renameTimelineMarker,
      createMotionPresetFromTimeline,
      applyMotionPreset,
      toggleAutoKeyframe,
    ],
  );

  useEffect(() => {
    onReady?.(value);
  }, [value, onReady]);

  return <MotionCtx.Provider value={value}>{children}</MotionCtx.Provider>;
}

/** Extract a property value from a scene node for keyframe storage. */
function getPropertyValueAt(node: SceneNode, property: string): unknown {
  if (property === 'opacity') return node.opacity;
  if (property === 'rotation') return node.rotation;
  if (property === 'fill' || property.startsWith('fill[')) return node.fill;
  if (property === 'transform' || property.startsWith('transform[')) {
    const t = (node as import('@strata/scene').ShapeNode).transform;
    return t ?? [1, 0, 0, 1, 0, 0];
  }
  if ('w' in node && property === 'w') return (node as import('@strata/scene').FrameNode).w;
  if ('h' in node && property === 'h') return (node as import('@strata/scene').FrameNode).h;
  if (property === 'fontSize' && 'fontSize' in node)
    return (node as import('@strata/scene').TextNode).fontSize;
  return getNestedValue(node as unknown as Record<string, unknown>, property.split('.')) ?? 0;
}
