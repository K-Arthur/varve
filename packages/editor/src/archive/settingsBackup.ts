/**
 * Settings backup and restore for the archive system.
 *
 * Collects settings from all localStorage keys used by Strata
 * (`strata-editor-settings`, `strata-settings`, `strata-workspace`) and
 * restores them with validation, conflict detection, and rollback support.
 *
 * Research basis: Figma preferences export, VS Code settings sync.
 * Settings are flat key-value pairs backed by localStorage; each entry
 * carries its category for selective restore.
 */

import type {
  ArchiveConflict,
  SettingsBackupEntry,
  SettingsCategory,
  SettingsRollbackSnapshot,
} from './archiveTypes';

/** LocalStorage keys and their category mappings */
const SETTINGS_SOURCES: Record<string, SettingsCategory[]> = {
  'strata-editor-settings': ['export', 'appearance', 'workspace', 'performance', 'shortcuts'],
  'strata-settings': ['appearance', 'presets', 'plugins'],
  'strata-workspace': ['workspace', 'swatches'],
};

/** Collect settings entries from localStorage for the given categories. */
export function collectSettingsBackup(categories?: SettingsCategory[]): SettingsBackupEntry[] {
  const targetCategories = categories ?? ALL_CATEGORIES;
  const entries: SettingsBackupEntry[] = [];

  for (const [storageKey, catList] of Object.entries(SETTINGS_SOURCES)) {
    const raw = localStorage.getItem(storageKey);
    if (!raw) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    for (const category of catList) {
      if (!targetCategories.includes(category)) continue;
      const value = parsed[category];
      if (value !== undefined) {
        entries.push({
          category,
          key: storageKey,
          value,
        });
      }
    }
  }

  return entries;
}

/** Apply settings entries to localStorage with conflict detection. */
export function applySettingsBackup(
  entries: SettingsBackupEntry[],
  options?: {
    onConflict?: 'overwrite' | 'skip' | 'merge';
  },
): { applied: number; skipped: number; conflicts: ArchiveConflict[] } {
  const onConflict = options?.onConflict ?? 'overwrite';
  let applied = 0;
  let skipped = 0;
  const conflicts: ArchiveConflict[] = [];

  // Group entries by key for efficient application
  const grouped = new Map<string, SettingsBackupEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.key) ?? [];
    list.push(entry);
    grouped.set(entry.key, list);
  }

  for (const [storageKey, keyEntries] of grouped) {
    const raw = localStorage.getItem(storageKey);
    let existing: Record<string, unknown> = {};
    if (raw) {
      try {
        existing = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Malformed existing data — treat as empty
      }
    }

    let changed = false;
    for (const entry of keyEntries) {
      const existingValue = existing[entry.category];
      const archiveValue = entry.value;

      if (
        existingValue !== undefined &&
        JSON.stringify(existingValue) !== JSON.stringify(archiveValue)
      ) {
        conflicts.push({
          category: entry.category,
          key: entry.key,
          existingValue,
          archiveValue,
        });

        switch (onConflict) {
          case 'skip':
            skipped++;
            continue;
          case 'merge':
            if (typeof existingValue === 'object' && typeof archiveValue === 'object') {
              entry.value = {
                ...(existingValue as Record<string, unknown>),
                ...(archiveValue as Record<string, unknown>),
              };
            }
            break;
          // 'overwrite' falls through — use archive value
        }
      }

      existing[entry.category] = entry.value;
      changed = true;
      applied++;
    }

    if (changed) {
      localStorage.setItem(storageKey, JSON.stringify(existing));
    }
  }

  return { applied, skipped, conflicts };
}

/** Validate a settings entry has the expected shape. */
export function validateSettingsEntry(entry: unknown): entry is SettingsBackupEntry {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  if (typeof e.category !== 'string') return false;
  if (!ALL_CATEGORIES.includes(e.category as SettingsCategory)) return false;
  if (typeof e.key !== 'string' || e.key.length === 0) return false;
  // value can be anything JSON-serializable
  if (e.value === undefined) return false;
  return true;
}

/**
 * Migrate a settings entry from an older format version.
 * Currently handles no migrations — future versions will add transforms here.
 */
export function migrateSettingsEntry(
  entry: SettingsBackupEntry,
  _fromVersion: string,
): SettingsBackupEntry {
  // Future migration logic:
  // if (fromVersion === '0.9') { ... }
  return entry;
}

function currentSettingsHashParts(): string[] {
  return Object.keys(SETTINGS_SOURCES).map((key) => {
    const value = localStorage.getItem(key) ?? '';
    return `${key}:${value.length}`;
  });
}

/**
 * Create a rollback snapshot of current localStorage state — captures the
 * actual raw values (not just a length-based hash), so a failed restore can
 * be reverted for real via `restoreRollbackSnapshot`.
 */
export function createRollbackSnapshot(): SettingsRollbackSnapshot {
  const values: Record<string, string | null> = {};
  for (const key of Object.keys(SETTINGS_SOURCES)) {
    values[key] = localStorage.getItem(key);
  }

  return {
    id: `rollback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    settingsHash: currentSettingsHashParts().join('|'),
    values,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Restore settings from a rollback snapshot, writing the captured raw
 * values back to localStorage unconditionally. This is meant to run after
 * a restore-apply failure, so it must not refuse to act just because the
 * current state (the partially-applied failure) differs from the snapshot
 * — that mismatch is exactly why the rollback is needed.
 *
 * Returns false only if the write itself fails (e.g. storage unavailable).
 */
export function restoreRollbackSnapshot(snapshot: SettingsRollbackSnapshot): boolean {
  try {
    for (const [key, value] of Object.entries(snapshot.values)) {
      if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    }
    return true;
  } catch {
    return false;
  }
}

const ALL_CATEGORIES: SettingsCategory[] = [
  'appearance',
  'shortcuts',
  'workspace',
  'export',
  'performance',
  'presets',
  'swatches',
  'plugins',
];
