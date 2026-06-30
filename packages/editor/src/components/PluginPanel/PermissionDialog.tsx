import { type StrataPlugin } from '@strata/plugin-sandbox';
import { Button, Dialog } from '@strata/ui';

const PERMISSION_LABELS: Record<string, string> = {
  'document:read': 'Read document contents',
  'document:write': 'Modify document contents',
  'file:write': 'Write files to disk',
  'network:fetch': 'Make network requests',
  'clipboard:read': 'Read clipboard contents',
  'clipboard:write': 'Write to clipboard',
  'ui:overlay': 'Display overlay UI',
};

interface Props {
  plugin: StrataPlugin;
  onClose: () => void;
}

export function PermissionDialog({ plugin, onClose }: Props) {
  return (
    <Dialog open onClose={onClose} title={`${plugin.name} — Permissions`}>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', margin: '0 0 var(--space-3)' }}>
        This plugin requests the following permissions:
      </p>
      <ul className="perm-dialog__list" role="list" aria-label="Requested permissions">
        {plugin.permissions.map((perm) => (
          <li key={perm} className="perm-dialog__item">
            <span className="perm-dialog__item-icon" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <span>{PERMISSION_LABELS[perm] ?? perm}</span>
          </li>
        ))}
      </ul>
      <div className="perm-dialog__actions">
        <Button variant="primary" onClick={onClose}>
          Allow
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Deny
        </Button>
      </div>
    </Dialog>
  );
}
