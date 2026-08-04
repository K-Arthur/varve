import { Dialog } from '@varve/ui';

export interface ShortcutEntry {
  label: string;
  combo: string;
}

export interface HomeShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: ShortcutEntry[] = [
  { label: 'New file', combo: 'Ctrl+N' },
  { label: 'Open file', combo: 'Ctrl+O' },
  { label: 'Search files', combo: 'Ctrl+F' },
  { label: 'Focus search', combo: '/' },
  { label: 'Templates', combo: 'Ctrl+Shift+T' },
  { label: 'Select all', combo: 'Ctrl+A' },
  { label: 'Close dialog', combo: 'Esc' },
  { label: 'Show this help', combo: '?' },
];

export function HomeShortcutHelp({ open, onClose }: HomeShortcutHelpProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="home-shortcut-help">
        <h2 className="home-shortcut-help__title">Keyboard shortcuts</h2>
        <ul className="home-shortcut-help__list">
          {SHORTCUTS.map(({ label, combo }) => (
            <li key={label} className="home-shortcut-help__row">
              <span className="home-shortcut-help__label">{label}</span>
              <kbd className="home-shortcut-help__combo">{combo}</kbd>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="home-shortcut-help__close"
          onClick={onClose}
          aria-label="Close"
        >
          Close
        </button>
      </div>
    </Dialog>
  );
}
