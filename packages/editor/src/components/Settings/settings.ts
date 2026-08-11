/**
 * Re-export the consolidated editor settings types for Settings dialog components.
 * The canonical types and storage now live in ../../settings.ts (the editor
 * settings store). This barrel file keeps the Settings dialog imports stable.
 */
export type { EditorSettings as Settings, FontSizeUI, ThemeMode, UnitType } from '../../settings';
export {
  DEFAULT_EDITOR_SETTINGS as DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from '../../settings';
// `SettingsSection` enumerates this dialog's panes, so it is owned here rather
// than by the editor-wide settings store.
export type { SettingsSection } from './SettingsContext';
