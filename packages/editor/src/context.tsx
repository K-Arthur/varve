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
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  /** Update the position (transform) of a node. */
  setNodePosition: (id: NodeId, x: number, y: number) => void;
  /** Update the size of a shape node. */
  setNodeSize: (id: NodeId, w: number, h: number) => void;
  /** Undo last document mutation. */
  undo: () => void;
  /** Redo last undone mutation. */
  redo: () => void;
  /** Create a new empty document. */
  newDocument: () => void;
  /** Serialize current document to JSON string. */
  serializeDocument: () => string;
  /** Load a document from a JSON string. */
  loadDocument: (json: string) => void;
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
  const undoStackRef = useRef<Document[]>([]);
  const redoStackRef = useRef<Document[]>([]);

  const patch = useCallback(
    (partial: Partial<EditorState>) => setState((s) => ({ ...s, ...partial })),
    [],
  );

  const updateDoc = useCallback((fn: (doc: Document) => Document) => {
    setState((s) => {
      undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
      redoStackRef.current = [];
      return { ...s, document: fn(s.document) };
    });
  }, []);

  const rootNodes = useCallback(() => {
    const { rootChildren, nodes } = state.document;
    return rootChildren.map((id) => nodes[id]).filter((n): n is SceneNode => Boolean(n));
  }, [state.document]);

  const updateNodeProp = useCallback(
    (id: NodeId, updater: (n: SceneNode) => SceneNode) => {
      updateDoc((doc) => {
        const node = doc.nodes[id];
        if (!node) return doc;
        return {
          ...doc,
          nodes: { ...doc.nodes, [id]: updater(node) },
        };
      });
    },
    [updateDoc],
  );

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
        updateNodeProp(sel, (n) => ({ ...n, fill: color }));
      },
      setNodePosition: (id, x, y) => {
        updateNodeProp(id, (n) => ({
          ...n,
          transform: [
            n.transform[0],
            n.transform[1],
            n.transform[2],
            n.transform[3],
            x,
            y,
          ] as Affine,
        }));
      },
      setNodeSize: (id, w, h) => {
        updateNodeProp(id, (n) => {
          if (n.kind !== 'shape') return n;
          const s = n.shape;
          switch (s.kind) {
            case 'rect':
              return { ...n, shape: { ...s, w, h } };
            case 'ellipse':
              return { ...n, shape: { ...s, rx: w, ry: h } };
            case 'circle':
              return { ...n, shape: { ...s, r: w } };
            default:
              return n;
          }
        });
      },
      undo: () => {
        const prev = undoStackRef.current.pop();
        if (!prev) return;
        redoStackRef.current = [...redoStackRef.current, state.document];
        patch({ document: prev });
      },
      redo: () => {
        const next = redoStackRef.current.pop();
        if (!next) return;
        undoStackRef.current = [...undoStackRef.current, state.document];
        patch({ document: next });
      },
      newDocument: () => {
        undoStackRef.current = [];
        redoStackRef.current = [];
        patch({ document: createDocument('Untitled'), selection: null });
      },
      serializeDocument: () => JSON.stringify(state.document),
      loadDocument: (json) => {
        try {
          const doc = JSON.parse(json) as Document;
          undoStackRef.current = [];
          redoStackRef.current = [];
          patch({ document: doc, selection: null });
        } catch {
          // invalid JSON, ignore
        }
      },
      rootNodes,
    }),
    [state, patch, updateDoc, rootNodes, updateNodeProp],
  );

  return <EditorCtx.Provider value={value}>{children}</EditorCtx.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}
