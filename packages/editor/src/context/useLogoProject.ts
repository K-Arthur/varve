/**
 * useLogoProject — editor glue over the scene logo project model.
 *
 * Exposes a small command surface for the manual logo workflow: create a
 * project + artboard, manage concepts (add/duplicate/status), register
 * variants, and patch the brief. All mutations go through updateDoc (undo
 * support) and keep the project's invariants via normalizeLogoProject.
 * The hook is deliberately thin — scene logic lives in
 * @varve/scene/src/logo/logoProject.ts (pure, unit-tested).
 */
import type { LogoConceptStatus, LogoVariantKind, NodeId } from '@varve/scene';
import {
  addClearSpaceGuides as addClearSpaceGuidesOp,
  addLogoConcept,
  addLogoVariant,
  createLogoArtboard,
  createLogoProject,
  duplicateLogoConcept,
  getLogoProject,
  normalizeLogoProject,
  patchLogoBrief,
  setLogoConceptStatus,
} from '@varve/scene';
import { useCallback } from 'react';
import type { CanvasAnnouncer } from '../canvas/CanvasAnnouncer';
import type { EditorState } from './types';

export interface LogoProjectAPI {
  /** Ensure a logo project exists; creates the first artboard + concept. */
  newLogoProject: (name?: string) => void;
  /** Create a new artboard + concept and select the artboard. */
  createLogoConcept: () => void;
  /** Duplicate the concept owning the active artboard (artwork included). */
  duplicateActiveConcept: () => void;
  /** Set a concept's status (pin/reject/archive/active). */
  setConceptStatus: (conceptId: string, status: LogoConceptStatus) => void;
  /** Register a variant over the active artboard. */
  createLogoVariant: (name: string, kind: LogoVariantKind) => void;
  /** Patch the editable brand brief. */
  patchBrief: (
    patch: Partial<{
      brandName: string;
      tagline: string;
      industry: string;
      audience: string;
      keywords: string[];
      preferredColors: string[];
      prohibitedColors: string[];
      notes: string;
    }>,
  ) => void;
  /** Add clear-space guides around the active artboard. */
  addClearSpaceGuides: (gap: number) => void;
}

/** Find the concept whose artboard is the given node (or an ancestor frame). */
function conceptForNode(
  doc: EditorState['document'],
  nodeId: NodeId,
): { id: string; name: string } | null {
  const project = getLogoProject(doc);
  if (!project) return null;
  const frameId = frameAncestor(doc, nodeId);
  if (!frameId) return null;
  const concept = project.concepts.find((c) => c.artboardId === frameId);
  return concept ? { id: concept.id, name: concept.name } : null;
}

/** Walk up the parent chain to the nearest frame ancestor (or the node itself). */
function frameAncestor(doc: EditorState['document'], id: NodeId): NodeId | null {
  let current: NodeId | null = id;
  while (current) {
    const node = doc.nodes[current];
    if (!node) return null;
    if (node.kind === 'frame') return current;
    current = findParentId(doc, current);
  }
  return null;
}

function findParentId(doc: EditorState['document'], id: NodeId): NodeId | null {
  for (const node of Object.values(doc.nodes)) {
    if ('children' in node && node.children.includes(id)) return node.id;
  }
  return null;
}

/** Active artboard = the frame ancestor of the primary selection, or null. */
function activeArtboardId(state: EditorState): NodeId | null {
  for (const id of state.selection) {
    const frame = frameAncestor(state.document, id);
    if (frame) return frame;
  }
  return null;
}

export function useLogoProject(
  setState: React.Dispatch<React.SetStateAction<EditorState>>,
  stateRef: React.MutableRefObject<EditorState>,
  updateDoc: (fn: (doc: EditorState['document']) => EditorState['document']) => void,
  announcerRef: React.MutableRefObject<CanvasAnnouncer | null>,
): LogoProjectAPI {
  const announce = useCallback(
    (message: string) => {
      announcerRef.current?.announce(message);
    },
    [announcerRef],
  );

  const newLogoProject = useCallback(
    (name?: string) => {
      const s = stateRef.current;
      const existing = getLogoProject(s.document);
      let artboardId: NodeId | null = null;
      updateDoc((doc) => {
        let d = doc;
        if (!d.logoProject) {
          d = {
            ...d,
            logoProject: normalizeLogoProject(createLogoProject(name ?? 'Logo Project')),
          };
        }
        const count = d.logoProject?.concepts.length ?? 0;
        const col = count % 3;
        const row = Math.floor(count / 3);
        const created = createLogoArtboard(d, {
          name: `Concept ${count + 1}`,
          width: 1024,
          height: 1024,
          x: col * 1280,
          y: row * 1280,
        });
        artboardId = created.artboardId;
        d = addLogoConcept(created.doc, {
          name: `Concept ${count + 1}`,
          artboardId: created.artboardId,
        });
        return d;
      });
      if (artboardId) {
        setState((prev) => ({ ...prev, selection: [artboardId!] }));
      }
      announce(existing ? 'Created logo concept artboard' : 'Created logo project');
    },
    [announce, setState, stateRef, updateDoc],
  );

  const createLogoConcept = useCallback(() => {
    const s = stateRef.current;
    if (!getLogoProject(s.document)) {
      announce('Create a logo project first (File → New Logo Project)');
      return;
    }
    let artboardId: NodeId | null = null;
    updateDoc((doc) => {
      const count = doc.logoProject?.concepts.length ?? 0;
      const col = count % 3;
      const row = Math.floor(count / 3);
      const created = createLogoArtboard(doc, {
        name: `Concept ${count + 1}`,
        width: 1024,
        height: 1024,
        x: col * 1280,
        y: row * 1280,
      });
      artboardId = created.artboardId;
      return addLogoConcept(created.doc, {
        name: `Concept ${count + 1}`,
        artboardId: created.artboardId,
      });
    });
    if (artboardId) {
      setState((prev) => ({ ...prev, selection: [artboardId!] }));
    }
    announce('Created new concept artboard');
  }, [announce, setState, stateRef, updateDoc]);

  const duplicateActiveConcept = useCallback(() => {
    const s = stateRef.current;
    const artboardId = activeArtboardId(s);
    if (!artboardId) {
      announce('Select artwork inside a concept artboard first');
      return;
    }
    const concept = conceptForNode(s.document, artboardId);
    if (!concept) {
      announce('The active artboard is not registered as a logo concept');
      return;
    }
    let newArtboardId: NodeId | null = null;
    updateDoc((doc) => {
      const duplicated = duplicateLogoConcept(doc, concept.id);
      const project = getLogoProject(duplicated);
      const copy = project?.concepts[project.concepts.length - 1];
      newArtboardId = copy?.artboardId ?? null;
      return duplicated;
    });
    if (newArtboardId) {
      setState((prev) => ({ ...prev, selection: [newArtboardId!] }));
    }
    announce('Duplicated concept');
  }, [announce, setState, stateRef, updateDoc]);

  const setConceptStatus = useCallback(
    (conceptId: string, status: LogoConceptStatus) => {
      updateDoc((doc) => setLogoConceptStatus(doc, conceptId, status));
    },
    [updateDoc],
  );

  const createLogoVariant = useCallback(
    (name: string, kind: LogoVariantKind) => {
      const s = stateRef.current;
      const artboardId = activeArtboardId(s);
      if (!artboardId) {
        announce('Select artwork inside a concept artboard first');
        return;
      }
      const concept = conceptForNode(s.document, artboardId);
      updateDoc((doc) =>
        addLogoVariant(doc, {
          name,
          kind,
          artboardId,
          sourceConceptId: concept?.id ?? null,
          derivedFromVariantId: null,
        }),
      );
      announce(`Registered ${kind} variant`);
    },
    [announce, stateRef, updateDoc],
  );

  const patchBrief = useCallback(
    (patch: Parameters<LogoProjectAPI['patchBrief']>[0]) => {
      updateDoc((doc) => patchLogoBrief(doc, patch));
    },
    [updateDoc],
  );

  const addClearSpaceGuides = useCallback(
    (gap: number) => {
      const artboardId = activeArtboardId(stateRef.current);
      if (!artboardId) {
        announce('Select artwork inside a concept artboard first');
        return;
      }
      updateDoc((doc) => addClearSpaceGuidesOp(doc, artboardId, gap));
      announce('Added clear-space guides');
    },
    [announce, stateRef, updateDoc],
  );

  return {
    newLogoProject,
    createLogoConcept,
    duplicateActiveConcept,
    setConceptStatus,
    createLogoVariant,
    patchBrief,
    addClearSpaceGuides,
  };
}
