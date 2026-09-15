import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo } from 'react';
import type { EditorState, ToolId } from './types';

export interface ToolContextValue {
  tool: ToolId;
  setTool: (t: ToolId) => void;
}

const ToolCtx = createContext<ToolContextValue | null>(null);

export function useTool(): ToolContextValue {
  const ctx = useContext(ToolCtx);
  if (!ctx) throw new Error('useTool must be used within EditorProvider');
  return ctx;
}

/**
 * The single implementation of "change the active tool" — called from both
 * this context's `setTool` and `EditorProvider`'s own `value.setTool` (the
 * `useEditor()` facade), so the two can never behaviorally diverge the way
 * `useEditor().setZoom()` and `useViewport().setZoom()` already have (see
 * docs/quality/editorprovider-surface.md). `toolRef` exists because
 * `createShapeAt` (which stays in `EditorProvider`, not part of the Tool
 * cluster) reads the tool synchronously to avoid a stale closure under
 * React 18 automatic batching — see the comment at its declaration in
 * context.tsx.
 */
export function applyToolChange(
  t: ToolId,
  toolRef: React.MutableRefObject<ToolId>,
  patch: (partial: Partial<EditorState>) => void,
): void {
  toolRef.current = t;
  patch({ tool: t });
}

interface ToolProviderProps {
  children: ReactNode;
  state: EditorState;
  toolRef: React.MutableRefObject<ToolId>;
  patch: (partial: Partial<EditorState>) => void;
}

export function ToolProvider({ children, state, toolRef, patch }: ToolProviderProps) {
  const setTool = useCallback((t: ToolId) => applyToolChange(t, toolRef, patch), [toolRef, patch]);

  const value = useMemo<ToolContextValue>(
    () => ({ tool: state.tool, setTool }),
    [state.tool, setTool],
  );

  return <ToolCtx.Provider value={value}>{children}</ToolCtx.Provider>;
}
