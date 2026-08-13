import { describe, expect, it } from 'vitest';
import {
  capabilitiesForTask,
  firstAvailableCapability,
  planRestoration,
  RestorationPlanningError,
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

  it('rejects unsupported deblur instead of falling back to an unrelated model', () => {
    expect(() => planRestoration({ operation: 'deblur' })).toThrowError(RestorationPlanningError);
    expect(() => planRestoration({ operation: 'deblur' })).toThrow(/not available/i);
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
});
