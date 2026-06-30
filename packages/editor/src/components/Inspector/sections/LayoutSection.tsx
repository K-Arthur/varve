/**
 * Layout section — Taffy-backed flex/grid properties for a FrameNode selection.
 *
 * Mirrors strata-layout `LayoutStyle` (Rust). Single-frame in this foundation
 * slice; multi-frame batch + grid tracks + breakpoint binding arrive with the
 * layout model extension (Slice B6).
 */
import type { FlexDirection, FrameNode, LayoutMode, LayoutStyle } from '@strata/scene';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';

const NATIVE_SELECT: React.CSSProperties = {
  flex: 1,
  height: 'var(--space-5)',
  fontSize: 'var(--font-size-xs)',
  background: 'var(--color-surface-sunken)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-2)',
};

export function LayoutSection({ node }: { node: FrameNode }) {
  const { setNodeLayout } = useEditor();
  const ls = node.layoutStyle;

  function patch(partial: Partial<LayoutStyle>) {
    const base: LayoutStyle = ls ?? {
      mode: 'flex',
      direction: 'row',
      gap: 0,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 1,
    };
    setNodeLayout(node.id, { ...base, ...partial });
  }

  return (
    <DisclosureSection title="Layout">
      <FieldRow label="Mode" htmlFor={`layout-mode-${node.id}`}>
        <select
          id={`layout-mode-${node.id}`}
          value={ls?.mode ?? 'none'}
          style={NATIVE_SELECT}
          onChange={(e) => {
            if (e.target.value === 'none') setNodeLayout(node.id, undefined);
            else patch({ mode: e.target.value as LayoutMode });
          }}
        >
          <option value="none">None</option>
          <option value="flex">Flex</option>
          <option value="grid">Grid</option>
        </select>
      </FieldRow>
      {ls && (
        <>
          <FieldRow label="Direction" htmlFor={`layout-dir-${node.id}`}>
            <select
              id={`layout-dir-${node.id}`}
              value={ls.direction}
              style={NATIVE_SELECT}
              onChange={(e) => patch({ direction: e.target.value as FlexDirection })}
            >
              <option value="row">Row</option>
              <option value="column">Column</option>
              <option value="rowReverse">Row reverse</option>
              <option value="columnReverse">Column reverse</option>
            </select>
          </FieldRow>
          {ls.mode === 'grid' && (
            <>
              <FieldRow label="Grid Columns" htmlFor={`layout-grid-cols-${node.id}`}>
                <input
                  id={`layout-grid-cols-${node.id}`}
                  type="text"
                  value={ls.gridTemplateColumns ?? ''}
                  placeholder="e.g., 1fr 1fr 1fr"
                  style={NATIVE_SELECT}
                  onChange={(e) => patch({ gridTemplateColumns: e.target.value || undefined })}
                  aria-label="Grid template columns"
                />
              </FieldRow>
              <FieldRow label="Grid Rows" htmlFor={`layout-grid-rows-${node.id}`}>
                <input
                  id={`layout-grid-rows-${node.id}`}
                  type="text"
                  value={ls.gridTemplateRows ?? ''}
                  placeholder="e.g., auto 1fr auto"
                  style={NATIVE_SELECT}
                  onChange={(e) => patch({ gridTemplateRows: e.target.value || undefined })}
                  aria-label="Grid template rows"
                />
              </FieldRow>
            </>
          )}
          <NumberField
            label="Gap"
            unit="px"
            value={ls.gap}
            min={0}
            onChange={(v) => patch({ gap: v })}
          />
          <FieldRow label="Wrap">
            <input
              type="checkbox"
              checked={ls.wrap}
              aria-label="Wrap"
              onChange={(e) => patch({ wrap: e.target.checked })}
            />
          </FieldRow>
          <FieldRow label="Padding">
            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
              {(['T', 'R', 'B', 'L'] as const).map((side, i) => (
                <input
                  key={side}
                  type="number"
                  aria-label={`Padding ${side}`}
                  value={ls.padding[i] ?? 0}
                  step={1}
                  onChange={(e) => {
                    const p = [...ls.padding] as [number, number, number, number];
                    p[i] = Number(e.target.value) || 0;
                    patch({ padding: p });
                  }}
                  style={{
                    width: 36,
                    fontSize: 'var(--font-size-xs)',
                    background: 'var(--color-surface-sunken)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0 var(--space-1)',
                  }}
                />
              ))}
            </div>
          </FieldRow>
        </>
      )}
    </DisclosureSection>
  );
}
