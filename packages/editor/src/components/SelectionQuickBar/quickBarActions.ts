/**
 * Pure helpers + action dispatch for SelectionQuickBar.
 */
import type { ImageFit, NodeId, ShapeNode } from '@varve/scene';
import { getImageFill, isImageShape } from '@varve/scene';
import type { QuickBarActionId } from './resolveQuickBarProfile';

export const IMAGE_FIT_CYCLE: readonly ImageFit[] = ['fill', 'fit', 'crop', 'stretch', 'tile'];

export function nextImageFit(current: ImageFit): ImageFit {
  const idx = IMAGE_FIT_CYCLE.indexOf(current);
  return IMAGE_FIT_CYCLE[(idx + 1) % IMAGE_FIT_CYCLE.length]!;
}

export function cycleSelectedImageFit(node: ShapeNode): ShapeNode | null {
  if (!isImageShape(node)) return null;
  const fill = getImageFill(node);
  if (!fill?.image) return null;
  const nextFit = nextImageFit(fill.image.fit);
  const fills = (node.fills ?? []).map((f) =>
    f.type === 'image' && f.image ? { ...f, image: { ...f.image, fit: nextFit } } : f,
  );
  return { ...node, fills };
}

export interface QuickBarActionDeps {
  selection: NodeId[];
  setTool: (tool: string) => void;
  setSelectedFlipH: () => void;
  setSelectedFlipV: () => void;
  removeBackgroundWithOptions: (
    method: 'quick',
    feather: number,
    decontaminate: boolean,
  ) => Promise<void>;
  cancelBackgroundRemoval: () => void;
  openUpscaleDialog: () => void;
  traceSelectedImage: (opts: {
    mode: 'monochrome';
    threshold: number;
    foreground: 'dark';
    minArea: number;
    simplifyTolerance: number;
  }) => Promise<void>;
  setShowOriginalBg: (nodeId: NodeId | null) => void;
  setRefineMaskOptions?: (opts: { brushSize: number; hardness: number }) => void;
  updateNode: (id: NodeId, updater: (n: ShapeNode) => ShapeNode) => void;
  showOriginalBgNodeId: NodeId | null;
  selectedImageNode: ShapeNode | null;
  setNodeEditTargetId?: (id: string | null) => void;
  setTextEditTargetId?: (id: string | null) => void;
  groupSelected?: () => void;
  booleanOp?: (kind: 'union' | 'subtract' | 'intersect' | 'exclude') => void;
  simplifySelectedPath?: () => void;
  toggleSelectedPathClosed?: (closed: boolean) => void;
  announce?: (msg: string) => void;
}

/** Dispatch a quick-bar action against editor deps. */
export async function dispatchQuickBarAction(
  id: QuickBarActionId,
  deps: QuickBarActionDeps,
): Promise<void> {
  switch (id) {
    case 'flipH':
      deps.setSelectedFlipH();
      return;
    case 'flipV':
      deps.setSelectedFlipV();
      return;
    case 'crop':
      deps.setTool('crop');
      return;
    case 'removeBg':
      await deps.removeBackgroundWithOptions('quick', 0.5, true);
      return;
    case 'cancelBg':
      deps.cancelBackgroundRemoval();
      return;
    case 'upscale':
      deps.openUpscaleDialog();
      return;
    case 'vectorize':
      await deps.traceSelectedImage({
        mode: 'monochrome',
        threshold: 128,
        foreground: 'dark',
        minArea: 4,
        simplifyTolerance: 0.75,
      });
      return;
    case 'fitCycle': {
      const node = deps.selectedImageNode;
      if (!node) return;
      const next = cycleSelectedImageFit(node);
      if (!next) return;
      deps.updateNode(node.id, () => next);
      deps.announce?.(`Image fit: ${getImageFill(next)?.image?.fit ?? 'fill'}`);
      return;
    }
    case 'refineMask':
      deps.setRefineMaskOptions?.({ brushSize: 20, hardness: 0.8 });
      deps.setTool('refineMask');
      return;
    case 'showOriginal': {
      const node = deps.selectedImageNode;
      if (!node) return;
      if (deps.showOriginalBgNodeId === node.id) {
        deps.setShowOriginalBg(null);
      } else {
        deps.setShowOriginalBg(node.id);
      }
      return;
    }
    case 'editNodes': {
      const id = deps.selection[0];
      if (!id) return;
      deps.setNodeEditTargetId?.(id);
      deps.setTool('nodeEdit');
      return;
    }
    case 'editText': {
      const id = deps.selection[0];
      if (!id) return;
      deps.setTextEditTargetId?.(id);
      return;
    }
    case 'group':
      deps.groupSelected?.();
      return;
    case 'booleanUnion':
      deps.booleanOp?.('union');
      return;
    case 'booleanSubtract':
      deps.booleanOp?.('subtract');
      return;
    case 'booleanIntersect':
      deps.booleanOp?.('intersect');
      return;
    case 'booleanExclude':
      deps.booleanOp?.('exclude');
      return;
    case 'simplify':
      deps.simplifySelectedPath?.();
      return;
    case 'closePath':
      deps.toggleSelectedPathClosed?.(true);
      return;
    case 'openPath':
      deps.toggleSelectedPathClosed?.(false);
      return;
    default:
      return;
  }
}
