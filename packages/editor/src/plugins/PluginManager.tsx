import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { pluginController } from './controller';
import type { PluginPackage, PluginPermission } from './package';
import './PluginManager.css';

type PluginView = ReturnType<typeof pluginController.getSnapshot>['plugins'][number];
type PluginAction = () => unknown;

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
        <button
          className="plugin-manager__button plugin-manager__button--quiet"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
      <p className="plugin-manager__muted">
        {manifest.name} · {manifest.version} · {manifest.id}
      </p>
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
        <button
          className="plugin-manager__button plugin-manager__button--primary"
          type="button"
          onClick={() => onInstall(true)}
          disabled={busy || publisherMismatch || missingRequired.length > 0}
        >
          {existing ? 'Update and enable' : 'Install and enable'}
        </button>
        <button
          className="plugin-manager__button"
          type="button"
          onClick={() => onInstall(false)}
          disabled={busy || publisherMismatch}
        >
          {existing ? 'Update disabled' : 'Install disabled'}
        </button>
      </div>
    </section>
  );
}

function PluginCard({
  plugin,
  busy,
  execute,
}: {
  plugin: PluginView;
  busy: boolean;
  execute: (label: string, action: PluginAction) => void;
}) {
  const prefix = useId();
  const [showAccess, setShowAccess] = useState(false);
  const [accessDraft, setAccessDraft] = useState<PluginPermission[]>(plugin.grants);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState(plugin.manifest.commands[0]?.id ?? '');
  const command = plugin.manifest.commands.find((item) => item.id === selectedCommand);
  const result = selectedCommand ? plugin.results[selectedCommand] : undefined;
  const required = plugin.manifest.permissions.required;
  const permissions = uniquePermissions([...required, ...plugin.manifest.permissions.optional]);
  const commandNeedsWrite = command?.kind === 'rename' && !plugin.grants.includes('document.write');
  const canRun = plugin.enabled && plugin.status === 'ready' && !commandNeedsWrite;
  const blockedByOtherAction = busy && plugin.status !== 'running';
  const runHint =
    plugin.status === 'failed'
      ? 'This plugin failed. Review the error and choose Retry.'
      : plugin.status === 'running'
        ? ''
        : plugin.status === 'awaiting-permission'
          ? 'Grant required access before running commands.'
          : plugin.status === 'disabled'
            ? 'Enable this plugin to run commands.'
            : commandNeedsWrite
              ? 'Grant Change the open document access to run this command.'
              : '';

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
        <div className="plugin-manager__card-title">
          <h3 id={`${prefix}-name`}>{plugin.manifest.name}</h3>
          <span className={`plugin-manager__status plugin-manager__status--${plugin.status}`}>
            {STATUS_LABELS[plugin.status]}
          </span>
        </div>
        <p className="plugin-manager__muted">
          v{plugin.manifest.version} · {plugin.manifest.publisher} (self-declared) · Local file
        </p>
        <p className="plugin-manager__id">{plugin.id}</p>
      </div>

      {plugin.lastError && (
        <p className="plugin-manager__error" role="alert">
          {plugin.lastError}
        </p>
      )}
      {plugin.status === 'awaiting-permission' && (
        <p className="plugin-manager__notice plugin-manager__notice--attention">
          This plugin cannot run until its required access is granted.
        </p>
      )}

      {plugin.manifest.commands.length > 0 && (
        <div className="plugin-manager__command-area">
          <label htmlFor={`${prefix}-command`}>Command</label>
          <div className="plugin-manager__command-row">
            <select
              id={`${prefix}-command`}
              value={selectedCommand}
              onChange={(event) => setSelectedCommand(event.target.value)}
              disabled={busy}
            >
              {plugin.manifest.commands.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <button
              className="plugin-manager__button plugin-manager__button--primary"
              type="button"
              disabled={busy || !canRun || !command}
              onClick={() =>
                command &&
                execute(`Run ${command.title}`, async () => {
                  await pluginController.run(plugin.id, command.id);
                  const updated = pluginController
                    .getSnapshot()
                    .plugins.find((item) => item.id === plugin.id);
                  if (updated?.lastError) throw new Error(updated.lastError);
                  if (!updated?.results[command.id]) return false;
                })
              }
            >
              Run
            </button>
            {plugin.status === 'running' && (
              <button
                className="plugin-manager__button"
                type="button"
                onClick={() =>
                  execute(`Stop ${plugin.manifest.name}`, () => pluginController.stop(plugin.id))
                }
              >
                Stop
              </button>
            )}
          </div>
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
                  <button
                    className="plugin-manager__button plugin-manager__button--primary"
                    type="button"
                    disabled={busy || !canRun}
                    onClick={() =>
                      execute(`Apply ${command?.title ?? 'changes'}`, () =>
                        pluginController.apply(plugin.id, selectedCommand),
                      )
                    }
                  >
                    Apply {result.renames.length}{' '}
                    {result.renames.length === 1 ? 'rename' : 'renames'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {plugin.manifest.inspector && plugin.manifest.inspector.length > 0 && (
        <p className="plugin-manager__muted">
          Inspector: {plugin.manifest.inspector.map((item) => item.title).join(', ')} (Properties
          tab when applicable)
        </p>
      )}

      <div className="plugin-manager__actions">
        <button
          className="plugin-manager__button"
          type="button"
          disabled={blockedByOtherAction}
          onClick={() =>
            execute(plugin.enabled ? 'Disable plugin' : 'Enable plugin', () =>
              pluginController.setEnabled(plugin.id, !plugin.enabled),
            )
          }
        >
          {plugin.enabled ? 'Disable' : 'Enable'}
        </button>
        <button
          className="plugin-manager__button"
          type="button"
          disabled={blockedByOtherAction}
          aria-expanded={showAccess}
          aria-controls={`${prefix}-access`}
          onClick={() => {
            setAccessDraft(plugin.grants);
            setShowAccess((current) => !current);
          }}
        >
          Access
        </button>
        {plugin.status === 'failed' && (
          <button
            className="plugin-manager__button"
            type="button"
            disabled={busy}
            onClick={() => execute('Retry plugin', () => pluginController.retry(plugin.id))}
          >
            Retry
          </button>
        )}
        {plugin.previousVersion && (
          <button
            className="plugin-manager__button"
            type="button"
            disabled={busy}
            onClick={() =>
              execute('Restore previous plugin version', () => pluginController.rollback(plugin.id))
            }
          >
            Restore v{plugin.previousVersion}
          </button>
        )}
        <button
          className="plugin-manager__button plugin-manager__button--danger"
          type="button"
          disabled={blockedByOtherAction}
          aria-expanded={confirmRemoval}
          aria-controls={`${prefix}-remove`}
          onClick={() => setConfirmRemoval((current) => !current)}
        >
          Remove
        </button>
      </div>

      {showAccess && (
        <section
          className="plugin-manager__subsection"
          id={`${prefix}-access`}
          aria-label={`Access for ${plugin.manifest.name}`}
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
            <button
              className="plugin-manager__button plugin-manager__button--primary"
              type="button"
              disabled={blockedByOtherAction}
              onClick={() =>
                execute('Save plugin access', async () => {
                  await pluginController.setGrants(plugin.id, accessDraft);
                  setShowAccess(false);
                })
              }
            >
              Save access
            </button>
            <button
              className="plugin-manager__button plugin-manager__button--quiet"
              type="button"
              disabled={busy}
              onClick={() => setShowAccess(false)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {confirmRemoval && (
        <section
          className="plugin-manager__subsection plugin-manager__subsection--danger"
          id={`${prefix}-remove`}
          aria-label={`Remove ${plugin.manifest.name}`}
        >
          <p>
            Remove this local plugin package? Commands and panels will disappear. Edits already
            committed to documents remain part of those documents.
          </p>
          <div className="plugin-manager__actions">
            <button
              className="plugin-manager__button plugin-manager__button--danger"
              type="button"
              disabled={blockedByOtherAction}
              onClick={() => execute('Remove plugin', () => pluginController.uninstall(plugin.id))}
            >
              Remove plugin
            </button>
            <button
              className="plugin-manager__button plugin-manager__button--quiet"
              type="button"
              disabled={busy}
              onClick={() => setConfirmRemoval(false)}
            >
              Keep plugin
            </button>
          </div>
        </section>
      )}

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
  const operationSerial = useRef(0);
  const [filter, setFilter] = useState('');
  const [prepared, setPrepared] = useState<PluginPackage | null>(null);
  const [grants, setGrants] = useState<PluginPermission[]>([]);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  const existing = prepared
    ? snapshot.plugins.find((plugin) => plugin.id === prepared.manifest.id)
    : undefined;
  const query = filter.trim().toLocaleLowerCase();
  const visible = snapshot.plugins.filter((plugin) =>
    `${plugin.manifest.name} ${plugin.manifest.publisher} ${plugin.id} ${plugin.status}`
      .toLocaleLowerCase()
      .includes(query),
  );

  async function execute(label: string, action: PluginAction) {
    const serial = ++operationSerial.current;
    setBusy(label);
    setActionError('');
    setFeedback('');
    try {
      const result = await action();
      if (serial === operationSerial.current) {
        setFeedback(result === false ? 'Plugin command stopped.' : `${label} complete.`);
      }
    } catch (error) {
      if (serial === operationSerial.current) setActionError(`${label}: ${errorMessage(error)}`);
    } finally {
      if (serial === operationSerial.current) setBusy('');
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
      setPrepared(null);
      inputRef.current?.focus();
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
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Name, publisher, or state"
          />
        </label>
      </div>
      {snapshot.loading ? (
        <p className="plugin-manager__empty" role="status">
          Loading installed plugins…
        </p>
      ) : visible.length === 0 ? (
        <p className="plugin-manager__empty">
          {query
            ? 'No installed plugins match that search.'
            : 'No plugins installed. Choose a local .varveplugin package to begin.'}
        </p>
      ) : (
        <div className="plugin-manager__list">
          {visible.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              busy={Boolean(busy)}
              execute={(label, action) => void execute(label, action)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
