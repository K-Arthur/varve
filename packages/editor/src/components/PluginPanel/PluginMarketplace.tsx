import { installPlugin, listMarketplacePlugins, type StrataPlugin } from '@strata/plugin-sandbox';
import { Button, Icon, type IconName } from '@strata/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

const CATEGORIES = [
  { value: '', label: 'All' },
  { value: 'export', label: 'Export' },
  { value: 'accessibility', label: 'Accessibility' },
  { value: 'icons', label: 'Icons' },
  { value: 'layout', label: 'Layout' },
];

export function PluginMarketplace() {
  const [plugins, setPlugins] = useState<StrataPlugin[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const load = useCallback(() => {
    listMarketplacePlugins().then(setPlugins);
  }, []);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    return plugins.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (category && !p.description.toLowerCase().includes(category.toLowerCase())) return false;
      return true;
    });
  }, [plugins, search, category]);

  const handleInstall = useCallback(
    async (id: string) => {
      await installPlugin(id);
      load();
    },
    [load],
  );

  return (
    <div className="plugin-marketplace">
      <div className="plugin-marketplace__toolbar">
        <div className="plugin-marketplace__search">
          <Icon name="Search" size={14} />
          <input
            type="text"
            className="plugin-marketplace__search-input"
            placeholder="Search plugins..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search plugins"
          />
        </div>
        <select
          className="plugin-marketplace__category-select"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: intentional div with role for custom layout */}
      <div className="plugin-marketplace__grid" role="list" aria-label="Available plugins">
        {filtered.map((plugin) => (
          // biome-ignore lint/a11y/useSemanticElements: intentional div with role for custom layout
          <div key={plugin.id} className="plugin-marketplace__card" role="listitem">
            <div className="plugin-marketplace__card-icon">
              <Icon name={plugin.icon as IconName} size={24} />
            </div>
            <div className="plugin-marketplace__card-info">
              <div className="plugin-marketplace__card-name">{plugin.name}</div>
              <div className="plugin-marketplace__card-desc">{plugin.description}</div>
              <div className="plugin-marketplace__card-version">v{plugin.version}</div>
            </div>
            <div className="plugin-marketplace__card-actions">
              <Button variant="secondary" size="sm" onClick={() => handleInstall(plugin.id)}>
                Install
              </Button>
              <button
                type="button"
                className="plugin-marketplace__card-perms"
                aria-label={`View permissions for ${plugin.name}`}
              >
                {plugin.permissions.length} permission{plugin.permissions.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="plugin-marketplace__empty">
          <Icon name="Package" size={32} />
          <p>No plugins found</p>
        </div>
      )}
    </div>
  );
}
