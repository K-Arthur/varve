import type { PrototypeRuntime } from '@varve/prototype';
import {
  applyActionResult as protoApplyActionResult,
  getVariable as protoGetVar,
  handleEvent as protoHandleEvent,
  setVariable as protoSetVar,
} from '@varve/prototype';
import type { Document, SMRuntime } from '@varve/scene';
import {
  createStateMachineRuntime,
  getCurrentStateTimelineId,
  setActiveTimeline as setActiveTimelineDoc,
  triggerSMEvent,
  updateVariableInDocument,
} from '@varve/scene';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ActivePrototypeTransition } from '../components/Prototype/usePrototypeTransition';
import { createRuntimeFromDocument, interactionsMapFromDocument } from '../motion/prototypeRuntime';
import { computeSmartAnimateTransition } from '../motion/smartAnimateBridge';
import { getPrimaryStateMachineTimelineId } from '../motion/stateMachineBridge';
import type { EditorState } from './types';

export interface PrototypeContextValue {
  /** Enter/exit prototype mode */
  setPrototypeMode: (active: boolean) => void;
  /** Set prototype data from current document */
  updatePrototypeData: () => void;
  /** Handle a prototype interaction event */
  handlePrototypeEvent: (event: unknown) => void;
  /** Get prototype variable value */
  getPrototypeVariable: (id: string) => string | number | boolean | undefined;
  /** Set prototype variable value */
  setPrototypeVariable: (id: string, value: string | number | boolean) => void;
  /** Start presentation mode (fullscreen) */
  startPresentation: () => void;
  /** Stop presentation mode */
  stopPresentation: () => void;
  /** Get all frame nodes (screens) for prototype */
  getPrototypeScreens: () => Array<{ id: string; name: string }>;
  /** Current screen in prototype */
  prototypeCurrentScreen: string;
  /** Navigate to a prototype screen */
  navigatePrototypeTo: (screenId: string) => void;
  /** Active screen transition during prototype navigation. */
  prototypeTransition: ActivePrototypeTransition | null;
  clearPrototypeTransition: () => void;
  /** Flow-view / inspector focus for a prototype interaction. */
  selectedInteractionId: string | null;
  selectPrototypeInteraction: (nodeId: string, interactionId: string) => void;
}

const PrototypeCtx = createContext<PrototypeContextValue | null>(null);

export function usePrototype(): PrototypeContextValue {
  const ctx = useContext(PrototypeCtx);
  if (!ctx) throw new Error('usePrototype must be used within EditorProvider');
  return ctx;
}

interface PrototypeProviderProps {
  children: ReactNode;
  state: EditorState;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
  stateRef: React.MutableRefObject<EditorState>;
  updateDoc: (fn: (doc: Document) => Document) => void;
  /** Shared refs — kept in the parent so the delay-polling useEffect can access them. */
  prototypeRuntimeRef: React.MutableRefObject<PrototypeRuntime | null>;
  smRuntimeRef: React.MutableRefObject<SMRuntime | null>;
  /**
   * Drives timeline playback when a prototype action starts/stops an animation.
   * Injected from the sibling MotionProvider (via EditorProvider's motion value)
   * so this provider stays free of direct MotionFacade imports. Defaults to no-ops.
   */
  playTimeline?: (timelineId?: string) => void;
  stopTimeline?: () => void;
  onReady?: (value: PrototypeContextValue) => void;
}

export function PrototypeProvider({
  children,
  state,
  setState,
  stateRef,
  updateDoc,
  prototypeRuntimeRef,
  smRuntimeRef,
  playTimeline = () => {},
  stopTimeline = () => {},
  onReady,
}: PrototypeProviderProps) {
  const patch = useCallback(
    (partial: Partial<EditorState>) => setState((s) => ({ ...s, ...partial })),
    [setState],
  );

  const prototypeSmartAnimateRef = useRef<ReturnType<typeof computeSmartAnimateTransition> | null>(
    null,
  );
  const [prototypeTransition, setPrototypeTransition] = useState<ActivePrototypeTransition | null>(
    null,
  );
  const [prototypeCurrentScreen, setPrototypeCurrentScreen] = useState('');
  const [selectedInteractionId, setSelectedInteractionId] = useState<string | null>(null);

  const setPrototypeMode = useCallback(
    (active: boolean) => {
      patch({ prototypeMode: active });
      if (active) {
        const doc = stateRef.current.document;
        const { runtime, entryScreenId } = createRuntimeFromDocument(doc);
        prototypeRuntimeRef.current = runtime;
        const smIds = Object.keys(doc.stateMachines ?? {});
        smRuntimeRef.current = smIds[0] ? createStateMachineRuntime(doc, smIds[0]) : null;
        patch({
          prototypeRuntime: runtime,
          prototypeData: {
            interactions: interactionsMapFromDocument(doc),
          },
        });
        setPrototypeCurrentScreen(entryScreenId);
      } else {
        prototypeRuntimeRef.current = null;
        smRuntimeRef.current = null;
        patch({ prototypeRuntime: null });
      }
    },
    [patch, stateRef, prototypeRuntimeRef, smRuntimeRef],
  );

  const updatePrototypeData = useCallback(() => {
    const { runtime, entryScreenId } = createRuntimeFromDocument(stateRef.current.document);
    prototypeRuntimeRef.current = runtime;
    patch({
      prototypeRuntime: runtime,
      prototypeData: {
        interactions: interactionsMapFromDocument(stateRef.current.document),
      },
    });
    setPrototypeCurrentScreen(entryScreenId);
  }, [patch, stateRef, prototypeRuntimeRef]);

  const handlePrototypeEvent = useCallback(
    (event: unknown) => {
      const runtime = prototypeRuntimeRef.current;
      if (!runtime) return;
      const fromScreenId = runtime.state.currentScreenId;
      const results = protoHandleEvent(runtime, event as Parameters<typeof protoHandleEvent>[1]);
      for (const result of results) {
        for (const actionResult of result.actionResults) {
          if (actionResult.kind === 'navigateTo') {
            const transition = actionResult.transition;
            let smartValues:
              | Record<string, import('@varve/prototype').SmartAnimateLayerValues>
              | undefined;
            if (transition.kind === 'smartAnimate') {
              const sa = computeSmartAnimateTransition(
                stateRef.current.document,
                fromScreenId,
                actionResult.targetId,
              );
              prototypeSmartAnimateRef.current = sa;
              smartValues = sa?.values;
            }
            if (transition.kind !== 'instant') {
              setPrototypeTransition({
                fromScreenId,
                toScreenId: actionResult.targetId,
                transition,
                smartAnimateValues: smartValues,
                layerMatches: prototypeSmartAnimateRef.current?.matches,
                startedAt: performance.now(),
              });
            }
          }
          protoApplyActionResult(runtime, actionResult);

          // Prototype-triggered timeline playback. The @varve/prototype runtime
          // only records animation state; driving the actual MotionFacade
          // playback lives here so the prototype runtime stays document/test
          // agnostic. `animationId` references Document.timelines[id].
          if (actionResult.kind === 'startAnimation') {
            if (stateRef.current.document.timelines?.[actionResult.animationId]) {
              playTimeline(actionResult.animationId);
            }
          } else if (actionResult.kind === 'stopAnimation') {
            stopTimeline();
          }
        }
      }

      if (smRuntimeRef.current) {
        const ev = event as { type?: string };
        if (ev.type === 'click') {
          smRuntimeRef.current = triggerSMEvent(smRuntimeRef.current, 'onClick');
          const tlId = getCurrentStateTimelineId(smRuntimeRef.current);
          if (tlId) {
            patch({
              motion: { ...stateRef.current.motion, activeTimelineId: tlId, currentTime: 0 },
            });
          }
        }
      }

      setPrototypeCurrentScreen(runtime.state.currentScreenId);
    },
    [patch, stateRef, prototypeRuntimeRef, smRuntimeRef, playTimeline, stopTimeline],
  );

  const getPrototypeVariable = useCallback(
    (id: string) => {
      const runtime = prototypeRuntimeRef.current;
      if (!runtime) return undefined;
      return protoGetVar(runtime, id);
    },
    [prototypeRuntimeRef],
  );

  const setPrototypeVariable = useCallback(
    (id: string, value: string | number | boolean) => {
      const runtime = prototypeRuntimeRef.current;
      if (runtime) protoSetVar(runtime, id, value);
      updateDoc((doc) => {
        const v = doc.variableStore?.variables[id];
        if (!v) return doc;
        const mode = doc.variableStore?.activeMode ?? 'default';
        return updateVariableInDocument(doc, id, {
          valuesByMode: { ...v.valuesByMode, [mode]: value },
        });
      });
    },
    [updateDoc, prototypeRuntimeRef],
  );

  const startPresentation = useCallback(() => {
    const doc = stateRef.current.document;
    const { runtime, entryScreenId } = createRuntimeFromDocument(doc);
    prototypeRuntimeRef.current = runtime;
    const smIds = Object.keys(doc.stateMachines ?? {});
    smRuntimeRef.current = smIds[0] ? createStateMachineRuntime(doc, smIds[0]) : null;
    const smTimelineId = getPrimaryStateMachineTimelineId(doc);
    patch({
      isPresenting: true,
      prototypeRuntime: runtime,
      prototypeData: {
        interactions: interactionsMapFromDocument(doc),
      },
      ...(smTimelineId
        ? {
            motion: {
              ...stateRef.current.motion,
              activeTimelineId: smTimelineId,
              currentTime: 0,
              isPlaying: false,
            },
          }
        : {}),
    });
    updateDoc((d) => (smTimelineId ? setActiveTimelineDoc(d, smTimelineId) : d));
    setPrototypeCurrentScreen(entryScreenId);
  }, [patch, stateRef, updateDoc, prototypeRuntimeRef, smRuntimeRef]);

  const stopPresentation = useCallback(() => {
    patch({ isPresenting: false });
  }, [patch]);

  const getPrototypeScreens = useCallback(() => {
    return Object.values(state.document.nodes)
      .filter((n): n is import('@varve/scene').FrameNode => n.kind === 'frame')
      .map((n) => ({ id: n.id, name: n.name }));
  }, [state.document.nodes]);

  const navigatePrototypeTo = useCallback(
    (screenId: string) => {
      const runtime = prototypeRuntimeRef.current;
      if (runtime) {
        runtime.state.currentScreenId = screenId;
      }
      setPrototypeCurrentScreen(screenId);
    },
    [prototypeRuntimeRef],
  );

  const clearPrototypeTransition = useCallback(() => setPrototypeTransition(null), []);

  const selectPrototypeInteraction = useCallback(
    (nodeId: string, interactionId: string) => {
      setSelectedInteractionId(interactionId);
      patch({ selection: [nodeId] });
    },
    [patch],
  );

  const value = useMemo<PrototypeContextValue>(
    () => ({
      setPrototypeMode,
      updatePrototypeData,
      handlePrototypeEvent,
      getPrototypeVariable,
      setPrototypeVariable,
      startPresentation,
      stopPresentation,
      getPrototypeScreens,
      prototypeCurrentScreen,
      navigatePrototypeTo,
      prototypeTransition,
      clearPrototypeTransition,
      selectedInteractionId,
      selectPrototypeInteraction,
    }),
    [
      setPrototypeMode,
      updatePrototypeData,
      handlePrototypeEvent,
      getPrototypeVariable,
      setPrototypeVariable,
      startPresentation,
      stopPresentation,
      getPrototypeScreens,
      prototypeCurrentScreen,
      navigatePrototypeTo,
      prototypeTransition,
      clearPrototypeTransition,
      selectedInteractionId,
      selectPrototypeInteraction,
    ],
  );

  useEffect(() => {
    onReady?.(value);
  }, [value, onReady]);

  return <PrototypeCtx.Provider value={value}>{children}</PrototypeCtx.Provider>;
}
