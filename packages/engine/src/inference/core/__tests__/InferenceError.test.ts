import { describe, expect, it } from 'vitest';
import { InferenceError, isInferenceError, toUserMessage } from '../InferenceError';

describe('InferenceError', () => {
  it('creates error with correct code and user message', () => {
    const err = new InferenceError('model_not_installed');
    expect(err.code).toBe('model_not_installed');
    expect(err.userMessage).toContain('not been downloaded');
    expect(err.retrySafe).toBe(true);
    expect(err.fallbackAvailable).toBe(true);
  });

  it('includes technical details for runtime errors', () => {
    const err = new InferenceError('runtime_unavailable');
    expect(err.technical).toContain('onnxruntime-web');
    expect(err.retrySafe).toBe(false);
  });

  it('accepts overrides for user message', () => {
    const err = new InferenceError('model_not_installed', undefined, {
      userMessage: 'Custom user message',
    });
    expect(err.userMessage).toBe('Custom user message');
  });

  it('wraps cause error', () => {
    const cause = new Error('Network failure');
    const err = new InferenceError('model_download_failed', cause);
    expect(err.cause).toBe(cause);
  });

  it('serializes to JSON', () => {
    const err = new InferenceError('checksum_mismatch');
    const json = err.toJSON();
    expect(json.code).toBe('checksum_mismatch');
    expect(json.retrySafe).toBe(true);
  });

  it('handles unknown code', () => {
    const err = new InferenceError('unknown' as never);
    expect(err.code).toBe('unknown');
    expect(err.userMessage).toBeTruthy();
  });
});

describe('isInferenceError', () => {
  it('identifies InferenceError instances', () => {
    expect(isInferenceError(new InferenceError('inference_cancelled'))).toBe(true);
    expect(isInferenceError(new Error('generic'))).toBe(false);
    expect(isInferenceError('string error')).toBe(false);
    expect(isInferenceError(null)).toBe(false);
  });
});

describe('toUserMessage', () => {
  it('maps InferenceError to user message', () => {
    const err = new InferenceError('out_of_memory');
    expect(toUserMessage(err)).toContain('memory');
  });

  it('maps cancellation messages', () => {
    expect(toUserMessage(new Error('aborted'))).toContain('cancel');
    expect(toUserMessage(new Error('cancelled'))).toContain('cancel');
  });

  it('maps generic errors', () => {
    expect(toUserMessage(new Error('something broke'))).toContain('went wrong');
  });

  it('handles non-Error values', () => {
    expect(toUserMessage('raw string')).toBeTruthy();
    expect(toUserMessage(null)).toBeTruthy();
  });
});
