import { describe, expect, it } from 'vitest';
import {
  capabilitiesForTask,
  estimateRestorationMemory,
  firstAvailableCapability,
  isRestorationErrorCode,
  isRestorationOperationAvailable,
  planRestoration,
  RestorationError,
  RestorationPlanningError,
  restorationTasksForOperation,
  toRestorationError,
} from './restoration';

describe('restoration capability planning', () => {
  it('keeps denoise and upscale as separate task capabilities', () => {
    expect(firstAvailableCapability('denoise')?.id).toBe('scunet');
    expect(firstAvailableCapability('upscale')?.id).toBe('upscale-realesr-general');
    expect(
      capabilitiesForTask('denoise').every((capability) => capability.task === 'denoise'),
    ).toBe(true);
  });

  it('plans restore then upscale without loading either model', () => {
    const plan = planRestoration({
      operation: 'restore-upscale',
      denoise: { strength: 'medium' },
      upscale: { method: 'bicubic', scale: 2 },
    });

    expect(plan.stages.map((stage) => stage.task)).toEqual(['denoise', 'upscale']);
    expect(plan.stages[0]?.modelId).toBe('scunet');
    expect(plan.stages[1]?.modelId).toBeUndefined();
    expect(plan.warnings).toHaveLength(1);
  });

  it('treats explicit denoise None as a no-op without loading SCUNet', () => {
    const plan = planRestoration({ operation: 'denoise', denoise: { strength: 'none' } });
    expect(plan.stages).toEqual([]);
    expect(plan.warnings).toEqual(['Denoise skipped because its strength is set to None.']);
  });

  it('estimates source, model, intermediate, and final allocations', () => {
    const estimate = estimateRestorationMemory(
      {
        operation: 'upscale',
        upscale: { method: 'ai', modelId: 'upscale-realesr-general', scale: 2 },
      },
      100,
      80,
    );

    expect(estimate.outputWidth).toBe(200);
    expect(estimate.outputHeight).toBe(160);
    expect(estimate.sourceBytes).toBe(100 * 80 * 4);
    expect(estimate.outputBytes).toBe(200 * 160 * 4);
    expect(estimate.modelBytes).toBe(17_032_533);
    expect(estimate.stagingBytes).toBe(200 * 160 * 4);
    expect(estimate.peakBytes).toBeGreaterThan(
      estimate.sourceBytes + estimate.outputBytes + estimate.modelBytes,
    );
    expect(estimate.warnings[0]).toMatch(/4x inference.*final resize/i);
  });

  it('rejects unsupported operations instead of falling back to an unrelated model', () => {
    // Compression restoration has no validated model yet.
    expect(() => planRestoration({ operation: 'compression-restoration' })).toThrowError(
      RestorationPlanningError,
    );
    expect(() => planRestoration({ operation: 'compression-restoration' })).toThrow(
      /not available/i,
    );
    // Deblur now plans through the validated checkpoint.
    const plan = planRestoration({ operation: 'deblur' });
    expect(plan.stages.map((stage) => stage.task)).toEqual(['deblur']);
    expect(plan.stages[0]?.modelId).toBe('nafnet-deblur-gopro');
  });

  it('allows no-op plans without requiring a model', () => {
    expect(planRestoration({ operation: 'none' })).toEqual({
      operation: 'none',
      stages: [],
      warnings: [],
    });
  });

  it('validates upscale settings before execution', () => {
    expect(() => planRestoration({ operation: 'upscale' })).toThrow(/settings are required/i);
    expect(() =>
      planRestoration({ operation: 'upscale', upscale: { method: 'bicubic', scale: 0 } }),
    ).toThrow(/scale must be positive/i);
  });

  it('rejects invalid deblur strength before provider dispatch', () => {
    expect(() =>
      planRestoration({ operation: 'deblur', deblur: { strength: Number.NaN } }),
    ).toThrow(/strength must be a finite number/i);
    expect(() =>
      planRestoration({
        operation: 'deblur-upscale',
        deblur: { strength: 1.1 },
        upscale: { method: 'bicubic', scale: 2 },
      }),
    ).toThrow(/strength must be a finite number/i);
  });

  it('derives operation availability from the capability registry', () => {
    expect(isRestorationOperationAvailable('denoise')).toBe(true);
    expect(isRestorationOperationAvailable('upscale')).toBe(true);
    expect(isRestorationOperationAvailable('restore-upscale')).toBe(true);
    // Deblur has a validated checkpoint, so the operation is available.
    expect(isRestorationOperationAvailable('deblur')).toBe(true);
    // Compression restoration still has no validated task-specific model.
    expect(isRestorationOperationAvailable('compression-restoration')).toBe(false);
    expect(isRestorationOperationAvailable('none')).toBe(true);
  });

  it('never advertises a model for a task it was not validated for', () => {
    expect(firstAvailableCapability('deblur')?.id).toBe('nafnet-deblur-gopro');
    // The deblur checkpoint must not leak into the denoise registry and the
    // denoise checkpoint must not leak into deblur.
    expect(capabilitiesForTask('denoise').map((c) => c.id)).not.toContain('nafnet-deblur-gopro');
    expect(capabilitiesForTask('deblur').map((c) => c.id)).not.toContain('scunet');
  });

  it('maps an operation to exactly the tasks it needs', () => {
    expect(restorationTasksForOperation('restore-upscale')).toEqual(['denoise', 'upscale']);
    expect(restorationTasksForOperation('denoise')).toEqual(['denoise']);
    expect(restorationTasksForOperation('none')).toEqual([]);
  });

  it('plans deblur + upscale as a composition of distinct stages', () => {
    const plan = planRestoration({
      operation: 'deblur-upscale',
      upscale: { method: 'bicubic', scale: 2 },
    });
    expect(plan.stages.map((stage) => stage.task)).toEqual(['deblur', 'upscale']);
    expect(plan.stages[0]?.modelId).toBe('nafnet-deblur-gopro');
    expect(isRestorationOperationAvailable('deblur-upscale')).toBe(true);
  });

  it('classifies thrown values into typed restoration errors', () => {
    expect(toRestorationError(new Error('cancelled'))).toMatchObject({ code: 'cancelled' });
    expect(toRestorationError('Inference cancelled')).toMatchObject({ code: 'cancelled' });
    expect(
      toRestorationError(new RestorationPlanningError('invalid-request', 'bad request')),
    ).toMatchObject({
      code: 'invalid-request',
    });
    expect(toRestorationError('Model not downloaded. Download first.')).toMatchObject({
      code: 'model-not-installed',
    });
    expect(toRestorationError('checksum verification failed')).toMatchObject({
      code: 'hash-mismatch',
    });
    expect(toRestorationError('Image dimension exceeds 16384px')).toMatchObject({
      code: 'dimension-limit',
    });
    expect(toRestorationError('failed to allocate tensor memory')).toMatchObject({
      code: 'tensor-allocation',
    });
    expect(toRestorationError('Unknown backend failure')).toMatchObject({
      code: 'provider-failed',
    });
    expect(toRestorationError('a string')).toBeInstanceOf(RestorationError);
    expect(isRestorationErrorCode('cancelled')).toBe(true);
    expect(isRestorationErrorCode('not-a-code')).toBe(false);
  });
});
