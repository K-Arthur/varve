import { useEditor } from '../../context';
import './spread-settings.css';

export function SpreadSettings() {
  const { state, setFacingPagesEnabled, getPageSide } = useEditor();

  const doc = state.document;
  const config = doc.facingPages;
  const spreads = doc.spreads ?? [];
  const activePageId = doc.activePageId;
  const activeSide = activePageId ? getPageSide(activePageId) : 'none';

  return (
    <div className="spread-settings">
      <div className="spread-settings__header">
        <span className="spread-settings__title">Spreads</span>
      </div>

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
    </div>
  );
}
