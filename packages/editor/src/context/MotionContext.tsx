import type { Document, NodeId, SceneNode } from '@varve/scene';
import {
  addKeyframe,
  addTimelineMarker as addTimelineMarkerDoc,
  addTrack,
  applyMotionPreset as applyMotionPresetDoc,
  createMotionPreset as createMotionPresetDoc,
  createTimeline as createTimelineDoc,
  getNestedValue,
  removeKeyframe as removeKeyframeDoc,
  removeTimeline as removeTimelineDoc,
  removeTimelineMarker as removeTimelineMarkerDoc,
  removeTrack as removeTrackDoc,
  renameTimeline as renameTimelineDoc,
  renameTimelineMarker as renameTimelineMarkerDoc,
  setActiveTimeline as setActiveTimelineDoc,
  updateKeyframe as updateKeyframeDoc,
  updateTrack as updateTrackDoc,
} from '@varve/scene';
import type { EasingDefinition } from '@varve/shared';
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

  // Motion Mode — graph editor + keyframe editing
  toggleGraphEditor: () => void;
  setGraphEditorProperty: (property: string | null) => void;
  deleteKeyframe: (timelineId: string, trackId: string, progress: number) => void;
  moveKeyframe: (
    timelineId: string,
    trackId: string,
    oldProgress: number,
    newProgress: number,
  ) => void;
  duplicateKeyframe: (timelineId: string, trackId: string, progress: number) => void;
  updateKeyframeEasing: (
    timelineId: string,
    trackId: string,
    progress: number,
    easing: EasingDefinition,
  ) => void;
  addTrackToTimeline: (timelineId: string, nodeId: NodeId, property: string) => void;
  setTrackMuted: (timelineId: string, trackId: string, muted: boolean) => void;
  setTrackSolo: (timelineId: string, trackId: string, solo: boolean) => void;

  // Motion Mode — onion skinning
  toggleOnionSkin: () => void;
  setOnionSkinBeforeCount: (count: number) => void;
  setOnionSkinAfterCount: (count: number) => void;
  setOnionSkinOpacity: (opacity: number) => void;

  // Motion Mode — track management
  setMotionSelectedTracks: (trackIds: string[]) => void;
  setTrackNestedTimeline: (
    timelineId: string,
    trackId: string,
    nestedTimelineId: string,
    startProgress?: number,
  ) => void;
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
      // Patch isPlaying BEFORE play(): under reduced motion the engine
      // finishes synchronously (onFinish patches isPlaying:false), so a
      // post-play patch would leave the UI stuck "playing" forever.
      patch({ motion: { ...s.motion, isPlaying: true, activeTimelineId: tlId } });
      facade.play(timeline);
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

  const toggleGraphEditor = useCallback(() => {
    patch({ graphEditorVisible: !stateRef.current.graphEditorVisible });
  }, [patch, stateRef]);

  const setGraphEditorProperty = useCallback(
    (property: string | null) => {
      patch({ selectedGraphProperty: property });
    },
    [patch],
  );

  const deleteKeyframe = useCallback(
    (timelineId: string, trackId: string, progress: number) => {
      updateDoc((doc) => removeKeyframeDoc(doc, timelineId, trackId, progress));
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const moveKeyframe = useCallback(
    (timelineId: string, trackId: string, oldProgress: number, newProgress: number) => {
      updateDoc((doc) => {
        const timeline = doc.timelines?.[timelineId];
        if (!timeline) return doc;
        const track = timeline.tracks.find((t) => t.id === trackId);
        if (!track) return doc;
        const kf = track.keyframes.find((k) => Math.abs(k.progress - oldProgress) < 0.0001);
        if (!kf) return doc;
        let d = removeKeyframeDoc(doc, timelineId, trackId, oldProgress);
        d = addKeyframe(d, timelineId, trackId, {
          progress: Math.max(0, Math.min(1, newProgress)),
          value: kf.value,
          easing: kf.easing,
          spatialTangents: kf.spatialTangents,
        });
        return d;
      });
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const duplicateKeyframe = useCallback(
    (timelineId: string, trackId: string, progress: number) => {
      updateDoc((doc) => {
        const timeline = doc.timelines?.[timelineId];
        if (!timeline) return doc;
        const track = timeline.tracks.find((t) => t.id === trackId);
        if (!track) return doc;
        const kf = track.keyframes.find((k) => Math.abs(k.progress - progress) < 0.0001);
        if (!kf) return doc;
        const newProgress = Math.min(1, progress + 0.05);
        return addKeyframe(doc, timelineId, trackId, {
          progress: newProgress,
          value: kf.value,
          easing: kf.easing,
          spatialTangents: kf.spatialTangents,
        });
      });
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const updateKeyframeEasing = useCallback(
    (timelineId: string, trackId: string, progress: number, easing: EasingDefinition) => {
      updateDoc((doc) => updateKeyframeDoc(doc, timelineId, trackId, progress, { easing }));
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const addTrackToTimeline = useCallback(
    (timelineId: string, nodeId: NodeId, property: string) => {
      updateDoc((doc) => addTrack(doc, timelineId, nodeId, property).doc);
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const setMotionSelectedTracks = useCallback(
    (trackIds: string[]) => {
      patch({ motion: { ...stateRef.current.motion, selectedTrackIds: trackIds } });
    },
    [patch, stateRef],
  );

  const setTrackNestedTimeline = useCallback(
    (timelineId: string, trackId: string, nestedTimelineId: string, startProgress?: number) => {
      updateDoc((doc) =>
        updateTrackDoc(doc, timelineId, trackId, {
          nestedTimelineId,
          nestedStartProgress: startProgress ?? 0,
        }),
      );
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const setTrackMuted = useCallback(
    (timelineId: string, trackId: string, muted: boolean) => {
      updateDoc((doc) => updateTrackDoc(doc, timelineId, trackId, { muted }));
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const setTrackSolo = useCallback(
    (timelineId: string, trackId: string, solo: boolean) => {
      updateDoc((doc) => updateTrackDoc(doc, timelineId, trackId, { solo }));
      invalidateSamplerCache();
    },
    [updateDoc, invalidateSamplerCache],
  );

  const toggleTimelinePanel = useCallback(() => {
    patch({ timelinePanelVisible: !stateRef.current.timelinePanelVisible });
  }, [patch, stateRef]);

  const toggleOnionSkin = useCallback(() => {
    const next = !stateRef.current.motion.onionSkinEnabled;
    patch({ motion: { ...stateRef.current.motion, onionSkinEnabled: next } });
  }, [patch, stateRef]);

  const setOnionSkinBeforeCount = useCallback(
    (count: number) => {
      patch({
        motion: {
          ...stateRef.current.motion,
          onionSkinBeforeCount: Math.max(0, Math.min(10, count)),
        },
      });
    },
    [patch, stateRef],
  );

  const setOnionSkinAfterCount = useCallback(
    (count: number) => {
      patch({
        motion: {
          ...stateRef.current.motion,
          onionSkinAfterCount: Math.max(0, Math.min(10, count)),
        },
      });
    },
    [patch, stateRef],
  );

  const setOnionSkinOpacity = useCallback(
    (opacity: number) => {
      patch({
        motion: {
          ...stateRef.current.motion,
          onionSkinOpacity: Math.max(0, Math.min(1, opacity)),
        },
      });
    },
    [patch, stateRef],
  );

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
      toggleGraphEditor,
      setGraphEditorProperty,
      deleteKeyframe,
      moveKeyframe,
      duplicateKeyframe,
      updateKeyframeEasing,
      addTrackToTimeline,
      setTrackMuted,
      setTrackSolo,
      setMotionSelectedTracks,
      toggleOnionSkin,
      setOnionSkinBeforeCount,
      setOnionSkinAfterCount,
      setOnionSkinOpacity,
      setTrackNestedTimeline,
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
      toggleGraphEditor,
      setGraphEditorProperty,
      deleteKeyframe,
      moveKeyframe,
      duplicateKeyframe,
      updateKeyframeEasing,
      addTrackToTimeline,
      setTrackMuted,
      setTrackSolo,
      setMotionSelectedTracks,
      toggleOnionSkin,
      setOnionSkinBeforeCount,
      setOnionSkinAfterCount,
      setOnionSkinOpacity,
      setTrackNestedTimeline,
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
    const t = (node as import('@varve/scene').ShapeNode).transform;
    return t ?? [1, 0, 0, 1, 0, 0];
  }
  if ('w' in node && property === 'w') return (node as import('@varve/scene').FrameNode).w;
  if ('h' in node && property === 'h') return (node as import('@varve/scene').FrameNode).h;
  if (property === 'fontSize' && 'fontSize' in node)
    return (node as import('@varve/scene').TextNode).fontSize;
  return getNestedValue(node as unknown as Record<string, unknown>, property.split('.')) ?? 0;
}
