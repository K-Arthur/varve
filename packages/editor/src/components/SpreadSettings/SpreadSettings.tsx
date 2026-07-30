import { useState } from 'react';
import { useEditor } from '../../context';
import { SectionCollapseToggle } from '../SectionCollapseToggle';
import './spread-settings.css';

export function SpreadSettings() {
  const { state, setFacingPagesEnabled, getPageSide } = useEditor();
  // Collapsible for the same reason as its sibling sections: they stack above
  // the layers tree in one fixed-height column.
  const [collapsed, setCollapsed] = useState(false);

  const doc = state.document;
  const config = doc.facingPages;
  const spreads = doc.spreads ?? [];
  const activePageId = doc.activePageId;
  const activeSide = activePageId ? getPageSide(activePageId) : 'none';

  // Only show in print mode — spread/facing-pages is a print production feature
  if (state.workspaceMode !== 'print') {
    return null;
  }

  return (
    <div className="spread-settings">
      <div className="spread-settings__header">
        <SectionCollapseToggle
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
          label="spreads"
        />
        <span className="spread-settings__title">Spreads</span>
      </div>

      {!collapsed && (
        <>
          <label className="spread-settings__toggle">
            <input
              type="checkbox"
              checked={config?.enabled ?? false}
              onChange={(e) => setFacingPagesEnabled(e.target.checked)}
            />
            <span>Facing Pages</span>
          </label>

          {config?.enabled && (
            <div className="spread-settings__info">
              <div className="spread-settings__row">
                <span>Spreads</span>
                <span>{spreads.length}</span>
              </div>
              <div className="spread-settings__row">
                <span>Current page side</span>
                <span>{activeSide}</span>
              </div>
              <div className="spread-settings__row">
                <span>Start on right</span>
                <span>{config.startOnRight ? 'Yes' : 'No'}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
