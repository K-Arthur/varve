/**
 * Tests for settings backup/restore module.
 *
 * Verifies collect/apply/migrate settings, conflict detection,
 * rollback snapshot lifecycle, and localStorage interactions.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SettingsBackupEntry } from './archiveTypes';
import {
  applySettingsBackup,
  collectSettingsBackup,
  createRollbackSnapshot,
  migrateSettingsEntry,
  restoreRollbackSnapshot,
  validateSettingsEntry,
} from './settingsBackup';

describe('settingsBackup', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('collectSettingsBackup', () => {
    it('returns empty array when no settings exist', () => {
      const entries = collectSettingsBackup();
      expect(entries).toEqual([]);
    });

    it('collects editor settings', () => {
      const settings = {
        export: { defaultScale: 2 },
        appearance: { theme: 'dark' },
      };
      localStorage.setItem('strata-editor-settings', JSON.stringify(settings));

      const entries = collectSettingsBackup();
      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(entries.some((e) => e.category === 'export')).toBe(true);
      expect(entries.some((e) => e.category === 'appearance')).toBe(true);
    });

    it('collects UI settings', () => {
      const settings = {
        general: { language: 'en' },
        appearance: { fontSizeUI: 'large' },
      };
      localStorage.setItem('strata-settings', JSON.stringify(settings));

      const entries = collectSettingsBackup();
      expect(entries.some((e) => e.category === 'appearance')).toBe(true);
    });

    it('collects workspace settings', () => {
      const settings = {
        workspace: { mode: 'design' },
      };
      localStorage.setItem('strata-workspace', JSON.stringify(settings));

      const entries = collectSettingsBackup();
      expect(entries.some((e) => e.category === 'workspace')).toBe(true);
    });

    it('filters by specified categories', () => {
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({
          export: { defaultScale: 2 },
          appearance: { theme: 'dark' },
        }),
      );

      const entries = collectSettingsBackup(['export']);
      expect(entries.every((e) => e.category === 'export')).toBe(true);
    });

    it('handles malformed JSON gracefully', () => {
      localStorage.setItem('strata-editor-settings', '{invalid json');
      const entries = collectSettingsBackup();
      expect(entries).toEqual([]);
    });
  });

  describe('applySettingsBackup', () => {
    it('applies entries to localStorage', () => {
      const entries: SettingsBackupEntry[] = [
        { category: 'export', key: 'strata-editor-settings', value: { defaultScale: 3 } },
      ];

      const result = applySettingsBackup(entries, { onConflict: 'overwrite' });
      expect(result.applied).toBe(1);
      expect(result.conflicts).toHaveLength(0);

      const stored = JSON.parse(localStorage.getItem('strata-editor-settings') ?? '{}');
      expect(stored.export).toEqual({ defaultScale: 3 });
    });

    it('detects conflicts', () => {
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({ export: { defaultScale: 2 } }),
      );

      const entries: SettingsBackupEntry[] = [
        { category: 'export', key: 'strata-editor-settings', value: { defaultScale: 5 } },
      ];

      const result = applySettingsBackup(entries, { onConflict: 'overwrite' });
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.category).toBe('export');
    });

    it('skips conflicting entries when onConflict is skip', () => {
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({ export: { defaultScale: 2 } }),
      );

      const entries: SettingsBackupEntry[] = [
        { category: 'export', key: 'strata-editor-settings', value: { defaultScale: 5 } },
      ];

      const result = applySettingsBackup(entries, { onConflict: 'skip' });
      expect(result.skipped).toBe(1);
      expect(result.applied).toBe(0);
    });

    it('merges objects when onConflict is merge', () => {
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({ export: { defaultScale: 2, defaultFormat: 'png' } }),
      );

      const entries: SettingsBackupEntry[] = [
        { category: 'export', key: 'strata-editor-settings', value: { defaultScale: 5 } },
      ];

      const result = applySettingsBackup(entries, { onConflict: 'merge' });
      expect(result.applied).toBe(1);

      const stored = JSON.parse(localStorage.getItem('strata-editor-settings') ?? '{}');
      expect(stored.export.defaultScale).toBe(5);
      expect(stored.export.defaultFormat).toBe('png');
    });
  });

  describe('validateSettingsEntry', () => {
    it('accepts valid entries', () => {
      const entry = { category: 'export', key: 'test', value: { x: 1 } };
      expect(validateSettingsEntry(entry)).toBe(true);
    });

    it('rejects entries without category', () => {
      expect(validateSettingsEntry({ key: 'test', value: {} })).toBe(false);
    });

    it('rejects entries with invalid category', () => {
      expect(validateSettingsEntry({ category: 'invalid', key: 'test', value: {} })).toBe(false);
    });

    it('rejects entries without key', () => {
      expect(validateSettingsEntry({ category: 'export', value: {} })).toBe(false);
    });

    it('rejects entries with empty key', () => {
      expect(validateSettingsEntry({ category: 'export', key: '', value: {} })).toBe(false);
    });

    it('rejects entries without value', () => {
      expect(validateSettingsEntry({ category: 'export', key: 'test' })).toBe(false);
    });

    it('rejects non-objects', () => {
      expect(validateSettingsEntry(null)).toBe(false);
      expect(validateSettingsEntry('string')).toBe(false);
      expect(validateSettingsEntry(42)).toBe(false);
    });
  });

  describe('migrateSettingsEntry', () => {
    it('passes through entries unchanged', () => {
      const entry: SettingsBackupEntry = {
        category: 'export',
        key: 'test',
        value: { x: 1 },
      };
      const result = migrateSettingsEntry(entry, '0.9');
      expect(result).toEqual(entry);
    });
  });

  describe('createRollbackSnapshot', () => {
    it('creates a snapshot with unique id', () => {
      const snap1 = createRollbackSnapshot();
      const snap2 = createRollbackSnapshot();
      expect(snap1.id).not.toBe(snap2.id);
    });

    it('includes timestamps', () => {
      const snap = createRollbackSnapshot();
      expect(snap.createdAt).toBeTruthy();
      expect(new Date(snap.createdAt).getTime()).toBeGreaterThan(0);
    });

    it('captures settings hash', () => {
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({ export: { defaultScale: 2 } }),
      );
      const snap = createRollbackSnapshot();
      expect(snap.settingsHash).toBeTruthy();
    });
  });

  describe('restoreRollbackSnapshot', () => {
    it('is a no-op success when current state already matches the snapshot', () => {
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({ export: { defaultScale: 2 } }),
      );
      const snap = createRollbackSnapshot();
      expect(restoreRollbackSnapshot(snap)).toBe(true);
      expect(localStorage.getItem('strata-editor-settings')).toBe(
        JSON.stringify({ export: { defaultScale: 2 } }),
      );
    });

    it('actually reverts localStorage to the snapshotted values after a failed apply', () => {
      // This is the real use case: a restore-apply modifies settings, then
      // fails partway through. Rollback must write the original bytes back
      // — refusing to act because "current differs from snapshot" would
      // defeat the entire purpose, since that mismatch is expected here.
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({ export: { defaultScale: 2 } }),
      );
      const snap = createRollbackSnapshot();

      // Simulate a partially-applied restore that changed settings.
      localStorage.setItem(
        'strata-editor-settings',
        JSON.stringify({ export: { defaultScale: 99 } }),
      );

      expect(restoreRollbackSnapshot(snap)).toBe(true);
      expect(localStorage.getItem('strata-editor-settings')).toBe(
        JSON.stringify({ export: { defaultScale: 2 } }),
      );
    });

    it('removes keys that were absent at snapshot time', () => {
      localStorage.removeItem('strata-workspace');
      const snap = createRollbackSnapshot();

      localStorage.setItem('strata-workspace', JSON.stringify({ workspace: { layout: 'x' } }));

      expect(restoreRollbackSnapshot(snap)).toBe(true);
      expect(localStorage.getItem('strata-workspace')).toBeNull();
    });
  });
});
