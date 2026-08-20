/**
 * Layout-compilation tests.
 *
 * These run through `compileEmail` rather than calling the layout pass with
 * hand-built IR, because the defect this pass exists to fix — a side-by-side
 * design collapsing to a vertical stack — only shows up once the compiler has
 * turned real geometry into IR. The four tests that existed before this pass
 * all used hand-authored IR, which is exactly why they never caught it.
 */

import { describe, expect, it } from 'vitest';
import { compileEmail } from './email-compiler';
import { emitEmailHtml } from './email-html';
import type { EmailIrNode } from './email-ir-types';
import { parsePadding } from './email-layout';
import type { IRDocument, SemanticNode } from './ir-types';

function baseNode(id: string, overrides: Partial<SemanticNode> = {}): SemanticNode {
  return {
    id,
    kind: 'frame',
    name: id,
    role: { primary: 'container', inferred: true, confidence: 1 },
    accessibility: {},
    layout: {
      mode: 'absolute',
      direction: 'column',
      wrap: 'nowrap',
      gap: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      width: { mode: 'fixed', value: 280 },
      height: { mode: 'fixed', value: 200 },
      position: { type: 'absolute', left: 0, top: 0 },
      justifyContent: 'start',
      alignItems: 'start',
    },
    constraints: {},
    appearance: {
      background: [],
      foreground: [],
      strokes: [],
      border: {
        top: { width: 0, color: '#000', style: 'none' },
        right: { width: 0, color: '#000', style: 'none' },
        bottom: { width: 0, color: '#000', style: 'none' },
        left: { width: 0, color: '#000', style: 'none' },
        uniform: true,
      },
      typography: {
        fontFamily: 'Inter',
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 1.4,
        letterSpacing: 0,
      },
      effects: [],
      transform: {
        translate: { x: 0, y: 0 },
        rotate: 0,
        scale: { x: 1, y: 1 },
        origin: { x: 0, y: 0 },
      },
      opacity: 1,
      blendMode: 'normal',
      borderRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
      interactions: {},
    },
    tokens: {},
    content: { type: 'none' },
    children: [],
    metadata: { sourceNodeId: id, exportId: id, tags: [] },
    visible: true,
    locked: false,
    ...overrides,
  } as SemanticNode;
}

function boxAt(
  id: string,
  box: { x: number; y: number; width: number; height: number },
  overrides: Partial<SemanticNode> = {},
): SemanticNode {
  const base = baseNode(id, overrides);
  return {
    ...base,
    layout: {
      ...base.layout,
      width: { mode: 'fixed', value: box.width },
      height: { mode: 'fixed', value: box.height },
      position: { type: 'absolute', left: box.x, top: box.y },
    },
  } as SemanticNode;
}

function textAt(
  id: string,
  value: string,
  box: { x: number; y: number; width: number; height: number },
): SemanticNode {
  const base = boxAt(id, box);
  return {
    ...base,
    kind: 'text',
    role: { primary: 'text', inferred: true, confidence: 1 },
    content: { type: 'text', text: { value } },
    appearance: {
      ...base.appearance,
      background: [{ type: 'solid', value: '#111111', opacity: 1 }],
      foreground: [{ type: 'solid', value: '#111111', opacity: 1 }],
    },
  } as SemanticNode;
}

function compile(root: SemanticNode, profile: 'conservative' | 'modern' = 'modern') {
  const designIr = {
    version: '2.1.0',
    metadata: {},
    nodes: { [root.id]: root },
    rootIds: [root.id],
    tokens: {},
    breakpoints: [],
    components: {},
    unsupportedFeatures: [],
    fidelityWarnings: [],
    htmlHints: {},
  } as unknown as IRDocument;

  return compileEmail(
    {
      emailProfile: {
        version: 1,
        language: 'en',
        direction: 'ltr',
        contentWidth: 600,
        mobileBreakpoint: 480,
        compatibilityProfile: profile,
        provider: 'generic',
      },
    } as never,
    designIr,
    { profile, provider: 'generic' },
  );
}

function collectKinds(nodes: EmailIrNode[]): string[] {
  const kinds: string[] = [];
  const walk = (node: EmailIrNode): void => {
    kinds.push(node.kind);
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return kinds;
}

function findKind(nodes: EmailIrNode[], kind: string): EmailIrNode | undefined {
  for (const node of nodes) {
    if (node.kind === kind) return node;
    const nested = findKind(node.children, kind);
    if (nested) return nested;
  }
  return undefined;
}

describe('email layout inference', () => {
  it('turns side-by-side siblings into a row of columns without hand-tagging', () => {
    const root = boxAt(
      'root',
      { x: 0, y: 0, width: 600, height: 200 },
      {
        children: [
          textAt('left', 'Left column copy', { x: 0, y: 0, width: 280, height: 200 }),
          textAt('right', 'Right column copy', { x: 300, y: 0, width: 280, height: 200 }),
        ],
      },
    );

    const { ir } = compile(root);
    const kinds = collectKinds(ir.nodes);
    expect(kinds).toContain('row');
    expect(kinds.filter((kind) => kind === 'column')).toHaveLength(2);

    const html = emitEmailHtml(ir).html;
    // Two cells in one row is what makes it a two-column email on desktop.
    const row = html.slice(html.indexOf('<tr>'), html.lastIndexOf('</tr>'));
    expect((html.match(/<td[^>]*width="\d+"/g) ?? []).length).toBe(2);
    expect(row).toContain('Left column copy');
    expect(row).toContain('Right column copy');
  });

  it('splits width in proportion to the design and covers the full row', () => {
    const root = boxAt(
      'root',
      { x: 0, y: 0, width: 600, height: 200 },
      {
        children: [
          boxAt('narrow', { x: 0, y: 0, width: 200, height: 200 }),
          boxAt('wide', { x: 200, y: 0, width: 400, height: 200 }),
        ],
      },
    );

    const { ir } = compile(root);
    const row = findKind(ir.nodes, 'row');
    const widths = row?.children.map((column) => column.width ?? 0) ?? [];
    expect(widths).toEqual([200, 400]);
    // Cells that do not add up to the row leave a gap in Outlook.
    expect(widths.reduce((sum, width) => sum + (width ?? 0), 0)).toBe(600);
  });

  it('keeps stacked siblings stacked rather than inventing columns', () => {
    const root = boxAt(
      'root',
      { x: 0, y: 0, width: 600, height: 400 },
      {
        children: [
          textAt('top', 'Above', { x: 0, y: 0, width: 600, height: 180 }),
          textAt('bottom', 'Below', { x: 0, y: 200, width: 600, height: 180 }),
        ],
      },
    );

    const { ir } = compile(root);
    expect(collectKinds(ir.nodes)).not.toContain('row');
  });

  it('preserves left-to-right reading order in the DOM and the plain text', () => {
    const root = boxAt(
      'root',
      { x: 0, y: 0, width: 600, height: 200 },
      {
        children: [
          // Declared out of visual order on purpose.
          textAt('second', 'Rightmost', { x: 310, y: 0, width: 280, height: 200 }),
          textAt('first', 'Leftmost', { x: 0, y: 0, width: 280, height: 200 }),
        ],
      },
    );

    const { ir } = compile(root);
    const html = emitEmailHtml(ir).html;
    expect(html.indexOf('Leftmost')).toBeLessThan(html.indexOf('Rightmost'));
    expect(ir.plainText.indexOf('Leftmost')).toBeLessThan(ir.plainText.indexOf('Rightmost'));
  });

  it('columns stack on mobile so a phone never shows a 300px measure', () => {
    const root = boxAt(
      'root',
      { x: 0, y: 0, width: 600, height: 200 },
      {
        children: [
          textAt('left', 'Left', { x: 0, y: 0, width: 280, height: 200 }),
          textAt('right', 'Right', { x: 300, y: 0, width: 280, height: 200 }),
        ],
      },
    );

    const output = emitEmailHtml(compile(root).ir);
    expect(output.html).toContain('class="stack-column"');
    expect(output.css).toMatch(/\.stack-column[\s\S]*display:\s*block\s*!important/);
  });

  it('reports overlapping live text as an error rather than silently reordering it', () => {
    const root = boxAt(
      'root',
      { x: 0, y: 0, width: 600, height: 200 },
      {
        children: [
          textAt('headline', 'Headline', { x: 0, y: 0, width: 400, height: 120 }),
          textAt('caption', 'Caption', { x: 200, y: 40, width: 300, height: 120 }),
        ],
      },
    );

    const { diagnostics } = compile(root);
    const overlap = diagnostics.find((item) => item.code === 'OVERLAP_SEMANTIC_CONTENT');
    expect(overlap?.severity).toBe('error');
    expect(overlap?.sourceNodeId).toBe('headline');
  });

  it('does not pin a width or height on live text', () => {
    const root = boxAt(
      'root',
      { x: 0, y: 0, width: 600, height: 200 },
      { children: [textAt('copy', 'Body copy', { x: 0, y: 0, width: 280, height: 40 })] },
    );

    const html = emitEmailHtml(compile(root).ir).html;
    const paragraph = /<p[^>]*>/.exec(html)?.[0] ?? '';
    expect(paragraph).not.toMatch(/width:\s*\d/);
    expect(paragraph).not.toMatch(/height:\s*\d/);
  });

  it('an author-tagged row is honoured even when the geometry disagrees', () => {
    const root = boxAt(
      'root',
      { x: 0, y: 0, width: 600, height: 400 },
      {
        children: [
          textAt('a', 'One', { x: 0, y: 0, width: 600, height: 180 }),
          textAt('b', 'Two', { x: 0, y: 200, width: 600, height: 180 }),
        ],
      },
    );

    const designIr = {
      version: '2.1.0',
      metadata: {},
      nodes: { root },
      rootIds: ['root'],
      tokens: {},
      breakpoints: [],
      components: {},
      unsupportedFeatures: [],
      fidelityWarnings: [],
      htmlHints: {},
    } as unknown as IRDocument;

    const result = compileEmail(
      {
        emailProfile: {
          version: 1,
          language: 'en',
          direction: 'ltr',
          contentWidth: 600,
          mobileBreakpoint: 480,
          compatibilityProfile: 'modern',
          provider: 'generic',
        },
        emailSemantics: {
          nodes: { root: { kind: 'row', inferred: false } },
          nodeLinks: {},
          textRangeLinks: {},
          variables: [],
          customHtmlBlocks: {},
          assets: {},
          diagnostics: [],
        },
      } as never,
      designIr,
      { profile: 'modern', provider: 'generic' },
    );

    const kinds = collectKinds(result.ir.nodes);
    expect(kinds).toContain('row');
    expect(kinds.filter((kind) => kind === 'column')).toHaveLength(2);
  });
});

describe('compatibility reporting', () => {
  it('explains a dropped declaration and names the profile', () => {
    const root = boxAt(
      'root',
      { x: 0, y: 0, width: 600, height: 200 },
      {
        children: [
          boxAt(
            'art',
            { x: 0, y: 0, width: 600, height: 200 },
            {
              appearance: {
                ...baseNode('art').appearance,
                transform: {
                  translate: { x: 0, y: 0 },
                  rotate: 12,
                  scale: { x: 1, y: 1 },
                  origin: { x: 0, y: 0 },
                },
              },
            },
          ),
        ],
      },
    );

    const { diagnostics } = compile(root);
    const dropped = diagnostics.find((item) => item.code === 'UNSUPPORTED_CSS_DROPPED');
    expect(dropped?.message).toContain('transform');
    expect(dropped?.sourceNodeId).toBe('art');
    expect(dropped?.profile).toBe('modern');
  });

  it('drops the design face in the conservative profile but keeps it otherwise', () => {
    const root = boxAt(
      'root',
      { x: 0, y: 0, width: 600, height: 200 },
      { children: [textAt('copy', 'Body', { x: 0, y: 0, width: 600, height: 40 })] },
    );

    expect(emitEmailHtml(compile(root, 'modern').ir).html).toContain('Inter');
    // No recipient is guaranteed to have Inter; the conservative profile would
    // rather design for the fallback than ship a metric shift.
    expect(emitEmailHtml(compile(root, 'conservative').ir).html).not.toContain('Inter');
  });
});

describe('parsePadding', () => {
  it('reads every CSS shorthand arity', () => {
    expect(parsePadding('4px')).toEqual({ top: 4, right: 4, bottom: 4, left: 4 });
    expect(parsePadding('4px 8px')).toEqual({ top: 4, right: 8, bottom: 4, left: 8 });
    expect(parsePadding('4px 8px 12px')).toEqual({ top: 4, right: 8, bottom: 12, left: 8 });
    expect(parsePadding('4px 8px 12px 16px')).toEqual({ top: 4, right: 8, bottom: 12, left: 16 });
    expect(parsePadding(undefined)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
