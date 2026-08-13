import { describe, expect, it, vi } from 'vitest';
import { VisionService, type VisionServiceError } from './service';
import type { VisionBackend, VisionOutputMap, VisionRequest } from './types';

function request(
  capabilities: VisionRequest['capabilities'],
  priority: VisionRequest['priority'] = 'INTERACTIVE',
): VisionRequest {
  return {
    source: { assetId: 'asset-1', sourceRevision: 3, width: 1000, height: 800 },
    capabilities,
    quality: 'preview',
    priority,
    consumer: 'test',
  };
}

function backend(overrides: Partial<VisionBackend> = {}): VisionBackend {
  return {
    id: 'face-test',
    version: '1',
    capabilities: ['FACE_BOUNDS'],
    estimatedResidentBytes: 10,
    supports: (caps) => caps.every((cap) => cap === 'FACE_BOUNDS'),
    run: vi.fn(
      async (): Promise<VisionOutputMap> => ({
        FACE_BOUNDS: { kind: 'FACE_BOUNDS', faces: [] },
      }),
    ),
    ...overrides,
  };
}

describe('VisionService', () => {
  it('coalesces identical requests and caches each capability', async () => {
    const run = vi.fn(async () => ({ FACE_BOUNDS: { kind: 'FACE_BOUNDS' as const, faces: [] } }));
    const service = new VisionService({ backends: [backend({ run })] });
    const [first, second] = await Promise.all([
      service.request(request(['FACE_BOUNDS'])),
      service.request(request(['FACE_BOUNDS'])),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(first.FACE_BOUNDS).toBe(second.FACE_BOUNDS);
    await service.request(request(['FACE_BOUNDS']));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('prefers one backend that can satisfy a multi-capability request', async () => {
    const combined = backend({
      id: 'combined',
      capabilities: ['FACE_BOUNDS', 'FACE_KEYPOINTS'],
      supports: (caps) => caps.every((cap) => cap === 'FACE_BOUNDS' || cap === 'FACE_KEYPOINTS'),
      run: vi.fn(async () => ({
        FACE_BOUNDS: { kind: 'FACE_BOUNDS' as const, faces: [] },
        FACE_KEYPOINTS: { kind: 'FACE_KEYPOINTS' as const, faces: [] },
      })),
    });
    const detector = backend({
      id: 'detector',
      run: vi.fn(async () => ({ FACE_BOUNDS: { kind: 'FACE_BOUNDS' as const, faces: [] } })),
    });
    const service = new VisionService({ backends: [detector, combined] });
    await service.request(request(['FACE_BOUNDS', 'FACE_KEYPOINTS']));
    expect(combined.run).toHaveBeenCalledTimes(1);
    expect(detector.run).not.toHaveBeenCalled();
  });

  it('does not run unsupported capabilities', async () => {
    const service = new VisionService({ backends: [backend()] });
    await expect(service.request(request(['PERSON_MASK']))).rejects.toMatchObject({
      code: 'VISION_UNSUPPORTED',
    } satisfies Partial<VisionServiceError>);
  });

  it('rejects work that exceeds the resident memory budget', async () => {
    const service = new VisionService({
      backends: [backend({ estimatedResidentBytes: 11 })],
      residentMemoryBudgetBytes: 10,
    });
    await expect(service.request(request(['FACE_BOUNDS']))).rejects.toMatchObject({
      code: 'VISION_OUT_OF_MEMORY',
    });
  });
});
