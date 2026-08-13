import { managedColorToCss, PRODUCT_STATUS } from '@varve/shared';
import {
  Button,
  Dialog,
  NestedOverlayProvider,
  NumberInput,
  Select,
  Tooltip,
  TooltipProvider,
  VarveLogo,
} from '@varve/ui';
import { getTheme, setTheme } from '@varve/ui/tokens';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { bumpThemeRevision, getBackupService, useOptionalEditor } from '../../context';
import { PrivacyDiagnosticsSection } from '../../crash';
import { loadSettings, type ThemeMode, type UnitType, updateSettings } from '../../settings';
import { ShortcutPalette } from '../../shortcuts';
import { getReservedShortcutsForTarget } from '../../shortcuts/reservedShortcuts';
import { useOptionalUpdateCoordinator } from '../../updates';
import { BackupSettingsPanel } from '../Backup/BackupSettingsPanel';
import { InspectorColorPopover } from '../Inspector/controls/InspectorColorPopover';
import { whiteForMode } from '../Inspector/panels/DocumentPanel';
import { BgRemovalModelsTab } from './BgRemovalModelsTab';
import { ColorizationModelsTab } from './ColorizationModelsTab';
import { ExportSettingsTab } from './ExportSettingsTab';
import { PerformanceSettingsTab } from './PerformanceSettingsTab';
import type { SettingsSection } from './SettingsContext';
import { useSettings } from './SettingsContext';

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'backup', label: 'Backup & Recovery' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts' },
  { id: 'export', label: 'Export' },
  { id: 'performance', label: 'Performance' },
  { id: 'models', label: 'Offline Models' },
  { id: 'collab', label: 'Collab' },
  { id: 'ai', label: 'On-device Assistants' },
  { id: 'privacy', label: 'Privacy & Diagnostics' },
  { id: 'updates', label: 'Updates' },
  { id: 'about', label: 'About' },
];

const UNIT_OPTIONS = [
  { value: 'px', label: 'px' },
  { value: 'pt', label: 'pt' },
  { value: 'cm', label: 'cm' },
  { value: 'mm', label: 'mm' },
  { value: 'in', label: 'in' },
];

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'high-contrast', label: 'High Contrast' },
  { value: 'system', label: 'System' },
];

const FONT_SIZE_OPTIONS = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialSection?: SettingsSection;
  onOnboardingReset?: () => void;
}

export function SettingsDialog({
  open,
  onClose,
  initialSection = 'general',
  onOnboardingReset,
}: SettingsDialogProps) {
  const { updateSection, resetSettings } = useSettings();
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    if (open) setActiveSection(initialSection);
  }, [open, initialSection]);

  const handleThemeChange = useCallback(
    (theme: string) => {
      updateSection('appearance', { theme: theme as ThemeMode });
      if (theme !== 'system') {
        setTheme(theme as 'light' | 'dark' | 'high-contrast');
        localStorage.setItem('varve-theme', theme);
      } else {
        // "System" = remove explicit data-theme so CSS @media (prefers-color-scheme) takes over
        delete document.documentElement.dataset.theme;
        localStorage.removeItem('strata-theme');
      }
      bumpThemeRevision();
    },
    [updateSection],
  );

  const handleReset = useCallback(() => {
    resetSettings();
    setTheme('light');
    localStorage.setItem('varve-theme', 'light');
    bumpThemeRevision();
  }, [resetSettings]);

  return (
    <NestedOverlayProvider>
      <Dialog
        open={open}
        onClose={onClose}
        title="Settings"
        dismissible
        className="varve-dialog--settings"
      >
        <div className="settings-dialog__layout">
          <nav className="settings-dialog__nav" aria-label="Settings sections">
            {SECTIONS.map((sec) => (
              <button
                key={sec.id}
                id={`settings-tab-${sec.id}`}
                type="button"
                role="tab"
                aria-selected={activeSection === sec.id}
                aria-controls="settings-tabpanel"
                className={`settings-dialog__tab${activeSection === sec.id ? ' settings-dialog__tab--active' : ''}`}
                onClick={() => setActiveSection(sec.id)}
              >
                {sec.label}
              </button>
            ))}
          </nav>

          <div
            className="settings-dialog__content"
            id="settings-tabpanel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${activeSection}`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: APG pattern — tabpanel is a focus target
            tabIndex={0}
          >
            {activeSection === 'general' && (
              <GeneralSection onOnboardingReset={onOnboardingReset} />
            )}
            {activeSection === 'appearance' && (
              <AppearanceSection onThemeChange={handleThemeChange} />
            )}
            {activeSection === 'backup' && (
              <BackupSettingsPanel backupService={getBackupService()!} onClose={onClose} />
            )}
            {activeSection === 'shortcuts' && (
              <ShortcutsSection onOpenPalette={() => setShortcutsOpen(true)} />
            )}
            {activeSection === 'export' && <ExportSettingsTab />}
            {activeSection === 'performance' && <PerformanceSettingsTab />}
            {activeSection === 'models' && (
              <>
                <BgRemovalModelsTab />
                <ColorizationModelsTab />
              </>
            )}
            {activeSection === 'collab' && <CollabSection />}
            {activeSection === 'ai' && <AISection />}
            {activeSection === 'privacy' && <PrivacyDiagnosticsSection />}
            {activeSection === 'updates' && <UpdatesSection />}
            {activeSection === 'about' && <AboutSection />}
          </div>
        </div>

        <div className="settings-dialog__footer">
          <Button variant="ghost" size="sm" onClick={handleReset}>
            Reset to defaults
          </Button>
        </div>
      </Dialog>

      <ShortcutPalette
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        onSelect={() => setShortcutsOpen(false)}
      />
    </NestedOverlayProvider>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-field-row">
      <span className="settings-field-row__label">{label}</span>
      <div className="settings-field-row__control">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="settings-divider" />;
}

function GeneralSection({ onOnboardingReset }: { onOnboardingReset?: () => void }) {
  const { settings, updateSection, updateSettings: updateSettingsCtx } = useSettings();
  const editor = useOptionalEditor();
  // Document-scoped controls (canvas background) need an open document; the
  // Home screen has none, so those rows are omitted there.
  const fallbackColor = useMemo(
    () => whiteForMode(editor?.documentColorMode ?? 'rgb'),
    [editor?.documentColorMode],
  );
  const canvasBgColor = editor?.state.document.canvasBackground ?? fallbackColor;
  const swatchBackground = useMemo(() => managedColorToCss(canvasBgColor), [canvasBgColor]);

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">General</h3>
      <FieldRow label="Language">
        <Select
          options={[{ value: 'en', label: 'English' }]}
          value={settings.general.language}
          onChange={(v) => updateSection('general', { language: v })}
          label="Language"
        />
      </FieldRow>
      <FieldRow label="Units">
        <Select
          options={UNIT_OPTIONS}
          value={settings.general.units}
          onChange={(v) => updateSection('general', { units: v as UnitType })}
          label="Units"
        />
      </FieldRow>
      {editor && (
        <>
          <FieldRow label="Canvas background">
            <InspectorColorPopover
              label="Canvas background"
              value={canvasBgColor}
              onChange={editor.setCanvasBackground}
              swatchStyle={{ background: swatchBackground }}
              documentColorMode={editor.documentColorMode}
              className="settings-color-swatch"
              onEditStart={editor.beginTransaction}
              onEditEnd={editor.commitTransaction}
            />
          </FieldRow>
          <p className="settings-hint">
            Background of the currently open document. Changes apply immediately.
          </p>
        </>
      )}
      <FieldRow label="Autosave interval (min)">
        <NumberInput
          value={settings.general.autosaveInterval}
          min={1}
          max={60}
          step={1}
          onChange={(v) => updateSection('general', { autosaveInterval: v })}
          label="Autosave interval"
        />
      </FieldRow>
      <Divider />
      <h3 className="settings-section__title">Render performance</h3>
      <FieldRow label="WebGPU compositor">
        <label className="settings-checkbox-row">
          <input
            type="checkbox"
            checked={settings.render.preferWebGpu}
            onChange={(e) => {
              const next = e.target.checked;
              updateSettingsCtx({ render: { preferWebGpu: next } });
            }}
          />
          <span>Prefer WebGPU when available</span>
        </label>
      </FieldRow>
      <p className="settings-hint">
        Reload the document tab after changing. Uses an offscreen WebGPU surface and keeps the
        content canvas on Canvas2D (so the editor never blanks). Falls back to Canvas2D on device
        loss or unsupported primitives. Unavailable on Linux WebKitGTK. Status bar shows the active
        backend.
      </p>
      <Divider />
      <h3 className="settings-section__title">Onboarding</h3>
      <p className="settings-desc">
        Reset the welcome dialog, tour progress, checklist, and dismissed tips. Use Help &gt; Take a
        tour to replay the spotlight tour anytime.
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          onOnboardingReset?.();
        }}
      >
        Reset onboarding
      </Button>
    </div>
  );
}

function AppearanceSection({ onThemeChange }: { onThemeChange: (theme: string) => void }) {
  const { settings, updateSection } = useSettings();
  const currentTheme = getTheme();
  const [showAllItems, setShowAllItems] = useState(
    () => loadSettings().appearance.showAllMenuItems,
  );

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Appearance</h3>
      <FieldRow label="Theme">
        <Select
          options={THEME_OPTIONS}
          value={settings.appearance.theme}
          onChange={onThemeChange}
          label="Theme"
        />
      </FieldRow>
      {settings.appearance.theme !== 'system' && (
        <p className="settings-hint">
          Current theme: {currentTheme ?? 'light'}. Select &ldquo;System&rdquo; to follow OS
          preference.
        </p>
      )}
      <FieldRow label="UI font size">
        <Select
          options={FONT_SIZE_OPTIONS}
          value={settings.appearance.fontSizeUI}
          onChange={(v) => updateSection('appearance', { fontSizeUI: v })}
          label="UI font size"
        />
      </FieldRow>
      <FieldRow label="Menu items">
        <label className="settings-checkbox-row">
          <input
            type="checkbox"
            checked={showAllItems}
            onChange={(e) => {
              const next = e.target.checked;
              setShowAllItems(next);
              updateSettings({ appearance: { showAllMenuItems: next } });
            }}
          />
          <span>Show all menu items (bypass workspace mode filtering)</span>
        </label>
      </FieldRow>
    </div>
  );
}

function ShortcutsSection({ onOpenPalette }: { onOpenPalette: () => void }) {
  const reserved = getReservedShortcutsForTarget();

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Keyboard Shortcuts</h3>
      <p className="settings-desc">Customize keyboard shortcuts for all editor actions.</p>
      <Button variant="secondary" size="sm" onClick={onOpenPalette}>
        Customize keyboard shortcuts...
      </Button>
      <Divider />
      <h4 className="settings-section__subtitle">
        {reserved.target === 'browser' ? 'Browser-reserved shortcuts' : 'OS-reserved shortcuts'}
      </h4>
      <p className="settings-hint">
        {reserved.target === 'browser'
          ? 'These shortcuts are owned by the browser and cannot be overridden in the web build.'
          : 'Varve desktop can register app shortcuts via Tauri; these remain reserved by the OS.'}
      </p>
      <table className="settings-shortcuts-table">
        <thead>
          <tr>
            <th scope="col">Shortcut</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {reserved.shortcuts.map((row) => (
            <tr key={row.keys}>
              <td>
                <code>{row.keys}</code>
              </td>
              <td>{row.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CollabSection() {
  const { settings, updateSection } = useSettings();

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Collaboration</h3>
      <FieldRow label="Display name">
        <input
          type="text"
          className="settings-text-input"
          value={settings.collab.displayName}
          onChange={(e) => updateSection('collab', { displayName: e.target.value })}
          placeholder="Your name"
          aria-label="Display name"
        />
      </FieldRow>
      <FieldRow label="Avatar">
        <input
          type="file"
          accept="image/*"
          className="settings-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = () => {
                updateSection('collab', { avatar: reader.result as string });
              };
              reader.readAsDataURL(file);
            }
          }}
          aria-label="Choose avatar image"
        />
      </FieldRow>
      <Divider />
      <FieldRow label="Notifications">
        <label className="settings-checkbox-row">
          <input
            type="checkbox"
            checked={settings.collab.notifyJoinLeave}
            onChange={(e) => updateSection('collab', { notifyJoinLeave: e.target.checked })}
          />
          <span>Notify when collaborators join/leave</span>
        </label>
      </FieldRow>
      <FieldRow label="Cursors">
        <label className="settings-checkbox-row">
          <input
            type="checkbox"
            checked={settings.collab.showLiveCursors}
            onChange={(e) => updateSection('collab', { showLiveCursors: e.target.checked })}
          />
          <span>Show live cursors</span>
        </label>
      </FieldRow>
    </div>
  );
}

function AISection() {
  return (
    <div className="settings-section">
      <h3 className="settings-section__title">On-device Assistants</h3>
      <p className="settings-section__description">
        Varve's design assistants (contrast checks, design-debt scans, layer-name suggestions,
        spacing harmonization) run entirely on your device. Nothing is sent to a server and no model
        downloads are required — the assistants work offline and never leave your document.
      </p>
      <FieldRow label="Usage & diagnostics">
        <span className="settings-section__description">
          Consent for product analytics and diagnostic reports is managed in the Privacy section.
        </span>
      </FieldRow>
    </div>
  );
}

function AboutSection() {
  return (
    <div className="settings-section">
      <h3 className="settings-section__title">About Varve</h3>
      <div className="settings-about">
        <div className="settings-about__brand" aria-hidden>
          <VarveLogo size={56} />
        </div>
        <div className="settings-about__row">
          <span className="settings-about__key">Status</span>
          <span className="settings-about__value">{PRODUCT_STATUS.label}</span>
        </div>
        <div className="settings-about__row">
          <span className="settings-about__key">License</span>
          <span className="settings-about__value">FSL-1.1-MIT</span>
        </div>
        <Divider />
        <div className="settings-about__links">
          <TooltipProvider>
            <Tooltip
              label="Not yet available in this build"
              disabledReason="Not yet available in this build"
            >
              <button type="button" className="settings-about__link" disabled>
                View changelog
              </button>
            </Tooltip>
            <Tooltip
              label="Not yet available in this build"
              disabledReason="Not yet available in this build"
            >
              <button type="button" className="settings-about__link" disabled>
                Software bill of materials (SBOM)
              </button>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}

function UpdatesSection() {
  const updates = useOptionalUpdateCoordinator();
  if (!updates) {
    return (
      <div className="settings-section">
        <h3 className="settings-section__title">Updates</h3>
        <p className="settings-desc">Updates are unavailable in this build.</p>
      </div>
    );
  }

  const { context, preferences, state } = updates;
  const canUseUpdater = context?.updateAuthority === 'self-managed' && context.runtimeSupported;
  const status = updateStatusLabel(state);

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Updates</h3>
      <p className="settings-desc">
        Update checks contact Varve's configured release endpoint. No account, document data, or
        device identifier is sent.
      </p>
      <div className="settings-about">
        <div className="settings-about__row">
          <span className="settings-about__key">Version</span>
          <span className="settings-about__value">{context?.currentVersion ?? 'Unavailable'}</span>
        </div>
        <div className="settings-about__row">
          <span className="settings-about__key">Channel</span>
          <span className="settings-about__value">{context?.channel ?? preferences.channel}</span>
        </div>
        <div className="settings-about__row">
          <span className="settings-about__key">Build</span>
          <span className="settings-about__value">{context?.buildLabel ?? 'Unavailable'}</span>
        </div>
        <div className="settings-about__row">
          <span className="settings-about__key">Update authority</span>
          <span className="settings-about__value">{authorityLabel(context?.updateAuthority)}</span>
        </div>
      </div>
      <Divider />
      <h4 className="settings-section__subtitle">Update permission</h4>
      <fieldset className="settings-fieldset">
        <legend className="settings-sr-only">Update permission</legend>
        {(
          [
            ['manual', 'Manual — only check when I ask'],
            ['notify', 'Automatically check and notify me'],
            ['download-automatically', 'Automatically check and download verified updates'],
          ] as const
        ).map(([value, label]) => (
          <label className="settings-checkbox-row" key={value}>
            <input
              type="radio"
              name="update-consent"
              value={value}
              checked={preferences.consent === value}
              onChange={() => updates.setPreferences({ consent: value })}
              disabled={!canUseUpdater}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <label className="settings-checkbox-row">
        <input
          type="checkbox"
          checked={preferences.installOnQuit}
          onChange={(event) => updates.setPreferences({ installOnQuit: event.target.checked })}
          disabled={!canUseUpdater || preferences.consent !== 'download-automatically'}
        />
        <span>Install a verified update when I quit Varve</span>
      </label>
      <p className="settings-hint">
        Installation still waits for the normal save/close workflow. Varve never discards unsaved
        design work to apply an update.
      </p>
      <Divider />
      <p className="settings-hint" role="status" aria-live="polite">
        Current status: {status}
      </p>
      {(context?.installLocation === 'translocated' ||
        context?.installLocation === 'not-writable') &&
        context?.platform === 'darwin' && (
          <p className="settings-hint">
            Move Varve into your Applications folder and launch it from there to enable updates.
          </p>
        )}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void updates.check()}
        disabled={!canUseUpdater || state.kind === 'checking'}
      >
        {state.kind === 'checking' ? 'Checking…' : 'Check for Updates'}
      </Button>
      {state.kind === 'update-available' && (
        <>
          {state.update.notes && <p className="settings-release-notes">{state.update.notes}</p>}
          <div className="settings-dialog__footer">
            <Button variant="primary" size="sm" onClick={() => void updates.download()}>
              Download {state.update.version}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => updates.defer()}>
              Later
            </Button>
            <Button variant="ghost" size="sm" onClick={() => updates.skipVersion()}>
              Skip this version
            </Button>
          </div>
        </>
      )}
      {state.kind === 'downloading' && (
        <p className="settings-hint" role="status" aria-live="polite">
          {status}
        </p>
      )}
      {state.kind === 'ready-to-install' && (
        <div className="settings-dialog__footer">
          <p className="settings-hint" role="status">
            Version {state.update.version} is downloaded and cryptographically verified. Varve will
            save or ask about unsaved documents before restarting.
          </p>
          <Button variant="primary" size="sm" onClick={() => void updates.installAndRestart()}>
            Install and Restart
          </Button>
        </div>
      )}
      {state.kind === 'error' && <p className="settings-hint">{state.error.message}</p>}
    </div>
  );
}

function authorityLabel(authority: string | undefined): string {
  switch (authority) {
    case 'self-managed':
      return 'Varve Releases';
    case 'package-manager-managed':
      return 'System package manager';
    case 'store-managed':
      return 'App store';
    case 'development-build':
      return 'Development build';
    default:
      return 'Unavailable for this build';
  }
}

function updateStatusLabel(state: import('../../updates').UpdateState): string {
  switch (state.kind) {
    case 'consent-required':
      return 'Choose whether Varve may check for updates.';
    case 'disabled':
      return 'Updates are checked manually.';
    case 'idle':
      return 'Ready to check.';
    case 'checking':
      return 'Checking…';
    case 'up-to-date':
      return 'Varve is up to date.';
    case 'update-available':
      return `Version ${state.update.version} is available.`;
    case 'downloading':
      return state.totalBytes
        ? `Downloading ${Math.round((state.downloadedBytes / state.totalBytes) * 100)}%.`
        : 'Downloading…';
    case 'verifying':
      return 'Verifying…';
    case 'ready-to-install':
      return 'Ready to install.';
    case 'installing':
      return 'Installing…';
    case 'restart-required':
      return 'Restart required.';
    case 'deferred':
      return 'Update deferred.';
    case 'cancelled':
      return 'Update cancelled.';
    case 'unsupported':
      return state.reason.message;
    case 'externally-managed':
      return 'Updates are managed by the system package manager or store.';
    case 'error':
      return state.error.message;
  }
}
