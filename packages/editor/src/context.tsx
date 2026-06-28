/**
 * Editor state context — shared across all shell surfaces.
 *
 * Holds the editor's tool state, viewport (zoom/pan), selection, AND the scene
 * Document. Document actions are provided through the context so any surface
 * (toolbar, canvas, layers, inspector) can mutate the scene.
 */

import type { Affine, Color, Shape } from '@strata/engine';
import type { NodeId } from '@strata/scene';
import {
  addNode,
  createDocument,
  type Document,
  makeShapeNode,
  moveNode,
  nextNodeId,
  removeNode,
  renameNode,
  type SceneNode,
} from '@strata/scene';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export type ToolId = 'select' | 'frame' | 'rect' | 'ellipse' | 'pen' | 'text' | 'hand' | 'zoomIn';

export interface EditorState {
  tool: ToolId;
  zoom: number;
  pan: { x: number; y: number };
  selection: NodeId | null;
  document: Document;
}

export interface EditorContextValue {
  state: EditorState;
  setTool: (t: ToolId) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
  setSelection: (id: NodeId | null) => void;
  /** Create a shape node from the current tool at the given world-space point. */
  createShapeAt: (world: { x: number; y: number }) => void;
  /** Remove the currently selected node. */
  removeSelected: () => void;
  /** Rename the currently selected node. */
  renameSelected: (name: string) => void;
  /** Move a node to a new paint-order index. */
  moveNode: (id: NodeId, toIndex: number) => void;
  /** Update the fill of the selected node. */
  setSelectedFill: (color: Color) => void;
  /** Visible nodes in paint order (for layers, ir). */
  rootNodes: () => SceneNode[];
}

const EditorCtx = createContext<EditorContextValue | null>(null);

function shapeForTool(tool: ToolId): Shape {
  switch (tool) {
    case 'rect':
      return { kind: 'rect', x: 0, y: 0, w: 100, h: 80 };
    case 'ellipse':
      return { kind: 'ellipse', cx: 50, cy: 40, rx: 50, ry: 40 };
    case 'text':
      return { kind: 'rect', x: 0, y: 0, w: 60, h: 24 };
    default:
      return { kind: 'rect', x: 0, y: 0, w: 100, h: 80 };
  }
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EditorState>({
    tool: 'select',
    zoom: 1,
    pan: { x: 0, y: 0 },
    selection: null,
    document: createDocument('Untitled'),
  });

  const patch = useCallback(
    (partial: Partial<EditorState>) => setState((s) => ({ ...s, ...partial })),
    [],
  );

  const updateDoc = useCallback(
    (fn: (doc: Document) => Document) => setState((s) => ({ ...s, document: fn(s.document) })),
    [],
  );

  const rootNodes = useCallback(() => {
    const { rootChildren, nodes } = state.document;
    return rootChildren.map((id) => nodes[id]).filter((n): n is SceneNode => Boolean(n));
  }, [state.document]);

  const value = useMemo<EditorContextValue>(
    () => ({
      state,
      setTool: (t) => patch({ tool: t }),
      setZoom: (z) => patch({ zoom: z }),
      setPan: (p) => patch({ pan: p }),
      setSelection: (id) => patch({ selection: id }),
      createShapeAt: (world) => {
        updateDoc((doc) => {
          const { id, doc: d2 } = nextNodeId(doc);
          const transform: Affine = [1, 0, 0, 1, world.x, world.y];
          const node = makeShapeNode(id, shapeForTool(state.tool), { transform });
          return addNode(d2, node);
        });
      },
      removeSelected: () => {
        const sel = state.selection;
        if (!sel) return;
        updateDoc((doc) => removeNode(doc, sel));
        patch({ selection: null });
      },
      renameSelected: (name) => {
        const sel = state.selection;
        if (!sel) return;
        updateDoc((doc) => renameNode(doc, sel, name));
      },
      moveNode: (id, toIndex) => {
        updateDoc((doc) => moveNode(doc, id, toIndex));
      },
      setSelectedFill: (color) => {
        const sel = state.selection;
        if (!sel) return;
        updateDoc((doc) => ({
          ...doc,
          nodes: {
            ...doc.nodes,
            [sel]: { ...doc.nodes[sel], fill: color } as SceneNode,
          },
        }));
      },
      rootNodes,
    }),
    [state, patch, updateDoc, rootNodes],
  );

  return <EditorCtx.Provider value={value}>{children}</EditorCtx.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}
