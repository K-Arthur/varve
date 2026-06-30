import { type InputHTMLAttributes, useCallback, useId, useRef } from 'react';
import { Icon } from '../icons/Icon';

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  /** Number of visible results (announced to SR). */
  resultCount?: number;
  placeholder?: string;
}

export function SearchField({
  value,
  onChange,
  resultCount,
  placeholder = 'Search files...',
  className = '',
  ...rest
}: SearchFieldProps) {
  const id = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const clear = useCallback(() => {
    onChange('');
    inputRef.current?.focus();
  }, [onChange]);

  return (
    <div className={`strata-search ${className}`.trim()}>
      <Icon name="Search" className="strata-search__icon" />
      <input
        ref={inputRef}
        id={id}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={value.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={undefined}
        className="strata-search__input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      {value && (
        <button
          type="button"
          className="strata-search__clear"
          aria-label="Clear search"
          onClick={clear}
        >
          <Icon name="X" />
        </button>
      )}
      <div
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic
        className="strata-visually-hidden"
      >
        {resultCount !== undefined
          ? `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`
          : ''}
      </div>
    </div>
  );
}

/**
 * Render text with search matches highlighted using `<mark>`.
 * Matches are case-insensitive. The highlight uses weight + underline, never
 * color alone (WCAG 2.2 SC 1.4.1).
 */
export function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));

  let offset = 0;
  return (
    <>
      {parts.map((part) => {
        const key = `${offset}:${part}`;
        offset += part.length;
        return part.toLowerCase() === query.toLowerCase() ? (
          <mark key={key} className="strata-search__match">
            {part}
          </mark>
        ) : (
          <span key={key}>{part}</span>
        );
      })}
    </>
  );
}
