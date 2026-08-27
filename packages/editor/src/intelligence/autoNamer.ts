import type { Document, NodeId, SceneNode } from '@varve/scene';
import {
  getParent,
  imageShapeH,
  imageShapeW,
  isImageShape,
  shapeHeight,
  shapeWidth,
} from '@varve/scene';

export interface NamingSuggestion {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  matchedRule: string;
}

const BUTTON_LIKE_TEXT = new Set([
  'submit',
  'save',
  'cancel',
  'ok',
  'done',
  'next',
  'back',
  'login',
  'sign up',
  'buy',
  'add',
  'remove',
  'send',
  'continue',
  'confirm',
]);

const LINK_PHRASES = new Set(['learn more', 'read more', 'click here']);

const DEFAULT_NAME_RE =
  /^(Rectangle|Ellipse|Circle|Line|Polygon|Star|Frame|Group|Text|Image)\s+\d+$/;

function isButtonLikeText(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (BUTTON_LIKE_TEXT.has(trimmed)) return true;
  for (const word of BUTTON_LIKE_TEXT) {
    if (trimmed === word || trimmed.startsWith(`${word} `)) return true;
  }
  return false;
}

function isLinkLikeText(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('www.'))
    return true;
  if (trimmed.endsWith('.com') || trimmed.endsWith('.org') || trimmed.endsWith('.net')) return true;
  return LINK_PHRASES.has(trimmed);
}

function truncateText(text: string, maxLen: number = 30): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}\u2026`;
}

function getNodeWidth(node: SceneNode): number | null {
  switch (node.kind) {
    case 'shape':
      if (isImageShape(node)) return imageShapeW(node);
      return shapeWidth(node.shape);
    default:
      return null;
  }
}

function getNodeHeight(node: SceneNode): number | null {
  switch (node.kind) {
    case 'shape':
      if (isImageShape(node)) return imageShapeH(node);
      return shapeHeight(node.shape);
    case 'frame':
      return node.h;
    default:
      return null;
  }
}

const KIND_NAMES: Record<string, string> = {
  shape: 'Shape',
  text: 'Text',
  frame: 'Frame',
  group: 'Group',
  image: 'Image',
  adjustment: 'Adjustment',
  table: 'Table',
};

function isHeadingLike(node: SceneNode): boolean {
  if (node.kind !== 'text') return false;
  return node.fontSize >= 24 || (node.fontWeight ?? 400) >= 700 || node.textAlign === 'center';
}

function isBodyText(text: string): boolean {
  return text.trim().length > 100;
}

function getComponentName(doc: Document, node: SceneNode): string | null {
  if (node.kind !== 'frame' || !node.componentId) return null;
  return doc.components[node.componentId]?.name ?? null;
}

function getVariantName(doc: Document, node: SceneNode): string | null {
  if (node.kind !== 'frame' || !node.componentId || !node.variant) return null;
  const component = doc.components[node.componentId];
  if (!component?.variants) return null;
  return component.variants.find((v) => v.id === node.variant)?.name ?? null;
}

function getRectIconLabel(node: SceneNode): 'icon' | 'button' | null {
  if (node.kind !== 'shape' || node.shape.kind !== 'rect') return null;
  const w = getNodeWidth(node);
  const h = getNodeHeight(node);
  if (w === null || h === null) return null;
  if (w === h && w < 30) return 'icon';
  if (node.cornerRadius != null && w >= 32 && w <= 200 && h >= 28 && h <= 60) return 'button';
  return null;
}

function getShapeKindName(node: SceneNode): string | null {
  if (node.kind !== 'shape') return null;
  switch (node.shape.kind) {
    case 'rect':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'line':
      return 'Line';
    case 'polygon':
      return 'Polygon';
    case 'star':
      return 'Star';
    case 'arrow':
      return 'Arrow';
    case 'path':
      return 'Vector shape';
    default:
      return null;
  }
}

function getDefaultKindName(node: SceneNode): string {
  if (node.kind === 'frame' && node.frameRole === 'exportRegion') return 'Export Region';
  if (node.kind === 'shape') {
    return getShapeKindName(node) ?? KIND_NAMES[node.kind] ?? 'Shape';
  }
  return KIND_NAMES[node.kind] ?? 'Node';
}

export function suggestName(
  node: SceneNode,
  doc: Document,
  index?: number,
  imageLabels?: Map<NodeId, string>,
): NamingSuggestion {
  if (node.kind === 'frame' && node.frameRole === 'exportRegion') {
    return {
      name: 'Export Region 0',
      confidence: 'low',
      matchedRule: '17-default',
    };
  }

  // 1. Text with button-like content -> "Button: {text}" (high)
  if (node.kind === 'text' && isButtonLikeText(node.text)) {
    return {
      name: `Button: ${truncateText(node.text.trim(), 25)}`,
      confidence: 'high',
      matchedRule: '1-text-button',
    };
  }

  // 2. Text with link-like content -> "Link: {text}" (high)
  if (node.kind === 'text' && isLinkLikeText(node.text)) {
    return {
      name: `Link: ${truncateText(node.text.trim(), 25)}`,
      confidence: 'high',
      matchedRule: '2-text-link',
    };
  }

  // 3. Text with heading-like properties -> "Heading: {text[:20]}" (high)
  if (node.kind === 'text' && isHeadingLike(node)) {
    const text = node.text.trim() || 'Untitled';
    return {
      name: `Heading: ${truncateText(text, 20)}`,
      confidence: 'high',
      matchedRule: '3-text-heading',
    };
  }

  // 4. Long text body -> "Body: {text[:30]}..." (medium)
  if (node.kind === 'text' && isBodyText(node.text)) {
    return {
      name: `Body: ${truncateText(node.text.trim(), 30)}...`,
      confidence: 'medium',
      matchedRule: '4-text-body',
    };
  }

  // 5. Plain text -> "Text: {text[:20]}" (medium)
  if (node.kind === 'text') {
    return {
      name: `Text: ${truncateText(node.text.trim(), 20)}`,
      confidence: 'medium',
      matchedRule: '5-text',
    };
  }

  // 6. Variant instance -> "{componentName} / {variantName}" (high)
  if (node.kind === 'frame' && node.componentId && node.variant) {
    const compName = getComponentName(doc, node) ?? 'Component';
    const variantName = getVariantName(doc, node) ?? 'variant';
    return {
      name: `${compName} / ${variantName}`,
      confidence: 'high',
      matchedRule: '6-component-variant',
    };
  }

  // 7. Component instance -> "{componentName} instance" (high)
  if (node.kind === 'frame' && node.componentId) {
    const compName = getComponentName(doc, node) ?? 'Component';
    return {
      name: `${compName} instance`,
      confidence: 'high',
      matchedRule: '7-component-instance',
    };
  }

  // 8. Frame with non-grid/flex layout -> "Auto-layout frame" (medium)
  if (
    node.kind === 'frame' &&
    node.layoutStyle != null &&
    node.layoutStyle.mode !== 'grid' &&
    node.layoutStyle.mode !== 'flex'
  ) {
    return {
      name: 'Auto-layout frame',
      confidence: 'medium',
      matchedRule: '8-frame-layout',
    };
  }

  // 9. Frame with grid layout -> "Grid" (medium)
  if (
    node.kind === 'frame' &&
    node.layoutStyle != null &&
    (node.layoutStyle.gridTemplateColumns != null ||
      node.layoutStyle.gridAutoFlow != null ||
      node.layoutStyle.mode === 'grid')
  ) {
    return {
      name: 'Grid',
      confidence: 'medium',
      matchedRule: '9-frame-grid',
    };
  }

  // 10. Frame with flex layout -> "Layout" / "Auto-layout frame" (medium)
  if (node.kind === 'frame' && node.layoutStyle?.mode === 'flex') {
    return {
      name: 'Layout',
      confidence: 'medium',
      matchedRule: '10-frame-flex',
    };
  }

  // 11. Frame with >= 3 children -> "Section" (medium)
  if (node.kind === 'frame' && node.children.length >= 3) {
    return {
      name: 'Section',
      confidence: 'medium',
      matchedRule: '11-frame-section',
    };
  }

  // 12. Frame with single child -> "{child name} container" (medium)
  if (node.kind === 'frame' && node.children.length === 1) {
    const childId = node.children[0]!;
    const child = doc.nodes[childId];
    const childName = child?.name ?? 'Node';
    return {
      name: `${childName} container`,
      confidence: 'medium',
      matchedRule: '12-frame-container',
    };
  }

  // 13. Image shape -> classified content label if available, else "Image" (high)
  if (isImageShape(node)) {
    const label = imageLabels?.get(node.id);
    if (label) {
      return {
        name: label.charAt(0).toUpperCase() + label.slice(1),
        confidence: 'high',
        matchedRule: '13-image-classified',
      };
    }
    return {
      name: 'Image',
      confidence: 'high',
      matchedRule: '13-image',
    };
  }

  // 14. Rect icon or button placeholder (medium)
  if (node.kind === 'shape' && node.shape.kind === 'rect') {
    const rectType = getRectIconLabel(node);
    if (rectType === 'icon') {
      return {
        name: 'Icon placeholder',
        confidence: 'medium',
        matchedRule: '14-rect-icon',
      };
    }
    if (rectType === 'button') {
      return {
        name: 'Button',
        confidence: 'medium',
        matchedRule: '14-rect-button',
      };
    }
  }

  // 15. Shape with text sibling below -> "Caption" (low)
  if (node.kind === 'shape') {
    const parentId = getParent(doc, node.id);
    if (parentId) {
      const parent = doc.nodes[parentId];
      if (parent && 'children' in parent) {
        const siblings = (parent as { children: NodeId[] }).children;
        const nodeIdx = siblings.indexOf(node.id);
        if (nodeIdx >= 0) {
          for (let i = nodeIdx + 1; i < siblings.length; i++) {
            const sibling = doc.nodes[siblings[i]!];
            if (sibling?.kind === 'text') {
              return {
                name: 'Caption',
                confidence: 'low',
                matchedRule: '15-shape-caption',
              };
            }
          }
        }
      }
    }
  }

  // 16. Group with children -> "Group ({children.length})" (low)
  if (node.kind === 'group' && node.children.length > 0) {
    return {
      name: `Group (${node.children.length})`,
      confidence: 'low',
      matchedRule: '16-group',
    };
  }

  // 17. Default fallback -> kind + index (low)
  const kindName = getDefaultKindName(node);
  const idx = index ?? 0;
  return {
    name: `${kindName} ${idx}`,
    confidence: 'low',
    matchedRule: '17-default',
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function existingNames(doc: Document, excludeId?: NodeId): Set<string> {
  const names = new Set<string>();
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (excludeId && id === excludeId) continue;
    if (node) names.add(node.name);
  }
  return names;
}

function uniqueName(base: string, doc: Document, excludeId?: NodeId): string {
  const names = existingNames(doc, excludeId);
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

function nextUniqueDefaultName(doc: Document, kindName: string, excludeId?: NodeId): string {
  const names = existingNames(doc, excludeId);
  const used = new Set<number>();
  const re = new RegExp(`^${escapeRegExp(kindName)} (\\d+)$`);
  for (const name of names) {
    const match = name.match(re);
    if (match) used.add(Number(match[1]));
  }
  let i = 1;
  while (used.has(i)) i++;
  return `${kindName} ${i}`;
}

/**
 * Generate a unique, context-aware name for a node.
 *
 * Uses `suggestName` to pick a base, then appends a counter (2, 3, …)
 * if the name already exists in the document. For default fallback names
 * it finds the next available sequential number for the kind.
 */
export function autoName(
  doc: Document,
  node: SceneNode,
  index?: number,
  imageLabels?: Map<NodeId, string>,
): string {
  const suggestion = suggestName(node, doc, index, imageLabels);
  const base = suggestion.name;

  if (suggestion.matchedRule === '17-default') {
    const kindName = getDefaultKindName(node);
    return nextUniqueDefaultName(doc, kindName, node.id);
  }

  return uniqueName(base, doc, node.id);
}

export function renameSelected(
  doc: Document,
  nodeIds: NodeId[],
  onlyIfDefault?: boolean,
  imageLabels?: Map<NodeId, string>,
): Document {
  let newDoc: Document = doc;
  for (const id of nodeIds) {
    const node = newDoc.nodes[id];
    if (!node) continue;

    if (onlyIfDefault && !DEFAULT_NAME_RE.test(node.name)) continue;

    const name = autoName(newDoc, node, undefined, imageLabels);
    if (name !== node.name) {
      newDoc = {
        ...newDoc,
        nodes: {
          ...newDoc.nodes,
          [id]: { ...node, name } as SceneNode,
        },
      };
    }
  }
  return newDoc;
}
