import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeCapabilities,
  resetCapabilitiesCache,
  setCapabilitiesForTest,
} from '../capabilities';

beforeEach(() => {
  resetCapabilitiesCache();
  setCapabilitiesForTest(null);
});

afterEach(() => {
  resetCapabilitiesCache();
  setCapabilitiesForTest(null);
});

describe('computeCapabilities — default (non-Tauri)', () => {
  it('includes basic capabilities present in all environments', () => {
    const caps = computeCapabilities();
    expect(caps.has('fs.read')).toBe(true);
    expect(caps.has('fs.write')).toBe(true);
    expect(caps.has('shell.open')).toBe(true);
    expect(caps.has('backup')).toBe(true);
  });

  it('excludes Tauri-only capabilities', () => {
    const caps = computeCapabilities();
    expect(caps.has('archive')).toBe(false);
    expect(caps.has('nativeMenu')).toBe(false);
    expect(caps.has('multiWindow')).toBe(false);
    expect(caps.has('autoUpdate')).toBe(false);
  });

  it('excludes notifications when API is unavailable', () => {
    const caps = computeCapabilities();
    expect(caps.has('notifications')).toBe(false);
  });
});

describe('setCapabilitiesForTest — override', () => {
  it('returns the forced set when override is active', () => {
    const forced = new Set(['archive', 'nativeMenu'] as const);
    setCapabilitiesForTest(forced);
    const caps = computeCapabilities();
    expect(caps.has('archive')).toBe(true);
    expect(caps.has('nativeMenu')).toBe(true);
    expect(caps.has('fs.read')).toBe(false);
    expect(caps.has('backup')).toBe(false);
  });

  it('clears override when set to null', () => {
    const forced = new Set(['archive'] as const);
    setCapabilitiesForTest(forced);
    expect(computeCapabilities().has('archive')).toBe(true);

    setCapabilitiesForTest(null);
    resetCapabilitiesCache();
    expect(computeCapabilities().has('archive')).toBe(false);
  });
});

describe('computeCapabilities — with __TAURI__', () => {
  const TAURI_KEY = '__TAURI__' as string;

  beforeEach(() => {
    (window as unknown as Record<string, unknown>)[TAURI_KEY] = {};
    resetCapabilitiesCache();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[TAURI_KEY];
    resetCapabilitiesCache();
  });

  it('includes Tauri-only capabilities when __TAURI__ is set', () => {
    const caps = computeCapabilities();
    expect(caps.has('archive')).toBe(true);
    expect(caps.has('nativeMenu')).toBe(true);
    expect(caps.has('multiWindow')).toBe(true);
    expect(caps.has('autoUpdate')).toBe(true);
    expect(caps.has('fs.recentPaths')).toBe(true);
    expect(caps.has('fs.watch')).toBe(true);
  });
});

describe('resetCapabilitiesCache', () => {
  it('forces re-computation on next call', () => {
    const first = computeCapabilities();
    expect(first.has('fs.read')).toBe(true);

    setCapabilitiesForTest(new Set());
    resetCapabilitiesCache();

    const second = computeCapabilities();
    expect(second.has('fs.read')).toBe(false);
  });
});
