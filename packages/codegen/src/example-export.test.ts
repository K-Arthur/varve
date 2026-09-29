/**
 * Generated-example gate — a representative design exported through the same
 * entry points the Code panel and export dialog call.
 *
 * This test both asserts the bundle contract and (when
 * `VARVE_CODEGEN_EXAMPLE_OUT` is set) writes the exact bytes to disk so an
 * external consumer project can install, typecheck, build, and run them. The
 * default CI path writes nothing.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  addChild,
  addNode,
  createDocument,
  type Document,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
  type SceneNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToCssModulesBundle, exportNodeToSvg, exportNodeToTailwindBundle } from './index';

interface ExpectedBox {
  left: number;
  top: number;
  width?: number;
  height?: number;
}

interface ExpectedEntry {
  className: string;
  box: ExpectedBox;
  text?: string;
  color?: string;
  background?: string;
  parent?: string;
}

interface ExpectedManifest {
  page: { width: number; height: number };
  elements: Record<string, ExpectedEntry>;
  /**
   * Authored auto-layout containers. Their children are flow items, so
   * asserting a fixed box would be asserting the wrong contract: the assertions
   * are about how the children relate to the container.
   */
  flex?: Array<{
    containerId: string;
    className: string;
    width: number;
    height: number;
    gap: number;
    padding: [number, number, number, number];
    direction: 'row' | 'column';
    /** Class names of the fill children, in order. */
    fillChildren: string[];
    /** A child that stays absolutely positioned inside the flow container. */
    absoluteChild?: string;
  }>;
}

export const rgb = (r: number, g: number, b: number, a = 255) => ({
  space: 'rgb' as const,
  r,
  g,
  b,
  a,
});

/** Text chosen to exercise literal markup characters, RTL, CJK, and combining marks. */
const TRICKY_TEXT = 'Ampersand & angle <tag> brace {x} quote " backtick ` end';
const MIXED_SCRIPT_TEXT = `مرحبا ${String.fromCodePoint(0x4f60, 0x597d)} cafe${String.fromCodePoint(0x301)}`;
const EMOJI_TEXT = `Party ${String.fromCodePoint(0x1f389)} done`;

/** Build the representative design and its independent expectation manifest. */
export function buildExampleDesign(): { doc: Document; expected: ExpectedManifest } {
  let doc = createDocument('Product Page');
  const nodes: SceneNode[] = [];

  const page = makeFrameNode('page', {
    name: 'Product Page',
    w: 1200,
    h: 760,
    fill: rgb(255, 255, 255),
  });

  const nav = makeFrameNode('nav', {
    name: 'Nav',
    w: 1200,
    h: 64,
    transform: [1, 0, 0, 1, 0, 0],
    fill: rgb(16, 21, 31),
  });
  const brand = makeTextNode('brand', 'Varve', {
    name: 'Brand',
    fontSize: 20,
    fontWeight: 600,
    transform: [1, 0, 0, 1, 24, 22],
    fill: rgb(255, 255, 255),
  });
  const pricing = makeTextNode('pricing', 'Pricing', {
    name: 'Pricing Link',
    fontSize: 14,
    transform: [1, 0, 0, 1, 980, 26],
    fill: rgb(200, 200, 200),
  });
  const navCta = makeShapeNode(
    'nav-cta',
    { kind: 'rect', x: 0, y: 0, w: 96, h: 36 },
    {
      name: 'Nav CTA',
      transform: [1, 0, 0, 1, 1080, 14],
      fill: rgb(57, 208, 198),
    },
  );

  const hero = makeFrameNode('hero', {
    name: 'Hero',
    w: 1200,
    h: 300,
    transform: [1, 0, 0, 1, 0, 64],
    fill: rgb(244, 246, 248),
  });
  const headline = makeTextNode('headline', 'Design to code, deterministically', {
    name: 'Headline',
    fontSize: 40,
    fontWeight: 700,
    transform: [1, 0, 0, 1, 64, 72],
    fill: rgb(16, 21, 31),
  });
  const body = makeTextNode('body', TRICKY_TEXT, {
    name: 'Body Copy',
    fontSize: 16,
    transform: [1, 0, 0, 1, 64, 140],
    fill: rgb(74, 85, 104),
  });
  const cta = makeShapeNode(
    'cta',
    { kind: 'rect', x: 0, y: 0, w: 200, h: 48 },
    {
      name: 'Primary CTA',
      transform: [1, 0, 0, 1, 64, 214],
      fill: rgb(57, 208, 198),
    },
  );
  const mixed = makeTextNode('mixed', MIXED_SCRIPT_TEXT, {
    name: 'Mixed Script',
    fontSize: 18,
    transform: [1, 0, 0, 1, 320, 226],
    fill: rgb(16, 21, 31),
  });
  const emoji = makeTextNode('emoji', EMOJI_TEXT, {
    name: 'Emoji Line',
    fontSize: 18,
    transform: [1, 0, 0, 1, 700, 226],
    fill: rgb(16, 21, 31),
  });

  const cards = makeFrameNode('cards', {
    name: 'Cards',
    w: 1200,
    h: 396,
    transform: [1, 0, 0, 1, 0, 364],
    fill: rgb(255, 255, 255),
  });

  // An authored auto-layout region. Its children are flow items, so the
  // exported CSS must not pin them with absolute offsets — the authored
  // direction, gap, padding, and fill sizing have to actually drive layout.
  const toolbarWidth = 560;
  const toolbar = {
    ...makeFrameNode('toolbar', {
      name: 'Toolbar',
      w: toolbarWidth,
      h: 56,
      transform: [1, 0, 0, 1, 600, 690],
      fill: rgb(240, 242, 245),
    }),
    layoutStyle: {
      mode: 'flex' as const,
      direction: 'row' as const,
      gap: 16,
      wrap: false,
      padding: [8, 16, 8, 16] as [number, number, number, number],
      grow: 0,
      shrink: 0,
      alignItems: 'center' as const,
      justifyContent: 'start' as const,
    },
  };
  const toolbarButtons = [0, 1, 2].map((index) => ({
    ...makeShapeNode(
      `toolbar-btn-${index}`,
      { kind: 'rect', x: 0, y: 0, w: 100, h: 32 },
      { name: `Toolbar Button ${index + 1}`, fill: rgb(57, 208, 198) },
    ),
    layoutSizingWidth: 'fill' as const,
  }));
  const toolbarBadge = {
    ...makeShapeNode(
      'toolbar-badge',
      { kind: 'rect', x: 0, y: 0, w: 24, h: 24 },
      { name: 'Toolbar Badge', fill: rgb(255, 96, 96) },
    ),
    // Explicitly pinned inside a flow container: keeps absolute positioning.
    layoutPosition: 'absolute' as const,
    transform: [1, 0, 0, 1, 520, 16] as [number, number, number, number, number, number],
  };

  const cardDefs = [
    { id: 'card-a', name: 'Card A', left: 40, accent: rgb(57, 208, 198) },
    { id: 'card-b', name: 'Card B', left: 440, accent: rgb(120, 140, 255) },
    { id: 'card-c', name: 'Card C', left: 840, accent: rgb(255, 168, 96) },
  ];

  nodes.push(
    page,
    nav,
    brand,
    pricing,
    navCta,
    hero,
    headline,
    body,
    cta,
    mixed,
    emoji,
    cards,
    toolbar,
    ...toolbarButtons,
    toolbarBadge,
  );
  const cardChildren: Array<{ parent: string; node: SceneNode }> = [];
  for (const def of cardDefs) {
    const card = makeFrameNode(def.id, {
      name: def.name,
      w: 320,
      h: 260,
      transform: [1, 0, 0, 1, def.left, 48],
      fill: rgb(250, 251, 252),
    });
    const swatch = makeShapeNode(
      `${def.id}-swatch`,
      { kind: 'rect', x: 0, y: 0, w: 320, h: 8 },
      { name: `${def.name} Accent`, fill: def.accent },
    );
    const title = makeTextNode(`${def.id}-title`, def.name, {
      name: `${def.name} Title`,
      fontSize: 22,
      fontWeight: 600,
      transform: [1, 0, 0, 1, 24, 40],
      fill: rgb(16, 21, 31),
    });
    const blurb = makeTextNode(
      `${def.id}-blurb`,
      'Nested frames, text runs, and authored offsets survive the export.',
      {
        name: `${def.name} Blurb`,
        fontSize: 14,
        lineHeight: 1.5,
        transform: [1, 0, 0, 1, 24, 84],
        fill: rgb(74, 85, 104),
      },
    );
    nodes.push(card, swatch, title, blurb);
    cardChildren.push(
      { parent: def.id, node: swatch },
      { parent: def.id, node: title },
      { parent: def.id, node: blurb },
    );
  }

  // Assemble in paint order. Every parent's child list is explicit so the
  // expected manifest below can mirror it one-for-one. The nav CTA lives
  // inside the nav, not the page.
  const childrenOf: Record<string, SceneNode[]> = {
    page: [nav, hero, cards, toolbar],
    nav: [brand, pricing, navCta],
    hero: [headline, body, mixed, emoji, cta],
    cards: cardDefs.map((def) => nodes.find((node) => node.id === def.id)!),
    toolbar: [...toolbarButtons, toolbarBadge],
  };

  doc = addNode(doc, page);
  for (const [parent, children] of Object.entries(childrenOf)) {
    for (const child of children) doc = addChild(doc, parent, child);
  }
  for (const { parent, node } of cardChildren) doc = addChild(doc, parent, node);
  doc = { ...doc, rootChildren: ['page'] };

  const expected: ExpectedManifest = {
    page: { width: 1200, height: 760 },
    elements: {},
  };

  const record = (
    key: string,
    className: string,
    box: ExpectedBox,
    extra: Partial<ExpectedEntry> = {},
  ) => {
    expected.elements[key] = { className, box, ...extra };
  };

  record(
    'page',
    'product-page',
    { left: 0, top: 0, width: 1200, height: 760 },
    {
      background: '#ffffff',
    },
  );
  record(
    'nav',
    'nav',
    { left: 0, top: 0, width: 1200, height: 64 },
    {
      background: '#10151f',
      parent: 'page',
    },
  );
  record(
    'brand',
    'brand',
    { left: 24, top: 22 },
    { text: 'Varve', color: '#ffffff', parent: 'nav' },
  );
  record(
    'pricing',
    'pricing-link',
    { left: 980, top: 26 },
    {
      text: 'Pricing',
      color: '#c8c8c8',
      parent: 'nav',
    },
  );
  record(
    'navCta',
    'nav-cta',
    { left: 1080, top: 14, width: 96, height: 36 },
    {
      background: '#39d0c6',
      parent: 'nav',
    },
  );
  record(
    'hero',
    'hero',
    { left: 0, top: 64, width: 1200, height: 300 },
    {
      background: '#f4f6f8',
      parent: 'page',
    },
  );
  record(
    'headline',
    'headline',
    { left: 64, top: 72 },
    {
      text: 'Design to code, deterministically',
      color: '#10151f',
      parent: 'hero',
    },
  );
  record(
    'body',
    'body-copy',
    { left: 64, top: 140 },
    { text: TRICKY_TEXT, color: '#4a5568', parent: 'hero' },
  );
  record(
    'cta',
    'primary-cta',
    { left: 64, top: 214, width: 200, height: 48 },
    {
      background: '#39d0c6',
      parent: 'hero',
    },
  );
  record(
    'mixed',
    'mixed-script',
    { left: 320, top: 226 },
    {
      text: MIXED_SCRIPT_TEXT,
      parent: 'hero',
    },
  );
  record('emoji', 'emoji-line', { left: 700, top: 226 }, { text: EMOJI_TEXT, parent: 'hero' });
  record(
    'cards',
    'cards',
    { left: 0, top: 364, width: 1200, height: 396 },
    {
      background: '#ffffff',
      parent: 'page',
    },
  );
  // The toolbar is an authored flow container: its children's positions are
  // produced by flexbox, not by authored offsets, so it is described
  // relationally rather than as fixed boxes.
  record(
    'toolbar',
    'toolbar',
    { left: 600, top: 690, width: toolbarWidth, height: 56 },
    {
      background: '#f0f2f5',
      parent: 'page',
    },
  );
  record(
    'toolbarBadge',
    'toolbar-badge',
    { left: 520, top: 16, width: 24, height: 24 },
    {
      background: '#ff6060',
      parent: 'toolbar',
    },
  );
  expected.flex = [
    {
      containerId: 'toolbar',
      className: 'toolbar',
      width: toolbarWidth,
      height: 56,
      gap: 16,
      padding: [8, 16, 8, 16],
      direction: 'row',
      fillChildren: ['toolbar-button-1', 'toolbar-button-2', 'toolbar-button-3'],
      absoluteChild: 'toolbar-badge',
    },
  ];
  for (const def of cardDefs) {
    const slug = def.name.toLowerCase().replace(' ', '-');
    record(
      def.id,
      slug,
      { left: def.left, top: 48, width: 320, height: 260 },
      {
        background: '#fafbfc',
        parent: 'cards',
      },
    );
    record(
      `${def.id}-swatch`,
      `${slug}-accent`,
      { left: 0, top: 0, width: 320, height: 8 },
      { parent: slug },
    );
    record(
      `${def.id}-title`,
      `${slug}-title`,
      { left: 24, top: 40 },
      {
        text: def.name,
        parent: slug,
      },
    );
    record(
      `${def.id}-blurb`,
      `${slug}-blurb`,
      { left: 24, top: 84 },
      {
        text: 'Nested frames, text runs, and authored offsets survive the export.',
        parent: slug,
      },
    );
  }

  return { doc, expected };
}

function writeFile(outDir: string, relativePath: string, contents: string): void {
  const target = resolve(outDir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, 'utf8');
}

describe('generated example bundle', () => {
  it('exports a compiling, child-preserving component from a nested page design', () => {
    const { doc, expected } = buildExampleDesign();
    const page = doc.nodes.page!;

    const bundle = exportNodeToCssModulesBundle(page, doc, { fileStem: 'product-page' });
    const tsx = bundle.files.find((file) => file.language === 'tsx')!;
    const css = bundle.files.find((file) => file.language === 'css')!;

    expect(bundle.deliverable).toBe('component');
    expect(bundle.files).toHaveLength(2);
    expect(tsx.contents).not.toContain('position: absolute');
    expect(tsx.contents).not.toContain('/* CSS Module */');
    expect(tsx.contents).toContain("import styles from './product-page.module.css';");
    expect(tsx.contents).toContain('export function ProductPage()');

    // Every expected element has a rule and a JSX reference.
    for (const entry of Object.values(expected.elements)) {
      expect(css.contents, `missing rule .${entry.className}`).toContain(`.${entry.className} {`);
      expect(css.contents, `missing rule .${entry.className}`).toContain(`${entry.box.left}px`);
      expect(css.contents, `missing rule .${entry.className}`).toContain(`${entry.box.top}px`);
      if (entry.box.width !== undefined) {
        expect(css.contents, `missing width for .${entry.className}`).toContain(
          `${entry.box.width}px`,
        );
      }
      if (entry.text !== undefined) {
        expect(tsx.contents, `missing text for .${entry.className}`).toContain(
          JSON.stringify(entry.text),
        );
        // Markup characters must appear exactly once, un-escaped.
        expect(tsx.contents).not.toContain('&amp;');
        expect(tsx.contents).not.toContain('&lt;');
      }
    }

    // Deterministic: no timestamps, no counters that move between runs.
    const second = exportNodeToCssModulesBundle(page, doc, { fileStem: 'product-page' });
    expect(second.files[0]!.contents).toBe(tsx.contents);

    // Authored auto-layout: flow children are not absolutely positioned, and
    // the container's direction/gap/padding are emitted.
    const ruleFor = (name: string): string => {
      const start = css.contents.indexOf(`.${name} {`);
      expect(start, `missing rule .${name}`).toBeGreaterThanOrEqual(0);
      return css.contents.slice(start, css.contents.indexOf('}', start));
    };

    expect(css.contents).toContain('.toolbar {');
    expect(css.contents).toContain('display: flex;');
    expect(css.contents).toContain('flex-direction: row;');
    expect(css.contents).toContain('gap: 16px;');
    expect(css.contents).toContain('padding: 8px 16px 8px 16px;');
    // The authored w/h is the whole box; padding must not grow it.
    expect(ruleFor('toolbar')).toContain('box-sizing: border-box;');

    for (const id of ['toolbar-button-1', 'toolbar-button-2', 'toolbar-button-3']) {
      const rule = ruleFor(id);
      expect(rule).toContain('position: static;');
      expect(rule).not.toContain('position: absolute;');
      expect(rule).not.toContain('left:');
      expect(rule).toContain('flex: 1 1 0;');
    }
    // An explicitly pinned child keeps its absolute placement.
    const badgeRule = ruleFor('toolbar-badge');
    expect(badgeRule).toContain('position: absolute;');
    expect(badgeRule).toContain('left: 520px;');
    expect(badgeRule).toContain('top: 16px;');

    // The Tailwind profile must declare a version range the emitted syntax
    // actually supports. The `bg-[--name]` shorthand (v3.3) was replaced in v4
    // by `bg-(--name)`, so the explicit `var()` form is what is emitted.
    const tailwindBundle = exportNodeToTailwindBundle(page, doc, {
      fileStem: 'product-page-tailwind',
    });
    const tailwindTsx = tailwindBundle.files.find((file) => file.entry)!;
    expect(tailwindBundle.dependencies.tailwindcss).toBe('>=3.4');
    expect(tailwindTsx.contents).toContain('export function ProductPage()');
    expect(tailwindTsx.contents).not.toMatch(/\[--[a-z]/);

    const outDir = process.env.VARVE_CODEGEN_EXAMPLE_OUT;
    if (!outDir) return;

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const file of bundle.files) writeFile(outDir, file.path, file.contents);
    for (const file of tailwindBundle.files)
      writeFile(outDir, `tailwind/${file.path}`, file.contents);
    writeFile(outDir, 'product-page.svg', exportNodeToSvg(page, doc));
    writeFile(outDir, 'expected.json', `${JSON.stringify(expected, null, 2)}\n`);
    writeFile(
      outDir,
      'bundle.json',
      `${JSON.stringify(
        {
          target: bundle.target,
          deliverable: bundle.deliverable,
          files: bundle.files.map((file) => ({
            path: file.path,
            language: file.language,
            mimeType: file.mimeType,
            entry: file.entry ?? false,
          })),
          dependencies: bundle.dependencies,
          setup: bundle.setup,
          diagnostics: bundle.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
  });
});
