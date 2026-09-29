import { DEFAULT_ARTWORK_FONT_FAMILY } from '@varve/shared';
import { createDesignCanvas, getDesignCanvas } from '../designCanvas';
import type { Document } from '../document';
import { addChild, makeFrameNode, makeShapeNode, makeTextNode } from '../document';
import { nextNodeId } from '../node-id';
import type { NodeId } from '../types';
import { registerPresentationLayout } from './layouts';
import { findPresentationDeck } from './model';

export const PRESENTATION_LAYOUT_CANVAS_NAME = 'Presentation Layouts';

export interface PresentationBuiltInLayout {
  id: string;
  name: string;
  description: string;
}

export const PRESENTATION_BUILT_IN_LAYOUTS = [
  { id: 'title-section', name: 'Title / section', description: 'Opening and section divider' },
  { id: 'body', name: 'Body', description: 'Headline with a single reading column' },
  { id: 'image-text', name: 'Image and text', description: 'Large visual beside supporting copy' },
  { id: 'comparison', name: 'Comparison', description: 'Two balanced columns with a divider' },
  { id: 'evidence', name: 'Evidence', description: 'Claim, visual evidence, and source caption' },
  { id: 'process', name: 'Process', description: 'Three ordered steps' },
  { id: 'conclusion', name: 'Conclusion', description: 'Closing headline and takeaway' },
] as const satisfies readonly PresentationBuiltInLayout[];

export type PresentationBuiltInLayoutId = (typeof PRESENTATION_BUILT_IN_LAYOUTS)[number]['id'];

type LayoutItem =
  | {
      kind: 'text';
      role: string;
      placeholder: string;
      x: number;
      y: number;
      w: number;
      h: number;
      fontSize: number;
      weight?: number;
    }
  | {
      kind: 'shape';
      role: string;
      x: number;
      y: number;
      w: number;
      h: number;
      color: [number, number, number];
      radius?: number;
    };

const text = (
  role: string,
  placeholder: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number,
  weight = 400,
): LayoutItem => ({ kind: 'text', role, placeholder, x, y, w, h, fontSize, weight });

const rect = (
  role: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number] = [237, 241, 244],
  radius = 8,
): LayoutItem => ({ kind: 'shape', role, x, y, w, h, color, radius });

function templateItems(templateId: PresentationBuiltInLayoutId): LayoutItem[] {
  switch (templateId) {
    case 'title-section':
      return [
        rect('accent', 0.08, 0.17, 0.012, 0.48, [36, 157, 148], 2),
        text('title', '[Title]', 0.12, 0.16, 0.78, 0.25, 58, 700),
        text('subtitle', '[Subtitle]', 0.12, 0.46, 0.72, 0.12, 30),
      ];
    case 'body':
      return [
        text('title', '[Title]', 0.08, 0.08, 0.84, 0.14, 42, 700),
        text('body', '[Body copy]', 0.08, 0.27, 0.82, 0.61, 28),
      ];
    case 'image-text':
      return [
        text('title', '[Title]', 0.07, 0.06, 0.86, 0.13, 40, 700),
        rect('image', 0.07, 0.24, 0.43, 0.65),
        text('body', '[Supporting text]', 0.56, 0.25, 0.37, 0.62, 25),
      ];
    case 'comparison':
      return [
        text('title', '[Title]', 0.07, 0.06, 0.86, 0.13, 40, 700),
        text('left-heading', '[Option A]', 0.07, 0.25, 0.38, 0.1, 30, 700),
        text('left-body', '[Evidence or details]', 0.07, 0.39, 0.38, 0.48, 23),
        rect('divider', 0.495, 0.24, 0.01, 0.64, [218, 224, 228], 1),
        text('right-heading', '[Option B]', 0.55, 0.25, 0.38, 0.1, 30, 700),
        text('right-body', '[Evidence or details]', 0.55, 0.39, 0.38, 0.48, 23),
      ];
    case 'evidence':
      return [
        text('title', '[Title]', 0.07, 0.06, 0.86, 0.13, 40, 700),
        text('claim', '[Key claim]', 0.07, 0.27, 0.34, 0.44, 31, 700),
        rect('evidence', 0.48, 0.24, 0.45, 0.54),
        text('source-caption', '[Source / caption]', 0.48, 0.81, 0.45, 0.08, 17),
      ];
    case 'process':
      return [
        text('title', '[Title]', 0.07, 0.06, 0.86, 0.13, 40, 700),
        text('step-1-title', '01 · [Step]', 0.07, 0.28, 0.25, 0.12, 26, 700),
        text('step-1-detail', '[Detail]', 0.07, 0.43, 0.25, 0.35, 21),
        rect('step-1-marker', 0.07, 0.22, 0.06, 0.012, [36, 157, 148], 2),
        text('step-2-title', '02 · [Step]', 0.375, 0.28, 0.25, 0.12, 26, 700),
        text('step-2-detail', '[Detail]', 0.375, 0.43, 0.25, 0.35, 21),
        rect('step-2-marker', 0.375, 0.22, 0.06, 0.012, [36, 157, 148], 2),
        text('step-3-title', '03 · [Step]', 0.68, 0.28, 0.25, 0.12, 26, 700),
        text('step-3-detail', '[Detail]', 0.68, 0.43, 0.25, 0.35, 21),
        rect('step-3-marker', 0.68, 0.22, 0.06, 0.012, [36, 157, 148], 2),
      ];
    case 'conclusion':
      return [
        text('eyebrow', '[Conclusion]', 0.08, 0.17, 0.75, 0.08, 19, 700),
        text('title', '[Takeaway headline]', 0.08, 0.29, 0.82, 0.22, 50, 700),
        text('body', '[Next step or closing note]', 0.08, 0.58, 0.68, 0.13, 26),
        rect('accent', 0.08, 0.78, 0.12, 0.012, [36, 157, 148], 2),
      ];
  }
}

function nextId(document: Document): { document: Document; id: NodeId } {
  const next = nextNodeId(document);
  return { document: next.doc, id: next.id };
}

/**
 * Add one original, editable geometry source to the local Presentation Layouts
 * Design Canvas and register its role map. Templates use only native text and
 * vector nodes plus the application's bundled default font; visual slots are
 * neutral editable rectangles, so creation works offline without stock media.
 */
export function createBuiltInPresentationLayout(
  document: Document,
  deckId: string,
  sourceId: string,
  templateId: PresentationBuiltInLayoutId,
): Document {
  const deck = findPresentationDeck(document, deckId);
  const template = PRESENTATION_BUILT_IN_LAYOUTS.find(({ id }) => id === templateId);
  if (!deck || !template) throw new Error('Choose an available presentation and layout template.');
  if (document.presentation?.layouts.some((layout) => layout.id === sourceId)) {
    throw new Error(`presentation layout id already exists: ${sourceId}`);
  }

  let result = document;
  let canvas = result.designCanvases?.find(
    (candidate) => candidate.name === PRESENTATION_LAYOUT_CANVAS_NAME,
  );
  if (!canvas) {
    result = createDesignCanvas(result, {
      name: PRESENTATION_LAYOUT_CANVAS_NAME,
      activate: false,
    });
    canvas = result.designCanvases?.find(
      (candidate) => candidate.name === PRESENTATION_LAYOUT_CANVAS_NAME,
    );
  }
  if (!canvas || getDesignCanvas(result, canvas.id)?.contentRoot !== canvas.contentRoot) {
    throw new Error('Could not create the Presentation Layouts Design Canvas.');
  }

  const sourceIndex = result.presentation?.layouts.length ?? 0;
  const columns = 2;
  const x = (sourceIndex % columns) * (deck.width + 120);
  const y = Math.floor(sourceIndex / columns) * (deck.height + 120);
  let created = nextId(result);
  result = created.document;
  const frameId = created.id;
  const frame = makeFrameNode(frameId, {
    name: `Layout · ${template.name}`,
    w: deck.width,
    h: deck.height,
    transform: [1, 0, 0, 1, x, y],
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
  });
  result = addChild(result, canvas.contentRoot, frame);

  const roleNodes: Record<string, NodeId> = {};
  const scale = deck.width / 1920;
  for (const item of templateItems(templateId)) {
    created = nextId(result);
    result = created.document;
    const id = created.id;
    const transform = [1, 0, 0, 1, item.x * deck.width, item.y * deck.height] as const;
    const node =
      item.kind === 'text'
        ? makeTextNode(id, item.placeholder, {
            name: item.role,
            transform,
            w: item.w * deck.width,
            h: item.h * deck.height,
            fontFamily: DEFAULT_ARTWORK_FONT_FAMILY,
            fontSize: Math.max(16, Math.round(item.fontSize * scale)),
            fontWeight: item.weight ?? 400,
            fill: { space: 'rgb', r: 27, g: 35, b: 43, a: 255 },
          })
        : makeShapeNode(
            id,
            { kind: 'rect', x: 0, y: 0, w: item.w * deck.width, h: item.h * deck.height },
            {
              name: item.role,
              transform,
              fill: { space: 'rgb', r: item.color[0], g: item.color[1], b: item.color[2], a: 255 },
              cornerRadius: item.radius === undefined ? undefined : item.radius * scale,
            },
          );
    result = addChild(result, frameId, node);
    roleNodes[item.role] = id;
  }

  return registerPresentationLayout(result, {
    id: sourceId,
    name: template.name,
    frameId,
    revision: 1,
    roleNodes,
  });
}
