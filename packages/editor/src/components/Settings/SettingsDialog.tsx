import { managedColorToRgba } from '@strata/shared';
import type { ManagedColor } from '@strata/scene';
import { Button, ColorPicker, Dialog, NumberInput, Select } from '@strata/ui';
import { getTheme, setTheme } from '@strata/ui/tokens';
import { useCallback, useEffect, useState } from 'react';
import { ShortcutPalette } from '../../shortcuts';
import { ExportSettingsTab } from './ExportSettingsTab';
import { useSettings } from './SettingsContext';
import type { SettingsSection, ThemeMode, UnitType } from './settings';

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts' },
  { id: 'export', label: 'Export' },
  { id: 'collab', label: 'Collab' },
  { id: 'ai', label: 'AI Assistant' },
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

const AI_MODEL_OPTIONS = [
  { value: 'gpt-4', label: 'GPT-4' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'claude-3', label: 'Claude 3' },
  { value: 'claude-3.5', label: 'Claude 3.5 Sonnet' },
];

function hexToColor(hex: string): ManagedColor {
  const h = hex.replace('#', '');
  const r = Number.parseInt(h.substring(0, 2), 16) || 0;
  const g = Number.parseInt(h.substring(2, 4), 16) || 0;
  const b = Number.parseInt(h.substring(4, 6), 16) || 0;
  return { space: 'rgb', r, g, b, a: 255 };
}

function colorToHex(c: ManagedColor): string {
  const [r, g, b] = managedColorToRgba(c);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { updateSection, resetSettings } = useSettings();
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    if (open) setActiveSection('general');
  }, [open]);

  const handleThemeChange = useCallback(
    (theme: string) => {
      updateSection('appearance', { theme: theme as ThemeMode });
      if (theme !== 'system') {
        setTheme(theme as 'light' | 'dark' | 'high-contrast');
        localStorage.setItem('strata-theme', theme);
      }
    },
    [updateSection],
  );

  const handleReset = useCallback(() => {
    resetSettings();
    setTheme('light');
    localStorage.setItem('strata-theme', 'light');
  }, [resetSettings]);

  return (
    <>
      <Dialog open={open} onClose={onClose} title="Settings" dismissible>
        <div className="settings-dialog__layout">
          <nav className="settings-dialog__nav" aria-label="Settings sections">
            {SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                role="tab"
                aria-selected={activeSection === sec.id}
                className={`settings-dialog__tab${activeSection === sec.id ? ' settings-dialog__tab--active' : ''}`}
                onClick={() => setActiveSection(sec.id)}
              >
                {sec.label}
              </button>
            ))}
          </nav>

          <div className="settings-dialog__content">
            {activeSection === 'general' && <GeneralSection />}
            {activeSection === 'appearance' && (
              <AppearanceSection onThemeChange={handleThemeChange} />
            )}
            {activeSection === 'shortcuts' && (
              <ShortcutsSection onOpenPalette={() => setShortcutsOpen(true)} />
            )}
            {activeSection === 'export' && <ExportSettingsTab />}
            {activeSection === 'collab' && <CollabSection />}
            {activeSection === 'ai' && <AISection />}
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
    </>
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

function GeneralSection() {
  const { settings, updateSection } = useSettings();

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
      <FieldRow label="Canvas background">
        <ColorPicker
          value={hexToColor(settings.general.canvasBackground)}
          onChange={(c) => updateSection('general', { canvasBackground: colorToHex(c) })}
        />
      </FieldRow>
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
    </div>
  );
}

function AppearanceSection({ onThemeChange }: { onThemeChange: (theme: string) => void }) {
  const { settings } = useSettings();
  const currentTheme = getTheme();

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
          onChange={(v) => onThemeChange(v)}
          label="UI font size"
        />
      </FieldRow>
    </div>
  );
}

function ShortcutsSection({ onOpenPalette }: { onOpenPalette: () => void }) {
  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Keyboard Shortcuts</h3>
      <p className="settings-desc">Customize keyboard shortcuts for all editor actions.</p>
      <Button variant="secondary" size="sm" onClick={onOpenPalette}>
        Customize keyboard shortcuts...
      </Button>
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
  const { settings, updateSection } = useSettings();

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">AI Assistant</h3>
      <FieldRow label="Enable AI">
        <label className="settings-checkbox-row">
          <input
            type="checkbox"
            checked={settings.ai.enabled}
            onChange={(e) => updateSection('ai', { enabled: e.target.checked })}
          />
          <span>{settings.ai.enabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </FieldRow>
      {settings.ai.enabled && (
        <>
          <FieldRow label="Model">
            <Select
              options={AI_MODEL_OPTIONS}
              value={settings.ai.model}
              onChange={(v) => updateSection('ai', { model: v })}
              label="Model"
            />
          </FieldRow>
          <FieldRow label="Privacy">
            <label className="settings-checkbox-row">
              <input
                type="checkbox"
                checked={settings.ai.shareUsageData}
                onChange={(e) => updateSection('ai', { shareUsageData: e.target.checked })}
              />
              <span>Share anonymous usage data</span>
            </label>
          </FieldRow>
        </>
      )}
    </div>
  );
}

function AboutSection() {
  return (
    <div className="settings-section">
      <h3 className="settings-section__title">About Strata</h3>
      <div className="settings-about">
        <div className="settings-about__row">
          <span className="settings-about__key">Version</span>
          <span className="settings-about__value">0.0.0</span>
        </div>
        <div className="settings-about__row">
          <span className="settings-about__key">License</span>
          <span className="settings-about__value">AGPL-3.0</span>
        </div>
        <Divider />
        <div className="settings-about__links">
          <button type="button" className="settings-about__link" onClick={() => {}}>
            View changelog
          </button>
          <button type="button" className="settings-about__link" onClick={() => {}}>
            Software bill of materials (SBOM)
          </button>
        </div>
      </div>
    </div>
  );
}
