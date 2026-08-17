import { type AuditFinding, type Document, getParent } from '@varve/scene';
import type { Viewport } from '@varve/shared';
import { useCallback, useRef } from 'react';
import type { SectionId } from '../components/Inspector/sectionRegistry';
import { useEditor } from '../context';
import type { EditorState } from '../context/types';
import type {
  FindingNavigationOptions,
  NavigationResult,
  NavigationStep,
  SubjectResolution,
} from './types';

const NAVIGATION_PADDING = 60;
const FLASH_DURATION_MS = 1200;
const MIN_BOUNDS_SIZE = 1;

function clampBounds(b: { x: number; y: number; w: number; h: number }) {
  return { x: b.x, y: b.y, w: Math.max(b.w, MIN_BOUNDS_SIZE), h: Math.max(b.h, MIN_BOUNDS_SIZE) };
}

function nodeWorldBounds(
  doc: Document,
  nodeId: string,
): { x: number; y: number; w: number; h: number } | null {
  const n = doc.nodes[nodeId];
  if (!n) return null;
  const tx = n.transform[4] ?? 0;
  const ty = n.transform[5] ?? 0;
  if (n.kind === 'shape') {
    const s = (n as import('@varve/scene').ShapeNode).shape;
    if (s.kind === 'rect') return clampBounds({ x: tx + s.x, y: ty + s.y, w: s.w, h: s.h });
    if (s.kind === 'ellipse')
      return clampBounds({ x: tx + s.cx - s.rx, y: ty + s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 });
    if (s.kind === 'circle')
      return clampBounds({ x: tx + s.cx - s.r, y: ty + s.cy - s.r, w: s.r * 2, h: s.r * 2 });
    if (s.kind === 'line') {
      const minX = Math.min(s.from[0], s.to[0]);
      const maxX = Math.max(s.from[0], s.to[0]);
      const minY = Math.min(s.from[1], s.to[1]);
      const maxY = Math.max(s.from[1], s.to[1]);
      return clampBounds({ x: tx + minX, y: ty + minY, w: maxX - minX || 1, h: maxY - minY || 1 });
    }
    return null;
  }
  if (n.kind === 'frame') {
    const f = n as import('@varve/scene').FrameNode;
    return clampBounds({ x: tx, y: ty, w: f.w ?? 200, h: f.h ?? 160 });
  }
  if (n.kind === 'group') {
    const children: string[] = (n as import('@varve/scene').GroupNode).children ?? [];
    if (children.length === 0) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const childId of children) {
      const b = nodeWorldBounds(doc, childId);
      if (b) {
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
    }
    if (!Number.isFinite(minX)) return null;
    return clampBounds({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  }
  return null;
}

function detectInteractionGuard(state: EditorState): string | null {
  if (state.prototypeMode || state.isPresenting) return 'presentation mode';
  if (state.tool === 'nodeEdit') return 'text editing';
  if (state.tool === 'crop') return 'cropping';
  if (state.maskPreviewMode !== 'none') return 'mask editing';
  return null;
}

function resolveSubject(finding: AuditFinding, doc: Document): SubjectResolution {
  if (finding.nodeId) {
    const node = doc.nodes[finding.nodeId];
    if (!node) {
      return { kind: 'stale', nodeIds: [finding.nodeId] };
    }
    return { kind: 'node', nodeIds: [finding.nodeId], pageId: finding.pageId };
  }

  if (finding.pageId) {
    const page = doc.nodes[finding.pageId];
    if (!page) {
      return { kind: 'stale', nodeIds: [] };
    }
    return { kind: 'page', nodeIds: [], pageId: finding.pageId };
  }

  return { kind: 'document', nodeIds: [] };
}

function isNodeHidden(doc: Document, nodeId: string): boolean {
  const node = doc.nodes[nodeId];
  return node ? node.visible === false : false;
}

function isNodeLocked(doc: Document, nodeId: string): boolean {
  const node = doc.nodes[nodeId];
  return node ? node.locked === true : false;
}

function findNestedComponentInstance(doc: Document, nodeId: string): string | null {
  const parentId = getParent(doc, nodeId);
  if (!parentId) return null;
  const parent = doc.nodes[parentId];
  if (!parent) return null;
  if (parent.kind === 'frame') {
    const frame = parent as import('@varve/scene').FrameNode;
    if (frame.componentId) return parentId;
  }
  return findNestedComponentInstance(doc, parentId);
}

function isComfortablyVisible(
  zoom: number,
  pan: { x: number; y: number },
  bounds: { x: number; y: number; w: number; h: number },
  vp: Viewport,
): boolean {
  const margin = 0.15;
  const padded = {
    x: bounds.x - bounds.w * margin,
    y: bounds.y - bounds.h * margin,
    w: bounds.w * (1 + margin * 2),
    h: bounds.h * (1 + margin * 2),
  };
  const viewLeft = -pan.x / zoom;
  const viewTop = -pan.y / zoom;
  const viewRight = viewLeft + vp.width / zoom;
  const viewBottom = viewTop + vp.height / zoom;
  return (
    viewLeft <= padded.x &&
    viewTop <= padded.y &&
    viewRight >= padded.x + padded.w &&
    viewBottom >= padded.y + padded.h
  );
}

export interface FindingNavigationAPI {
  navigateToFinding: (
    finding: AuditFinding,
    findings: AuditFinding[],
    opts?: FindingNavigationOptions,
  ) => Promise<NavigationResult>;
  isNavigatingRef: React.MutableRefObject<boolean>;
}

export function useFindingNavigation(): FindingNavigationAPI {
  const editor = useEditor();
  const {
    state,
    setSelection,
    toggleSelection,
    setCurrentPageId,
    setInspectorTab,
    showInspectorSection,
    toggleSectionCollapse,
    showToast,
  } = editor;
  const { smoothReveal, fitAll } = editor;
  const abortRef = useRef<AbortController | null>(null);
  const isNavigatingRef = useRef(false);

  const navigateToFinding = useCallback(
    async (
      finding: AuditFinding,
      findings: AuditFinding[],
      opts?: FindingNavigationOptions,
    ): Promise<NavigationResult> => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      isNavigatingRef.current = true;

      const signal = opts?.signal ?? controller.signal;
      const skipSteps = opts?.skipSteps ?? new Set<NavigationStep>();

      const reject = (step: NavigationStep, error: string): NavigationResult => {
        isNavigatingRef.current = false;
        return { step, ok: false, error, findingId: finding.findingId };
      };

      const aborted = (_step: NavigationStep): boolean => {
        if (signal.aborted) {
          isNavigatingRef.current = false;
          return true;
        }
        return false;
      };

      // Step 1: Resolve finding
      if (!skipSteps.has('resolve')) {
        const currentFinding = findings.find((f) => f.findingId === finding.findingId);
        if (!currentFinding) {
          return reject('resolve', 'This finding was not found in the current scan');
        }
        if (aborted('resolve'))
          return { step: 'resolve', ok: false, error: 'aborted', findingId: finding.findingId };
        opts?.onStep?.('resolve');
      }

      // Step 2: Resolve subject
      if (!skipSteps.has('resolve-subject')) {
        const subject = resolveSubject(finding, state.document);
        if (subject.kind === 'stale') {
          return reject('resolve-subject', 'This issue no longer exists');
        }
        if (subject.kind === 'document') {
          return reject('resolve-subject', 'Document-level finding: no node to navigate to');
        }
        if (aborted('resolve-subject'))
          return {
            step: 'resolve-subject',
            ok: false,
            error: 'aborted',
            findingId: finding.findingId,
          };
        opts?.onStep?.('resolve-subject');

        // Interaction guard
        const guardReason = detectInteractionGuard(state);
        if (guardReason) {
          return reject('resolve-subject', `Cannot navigate: ${guardReason} is in progress`);
        }

        // Check hidden
        for (const nid of subject.nodeIds) {
          if (isNodeHidden(state.document, nid)) {
            showToast({
              message: `Node is hidden — show it in the layers panel to edit`,
              type: 'warning',
            });
          }
        }

        // Check locked
        for (const nid of subject.nodeIds) {
          if (isNodeLocked(state.document, nid)) {
            showToast({
              message: `Node is locked — selecting it for inspection only`,
              type: 'info',
            });
          }
        }

        // Check component instance nesting
        for (const nid of subject.nodeIds) {
          const instanceId = findNestedComponentInstance(state.document, nid);
          if (instanceId) {
            showToast({ message: `Node is inside a component instance`, type: 'info' });
          }
        }
      }

      // Step 3: Switch page
      if (!skipSteps.has('switch-page')) {
        if (finding.pageId && finding.pageId !== state.currentPageId) {
          const pageExists = !!state.document.nodes[finding.pageId];
          if (!pageExists) {
            return reject('switch-page', 'The page for this finding no longer exists');
          }
          setCurrentPageId(finding.pageId);
          if (aborted('switch-page'))
            return {
              step: 'switch-page',
              ok: false,
              error: 'aborted',
              findingId: finding.findingId,
            };
          opts?.onStep?.('switch-page');
        }
      }

      // Step 4: Select nodes
      if (!skipSteps.has('select-nodes')) {
        const subject = resolveSubject(finding, state.document);
        if (subject.kind === 'node') {
          if (subject.nodeIds.length === 1) {
            setSelection(subject.nodeIds[0]!);
          } else if (subject.nodeIds.length > 1) {
            setSelection(subject.nodeIds[0]!);
            for (let i = 1; i < subject.nodeIds.length; i++) {
              toggleSelection(subject.nodeIds[i]!, true);
            }
          }
        }
        if (aborted('select-nodes'))
          return {
            step: 'select-nodes',
            ok: false,
            error: 'aborted',
            findingId: finding.findingId,
          };
        opts?.onStep?.('select-nodes');
      }

      // Step 5: Zoom/pan canvas
      if (!skipSteps.has('zoom-canvas')) {
        const subject = resolveSubject(finding, state.document);
        if (subject.kind === 'node' || subject.kind === 'nodes') {
          let unionBounds: { x: number; y: number; w: number; h: number } | null = null;
          if (subject.nodeIds.length === 1) {
            unionBounds = nodeWorldBounds(state.document, subject.nodeIds[0]!);
          } else {
            let minX = Infinity,
              minY = Infinity,
              maxX = -Infinity,
              maxY = -Infinity;
            for (const id of subject.nodeIds) {
              const b = nodeWorldBounds(state.document, id);
              if (b) {
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w);
                maxY = Math.max(maxY, b.y + b.h);
              }
            }
            if (Number.isFinite(minX)) {
              unionBounds = clampBounds({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
            }
          }

          if (unionBounds) {
            const vp = { width: window.innerWidth, height: window.innerHeight };
            const comfortable = isComfortablyVisible(state.zoom, state.pan, unionBounds, vp);
            if (!comfortable) {
              smoothReveal(unionBounds, { padding: NAVIGATION_PADDING });
            }
          }
        } else {
          fitAll();
        }
        if (aborted('zoom-canvas'))
          return { step: 'zoom-canvas', ok: false, error: 'aborted', findingId: finding.findingId };
        opts?.onStep?.('zoom-canvas');
      }

      // Step 6: Open inspector
      if (!skipSteps.has('open-inspector')) {
        setInspectorTab('properties');
        if (aborted('open-inspector'))
          return {
            step: 'open-inspector',
            ok: false,
            error: 'aborted',
            findingId: finding.findingId,
          };
        opts?.onStep?.('open-inspector');
      }

      // Step 7: Expand section
      if (!skipSteps.has('expand-section')) {
        const sectionId = finding.inspectorSection;
        if (sectionId) {
          const sid = sectionId as SectionId;
          showInspectorSection(sid);
          toggleSectionCollapse(sid);
        }
        if (aborted('expand-section'))
          return {
            step: 'expand-section',
            ok: false,
            error: 'aborted',
            findingId: finding.findingId,
          };
        opts?.onStep?.('expand-section');
      }

      // Step 8: Flash
      if (!skipSteps.has('flash-target')) {
        flashTarget(state.document, finding.nodeId);
        if (aborted('flash-target'))
          return {
            step: 'flash-target',
            ok: false,
            error: 'aborted',
            findingId: finding.findingId,
          };
        opts?.onStep?.('flash-target');
      }

      isNavigatingRef.current = false;
      opts?.onStep?.('done');
      return { step: 'done', ok: true, findingId: finding.findingId };
    },
    [
      state,
      editor,
      setSelection,
      toggleSelection,
      setCurrentPageId,
      setInspectorTab,
      showInspectorSection,
      toggleSectionCollapse,
      showToast,
      smoothReveal,
      fitAll,
    ],
  );

  return { navigateToFinding, isNavigatingRef };
}

function flashTarget(doc: Document, nodeId?: string): void {
  if (!nodeId) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (el instanceof HTMLElement) {
    el.style.transition = `outline ${FLASH_DURATION_MS}ms ease-out`;
    el.style.outline = '2px solid var(--color-accent-primary)';
    el.style.outlineOffset = '2px';
    setTimeout(() => {
      el.style.outline = '';
      el.style.outlineOffset = '';
    }, FLASH_DURATION_MS);
  }

  const node = doc.nodes[nodeId];
  if (node) {
    const ancestors = [nodeId];
    let current: string | null = nodeId;
    while (current) {
      current = getParent(doc, current);
      if (current) ancestors.push(current);
    }
    for (const aid of ancestors) {
      const ael = document.querySelector(`[data-layer-id="${aid}"]`);
      if (ael instanceof HTMLElement) {
        ael.style.transition = `background-color ${FLASH_DURATION_MS}ms ease-out`;
        ael.style.backgroundColor = 'var(--color-accent-subtle, rgba(0, 128, 255, 0.08))';
        setTimeout(() => {
          ael.style.backgroundColor = '';
        }, FLASH_DURATION_MS);
      }
    }
  }
}
