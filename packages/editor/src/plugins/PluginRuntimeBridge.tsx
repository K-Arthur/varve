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

  const run = () => {
    setLocalError(null);
    void pluginController.run(pluginId, commandId).catch((error: unknown) => {
      setLocalError(error instanceof Error ? error.message : String(error));
    });
  };

  const apply = () => {
    setLocalError(null);
    try {
      pluginController.apply(pluginId, commandId);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="plugin-host-section">
      <p className="plugin-host-section__hint">{plugin.manifest.name} · Local plugin</p>
      <div className="plugin-host-section__actions">
        <button type="button" onClick={run} disabled={plugin.status === 'running' || needsWrite}>
          {command.title}
        </button>
        {plugin.status === 'running' && (
          <button type="button" onClick={() => pluginController.stop(pluginId)}>
            Stop
          </button>
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
              <button type="button" onClick={apply}>
                Apply {result.renames.length} renames
              </button>
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
    pluginController.setSectionRenderer((pluginId, commandId) => (
      <PluginHostSection pluginId={pluginId} commandId={commandId} />
    ));
    void pluginController.initialize();
    const registry = getActionRegistry();
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
    window.addEventListener('varve:plugin-recovery', onRecovery);
    if (!registry.has('managePlugins')) {
      registry.register(
        { id: 'managePlugins', label: 'Manage Plugins…', category: 'tools' },
        handler,
      );
    }
    return () => {
      window.removeEventListener('varve:plugin-recovery', onRecovery);
      pluginController.setEditor(null);
      pluginController.setSectionRenderer(null);
      if (registry.get('managePlugins')?.handler === handler) registry.remove('managePlugins');
    };
  }, []);
  return null;
}
