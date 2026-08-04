/**
 * useLogoGeometry — geometry operations for logo construction (expand stroke,
 * offset path, corner rounding, simplify, mirror duplicate, radial duplicate).
 *
 * Follows the extracted-hook pattern: receives the editor's state primitives,
 * performs atomic multi-node mutations with undo support, and reports results
 * through the canvas announcer. All geometry math lives in
 * ../geometry/vectorOps.ts (pure, unit-tested); this hook only owns
 * selection/undo/announce orchestration.
 */
import type { ShapeNode } from '@varve/scene';
import { useCallback } from 'react';
import type { CanvasAnnouncer } from '../canvas/CanvasAnnouncer';
import {
  duplicateWithTransform,
  expandStrokeNode,
  mirrorTransform,
  nodeCenter,
  offsetPathNode,
  rotateAroundTransform,
  roundCornersNode,
  selectionCenter,
  simplifyPathNode,
} from '../geometry/vectorOps';
import type { EditorState } from './types';

export interface LogoGeometryAPI {
  /** Expand the selected nodes' strokes into filled outline geometry. */
  expandStrokeSelected: () => void;
  /** Offset the selected paths' outlines by `distance` (negative contracts). */
  offsetPathSelected: (distance: number, joinStyle?: 'miter' | 'round' | 'bevel') => void;
  /** Round path corners of the selected nodes with a fixed radius. */
  roundCornersSelected: (radius: number) => void;
  /** Simplify selected paths with a tolerance (larger = more aggressive). */
  simplifyPathSelected: (tolerance: number) => void;
  /** Duplicate the selection mirrored across the vertical/horizontal axis
   *  through its center. */
  mirrorDuplicateSelected: (axis: 'horizontal' | 'vertical') => void;
  /** Duplicate the selection `count` times arranged in a circle around its
   *  center, spanning `totalAngleDeg` (default 360). */
  radialDuplicateSelected: (count: number, totalAngleDeg?: number) => void;
}

export function useLogoGeometry(
  setState: React.Dispatch<React.SetStateAction<EditorState>>,
  stateRef: React.MutableRefObject<EditorState>,
  announcerRef: React.MutableRefObject<CanvasAnnouncer | null>,
  undoStackRef: React.MutableRefObject<unknown[]>,
  undoSelStackRef: React.MutableRefObject<string[][]>,
  redoStackRef: React.MutableRefObject<unknown[]>,
  redoSelStackRef: React.MutableRefObject<string[][]>,
  inTransactionRef: React.MutableRefObject<boolean>,
): LogoGeometryAPI {
  const pushUndo = useCallback(() => {
    if (inTransactionRef.current) return;
    const s = stateRef.current;
    undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
    undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
    redoStackRef.current = [];
    redoSelStackRef.current = [];
  }, [inTransactionRef, stateRef, undoStackRef, undoSelStackRef, redoStackRef, redoSelStackRef]);

  const announce = useCallback(
    (message: string) => {
      announcerRef.current?.announce(message);
    },
    [announcerRef],
  );

  const applyToSelectedPaths = useCallback(
    (label: string, fn: (node: ShapeNode) => ShapeNode | null, failedLabel: string) => {
      const sel = stateRef.current.selection;
      if (sel.length === 0) {
        announce('Select a shape to modify');
        return;
      }
      const doc = stateRef.current.document;
      let next = doc;
      const results = sel.map((id) => {
        const node = next.nodes[id] as ShapeNode | undefined;
        if (node?.kind !== 'shape') return null;
        const result = fn(node);
        if (!result) return null;
        next = {
          ...next,
          nodes: { ...next.nodes, [id]: result },
        };
        return id;
      });
      const changed = results.filter((r): r is string => r !== null);
      if (changed.length === 0) {
        announce(failedLabel);
        return;
      }
      pushUndo();
      setState((s) => ({
        ...s,
        document: next,
        dirty: true,
        undoLabel: label,
      }));
      announce(label);
    },
    [announce, pushUndo, setState, stateRef],
  );

  const expandStrokeSelected = useCallback(() => {
    applyToSelectedPaths(
      'Expanded stroke to outline',
      (node) => expandStrokeNode(node),
      'No selected shape has an expandable stroke',
    );
  }, [applyToSelectedPaths]);

  const offsetPathSelected = useCallback(
    (distance: number, joinStyle: 'miter' | 'round' | 'bevel' = 'round') => {
      applyToSelectedPaths(
        'Offset path',
        (node) => offsetPathNode(node, distance, joinStyle),
        'No selected shape has an offsettable path',
      );
    },
    [applyToSelectedPaths],
  );

  const roundCornersSelected = useCallback(
    (radius: number) => {
      applyToSelectedPaths(
        'Rounded path corners',
        (node) => roundCornersNode(node, radius),
        'No selected shape has roundable path corners',
      );
    },
    [applyToSelectedPaths],
  );

  const simplifyPathSelected = useCallback(
    (tolerance: number) => {
      applyToSelectedPaths(
        'Simplified path',
        (node) => simplifyPathNode(node, tolerance),
        'No selected shape has a simplifiable path',
      );
    },
    [applyToSelectedPaths],
  );

  const mirrorDuplicateSelected = useCallback(
    (axis: 'horizontal' | 'vertical') => {
      const sel = stateRef.current.selection;
      if (sel.length === 0) {
        announce('Select a shape to mirror');
        return;
      }
      const doc = stateRef.current.document;
      const center = selectionCenter(doc, sel);
      if (!center) return;
      const result = duplicateWithTransform(doc, sel, mirrorTransform(center, axis));
      if (!result) return;
      pushUndo();
      setState((s) => ({
        ...s,
        document: result.doc,
        selection: result.addedIds,
        dirty: true,
        undoLabel:
          axis === 'vertical' ? 'Mirror duplicate (vertical)' : 'Mirror duplicate (horizontal)',
      }));
      announce('Created mirrored duplicate');
    },
    [announce, pushUndo, setState, stateRef],
  );

  const radialDuplicateSelected = useCallback(
    (count: number, totalAngleDeg = 360) => {
      const sel = stateRef.current.selection;
      const safeCount = Math.max(2, Math.min(Math.floor(count), 64));
      if (sel.length === 0) {
        announce('Select a shape to duplicate');
        return;
      }
      const doc = stateRef.current.document;
      const center = selectionCenter(doc, sel);
      if (!center) return;
      pushUndo();
      let d = doc;
      const added: string[] = [];
      for (let i = 1; i < safeCount; i++) {
        const angle = (totalAngleDeg * i) / safeCount;
        const result = duplicateWithTransform(d, sel, rotateAroundTransform(center, angle));
        if (!result) break;
        d = result.doc;
        added.push(...result.addedIds);
      }
      if (added.length === 0) {
        announce('Could not create radial duplicates');
        return;
      }
      setState((s) => ({
        ...s,
        document: d,
        selection: [...sel, ...added],
        dirty: true,
        undoLabel: 'Radial duplicate',
      }));
      announce(`Created ${safeCount - 1} radial duplicates`);
    },
    [announce, pushUndo, setState, stateRef],
  );

  return {
    expandStrokeSelected,
    offsetPathSelected,
    roundCornersSelected,
    simplifyPathSelected,
    mirrorDuplicateSelected,
    radialDuplicateSelected,
  };
}

export type { ShapeNode };

export { nodeCenter };
