/**
 * Versioned crash-reporting consent state machine.
 *
 * Privacy contract (see docs/privacy/consent-state.md):
 * - `unknown` behaves exactly like `denied` for upload purposes. No report,
 *   breadcrumb, log bundle, or attachment may be transmitted while the state
 *   is unknown, and consent is never inferred from continued use.
 * - Every change of state happens through an explicit `ConsentAction`. There
 *   is no implicit transition anywhere in the application.
 * - "Send this report" (one-time) never enables automatic reporting.
 * - Revocation stops future uploads immediately; the caller is responsible
 *   for stopping in-flight work and clearing/quarantining queued reports.
 * - A stored decision recorded under an older consent-policy version never
 *   upgrades to a newer policy: automatic reporting requires renewed consent.
 * - Legacy analytics opt-ins (e.g. `ai.shareUsageData`) are never read here.
 *   Only an explicit legacy crash-consent record may migrate.
 */

export type CrashConsentState =
  | 'unknown'
  | 'askEachTime'
  | 'automaticAllowed'
  | 'denied'
  | 'managedDisabled'
  | 'unavailable';

/** Where a consent decision applies. */
export type ConsentScope = 'desktop' | 'browser' | 'both';

/** Actions a user (or policy/build config) may take. */
export type ConsentAction =
  /** User sent a single report without changing their standing choice. */
  | 'sendOneReport'
  /** User deliberately enabled automatic reporting. */
  | 'enableAutomatic'
  /** User chose to be asked before each report is sent. */
  | 'chooseAskEachTime'
  /** User declined crash reporting. */
  | 'deny'
  /** Alias for deny used at revocation time; same transition rules. */
  | 'revoke'
  /** Build/policy configuration disabled reporting; user cannot override. */
  | 'disableByPolicy'
  /** Reporting is not supported in the current environment. */
  | 'markUnavailable';

export interface CrashConsentRecord {
  state: CrashConsentState;
  /** Consent-policy version the decision was made under. */
  policyVersion: number;
  /** Epoch ms of the user's decision. 0 when never decided. */
  decidedAt: number;
  /** Application version in which the decision was made. */
  appVersion: string;
  /** Which surfaces the choice applies to. */
  scope: ConsentScope;
}

export const CRASH_CONSENT_POLICY_VERSION = 1;
export const CRASH_CONSENT_STORAGE_KEY = 'varve:crash-consent';
/** Legacy Strata key. Only explicit decision records migrate; see storage. */
export const LEGACY_CRASH_CONSENT_STORAGE_KEY = 'strata:crash-consent';
export const APP_VERSION_UNKNOWN = '';

/** A consent record with no user decision. Fails closed everywhere. */
export function unknownConsent(scope: ConsentScope = 'both'): CrashConsentRecord {
  return {
    state: 'unknown',
    policyVersion: CRASH_CONSENT_POLICY_VERSION,
    decidedAt: 0,
    appVersion: APP_VERSION_UNKNOWN,
    scope,
  };
}

/** States from which the user may still be asked (dialog allowed). */
export function canAsk(state: CrashConsentState): boolean {
  return state === 'unknown' || state === 'askEachTime';
}

/** The only state that permits automatic upload. */
export function canUpload(state: CrashConsentState): boolean {
  return state === 'automaticAllowed';
}

/** Policy-controlled states the user cannot override. */
export function isPolicyLocked(state: CrashConsentState): boolean {
  return state === 'managedDisabled' || state === 'unavailable';
}

/**
 * Pure state transition. Returns the resulting state, or the unchanged state
 * when the transition is forbidden (policy lock, or a no-op on the same
 * state). Unknown never becomes anything without an explicit user action.
 */
export function transitionConsent(
  current: CrashConsentState,
  action: ConsentAction,
): CrashConsentState {
  if (isPolicyLocked(current)) {
    // Users cannot override policy or environment capability, but the system
    // may still lock further or lift a temporary unavailability.
    if (action === 'disableByPolicy') return 'managedDisabled';
    if (action === 'markUnavailable') return 'unavailable';
    return current;
  }
  switch (action) {
    case 'sendOneReport':
      // One-time send records an explicit decision but never enables
      // automatic reporting. If automatic is already on, nothing changes.
      return current === 'automaticAllowed' ? current : 'askEachTime';
    case 'enableAutomatic':
      return 'automaticAllowed';
    case 'chooseAskEachTime':
      return 'askEachTime';
    case 'deny':
    case 'revoke':
      return 'denied';
    case 'disableByPolicy':
      return 'managedDisabled';
    case 'markUnavailable':
      return 'unavailable';
  }
}

export interface ConsentDecisionInput {
  action: ConsentAction;
  appVersion: string;
  scope: ConsentScope;
  /** Force a decision timestamp (tests). Defaults to Date.now(). */
  decidedAt?: number;
}

/**
 * Applies an action to a record and produces a new record with metadata.
 * Policy-version upgrade handling: if the stored record predates the current
 * policy version and it was `automaticAllowed`, automatic reporting is
 * downgraded to `askEachTime` (renewed consent required). Denied/unknown
 * records are never silently upgraded to opted-in.
 */
export function applyConsentDecision(
  current: CrashConsentRecord,
  input: ConsentDecisionInput,
): CrashConsentRecord {
  let base = current;
  if (base.policyVersion < CRASH_CONSENT_POLICY_VERSION && base.state === 'automaticAllowed') {
    base = { ...base, state: 'askEachTime', policyVersion: CRASH_CONSENT_POLICY_VERSION };
  }
  const next = transitionConsent(base.state, input.action);
  const decided = next !== base.state || base.decidedAt === 0;
  return {
    state: next,
    policyVersion: CRASH_CONSENT_POLICY_VERSION,
    decidedAt: decided ? (input.decidedAt ?? Date.now()) : base.decidedAt,
    appVersion: decided ? input.appVersion : base.appVersion,
    scope: decided ? input.scope : base.scope,
  };
}

export interface CrashConsentStorage {
  load(): CrashConsentRecord | null;
  save(record: CrashConsentRecord): void;
  clear(): void;
}

function parseRecord(raw: string): CrashConsentRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CrashConsentRecord>;
    if (typeof parsed.state !== 'string') return null;
    if (typeof parsed.policyVersion !== 'number') return null;
    if (typeof parsed.decidedAt !== 'number') return null;
    if (typeof parsed.appVersion !== 'string') return null;
    const scope: ConsentScope =
      parsed.scope === 'desktop' || parsed.scope === 'browser' ? parsed.scope : 'both';
    return {
      state: parsed.state as CrashConsentState,
      policyVersion: parsed.policyVersion,
      decidedAt: parsed.decidedAt,
      appVersion: parsed.appVersion,
      scope,
    };
  } catch {
    return null;
  }
}

/**
 * localStorage-backed consent storage. Reads `varve:crash-consent` first;
 * falls back to the legacy `strata:crash-consent` key only when it holds a
 * valid, explicit decision record. No other legacy preference (analytics,
 * usage data, terms acceptance) is ever interpreted as crash-reporting
 * consent. Unknown states fail closed: no record means `unknown`.
 */
export class LocalStorageCrashConsentStorage implements CrashConsentStorage {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}

  load(): CrashConsentRecord | null {
    try {
      const raw = this.storage.getItem(CRASH_CONSENT_STORAGE_KEY);
      if (raw) return parseRecord(raw);
      const legacy = this.storage.getItem(LEGACY_CRASH_CONSENT_STORAGE_KEY);
      if (!legacy) return null;
      const record = parseRecord(legacy);
      if (!record) return null;
      // Adopt the explicit legacy decision, written under the new key, but
      // only as a snapshot — never upgrade its policy version.
      return record;
    } catch {
      return null;
    }
  }

  save(record: CrashConsentRecord): void {
    try {
      this.storage.setItem(CRASH_CONSENT_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Storage full/unavailable: the decision stays in memory for the
      // session; the next launch fails closed back to unknown.
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(CRASH_CONSENT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

/** In-memory store for tests and environments without localStorage. */
export class MemoryCrashConsentStorage implements CrashConsentStorage {
  private record: CrashConsentRecord | null = null;
  load(): CrashConsentRecord | null {
    return this.record;
  }
  save(record: CrashConsentRecord): void {
    this.record = record;
  }
  clear(): void {
    this.record = null;
  }
}

export interface ConsentProvider {
  /** Synchronous read — always safe to call before any uploader starts. */
  getConsent(): CrashConsentRecord;
  applyAction(input: ConsentDecisionInput): CrashConsentRecord;
}

/** Stateful provider backed by a storage. Holds the record in memory. */
export class CrashConsentProvider implements ConsentProvider {
  private record: CrashConsentRecord;

  constructor(
    private readonly storage: CrashConsentStorage,
    scope: ConsentScope = 'both',
  ) {
    this.record = storage.load() ?? unknownConsent(scope);
    // A stale automatic decision under an older policy downgrades to
    // askEachTime before anything can read it (renewed consent required).
    if (
      this.record.policyVersion < CRASH_CONSENT_POLICY_VERSION &&
      this.record.state === 'automaticAllowed'
    ) {
      this.record = {
        ...this.record,
        state: 'askEachTime',
        policyVersion: CRASH_CONSENT_POLICY_VERSION,
      };
      storage.save(this.record);
    }
  }

  getConsent(): CrashConsentRecord {
    return this.record;
  }

  applyAction(input: ConsentDecisionInput): CrashConsentRecord {
    this.record = applyConsentDecision(this.record, input);
    this.storage.save(this.record);
    return this.record;
  }
}
