import type { Document, NodeId, SceneNode } from '@strata/scene';
import { getParent, shapeHeight, shapeWidth } from '@strata/scene';

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
    if (trimmed === word || trimmed.startsWith(word + ' ')) return true;
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
  return text.slice(0, maxLen - 1) + '\u2026';
}

function getNodeWidth(node: SceneNode): number | null {
  switch (node.kind) {
    case 'shape':
      return shapeWidth(node.shape);
    case 'frame':
      return node.w;
    case 'image':
      return node.w;
    default:
      return null;
  }
}

function getNodeHeight(node: SceneNode): number | null {
  switch (node.kind) {
    case 'shape':
      return shapeHeight(node.shape);
    case 'frame':
      return node.h;
    case 'image':
      return node.h;
    default:
      return null;
  }
}

function isIconLike(node: SceneNode): boolean {
  const w = getNodeWidth(node);
  const h = getNodeHeight(node);
  if (w === null || h === null) return false;
  if (w > 32 || h > 32) return false;
  if (w === 0 || h === 0) return false;
  const ratio = w / h;
  return ratio >= 0.8 && ratio <= 1.2;
}

function isButtonLike(node: SceneNode): boolean {
  const w = getNodeWidth(node);
  const h = getNodeHeight(node);
  if (w === null || h === null) return false;
  if (w < 32 || w > 200) return false;
  if (h < 28 || h > 60) return false;
  return true;
}

const KIND_NAMES: Record<string, string> = {
  shape: 'Shape',
  text: 'Text',
  frame: 'Frame',
  group: 'Group',
  image: 'Image',
  adjustment: 'Adjustment',
};

export function suggestName(node: SceneNode, doc: Document, index?: number): NamingSuggestion {
  // Rule 1: Component instance -> "ComponentName instance" (high)
  if (node.kind === 'frame' && node.componentId) {
    const comp = doc.components[node.componentId];
    const compName = comp?.name ?? 'Component';
    return {
      name: `${compName} instance`,
      confidence: 'high',
      matchedRule: '1-component-instance',
    };
  }

  // Rule 2: Text with button-like content -> "Button: {text}" (high)
  if (node.kind === 'text' && isButtonLikeText(node.text)) {
    return {
      name: `Button: ${truncateText(node.text.trim(), 25)}`,
      confidence: 'high',
      matchedRule: '2-text-button',
    };
  }

  // Rule 3: Text with link-like content -> "Link: {text}" (high)
  if (node.kind === 'text' && isLinkLikeText(node.text)) {
    return {
      name: `Link: ${truncateText(node.text.trim(), 25)}`,
      confidence: 'high',
      matchedRule: '3-text-link',
    };
  }

  // Rule 4: Text with heading-like properties -> "Heading: {truncated text}" (high)
  if (node.kind === 'text' && (node.fontSize >= 24 || (node.fontWeight ?? 400) >= 700)) {
    const text = node.text.trim() || 'Untitled';
    return {
      name: `Heading: ${truncateText(text, 25)}`,
      confidence: 'high',
      matchedRule: '4-text-heading',
    };
  }

  // Rule 5: Image node -> "Image" (high)
  if (node.kind === 'image') {
    return {
      name: 'Image',
      confidence: 'high',
      matchedRule: '5-image',
    };
  }

  // Rule 6: Rect with icon-like dimensions -> "Icon" (medium)
  if (node.kind === 'shape' && node.shape.kind === 'rect' && isIconLike(node)) {
    return {
      name: 'Icon',
      confidence: 'medium',
      matchedRule: '6-icon-dimensions',
    };
  }

  // Rule 7: Rounded rect with button-like dimensions -> "Button" (medium)
  if (
    node.kind === 'shape' &&
    node.shape.kind === 'rect' &&
    node.cornerRadius != null &&
    isButtonLike(node)
  ) {
    return {
      name: 'Button',
      confidence: 'medium',
      matchedRule: '7-button-dimensions',
    };
  }

  // Rule 8: Frame with single child -> "{child name} container" (medium)
  if (node.kind === 'frame' && node.children.length === 1) {
    const childId = node.children[0]!;
    const child = doc.nodes[childId];
    const childName = child?.name ?? 'Node';
    return {
      name: `${childName} container`,
      confidence: 'medium',
      matchedRule: '8-frame-single-child',
    };
  }

  // Rule 9: Frame with >4 children -> "Section" (medium)
  if (node.kind === 'frame' && node.children.length > 4) {
    return {
      name: 'Section',
      confidence: 'medium',
      matchedRule: '9-frame-many-children',
    };
  }

  // Rule 10: Group with 2 children -> "Group" (low)
  if (node.kind === 'group' && node.children.length === 2) {
    return {
      name: 'Group',
      confidence: 'low',
      matchedRule: '10-group-two-children',
    };
  }

  // Rule 11: Frame with layout grid -> "Grid" (medium)
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
      matchedRule: '11-frame-grid',
    };
  }

  // Rule 12: Frame with flex layout -> "Layout" (low)
  if (node.kind === 'frame' && node.layoutStyle?.mode === 'flex') {
    return {
      name: 'Layout',
      confidence: 'low',
      matchedRule: '12-frame-flex',
    };
  }

  // Rule 13: Shape with text below -> "Caption" (low)
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
                matchedRule: '13-shape-text-below',
              };
            }
          }
        }
      }
    }
  }

  // Rule 14: Default fallback -> node kind + index (low)
  const kindName = KIND_NAMES[node.kind] ?? 'Node';
  const idx = index ?? 0;
  return {
    name: `${kindName} ${idx}`,
    confidence: 'low',
    matchedRule: '14-default',
  };
}

export function renameSelected(
  doc: Document,
  nodeIds: NodeId[],
  onlyIfDefault?: boolean,
): Document {
  let newDoc: Document = doc;
  for (const id of nodeIds) {
    const node = newDoc.nodes[id];
    if (!node) continue;

    if (onlyIfDefault && !DEFAULT_NAME_RE.test(node.name)) continue;

    const suggestion = suggestName(node, newDoc);
    if (suggestion && suggestion.name !== node.name) {
      newDoc = {
        ...newDoc,
        nodes: {
          ...newDoc.nodes,
          [id]: { ...node, name: suggestion.name } as SceneNode,
        },
      };
    }
  }
  return newDoc;
}
