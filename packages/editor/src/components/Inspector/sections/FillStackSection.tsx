/**
 * FillStackSection — multi-fill stack management for the Inspector.
 *
 * P2: Shows the fill stack (solid/gradient) with add/remove/reorder controls.
 * Each fill row has a type selector, color swatch, visibility toggle, and
 * delete button. Gradient fills expand to show a stop editor.
 *
 * Research basis: Figma fill stack panel with drag-to-reorder.
 */
import type { Color } from '@strata/engine';
import { type Fill, gradientFill } from '@strata/scene';
import { useCallback, useState } from 'react';
import { useEditor } from '../../../context';
import { ColorPicker } from '@strata/ui/components/ColorPicker';
import { DisclosureSection } from '../controls/DisclosureSection';
import { commonValue, isMixed } from '../selection/selectionState';
import { GradientStopEditor } from './GradientStopEditor';

export function FillStackSection({ nodes }: { nodes: import('@strata/scene').SceneNode[] }) {
  const editor = useEditor();
  const [openPickerIndex, setOpenPickerIndex] = useState<number | null>(null);
  const [expandedFill, setExpandedFill] = useState<number | null>(null);

  // Get the common fills across selected nodes
  const fillsRaw = commonValue(nodes, (n) => n.fills);
  const mixed = isMixed(fillsRaw);
  const fills = mixed ? null : fillsRaw;

  const handleAddSolid = useCallback(() => {
    editor.addSelectedFill({
      type: 'solid',
      color: [255, 255, 255, 255] as Color,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    });
  }, [editor]);

  const handleAddGradient = useCallback(() => {
    editor.addSelectedFill(
      gradientFill('linear', [
        { position: 0, color: [57, 208, 198, 255] as Color },
        { position: 1, color: [16, 21, 31, 255] as Color },
      ]),
    );
  }, [editor]);

  const handleRemove = useCallback(
    (index: number) => {
      editor.removeSelectedFillAt(index);
      if (openPickerIndex === index) setOpenPickerIndex(null);
      if (expandedFill === index) setExpandedFill(null);
    },
    [editor, openPickerIndex, expandedFill],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0) return;
      editor.reorderSelectedFill(index, index - 1);
    },
    [editor],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (!fills || index >= fills.length - 1) return;
      editor.reorderSelectedFill(index, index + 1);
    },
    [editor, fills],
  );

  const handleToggleVisible = useCallback(
    (index: number, fill: Fill) => {
      editor.updateSelectedFillAt(index, { ...fill, visible: !fill.visible });
    },
    [editor],
  );

  const handleColorChange = useCallback(
    (index: number, fill: Fill, color: Color) => {
      if (fill.type === 'solid') {
        editor.updateSelectedFillAt(index, { ...fill, color });
      } else if (fill.type === 'gradient' && fill.gradient) {
        // Update the first stop color for gradient
        const stops = [...fill.gradient.stops];
        if (stops.length > 0 && stops[0]) {
          stops[0] = { position: stops[0].position, color };
        }
        editor.updateSelectedFillAt(index, {
          ...fill,
          gradient: { ...fill.gradient, stops },
        });
      }
    },
    [editor],
  );

  return (
    <DisclosureSection title="Fills">
      {mixed && (
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          Mixed fill values
        </p>
      )}
      {fills && fills.length === 0 && (
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          No fills
        </p>
      )}
      {fills?.map((fill, i) => (
        <div
          key={i}
          style={{
            marginBottom: 'var(--space-1)',
            padding: 'var(--space-1)',
            background: 'var(--color-surface-sunken)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            {/* Color swatch */}
            <button
              type="button"
              aria-label={`Fill ${i + 1} color`}
              onClick={() => setOpenPickerIndex(openPickerIndex === i ? null : i)}
              style={{
                width: 20,
                height: 20,
                borderRadius: 'var(--radius-sm)',
                background: fillSwatchBg(fill),
                border: '2px solid var(--color-border-strong)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            />
            {/* Type label */}
            <span
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-secondary)',
                flex: 1,
              }}
            >
              {fill.type === 'solid' ? 'Solid' : fill.type === 'gradient' ? 'Gradient' : fill.type}
            </span>
            {/* Visibility toggle */}
            <button
              type="button"
              aria-label={fill.visible ? 'Hide fill' : 'Show fill'}
              title={fill.visible ? 'Hide' : 'Show'}
              onClick={() => handleToggleVisible(i, fill)}
              style={{
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: fill.visible ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                padding: 0,
                flexShrink: 0,
              }}
            >
              {fill.visible ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label="Visible"
                >
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label="Hidden"
                >
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
              )}
            </button>
            {/* Expand for gradient */}
            {fill.type === 'gradient' && (
              <button
                type="button"
                aria-label={expandedFill === i ? 'Collapse gradient' : 'Expand gradient'}
                title="Edit gradient"
                onClick={() => setExpandedFill(expandedFill === i ? null : i)}
                style={{
                  width: 20,
                  height: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ transform: expandedFill === i ? 'rotate(180deg)' : 'none' }}
                  role="img"
                  aria-label="Expand gradient"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
            {/* Move up */}
            <button
              type="button"
              aria-label="Move fill up"
              title="Move up"
              onClick={() => handleMoveUp(i)}
              disabled={i === 0}
              style={{
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                cursor: i === 0 ? 'default' : 'pointer',
                color: i === 0 ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                opacity: i === 0 ? 0.4 : 1,
                padding: 0,
                flexShrink: 0,
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label="Move up"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            {/* Move down */}
            <button
              type="button"
              aria-label="Move fill down"
              title="Move down"
              onClick={() => handleMoveDown(i)}
              disabled={!fills || i >= fills.length - 1}
              style={{
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                cursor: !fills || i >= fills.length - 1 ? 'default' : 'pointer',
                color:
                  !fills || i >= fills.length - 1
                    ? 'var(--color-text-muted)'
                    : 'var(--color-text-primary)',
                opacity: !fills || i >= fills.length - 1 ? 0.4 : 1,
                padding: 0,
                flexShrink: 0,
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label="Move down"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {/* Delete */}
            <button
              type="button"
              aria-label={`Delete fill ${i + 1}`}
              title="Delete"
              onClick={() => handleRemove(i)}
              disabled={fills.length <= 1}
              style={{
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                cursor: fills.length <= 1 ? 'default' : 'pointer',
                color:
                  fills.length <= 1 ? 'var(--color-text-muted)' : 'var(--color-feedback-danger)',
                opacity: fills.length <= 1 ? 0.4 : 1,
                padding: 0,
                flexShrink: 0,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label="Delete fill"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>

          {/* Color picker popover */}
          {openPickerIndex === i && (
            <div
              style={{
                marginTop: 'var(--space-1)',
                padding: 'var(--space-2)',
                background: 'var(--color-surface-overlay)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <ColorPicker
                value={fill.type === 'solid' && fill.color ? fill.color : [255, 255, 255, 255]}
                onChange={(color) => handleColorChange(i, fill, color)}
              />
            </div>
          )}

          {/* Gradient stop editor */}
          {expandedFill === i && fill.type === 'gradient' && fill.gradient && (
            <div style={{ marginTop: 'var(--space-1)' }}>
              <GradientStopEditor
                stops={fill.gradient.stops}
                rotation={fill.gradient.rotation ?? 0}
                onChange={(stops, rotation) => {
                  const grad = fill.gradient;
                  if (!grad) return;
                  editor.updateSelectedFillAt(i, {
                    ...fill,
                    gradient: { ...grad, stops, rotation },
                  });
                }}
              />
            </div>
          )}
        </div>
      ))}

      {/* Add fill buttons */}
      <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
        <button
          type="button"
          onClick={handleAddSolid}
          style={{
            flex: 1,
            padding: 'var(--space-1) var(--space-2)',
            fontSize: 'var(--font-size-xs)',
            background: 'var(--color-surface-sunken)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            color: 'var(--color-text-primary)',
          }}
        >
          + Solid
        </button>
        <button
          type="button"
          onClick={handleAddGradient}
          style={{
            flex: 1,
            padding: 'var(--space-1) var(--space-2)',
            fontSize: 'var(--font-size-xs)',
            background: 'var(--color-surface-sunken)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            color: 'var(--color-text-primary)',
          }}
        >
          + Gradient
        </button>
      </div>
    </DisclosureSection>
  );
}

/** Get a CSS background string for a fill swatch. */
function fillSwatchBg(fill: Fill): string {
  if (fill.type === 'solid' && fill.color) {
    const [r, g, b, a] = fill.color;
    return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
  }
  if (fill.type === 'gradient' && fill.gradient && fill.gradient.stops.length > 0) {
    const stops = fill.gradient.stops
      .map((s) => {
        const [r, g, b, a] = s.color;
        return `rgba(${r},${g},${b},${(a / 255).toFixed(2)}) ${(s.position * 100).toFixed(0)}%`;
      })
      .join(', ');
    return `linear-gradient(to right, ${stops})`;
  }
  return 'transparent';
}
