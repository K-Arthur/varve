import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { createContrastProvider } from './providers/contrastProvider';
import { createDpiWarningProvider } from './providers/dpiWarningProvider';
import { createVectorIssuesProvider } from './providers/vectorIssuesProvider';
import { OverlayRegistry } from './registry';
import type { OverlayContext, OverlayToggleState } from './types';
import { DEFAULT_OVERLAY_TOGGLE_STATE } from './types';

interface UseFindingsOverlayResult {
  registry: OverlayRegistry;
  overlayContext: OverlayContext;
  setToggleState: (state: OverlayToggleState) => void;
  toggleMaster: () => void;
  toggleProvider: (providerId: string) => void;
  setSeverityFilter: (severities: OverlayToggleState['severityFilter']) => void;
  toggleState: OverlayToggleState;
}

export function useFindingsOverlay(viewport: {
  width: number;
  height: number;
}): UseFindingsOverlayResult {
  const editor = useEditor();
  const { state } = editor;
  const [toggleState, setToggleState] = useState<OverlayToggleState>(() => ({
    ...DEFAULT_OVERLAY_TOGGLE_STATE,
    masterEnabled: state.findingsOverlayVisible,
    providerOverrides: { ...state.findingsProviderOverrides },
  }));
  const registryRef = useRef<OverlayRegistry | null>(null);
  const renderVersion = useRef(0);

  const registry = useMemo(() => {
    const r = new OverlayRegistry({
      ...DEFAULT_OVERLAY_TOGGLE_STATE,
      masterEnabled: state.findingsOverlayVisible,
      providerOverrides: { ...state.findingsProviderOverrides },
    });
    r.register(createContrastProvider());
    r.register(createVectorIssuesProvider());
    r.register(createDpiWarningProvider());
    registryRef.current = r;
    return r;
  }, []);

  useEffect(() => {
    registry.setToggleState(toggleState);
    renderVersion.current++;
  }, [registry, toggleState]);

  useEffect(() => {
    setToggleState((prev) => ({
      ...prev,
      masterEnabled: state.findingsOverlayVisible,
      providerOverrides: { ...state.findingsProviderOverrides },
    }));
  }, [state.findingsOverlayVisible, state.findingsProviderOverrides]);

  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>();
    for (const [id, node] of Object.entries(state.document.nodes)) {
      if ((node as { visible?: boolean }).visible === false) hidden.add(id);
    }
    return hidden;
  }, [state.document]);

  const clippedNodeIds = useMemo(() => {
    const clipped = new Set<string>();
    for (const [, node] of Object.entries(state.document.nodes)) {
      const n = node as { clipContent?: boolean; kind?: string; children?: string[] };
      if ((n.kind === 'frame' || n.kind === 'group') && n.children && n.clipContent !== false) {
        for (const cId of n.children) {
          clipped.add(cId);
        }
      }
    }
    return clipped;
  }, [state.document]);

  const overlayContext: OverlayContext = useMemo(
    () => ({
      document: state.document,
      zoom: state.zoom,
      pan: state.pan,
      cameraRotation: state.cameraRotation,
      viewport,
      getWorldBounds: editor.getWorldBounds,
      getWorldTransform: editor.getWorldTransform,
      hiddenNodeIds,
      clippedNodeIds,
    }),
    [
      state.document,
      state.zoom,
      state.pan,
      state.cameraRotation,
      viewport,
      editor.getWorldBounds,
      editor.getWorldTransform,
      hiddenNodeIds,
      clippedNodeIds,
    ],
  );

  const toggleMaster = useCallback(() => {
    setToggleState((prev) => {
      const next = { ...prev, masterEnabled: !prev.masterEnabled };
      return next;
    });
  }, []);

  const toggleProvider = useCallback((providerId: string) => {
    setToggleState((prev) => ({
      ...prev,
      providerOverrides: {
        ...prev.providerOverrides,
        [providerId]:
          prev.providerOverrides[providerId] === undefined
            ? false
            : !prev.providerOverrides[providerId],
      },
    }));
  }, []);

  const setSeverityFilter = useCallback((severities: OverlayToggleState['severityFilter']) => {
    setToggleState((prev) => ({ ...prev, severityFilter: severities }));
  }, []);

  return {
    registry,
    overlayContext,
    setToggleState,
    toggleMaster,
    toggleProvider,
    setSeverityFilter,
    toggleState,
  };
}
