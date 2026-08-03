import { describe, expect, it } from 'vitest';
import { FrameLedger, type FrameState } from './frameLifecycle';

const BYTES = 1024;

/** Drive a frame all the way to installed, the common presented path. */
function installFrame(ledger: FrameLedger, bytes = BYTES): number {
  const id = ledger.allocate(bytes);
  ledger.transition(id, 'transferred');
  ledger.transition(id, 'received');
  ledger.transition(id, 'installed');
  return id;
}

describe('FrameLedger — normal paths', () => {
  it('accounts a presented frame exactly once and releases it on close', () => {
    const ledger = new FrameLedger();
    const id = installFrame(ledger);
    expect(ledger.state.residentBytes).toBe(BYTES);
    expect(ledger.state.installed).toBe(1);
    ledger.close(id);
    expect(ledger.state.closed).toBe(1);
    expect(ledger.reconciles()).toBe(true);
  });

  it('releases the prior resident frame exactly once on replacement', () => {
    const ledger = new FrameLedger();
    const first = installFrame(ledger);
    const second = installFrame(ledger);
    expect(ledger.state.residentBytes).toBe(BYTES * 2);
    ledger.transition(first, 'replaced');
    ledger.close(first);
    expect(ledger.state.replaced).toBe(1);
    expect(ledger.state.residentBytes).toBe(BYTES);
    ledger.close(second);
    expect(ledger.reconciles()).toBe(true);
  });

  it('disposes a stale frame without ever counting it as resident', () => {
    const ledger = new FrameLedger();
    const id = ledger.allocate(BYTES);
    ledger.transition(id, 'transferred');
    ledger.transition(id, 'stale');
    ledger.close(id);
    expect(ledger.state.stale).toBe(1);
    expect(ledger.state.presented).toBe(0);
    expect(ledger.reconciles()).toBe(true);
  });
});

describe('FrameLedger — failure paths', () => {
  it('makes duplicate closes idempotent and observable', () => {
    const ledger = new FrameLedger();
    const id = installFrame(ledger);
    expect(ledger.close(id)).toBe(true);
    expect(ledger.close(id)).toBe(false);
    expect(ledger.close(id)).toBe(false);
    expect(ledger.state.closed).toBe(1);
    expect(ledger.state.duplicateCloseAttempts).toBe(2);
    expect(ledger.state.residentBytes).toBe(0);
  });

  it('refuses to resurrect a disposed frame', () => {
    const ledger = new FrameLedger();
    const id = installFrame(ledger);
    ledger.close(id);
    expect(ledger.transition(id, 'installed')).toBe(false);
    expect(ledger.state.installed).toBe(1);
    expect(ledger.state.residentBytes).toBe(0);
    expect(ledger.state.invalidTransitions).toBe(1);
  });

  it('refuses a stale response that would walk an installed frame backwards', () => {
    const ledger = new FrameLedger();
    const id = installFrame(ledger);
    // A late worker response for an already-installed frame must not be able
    // to mark it stale and release accounting a second time.
    expect(ledger.transition(id, 'stale')).toBe(false);
    expect(ledger.state.stale).toBe(0);
    expect(ledger.state.residentBytes).toBe(BYTES);
  });

  it('releases everything exactly once on context loss', () => {
    const ledger = new FrameLedger();
    installFrame(ledger);
    const inFlight = ledger.allocate(BYTES);
    ledger.transition(inFlight, 'transferred');
    expect(ledger.liveCount).toBe(2);
    expect(ledger.reclaimAll('context-lost')).toBe(2);
    expect(ledger.state.orphanRecoveries).toBe(2);
    expect(ledger.reconciles()).toBe(true);
  });

  it('reconciles to zero after teardown and leaves no orphaned accounting', () => {
    const ledger = new FrameLedger();
    installFrame(ledger);
    installFrame(ledger, 4096);
    ledger.reclaimAll('teardown');
    expect(ledger.state.residentBytes).toBe(0);
    expect(ledger.liveCount).toBe(0);
    expect(ledger.reconciles()).toBe(true);
  });

  it('prevents a pre-teardown id from matching a post-teardown frame', () => {
    const ledger = new FrameLedger();
    const before = installFrame(ledger);
    ledger.reclaimAll('teardown');
    const after = installFrame(ledger);
    expect(after).not.toBe(before);
    // The late close targets a retired id and must not touch the new frame.
    expect(ledger.close(before)).toBe(false);
    expect(ledger.state.residentBytes).toBe(BYTES);
    expect(ledger.stateOf(after)).toBe('installed');
  });

  it('keeps resident bytes non-negative under repeated releases', () => {
    const ledger = new FrameLedger();
    const id = installFrame(ledger);
    for (let i = 0; i < 20; i++) ledger.close(id);
    expect(ledger.state.residentBytes).toBe(0);
    expect(ledger.state.residentBytes).toBeGreaterThanOrEqual(0);
  });

  it('records a peak that survives the frames that produced it', () => {
    const ledger = new FrameLedger();
    const a = installFrame(ledger);
    const b = installFrame(ledger);
    ledger.close(a);
    ledger.close(b);
    expect(ledger.state.peakResidentBytes).toBe(BYTES * 2);
    expect(ledger.state.residentBytes).toBe(0);
  });
});

describe('FrameLedger — randomized lifecycle sequences', () => {
  const STATES: FrameState[] = [
    'allocated',
    'transferred',
    'received',
    'installed',
    'replaced',
    'stale',
    'context-lost',
    'disposed',
  ];

  /**
   * Drive the ledger with arbitrary (mostly invalid) transitions and assert
   * the invariants hold regardless of the sequence. A deterministic
   * pseudo-random generator keeps failures reproducible.
   */
  it('holds its invariants under arbitrary transition sequences', () => {
    let seed = 0x5eed;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let trial = 0; trial < 200; trial++) {
      const ledger = new FrameLedger();
      const ids: number[] = [];
      for (let step = 0; step < 40; step++) {
        const roll = random();
        if (roll < 0.25 || ids.length === 0) {
          ids.push(ledger.allocate(Math.floor(random() * 4096)));
        } else if (roll < 0.9) {
          const id = ids[Math.floor(random() * ids.length)] ?? 0;
          ledger.transition(id, STATES[Math.floor(random() * STATES.length)] ?? 'disposed');
        } else {
          ledger.reclaimAll(random() < 0.5 ? 'context-lost' : 'teardown');
        }
        // Accounting can never go negative, and live frames are bounded by
        // the number of frames actually allocated.
        expect(ledger.state.residentBytes).toBeGreaterThanOrEqual(0);
        expect(ledger.liveCount).toBeLessThanOrEqual(ids.length);
      }
      // Whatever happened, a teardown must reconcile everything to zero.
      ledger.reclaimAll('teardown');
      expect(ledger.reconciles()).toBe(true);
      expect(ledger.state.residentBytes).toBe(0);
      // Every created frame reached a terminal state exactly once.
      expect(ledger.state.closed).toBe(ledger.state.created);
    }
  });
});
