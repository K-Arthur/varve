/**
 * Session protocol tests (ADR-0207).
 *
 * Tests envelope validation, sequence tracking, and protocol correctness.
 */

import { describe, expect, it } from 'vitest';
import {
  createEnvelope,
  PROTOCOL_VERSION,
  resetSequenceCounter,
  SequenceTracker,
  validateEnvelope,
} from '../sessionProtocol';

describe('sessionProtocol: envelope validation', () => {
  it('rejects non-object input', () => {
    expect(validateEnvelope(null)).toHaveLength(1);
    expect(validateEnvelope('string')).toHaveLength(1);
  });

  it('rejects wrong protocol version', () => {
    const env = createEnvelope('s1', 'w1', 'e1', { kind: 'heartbeat', windowId: 'w1' });
    const wrong = { ...env, protocolVersion: 999 };
    const errors = validateEnvelope(wrong);
    expect(errors.some((e) => e.field === 'protocolVersion')).toBe(true);
  });

  it('rejects missing sessionId', () => {
    const env = createEnvelope('s1', 'w1', 'e1', { kind: 'heartbeat', windowId: 'w1' });
    const broken = { ...env, sessionId: '' };
    expect(validateEnvelope(broken).some((e) => e.field === 'sessionId')).toBe(true);
  });

  it('rejects missing senderWindowId', () => {
    const env = createEnvelope('s1', 'w1', 'e1', { kind: 'heartbeat', windowId: 'w1' });
    const broken = { ...env, senderWindowId: '' };
    expect(validateEnvelope(broken).some((e) => e.field === 'senderWindowId')).toBe(true);
  });

  it('rejects negative sequence', () => {
    const env = createEnvelope('s1', 'w1', 'e1', { kind: 'heartbeat', windowId: 'w1' });
    const broken = { ...env, sequence: -1 };
    expect(validateEnvelope(broken).some((e) => e.field === 'sequence')).toBe(true);
  });

  it('rejects null payload', () => {
    const env = createEnvelope('s1', 'w1', 'e1', { kind: 'heartbeat', windowId: 'w1' });
    const broken = { ...env, payload: null };
    expect(validateEnvelope(broken).some((e) => e.field === 'payload')).toBe(true);
  });

  it('accepts a valid envelope', () => {
    const env = createEnvelope('s1', 'w1', 'e1', { kind: 'heartbeat', windowId: 'w1' });
    expect(validateEnvelope(env)).toEqual([]);
  });
});

describe('sessionProtocol: envelope creation', () => {
  it('sets protocol version correctly', () => {
    const env = createEnvelope('s1', 'w1', 'e1', { kind: 'heartbeat', windowId: 'w1' });
    expect(env.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('increments sequence numbers', () => {
    resetSequenceCounter();
    const a = createEnvelope('s1', 'w1', 'e1', { kind: 'heartbeat', windowId: 'w1' });
    const b = createEnvelope('s1', 'w1', 'e2', { kind: 'heartbeat', windowId: 'w1' });
    expect(b.sequence).toBe(a.sequence + 1);
  });

  it('includes target when provided', () => {
    const env = createEnvelope(
      's1',
      'w1',
      'e1',
      { kind: 'heartbeat', windowId: 'w1' },
      { target: 'w2' },
    );
    expect(env.target).toBe('w2');
  });
});

describe('sessionProtocol: SequenceTracker', () => {
  it('accepts in-order sequences', () => {
    const tracker = new SequenceTracker();
    expect(tracker.isCurrent(0)).toBe(true);
    tracker.accept(0);
    expect(tracker.isCurrent(1)).toBe(true);
    tracker.accept(1);
  });

  it('rejects duplicate sequences', () => {
    const tracker = new SequenceTracker();
    tracker.accept(5);
    expect(tracker.isDuplicate(3)).toBe(true);
    expect(tracker.isDuplicate(5)).toBe(true);
    expect(tracker.isDuplicate(6)).toBe(false);
  });

  it('resets correctly', () => {
    const tracker = new SequenceTracker();
    tracker.accept(10);
    tracker.reset();
    expect(tracker.getLastSequence()).toBe(-1);
    expect(tracker.isCurrent(0)).toBe(true);
  });
});
