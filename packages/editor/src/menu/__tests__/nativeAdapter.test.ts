import { createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { getAllMenuDefs } from '../defs';
import { buildIntelFacts, buildMenuContext, detectPlatformFacts } from '../facts';
import {
  buildNativeMenuSpec,
  diffNativeMenuState,
  type NativeMenuItemSpec,
  type NativeMenuSpec,
} from '../nativeAdapter';
import type { MenuContext } from '../types';

function createTestDoc() {
  const doc = createDocument('adapter-test');
  const rect = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
  const rect2 = makeShapeNode('n2', { kind: 'rect', x: 120, y: 0, w: 100, h: 100 });
  return {
    ...doc,
    nodes: { ...doc.nodes, n1: rect, n2: rect2 },
    rootChildren: [rect.id, rect2.id],
  };
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

function getDefs() {
  return getAllMenuDefs({ runAction: () => {} });
}

function stripFunctions(_key: string, val: unknown): unknown {
  if (typeof val === 'function') return '<function>';
  return val;
}

describe('buildNativeMenuSpec — platform selection', () => {
  it('macOS includes App + Edit + Window + Help submenus', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const spec = buildNativeMenuSpec(getDefs(), ctx, 'mac');
    const ids = spec.submenus.map((s) => s.id);
    expect(ids).toContain('app');
    expect(ids).toContain('edit');
    expect(ids).toContain('window');
    expect(ids).toContain('help');
    expect(ids).not.toContain('file');
    expect(ids).not.toContain('view');
    expect(ids).not.toContain('object');
    expect(ids).not.toContain('text');
    expect(ids).not.toContain('arrange');
    expect(ids).not.toContain('page');
  });

  it('Windows includes Edit + Help, not App or Window', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const spec = buildNativeMenuSpec(getDefs(), ctx, 'windows');
    const ids = spec.submenus.map((s) => s.id);
    expect(ids).toContain('edit');
    expect(ids).toContain('help');
    expect(ids).not.toContain('app');
    expect(ids).not.toContain('window');
    expect(ids).not.toContain('file');
  });

  it('Linux includes Edit + Help, not App or Window', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const spec = buildNativeMenuSpec(getDefs(), ctx, 'linux');
    const ids = spec.submenus.map((s) => s.id);
    expect(ids).toContain('edit');
    expect(ids).toContain('help');
    expect(ids).not.toContain('app');
    expect(ids).not.toContain('window');
  });
});

describe('buildNativeMenuSpec — App menu (macOS)', () => {
  it('has correct structure and items', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const spec = buildNativeMenuSpec(getDefs(), ctx, 'mac');
    const appMenu = spec.submenus.find((s) => s.id === 'app');
    expect(appMenu).toBeTruthy();
    expect(appMenu!.label).toBe('Varve');
    const kinds = appMenu!.items.map((i) => i.kind);
    expect(kinds).toEqual([
      'predefined',
      'separator',
      'item',
      'separator',
      'predefined',
      'separator',
      'predefined',
      'predefined',
      'predefined',
      'separator',
      'predefined',
    ]);
    const settingsItem = appMenu!.items.find((i) => i.id === 'settings');
    expect(settingsItem).toBeTruthy();
    expect(settingsItem!.accelerator).toBe('CmdOrCtrl+,');
    expect(settingsItem!.label).toContain('Settings');
  });
});

describe('buildNativeMenuSpec — Window menu (macOS)', () => {
  it('has minimize, zoom, close_window', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const spec = buildNativeMenuSpec(getDefs(), ctx, 'mac');
    const windowMenu = spec.submenus.find((s) => s.id === 'window');
    expect(windowMenu).toBeTruthy();
    expect(windowMenu!.items[0]!.id).toBe('minimize');
    expect(windowMenu!.items[1]!.id).toBe('zoom');
    expect(windowMenu!.items[3]!.id).toBe('close_window');
  });
});

describe('buildNativeMenuSpec — Edit menu', () => {
  function editSpec(ctx: MenuContext, platform: 'mac' | 'windows' | 'linux') {
    const spec = buildNativeMenuSpec(getDefs(), ctx, platform);
    return spec.submenus.find((s) => s.id === 'edit')!;
  }

  it('contains undo/redo with correct accelerators', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const edit = editSpec(ctx, 'mac');
    const undo = edit.items.find((i) => i.id === 'undo');
    const redo = edit.items.find((i) => i.id === 'redo');
    expect(undo).toBeTruthy();
    expect(undo!.accelerator).toBe('CmdOrCtrl+Z');
    expect(redo).toBeTruthy();
    expect(redo!.accelerator).toBe('CmdOrCtrl+Shift+Z');
  });

  it('cut accelerator is CmdOrCtrl+X, copy is CmdOrCtrl+C, paste is CmdOrCtrl+V', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const edit = editSpec(ctx, 'mac');
    expect(edit.items.find((i) => i.id === 'cut')!.accelerator).toBe('CmdOrCtrl+X');
    expect(edit.items.find((i) => i.id === 'copy')!.accelerator).toBe('CmdOrCtrl+C');
    expect(edit.items.find((i) => i.id === 'paste')!.accelerator).toBe('CmdOrCtrl+V');
    expect(edit.items.find((i) => i.id === 'selectAll')!.accelerator).toBe('CmdOrCtrl+A');
    expect(edit.items.find((i) => i.id === 'duplicate')!.accelerator).toBe('CmdOrCtrl+D');
  });

  it('contains cut/copy/paste/selectAll/delete', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const edit = editSpec(ctx, 'mac');
    const ids = edit.items.map((i) => i.id);
    expect(ids).toContain('cut');
    expect(ids).toContain('copy');
    expect(ids).toContain('paste');
    expect(ids).toContain('selectAll');
    expect(ids).toContain('delete');
  });

  it('cut/copy disabled without selection, enabled with selection', () => {
    const ctxWithSel = buildCtx(TEST_SELECTION, 'design');
    const ctxEmpty = buildCtx(EMPTY_SELECTION, 'design');

    const cutWith = editSpec(ctxWithSel, 'mac').items.find((i) => i.id === 'cut')!;
    const cutEmpty = editSpec(ctxEmpty, 'mac').items.find((i) => i.id === 'cut')!;
    expect(cutWith.enabled).toBe(true);
    expect(cutEmpty.enabled).toBe(false);

    const copyWith = editSpec(ctxWithSel, 'mac').items.find((i) => i.id === 'copy')!;
    const copyEmpty = editSpec(ctxEmpty, 'mac').items.find((i) => i.id === 'copy')!;
    expect(copyWith.enabled).toBe(true);
    expect(copyEmpty.enabled).toBe(false);
  });

  it('paste always enabled', () => {
    const ctxEmpty = buildCtx(EMPTY_SELECTION, 'design');
    const paste = editSpec(ctxEmpty, 'mac').items.find((i) => i.id === 'paste')!;
    expect(paste.enabled).toBe(true);
  });

  it('same items on macOS, Windows, and Linux', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const macIds = editSpec(ctx, 'mac')
      .items.filter((i) => i.kind !== 'separator')
      .map((i) => i.id);
    const winIds = editSpec(ctx, 'windows')
      .items.filter((i) => i.kind !== 'separator')
      .map((i) => i.id);
    const linuxIds = editSpec(ctx, 'linux')
      .items.filter((i) => i.kind !== 'separator')
      .map((i) => i.id);
    expect(macIds).toEqual(winIds);
    expect(winIds).toEqual(linuxIds);
  });
});

describe('buildNativeMenuSpec — Help menu', () => {
  function helpSpec(ctx: MenuContext, platform: 'mac' | 'windows' | 'linux') {
    const spec = buildNativeMenuSpec(getDefs(), ctx, platform);
    return spec.submenus.find((s) => s.id === 'help');
  }

  it('macOS excludes About from Help (moved to App menu)', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const help = helpSpec(ctx, 'mac');
    expect(help).toBeTruthy();
    expect(help!.items.find((i) => i.id === 'about')).toBeUndefined();
    expect(help!.items.length).toBeGreaterThan(0);
  });

  it('Windows includes About in Help menu', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const help = helpSpec(ctx, 'windows');
    expect(help).toBeTruthy();
    const about = help!.items.find((i) => i.id === 'about');
    expect(about).toBeTruthy();
    expect(about!.kind).toBe('predefined');
    expect(about!.itemType).toBe('about');
  });

  it('Linux includes About in Help menu', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const help = helpSpec(ctx, 'linux');
    expect(help).toBeTruthy();
    expect(help!.items.find((i) => i.id === 'about')).toBeTruthy();
  });

  it('excludes installDesktopApp on all platforms', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    for (const plat of ['mac', 'windows', 'linux'] as const) {
      expect(helpSpec(ctx, plat)!.items.find((i) => i.id === 'installDesktopApp')).toBeUndefined();
    }
  });

  it('contains contextual help items', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const help = helpSpec(ctx, 'mac');
    const ids = help!.items.map((i) => i.id);
    expect(ids).toContain('openHelp');
    expect(ids).toContain('openHelpCenter');
    expect(ids).toContain('whatIsThis');
    expect(ids).toContain('startTour');
  });
});

describe('diffNativeMenuState', () => {
  it('returns empty patches when specs are identical', () => {
    const spec: NativeMenuSpec = {
      submenus: [
        {
          id: 'edit',
          label: 'Edit',
          items: [
            { kind: 'item', id: 'undo', label: 'Undo', enabled: true },
            { kind: 'item', id: 'redo', label: 'Redo', enabled: true },
          ],
        },
      ],
    };
    expect(diffNativeMenuState(spec, spec)).toHaveLength(0);
  });

  it('detects enabled changes', () => {
    const prev: NativeMenuSpec = {
      submenus: [
        {
          id: 'edit',
          label: 'Edit',
          items: [{ kind: 'item', id: 'cut', label: 'Cut', enabled: true }],
        },
      ],
    };
    const curr: NativeMenuSpec = {
      submenus: [
        {
          id: 'edit',
          label: 'Edit',
          items: [{ kind: 'item', id: 'cut', label: 'Cut', enabled: false }],
        },
      ],
    };
    const patches = diffNativeMenuState(prev, curr);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.id).toBe('cut');
    expect(patches[0]!.enabled).toBe(false);
    expect(patches[0]!.checked).toBeUndefined();
    expect(patches[0]!.label).toBeUndefined();
  });

  it('detects checked changes', () => {
    const prev: NativeMenuSpec = {
      submenus: [
        {
          id: 'edit',
          label: 'Edit',
          items: [{ kind: 'check', id: 'bold', label: 'Bold', enabled: true, checked: false }],
        },
      ],
    };
    const curr: NativeMenuSpec = {
      submenus: [
        {
          id: 'edit',
          label: 'Edit',
          items: [{ kind: 'check', id: 'bold', label: 'Bold', enabled: true, checked: true }],
        },
      ],
    };
    const patches = diffNativeMenuState(prev, curr);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.id).toBe('bold');
    expect(patches[0]!.checked).toBe(true);
    expect(patches[0]!.enabled).toBeUndefined();
  });

  it('detects label changes', () => {
    const prev: NativeMenuSpec = {
      submenus: [
        {
          id: 'edit',
          label: 'Edit',
          items: [{ kind: 'item', id: 'save', label: 'Save', enabled: true }],
        },
      ],
    };
    const curr: NativeMenuSpec = {
      submenus: [
        {
          id: 'edit',
          label: 'Edit',
          items: [{ kind: 'item', id: 'save', label: 'Save As\u2026', enabled: true }],
        },
      ],
    };
    const patches = diffNativeMenuState(prev, curr);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.id).toBe('save');
    expect(patches[0]!.label).toBe('Save As\u2026');
  });

  it('detects multiple changes simultaneously', () => {
    const prev: NativeMenuSpec = {
      submenus: [
        {
          id: 'edit',
          label: 'Edit',
          items: [
            { kind: 'item', id: 'cut', label: 'Cut', enabled: true },
            { kind: 'check', id: 'bold', label: 'Bold', enabled: true, checked: false },
          ],
        },
      ],
    };
    const curr: NativeMenuSpec = {
      submenus: [
        {
          id: 'edit',
          label: 'Edit',
          items: [
            { kind: 'item', id: 'cut', label: 'Cut', enabled: false },
            { kind: 'check', id: 'bold', label: 'Bold', enabled: true, checked: true },
          ],
        },
      ],
    };
    const patches = diffNativeMenuState(prev, curr);
    expect(patches).toHaveLength(2);
    expect(patches.find((p) => p.id === 'cut')!.enabled).toBe(false);
    expect(patches.find((p) => p.id === 'bold')!.checked).toBe(true);
  });

  it('ignores separator and predefined items', () => {
    const spec: NativeMenuSpec = {
      submenus: [
        {
          id: 'app',
          label: 'Varve',
          items: [
            { kind: 'predefined', id: 'about', itemType: 'about' },
            { kind: 'separator', id: 'sep-1' },
            { kind: 'item', id: 'settings', label: 'Settings', enabled: true },
          ],
        },
      ],
    };
    const patches = diffNativeMenuState(null, spec);
    expect(patches.map((p) => p.id)).not.toContain('about');
    expect(patches.map((p) => p.id)).not.toContain('sep-1');
    expect(patches.map((p) => p.id)).toContain('settings');
  });

  it('returns all items when previous is null', () => {
    const spec: NativeMenuSpec = {
      submenus: [
        {
          id: 'edit',
          label: 'Edit',
          items: [
            { kind: 'item', id: 'undo', label: 'Undo', enabled: true },
            { kind: 'item', id: 'redo', label: 'Redo', enabled: false },
          ],
        },
      ],
    };
    expect(diffNativeMenuState(null, spec)).toHaveLength(2);
  });

  it('walks nested submenu items', () => {
    const prev: NativeMenuSpec = {
      submenus: [
        {
          id: 'test',
          label: 'Test',
          items: [
            {
              kind: 'submenu',
              id: 'recent',
              label: 'Open Recent',
              enabled: true,
              items: [{ kind: 'item', id: 'recent:file1', label: 'File 1.strata', enabled: true }],
            },
          ],
        },
      ],
    };
    const curr: NativeMenuSpec = {
      submenus: [
        {
          id: 'test',
          label: 'Test',
          items: [
            {
              kind: 'submenu',
              id: 'recent',
              label: 'Open Recent',
              enabled: true,
              items: [{ kind: 'item', id: 'recent:file1', label: 'File 1.strata', enabled: false }],
            },
          ],
        },
      ],
    };
    const patches = diffNativeMenuState(prev, curr);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.id).toBe('recent:file1');
    expect(patches[0]!.enabled).toBe(false);
  });
});

describe('buildNativeMenuSpec — state reactivity across platforms', () => {
  it('cut/copy disabled on empty selection on all platforms', () => {
    const ctxEmpty = buildCtx(EMPTY_SELECTION, 'design');
    for (const plat of ['mac', 'windows', 'linux'] as const) {
      const edit = buildNativeMenuSpec(getDefs(), ctxEmpty, plat).submenus.find(
        (s) => s.id === 'edit',
      )!;
      expect(edit.items.find((i) => i.id === 'cut')!.enabled).toBe(false);
      expect(edit.items.find((i) => i.id === 'copy')!.enabled).toBe(false);
    }
  });

  it('undo always enabled (no selection dependency)', () => {
    for (const ctx of [buildCtx(EMPTY_SELECTION, 'design'), buildCtx(TEST_SELECTION, 'design')]) {
      const edit = buildNativeMenuSpec(getDefs(), ctx, 'mac').submenus.find(
        (s) => s.id === 'edit',
      )!;
      expect(edit.items.find((i) => i.id === 'undo')!.enabled).toBe(true);
    }
  });
});

describe('buildNativeMenuSpec — platform diffs', () => {
  it('macOS and Windows specs are structurally distinct', () => {
    const ctx = buildCtx(TEST_SELECTION, 'design');
    const macSpec = buildNativeMenuSpec(getDefs(), ctx, 'mac');
    const winSpec = buildNativeMenuSpec(getDefs(), ctx, 'windows');
    expect(macSpec.submenus.map((s) => s.id).sort()).not.toEqual(
      winSpec.submenus.map((s) => s.id).sort(),
    );
    expect(macSpec.submenus.map((s) => s.id)).toContain('app');
    expect(macSpec.submenus.map((s) => s.id)).toContain('window');
    expect(winSpec.submenus.map((s) => s.id)).not.toContain('app');
    expect(winSpec.submenus.map((s) => s.id)).not.toContain('window');
  });
});

describe('buildNativeMenuSpec — snapshot (all platforms)', () => {
  const platforms = ['mac', 'windows', 'linux'] as const;
  const workspaces = ['design', 'print', 'drawing', 'image', 'motion'] as const;

  for (const platform of platforms) {
    describe(`platform: ${platform}`, () => {
      for (const workspace of workspaces) {
        it(`workspace: ${workspace}`, () => {
          const ctx = buildCtx(TEST_SELECTION, workspace);
          const spec = buildNativeMenuSpec(getDefs(), ctx, platform);
          expect(JSON.parse(JSON.stringify(spec, stripFunctions))).toMatchSnapshot(
            `native-menu-${platform}-${workspace}`,
          );
        });
      }
    });
  }
});

/**
 * The native side deserializes this payload with serde. A predefined item's
 * type field is non-optional there, so a name mismatch rejects the whole
 * `build_native_menu` argument and the app silently runs with no native menu
 * ("invalid args `spec` ... missing field `item_type`"). Pin the wire name.
 */
describe('native menu wire contract', () => {
  // Both the platform app-menu items and the per-definition predefined path
  // must carry it, so every platform is exercised.
  for (const platform of ['mac', 'windows', 'linux'] as const) {
    it(`emits itemType on every predefined item (${platform})`, () => {
      const spec = buildNativeMenuSpec(
        getDefs(),
        buildCtx(EMPTY_SELECTION, 'design', platform),
        platform,
      );
      const predefined: Array<{ id: string; itemType?: string }> = [];
      const walk = (items: NativeMenuItemSpec[]) => {
        for (const item of items) {
          if (item.kind === 'predefined') predefined.push(item);
          if (item.items) walk(item.items);
        }
      };
      for (const submenu of spec.submenus) walk(submenu.items);

      expect(predefined.length).toBeGreaterThan(0);
      for (const item of predefined) {
        expect(item.itemType, `predefined item ${item.id} must carry itemType`).toBeTruthy();
      }
    });
  }
});
