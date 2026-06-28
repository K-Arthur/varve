/**
 * Editor state context — shared across all shell surfaces.
 */

import type { NodeId } from '@strata/scene';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

export type ToolId = 'select' | 'frame' | 'rect' | 'ellipse' | 'pen' | 'text' | 'hand' | 'zoomIn';

export interface EditorState {
  tool: ToolId;
  zoom: number;
  pan: { x: number; y: number };
  selection: NodeId | null;
}

export interface EditorContextValue {
  state: EditorState;
  setTool: (t: ToolId) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
  setSelection: (id: NodeId | null) => void;
}

const EditorCtx = createContext<EditorContextValue | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EditorState>({
    tool: 'select',
    zoom: 1,
    pan: { x: 0, y: 0 },
    selection: null,
  });

  const value = useMemo<EditorContextValue>(
    () => ({
      state,
      setTool: (t) => setState((s) => ({ ...s, tool: t })),
      setZoom: (z) => setState((s) => ({ ...s, zoom: z })),
      setPan: (p) => setState((s) => ({ ...s, pan: p })),
      setSelection: (id) => setState((s) => ({ ...s, selection: id })),
    }),
    [state],
  );

  return <EditorCtx.Provider value={value}>{children}</EditorCtx.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}
