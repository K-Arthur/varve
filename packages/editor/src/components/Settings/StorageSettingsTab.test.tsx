// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageSettingsTab } from './StorageSettingsTab';

const { mockListSessionsMeta } = vi.hoisted(() => ({
  mockListSessionsMeta: vi.fn(async () => [{ sizeBytes: 2048 }]),
}));

vi.mock('../../recovery', () => ({
  getSharedRecoveryManager: () => ({ listSessionsMeta: mockListSessionsMeta }),
}));

interface FakeCaches {
  keys: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function installBrowserFakes(options?: { persisted?: boolean; persistResult?: boolean }) {
  const fakeCaches: FakeCaches = {
    keys: vi.fn(async () => ['varve-demo-shell-v2', 'other-app-cache']),
    open: vi.fn(async () => ({ keys: async () => [1, 2, 3] })),
    delete: vi.fn(async () => true),
  };
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: fakeCaches });
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      estimate: vi.fn(async () => ({ usage: 1048576, quota: 104857600 })),
      persisted: vi.fn(async () => options?.persisted ?? false),
      persist: vi.fn(async () => options?.persistResult ?? true),
    },
  });
  return fakeCaches;
}

describe('StorageSettingsTab', () => {
  beforeEach(() => {
    mockListSessionsMeta.mockClear();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'caches');
  });

  it('separates documents, recovery copies, and disposable app caches', async () => {
    installBrowserFakes();
    render(<StorageSettingsTab />);

    await waitFor(() => expect(screen.getByText(/1 saved version/)).toBeTruthy());
    expect(screen.getByText(/3 cached files/)).toBeTruthy();
    expect(screen.getAllByText(/Best-effort storage/).length).toBeGreaterThan(0);
  });

  it('clears only the owned offline caches after confirmation', async () => {
    const fakeCaches = installBrowserFakes();
    render(<StorageSettingsTab />);
    await waitFor(() => expect(screen.getByText(/3 cached files/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Clear offline app copies' }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm clear/ }));

    await waitFor(() => expect(fakeCaches.delete).toHaveBeenCalledWith('varve-demo-shell-v2'));
    expect(fakeCaches.delete).not.toHaveBeenCalledWith('other-app-cache');
    await waitFor(() =>
      expect(screen.getByText(/documents and recovery copies were not touched/)).toBeTruthy(),
    );
  });

  it('requests persistence from a click and reports the answer', async () => {
    installBrowserFakes({ persisted: false, persistResult: false });
    render(<StorageSettingsTab />);
    await waitFor(() => expect(screen.getByText(/Best-effort storage/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Ask the browser to keep it' }));
    await waitFor(() => expect(screen.getByText(/browser declined for now/)).toBeTruthy());
  });
});
