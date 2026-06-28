/**
 * Layers panel — listbox of document layers (Strata plan §5.5).
 */
import { CHROME_ICONS, Icon } from '@strata/ui';
import { useEditor } from './context';

export function LayersPanel() {
  const { state, setSelection, renameSelected, rootNodes } = useEditor();

  return (
    <div className="editor-layers">
      <div className="editor-inspector__group-title">Layers</div>
      <div role="listbox" aria-label="Layers" style={{ margin: 0, padding: 0 }}>
        {rootNodes().map((n) => (
          <div
            key={n.id}
            role="option"
            aria-selected={state.selection === n.id}
            tabIndex={0}
            onClick={() => setSelection(n.id)}
            onDoubleClick={() => {
              const name = prompt('Rename layer', n.name);
              if (name) renameSelected(name);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setSelection(n.id);
              if (e.key === 'Delete') useEditor().removeSelected();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              background:
                state.selection === n.id ? 'var(--color-interactive-default)' : 'transparent',
              color:
                state.selection === n.id
                  ? 'var(--color-text-on-accent)'
                  : 'var(--color-text-primary)',
            }}
          >
            <Icon name={CHROME_ICONS.visibility} size="0.85em" label="" />
            <span style={{ flex: 1, fontSize: 'var(--font-size-sm)' }}>{n.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
