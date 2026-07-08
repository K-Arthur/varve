import type { Permission, Platform } from '@strata/platform';
import { Button, Dialog, Icon } from '@strata/ui';
import { useCallback, useEffect, useId, useState } from 'react';

export interface ShareDialogProps {
  fileId: string;
  fileName: string;
  platform: Platform;
  open: boolean;
  onClose: () => void;
}

const ROLE_OPTIONS: Array<Permission['role']> = ['editor', 'viewer', 'commenter'];

function formatRole(role: Permission['role']): string {
  switch (role) {
    case 'editor':
      return 'Editor';
    case 'viewer':
      return 'Viewer';
    case 'commenter':
      return 'Commenter';
    default:
      return role;
  }
}

export function ShareDialog({ fileId, fileName, platform, open, onClose }: ShareDialogProps) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<Permission['role']>('editor');
  const [adding, setAdding] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const selectId = useId();
  const statusId = useId();
  const emailInputId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await platform.listPermissions(fileId);
      setPermissions(list);
    } catch {
      setStatusMessage('Failed to load permissions');
    } finally {
      setLoading(false);
    }
  }, [fileId, platform]);

  useEffect(() => {
    if (open) {
      load();
      setNewEmail('');
      setNewRole('editor');
      setStatusMessage(null);
    }
  }, [open, load]);

  const handleAdd = useCallback(async () => {
    const email = newEmail.trim();
    if (!email) return;
    setAdding(true);
    setStatusMessage(null);
    try {
      await platform.setPermission(fileId, newRole, email);
      setNewEmail('');
      setStatusMessage(`Added ${email} as ${formatRole(newRole)}`);
      await load();
    } catch {
      setStatusMessage('Failed to add permission');
    } finally {
      setAdding(false);
    }
  }, [newEmail, newRole, fileId, platform, load]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !adding && newEmail.trim()) {
        handleAdd();
      }
    },
    [handleAdd, adding, newEmail],
  );

  return (
    <Dialog open={open} onClose={onClose} title="Share" dismissible>
      <div className="share-dialog" role="dialog" aria-label="Share file">
        <p className="share-dialog__file-name">{fileName}</p>

        <div aria-live="polite" aria-atomic="true" id={statusId} className="share-dialog__status">
          {statusMessage && <span className="share-dialog__status-text">{statusMessage}</span>}
        </div>

        <div className="share-dialog__section">
          <h3 className="share-dialog__section-title">People with access</h3>
          {loading ? (
            <div className="share-dialog__loading" role="status">
              <Icon name="LoaderCircle" label="Loading permissions" />
            </div>
          ) : permissions.length === 0 ? (
            <p className="share-dialog__empty">No one else has access yet.</p>
          ) : (
            <ul className="share-dialog__list">
              {permissions.map((perm) => (
                <li
                  key={`${perm.email ?? 'unknown'}-${perm.role}`}
                  className="share-dialog__person"
                >
                  <div className="share-dialog__person-avatar">
                    {(perm.email ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="share-dialog__person-info">
                    <span className="share-dialog__person-email">
                      {perm.email ?? 'Unknown user'}
                    </span>
                    <span className="share-dialog__person-role">{formatRole(perm.role)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="share-dialog__section">
          <h3 className="share-dialog__section-title">Add people</h3>
          <div className="share-dialog__add-row">
            <label htmlFor={emailInputId} className="share-dialog__label">
              Email
            </label>
            <input
              id={emailInputId}
              type="email"
              className="share-dialog__email-input"
              placeholder="name@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-describedby={statusId}
            />
            <label htmlFor={selectId} className="share-dialog__label">
              Role
            </label>
            <select
              id={selectId}
              className="share-dialog__role-select"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as Permission['role'])}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {formatRole(role)}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              size="sm"
              loading={adding}
              disabled={!newEmail.trim()}
              onClick={handleAdd}
            >
              Add
            </Button>
          </div>
        </div>

        <div className="share-dialog__footer">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
