// @vitest-environment jsdom

import { resetPlatformInfo } from '@varve/platform';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetPlatformCapabilities } from '../canvas/adaptiveProfile';
import { _resetOffscreenCapability } from '../render/offscreenCapabilityProbe';
import { collectCapabilityReport, serializeCapabilityReport } from './capabilityReport';

function setNavigatorValue(name: string, value: unknown): void {
  Object.defineProperty(navigator, name, { configurable: true, value });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'gpu');
  Reflect.deleteProperty(navigator, 'storage');
  _resetPlatformCapabilities();
  _resetOffscreenCapability();
  resetPlatformInfo();
  vi.restoreAllMocks();
});

describe('capability report', () => {
  it('returns a bounded local snapshot without user-agent or document data', async () => {
    const report = await collectCapabilityReport();
    const serialized = serializeCapabilityReport(report);

    expect(report.schemaVersion).toBe(1);
    expect(report.files.fileInputFallback).toBe(true);
    expect(report.storage.indexedDbPresent).toBe(true);
    expect(report).not.toHaveProperty('userAgent');
    expect(report).not.toHaveProperty('document');
    expect(serialized).not.toContain(navigator.userAgent);
    expect(serialized).not.toContain('Varve Demo');
  });

  it('probes WebGPU dynamically, captures an allowlist, and destroys the device', async () => {
    const destroy = vi.fn();
    const requestDevice = vi.fn().mockResolvedValue({ destroy });
    const requestAdapter = vi.fn().mockResolvedValue({
      limits: {
        maxTextureDimension2D: 8192,
        maxBufferSize: 123456,
        vendor: 'must-not-be-reported',
      },
      requestDevice,
    });
    setNavigatorValue('gpu', { requestAdapter });

    const report = await collectCapabilityReport();

    expect(report.graphics.webgpu.status).toBe('supported');
    expect(report.graphics.webgpu.limits).toEqual({
      maxTextureDimension2D: 8192,
      maxBufferSize: 123456,
    });
    expect(report.graphics.webgpu.limits).not.toHaveProperty('vendor');
    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: 'low-power' });
    expect(requestDevice).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(report.graphics.webgpu.deviceDestroyed).toBe(true);
  });

  it('turns rejected probes into status values and never requests persistence', async () => {
    const persist = vi.fn();
    setNavigatorValue('gpu', {
      requestAdapter: vi.fn().mockRejectedValue(new Error('adapter unavailable')),
    });
    setNavigatorValue('storage', {
      estimate: vi.fn().mockRejectedValue(new Error('quota unavailable')),
      persisted: vi.fn().mockRejectedValue(new Error('permission unavailable')),
      persist,
    });

    const report = await collectCapabilityReport();

    expect(report.graphics.webgpu.status).toBe('failed');
    expect(report.storage.estimateStatus).toBe('failed');
    expect(report.storage.persistedStatus).toBe('failed');
    expect(persist).not.toHaveBeenCalled();
  });
});
