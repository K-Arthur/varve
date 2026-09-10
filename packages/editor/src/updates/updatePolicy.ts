import type {
  PackagingContext,
  UpdateChannel,
  UpdateConsent,
  UpdateError,
  UpdatePreferences,
} from './updateTypes';

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;

export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = {
  schemaVersion: 1,
  consentPromptSeen: false,
  consent: 'manual',
  installOnQuit: false,
  channel: 'stable',
  skippedVersions: {},
  lastCheckedAt: null,
  nextEligibleCheckAt: null,
};

export function normalizeUpdatePreferences(value: unknown): UpdatePreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_UPDATE_PREFERENCES };
  const raw = value as Partial<UpdatePreferences>;
  const consent: UpdateConsent =
    raw.consent === 'notify' || raw.consent === 'download-automatically' ? raw.consent : 'manual';
  const channel: UpdateChannel =
    raw.channel === 'beta' || raw.channel === 'nightly' ? raw.channel : 'stable';
  const skippedVersions =
    raw.skippedVersions && typeof raw.skippedVersions === 'object'
      ? Object.fromEntries(
          Object.entries(raw.skippedVersions).filter(
            ([key, value]) =>
              (key === 'stable' || key === 'beta' || key === 'nightly') &&
              typeof value === 'string',
          ),
        )
      : {};
  return {
    schemaVersion: 1,
    consentPromptSeen: raw.consentPromptSeen === true,
    consent,
    installOnQuit: consent === 'download-automatically' && raw.installOnQuit === true,
    channel,
    skippedVersions,
    lastCheckedAt: typeof raw.lastCheckedAt === 'number' ? raw.lastCheckedAt : null,
    nextEligibleCheckAt:
      typeof raw.nextEligibleCheckAt === 'number' ? raw.nextEligibleCheckAt : null,
  };
}

export function canBackgroundCheck(preferences: UpdatePreferences): boolean {
  return preferences.consent !== 'manual';
}

export function canDownloadAutomatically(preferences: UpdatePreferences): boolean {
  return preferences.consent === 'download-automatically';
}

export function canInstallOnQuit(preferences: UpdatePreferences): boolean {
  return canDownloadAutomatically(preferences) && preferences.installOnQuit;
}

export function isCheckDue(preferences: UpdatePreferences, now: number): boolean {
  return (
    canBackgroundCheck(preferences) &&
    (preferences.nextEligibleCheckAt === null || now >= preferences.nextEligibleCheckAt)
  );
}

export function isChannelMatch(current: UpdateChannel, candidate: UpdateChannel): boolean {
  return current === candidate;
}

export function authorityState(
  context: PackagingContext,
):
  | { kind: 'ready' }
  | { kind: 'unsupported'; reason: UpdateError }
  | { kind: 'externally-managed'; authority: 'package-manager-managed' | 'store-managed' } {
  if (
    context.updateAuthority === 'package-manager-managed' ||
    context.updateAuthority === 'store-managed'
  ) {
    return { kind: 'externally-managed', authority: context.updateAuthority };
  }
  if (
    context.updateAuthority !== 'self-managed' ||
    !context.runtimeSupported ||
    context.installLocation !== 'writable'
  ) {
    return {
      kind: 'unsupported',
      reason: {
        code:
          context.updateAuthority === 'development-build'
            ? 'unsupported-build'
            : 'unsupported-build',
        message: 'Updates are unavailable for this Varve build.',
      },
    };
  }
  return { kind: 'ready' };
}

/** Strict enough for release metadata; comparison remains deterministic and never lexicographic. */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i]! > b.core[i]! ? 1 : -1;
  }
  if (a.pre.length === 0 && b.pre.length > 0) return 1;
  if (a.pre.length > 0 && b.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i += 1) {
    const av = a.pre[i];
    const bv = b.pre[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) return Number(av) > Number(bv) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

function parseVersion(value: string): { core: [number, number, number]; pre: string[] } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4]?.split('.') ?? [],
  };
}
