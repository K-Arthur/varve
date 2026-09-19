import type { ReactNode } from 'react';

/**
 * Canonical labelled row inside the settings dialog. The `.settings-field-row`
 * classes own the shared layout; settings tabs must not re-declare this shell.
 */
export function SettingsFieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="settings-field-row">
      <span className="settings-field-row__label">{label}</span>
      <div className="settings-field-row__control">{children}</div>
    </div>
  );
}
