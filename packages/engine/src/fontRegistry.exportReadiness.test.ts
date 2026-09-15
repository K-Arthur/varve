/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { awaitExportsReady, getFontRegistry, resetFontRegistry } from './fontRegistry';

function installFontSet() {
  const fontSet = {
    load: vi.fn(async () => []),
    check: vi.fn(() => true),
    ready: Promise.resolve(),
  };
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fontSet,
  });
  return fontSet;
}

afterEach(() => {
  resetFontRegistry();
});

describe('awaitExportsReady exact-face admission', () => {
  it('rejects a different artifact when the family has identity-aware entries', async () => {
    installFontSet();
    const registry = getFontRegistry();
    registry.register({
      family: 'Export Shared',
      weight: 400,
      style: 'normal',
      source: 'user',
      faceKey: `sha256:${'1'.repeat(64)}:single`,
    });
    vi.spyOn(registry as any, 'doLoad').mockResolvedValue(undefined);

    await expect(
      awaitExportsReady([
        {
          family: 'Export Shared',
          fontReference: { artifactHash: '2'.repeat(64) },
        },
      ]),
    ).rejects.toThrow(/Exact font face is not registered for export/);
  });

  it('loads the requested exact artifact when its portable key is registered', async () => {
    const fontSet = installFontSet();
    const registry = getFontRegistry();
    registry.register({
      family: 'Export Exact',
      weight: 700,
      style: 'italic',
      source: 'user',
      faceKey: `sha256:${'3'.repeat(64)}:0`,
    });
    vi.spyOn(registry as any, 'doLoad').mockResolvedValue(undefined);

    await expect(
      awaitExportsReady([
        {
          family: 'Export Exact',
          weight: 700,
          style: 'italic',
          text: 'Exact',
          fontReference: { artifactHash: '3'.repeat(64), collectionIndex: 0 },
        },
      ]),
    ).resolves.toBeUndefined();
    expect(fontSet.load).toHaveBeenCalledWith('italic 700 16px "Export Exact"', 'Exact');
  });

  it('rejects a face when the browser reports that the requested sample is not ready', async () => {
    const fontSet = installFontSet();
    fontSet.check.mockReturnValue(false);
    const registry = getFontRegistry();
    registry.register({
      family: 'Export Unready',
      weight: 400,
      style: 'normal',
      source: 'bundled',
    });
    vi.spyOn(registry as any, 'doLoad').mockResolvedValue(undefined);

    await expect(awaitExportsReady([{ family: 'Export Unready' }])).rejects.toThrow(
      /did not become ready for export/,
    );
  });
});
