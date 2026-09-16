import { describe, expect, it } from 'vitest';
import { classifyDiscoveryFailure } from './textDiscoveryFailure';

/**
 * The discovery panel must not collapse every failure into one message:
 * a memory refusal is retryable-by-policy, a timeout is a device limit, and a
 * cancellation is not an error at all.
 */
describe('classifyDiscoveryFailure', () => {
  const base = { aborted: false, timedOut: false, deadlineMinutes: 8 };

  it('prefers the timeout copy over an aborted signal', () => {
    const result = classifyDiscoveryFailure({
      ...base,
      aborted: true,
      timedOut: true,
      message: 'cancelled',
    });
    expect(result.kind).toBe('timeout');
    expect(result.message).toContain('8 minutes');
    expect(result.message).toMatch(/point or box Object Selection/i);
  });

  it('treats a cancellation as a non-error', () => {
    const result = classifyDiscoveryFailure({ ...base, aborted: true });
    expect(result.kind).toBe('cancelled');
    expect(result.message).toBe('');
  });

  it('reports a WASM admission refusal with the budget detail intact', () => {
    const result = classifyDiscoveryFailure({
      ...base,
      message:
        'Model exceeds safe WASM memory limit. Needs about 2.6 GB, more than this session\u2019s 1.2 GB budget. The budget is raised by cross-origin isolation, which this page does not have.',
    });
    expect(result.kind).toBe('refused');
    expect(result.message).toContain('2.6 GB');
    expect(result.message).toMatch(/cross-origin isolation/i);
    // The internal error-code prefix must not reach the user.
    expect(result.message).not.toContain('safe WASM memory limit');
  });

  it('maps admission and allocator codes to the short refusal message', () => {
    for (const message of [
      'insufficient-memory: cannot reserve 2600000000 bytes',
      'out_of_memory',
      'RuntimeError: memory allocation failed',
    ]) {
      const result = classifyDiscoveryFailure({ ...base, message });
      expect(result.kind).toBe('refused');
      expect(result.message).toMatch(/point or box Object Selection/i);
    }
  });

  it('keeps a genuine inference failure distinguishable from a refusal', () => {
    const result = classifyDiscoveryFailure({
      ...base,
      message: 'The detection model returned no boxes.',
    });
    expect(result.kind).toBe('failed');
    expect(result.message).toContain('The detection model returned no boxes.');
  });
});
