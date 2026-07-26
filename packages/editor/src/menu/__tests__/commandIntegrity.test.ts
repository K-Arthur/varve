import { afterEach, describe, expect, it } from 'vitest';
import { getActionRegistry, resetActionRegistryForTesting } from '../../actions/ActionRegistry';
import { detectCollisions, SHORTCUT_DEFS } from '../../shortcuts/ShortcutManager';
import { getAllMenuDefs } from '../defs';
import type { Accelerator, MenuContext, MenuItemDef } from '../types';
import { dispatchNativeMenuAction } from '../useNativeMenu';

function normalizeAccelerator(accelerator: Accelerator): Accelerator {
  return {
    key: accelerator.key.toLowerCase(),
    ctrl: accelerator.ctrl || undefined,
    shift: accelerator.shift || undefined,
    alt: accelerator.alt || undefined,
    meta: accelerator.meta || undefined,
  };
}

function collectStaticItems(items: MenuItemDef[]): MenuItemDef[] {
  const collected: MenuItemDef[] = [];
  for (const item of items) {
    collected.push(item);
    if (Array.isArray(item.items)) {
      collected.push(...collectStaticItems(item.items));
    }
  }
  return collected;
}

describe('menu command integrity', () => {
  afterEach(() => {
    resetActionRegistryForTesting();
  });

  it('has no unresolved shortcut collisions', () => {
    expect(detectCollisions()).toEqual([]);
  });

  it('uses the same accelerator as the shortcut registry for shared command IDs', () => {
    const definitions = getAllMenuDefs({ runAction: () => {} });
    const menuItems = collectStaticItems(definitions);
    const mismatches: string[] = [];

    for (const item of menuItems) {
      if (!item.accelerator) continue;
      const shortcut = SHORTCUT_DEFS[item.id as keyof typeof SHORTCUT_DEFS];
      if (!shortcut) continue;

      const menuAccelerator = normalizeAccelerator(item.accelerator);
      const shortcutAccelerator = normalizeAccelerator(shortcut.binding);
      if (JSON.stringify(menuAccelerator) !== JSON.stringify(shortcutAccelerator)) {
        mismatches.push(
          `${item.id}: menu=${JSON.stringify(menuAccelerator)} shortcut=${JSON.stringify(shortcutAccelerator)}`,
        );
      }
    }

    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });

  it('gives every static command an executable dispatch function', () => {
    const definitions = getAllMenuDefs({ runAction: () => {} });
    const commands = collectStaticItems(definitions).filter((item) => item.kind !== 'separator');

    expect(
      commands.filter((item) => typeof item.run !== 'function').map((item) => item.id),
    ).toEqual([]);
  });

  it('routes every static menubar command to the supplied command dispatcher', () => {
    const dispatched: string[] = [];
    const definitions = getAllMenuDefs({ runAction: (id) => dispatched.push(id) });
    const commands = collectStaticItems(definitions).filter(
      (item) => item.kind === 'command' || item.kind === 'checkbox' || item.kind === 'radio',
    );
    const commandsWithoutDispatch: string[] = [];

    for (const command of commands) {
      const countBefore = dispatched.length;
      command.run?.({} as MenuContext);
      if (dispatched.length === countBefore) commandsWithoutDispatch.push(command.id);
    }

    expect(commandsWithoutDispatch, commandsWithoutDispatch.join('\n')).toEqual([]);
  });

  it('falls back to the menubar dispatcher for native-only commands', () => {
    const dispatched: string[] = [];
    dispatchNativeMenuAction('settings', (id) => dispatched.push(id));
    expect(dispatched).toEqual(['settings']);

    getActionRegistry().register({ id: 'undo', label: 'Undo', category: 'edit' }, () =>
      dispatched.push('registry:undo'),
    );
    dispatchNativeMenuAction('undo', (id) => dispatched.push(id));
    expect(dispatched).toEqual(['settings', 'registry:undo']);
  });
});
