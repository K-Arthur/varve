import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetRuntimeMemorySample,
  _setRuntimeMemorySampleForTesting,
  readRuntimeMemorySample,
  resolveMeasuredMemoryPressure,
} from './memoryPressure';

afterEach(() => _resetRuntimeMemorySample());

describe('measured memory pressure', () => {
  it('classifies heap headroom into bounded pressure levels', () => {
    _setRuntimeMemorySampleForTesting({ usedHeapBytes: 50, heapLimitBytes: 100, observedAt: 0 });
    expect(resolveMeasuredMemoryPressure(1)).toBe('normal');
    _setRuntimeMemorySampleForTesting({ usedHeapBytes: 60, heapLimitBytes: 100, observedAt: 0 });
    expect(resolveMeasuredMemoryPressure(1)).toBe('elevated');
    _setRuntimeMemorySampleForTesting({ usedHeapBytes: 80, heapLimitBytes: 100, observedAt: 0 });
    expect(resolveMeasuredMemoryPressure(1)).toBe('high');
    _setRuntimeMemorySampleForTesting({ usedHeapBytes: 95, heapLimitBytes: 100, observedAt: 0 });
    expect(resolveMeasuredMemoryPressure(1)).toBe('critical');
  });

  it('throttles optional browser reads and degrades to normal when unavailable', () => {
    _setRuntimeMemorySampleForTesting({ usedHeapBytes: 80, heapLimitBytes: 100, observedAt: 100 });
    expect(readRuntimeMemorySample(101)?.observedAt).toBe(100);
    _resetRuntimeMemorySample();
    expect(resolveMeasuredMemoryPressure(1)).toBe('normal');
  });
});
