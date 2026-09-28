import { Button, Select } from '@varve/ui';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { pluginController } from './controller';
import { type PluginPackage, type PluginPermission, pluginThumbnailDataUrl } from './package';
import './PluginManager.css';

type PluginView = ReturnType<typeof pluginController.getSnapshot>['plugins'][number];
type PluginAction = () => unknown;
type PluginListMode = 'all' | 'pinned' | 'attention';
type PluginSortOrder = 'name' | 'installed';

const PINNED_STORAGE_KEY = 'varve.plugins.pinned.v1';

function readPinnedPluginIds(): string[] {
  try {
    if (typeof window === 'undefined') return [];
    const saved = window.localStorage.getItem(PINNED_STORAGE_KEY);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is string => typeof item === 'string'))];
  } catch {
    return [];
  }
}

function PluginArtwork({
  name,
  thumbnailUrl,
  alt,
}: {
  name: string;
  thumbnailUrl?: string;
  alt?: string;
}) {
  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase() ?? '')
    .join('');
  return (
    <div className="plugin-manager__artwork">
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt={alt ?? ''} loading="lazy" />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </div>
  );
}

const PERMISSION_LABELS: Record<PluginPermission, { title: string; detail: string }> = {
  'selection.read': {
    title: 'Read the current selection',
    detail: 'Inspect selected layers for the command you run.',
  },
  'document.write': {
    title: 'Change the open document',
    detail: 'Apply reviewed changes through Varve history, so they can be undone.',
  },
};

const STATUS_LABELS: Record<PluginView['status'], string> = {
  ready: 'Ready',
  disabled: 'Disabled',
  'awaiting-permission': 'Needs permission',
  running: 'Running',
  failed: 'Failed',
  'safe-mode': 'Paused in safe mode',
};

const WORKSPACE_LABELS: Record<string, string> = {
  design: 'Design',
  print: 'Print',
  drawing: 'Draw',
  image: 'Photo',
  motion: 'Motion',
  codegen: 'Codegen',
  logo: 'Logo',
  email: 'Email',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniquePermissions(permissions: PluginPermission[]): PluginPermission[] {
  return [...new Set(permissions)];
}

function PermissionRows({
  permissions,
  required,
  selected,
  onToggle,
  disabled,
  prefix,
}: {
  permissions: PluginPermission[];
  required: PluginPermission[];
  selected: PluginPermission[];
  onToggle: (permission: PluginPermission) => void;
  disabled?: boolean;
  prefix: string;
}) {
  if (permissions.length === 0)
    return <p className="plugin-manager__muted">No document access requested.</p>;
  return (
    <div className="plugin-manager__permissions">
      {permissions.map((permission) => {
        const label = PERMISSION_LABELS[permission];
        const isRequired = required.includes(permission);
        return (
          <label
            className="plugin-manager__permission"
            key={permission}
            htmlFor={`${prefix}-${permission}`}
          >
            <input
              id={`${prefix}-${permission}`}
              type="checkbox"
              checked={selected.includes(permission)}
              disabled={disabled}
              onChange={() => onToggle(permission)}
            />
            <span>
              <span className="plugin-manager__permission-title">
                {label.title}{' '}
                <span className="plugin-manager__muted">
                  ({isRequired ? 'required' : 'optional'})
                </span>
              </span>
              <span className="plugin-manager__permission-detail">{label.detail}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function InstallationReview({
  prepared,
  existing,
  grants,
  onToggle,
  onInstall,
  onCancel,
  busy,
}: {
  prepared: PluginPackage;
  existing?: PluginView;
  grants: PluginPermission[];
  onToggle: (permission: PluginPermission) => void;
  onInstall: (enabled: boolean) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const prefix = useId();
  const { manifest } = prepared;
  const thumbnailUrl = useMemo(
    () => pluginThumbnailDataUrl(prepared.thumbnail),
    [prepared.thumbnail],
  );
  const publisherMismatch = Boolean(existing && existing.manifest.publisher !== manifest.publisher);
  const requested = uniquePermissions([
    ...manifest.permissions.required,
    ...manifest.permissions.optional,
  ]);
  const missingRequired = manifest.permissions.required.filter(
    (permission) => !grants.includes(permission),
  );
  const added = requested.filter(
    (permission) =>
      !existing?.manifest.permissions.required.includes(permission) &&
      !existing?.manifest.permissions.optional.includes(permission),
  );

  useEffect(() => titleRef.current?.focus(), []);

  return (
    <section className="plugin-manager__review" aria-labelledby={`${prefix}-title`}>
      <div className="plugin-manager__section-heading">
        <div>
          <p className="plugin-manager__eyebrow">Review local package</p>
          <h3 id={`${prefix}-title`} ref={titleRef} tabIndex={-1}>
            {existing ? 'Review update' : 'Review installation'}
          </h3>
        </div>
        <Button
          className="plugin-manager__button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
      <div className="plugin-manager__identity">
        <PluginArtwork
          name={manifest.name}
          thumbnailUrl={thumbnailUrl}
          alt={manifest.thumbnail?.alt}
        />
        <div>
          <p className="plugin-manager__muted">
            {manifest.name} · {manifest.version} · {manifest.id}
          </p>
          {manifest.description && <p>{manifest.description}</p>}
        </div>
      </div>
      <p>
        Publisher label: <strong>{manifest.publisher}</strong>. This name is supplied by the
        package; a local file is not a verified or marketplace listing.
      </p>
      {existing && (
        <p className="plugin-manager__notice">
          Installed: {existing.manifest.version}. The package bytes will change from{' '}
          <code>{existing.sha256.slice(0, 12)}…</code> to{' '}
          <code>{prepared.sha256.slice(0, 12)}…</code>. Existing grants are kept only when still
          requested. Review every new permission below.
        </p>
      )}
      {publisherMismatch && (
        <p className="plugin-manager__error" role="alert">
          This ID is already installed under a different publisher label. Remove that installation
          first; this package cannot update it.
        </p>
      )}
      {added.length > 0 && existing && (
        <p className="plugin-manager__notice plugin-manager__notice--attention">
          New access requested:{' '}
          {added.map((permission) => PERMISSION_LABELS[permission].title).join(', ')}.
        </p>
      )}
      <h4>Access requested</h4>
      <PermissionRows
        permissions={requested}
        required={manifest.permissions.required}
        selected={grants}
        onToggle={onToggle}
        disabled={busy}
        prefix={prefix}
      />
      {missingRequired.length > 0 && (
        <p className="plugin-manager__notice plugin-manager__notice--attention">
          Select all required access to enable this plugin. You can install it disabled and grant
          access later.
        </p>
      )}
      <details className="plugin-manager__details">
        <summary>Package details</summary>
        <dl>
          <div>
            <dt>Source</dt>
            <dd>Local file</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd>{manifest.apiVersion}</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd>
              <code>{prepared.sha256}</code>
            </dd>
          </div>
          <div>
            <dt>Commands</dt>
            <dd>{manifest.commands.map((command) => command.title).join(', ') || 'None'}</dd>
          </div>
        </dl>
      </details>
      <div className="plugin-manager__actions">
        <Button
          className="plugin-manager__button"
          variant="default"
          size="sm"
          onClick={() => onInstall(true)}
          disabled={busy || publisherMismatch || missingRequired.length > 0}
          disabledReason={
            missingRequired.length > 0
              ? 'Select the required access above before enabling this plugin.'
              : publisherMismatch
                ? 'Remove the existing installation before using this different publisher label.'
                : busy
                  ? 'Wait for the current package check to finish.'
                  : undefined
          }
        >
          {existing ? 'Update and enable' : 'Install and enable'}
        </Button>
        <Button
          className="plugin-manager__button"
          variant="secondary"
          size="sm"
          onClick={() => onInstall(false)}
          disabled={busy || publisherMismatch}
          disabledReason={
            publisherMismatch
              ? 'Remove the existing installation before using this different publisher label.'
              : busy
                ? 'Wait for the current package check to finish.'
                : undefined
          }
        >
          {existing ? 'Update disabled' : 'Install disabled'}
        </Button>
      </div>
    </section>
  );
}

function PluginCard({
  plugin,
  pinned,
  busy,
  commandBusy,
  onTogglePinned,
  onRemoved,
  execute,
  executeCommand,
}: {
  plugin: PluginView;
  pinned: boolean;
  busy: boolean;
  commandBusy: boolean;
  onTogglePinned: (pluginId: string, pinned: boolean) => void;
  onRemoved: () => void;
  execute: (label: string, action: PluginAction) => void;
  executeCommand: (label: string, action: PluginAction) => void;
}) {
  const prefix = useId();
  const [showAccess, setShowAccess] = useState(false);
  const [accessDraft, setAccessDraft] = useState<PluginPermission[]>(plugin.grants);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const accessTriggerRef = useRef<HTMLButtonElement>(null);
  const removalTriggerRef = useRef<HTMLButtonElement>(null);
  const [selectedCommand, setSelectedCommand] = useState(plugin.manifest.commands[0]?.id ?? '');
  const command = plugin.manifest.commands.find((item) => item.id === selectedCommand);
  const result = selectedCommand ? plugin.results[selectedCommand] : undefined;
  const required = plugin.manifest.permissions.required;
  const permissions = uniquePermissions([...required, ...plugin.manifest.permissions.optional]);
  const commandNeedsWrite = command?.kind === 'rename' && !plugin.grants.includes('document.write');
  const canRun = plugin.enabled && plugin.status === 'ready' && !commandNeedsWrite;
  const blockedByOtherAction = busy && plugin.status !== 'running';
  const runHint =
    plugin.status === 'safe-mode'
      ? 'Plugins are paused for this safe-mode session. Your saved enabled choice is unchanged.'
      : plugin.status === 'failed'
        ? 'This plugin failed. Review the error and choose Retry.'
        : plugin.status === 'running'
          ? ''
          : plugin.status === 'awaiting-permission'
            ? 'Grant selection access and any required access before running commands.'
            : plugin.status === 'disabled'
              ? 'Enable this plugin to run commands.'
              : commandNeedsWrite
                ? 'Grant Change the open document access to run this command.'
                : '';
  const runUnavailableReason =
    busy || commandBusy
      ? 'Finish the current operation for this plugin first.'
      : runHint ||
        (!canRun ? 'This command is not available in the current plugin state.' : undefined);

  useEffect(() => {
    if (!showAccess) setAccessDraft(plugin.grants);
  }, [plugin.grants, showAccess]);
  useEffect(() => {
    if (!plugin.manifest.commands.some((item) => item.id === selectedCommand)) {
      setSelectedCommand(plugin.manifest.commands[0]?.id ?? '');
    }
  }, [plugin.manifest.commands, selectedCommand]);

  function toggleAccess(permission: PluginPermission) {
    setAccessDraft((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission],
    );
  }

  return (
    <article className="plugin-manager__card" aria-labelledby={`${prefix}-name`}>
      <div className="plugin-manager__card-header">
        <PluginArtwork
          name={plugin.manifest.name}
          thumbnailUrl={plugin.thumbnailUrl}
          alt={plugin.manifest.thumbnail?.alt}
        />
        <div className="plugin-manager__card-heading">
          <div className="plugin-manager__card-title">
            <h3 id={`${prefix}-name`}>{plugin.manifest.name}</h3>
            <span className={`plugin-manager__status plugin-manager__status--${plugin.status}`}>
              {STATUS_LABELS[plugin.status]}
            </span>
          </div>
          <p className="plugin-manager__muted">
            v{plugin.manifest.version} · {plugin.manifest.publisher} (self-declared) · Local file
          </p>
          {plugin.manifest.description && <p>{plugin.manifest.description}</p>}
          <p className="plugin-manager__id">{plugin.id}</p>
        </div>
        <Button
          className="plugin-manager__button plugin-manager__pin"
          variant="secondary"
          size="sm"
          aria-pressed={pinned}
          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${plugin.manifest.name}`}
          onClick={() => onTogglePinned(plugin.id, !pinned)}
        >
          {pinned ? 'Pinned' : 'Pin'}
        </Button>
      </div>

      {plugin.lastError && (
        <p className="plugin-manager__error" role="alert">
          {plugin.lastError}
        </p>
      )}
      {plugin.status === 'awaiting-permission' && (
        <p className="plugin-manager__notice plugin-manager__notice--attention">
          This plugin cannot run until selection access and any required access are granted.
        </p>
      )}

      {plugin.manifest.commands.length > 0 && (
        <div className="plugin-manager__command-area">
          <span className="plugin-manager__field-label" id={`${prefix}-command-label`}>
            Command
          </span>
          <div className="plugin-manager__command-row">
            <Select
              id={`${prefix}-command`}
              className="plugin-manager__command-select"
              label="Command"
              aria-labelledby={`${prefix}-command-label`}
              value={selectedCommand}
              options={plugin.manifest.commands.map((item) => ({
                value: item.id,
                label: item.title,
              }))}
              onValueChange={setSelectedCommand}
              disabled={Boolean(busy)}
            />
            <Button
              className="plugin-manager__button"
              variant="default"
              size="sm"
              disabled={busy || commandBusy || !canRun || !command}
              disabledReason={runUnavailableReason}
              onClick={() =>
                command &&
                executeCommand(`Run ${command.title}`, async () => {
                  return pluginController.run(plugin.id, command.id);
                })
              }
            >
              Run
            </Button>
            {plugin.status === 'running' && (
              <Button
                className="plugin-manager__button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  executeCommand(`Stop ${plugin.manifest.name}`, () =>
                    pluginController.stop(plugin.id),
                  )
                }
              >
                Stop
              </Button>
            )}
          </div>
          {commandBusy && plugin.status !== 'running' && (
            <p className="plugin-manager__muted" role="status">
              Applying the reviewed result…
            </p>
          )}
          {runHint && <p className="plugin-manager__muted">{runHint}</p>}
          {result && (
            <div className="plugin-manager__result" aria-live="polite">
              <h4>Preview</h4>
              <p>{result.summary}</p>
              {result.lines.length > 0 && <pre>{result.lines.join('\n')}</pre>}
              {result.renames.length > 0 && (
                <>
                  <ul>
                    {result.renames.map((item) => (
                      <li key={item.id}>
                        {item.expectedName} to {item.name}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="plugin-manager__button"
                    variant="default"
                    size="sm"
                    disabled={busy || commandBusy || !canRun}
                    disabledReason={runUnavailableReason}
                    onClick={() =>
                      executeCommand(`Apply ${command?.title ?? 'changes'}`, () =>
                        pluginController.apply(plugin.id, selectedCommand),
                      )
                    }
                  >
                    Apply {result.renames.length}{' '}
                    {result.renames.length === 1 ? 'rename' : 'renames'}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {plugin.manifest.inspector && plugin.manifest.inspector.length > 0 && (
        <div className="plugin-manager__panels">
          <span className="plugin-manager__field-label">Inspector panels</span>
          {plugin.manifest.inspector.map((section) => {
            const hidden = plugin.hiddenPanels.includes(section.id);
            const where = [
              'Properties tab',
              section.modes === undefined
                ? 'All workspaces'
                : section.modes.length > 0
                  ? section.modes.map((mode) => WORKSPACE_LABELS[mode] ?? mode).join(', ')
                  : 'No workspaces',
            ].join(' · ');
            return (
              <div className="plugin-manager__panel-row" key={section.id}>
                <span className="plugin-manager__panel-name">
                  {section.title} <span className="plugin-manager__muted">({where})</span>
                </span>
                <Button
                  className="plugin-manager__button"
                  variant="secondary"
                  size="sm"
                  disabled={Boolean(busy)}
                  disabledReason={
                    busy ? 'Wait for the current package action to finish.' : undefined
                  }
                  aria-label={`${hidden ? 'Show' : 'Hide'} ${section.title} Inspector panel`}
                  onClick={() =>
                    execute(hidden ? 'Show Inspector panel' : 'Hide Inspector panel', () =>
                      pluginController.setPanelHidden(plugin.id, section.id, !hidden),
                    )
                  }
                >
                  {hidden ? 'Show' : 'Hide'}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="plugin-manager__actions">
        <Button
          className="plugin-manager__button"
          variant="secondary"
          size="sm"
          disabled={blockedByOtherAction || plugin.status === 'safe-mode'}
          disabledReason={
            plugin.status === 'safe-mode'
              ? 'Exit safe mode before changing the saved enabled choice.'
              : blockedByOtherAction
                ? 'Wait for the current package action to finish.'
                : undefined
          }
          onClick={() =>
            execute(plugin.enabled ? 'Disable plugin' : 'Enable plugin', () =>
              pluginController.setEnabled(plugin.id, !plugin.enabled),
            )
          }
        >
          {plugin.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button
          ref={accessTriggerRef}
          className="plugin-manager__button"
          variant="secondary"
          size="sm"
          disabled={blockedByOtherAction}
          disabledReason={
            blockedByOtherAction ? 'Wait for the current package action to finish.' : undefined
          }
          aria-expanded={showAccess}
          aria-controls={`${prefix}-access`}
          onClick={() => {
            setAccessDraft(plugin.grants);
            setShowAccess((current) => !current);
          }}
        >
          Access
        </Button>
        {plugin.status === 'failed' && (
          <Button
            className="plugin-manager__button"
            variant="secondary"
            size="sm"
            disabled={busy}
            disabledReason={busy ? 'Wait for the current package action to finish.' : undefined}
            onClick={() => execute('Retry plugin', () => pluginController.retry(plugin.id))}
          >
            Retry
          </Button>
        )}
        {plugin.previousVersion && (
          <Button
            className="plugin-manager__button"
            variant="secondary"
            size="sm"
            disabled={busy}
            disabledReason={busy ? 'Wait for the current package action to finish.' : undefined}
            onClick={() =>
              execute('Restore previous plugin version', () => pluginController.rollback(plugin.id))
            }
          >
            Restore v{plugin.previousVersion}
          </Button>
        )}
        <Button
          ref={removalTriggerRef}
          className="plugin-manager__button plugin-manager__button--danger"
          variant="outline"
          size="sm"
          disabled={blockedByOtherAction}
          disabledReason={
            blockedByOtherAction ? 'Wait for the current package action to finish.' : undefined
          }
          aria-expanded={confirmRemoval}
          aria-controls={`${prefix}-remove`}
          onClick={() => setConfirmRemoval((current) => !current)}
        >
          Remove
        </Button>
      </div>

      <section
        className="plugin-manager__subsection"
        id={`${prefix}-access`}
        aria-label={`Access for ${plugin.manifest.name}`}
        hidden={!showAccess}
      >
        <p>Required access is needed to run the plugin. Revoking access stops active work.</p>
        <PermissionRows
          permissions={permissions}
          required={required}
          selected={accessDraft}
          onToggle={toggleAccess}
          disabled={blockedByOtherAction}
          prefix={`${prefix}-edit`}
        />
        <div className="plugin-manager__actions">
          <Button
            className="plugin-manager__button"
            variant="default"
            size="sm"
            disabled={blockedByOtherAction}
            disabledReason={
              blockedByOtherAction ? 'Wait for the current package action to finish.' : undefined
            }
            onClick={() =>
              execute('Save plugin access', async () => {
                await pluginController.setGrants(plugin.id, accessDraft);
                setShowAccess(false);
                accessTriggerRef.current?.focus();
              })
            }
          >
            Save access
          </Button>
          <Button
            className="plugin-manager__button"
            variant="ghost"
            size="sm"
            disabled={busy}
            disabledReason={busy ? 'Wait for the current package action to finish.' : undefined}
            onClick={() => {
              setShowAccess(false);
              accessTriggerRef.current?.focus();
            }}
          >
            Cancel
          </Button>
        </div>
      </section>

      <section
        className="plugin-manager__subsection plugin-manager__subsection--danger"
        id={`${prefix}-remove`}
        aria-label={`Remove ${plugin.manifest.name}`}
        hidden={!confirmRemoval}
      >
        <p>
          Remove this local plugin package? Commands and panels will disappear. Edits already
          committed to documents remain part of those documents.
        </p>
        <div className="plugin-manager__actions">
          <Button
            className="plugin-manager__button plugin-manager__button--danger"
            variant="outline"
            size="sm"
            disabled={blockedByOtherAction}
            disabledReason={
              blockedByOtherAction ? 'Wait for the current package action to finish.' : undefined
            }
            onClick={() =>
              execute('Remove plugin', async () => {
                await pluginController.uninstall(plugin.id);
                onRemoved();
              })
            }
          >
            Remove plugin
          </Button>
          <Button
            className="plugin-manager__button"
            variant="ghost"
            size="sm"
            disabled={busy}
            disabledReason={busy ? 'Wait for the current package action to finish.' : undefined}
            onClick={() => {
              setConfirmRemoval(false);
              removalTriggerRef.current?.focus();
            }}
          >
            Keep plugin
          </Button>
        </div>
      </section>

      <details className="plugin-manager__details">
        <summary>Package details</summary>
        <dl>
          <div>
            <dt>Source</dt>
            <dd>Local file (publisher label not verified)</dd>
          </div>
          <div>
            <dt>Installed</dt>
            <dd>{new Date(plugin.installedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd>
              <code>{plugin.sha256}</code>
            </dd>
          </div>
          <div>
            <dt>Granted access</dt>
            <dd>
              {plugin.grants.map((permission) => PERMISSION_LABELS[permission].title).join(', ') ||
                'None'}
            </dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

/** App-wide manager for explicit, local .varveplugin packages. */
export function PluginManager() {
  const snapshot = useSyncExternalStore(pluginController.subscribe, pluginController.getSnapshot);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const restorePackageFocusRef = useRef(false);
  const operationSerial = useRef(0);
  const [filter, setFilter] = useState('');
  const [listMode, setListMode] = useState<PluginListMode>('all');
  const [sortOrder, setSortOrder] = useState<PluginSortOrder>('name');
  const [pinnedIds, setPinnedIds] = useState<string[]>(readPinnedPluginIds);
  const [prepared, setPrepared] = useState<PluginPackage | null>(null);
  const [grants, setGrants] = useState<PluginPermission[]>([]);
  const [busy, setBusy] = useState('');
  const [commandBusyIds, setCommandBusyIds] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  const existing = prepared
    ? snapshot.plugins.find((plugin) => plugin.id === prepared.manifest.id)
    : undefined;
  const query = filter.trim().toLocaleLowerCase();
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const needsAttention = (plugin: PluginView) => plugin.status !== 'ready';
  const matching = snapshot.plugins.filter((plugin) =>
    [
      plugin.manifest.name,
      plugin.manifest.publisher,
      plugin.manifest.description,
      plugin.manifest.commands.map((command) => command.title).join(' '),
      plugin.id,
      plugin.status,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(query),
  );
  const filtered = matching.filter((plugin) => {
    if (listMode === 'pinned') return pinnedSet.has(plugin.id);
    if (listMode === 'attention') return needsAttention(plugin);
    return true;
  });
  const visible = [...filtered].sort((a, b) =>
    sortOrder === 'installed'
      ? b.installedAt - a.installedAt || a.manifest.name.localeCompare(b.manifest.name)
      : a.manifest.name.localeCompare(b.manifest.name, undefined, {
          sensitivity: 'base',
          numeric: true,
        }),
  );

  useEffect(() => {
    function syncPins(event: StorageEvent) {
      if (event.key === PINNED_STORAGE_KEY || event.key === null) {
        setPinnedIds(readPinnedPluginIds());
      }
    }
    window.addEventListener('storage', syncPins);
    return () => window.removeEventListener('storage', syncPins);
  }, []);

  useEffect(() => {
    if (snapshot.loading || snapshot.error) return;
    const installed = new Set(snapshot.plugins.map((plugin) => plugin.id));
    const retained = pinnedIds.filter((id) => installed.has(id));
    if (retained.length !== pinnedIds.length) {
      setPinnedIds(retained);
      try {
        window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(retained));
      } catch {
        // The in-memory preference remains usable if this profile disallows storage writes.
      }
    }
  }, [pinnedIds, snapshot.loading, snapshot.plugins]);

  useEffect(() => {
    if (!restorePackageFocusRef.current || busy || prepared) return;
    restorePackageFocusRef.current = false;
    inputRef.current?.focus();
  }, [busy, prepared]);

  function togglePinned(pluginId: string, shouldPin: boolean) {
    const next = shouldPin
      ? [...new Set([...pinnedIds, pluginId])]
      : pinnedIds.filter((id) => id !== pluginId);
    setPinnedIds(next);
    try {
      window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
    } catch {
      setActionError(
        'Pin preference changed for this session but could not be saved to this profile.',
      );
    }
  }

  async function execute(label: string, action: PluginAction) {
    const serial = ++operationSerial.current;
    setBusy(label);
    setActionError('');
    setFeedback('');
    try {
      const result = await action();
      if (serial === operationSerial.current) {
        const status =
          result && typeof result === 'object' && 'status' in result
            ? (result as { status: unknown }).status
            : undefined;
        if (status === 'stopped') setFeedback('Plugin command stopped.');
        else if (status === 'stale') setFeedback('The plugin result was stale and was discarded.');
        else if (status === 'idle') setFeedback('No plugin command was running.');
        else setFeedback(`${label} complete.`);
      }
    } catch (error) {
      if (serial === operationSerial.current) setActionError(`${label}: ${errorMessage(error)}`);
    } finally {
      if (serial === operationSerial.current) setBusy('');
    }
  }

  async function executeCommand(pluginId: string, label: string, action: PluginAction) {
    setCommandBusyIds((current) => new Set(current).add(pluginId));
    setActionError('');
    setFeedback('');
    try {
      const result = await action();
      const status =
        result && typeof result === 'object' && 'status' in result
          ? (result as { status: unknown }).status
          : undefined;
      if (status === 'stopped') setFeedback('Plugin command stopped.');
      else if (status === 'stale') setFeedback('The plugin result was stale and was discarded.');
      else if (status === 'idle') setFeedback('No plugin command was running.');
      else setFeedback(`${label} complete.`);
    } catch (error) {
      setActionError(`${label}: ${errorMessage(error)}`);
    } finally {
      setCommandBusyIds((current) => {
        const next = new Set(current);
        next.delete(pluginId);
        return next;
      });
    }
  }

  async function choosePackage(file: File | undefined) {
    if (!file) return;
    setBusy('Checking package');
    setActionError('');
    setFeedback('');
    setPrepared(null);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Package exceeds the 2 MiB limit');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const next = await pluginController.prepare(bytes);
      const current = snapshot.plugins.find((plugin) => plugin.id === next.manifest.id);
      const requested = uniquePermissions([
        ...next.manifest.permissions.required,
        ...next.manifest.permissions.optional,
      ]);
      setGrants(requested.filter((permission) => current?.grants.includes(permission)));
      setPrepared(next);
    } catch (error) {
      setActionError(`Cannot review package: ${errorMessage(error)}`);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
      setBusy('');
    }
  }

  function install(enabled: boolean) {
    if (!prepared) return;
    if (
      enabled &&
      prepared.manifest.permissions.required.some((permission) => !grants.includes(permission))
    ) {
      setActionError('Grant the required access, or install this plugin disabled.');
      return;
    }
    const installing = prepared;
    void execute(enabled ? 'Install and enable plugin' : 'Install disabled plugin', async () => {
      await pluginController.install(installing, grants, enabled);
      restorePackageFocusRef.current = true;
      setPrepared(null);
    });
  }

  function togglePermission(permission: PluginPermission) {
    setGrants((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission],
    );
  }

  return (
    <div className="plugin-manager">
      <div className="plugin-manager__heading">
        <div>
          <h2>Plugins</h2>
          <p>
            Install and manage local plugins for the desktop editor. No marketplace or account is
            required.
          </p>
        </div>
        <div className="plugin-manager__install">
          <input
            ref={inputRef}
            type="file"
            accept=".varveplugin"
            aria-label="Choose a .varveplugin package"
            onChange={(event) => void choosePackage(event.currentTarget.files?.[0])}
            disabled={Boolean(busy)}
          />
        </div>
      </div>
      <p className="plugin-manager__notice">
        Local packages declare their own publisher names. Review each package and its requested
        access before enabling it. Plugins run only after you choose a command.
      </p>

      {snapshot.safeModeDisabled && (
        <p className="plugin-manager__notice" role="status">
          Third-party plugins are paused in safe mode. Saved enabled choices are unchanged; you can
          still inspect, restore, retry, or remove packages. Use the safe-mode bar to exit.
        </p>
      )}

      {snapshot.error && (
        <p className="plugin-manager__error" role="alert">
          {snapshot.error}
        </p>
      )}
      {actionError && (
        <p className="plugin-manager__error" role="alert">
          {actionError}
        </p>
      )}
      {feedback && (
        <p className="plugin-manager__feedback" role="status">
          {feedback}
        </p>
      )}
      {busy && (
        <p className="plugin-manager__muted" role="status">
          {busy}…
        </p>
      )}

      {prepared && (
        <InstallationReview
          prepared={prepared}
          existing={existing}
          grants={grants}
          onToggle={togglePermission}
          onInstall={install}
          onCancel={() => {
            setPrepared(null);
            inputRef.current?.focus();
          }}
          busy={Boolean(busy)}
        />
      )}

      <div className="plugin-manager__section-heading plugin-manager__list-heading">
        <div>
          <h3>Installed plugins</h3>
          <p className="plugin-manager__muted">Disabled and failed plugins remain visible here.</p>
        </div>
        <label className="plugin-manager__search">
          <span>Search installed plugins</span>
          <input
            ref={searchRef}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Name, publisher, command, or description"
          />
        </label>
      </div>
      <div className="plugin-manager__list-controls">
        <fieldset className="plugin-manager__filters">
          <legend className="plugin-manager__filter-legend">Filter installed plugins</legend>
          <div className="plugin-manager__filter-buttons">
            <Button
              className="plugin-manager__button"
              variant={listMode === 'all' ? 'default' : 'secondary'}
              size="sm"
              aria-pressed={listMode === 'all'}
              onClick={() => setListMode('all')}
            >
              All ({snapshot.plugins.length})
            </Button>
            <Button
              className="plugin-manager__button"
              variant={listMode === 'pinned' ? 'default' : 'secondary'}
              size="sm"
              aria-pressed={listMode === 'pinned'}
              onClick={() => setListMode('pinned')}
            >
              Pinned ({snapshot.plugins.filter((plugin) => pinnedSet.has(plugin.id)).length})
            </Button>
            <Button
              className="plugin-manager__button"
              variant={listMode === 'attention' ? 'default' : 'secondary'}
              size="sm"
              aria-pressed={listMode === 'attention'}
              onClick={() => setListMode('attention')}
            >
              Needs attention ({snapshot.plugins.filter(needsAttention).length})
            </Button>
          </div>
        </fieldset>
        <div className="plugin-manager__sort">
          <span id="plugin-manager-sort-label">Sort</span>
          <Select
            id="plugin-manager-sort"
            label="Sort installed plugins"
            aria-labelledby="plugin-manager-sort-label"
            value={sortOrder}
            options={[
              { value: 'name', label: 'Name (A–Z)' },
              { value: 'installed', label: 'Recently installed' },
            ]}
            onValueChange={(value) => setSortOrder(value as PluginSortOrder)}
          />
        </div>
      </div>
      <p className="plugin-manager__muted" role="status" aria-live="polite">
        Showing {visible.length} of {snapshot.plugins.length} installed plugins.
      </p>
      {snapshot.loading ? (
        <p className="plugin-manager__empty" role="status">
          Loading installed plugins…
        </p>
      ) : visible.length === 0 ? (
        <p className="plugin-manager__empty">
          {query
            ? 'No installed plugins match these filters and search terms.'
            : listMode === 'pinned' && snapshot.plugins.length > 0
              ? 'No plugins are pinned. Use Pin on a plugin to keep it easy to find.'
              : listMode === 'attention' && snapshot.plugins.length > 0
                ? 'All installed plugins are ready.'
                : 'No plugins installed. Choose a local .varveplugin package to begin.'}
        </p>
      ) : (
        <div className="plugin-manager__list">
          {visible.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              pinned={pinnedSet.has(plugin.id)}
              busy={Boolean(busy)}
              commandBusy={commandBusyIds.has(plugin.id)}
              onTogglePinned={togglePinned}
              onRemoved={() => window.requestAnimationFrame(() => searchRef.current?.focus())}
              execute={(label, action) => void execute(label, action)}
              executeCommand={(label, action) => void executeCommand(plugin.id, label, action)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
