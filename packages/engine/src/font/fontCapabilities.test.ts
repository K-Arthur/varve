import { describe, expect, it } from 'vitest';
import {
  diagnoseFontCapabilities,
  type FontCapabilityState,
  unknownFontCapabilities,
} from './fontCapabilities';

function readyState(overrides: Partial<FontCapabilityState> = {}): FontCapabilityState {
  return {
    catalog: 'present',
    storedBytes: 'available',
    validatedFace: 'available',
    mainThread: 'ready',
    worker: 'adopted',
    shaping: 'supported',
    export: 'supported',
    network: 'online',
    permissions: {
      localAccess: 'allowed',
      embedding: 'allowed',
      redistribution: 'allowed',
    },
    ...overrides,
  };
}

describe('font capability diagnostics', () => {
  it('keeps a missing family distinct from a missing face', () => {
    expect(diagnoseFontCapabilities({ ...readyState(), catalog: 'missing' }).outcome).toBe(
      'missing-family',
    );
    expect(diagnoseFontCapabilities({ ...readyState(), validatedFace: 'missing' }).outcome).toBe(
      'missing-face',
    );
  });

  it('prioritizes corrupt and unsupported bytes before network state', () => {
    expect(
      diagnoseFontCapabilities({
        ...readyState(),
        storedBytes: 'corrupt',
        network: 'offline',
      }),
    ).toMatchObject({ outcome: 'corrupt', nextAction: 'repair-file' });
    expect(
      diagnoseFontCapabilities({
        ...readyState(),
        validatedFace: 'unsupported',
        network: 'offline',
      }).outcome,
    ).toBe('unsupported');
  });

  it('reports permission, offline, restricted, and loading actions', () => {
    expect(
      diagnoseFontCapabilities({
        ...readyState(),
        permissions: { ...readyState().permissions, localAccess: 'denied' },
      }),
    ).toMatchObject({ outcome: 'permission-denied', nextAction: 'allow-local-fonts' });
    expect(
      diagnoseFontCapabilities({
        ...readyState(),
        storedBytes: 'missing',
        validatedFace: 'unknown',
        network: 'offline',
      }).outcome,
    ).toBe('offline');
    expect(diagnoseFontCapabilities({ ...readyState(), export: 'restricted' }).outcome).toBe(
      'restricted',
    );
    expect(diagnoseFontCapabilities({ ...readyState(), mainThread: 'pending' }).outcome).toBe(
      'loading',
    );
  });

  it('uses a conservative unknown projection for unvalidated metadata', () => {
    expect(diagnoseFontCapabilities(unknownFontCapabilities())).toMatchObject({
      outcome: 'error',
      nextAction: 'use-main-thread',
    });
  });
});
