import { describe, expect, it, vi } from 'vitest';
import { ModelRegistry } from './ModelRegistry';
import type { ModelManifestEntry } from './types';

const TEST_ENTRIES: ModelManifestEntry[] = [
  {
    id: 'test-model',
    name: 'Test Model',
    description: 'A test model',
    sizeBytes: 1_000_000,
    remoteUrl: 'https://example.com/model.onnx',
    checksum: 'abc123',
    bundled: false,
    inputSpec: null,
    quality: 3,
  },
  {
    id: 'bundled-model',
    name: 'Bundled Model',
    description: 'A bundled test model',
    sizeBytes: 500_000,
    remoteUrl: '',
    checksum: 'def456',
    bundled: true,
    inputSpec: {
      inputSize: 320,
      mean: [0.485, 0.456, 0.406],
      std: [0.229, 0.224, 0.225],
      paddingRgb: [124, 116, 104],
      applySigmoid: false,
    },
    quality: 4,
  },
];

describe('ModelRegistry', () => {
  it('starts all entries as unavailable', () => {
    const reg = new ModelRegistry(TEST_ENTRIES);
    for (const entry of TEST_ENTRIES) {
      expect(reg.getState(entry.id)).toBe('unavailable');
    }
  });

  it('returns the correct entry by id', () => {
    const reg = new ModelRegistry(TEST_ENTRIES);
    const entry = reg.getEntry('test-model');
    expect(entry?.name).toBe('Test Model');
  });

  it('returns undefined for unknown models', () => {
    const reg = new ModelRegistry(TEST_ENTRIES);
    expect(reg.getEntry('unknown')).toBeUndefined();
  });

  it('lists all registered entries', () => {
    const reg = new ModelRegistry(TEST_ENTRIES);
    expect(reg.listEntries()).toHaveLength(2);
  });

  it('knows if a model is registered', () => {
    const reg = new ModelRegistry(TEST_ENTRIES);
    expect(reg.knows('test-model')).toBe(true);
    expect(reg.knows('unknown')).toBe(false);
  });

  it('tracks state transitions', () => {
    const reg = new ModelRegistry(TEST_ENTRIES);
    reg.setState('test-model', 'downloading');
    expect(reg.getState('test-model')).toBe('downloading');
    reg.setState('test-model', 'ready');
    expect(reg.isReady('test-model')).toBe(true);
  });

  it('notifies listeners on state change', () => {
    const reg = new ModelRegistry(TEST_ENTRIES);
    const listener = vi.fn();
    reg.subscribe('test-model', listener);
    reg.setState('test-model', 'ready');
    expect(listener).toHaveBeenCalledWith('test-model', 'ready');
  });

  it('unsubscribes listeners', () => {
    const reg = new ModelRegistry(TEST_ENTRIES);
    const listener = vi.fn();
    const unsub = reg.subscribe('test-model', listener);
    unsub();
    reg.setState('test-model', 'ready');
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify on no-op state change', () => {
    const reg = new ModelRegistry(TEST_ENTRIES);
    const listener = vi.fn();
    reg.subscribe('test-model', listener);
    reg.setState('test-model', 'unavailable');
    expect(listener).not.toHaveBeenCalled();
  });

  it('lists install info for all models', () => {
    const reg = new ModelRegistry(TEST_ENTRIES);
    reg.setState('test-model', 'ready');
    const info = reg.listInstallInfo();
    const testModel = info.find((i) => i.id === 'test-model');
    expect(testModel?.installed).toBe(true);
    const bundledModel = info.find((i) => i.id === 'bundled-model');
    expect(bundledModel?.installed).toBe(false);
  });

  it('registers a new model at runtime', () => {
    const reg = new ModelRegistry([]);
    reg.register(TEST_ENTRIES[0]!);
    expect(reg.knows('test-model')).toBe(true);
    expect(reg.getState('test-model')).toBe('unavailable');
  });

  it('resets all states', () => {
    const reg = new ModelRegistry(TEST_ENTRIES);
    reg.setState('test-model', 'ready');
    reg.reset();
    expect(reg.getState('test-model')).toBe('unavailable');
  });
});
