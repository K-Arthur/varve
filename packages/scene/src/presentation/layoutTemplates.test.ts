import { describe, expect, it } from 'vitest';
import { applyOperation, createDocument, type Document, registerBuiltinOperations } from '../index';
import { PRESENTATION_BUILT_IN_LAYOUTS, PRESENTATION_LAYOUT_CANVAS_NAME } from './layoutTemplates';

registerBuiltinOperations();

describe('built-in presentation layout sources', () => {
  it('creates every native template as editable artwork on a dedicated canvas', () => {
    let document: Document = applyOperation(
      createDocument('Layout library', true),
      'presentation.deck.create',
      {
        id: 'deck',
        name: 'Pitch',
        width: 1920,
        height: 1080,
      },
    );

    for (const [index, template] of PRESENTATION_BUILT_IN_LAYOUTS.entries()) {
      document = applyOperation(document, 'presentation.layout.builtin.create', {
        deckId: 'deck',
        sourceId: `layout-${index}`,
        templateId: template.id,
      });
    }

    const layoutCanvas = document.designCanvases?.find(
      (canvas) => canvas.name === PRESENTATION_LAYOUT_CANVAS_NAME,
    );
    expect(layoutCanvas).toBeDefined();
    const contentRoot = document.nodes[layoutCanvas!.contentRoot];
    expect(contentRoot?.kind).toBe('group');
    if (contentRoot?.kind !== 'group') return;
    expect(contentRoot.children).toHaveLength(PRESENTATION_BUILT_IN_LAYOUTS.length);

    for (const [index, template] of PRESENTATION_BUILT_IN_LAYOUTS.entries()) {
      const source = document.presentation?.layouts.find(
        (layout) => layout.id === `layout-${index}`,
      );
      const frame = source && document.nodes[source.frameId];
      expect(source?.name).toBe(template.name);
      expect(frame?.kind).toBe('frame');
      if (frame?.kind !== 'frame') continue;
      expect(frame.w).toBe(1920);
      expect(frame.h).toBe(1080);
      expect(Object.keys(source?.roleNodes ?? {})).not.toContain('');
      expect(Object.keys(source?.roleNodes ?? {}).length).toBeGreaterThan(1);
      expect(frame.children.every((id) => Boolean(document.nodes[id]))).toBe(true);
    }
  });
});
