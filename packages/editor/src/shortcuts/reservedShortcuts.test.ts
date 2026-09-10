import { describe, expect, it } from 'vitest';
import { getReservedShortcutsForTarget, isTauriRuntime } from './reservedShortcuts';

describe('reservedShortcuts', () => {
  it('returns browser reserved shortcuts outside Tauri', () => {
    expect(isTauriRuntime()).toBe(false);
    const info = getReservedShortcutsForTarget();
    expect(info.target).toBe('browser');
    expect(info.shortcuts.length).toBeGreaterThan(0);
    expect(info.shortcuts.some((s) => s.keys.includes('Ctrl/Cmd+W'))).toBe(true);
  });
});
