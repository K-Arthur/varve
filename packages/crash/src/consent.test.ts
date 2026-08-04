import { describe, expect, it, vi } from 'vitest';
import {
  applyConsentDecision,
  CRASH_CONSENT_POLICY_VERSION,
  CrashConsentProvider,
  type CrashConsentRecord,
  type CrashConsentState,
  canAsk,
  canUpload,
  isPolicyLocked,
  LEGACY_CRASH_CONSENT_STORAGE_KEY,
  LocalStorageCrashConsentStorage,
  MemoryCrashConsentStorage,
  transitionConsent,
  unknownConsent,
} from './consent';

const STATES: CrashConsentState[] = [
  'unknown',
  'askEachTime',
  'automaticAllowed',
  'denied',
  'managedDisabled',
  'unavailable',
];

const USER_ACTIONS = [
  'sendOneReport',
  'enableAutomatic',
  'chooseAskEachTime',
  'deny',
  'revoke',
] as const;

/** Expected result of every user action from every state. */
const EXPECTED: Record<
  (typeof USER_ACTIONS)[number],
  Record<CrashConsentState, CrashConsentState>
> = {
  sendOneReport: {
    // One-time send never enables automatic reporting. Unknown becomes a
    // deliberate ask-each-time decision; automatic stays automatic.
    unknown: 'askEachTime',
    askEachTime: 'askEachTime',
    automaticAllowed: 'automaticAllowed',
    denied: 'askEachTime',
    managedDisabled: 'managedDisabled', // policy lock: forbidden
    unavailable: 'unavailable', // policy lock: forbidden
  },
  enableAutomatic: {
    unknown: 'automaticAllowed',
    askEachTime: 'automaticAllowed',
    automaticAllowed: 'automaticAllowed',
    denied: 'automaticAllowed',
    managedDisabled: 'managedDisabled', // forbidden
    unavailable: 'unavailable', // forbidden
  },
  chooseAskEachTime: {
    unknown: 'askEachTime',
    askEachTime: 'askEachTime',
    automaticAllowed: 'askEachTime',
    denied: 'askEachTime',
    managedDisabled: 'managedDisabled', // forbidden
    unavailable: 'unavailable', // forbidden
  },
  deny: {
    unknown: 'denied',
    askEachTime: 'denied',
    automaticAllowed: 'denied',
    denied: 'denied',
    managedDisabled: 'managedDisabled', // forbidden
    unavailable: 'unavailable', // forbidden
  },
  revoke: {
    unknown: 'denied',
    askEachTime: 'denied',
    automaticAllowed: 'denied',
    denied: 'denied',
    managedDisabled: 'managedDisabled', // forbidden
    unavailable: 'unavailable', // forbidden
  },
};

describe('transitionConsent — full transition matrix', () => {
  for (const action of USER_ACTIONS) {
    for (const state of STATES) {
      it(`${action} from ${state}`, () => {
        expect(transitionConsent(state, action)).toBe(EXPECTED[action][state]);
      });
    }
  }
  for (const state of STATES) {
    it(`disableByPolicy from ${state}`, () => {
      expect(transitionConsent(state, 'disableByPolicy')).toBe('managedDisabled');
    });
    it(`markUnavailable from ${state}`, () => {
      expect(transitionConsent(state, 'markUnavailable')).toBe('unavailable');
    });
  }
});

describe('unknown consent fails closed', () => {
  it('unknown never permits upload', () => {
    expect(canUpload('unknown')).toBe(false);
  });
  it('unknown permits asking (dialog) but nothing transmits', () => {
    expect(canAsk('unknown')).toBe(true);
  });
  it('only automaticAllowed permits upload', () => {
    for (const state of STATES) {
      expect(canUpload(state)).toBe(state === 'automaticAllowed');
    }
  });
  it('one-time send does not enable automatic reporting', () => {
    const record = applyConsentDecision(unknownConsent(), {
      action: 'sendOneReport',
      appVersion: '0.1.0',
      scope: 'both',
      decidedAt: 1000,
    });
    expect(record.state).toBe('askEachTime');
    expect(canUpload(record.state)).toBe(false);
  });
});

describe('applyConsentDecision metadata', () => {
  it('records decision timestamp and app version', () => {
    const record = applyConsentDecision(unknownConsent(), {
      action: 'deny',
      appVersion: '0.2.0',
      scope: 'desktop',
      decidedAt: 42,
    });
    expect(record).toMatchObject({
      state: 'denied',
      policyVersion: CRASH_CONSENT_POLICY_VERSION,
      decidedAt: 42,
      appVersion: '0.2.0',
      scope: 'desktop',
    });
  });

  it('no-op transitions preserve the original decision metadata', () => {
    const base: CrashConsentRecord = {
      state: 'denied',
      policyVersion: CRASH_CONSENT_POLICY_VERSION,
      decidedAt: 7,
      appVersion: '0.1.0',
      scope: 'both',
    };
    const next = applyConsentDecision(base, {
      action: 'deny',
      appVersion: '0.9.0',
      scope: 'browser',
    });
    expect(next.decidedAt).toBe(7);
    expect(next.appVersion).toBe('0.1.0');
    expect(next.scope).toBe('both');
  });

  it('revocation records a new decision with current metadata', () => {
    const base: CrashConsentRecord = {
      state: 'automaticAllowed',
      policyVersion: CRASH_CONSENT_POLICY_VERSION,
      decidedAt: 5,
      appVersion: '0.1.0',
      scope: 'both',
    };
    const next = applyConsentDecision(base, {
      action: 'revoke',
      appVersion: '0.3.0',
      scope: 'desktop',
      decidedAt: 6,
    });
    expect(next.state).toBe('denied');
    expect(next.decidedAt).toBe(6);
    expect(next.appVersion).toBe('0.3.0');
    expect(next.scope).toBe('desktop');
  });
});

describe('policy version handling', () => {
  it('stale automatic consent downgrades to askEachTime (renewed consent)', () => {
    const base: CrashConsentRecord = {
      state: 'automaticAllowed',
      policyVersion: 0,
      decidedAt: 1,
      appVersion: '0.0.9',
      scope: 'both',
    };
    const next = applyConsentDecision(base, {
      action: 'deny',
      appVersion: '0.1.0',
      scope: 'both',
    });
    // Downgraded first, then the user action applies.
    expect(next.state).toBe('denied');
    expect(next.policyVersion).toBe(CRASH_CONSENT_POLICY_VERSION);
  });

  it('stale denied consent stays denied (never upgraded)', () => {
    const base: CrashConsentRecord = {
      state: 'denied',
      policyVersion: 0,
      decidedAt: 1,
      appVersion: '0.0.9',
      scope: 'both',
    };
    const next = applyConsentDecision(base, {
      action: 'deny',
      appVersion: '0.1.0',
      scope: 'both',
    });
    expect(next.state).toBe('denied');
  });

  it('stale unknown consent stays unknown until an explicit action', () => {
    const base: CrashConsentRecord = {
      state: 'unknown',
      policyVersion: 0,
      decidedAt: 0,
      appVersion: '',
      scope: 'both',
    };
    const next = applyConsentDecision(base, {
      action: 'chooseAskEachTime',
      appVersion: '0.1.0',
      scope: 'both',
    });
    expect(next.state).toBe('askEachTime');
  });

  it('provider downgrades stale automatic consent at construction', () => {
    const storage = new MemoryCrashConsentStorage();
    storage.save({
      state: 'automaticAllowed',
      policyVersion: 0,
      decidedAt: 1,
      appVersion: 'old',
      scope: 'both',
    });
    const provider = new CrashConsentProvider(storage);
    expect(provider.getConsent().state).toBe('askEachTime');
    expect(storage.load()?.state).toBe('askEachTime');
  });
});

describe('policy lock', () => {
  it('managedDisabled and unavailable are policy-locked', () => {
    expect(isPolicyLocked('managedDisabled')).toBe(true);
    expect(isPolicyLocked('unavailable')).toBe(true);
    expect(isPolicyLocked('denied')).toBe(false);
  });

  it('users cannot opt back in from managedDisabled', () => {
    for (const action of USER_ACTIONS) {
      expect(transitionConsent('managedDisabled', action)).toBe('managedDisabled');
    }
  });

  it('system may lift unavailability but users may not', () => {
    // A user action from unavailable stays unavailable…
    expect(transitionConsent('unavailable', 'enableAutomatic')).toBe('unavailable');
    // …and the system can restore availability only through a new decision
    // flow (represented by chooseAskEachTime after environment recovery).
    // Transition-wise the lock is sticky by design.
    expect(transitionConsent('unavailable', 'markUnavailable')).toBe('unavailable');
  });
});

describe('storage', () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      dump: () => Object.fromEntries(map),
    };
  }

  it('no record means unknown (fail closed)', () => {
    const storage = new LocalStorageCrashConsentStorage(fakeStorage());
    expect(storage.load()).toBeNull();
  });

  it('round-trips a decision', () => {
    const f = fakeStorage();
    const storage = new LocalStorageCrashConsentStorage(f);
    const record: CrashConsentRecord = {
      state: 'automaticAllowed',
      policyVersion: 1,
      decidedAt: 123,
      appVersion: '0.1.0',
      scope: 'both',
    };
    storage.save(record);
    expect(storage.load()).toEqual(record);
  });

  it('migrates an explicit legacy strata consent record', () => {
    const legacy: CrashConsentRecord = {
      state: 'denied',
      policyVersion: 1,
      decidedAt: 99,
      appVersion: '0.0.5',
      scope: 'both',
    };
    const storage = new LocalStorageCrashConsentStorage(
      fakeStorage({ [LEGACY_CRASH_CONSENT_STORAGE_KEY]: JSON.stringify(legacy) }),
    );
    expect(storage.load()).toEqual(legacy);
  });

  it('ignores a malformed legacy record', () => {
    const storage = new LocalStorageCrashConsentStorage(
      fakeStorage({ [LEGACY_CRASH_CONSENT_STORAGE_KEY]: '{"state":"denied"}' }),
    );
    expect(storage.load()).toBeNull();
  });

  it('never reads analytics preferences as consent', () => {
    // The AI section's shareUsageData toggle lives under varve-settings;
    // even if someone sets it, the consent store must not see it.
    const storage = new LocalStorageCrashConsentStorage(
      fakeStorage({ 'varve-settings': '{"ai":{"shareUsageData":true}}' }),
    );
    expect(storage.load()).toBeNull();
  });

  it('provider persists an action', () => {
    const f = fakeStorage();
    const provider = new CrashConsentProvider(new LocalStorageCrashConsentStorage(f), 'desktop');
    provider.applyAction({
      action: 'enableAutomatic',
      appVersion: '0.1.0',
      scope: 'desktop',
      decidedAt: 5,
    });
    const reloaded = new CrashConsentProvider(new LocalStorageCrashConsentStorage(f), 'desktop');
    expect(reloaded.getConsent().state).toBe('automaticAllowed');
  });

  it('corrupt primary record fails closed to unknown', () => {
    const f = fakeStorage({ 'varve:crash-consent': '{not json' });
    const provider = new CrashConsentProvider(new LocalStorageCrashConsentStorage(f));
    expect(provider.getConsent().state).toBe('unknown');
  });
});

describe('consent provider race safety', () => {
  it('consent lookup is synchronous', () => {
    const provider = new CrashConsentProvider(new MemoryCrashConsentStorage());
    const read = () => provider.getConsent();
    expect(read().state).toBe('unknown');
  });

  it('provider uses Date.now when no decidedAt is supplied', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const provider = new CrashConsentProvider(new MemoryCrashConsentStorage());
    provider.applyAction({ action: 'deny', appVersion: '0.1.0', scope: 'both' });
    expect(provider.getConsent().decidedAt).toBe(1000);
    vi.useRealTimers();
  });
});
