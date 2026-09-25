import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGuestRequest } from './guestWorker';
import { parsePluginPackage } from './package';

afterEach(() => vi.restoreAllMocks());

describe('package review boundary', () => {
  it('compiles a real guest without instantiating or running its start section', async () => {
    const archive = readFileSync('tests/e2e/plugins/fixtures/style-audit.varveplugin');
    const pkg = await parsePluginPackage(new Uint8Array(archive));
    const instantiate = vi.spyOn(WebAssembly, 'instantiate');
    const result = await handleGuestRequest({
      operation: 'validate',
      wasm: Uint8Array.from(pkg.wasm).buffer,
    });
    expect(result).toEqual({ validated: true });
    expect(instantiate).not.toHaveBeenCalled();
  });
});
