import { CHROME_ICONS, Icon } from '@strata/ui';
import { useEditor } from './context';

export function LayersPanel() {
  const { state, setSelection } = useEditor();

  const layers = [
    { id: 'n1', name: 'Frame 1' },
    { id: 'n2', name: 'Ellipse' },
    { id: 'n3', name: 'Text', locked: true },
  ];

  return (
    <div className="editor-layers">
      <div className="editor-inspector__group-title">Layers</div>
      <div role="listbox" aria-label="Layers" style={{ margin: 0, padding: 0 }}>
        {layers.map((l) => (
          <div
            key={l.id}
            role="option"
            aria-selected={state.selection === l.id}
            tabIndex={0}
            onClick={() => setSelection(l.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setSelection(l.id);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              background:
                state.selection === l.id ? 'var(--color-interactive-default)' : 'transparent',
              color:
                state.selection === l.id
                  ? 'var(--color-text-on-accent)'
                  : 'var(--color-text-primary)',
              opacity: l.locked ? 0.5 : 1,
            }}
          >
            <Icon name={CHROME_ICONS.visibility} size="0.85em" label="" />
            <span style={{ flex: 1, fontSize: 'var(--font-size-sm)' }}>{l.name}</span>
            <Icon
              name={l.locked ? CHROME_ICONS.lock : CHROME_ICONS.unlock}
              size="0.75em"
              label=""
            />
          </div>
        ))}
      </div>
    </div>
  );
}
