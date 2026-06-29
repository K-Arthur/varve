/**
 * Fill section — solid colour for the current selection.
 *
 * Uses the accessible ColorPicker (SV area / hue-alpha sliders / eyedropper).
 * Multi-select aware via commonValue/MIXED.
 *
 * Research basis: Figma color picker modal; WAI-APG Slider, Spinbutton, Listbox.
 */
import type { Color } from '@strata/engine';
import { useCallback, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { ColorPicker } from '../color/ColorPicker';
import { DisclosureSection } from '../controls/DisclosureSection';
import { commonValue, isMixed } from '../selection/selectionState';

export function FillSection({ nodes }: { nodes: import('@strata/scene').SceneNode[] }) {
  const { setSelectedFill } = useEditor();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  const fillRaw = commonValue(nodes, (n) => n.fill);
  const mixed = isMixed(fillRaw);
  const fill = mixed ? null : fillRaw;
  const swatchBg = fill
    ? `rgba(${fill[0]},${fill[1]},${fill[2]},${(fill[3] / 255).toFixed(2)})`
    : 'transparent';

  const handleChange = useCallback(
    (color: Color) => {
      setSelectedFill(color);
    },
    [setSelectedFill],
  );

  const toggleOpen = useCallback(() => setOpen((p) => !p), []);

  return (
    <DisclosureSection title="Fill">
      <div className="insp-field">
        <span className="insp-field__label">Colour</span>
        <div className="insp-field__control" style={{ position: 'relative' }}>
          <div
            ref={triggerRef}
            role="button"
            tabIndex={0}
            aria-label={`Fill colour${fill ? ` ${fill[0]},${fill[1]},${fill[2]}` : ''}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleOpen();
              }
            }}
            onClick={toggleOpen}
            style={{
              width: 24,
              height: 24,
              borderRadius: 'var(--radius-sm)',
              background: swatchBg,
              border: '2px solid var(--color-border-strong)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          />
          {mixed && (
            <span
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)',
                marginLeft: 'var(--space-2)',
              }}
            >
              Mixed
            </span>
          )}
          {open && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                zIndex: 'var(--z-overlay)',
                marginTop: 'var(--space-1)',
                background: 'var(--color-surface-overlay)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                width: 260,
                padding: 'var(--space-3)',
              }}
            >
              <ColorPicker value={fill ?? [255, 255, 255, 255]} onChange={handleChange} />
            </div>
          )}
        </div>
      </div>
    </DisclosureSection>
  );
}
