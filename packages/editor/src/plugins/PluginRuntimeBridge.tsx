import { LocalStorageSafeModeStore } from '@varve/crash';
import { Button } from '@varve/ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getActionRegistry } from '../actions/ActionRegistry';
import { useOptionalEditor } from '../context';
import { pluginController } from './controller';
import './PluginHostSection.css';

function PluginHostSection({ pluginId, commandId }: { pluginId: string; commandId: string }) {
  const snapshot = useSyncExternalStore(
    pluginController.subscribe,
    pluginController.getSnapshot,
    pluginController.getSnapshot,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const plugin = snapshot.plugins.find((entry) => entry.id === pluginId);
  const command = plugin?.manifest.commands.find((entry) => entry.id === commandId);
  if (!plugin || !command) return null;
  const result = plugin.results[commandId];
  const needsWrite = command.kind === 'rename' && !plugin.grants.includes('document.write');
  const runDisabledReason = needsWrite
    ? 'Grant document write access in Manage Plugins to run this command.'
    : plugin.status === 'safe-mode'
      ? 'Exit safe mode before running plugins.'
      : plugin.status === 'awaiting-permission'
        ? 'Grant selection access in Manage Plugins before running this command.'
        : plugin.status === 'failed'
          ? 'Review the failure and choose Retry in Manage Plugins.'
          : plugin.status === 'disabled'
            ? 'Enable this plugin in Manage Plugins before running it.'
            : plugin.status === 'running'
              ? 'This plugin command is already running.'
              : undefined;
  const canRun = plugin.status === 'ready' && !needsWrite;

  const run = () => {
    setLocalError(null);
    void pluginController.run(pluginId, commandId).catch((error: unknown) => {
      setLocalError(error instanceof Error ? error.message : String(error));
    });
  };

  const apply = () => {
    setLocalError(null);
    void pluginController.apply(pluginId, commandId).catch((error: unknown) => {
      setLocalError(error instanceof Error ? error.message : String(error));
    });
  };

  return (
    <div className="plugin-host-section">
      <p className="plugin-host-section__hint">{plugin.manifest.name} · Local plugin</p>
      <div className="plugin-host-section__actions">
        <Button
          size="sm"
          variant="secondary"
          onClick={run}
          disabled={!canRun}
          disabledReason={runDisabledReason}
        >
          {command.title}
        </Button>
        {plugin.status === 'running' && (
          <Button size="sm" variant="secondary" onClick={() => pluginController.stop(pluginId)}>
            Stop
          </Button>
        )}
      </div>
      {needsWrite && <p>Grant document write access in Manage Plugins to run this command.</p>}
      {(localError || plugin.lastError) && <p role="alert">{localError ?? plugin.lastError}</p>}
      {result && (
        <div className="plugin-host-section__result" role="status">
          <p>{result.summary}</p>
          {result.lines.length > 0 && (
            <ul>
              {result.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
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
                size="sm"
                variant="default"
                onClick={apply}
                disabled={!canRun}
                disabledReason={runDisabledReason}
              >
                Apply {result.renames.length} renames
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Mounted once by SettingsDialog, even while the dialog itself is closed. */
export function PluginRuntimeBridge() {
  const editor = useOptionalEditor();
  useEffect(() => {
    pluginController.setEditor(editor ?? null);
  }, [editor]);
  useEffect(() => {
    let started = false;
    let registry: ReturnType<typeof getActionRegistry> | null = null;
    const handler = () => window.dispatchEvent(new Event('varve:open-plugin-settings'));
    const onRecovery = (event: Event) => {
      const recovery = event as CustomEvent<{ pluginId?: string }>;
      if (
        !pluginController
          .getSnapshot()
          .plugins.some((entry) => entry.id === recovery.detail?.pluginId)
      )
        return;
      event.preventDefault();
      handler();
    };
    const syncSafeMode = () => {
      try {
        const state = new LocalStorageSafeModeStore(window.localStorage).load();
        pluginController.setSafeModeDisabled(Boolean(state?.options.disableExtensions));
      } catch {
        pluginController.setSafeModeDisabled(true);
      }
    };
    const start = () => {
      if (started) return;
      started = true;
      syncSafeMode();
      pluginController.setSectionRenderer((pluginId, commandId) => (
        <PluginHostSection pluginId={pluginId} commandId={commandId} />
      ));
      void pluginController.initialize();
      registry = getActionRegistry();
      window.addEventListener('varve:plugin-recovery', onRecovery);
      window.addEventListener('varve:safe-mode-change', syncSafeMode);
      if (!registry.has('managePlugins')) {
        registry.register(
          { id: 'managePlugins', label: 'Manage Plugins…', category: 'tools' },
          handler,
        );
      }
    };
    const onSafeModeReady = () => start();
    if (document.documentElement.dataset.varveSafeModeReady === 'true') start();
    else window.addEventListener('varve:safe-mode-ready', onSafeModeReady, { once: true });
    return () => {
      window.removeEventListener('varve:safe-mode-ready', onSafeModeReady);
      if (!started) return;
      window.removeEventListener('varve:plugin-recovery', onRecovery);
      window.removeEventListener('varve:safe-mode-change', syncSafeMode);
      pluginController.setEditor(null);
      pluginController.setSectionRenderer(null);
      if (registry?.get('managePlugins')?.handler === handler) registry.remove('managePlugins');
    };
  }, []);
  return null;
}
