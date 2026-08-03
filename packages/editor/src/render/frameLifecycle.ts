/**
 * Frame lifecycle ledger — makes exactly-once frame disposal observable.
 *
 * The disposal boundary itself already exists (`disposeWorkerFrame` plus the
 * host's `releaseFrame` identity check); this module does not replace it. It
 * records the state machine that boundary implements so the invariants can be
 * asserted rather than assumed, and so a leak or a double release shows up as
 * a counter instead of as gradually growing memory.
 *
 * States and the transitions between them:
 *
 *   allocated → transferred → received → installed → replaced → disposed
 *                   │            │           └──────────────────┘
 *                   │            └── duplicate ────→ disposed
 *                   ├── stale ───────────────────────→ disposed
 *                   └── context-lost ────────────────→ disposed
 *
 * Retention is bounded by construction: only *live* frames are tracked, and
 * the latest-only render pipeline holds at most one resident frame plus one in
 * flight. Terminal frames leave the map and survive only as counters.
 */

export type FrameState =
  | 'allocated'
  | 'transferred'
  | 'received'
  | 'installed'
  | 'replaced'
  | 'stale'
  | 'context-lost'
  | 'disposed';

export interface FrameLedgerCounters {
  created: number;
  installed: number;
  presented: number;
  replaced: number;
  stale: number;
  closed: number;
  /** Close attempts against an already-disposed or unknown frame. */
  duplicateCloseAttempts: number;
  /** Live frames reclaimed by a teardown rather than by their owner. */
  orphanRecoveries: number;
  /** Transitions the state machine rejected — always a bug when non-zero. */
  invalidTransitions: number;
  residentBytes: number;
  peakResidentBytes: number;
}

const TERMINAL: FrameState = 'disposed';

/**
 * Which states each state may move to. A transition outside this table is
 * counted and ignored rather than applied, so a stale response can never walk
 * a newer frame backwards through the machine.
 */
const ALLOWED: Record<FrameState, readonly FrameState[]> = {
  allocated: ['transferred', 'stale', 'context-lost', 'disposed'],
  transferred: ['received', 'stale', 'context-lost', 'disposed'],
  received: ['installed', 'stale', 'context-lost', 'disposed'],
  installed: ['replaced', 'context-lost', 'disposed'],
  replaced: ['disposed'],
  stale: ['disposed'],
  'context-lost': ['disposed'],
  disposed: [],
};

interface LiveFrame {
  state: FrameState;
  bytes: number;
  /** Generation the frame was created in; guards identity reuse after restart. */
  generation: number;
  /**
   * Whether this frame's bytes are currently included in `residentBytes`.
   * Tracked explicitly rather than inferred from the state, so a frame
   * reclaimed out of `installed` via `context-lost` still releases its bytes.
   */
  resident: boolean;
}

export class FrameLedger {
  private readonly live = new Map<number, LiveFrame>();
  private nextId = 1;
  private generation = 0;
  private counters: FrameLedgerCounters = {
    created: 0,
    installed: 0,
    presented: 0,
    replaced: 0,
    stale: 0,
    closed: 0,
    duplicateCloseAttempts: 0,
    orphanRecoveries: 0,
    invalidTransitions: 0,
    residentBytes: 0,
    peakResidentBytes: 0,
  };

  get state(): FrameLedgerCounters {
    return { ...this.counters };
  }

  /** Frames still holding resources. Bounded by the latest-only pipeline. */
  get liveCount(): number {
    return this.live.size;
  }

  stateOf(frameId: number): FrameState | null {
    return this.live.get(frameId)?.state ?? null;
  }

  /** Begin tracking a produced frame. Returns its ledger identity. */
  allocate(bytes: number): number {
    const frameId = this.nextId++;
    this.live.set(frameId, {
      state: 'allocated',
      bytes: Math.max(0, bytes),
      generation: this.generation,
      resident: false,
    });
    this.counters.created++;
    return frameId;
  }

  /**
   * Move a frame to a new state. Returns false — without mutating — when the
   * transition is not allowed or the frame is unknown, which is what makes a
   * stale response unable to resurrect or replace a newer frame.
   */
  transition(frameId: number, next: FrameState): boolean {
    const frame = this.live.get(frameId);
    if (!frame) {
      // An unknown id means the frame already reached a terminal state and
      // left the map; a further close attempt is a duplicate, not a leak.
      if (next === TERMINAL) this.counters.duplicateCloseAttempts++;
      else this.counters.invalidTransitions++;
      return false;
    }
    if (!ALLOWED[frame.state].includes(next)) {
      if (next === TERMINAL) this.counters.duplicateCloseAttempts++;
      else this.counters.invalidTransitions++;
      return false;
    }
    frame.state = next;
    if (next === 'installed') {
      this.counters.installed++;
      this.counters.presented++;
      frame.resident = true;
      this.counters.residentBytes += frame.bytes;
      this.trackPeak();
    }
    if (next === 'replaced') this.counters.replaced++;
    if (next === 'stale') this.counters.stale++;
    if (next === TERMINAL) this.retire(frameId, frame);
    return true;
  }

  /**
   * Release a frame's resources exactly once. Safe to call repeatedly: the
   * second call is counted as a duplicate attempt and changes no accounting.
   */
  close(frameId: number): boolean {
    return this.transition(frameId, TERMINAL);
  }

  /**
   * Reclaim every live frame — context loss, worker replacement, document
   * close, or canvas teardown. Counted separately from ordinary disposal so
   * "resources were freed" and "resources were freed by their owner" stay
   * distinguishable.
   */
  reclaimAll(reason: 'context-lost' | 'teardown'): number {
    const ids = [...this.live.keys()];
    for (const id of ids) {
      const frame = this.live.get(id);
      if (!frame) continue;
      this.counters.orphanRecoveries++;
      if (reason === 'context-lost' && ALLOWED[frame.state].includes('context-lost')) {
        frame.state = 'context-lost';
      }
      this.retire(id, frame);
    }
    // A new generation prevents a late response carrying a pre-teardown id
    // from being matched against a frame allocated after it.
    this.generation++;
    return ids.length;
  }

  /** True when no frame is live and resident accounting is back to zero. */
  reconciles(): boolean {
    return this.live.size === 0 && this.counters.residentBytes === 0;
  }

  private retire(frameId: number, frame: LiveFrame): void {
    if (frame.resident) {
      frame.resident = false;
      this.counters.residentBytes = Math.max(0, this.counters.residentBytes - frame.bytes);
    }
    this.live.delete(frameId);
    this.counters.closed++;
  }

  private trackPeak(): void {
    if (this.counters.residentBytes > this.counters.peakResidentBytes) {
      this.counters.peakResidentBytes = this.counters.residentBytes;
    }
  }
}
