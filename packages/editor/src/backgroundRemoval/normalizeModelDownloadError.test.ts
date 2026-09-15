import { describe, expect, it } from 'vitest';
import { normalizeModelDownloadError } from './normalizeModelDownloadError';

describe('normalizeModelDownloadError', () => {
  it('maps a plain string rejection (Tauri Err(String)) to a useful message', () => {
    const n = normalizeModelDownloadError('permission denied');
    expect(n.userMessage.length).toBeGreaterThan(0);
    expect(n.detail.length).toBeGreaterThan(0);
    expect(n.category).toBe('permission');
    expect(n.retryable).toBe(false);
  });

  it('never produces an empty userMessage for any input shape', () => {
    const inputs: unknown[] = [
      undefined,
      null,
      '',
      'Native ONNX Runtime is unavailable on this desktop build',
      new Error('Model isnet-general-use failed SHA-256 verification'),
      { code: 'command_error', message: 'Model download failed: connection refused' },
      { error: 'timed out' },
      new DOMException('aborted', 'AbortError'),
      { strange: true },
      42,
    ];
    for (const input of inputs) {
      const n = normalizeModelDownloadError(input);
      expect(n.userMessage.trim().length, JSON.stringify(input)).toBeGreaterThan(0);
      expect(n.detail.trim().length).toBeGreaterThan(0);
      expect(n.technicalMessage.length).toBeGreaterThan(0);
    }
  });

  it('classifies native-runtime unavailability as non-retryable', () => {
    const n = normalizeModelDownloadError(
      'Native ONNX Runtime is unavailable on this desktop build',
    );
    expect(n.category).toBe('native-unavailable');
    expect(n.retryable).toBe(false);
  });

  it('classifies checksum/integrity failures as non-retryable', () => {
    const n = normalizeModelDownloadError('Model isnet-general-use failed SHA-256 verification');
    expect(n.category).toBe('integrity');
    expect(n.retryable).toBe(false);
  });

  it('classifies size mismatches as integrity failures', () => {
    const n = normalizeModelDownloadError(
      'Model size mismatch: expected 4700000 bytes, received 4574861',
    );
    expect(n.category).toBe('integrity');
  });

  it('classifies network failures as retryable', () => {
    const n = normalizeModelDownloadError('Model download failed: connection refused');
    expect(n.category).toBe('network');
    expect(n.retryable).toBe(true);
  });

  it('classifies quota errors as storage', () => {
    const n = normalizeModelDownloadError(
      new Error(
        'Storage quota exceeded. Free disk space or delete old models in Settings, Offline Models.',
      ),
    );
    expect(n.category).toBe('storage');
  });

  it('classifies cancellation as non-retryable without a failure message', () => {
    const n = normalizeModelDownloadError('Download cancelled');
    expect(n.category).toBe('cancelled');
    expect(n.retryable).toBe(false);
  });

  it('classifies AbortError as cancellation', () => {
    const n = normalizeModelDownloadError(new DOMException('aborted', 'AbortError'));
    expect(n.category).toBe('cancelled');
  });
});
