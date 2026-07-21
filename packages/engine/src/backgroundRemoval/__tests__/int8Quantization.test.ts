/**
 * Tests for INT8 quantization support: precision-aware model resolution,
 * manifest schema, and capability detection.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUALITY_PREFERENCE,
  fp32SourceId,
  int8VariantId,
  resolveModelIdForPreference,
} from '../types';

describe('int8VariantId', () => {
  it('returns INT8 variant for models with one', () => {
    expect(int8VariantId('u2netp')).toBe('u2netp-int8');
  });

  it('returns null for models without INT8 variant', () => {
    expect(int8VariantId('isnet-general-use')).toBeNull();
    expect(int8VariantId('birefnet-general-lite')).toBeNull();
    expect(int8VariantId('birefnet-general')).toBeNull();
  });
});

describe('fp32SourceId', () => {
  it('maps INT8 variant back to FP32 source', () => {
    expect(fp32SourceId('u2netp-int8')).toBe('u2netp');
  });

  it('returns identity for FP32 models', () => {
    expect(fp32SourceId('u2netp')).toBe('u2netp');
    expect(fp32SourceId('isnet-general-use')).toBe('isnet-general-use');
  });
});

describe('resolveModelIdForPreference', () => {
  it('returns null for quick mode', () => {
    expect(resolveModelIdForPreference('quick', 'automatic')).toBeNull();
  });

  it('returns INT8 for performance preference when available', () => {
    expect(resolveModelIdForPreference('ai-balanced', 'performance')).toBe('u2netp-int8');
  });

  it('returns FP32 for quality preference even when INT8 available', () => {
    expect(resolveModelIdForPreference('ai-balanced', 'quality')).toBe('u2netp');
  });

  it('returns FP32 for automatic preference (conservative default)', () => {
    expect(resolveModelIdForPreference('ai-balanced', 'automatic')).toBe('u2netp');
  });

  it('returns FP32 for models without INT8 variant regardless of preference', () => {
    expect(resolveModelIdForPreference('ai-quality', 'performance')).toBe('birefnet-general-lite');
    expect(resolveModelIdForPreference('ai-quality', 'quality')).toBe('birefnet-general-lite');
  });

  it('uses default preference when not specified', () => {
    expect(DEFAULT_QUALITY_PREFERENCE).toBe('automatic');
  });
});
