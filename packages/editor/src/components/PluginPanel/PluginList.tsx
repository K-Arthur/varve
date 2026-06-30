import {
  listInstalledPlugins,
  removePlugin,
  type StrataPlugin,
  togglePlugin,
} from '@strata/plugin-sandbox';
import { EmptyState, Icon, type IconName, Tooltip } from '@strata/ui';
import { useCallback, useEffect, useState } from 'react';
import { PermissionDialog } from './PermissionDialog';

export function PluginList() {
  const [plugins, setPlugins] = useState<StrataPlugin[]>([]);
  const [permPlugin, setPermPlugin] = useState<StrataPlugin | null>(null);

  const load = useCallback(() => {
    listInstalledPlugins().then(setPlugins);
  }, []);

  useEffect(load, [load]);

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      await togglePlugin(id, enabled);
      load();
    },
    [load],
  );

  const handleRemove = useCallback(
    async (id: string) => {
      await removePlugin(id);
      load();
    },
    [load],
  );

  if (plugins.length === 0) {
    return (
      <div className="plugin-list">
        <EmptyState
          illustration={
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>No plugins</title>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          }
          headline="No plugins installed"
          description="Browse the marketplace to find plugins that extend Strata's capabilities."
        />
      </div>
    );
  }

  return (
    <div className="plugin-list">
      <div className="plugin-list__header">
        <h3 className="plugin-list__title">Installed Plugins</h3>
        <span className="plugin-list__count">{plugins.length}</span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: intentional div with role for custom component */}
      <div className="plugin-list__items" role="list" aria-label="Installed plugins">
        {plugins.map((plugin) => (
          // biome-ignore lint/a11y/useSemanticElements: intentional div with role for custom component
          <div key={plugin.id} className="plugin-list__item" role="listitem">
            <div className="plugin-list__item-icon">
              <Icon name={plugin.icon as IconName} size={20} />
            </div>
            <div className="plugin-list__item-info">
              <div className="plugin-list__item-name">{plugin.name}</div>
              <div className="plugin-list__item-desc">{plugin.description}</div>
              <div className="plugin-list__item-version">v{plugin.version}</div>
              <button
                type="button"
                className="plugin-list__item-perms"
                onClick={() => setPermPlugin(plugin)}
              >
                {plugin.permissions.length} permission{plugin.permissions.length !== 1 ? 's' : ''}
              </button>
            </div>
            <div className="plugin-list__item-actions">
              <label className="plugin-list__toggle" aria-label={`Toggle ${plugin.name}`}>
                <input
                  type="checkbox"
                  checked={plugin.enabled}
                  onChange={(e) => handleToggle(plugin.id, e.target.checked)}
                />
                <span className="plugin-list__toggle-slider" />
              </label>
              <Tooltip label={`Remove ${plugin.name}`}>
                <button
                  type="button"
                  className="plugin-list__remove-btn"
                  onClick={() => handleRemove(plugin.id)}
                  aria-label={`Remove ${plugin.name}`}
                >
                  <Icon name="Trash2" size={14} />
                </button>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
      {permPlugin && <PermissionDialog plugin={permPlugin} onClose={() => setPermPlugin(null)} />}
    </div>
  );
}
