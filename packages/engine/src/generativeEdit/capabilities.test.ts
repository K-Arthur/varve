/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isTauri } = vi.hoisted(() => ({ isTauri: vi.fn() }));

vi.mock('@varve/platform', () => ({ isTauriRuntime: isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { getGenerativeEditCapabilities } from './pipeline';

describe('generative edit capability readiness', () => {
  beforeEach(() => {
    isTauri.mockReset();
    isTauri.mockReturnValue(true);
  });

  it('does not confuse a native helper with a qualified model', () => {
    const capabilities = getGenerativeEditCapabilities('local', {
      nativeModelReady: false,
    });

    expect(capabilities.modes.replace).toMatchObject({
      available: true,
      ready: false,
      reasonCode: 'model-required',
    });
    expect(capabilities.modes.expand).toMatchObject({ available: true, ready: false });
  });

  it('reports prompt modes ready only after model qualification', () => {
    const capabilities = getGenerativeEditCapabilities('local', {
      nativeModelReady: true,
    });

    expect(capabilities.modes.replace).toMatchObject({ available: true, ready: true });
    expect(capabilities.modes.expand).toMatchObject({ available: true, ready: true });
  });
});
