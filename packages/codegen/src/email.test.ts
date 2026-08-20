import { addChild, addNode, createDocument, makeFrameNode, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { compileEmail } from './email-compiler';
import { emitEmailHtml } from './email-html';
import type { EmailDocumentIr, EmailIrNode } from './email-ir-types';
import { emitEmailPlainText } from './email-plain-text';
import { runEmailPreflight } from './email-preflight';
import { sanitizeEmailHtml, validateEmailUrl } from './email-security';
import { sceneToIR } from './ir-converter';
import type { IRDocument, SemanticNode } from './ir-types';

function fixture(overrides: Partial<EmailDocumentIr> = {}): EmailDocumentIr {
  return {
    version: '1.0',
    settings: {
      language: 'en',
      direction: 'ltr',
      contentWidth: 600,
      mobileBreakpoint: 480,
      compatibilityProfile: 'modern',
      provider: 'generic',
    },
    nodes: [],
    plainText: '',
    assets: [],
    warnings: [],
    diagnostics: [],
    ...overrides,
  };
}

function compilerNode(overrides: Partial<SemanticNode> = {}): SemanticNode {
  return {
    id: 'export-text',
    kind: 'text',
    name: 'Copy',
    role: { primary: 'text', inferred: true, confidence: 1 },
    accessibility: {},
    layout: {
      mode: 'absolute',
      direction: 'column',
      wrap: 'nowrap',
      gap: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      width: { mode: 'fixed', value: 300 },
      height: { mode: 'fixed', value: 40 },
      position: { type: 'absolute', left: 0, top: 0 },
      justifyContent: 'start',
      alignItems: 'start',
    },
    constraints: {},
    appearance: {
      background: [{ type: 'solid', value: '#111111', opacity: 1 }],
      foreground: [{ type: 'solid', value: '#111111', opacity: 1 }],
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
    content: { type: 'text', text: { value: 'Read our policy' } },
    children: [],
    metadata: { sourceNodeId: 'text-1', exportId: 'export_text', tags: [] },
    visible: true,
    locked: false,
    ...overrides,
  } as SemanticNode;
}

describe('email security', () => {
  it('rejects executable and local URL schemes', () => {
    expect(validateEmailUrl({ kind: 'web', url: 'javascript:alert(1)' }).valid).toBe(false);
    expect(validateEmailUrl({ kind: 'web', url: 'file:///tmp/a.png' }).valid).toBe(false);
    expect(validateEmailUrl({ kind: 'web', url: 'https://example.com/path' }).valid).toBe(true);
  });

  it('sanitizes tags, event handlers, and unsafe styles', () => {
    const result = sanitizeEmailHtml(
      '<script>alert(1)</script><p onclick="alert(1)" style="color:red;position:absolute">Hi</p><iframe src="x"></iframe>',
    );
    expect(result.html).toContain('<p');
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('onclick');
    expect(result.html).not.toContain('<iframe');
    expect(result.removed.length).toBeGreaterThan(0);
  });
});

describe('email output', () => {
  it('compiles a plain text node with its range links into Email IR', () => {
    const node = compilerNode();
    const designIr = {
      version: '2.1.0',
      metadata: {},
      nodes: { [node.id]: node },
      rootIds: [node.id],
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
          nodes: {},
          nodeLinks: {},
          textRangeLinks: {
            'text-1:9:15': {
              nodeId: 'text-1',
              startIndex: 9,
              endIndex: 15,
              link: { kind: 'web', url: 'https://example.com/policy' },
            },
          },
          variables: [],
          customHtmlBlocks: {},
          assets: {},
          diagnostics: [],
        },
      } as never,
      designIr,
      { profile: 'modern', provider: 'generic' },
    );
    const compiled = result.ir.nodes[0] as EmailIrNode;
    expect(compiled.content?.runs?.map((run) => run.text)).toEqual(['Read our ', 'policy']);
    expect(compiled.content?.runs?.[1]?.link?.url).toBe('https://example.com/policy');
  });

  it('compiles a real Varve flex row into a linked, responsive email row', () => {
    let doc = createDocument('integration-email', true);
    const row = makeFrameNode('row-1', {
      name: 'Content row',
      w: 600,
      h: 80,
      layoutStyle: {
        mode: 'flex',
        direction: 'row',
        gap: 16,
        wrap: false,
        padding: [0, 0, 0, 0],
        grow: 0,
        shrink: 1,
      },
    });
    const left = makeTextNode('left-1', 'Left copy', {
      w: 280,
      h: 40,
      transform: [1, 0, 0, 1, 0, 0],
    });
    const right = makeTextNode('right-1', 'Read our policy', {
      w: 280,
      h: 40,
      transform: [1, 0, 0, 1, 296, 0],
    });
    doc = addNode(doc, row);
    doc = addChild(doc, row.id, left);
    doc = addChild(doc, row.id, right);
    doc = {
      ...doc,
      emailProfile: {
        version: 1,
        language: 'en',
        direction: 'ltr',
        contentWidth: 600,
        mobileBreakpoint: 480,
        compatibilityProfile: 'conservative',
        provider: 'generic',
      },
      emailSemantics: {
        nodes: {},
        nodeLinks: {},
        textRangeLinks: {
          'right-1:9:15': {
            nodeId: 'right-1',
            startIndex: 9,
            endIndex: 15,
            link: { kind: 'web', url: 'https://example.com/policy' },
          },
        },
        variables: [],
        customHtmlBlocks: {},
        assets: {},
        diagnostics: [],
      },
    };
    const result = compileEmail(doc, sceneToIR(doc), {
      profile: 'conservative',
      provider: 'generic',
    });
    const output = emitEmailHtml(result.ir);
    expect(output.html).toMatch(/Read our\s+<a[^>]*>policy<\/a>/);
    expect(output.html).toContain('href="https://example.com/policy"');
    expect(output.html).toContain('class="stack-column"');
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'MISSING_IMAGE_ALT')).toBe(
      false,
    );
  });

  it('emits safe linked content and plain text', () => {
    const ir = fixture({
      nodes: [
        {
          id: 'email-text',
          sourceNodeId: 'text-1',
          kind: 'paragraph',
          name: 'Body',
          children: [],
          styles: { color: '#111111' },
          content: { type: 'text', text: 'Read this' },
          link: { kind: 'web', url: 'https://example.com', title: 'Read more' },
          compatibility: 'native',
        },
      ],
    });
    const output = emitEmailHtml(ir);
    expect(output.html).toContain('href="https://example.com/"');
    expect(output.html).not.toContain('<script');
    expect(emitEmailPlainText({ ...ir, plainText: '' })).toContain(
      'Read this (https://example.com)',
    );
  });

  it('preflights missing alt text and invalid links', () => {
    const ir = fixture({
      nodes: [
        {
          id: 'email-image',
          sourceNodeId: 'image-1',
          kind: 'image',
          name: 'Hero',
          children: [],
          styles: {},
          image: { src: 'file:///tmp/hero.png', alt: '', decorative: false },
          compatibility: 'native',
          link: { kind: 'web', url: 'javascript:bad' },
        },
      ],
    });
    const diagnostics = runEmailPreflight(ir);
    expect(diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['MISSING_IMAGE_ALT', 'INVALID_LINK', 'LOCAL_IMAGE_URL']),
    );
  });

  it('keeps live text visible and preserves text-range links without rich-text runs', () => {
    const ir = fixture({
      nodes: [
        {
          id: 'email-copy',
          sourceNodeId: 'copy-1',
          kind: 'paragraph',
          name: 'Copy',
          children: [],
          styles: { color: '#111111' },
          content: {
            type: 'text',
            text: 'Read our policy',
            runs: [
              {
                text: 'Read our policy',
                styles: {},
                link: { kind: 'web', url: 'https://example.com/policy' },
              },
            ],
          },
          compatibility: 'native',
        },
      ],
    });
    const output = emitEmailHtml(ir).html;
    expect(output).toContain('Read our policy');
    expect(output).toContain('href="https://example.com/policy"');
    expect(output).not.toContain('<p style="color: #111111; background-color');
  });

  it('emits rows as desktop columns that stack on mobile', () => {
    const ir = fixture({
      nodes: [
        {
          id: 'row',
          sourceNodeId: 'row-1',
          kind: 'row',
          name: 'Two columns',
          children: [
            {
              id: 'column-a',
              sourceNodeId: 'column-a',
              kind: 'column',
              name: 'Image column',
              children: [],
              styles: { width: '280px' },
              width: 280,
              content: { type: 'none' },
              compatibility: 'converted',
              mobileBehavior: 'stack',
            },
            {
              id: 'column-b',
              sourceNodeId: 'column-b',
              kind: 'column',
              name: 'Copy column',
              children: [],
              styles: { width: '280px' },
              width: 280,
              content: { type: 'none' },
              compatibility: 'converted',
              mobileBehavior: 'stack',
            },
          ],
          styles: {},
          compatibility: 'converted',
        },
      ],
    });
    const output = emitEmailHtml(ir).html;
    expect(output).toContain('<tr>');
    expect(output).toContain('<td class="stack-column"');
    expect(output).toContain('display: block !important;');
    expect(output).not.toMatch(/<table[^>]*>\s*<tr>\s*<td[^>]*>\s*<table/);
  });

  it('retains linked containers but refuses nested anchor scopes', () => {
    const linked = fixture({
      nodes: [
        {
          id: 'container',
          sourceNodeId: 'container-1',
          kind: 'container',
          name: 'Card',
          children: [
            {
              id: 'card-copy',
              sourceNodeId: 'copy-1',
              kind: 'paragraph',
              name: 'Card copy',
              children: [],
              styles: {},
              content: { type: 'text', text: 'Open card' },
              link: { kind: 'web', url: 'https://example.com/card' },
              compatibility: 'native',
            },
          ],
          styles: {},
          link: { kind: 'web', url: 'https://example.com/container' },
          compatibility: 'native',
        },
      ],
    });
    const output = emitEmailHtml(linked);
    expect(output.html).toContain('href="https://example.com/card"');
    expect(output.html).not.toContain('href="https://example.com/container"');
    expect(output.warnings.some((warning) => warning.code === 'NESTED_LINK')).toBe(true);
    expect(runEmailPreflight(linked).some((diagnostic) => diagnostic.code === 'NESTED_LINK')).toBe(
      true,
    );
  });

  it('does not leak local image paths into emitted HTML', () => {
    const output = emitEmailHtml(
      fixture({
        nodes: [
          {
            id: 'local-image',
            sourceNodeId: 'image-1',
            kind: 'image',
            name: 'Local image',
            children: [],
            styles: {},
            image: { src: 'file:///home/user/hero.png', alt: 'Hero' },
            compatibility: 'native',
          },
        ],
      }),
    );
    expect(output.html).not.toContain('/home/user/hero.png');
    expect(output.warnings.some((warning) => warning.code === 'LOCAL_IMAGE_URL')).toBe(true);
  });
});
