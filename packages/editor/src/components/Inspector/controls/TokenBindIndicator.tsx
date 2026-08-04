/**
 * TokenBindIndicator — shows a bound variable chip with name and unbind action.
 *
 * Renders inline next to a bound control (NumberField, ColorPicker).
 * Displays the variable name as a small badge/chip with an unbind (×) button.
 * Provides visual indication that the property is driven by a variable rather
 * than a direct value.
 *
 * Research basis: Figma variable binding chips; APG badge pattern.
 */
import { Tooltip } from '@varve/ui';
import { useCallback, useRef } from 'react';

export interface TokenBindIndicatorProps {
  /** Display name of the bound variable. */
  variableName: string;
  /** Called when the user clicks the unbind button. */
  onUnbind: () => void;
}

const CHIP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  fontSize: 'var(--font-size-xs)',
  height: 18,
  padding: '0 4px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-accent-subtle, rgba(57, 208, 198, 0.15))',
  color: 'var(--color-accent-default, #39d0c6)',
  border: '1px solid var(--color-accent-subtle, rgba(57, 208, 198, 0.3))',
  cursor: 'default',
  maxWidth: 120,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const BTN_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 14,
  height: 14,
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'inherit',
  borderRadius: '50%',
  fontSize: 10,
  lineHeight: 1,
  flexShrink: 0,
};

export function TokenBindIndicator({ variableName, onUnbind }: TokenBindIndicatorProps) {
  const chipRef = useRef<HTMLSpanElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onUnbind();
      }
    },
    [onUnbind],
  );

  return (
    <span
      ref={chipRef}
      role="status"
      style={CHIP_STYLE}
      aria-label={`Bound to variable: ${variableName}`}
      onKeyDown={handleKeyDown}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      <Tooltip label={variableName} truncationOnly>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{variableName}</span>
      </Tooltip>
      <Tooltip label="Unbind variable">
        <button
          type="button"
          style={BTN_STYLE}
          aria-label={`Unbind variable ${variableName}`}
          onClick={(e) => {
            e.stopPropagation();
            onUnbind();
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </Tooltip>
    </span>
  );
}
