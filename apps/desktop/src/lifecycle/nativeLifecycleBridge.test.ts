import { describe, expect, it } from 'vitest';
import { resolveNativeFinalize } from './nativeLifecycleBridge';

describe('native lifecycle finalize decision', () => {
  it('close-window on macOS closes only the window (app keeps running)', () => {
    expect(resolveNativeFinalize('close-window', true)).toBe('close-window');
  });

  it('close-window on Linux/Windows exits the app (last-window convention)', () => {
    expect(resolveNativeFinalize('close-window', false)).toBe('exit');
  });

  it('quit-application always approves exit', () => {
    expect(resolveNativeFinalize('quit-application', true)).toBe('exit');
    expect(resolveNativeFinalize('quit-application', false)).toBe('exit');
  });

  it('restart reuses the same guard and approves exit', () => {
    expect(resolveNativeFinalize('restart', false)).toBe('exit');
  });

  it('close-document and reload need no native action', () => {
    expect(resolveNativeFinalize('close-document', false)).toBe('none');
    expect(resolveNativeFinalize('reload', true)).toBe('none');
  });
});
