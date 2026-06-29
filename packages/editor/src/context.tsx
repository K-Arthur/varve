/**
 * Editor state context — shared across all shell surfaces.
 *
 * Holds the editor's tool state, viewport (zoom/pan), selection, AND the scene
 * Document. Document actions are provided through the context so any surface
 * (toolbar, canvas, layers, inspector) can mutate the scene.
 *
 * F1: Selection is now NodeId[] (multi-select capable). All surfaces read
 *     selection through isSelected()/selectedNodes() so nested nodes work
 *     (doc.nodes[id] lookup vs the old rootNodes().find() which missed nested).
 *
 * F4: Auto-naming is type-aware: "Rectangle 1", "Ellipse 2", "Frame 1", etc.
 *     Frame tool now correctly creates a FrameNode (container), not a ShapeNode.
 */
import type { Affine, Color, Shape } from '@strata/engine';
import type { ExportPreset, ExportJob, NodeId, Slot } from '@strata/scene';
import {
  addNode,
  createComponent,
  createDocument,
  createVariableStore,
  type Document,
  fillSlot as fillSlotDoc,
  instantiate as instantiateComponent,
  makeFrameNode,
  makeShapeNode,
  moveNode,
  nextNodeId,
  removeNode,
  renameNode,
  resolve,
  type SceneNode,
  type Variable,
  type VariableStore,
  type VariableValue,
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

export type ToolId =
  | 'select'
  | 'frame'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'pen'
  | 'text'
  | 'hand'
  | 'zoomIn';

/** F2: metadata for each open document tab. */
export interface SessionMeta {
  id: string;
  name: string;
  dirty: boolean;
  filePath?: string;
}

export interface EditorState {
  tool: ToolId;
  zoom: number;
  pan: { x: number; y: number };
  /** F1: multi-select set; use isSelected/selectedNodes helpers to read. */
  selection: NodeId[];
  document: Document;
  /** F2: open document sessions (tabs). */
  sessions: SessionMeta[];
  activeId: string;
  dirty: boolean;
  /** B1: per-session variable store. */
  variableStore: VariableStore;
}

export interface EditorContextValue {
  state: EditorState;
  setTool: (t: ToolId) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
  /** Replace selection with a single node (or clear if null). */
  setSelection: (id: NodeId | null) => void;
  /** Toggle one node in/out of the selection; additive keeps existing selection. */
  toggleSelection: (id: NodeId, additive?: boolean) => void;
  /** True if the given id is currently selected. */
  isSelected: (id: NodeId) => boolean;
  /** All selected scene nodes — works for nested nodes (uses doc.nodes lookup). */
  selectedNodes: () => SceneNode[];
  /** Create a shape/frame node from the current tool at the given world-space point. */
  createShapeAt: (world: { x: number; y: number }, size?: { w: number; h: number }) => void;
  /** Remove all currently selected nodes. */
  removeSelected: () => void;
  /** Rename the first selected node. */
  renameSelected: (name: string) => void;
  /** Move a node to a new paint-order index. */
  moveNode: (id: NodeId, toIndex: number) => void;
  /** Update the fill of all selected nodes. */
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
  /** Visible root-level nodes in paint order (layers panel, IR). */
  rootNodes: () => SceneNode[];
  /** Register a component definition from a frame. */
  createComponentFromFrame: (name: string, masterRootId: NodeId, slots: Slot[]) => void;
  /** Create an instance of a component. */
  createComponentInstance: (componentId: NodeId) => void;
  /** Fill a slot on a component instance. */
  fillSlot: (instanceId: NodeId, slotId: string, fillNodeId: NodeId) => void;
  /** Toggle the locked state of a node. */
  setNodeLocked: (id: NodeId, locked: boolean) => void;
  /** Toggle the visible state of a node. */
  setNodeVisible: (id: NodeId, visible: boolean) => void;
  /** B2: set or update the layout style on a frame node. */
  setNodeLayout: (id: NodeId, layout: import('@strata/scene').LayoutStyle | undefined) => void;
  /** B1: resolve a variable to its current value (throws on missing/cycle). */
  resolveVariable: (nameOrId: string) => VariableValue;
  /** B1: add a new variable to the active session's store. */
  addVariable: (v: Omit<Variable, 'id'>) => void;
  /** B1: update an existing variable. */
  updateVariable: (id: string, patch: Partial<Omit<Variable, 'id'>>) => void;
  /** B1: delete a variable by id. */
  deleteVariable: (id: string) => void;
  /** B1: switch the active variable mode. */
  setVariableMode: (mode: string) => void;
  /** F2/A8: open a new document in a new tab. */
  newTab: () => void;
  /** F2/A8: switch the active tab. */
  switchTab: (id: string) => void;
  /** F2/A8: close a tab. Returns false if dirty and force is not set (caller should confirm). */
  closeTab: (id: string, force?: boolean) => boolean;
  /** Show the export dialog modal. */
  showExportDialog: boolean;
  setShowExportDialog: (show: boolean) => void;
  /** Add an export preset to a node. */
  addPreset: (nodeId: NodeId, preset: ExportPreset) => void;
  /** Update an export preset on a node. */
  updatePreset: (nodeId: NodeId, preset: ExportPreset) => void;
  /** Remove an export preset from a node. */
  removePreset: (nodeId: NodeId, presetId: string) => void;
}

const EditorCtx = createContext<EditorContextValue | null>(null);

/** F2: full snapshot of an inactive session stored in a ref (not state). */
interface SavedSession {
  document: Document;
  selection: NodeId[];
  viewport: { zoom: number; pan: { x: number; y: number } };
  undo: Document[];
  redo: Document[];
  variableStore: VariableStore;
}

// F4: human-readable type name per tool
function typeNameForTool(tool: ToolId): string {
  switch (tool) {
    case 'rect':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'polygon':
      return 'Polygon';
    case 'star':
      return 'Star';
    case 'line':
      return 'Line';
    case 'frame':
      return 'Frame';
    case 'text':
      return 'Text';
    case 'pen':
      return 'Path';
    default:
      return 'Shape';
  }
}

// F4: find the next unique auto-name for a type ("Rectangle 3" when 1 and 2 exist)
function nextAutoName(doc: Document, typeName: string): string {
  const used = new Set<number>();
  for (const n of Object.values(doc.nodes)) {
    const match = n.name.match(new RegExp(`^${typeName} (\\d+)$`));
    if (match?.[1]) used.add(parseInt(match[1], 10));
  }
  let i = 1;
  while (used.has(i)) i++;
  return `${typeName} ${i}`;
}

// F4: default shape geometry per tool
function shapeForTool(tool: ToolId): Shape {
  switch (tool) {
    case 'ellipse':
      return { kind: 'ellipse', cx: 50, cy: 40, rx: 50, ry: 40 };
    case 'polygon':
      return { kind: 'polygon', cx: 50, cy: 40, radius: 50, sides: 6, rotation: 0 };
    case 'star':
      return {
        kind: 'star',
        cx: 50,
        cy: 40,
        innerRadius: 20,
        outerRadius: 50,
        points: 5,
        rotation: 0,
      };
    case 'line':
      return { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 3 };
    case 'text':
      return { kind: 'rect', x: 0, y: 0, w: 120, h: 32 };
    default:
      return { kind: 'rect', x: 0, y: 0, w: 100, h: 80 };
  }
}

const INITIAL_SESSION_ID = 'session-0';

export function EditorProvider({ children }: { children: ReactNode }) {
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [state, setState] = useState<EditorState>({
    tool: 'select',
    zoom: 1,
    pan: { x: 0, y: 0 },
    selection: [],
    document: createDocument('Untitled'),
    sessions: [{ id: INITIAL_SESSION_ID, name: 'Untitled', dirty: false }],
    activeId: INITIAL_SESSION_ID,
    dirty: false,
    variableStore: createVariableStore(),
  });
  const undoStackRef = useRef<Document[]>([]);
  const redoStackRef = useRef<Document[]>([]);
  /** F2: snapshots of all inactive sessions, keyed by session ID. */
  const sessionStoreRef = useRef<Map<string, SavedSession>>(new Map());

  const patch = useCallback(
    (partial: Partial<EditorState>) => setState((s) => ({ ...s, ...partial })),
    [],
  );

  const updateDoc = useCallback((fn: (doc: Document) => Document) => {
    setState((s) => {
      undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
      redoStackRef.current = [];
      return {
        ...s,
        document: fn(s.document),
        dirty: true,
        sessions: s.sessions.map((sess) =>
          sess.id === s.activeId ? { ...sess, dirty: true } : sess,
        ),
      };
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

      // F1: single-select replaces the whole set
      setSelection: (id) => patch({ selection: id ? [id] : [] }),

      // F1: additive = shift+click behaviour
      toggleSelection: (id, additive = false) => {
        setState((s) => {
          if (additive) {
            const already = s.selection.includes(id);
            return {
              ...s,
              selection: already ? s.selection.filter((x) => x !== id) : [...s.selection, id],
            };
          }
          return { ...s, selection: [id] };
        });
      },

      // F1: helpers that work for nested nodes
      isSelected: (id) => state.selection.includes(id),
      selectedNodes: () =>
        state.selection
          .map((id) => state.document.nodes[id])
          .filter((n): n is SceneNode => Boolean(n)),

      // F4 + frame tool fix: create typed nodes with auto-names, select atomically
      createShapeAt: (world, size) => {
        setState((s) => {
          // Push undo snapshot atomically with the creation
          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          redoStackRef.current = [];

          const { id, doc: d2 } = nextNodeId(s.document);
          const typeName = typeNameForTool(s.tool);
          const autoName = nextAutoName(d2, typeName);
          const transform: Affine = [1, 0, 0, 1, world.x, world.y];

          let newDoc: Document;
          if (s.tool === 'frame') {
            const node = makeFrameNode(id, {
              name: autoName,
              transform,
              fill: [200, 200, 200, 255] as Color,
              children: [],
            });
            newDoc = addNode(d2, node);
          } else {
            const shape: Shape = size ? buildShapeWithSize(s.tool, size) : shapeForTool(s.tool);
            const node = makeShapeNode(id, shape, { name: autoName, transform });
            newDoc = addNode(d2, node);
          }

          return { ...s, document: newDoc, selection: [id] };
        });
      },

      removeSelected: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          let d = doc;
          for (const id of sel) d = removeNode(d, id);
          return d;
        });
        patch({ selection: [] });
      },

      renameSelected: (name) => {
        const sel = state.selection[0];
        if (!sel) return;
        updateDoc((doc) => renameNode(doc, sel, name));
      },

      moveNode: (id, toIndex) => {
        updateDoc((doc) => moveNode(doc, id, toIndex));
      },

      setSelectedFill: (color) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          let d = doc;
          for (const id of sel) {
            const node = d.nodes[id];
            if (!node) continue;
            d = { ...d, nodes: { ...d.nodes, [id]: { ...node, fill: color } } };
          }
          return d;
        });
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
        patch({ document: createDocument('Untitled'), selection: [] });
      },

      serializeDocument: () => JSON.stringify(state.document),

      loadDocument: (json) => {
        try {
          const doc = JSON.parse(json) as Document;
          undoStackRef.current = [];
          redoStackRef.current = [];
          patch({ document: doc, selection: [] });
        } catch {
          // invalid JSON — ignore silently
        }
      },

      rootNodes,

      createComponentFromFrame: (name, masterRootId, slots) => {
        updateDoc((doc) => {
          const { doc: d2 } = createComponent(doc, name, masterRootId, slots);
          return d2;
        });
      },

      createComponentInstance: (componentId) => {
        updateDoc((doc) => {
          const def = doc.components[componentId];
          if (!def) return doc;
          const { node, doc: d2 } = instantiateComponent(doc, def);
          return addNode(d2, node);
        });
      },

      fillSlot: (instanceId, slotId, fillNodeId) => {
        updateDoc((doc) => fillSlotDoc(doc, instanceId, slotId, fillNodeId));
      },

      setNodeLocked: (id, locked) => {
        updateNodeProp(id, (n) => ({ ...n, locked }));
      },

      setNodeVisible: (id, visible) => {
        updateNodeProp(id, (n) => ({ ...n, visible }));
      },

      setNodeLayout: (id, layout) => {
        updateNodeProp(id, (n) => {
          if (n.kind !== 'frame') return n;
          return { ...n, layoutStyle: layout };
        });
      },

      // F2/A8 — session (tab) management -----------------------------------

      resolveVariable: (nameOrId) => resolve(state.variableStore, nameOrId),

      addVariable: (v) => {
        const id = `var-${Date.now()}`;
        const newVar: Variable = { id, ...v };
        setState((s) => ({
          ...s,
          variableStore: {
            ...s.variableStore,
            variables: { ...s.variableStore.variables, [id]: newVar },
          },
        }));
      },

      updateVariable: (id, patch) => {
        setState((s) => {
          const existing = s.variableStore.variables[id];
          if (!existing) return s;
          return {
            ...s,
            variableStore: {
              ...s.variableStore,
              variables: { ...s.variableStore.variables, [id]: { ...existing, ...patch } },
            },
          };
        });
      },

      deleteVariable: (id) => {
        setState((s) => {
          const { [id]: _, ...rest } = s.variableStore.variables;
          return { ...s, variableStore: { ...s.variableStore, variables: rest } };
        });
      },

      setVariableMode: (mode) => {
        setState((s) => ({
          ...s,
          variableStore: { ...s.variableStore, activeMode: mode },
        }));
      },

      newTab: () => {
        setState((s) => {
          // Snapshot current session before leaving it
          sessionStoreRef.current.set(s.activeId, {
            document: s.document,
            selection: s.selection,
            viewport: { zoom: s.zoom, pan: s.pan },
            undo: [...undoStackRef.current],
            redo: [...redoStackRef.current],
            variableStore: s.variableStore,
          });
          const syncedSessions = s.sessions.map((sess) =>
            sess.id === s.activeId ? { ...sess, dirty: s.dirty } : sess,
          );
          const newId = `session-${Date.now()}`;
          const newDoc = createDocument('Untitled');
          undoStackRef.current = [];
          redoStackRef.current = [];
          return {
            ...s,
            document: newDoc,
            selection: [],
            zoom: 1,
            pan: { x: 0, y: 0 },
            dirty: false,
            variableStore: createVariableStore(),
            sessions: [...syncedSessions, { id: newId, name: 'Untitled', dirty: false }],
            activeId: newId,
          };
        });
      },

      switchTab: (id) => {
        setState((s) => {
          if (id === s.activeId) return s;
          // Snapshot current
          sessionStoreRef.current.set(s.activeId, {
            document: s.document,
            selection: s.selection,
            viewport: { zoom: s.zoom, pan: s.pan },
            undo: [...undoStackRef.current],
            redo: [...redoStackRef.current],
            variableStore: s.variableStore,
          });
          const syncedSessions = s.sessions.map((sess) =>
            sess.id === s.activeId ? { ...sess, dirty: s.dirty } : sess,
          );
          // Restore target session
          const saved = sessionStoreRef.current.get(id);
          const targetMeta = syncedSessions.find((sess) => sess.id === id);
          undoStackRef.current = saved ? [...saved.undo] : [];
          redoStackRef.current = saved ? [...saved.redo] : [];
          return {
            ...s,
            document: saved?.document ?? createDocument(targetMeta?.name ?? 'Untitled'),
            selection: saved?.selection ?? [],
            zoom: saved?.viewport.zoom ?? 1,
            pan: saved?.viewport.pan ?? { x: 0, y: 0 },
            dirty: targetMeta?.dirty ?? false,
            variableStore: saved?.variableStore ?? createVariableStore(),
            sessions: syncedSessions,
            activeId: id,
          };
        });
      },

      showExportDialog,
      setShowExportDialog,

      addPreset: (nodeId, preset) => {
        updateDoc((doc) => {
          const node = doc.nodes[nodeId];
          if (!node) return doc;
          const existing = node.presets ?? [];
          return {
            ...doc,
            nodes: {
              ...doc.nodes,
              [nodeId]: { ...node, presets: [...existing, preset] },
            },
          };
        });
      },

      updatePreset: (nodeId, updatedPreset) => {
        updateDoc((doc) => {
          const node = doc.nodes[nodeId];
          if (!node) return doc;
          const existing = node.presets ?? [];
          return {
            ...doc,
            nodes: {
              ...doc.nodes,
              [nodeId]: {
                ...node,
                presets: existing.map((p) => (p.id === updatedPreset.id ? updatedPreset : p)),
              },
            },
          };
        });
      },

      removePreset: (nodeId, presetId) => {
        updateDoc((doc) => {
          const node = doc.nodes[nodeId];
          if (!node) return doc;
          return {
            ...doc,
            nodes: {
              ...doc.nodes,
              [nodeId]: { ...node, presets: (node.presets ?? []).filter((p) => p.id !== presetId) },
            },
          };
        });
      },

      closeTab: (id, force = false) => {
        const sess = state.sessions.find((s) => s.id === id);
        if (sess?.dirty && !force) return false;
        setState((s) => {
          const remaining = s.sessions.filter((sess) => sess.id !== id);
          sessionStoreRef.current.delete(id);
          if (remaining.length === 0) {
            // Last tab — open a fresh one
            const newId = `session-${Date.now()}`;
            undoStackRef.current = [];
            redoStackRef.current = [];
            return {
              ...s,
              document: createDocument('Untitled'),
              selection: [],
              zoom: 1,
              pan: { x: 0, y: 0 },
              dirty: false,
              variableStore: createVariableStore(),
              sessions: [{ id: newId, name: 'Untitled', dirty: false }],
              activeId: newId,
            };
          }
          if (id !== s.activeId) {
            // Background tab — no switch needed
            return { ...s, sessions: remaining };
          }
          // Active tab — switch to adjacent
          const idx = s.sessions.findIndex((sess) => sess.id === id);
          const next = remaining[Math.min(idx, remaining.length - 1)];
          if (!next) return { ...s, sessions: remaining };
          const saved = sessionStoreRef.current.get(next.id);
          undoStackRef.current = saved ? [...saved.undo] : [];
          redoStackRef.current = saved ? [...saved.redo] : [];
          return {
            ...s,
            document: saved?.document ?? createDocument(next.name),
            selection: saved?.selection ?? [],
            zoom: saved?.viewport.zoom ?? 1,
            pan: saved?.viewport.pan ?? { x: 0, y: 0 },
            dirty: next.dirty,
            variableStore: saved?.variableStore ?? createVariableStore(),
            sessions: remaining,
            activeId: next.id,
          };
        });
        return true;
      },
    }),
    [state, patch, updateDoc, rootNodes, updateNodeProp, showExportDialog],
  );

  return <EditorCtx.Provider value={value}>{children}</EditorCtx.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}

// Build a shape with specific dragged size
function buildShapeWithSize(tool: ToolId, size: { w: number; h: number }): Shape {
  switch (tool) {
    case 'ellipse':
      return { kind: 'ellipse', cx: size.w / 2, cy: size.h / 2, rx: size.w / 2, ry: size.h / 2 };
    case 'polygon': {
      const r = Math.min(size.w, size.h) / 2;
      return { kind: 'polygon', cx: size.w / 2, cy: size.h / 2, radius: r, sides: 6, rotation: 0 };
    }
    case 'star': {
      const r = Math.min(size.w, size.h) / 2;
      return {
        kind: 'star',
        cx: size.w / 2,
        cy: size.h / 2,
        innerRadius: r * 0.4,
        outerRadius: r,
        points: 5,
        rotation: 0,
      };
    }
    case 'line':
      return { kind: 'line', from: [0, 0], to: [size.w, size.h], tolerance: 3 };
    case 'text':
      return { kind: 'rect', x: 0, y: 0, w: size.w, h: size.h };
    default:
      return { kind: 'rect', x: 0, y: 0, w: size.w, h: size.h };
  }
}
