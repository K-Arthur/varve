import { describe, expect, it } from 'vitest';
import {
  isVerifiedForAutomaticRouting,
  matrixIntegrityProblems,
  platformCellsFor,
  platformEvidenceFor,
} from './platformEvidence';

describe('platform evidence matrix', () => {
  it('is internally consistent: verified cells cite evidence, unsupported cells explain', () => {
    expect(matrixIntegrityProblems()).toEqual([]);
  });

  it('keeps unexecuted configurations explicitly unverified', () => {
    const threaded = platformEvidenceFor('grounding-dino:wasm-threaded');
    expect(threaded?.status).toBe('unverified');
    expect(threaded?.reason).toContain('numThreads');

    const webgpuDino = platformEvidenceFor('grounding-dino:webgpu');
    expect(webgpuDino?.status).toBe('unsupported');
    expect(webgpuDino?.reason).toContain('int64');

    const sam2Gpu = platformEvidenceFor('sam2-hiera-tiny:webgpu');
    expect(sam2Gpu?.status).toBe('unverified');
    expect(sam2Gpu?.reason).toContain('no run');
  });

  it('does not allow automatic routing from an unverified cell', () => {
    expect(isVerifiedForAutomaticRouting('grounding-dino-tiny-int8', 'webgpu')).toBe(false);
    expect(isVerifiedForAutomaticRouting('grounding-dino-tiny-int8', 'wasm-threaded')).toBe(false);
    expect(isVerifiedForAutomaticRouting('sam2-hiera-tiny', 'webgpu')).toBe(false);
    expect(isVerifiedForAutomaticRouting('grounding-dino-tiny-int8', 'wasm-single-thread')).toBe(
      true,
    );
  });

  it('keeps MobileSAM on its declared WASM runtime only', () => {
    const cells = platformCellsFor('mobile-sam');
    expect(cells.find((cell) => cell.runtime === 'webgpu')?.status).toBe('unsupported');
    expect(cells.find((cell) => cell.runtime === 'node-cpu')?.status).toBe('verified');
  });
});
