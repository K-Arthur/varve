import type { Document, FrameNode, SceneNode } from '@varve/scene';

export interface LayoutClassification {
  type: 'hero' | 'card-grid' | 'list' | 'sidebar' | 'header-footer' | 'dashboard' | 'freeform';
  confidence: number;
  features: {
    childCount: number;
    aspectRatios: number[];
    alignment: 'horizontal' | 'vertical' | 'grid' | 'freeform';
  };
}

function getNodeBounds(node: SceneNode): { w: number; h: number } | null {
  if (node.kind === 'frame') {
    return { w: node.w, h: node.h };
  }
  if (node.kind === 'shape') {
    const shape = node.shape;
    if ('w' in shape && 'h' in shape) {
      return { w: shape.w as number, h: shape.h as number };
    }
    return null;
  }
  if (node.kind === 'text') {
    return { w: node.w ?? 100, h: node.h ?? 20 };
  }
  return null;
}

export function classifyLayout(node: FrameNode, doc: Document): LayoutClassification {
  const childrenIds = node.children ?? [];
  const children = childrenIds
    .map((id) => doc.nodes[id])
    .filter((n): n is SceneNode => n != null && n.visible !== false);

  if (children.length < 2) {
    return {
      type: 'freeform',
      confidence: 1,
      features: {
        childCount: children.length,
        aspectRatios: children
          .map((c) => getNodeBounds(c))
          .filter((b): b is { w: number; h: number } => b != null)
          .map((b) => (b.h > 0 ? b.w / b.h : 1)),
        alignment: 'freeform',
      },
    };
  }

  const bounds = children.map((c) => getNodeBounds(c));
  const validBounds = bounds.filter((b): b is { w: number; h: number } => b != null);

  const aspectRatios = validBounds.map((b) => (b.h > 0 ? b.w / b.h : 1));

  const transforms = children.map((c) => c.transform ?? [1, 0, 0, 1, 0, 0]);
  const positions = transforms.map((t) => ({
    x: t[4] ?? 0,
    y: t[5] ?? 0,
  }));

  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);

  const xSpread = Math.max(...xs) - Math.min(...xs);
  const ySpread = Math.max(...ys) - Math.min(...ys);

  const uniqueXs = new Set(xs.map((x) => Math.round(x)));
  const uniqueYs = new Set(ys.map((y) => Math.round(y)));

  const widths = validBounds.map((b) => b.w);
  const heights = validBounds.map((b) => b.h);

  const widthSimilar =
    widths.length > 1 &&
    widths.every((w) => Math.abs(w - widths[0]!) / Math.max(widths[0]!, 1) < 0.15);
  const heightSimilar =
    heights.length > 1 &&
    heights.every((h) => Math.abs(h - heights[0]!) / Math.max(heights[0]!, 1) < 0.15);

  const isGrid = uniqueYs.size >= 2 && uniqueXs.size >= 2 && widthSimilar && heightSimilar;

  const isVerticalStack = ySpread > xSpread && uniqueXs.size <= 2;

  const isHorizontalRow = xSpread > ySpread && uniqueYs.size <= 2;

  const largestChild = validBounds.reduce(
    (max, b) => (b.w * b.h > max.w * max.h ? b : max),
    validBounds[0] ?? { w: 0, h: 0 },
  );
  const largestArea = largestChild.w * largestChild.h;
  const frameArea = node.w * node.h;
  const hasDominantChild = frameArea > 0 && largestArea / frameArea > 0.4;

  const narrowThreshold = Math.min(node.w, node.h) * 0.35;
  const hasNarrowSidebar = validBounds.some((b) => b.w <= narrowThreshold && b.h > node.h * 0.7);

  if (isGrid) {
    return {
      type: 'card-grid',
      confidence: 0.85,
      features: { childCount: children.length, aspectRatios, alignment: 'grid' },
    };
  }

  if (hasNarrowSidebar && children.length >= 2) {
    return {
      type: 'sidebar',
      confidence: 0.75,
      features: { childCount: children.length, aspectRatios, alignment: 'horizontal' },
    };
  }

  if (hasDominantChild && children.length >= 2) {
    const topChild = children.reduce((prev, curr) => {
      const pY = (prev.transform ?? [1, 0, 0, 1, 0, 0])[5] ?? 0;
      const cY = (curr.transform ?? [1, 0, 0, 1, 0, 0])[5] ?? 0;
      return pY <= cY ? prev : curr;
    }, children[0]!);
    const topBounds = getNodeBounds(topChild);
    if (topBounds && positions[children.indexOf(topChild)]!.y < ySpread * 0.3) {
      return {
        type: 'hero',
        confidence: 0.7,
        features: { childCount: children.length, aspectRatios, alignment: 'horizontal' },
      };
    }
  }

  if (isVerticalStack && widthSimilar) {
    return {
      type: 'list',
      confidence: 0.8,
      features: { childCount: children.length, aspectRatios, alignment: 'vertical' },
    };
  }

  if (isHorizontalRow && heightSimilar && children.length >= 3) {
    return {
      type: 'dashboard',
      confidence: 0.65,
      features: { childCount: children.length, aspectRatios, alignment: 'horizontal' },
    };
  }

  if (isHorizontalRow && heightSimilar && children.length === 2) {
    return {
      type: 'header-footer',
      confidence: 0.6,
      features: { childCount: children.length, aspectRatios, alignment: 'horizontal' },
    };
  }

  return {
    type: 'freeform',
    confidence: 0.5,
    features: { childCount: children.length, aspectRatios, alignment: 'freeform' },
  };
}
