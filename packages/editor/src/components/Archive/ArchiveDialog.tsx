/**
 * ArchiveDialog — modal for creating and restoring portable archive backups.
 *
 * Two-tab design: Create Archive (full project or settings-only with encryption)
 * and Restore Archive (file drop, preview, conflict detection, restore).
 *
 * Follows the Varve design system patterns established by ExportDialog,
 * SettingsDialog, and RecoveryDialog.
 */

import { Dialog, Select } from '@varve/ui';
import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ArchiveBuildResult,
  ArchiveConflict,
  ArchiveKind,
  ArchiveManifest,
  ArchiveRestoreResult,
  SettingsCategory,
} from '../../archive';
import {
  applyRestore,
  buildArchive,
  collectSettingsBackup,
  createRollbackSnapshot,
  detectConflicts,
  restoreArchive,
  restoreRollbackSnapshot,
  validateArchive,
} from '../../archive';
import { isCommonPassword } from '../../archive/commonPasswords';

import './ArchiveDialog.css';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ArchiveDialogProps {
  open: boolean;
  onClose: () => void;
  document?: { id: string; name: string; formatVersion: string; nodes: Record<string, unknown> };
  onCreateArchive?: (result: ArchiveBuildResult) => void;
  onRestoreArchive?: (result: ArchiveRestoreResult) => void;
  /** When provided (desktop), archives save via a native dialog + atomic
   *  write instead of a browser download. */
  platform?: import('@varve/platform').Platform;
}

type ArchiveTab = 'create' | 'restore';

type CreatePhase =
  | 'idle'
  | 'preparing'
  | 'encoding'
  | 'compressing'
  | 'encrypting'
  | 'finalizing'
  | 'complete'
  | 'error';

type RestorePhase = 'idle' | 'validating' | 'decrypting' | 'extracting' | 'complete' | 'error';

type PasswordStrength = 'weak' | 'fair' | 'strong' | 'very-strong';

// ── Constants ────────────────────────────────────────────────────────────────

const SETTINGS_CATEGORIES: {
  id: SettingsCategory;
  label: string;
  description: string;
}[] = [
  { id: 'appearance', label: 'Appearance', description: 'Theme, font size, reduce motion' },
  { id: 'shortcuts', label: 'Shortcuts', description: 'Keyboard shortcuts' },
  { id: 'workspace', label: 'Workspace', description: 'Panel layout, toolbar config' },
  { id: 'export', label: 'Export', description: 'Default format, scale, color profile' },
  { id: 'performance', label: 'Performance', description: 'Render preferences' },
  { id: 'presets', label: 'Presets', description: 'Brush presets, export presets' },
  { id: 'swatches', label: 'Swatches', description: 'Color swatches, palettes' },
  { id: 'plugins', label: 'Plugins', description: 'Safe plugin configuration' },
];

const PHASE_LABELS: Record<string, string> = {
  preparing: 'Preparing\u2026',
  'encoding-document': 'Encoding document\u2026',
  'encoding-settings': 'Encoding settings\u2026',
  'collecting-assets': 'Collecting assets\u2026',
  'creating-manifest': 'Creating manifest\u2026',
  packaging: 'Compressing\u2026',
  encrypting: 'Encrypting\u2026',
  complete: 'Complete',
  validating: 'Validating archive\u2026',
  decrypting: 'Decrypting\u2026',
  extracting: 'Extracting contents\u2026',
  'reading-manifest': 'Reading manifest\u2026',
  'verifying-checksums': 'Verifying checksums\u2026',
  'decoding-document': 'Decoding document\u2026',
  'extracting-settings': 'Extracting settings\u2026',
  'applying-settings': 'Applying settings\u2026',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Entropy estimation using the NIST SP 800-63B heuristic:
 *  - 4 bits for the first character
 *  - 2 bits for each of the next 7 characters
 *  - 1.5 bits for each additional character
 *  - +6 bonus bits for uppercase
 *  - +6 bonus bits for lowercase
 *  - +6 bonus bits for digits
 *  - +6 bonus bits for special characters
 *
 *  This is a local-only estimate (no network calls, no logging).
 *  It does NOT imply safety; it only identifies weak structural choices
 *  and common passwords.
 */
function estimatePasswordEntropy(password: string): number {
  if (password.length === 0) return 0;
  let entropy = 4 + Math.min(password.length - 1, 7) * 2;
  if (password.length > 8) entropy += (password.length - 8) * 1.5;
  if (/[A-Z]/.test(password)) entropy += 6;
  if (/[a-z]/.test(password)) entropy += 6;
  if (/[0-9]/.test(password)) entropy += 6;
  if (/[^A-Za-z0-9]/.test(password)) entropy += 6;
  return entropy;
}

function evaluatePasswordStrength(password: string): {
  strength: PasswordStrength;
  isCommon: boolean;
  entropy: number;
} {
  if (password.length === 0) {
    return { strength: 'weak', isCommon: false, entropy: 0 };
  }

  const isCommon = isCommonPassword(password);
  const entropy = estimatePasswordEntropy(password);

  // Common password check takes priority
  if (isCommon) return { strength: 'weak', isCommon: true, entropy };

  // Entropy-based classification
  if (entropy < 20) return { strength: 'weak', isCommon: false, entropy };
  if (entropy < 30) return { strength: 'fair', isCommon: false, entropy };
  if (entropy < 45) return { strength: 'strong', isCommon: false, entropy };
  return { strength: 'very-strong', isCommon: false, entropy };
}

function strengthLabel(s: PasswordStrength, isCommon: boolean): string {
  if (isCommon) return 'Common password';
  switch (s) {
    case 'weak':
      return 'Weak';
    case 'fair':
      return 'Fair';
    case 'strong':
      return 'Strong';
    case 'very-strong':
      return 'Very strong';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function ArchiveDialog({
  open,
  onClose,
  document: doc,
  onCreateArchive,
  onRestoreArchive,
  platform,
}: ArchiveDialogProps) {
  const [activeTab, setActiveTab] = useState<ArchiveTab>('create');

  // Create state
  const [archiveKind, setArchiveKind] = useState<ArchiveKind>('full');
  const [selectedCategories, setSelectedCategories] = useState<Set<SettingsCategory>>(
    new Set(SETTINGS_CATEGORIES.map((c) => c.id)),
  );
  const [encryptionEnabled, setEncryptionEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [createPhase, setCreatePhase] = useState<CreatePhase>('idle');
  const [createProgress, setCreateProgress] = useState(0);
  const [createStatus, setCreateStatus] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<ArchiveBuildResult | null>(null);

  // Restore state
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreManifest, setRestoreManifest] = useState<ArchiveManifest | null>(null);
  const [restoreEncrypted, setRestoreEncrypted] = useState(false);
  const [restorePassword, setRestorePassword] = useState('');
  const [restorePhase, setRestorePhase] = useState<RestorePhase>('idle');
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreStatus, setRestoreStatus] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<ArchiveRestoreResult | null>(null);
  const [restoreConflicts, setRestoreConflicts] = useState<ArchiveConflict[]>([]);
  const [conflictResolution, setConflictResolution] = useState<'overwrite' | 'skip' | 'merge'>(
    'overwrite',
  );
  const [confirmRestore, setConfirmRestore] = useState(false);

  // Refs
  const createAbortRef = useRef<AbortController | null>(null);
  const restoreAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLButtonElement>(null);

  // Password strength
  const passwordStrength = useMemo(() => {
    if (!password) return null;
    return evaluatePasswordStrength(password);
  }, [password]);

  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canCreate =
    createPhase === 'idle' &&
    !passwordMismatch &&
    (!encryptionEnabled || password.length >= 8) &&
    (archiveKind === 'full' || selectedCategories.size > 0);

  const canRestore =
    restorePhase === 'idle' &&
    restoreFile !== null &&
    (!restoreEncrypted || restorePassword.length > 0);

  const destinationName = useMemo(() => {
    if (archiveKind === 'full' && doc) {
      return `${doc.name.replace(/[^a-zA-Z0-9-_\s]/g, '').trim() || 'document'}.varve-archive.zip`;
    }
    return 'varve-settings-archive.zip';
  }, [archiveKind, doc]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab('create');
      setCreatePhase('idle');
      setCreateProgress(0);
      setCreateStatus('');
      setCreateError(null);
      setCreateResult(null);
      setRestorePhase('idle');
      setRestoreProgress(0);
      setRestoreStatus('');
      setRestoreError(null);
      setRestoreResult(null);
      setRestoreFile(null);
      setRestoreManifest(null);
      setRestoreEncrypted(false);
      setRestorePassword('');
      setRestoreConflicts([]);
      setConfirmRestore(false);
      setPassword('');
      setConfirmPassword('');
      setEncryptionEnabled(false);
    }
  }, [open]);

  // Abort on unmount
  useEffect(() => {
    return () => {
      createAbortRef.current?.abort();
      restoreAbortRef.current?.abort();
    };
  }, []);

  // ── Create handlers ──────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    if (!canCreate) return;

    createAbortRef.current?.abort();
    const controller = new AbortController();
    createAbortRef.current = controller;

    setCreatePhase('preparing');
    setCreateProgress(0);
    setCreateStatus('Preparing archive\u2026');
    setCreateError(null);
    setCreateResult(null);

    try {
      const categories =
        archiveKind === 'settings-only' ? Array.from(selectedCategories) : undefined;

      const result = await buildArchive({
        kind: archiveKind,
        document:
          archiveKind === 'full'
            ? (doc as Parameters<typeof buildArchive>[0]['document'])
            : undefined,
        settingsCategories: categories,
        encryption: encryptionEnabled ? { enabled: true, password } : undefined,
        signal: controller.signal,
        onProgress: (phase, progress) => {
          setCreatePhase(phase as CreatePhase);
          setCreateProgress(progress);
          setCreateStatus(PHASE_LABELS[phase] ?? phase);
        },
      });

      setCreatePhase('complete');
      setCreateProgress(1);
      setCreateStatus('Archive created successfully');
      setCreateResult(result);
      onCreateArchive?.(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      setCreatePhase('error');
      setCreateError(msg);
      setCreateStatus('');
    }
  }, [
    canCreate,
    archiveKind,
    selectedCategories,
    encryptionEnabled,
    password,
    doc,
    onCreateArchive,
  ]);

  const handleCancelCreate = useCallback(() => {
    createAbortRef.current?.abort();
    setCreatePhase('idle');
    setCreateProgress(0);
    setCreateStatus('');
  }, []);

  const handleCategoryToggle = useCallback((cat: SettingsCategory) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const handleSelectAllCategories = useCallback(() => {
    setSelectedCategories(new Set(SETTINGS_CATEGORIES.map((c) => c.id)));
  }, []);

  const handleDeselectAllCategories = useCallback(() => {
    setSelectedCategories(new Set());
  }, []);

  const handleDownloadArchive = useCallback(async () => {
    if (!createResult) return;

    // Desktop: native Save dialog + the already-atomic write_binary_file
    // command (temp file, fsync, rename — never a partially-written
    // archive on disk). Browser: no filesystem access, so a plain download
    // is the only option and the browser itself handles it atomically.
    if (platform?.kind === 'tauri') {
      const savedPath = await platform.saveBinaryFile(
        createResult.fileName.replace(/\.zip$/, ''),
        createResult.bytes,
        'application/zip',
        '.zip',
      );
      if (savedPath) {
        setCreateStatus(`Archive saved to ${savedPath}`);
      }
      return;
    }

    const blob = new Blob([createResult.bytes as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = globalThis.document.createElement('a');
    a.href = url;
    a.download = createResult.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [createResult, platform]);

  // ── Restore handlers ─────────────────────────────────────────────────────

  const handleFileSelect = useCallback(async (file: File) => {
    setRestoreFile(file);
    setRestoreManifest(null);
    setRestoreEncrypted(false);
    setRestoreError(null);
    setRestoreResult(null);
    setRestoreConflicts([]);

    // Try to read manifest
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const validation = await validateArchive(bytes);
      if (validation.valid && validation.manifest) {
        setRestoreManifest(validation.manifest);
        setRestoreEncrypted(!!validation.manifest.encryption);
      } else {
        setRestoreError(validation.error ?? 'Invalid archive file');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRestoreError(`Failed to read archive: ${msg}`);
    }
  }, []);

  const handleFileDrop = useCallback(
    (e: DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dropZoneRef.current?.classList.remove('archive-dialog__drop-zone--active');

      const file = e.dataTransfer.files[0];
      if (file) {
        void handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  const handleFileDragOver = useCallback((e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.classList.add('archive-dialog__drop-zone--active');
  }, []);

  const handleFileDragLeave = useCallback((e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.classList.remove('archive-dialog__drop-zone--active');
  }, []);

  const handleFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        void handleFileSelect(file);
      }
      // Reset input so same file can be re-selected
      e.target.value = '';
    },
    [handleFileSelect],
  );

  const handleRemoveFile = useCallback(() => {
    setRestoreFile(null);
    setRestoreManifest(null);
    setRestoreEncrypted(false);
    setRestoreError(null);
    setRestoreResult(null);
    setRestoreConflicts([]);
    setRestorePassword('');
  }, []);

  const handleRestore = useCallback(async () => {
    if (!canRestore || !restoreFile) return;

    restoreAbortRef.current?.abort();
    const controller = new AbortController();
    restoreAbortRef.current = controller;

    setRestorePhase('validating');
    setRestoreProgress(0);
    setRestoreStatus('Validating archive\u2026');
    setRestoreError(null);
    setRestoreResult(null);
    setRestoreConflicts([]);

    try {
      const bytes = new Uint8Array(await restoreFile.arrayBuffer());

      // Preview pass only — deliberately omit `onConflict` so
      // restoreArchive's internal apply step (`applySettingsBackup`) never
      // runs here. Nothing is written to localStorage or handed to
      // onRestoreArchive until the user reviews this preview and clicks
      // "Apply Restore" in handleConfirmRestore below.
      const result = await restoreArchive({
        bytes,
        password: restoreEncrypted ? restorePassword : undefined,
        signal: controller.signal,
        onProgress: (phase, progress) => {
          setRestorePhase(phase as RestorePhase);
          setRestoreProgress(progress);
          setRestoreStatus(PHASE_LABELS[phase] ?? phase);
        },
      });

      const conflicts = detectConflicts(result.settings ?? [], collectSettingsBackup());

      setRestorePhase('complete');
      setRestoreProgress(1);
      setRestoreStatus('Preview ready — review before applying');
      setRestoreResult(result);
      setRestoreConflicts(conflicts);
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      setRestorePhase('error');
      setRestoreError(msg);
      setRestoreStatus('');
    }
  }, [canRestore, restoreFile, restoreEncrypted, restorePassword]);

  const handleCancelRestore = useCallback(() => {
    restoreAbortRef.current?.abort();
    setRestorePhase('idle');
    setRestoreProgress(0);
    setRestoreStatus('');
  }, []);

  const [isApplyingRestore, setIsApplyingRestore] = useState(false);

  const handleConfirmRestore = useCallback(async () => {
    if (!restoreResult) return;
    setIsApplyingRestore(true);
    setRestoreError(null);

    // Snapshot current settings so a partial-apply failure (e.g. a
    // localStorage quota error mid-way through applying categories) can be
    // reverted instead of leaving the app in a half-restored state.
    const rollback = createRollbackSnapshot();

    try {
      const applyResult = await applyRestore(restoreResult, { onConflict: conflictResolution });
      setConfirmRestore(true);
      setRestoreStatus(`Applied ${applyResult.applied} setting(s)`);
      onRestoreArchive?.(restoreResult);
    } catch (err) {
      const rolledBack = restoreRollbackSnapshot(rollback);
      const msg = err instanceof Error ? err.message : String(err);
      setRestoreError(
        rolledBack
          ? `Restore failed and your previous settings were restored: ${msg}`
          : `Restore failed: ${msg}. Rollback also failed — please check Settings before continuing.`,
      );
    } finally {
      setIsApplyingRestore(false);
    }
  }, [restoreResult, conflictResolution, onRestoreArchive]);

  // ── Tab key navigation ───────────────────────────────────────────────────

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setActiveTab((prev) => (prev === 'create' ? 'restore' : 'create'));
    }
  }, []);

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderCreateTab = () => (
    <>
      <section className="archive-dialog__section" aria-label="Archive type">
        <h3 className="archive-dialog__section-title">Archive type</h3>
        <div className="archive-dialog__type-group" role="radiogroup" aria-label="Archive type">
          <label
            className={`archive-dialog__type-btn${archiveKind === 'full' ? ' archive-dialog__type-btn--active' : ''}`}
          >
            <input
              type="radio"
              name="archive-kind"
              value="full"
              checked={archiveKind === 'full'}
              onChange={() => setArchiveKind('full')}
              className="sr-only"
            />
            <span className="archive-dialog__type-icon" aria-hidden="true">
              &#128194;
            </span>
            <span className="archive-dialog__type-label">Full Project</span>
            <span className="archive-dialog__type-desc">Document, assets, and settings</span>
          </label>
          <label
            className={`archive-dialog__type-btn${archiveKind === 'settings-only' ? ' archive-dialog__type-btn--active' : ''}`}
          >
            <input
              type="radio"
              name="archive-kind"
              value="settings-only"
              checked={archiveKind === 'settings-only'}
              onChange={() => setArchiveKind('settings-only')}
              className="sr-only"
            />
            <span className="archive-dialog__type-icon" aria-hidden="true">
              &#9881;
            </span>
            <span className="archive-dialog__type-label">Settings Only</span>
            <span className="archive-dialog__type-desc">Preferences and configuration</span>
          </label>
        </div>
      </section>

      {archiveKind === 'settings-only' && (
        <section className="archive-dialog__section" aria-label="Settings categories">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 className="archive-dialog__section-title">Settings categories</h3>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                type="button"
                className="archive-dialog__btn archive-dialog__btn--secondary"
                style={{
                  padding: 'var(--space-1) var(--space-2)',
                  fontSize: 'var(--font-size-xs)',
                }}
                onClick={handleSelectAllCategories}
              >
                Select all
              </button>
              <button
                type="button"
                className="archive-dialog__btn archive-dialog__btn--secondary"
                style={{
                  padding: 'var(--space-1) var(--space-2)',
                  fontSize: 'var(--font-size-xs)',
                }}
                onClick={handleDeselectAllCategories}
              >
                Deselect all
              </button>
            </div>
          </div>
          <div className="archive-dialog__checkbox-group">
            {SETTINGS_CATEGORIES.map((cat) => (
              <label key={cat.id} className="archive-dialog__checkbox">
                <input
                  type="checkbox"
                  checked={selectedCategories.has(cat.id)}
                  onChange={() => handleCategoryToggle(cat.id)}
                />
                <span className="archive-dialog__checkbox-label">
                  <span className="archive-dialog__checkbox-name">{cat.label}</span>
                  <span className="archive-dialog__checkbox-desc">{cat.description}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="archive-dialog__section" aria-label="Encryption">
        <label className="archive-dialog__encryption-toggle">
          <input
            type="checkbox"
            checked={encryptionEnabled}
            onChange={(e) => {
              setEncryptionEnabled(e.target.checked);
              if (!e.target.checked) {
                setPassword('');
                setConfirmPassword('');
              }
            }}
          />
          <span>Encrypt archive with password</span>
        </label>

        {encryptionEnabled && (
          <div className="archive-dialog__password-section">
            <div className="archive-dialog__password-row">
              <label htmlFor="archive-password" className="archive-dialog__password-label">
                Password
              </label>
              <input
                id="archive-password"
                type={showPassword ? 'text' : 'password'}
                className="archive-dialog__password-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                aria-describedby="archive-password-strength"
                placeholder="Minimum 8 characters"
              />
              <button
                type="button"
                className="archive-dialog__password-toggle"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            <div className="archive-dialog__password-row">
              <label htmlFor="archive-confirm-password" className="archive-dialog__password-label">
                Confirm
              </label>
              <input
                id="archive-confirm-password"
                type={showPassword ? 'text' : 'password'}
                className="archive-dialog__password-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={passwordMismatch}
                aria-describedby={passwordMismatch ? 'archive-password-mismatch' : undefined}
                placeholder="Re-enter password"
              />
              {passwordMismatch && (
                <span
                  id="archive-password-mismatch"
                  style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-feedback-danger)' }}
                >
                  Mismatch
                </span>
              )}
            </div>

            {password && passwordStrength && (
              <meter
                className="archive-dialog__strength"
                id="archive-password-strength"
                aria-label="Password strength"
                value={
                  passwordStrength.strength === 'weak'
                    ? 1
                    : passwordStrength.strength === 'fair'
                      ? 2
                      : passwordStrength.strength === 'strong'
                        ? 3
                        : 4
                }
                min={1}
                max={4}
              >
                <span className="archive-dialog__strength-bar">
                  <span
                    className={`archive-dialog__strength-fill archive-dialog__strength-fill--${passwordStrength.strength}`}
                  />
                </span>
                <span
                  className={`archive-dialog__strength-label archive-dialog__strength-label--${passwordStrength.strength}`}
                >
                  {strengthLabel(passwordStrength.strength, passwordStrength.isCommon)}
                </span>
                {passwordStrength.isCommon && (
                  <span className="archive-dialog__strength-breach" role="alert">
                    This password appears in known breach datasets — choose a unique one.
                  </span>
                )}
              </meter>
            )}
          </div>
        )}
      </section>

      <section className="archive-dialog__section" aria-label="Destination">
        <h3 className="archive-dialog__section-title">File name</h3>
        <div className="archive-dialog__destination">{destinationName}</div>
      </section>

      {(createPhase !== 'idle' || createResult) && (
        <section className="archive-dialog__section" aria-label="Progress">
          <h3 className="archive-dialog__section-title">Progress</h3>
          <div className="archive-dialog__progress">
            <div className="archive-dialog__progress-phase">{createStatus}</div>
            <div
              className="archive-dialog__progress-bar"
              role="progressbar"
              aria-valuenow={Math.round(createProgress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="archive-dialog__progress-fill"
                style={{ width: `${createProgress * 100}%` }}
              />
            </div>
          </div>
        </section>
      )}

      {createError && (
        <div className="archive-dialog__error" role="alert">
          <span className="archive-dialog__error-icon" aria-hidden="true">
            &#9888;
          </span>
          <span className="archive-dialog__error-text">{createError}</span>
        </div>
      )}

      {createResult && (
        <section className="archive-dialog__section" aria-label="Result">
          <div className="archive-dialog__preview">
            <div className="archive-dialog__preview-title">Archive ready</div>
            <div className="archive-dialog__preview-row">
              <span className="archive-dialog__preview-key">File</span>
              <span className="archive-dialog__preview-value">{createResult.fileName}</span>
            </div>
            <div className="archive-dialog__preview-row">
              <span className="archive-dialog__preview-key">Size</span>
              <span className="archive-dialog__preview-value">
                {formatBytes(createResult.bytes.byteLength)}
              </span>
            </div>
            <div className="archive-dialog__preview-row">
              <span className="archive-dialog__preview-key">Type</span>
              <span className="archive-dialog__preview-value">
                {createResult.manifest.kind === 'full' ? 'Full project' : 'Settings only'}
              </span>
            </div>
            {createResult.manifest.document && (
              <div className="archive-dialog__preview-row">
                <span className="archive-dialog__preview-key">Document</span>
                <span className="archive-dialog__preview-value">
                  {createResult.manifest.document.name} ({createResult.manifest.document.nodeCount}{' '}
                  nodes)
                </span>
              </div>
            )}
            {createResult.manifest.settings && (
              <div className="archive-dialog__preview-row">
                <span className="archive-dialog__preview-key">Categories</span>
                <span className="archive-dialog__preview-value">
                  {createResult.manifest.settings.categories.length} (
                  {createResult.manifest.settings.itemCount} items)
                </span>
              </div>
            )}
            {createResult.manifest.encryption && (
              <div className="archive-dialog__preview-row">
                <span className="archive-dialog__preview-key">Encryption</span>
                <span className="archive-dialog__preview-value">
                  {createResult.manifest.encryption.algorithm} +{' '}
                  {createResult.manifest.encryption.kdf}
                </span>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );

  const renderRestoreTab = () => (
    <>
      <section className="archive-dialog__section" aria-label="Select archive">
        <h3 className="archive-dialog__section-title">Select archive file</h3>

        {!restoreFile ? (
          <button
            type="button"
            ref={dropZoneRef as React.RefObject<HTMLButtonElement>}
            className="archive-dialog__drop-zone"
            aria-label="Drop an archive file here or click to browse"
            onDrop={handleFileDrop}
            onDragOver={handleFileDragOver}
            onDragLeave={handleFileDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="archive-dialog__drop-icon" aria-hidden="true">
              &#128194;
            </span>
            <span className="archive-dialog__drop-text">Drop archive here or click to browse</span>
            <span className="archive-dialog__drop-hint">
              Supports .zip and .varve-archive.zip files (legacy .strata-archive.zip also supported)
            </span>
            <input
              ref={fileInputRef}
              type="file"
              className="archive-dialog__drop-input"
              accept=".zip,.varve-archive.zip,.strata-archive.zip"
              onChange={handleFileInputChange}
              aria-hidden="true"
              tabIndex={-1}
            />
          </button>
        ) : (
          <div className="archive-dialog__file-name">
            <span aria-hidden="true">&#128196;</span>
            <span>{restoreFile.name}</span>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>
              ({formatBytes(restoreFile.size)})
            </span>
            {restorePhase === 'idle' && (
              <button
                type="button"
                className="archive-dialog__file-remove"
                aria-label="Remove file"
                onClick={handleRemoveFile}
              >
                &#10005;
              </button>
            )}
          </div>
        )}
      </section>

      {restoreManifest && (
        <section className="archive-dialog__section" aria-label="Archive preview">
          <div className="archive-dialog__preview">
            <div className="archive-dialog__preview-title">Archive contents</div>
            <div className="archive-dialog__preview-row">
              <span className="archive-dialog__preview-key">Type</span>
              <span className="archive-dialog__preview-value">
                {restoreManifest.kind === 'full' ? 'Full project' : 'Settings only'}
              </span>
            </div>
            <div className="archive-dialog__preview-row">
              <span className="archive-dialog__preview-key">Created</span>
              <span className="archive-dialog__preview-value">
                {formatDate(restoreManifest.createdAt)}
              </span>
            </div>
            <div className="archive-dialog__preview-row">
              <span className="archive-dialog__preview-key">App version</span>
              <span className="archive-dialog__preview-value">{restoreManifest.appVersion}</span>
            </div>
            <div className="archive-dialog__preview-row">
              <span className="archive-dialog__preview-key">Format version</span>
              <span className="archive-dialog__preview-value">{restoreManifest.formatVersion}</span>
            </div>

            {restoreManifest.document && (
              <>
                <div className="archive-dialog__preview-row">
                  <span className="archive-dialog__preview-key">Document</span>
                  <span className="archive-dialog__preview-value">
                    {restoreManifest.document.name}
                  </span>
                </div>
                <div className="archive-dialog__preview-row">
                  <span className="archive-dialog__preview-key">Nodes</span>
                  <span className="archive-dialog__preview-value">
                    {restoreManifest.document.nodeCount}
                  </span>
                </div>
              </>
            )}

            {restoreManifest.settings && (
              <>
                <div className="archive-dialog__preview-row">
                  <span className="archive-dialog__preview-key">Settings items</span>
                  <span className="archive-dialog__preview-value">
                    {restoreManifest.settings.itemCount}
                  </span>
                </div>
                <div className="archive-dialog__preview-categories">
                  {restoreManifest.settings.categories.map((cat) => (
                    <span key={cat} className="archive-dialog__preview-tag">
                      {cat}
                    </span>
                  ))}
                </div>
              </>
            )}

            {restoreManifest.encryption && (
              <div className="archive-dialog__preview-row">
                <span className="archive-dialog__preview-key">Encrypted</span>
                <span className="archive-dialog__preview-value">
                  {restoreManifest.encryption.algorithm}
                </span>
              </div>
            )}

            {restoreManifest.compatibility.minAppVersion !== '0.1.0' && (
              <div className="archive-dialog__preview-warn">
                Requires app version {restoreManifest.compatibility.minAppVersion} or later
              </div>
            )}
          </div>
        </section>
      )}

      {restoreEncrypted && restoreFile && (
        <section className="archive-dialog__section" aria-label="Password">
          <h3 className="archive-dialog__section-title">Password</h3>
          <p className="archive-dialog__section-desc">
            This archive is encrypted. Enter the password to decrypt.
          </p>
          <div className="archive-dialog__password-section">
            <div className="archive-dialog__password-row">
              <label htmlFor="restore-password" className="archive-dialog__password-label">
                Password
              </label>
              <input
                id="restore-password"
                type={showPassword ? 'text' : 'password'}
                className="archive-dialog__password-input"
                value={restorePassword}
                onChange={(e) => setRestorePassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter archive password"
              />
              <button
                type="button"
                className="archive-dialog__password-toggle"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </section>
      )}

      {(restorePhase !== 'idle' || restoreResult) && (
        <section className="archive-dialog__section" aria-label="Progress">
          <h3 className="archive-dialog__section-title">Progress</h3>
          <div className="archive-dialog__progress">
            <div className="archive-dialog__progress-phase">{restoreStatus}</div>
            <div
              className="archive-dialog__progress-bar"
              role="progressbar"
              aria-valuenow={Math.round(restoreProgress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="archive-dialog__progress-fill"
                style={{ width: `${restoreProgress * 100}%` }}
              />
            </div>
          </div>
        </section>
      )}

      {restoreError && (
        <div className="archive-dialog__error" role="alert">
          <span className="archive-dialog__error-icon" aria-hidden="true">
            &#9888;
          </span>
          <span className="archive-dialog__error-text">{restoreError}</span>
        </div>
      )}

      {restoreResult && !confirmRestore && (
        <section className="archive-dialog__section" aria-label="Restore preview">
          <div className="archive-dialog__preview">
            <div className="archive-dialog__preview-title">Restore preview</div>

            {restoreResult.document && (
              <>
                <div className="archive-dialog__preview-row">
                  <span className="archive-dialog__preview-key">Document</span>
                  <span className="archive-dialog__preview-value">
                    {restoreResult.document.name}
                  </span>
                </div>
                <div className="archive-dialog__preview-row">
                  <span className="archive-dialog__preview-key">Nodes</span>
                  <span className="archive-dialog__preview-value">
                    {Object.keys(restoreResult.document.nodes).length}
                  </span>
                </div>
              </>
            )}

            {restoreResult.restoredCategories.length > 0 && (
              <div className="archive-dialog__preview-categories">
                {restoreResult.restoredCategories.map((cat) => (
                  <span key={cat} className="archive-dialog__preview-tag">
                    {cat}
                  </span>
                ))}
              </div>
            )}

            {restoreResult.warnings.length > 0 && (
              <div className="archive-dialog__preview-warn">
                {restoreResult.warnings.length} warning(s) during extraction
              </div>
            )}
          </div>
        </section>
      )}

      {restoreConflicts.length > 0 && (
        <section className="archive-dialog__section" aria-label="Conflicts">
          <div className="archive-dialog__conflicts">
            <div className="archive-dialog__conflicts-title">
              {restoreConflicts.length} conflict(s) detected
            </div>
            <ul className="archive-dialog__conflicts-list">
              {restoreConflicts.slice(0, 10).map((c) => (
                <li key={`${c.category}:${c.key}`} className="archive-dialog__conflict-item">
                  <span className="archive-dialog__conflict-category">{c.category}</span>
                  {' / '}
                  {c.key}
                </li>
              ))}
              {restoreConflicts.length > 10 && (
                <li className="archive-dialog__conflict-item">
                  +{restoreConflicts.length - 10} more conflicts
                </li>
              )}
            </ul>
            <div className="archive-dialog__conflict-resolve">
              <Select
                label="Conflict resolution strategy"
                value={conflictResolution}
                onChange={(v) => setConflictResolution(v as 'overwrite' | 'skip' | 'merge')}
                options={[
                  { value: 'overwrite', label: 'Overwrite existing' },
                  { value: 'skip', label: 'Skip conflicts' },
                  { value: 'merge', label: 'Merge values' },
                ]}
              />
            </div>
          </div>
        </section>
      )}

      {restoreResult && !confirmRestore && (
        <div className="archive-dialog__warning">
          <span className="archive-dialog__warning-icon" aria-hidden="true">
            &#9888;
          </span>
          <span>Restoring will overwrite current settings. This action cannot be undone.</span>
        </div>
      )}
    </>
  );

  const isCreating =
    createPhase !== 'idle' && createPhase !== 'complete' && createPhase !== 'error';
  const isRestoring =
    restorePhase !== 'idle' && restorePhase !== 'complete' && restorePhase !== 'error';

  return (
    <Dialog open={open} onClose={onClose} title="Archive" dismissible>
      <div className="archive-dialog__tabs" role="tablist" aria-label="Archive actions">
        <button
          type="button"
          role="tab"
          id="archive-tab-create"
          aria-selected={activeTab === 'create'}
          aria-controls="archive-tabpanel-create"
          className={`archive-dialog__tab${activeTab === 'create' ? ' archive-dialog__tab--active' : ''}`}
          onClick={() => setActiveTab('create')}
          onKeyDown={handleTabKeyDown}
        >
          Create Archive
        </button>
        <button
          type="button"
          role="tab"
          id="archive-tab-restore"
          aria-selected={activeTab === 'restore'}
          aria-controls="archive-tabpanel-restore"
          className={`archive-dialog__tab${activeTab === 'restore' ? ' archive-dialog__tab--active' : ''}`}
          onClick={() => setActiveTab('restore')}
          onKeyDown={handleTabKeyDown}
        >
          Restore Archive
        </button>
      </div>

      <div className="archive-dialog__body">
        {activeTab === 'create' && (
          <div id="archive-tabpanel-create" role="tabpanel" aria-labelledby="archive-tab-create">
            {renderCreateTab()}
          </div>
        )}

        {activeTab === 'restore' && (
          <div id="archive-tabpanel-restore" role="tabpanel" aria-labelledby="archive-tab-restore">
            {renderRestoreTab()}
          </div>
        )}
      </div>

      <div className="archive-dialog__actions">
        {activeTab === 'create' ? (
          <>
            <button
              type="button"
              className="archive-dialog__btn archive-dialog__btn--secondary"
              onClick={onClose}
              disabled={isCreating}
            >
              Close
            </button>
            {createResult && (
              <button
                type="button"
                className="archive-dialog__btn archive-dialog__btn--secondary"
                onClick={() => void handleDownloadArchive()}
              >
                Download
              </button>
            )}
            {isCreating ? (
              <button
                type="button"
                className="archive-dialog__btn archive-dialog__btn--danger"
                onClick={handleCancelCreate}
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className={`archive-dialog__btn archive-dialog__btn--primary${isCreating ? ' archive-dialog__btn--loading' : ''}`}
                disabled={!canCreate}
                onClick={() => void handleCreate()}
              >
                Create Archive
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="archive-dialog__btn archive-dialog__btn--secondary"
              onClick={onClose}
              disabled={isRestoring || isApplyingRestore}
            >
              Close
            </button>
            {isRestoring ? (
              <button
                type="button"
                className="archive-dialog__btn archive-dialog__btn--danger"
                onClick={handleCancelRestore}
              >
                Cancel
              </button>
            ) : restoreResult && !confirmRestore ? (
              <button
                type="button"
                className={`archive-dialog__btn archive-dialog__btn--danger${isApplyingRestore ? ' archive-dialog__btn--loading' : ''}`}
                disabled={isApplyingRestore}
                onClick={() => void handleConfirmRestore()}
              >
                {isApplyingRestore ? 'Applying…' : 'Apply Restore'}
              </button>
            ) : (
              <button
                type="button"
                className={`archive-dialog__btn archive-dialog__btn--primary${isRestoring ? ' archive-dialog__btn--loading' : ''}`}
                disabled={!canRestore}
                onClick={() => void handleRestore()}
              >
                Restore
              </button>
            )}
          </>
        )}
      </div>

      <div role="status" aria-live="polite" className="varve-visually-hidden">
        {createStatus || restoreStatus}
      </div>
    </Dialog>
  );
}
