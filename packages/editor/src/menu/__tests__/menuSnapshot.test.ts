import { createDocument } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { getAllMenuDefs, getCanvasContextMenuDefs } from '../defs';
import { buildIntelFacts, buildMenuContext, detectPlatformFacts } from '../facts';
import { renderMenubarItems, renderMenuItems } from '../renderer';
import type { MenuContext, MenuItemDef } from '../types';

function createTestDoc() {
  const base = createDocument('snapshot-test');
  return base;
}

const TEST_SELECTION = ['n1', 'n2'];
const EMPTY_SELECTION: string[] = [];

function buildCtx(
  selection: string[],
  workspace: 'design' | 'print' | 'drawing' | 'image' | 'motion' | 'codegen',
  platformKind?: string,
): MenuContext {
  const doc = createTestDoc();
  const ctx = buildMenuContext(
    selection,
    doc,
    workspace,
    detectPlatformFacts(platformKind),
    buildIntelFacts([], null, false),
  );
  ctx.document.hasSelection = selection.length > 0;
  ctx.document.hasMultipleSelection = selection.length >= 2;
  return ctx;
}

function snapshotItem(item: unknown): unknown {
  if (Array.isArray(item)) return item.map(snapshotItem);
  if (item && typeof item === 'object') {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      if (k === 'onAction' || k === 'onToggle' || k === 'run' || k === 'handler') {
        obj[k] = '<function>';
      } else if (k === 'submenu' && Array.isArray(v)) {
        obj[k] = snapshotItem(v);
      } else if (k === 'ctx') {
      } else if (typeof v === 'function') {
      } else {
        obj[k] = v;
      }
    }
    return obj;
  }
  return item;
}

describe('menu snapshot — menubar tree', () => {
  const WORKSPACES = ['design', 'print', 'drawing', 'image', 'motion', 'codegen'] as const;
  const PLATFORMS = ['tauri', 'web'] as const;

  for (const platform of PLATFORMS) {
    describe(`platform: ${platform}`, () => {
      for (const workspace of WORKSPACES) {
        it(`workspace: ${workspace} with selection`, () => {
          const ctx = buildCtx(TEST_SELECTION, workspace, platform);
          const defs = getAllMenuDefs({
            runAction: () => {},
          });
          const rendered = renderMenubarItems(defs, ctx, {
            ctx,
            run: () => {},
            contexts: ['menubar'],
          });
          expect(snapshotItem(rendered)).toMatchSnapshot(
            `menubar-${platform}-${workspace}-with-selection`,
          );
        });

        it(`workspace: ${workspace} empty selection`, () => {
          const ctx = buildCtx(EMPTY_SELECTION, workspace, platform);
          const defs = getAllMenuDefs({
            runAction: () => {},
          });
          const rendered = renderMenubarItems(defs, ctx, {
            ctx,
            run: () => {},
            contexts: ['menubar'],
          });
          expect(snapshotItem(rendered)).toMatchSnapshot(
            `menubar-${platform}-${workspace}-empty-selection`,
          );
        });
      }
    });
  }
});

describe('menu snapshot — canvas context menu', () => {
  const WORSPACES = ['design', 'print', 'drawing', 'image', 'motion', 'codegen'] as const;

  for (const workspace of WORSPACES) {
    it(`workspace: ${workspace} with selection`, () => {
      const ctx = buildCtx(TEST_SELECTION, workspace);
      const defs = getCanvasContextMenuDefs(() => {});
      const rendered = renderMenuItems(defs, ctx, {
        ctx,
        run: () => {},
        contexts: ['canvas'],
      });
      expect(snapshotItem(rendered)).toMatchSnapshot(`ctx-canvas-${workspace}-with-selection`);
    });

    it(`workspace: ${workspace} empty selection`, () => {
      const ctx = buildCtx(EMPTY_SELECTION, workspace);
      const defs = getCanvasContextMenuDefs(() => {});
      const rendered = renderMenuItems(defs, ctx, {
        ctx,
        run: () => {},
        contexts: ['canvas'],
      });
      expect(snapshotItem(rendered)).toMatchSnapshot(`ctx-canvas-${workspace}-empty-selection`);
    });
  }
});

describe('menu definition — structure invariants', () => {
  for (const workspace of ['design', 'print', 'drawing', 'image', 'motion', 'codegen'] as const) {
    it(`no duplicate IDs in workspace: ${workspace}`, () => {
      const defs = getAllMenuDefs({ runAction: () => {} });
      const ids = new Set<string>();
      function walk(items: MenuItemDef[]) {
        for (const item of items) {
          expect(ids.has(item.id)).toBe(false);
          ids.add(item.id);
          if (item.items && typeof item.items !== 'function') {
            walk(item.items as MenuItemDef[]);
          }
        }
      }
      walk(defs);
    });

    it('no manual separator items exist', () => {
      const defs = getAllMenuDefs({ runAction: () => {} });
      function walk(items: MenuItemDef[]) {
        for (const item of items) {
          expect(item.kind).not.toBe('separator');
          if (item.items && typeof item.items !== 'function') {
            walk(item.items as MenuItemDef[]);
          }
        }
      }
      walk(defs);
    });
  }

  it('submenu depth does not exceed 2', () => {
    const defs = getAllMenuDefs({ runAction: () => {} });
    function checkDepth(items: MenuItemDef[], depth: number) {
      for (const item of items) {
        if (item.kind === 'submenu' && item.items && typeof item.items !== 'function') {
          expect(depth).toBeLessThanOrEqual(2);
          checkDepth(item.items as MenuItemDef[], depth + 1);
        }
      }
    }
    checkDepth(defs, 0);
  });

  it('all top-level groups have items', () => {
    const defs = getAllMenuDefs({ runAction: () => {} });
    for (const group of defs) {
      expect(group.items).toBeDefined();
      expect(Array.isArray(group.items) ? group.items.length : 1).toBeGreaterThan(0);
    }
  });
});
