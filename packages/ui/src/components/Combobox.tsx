import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FloatingPortal } from './FloatingPortal';

export interface ComboboxOption {
  /** Stable committed value. It is never inferred from the visible label. */
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  /** Committed value. The editable query is kept separately until commit. */
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  description?: string;
  loading?: boolean;
  loadingLabel?: string;
  noResultsLabel?: string;
  loadError?: string;
  onRetry?: () => void;
  id?: string;
  className?: string;
  /** When true, only allows selecting from the options list. */
  restrictToOptions?: boolean;
}

function displayValue(value: string, options: ComboboxOption[]): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** Exact labels must be unique before free typing can select an option. */
function exactOption(value: string, options: ComboboxOption[]): ComboboxOption | undefined {
  const valueMatch = options.find((option) => option.value === value && !option.disabled);
  if (valueMatch) return valueMatch;
  const labelMatches = options.filter((option) => option.label === value && !option.disabled);
  return labelMatches.length === 1 ? labelMatches[0] : undefined;
}

export function Combobox({
  value,
  onChange,
  options,
  label,
  placeholder = '',
  disabled = false,
  error,
  description,
  loading = false,
  loadingLabel = 'Loading options…',
  noResultsLabel = 'No matching options',
  loadError,
  onRetry,
  id,
  className,
  restrictToOptions = false,
}: ComboboxProps) {
  const listboxId = useId();
  const announcerId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const composingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const [inputValue, setInputValue] = useState(() => displayValue(value, options));

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );
  const committedInputValue = selectedOption?.label ?? value;

  // A parent value update reflects a real commit or a selection change. Draft
  // text is otherwise untouched, so filtering does not fight native editing.
  useEffect(() => {
    setInputValue(committedInputValue);
  }, [committedInputValue]);

  const filteredOptions = useMemo(() => {
    // A committed label is a display value, not a query. Opening a selected
    // combobox must still reveal the full collection; filtering begins only
    // after the user changes the draft text.
    if (!inputValue || inputValue === committedInputValue) return options;
    const lower = inputValue.toLocaleLowerCase();
    return options.filter((option) => option.label.toLocaleLowerCase().includes(lower));
  }, [committedInputValue, inputValue, options]);

  // Keep aria-activedescendant valid while filtering or while async options
  // are replaced beneath an open popup.
  useEffect(() => {
    if (highlightedIdx >= filteredOptions.length) {
      setHighlightedIdx(filteredOptions.length - 1);
    } else if (filteredOptions.length > 0 && highlightedIdx < 0) {
      setHighlightedIdx(filteredOptions.findIndex((option) => !option.disabled));
    } else if (filteredOptions[highlightedIdx]?.disabled) {
      const firstEnabled = filteredOptions.findIndex((option) => !option.disabled);
      if (firstEnabled >= 0) setHighlightedIdx(firstEnabled);
    }
  }, [filteredOptions, highlightedIdx]);

  const close = useCallback(
    (restoreInput: boolean) => {
      setOpen(false);
      setHighlightedIdx(-1);
      if (restoreInput) setInputValue(committedInputValue);
    },
    [committedInputValue],
  );

  const commitOption = useCallback(
    (option: ComboboxOption) => {
      if (option.disabled) return;
      onChange(option.value);
      setInputValue(option.label);
      close(false);
    },
    [close, onChange],
  );

  const commitInput = useCallback(
    (rawValue: string) => {
      const normalized = rawValue.trim();
      if (restrictToOptions) {
        const match = exactOption(normalized, options);
        if (!match) {
          close(true);
          return false;
        }
        commitOption(match);
        return true;
      }
      onChange(rawValue);
      close(false);
      return true;
    },
    [close, commitOption, onChange, options, restrictToOptions],
  );

  const dismiss = useCallback(() => close(false), [close]);
  const cancel = useCallback(() => close(true), [close]);

  const openWithHighlight = useCallback(() => {
    setOpen(true);
    setHighlightedIdx((current) => {
      if (current >= 0 && !filteredOptions[current]?.disabled) return current;
      return filteredOptions.findIndex((option) => !option.disabled);
    });
  }, [filteredOptions]);

  const commitHighlighted = useCallback(() => {
    const option = filteredOptions[highlightedIdx];
    if (option && !option.disabled) {
      commitOption(option);
      return;
    }
    commitInput(inputValue);
  }, [commitInput, commitOption, filteredOptions, highlightedIdx, inputValue]);

  /** Nearest selectable option index, scanning in `step` direction. */
  const nextEnabledIdx = useCallback(
    (from: number, step: 1 | -1): number => {
      const total = filteredOptions.length;
      if (total === 0) return -1;
      for (let i = 0; i < total; i += 1) {
        const idx = (((from + step * i) % total) + total) % total;
        if (!filteredOptions[idx]?.disabled) return idx;
      }
      return -1;
    },
    [filteredOptions],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || composingRef.current) return;
      if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        openWithHighlight();
        return;
      }
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setHighlightedIdx((index) => {
            const next = nextEnabledIdx(index + 1, 1);
            return next === -1 ? index : next;
          });
          break;
        case 'ArrowUp':
          event.preventDefault();
          setHighlightedIdx((index) => {
            const next = nextEnabledIdx(index - 1, -1);
            return next === -1 ? index : next;
          });
          break;
        case 'PageDown':
          event.preventDefault();
          setHighlightedIdx((index) => {
            const next = nextEnabledIdx(index + 5, 1);
            return next === -1 ? index : next;
          });
          break;
        case 'PageUp':
          event.preventDefault();
          setHighlightedIdx((index) => {
            const next = nextEnabledIdx(index - 5, -1);
            return next === -1 ? index : next;
          });
          break;
        case 'Enter':
          event.preventDefault();
          commitHighlighted();
          break;
        case 'Escape':
          // Dismiss one layer and restore the last committed display. This
          // prevents a highlighted option or an unfinished query from being
          // mistaken for a committed document value.
          event.preventDefault();
          event.stopPropagation();
          cancel();
          break;
        case 'Tab':
          dismiss();
          break;
      }
    },
    [cancel, commitHighlighted, dismiss, nextEnabledIdx, open, openWithHighlight],
  );

  const handleBlur = useCallback(() => {
    const ownerWindow = inputRef.current?.ownerDocument.defaultView;
    ownerWindow?.setTimeout(() => {
      const active = inputRef.current?.ownerDocument.activeElement;
      if (active && (active === inputRef.current || listboxRef.current?.contains(active))) return;
      if (inputValue !== committedInputValue) commitInput(inputValue);
      else dismiss();
    }, 0);
  }, [committedInputValue, commitInput, dismiss, inputValue]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    if (!open) openWithHighlight();
  }, [open, openWithHighlight]);

  const optionId = useCallback((index: number) => `${listboxId}-option-${index}`, [listboxId]);
  const describedBy =
    [description ? descriptionId : undefined, error ? errorId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;
  const statusText = loading
    ? loadingLabel
    : loadError
      ? loadError
      : filteredOptions.length > 0
        ? `${filteredOptions.length} suggestion${filteredOptions.length === 1 ? '' : 's'} available`
        : noResultsLabel;
  const inputId = id ?? `${listboxId}-input`;

  return (
    <div
      className={`varve-combobox${error ? ' varve-combobox--error' : ''}${
        disabled ? ' varve-combobox--disabled' : ''
      }${className ? ` ${className}` : ''}`}
      ref={containerRef}
    >
      <label className="varve-combobox__label" id={`${listboxId}-label`} htmlFor={inputId}>
        {label}
      </label>
      <div className="varve-combobox__wrapper">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className="varve-combobox__input"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-labelledby={`${listboxId}-label`}
          aria-activedescendant={
            highlightedIdx >= 0 && filteredOptions[highlightedIdx]
              ? optionId(highlightedIdx)
              : undefined
          }
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          placeholder={placeholder}
          disabled={disabled}
          value={inputValue}
          onChange={(event) => {
            setInputValue(event.target.value);
            if (!open) openWithHighlight();
          }}
          onFocus={openWithHighlight}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
        />
      </div>
      {description && (
        <span className="varve-combobox__description" id={descriptionId}>
          {description}
        </span>
      )}
      {error && (
        <span className="varve-combobox__error" id={errorId} role="alert">
          {error}
        </span>
      )}
      <div className="varve-visually-hidden" role="status" aria-live="polite" id={announcerId}>
        {open ? statusText : ''}
      </div>
      {open && (
        <FloatingPortal
          // Anchor below the complete field block so helper/error text is not
          // hidden underneath the popup while the user is choosing an option.
          anchorRef={containerRef}
          open={open}
          onClose={dismiss}
          kind="combobox-popup"
          dismissOnEscape={false}
          matchAnchorWidth
          className="varve-floating-layer"
        >
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={`${listboxId}-label`}
            aria-busy={loading || undefined}
            className="varve-combobox__listbox"
            style={{ position: 'static', width: '100%' }}
          >
            {loading ? (
              <div className="varve-combobox__state" role="status">
                {loadingLabel}
              </div>
            ) : loadError ? (
              <div className="varve-combobox__state varve-combobox__state--error" role="alert">
                <span>{loadError}</span>
                {onRetry && (
                  <button type="button" onClick={onRetry}>
                    Retry
                  </button>
                )}
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="varve-combobox__state">{noResultsLabel}</div>
            ) : (
              filteredOptions.map((option, index) => (
                // biome-ignore lint/a11y/useFocusableInteractive: APG combobox pattern — options are non-focusable in an aria-activedescendant listbox; the input owns keyboard navigation.
                <div
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled || undefined}
                  className={`varve-combobox__option${
                    index === highlightedIdx ? ' varve-combobox__option--highlighted' : ''
                  }${option.disabled ? ' varve-combobox__option--disabled' : ''}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    commitOption(option);
                  }}
                  onMouseEnter={() => {
                    if (!option.disabled) setHighlightedIdx(index);
                  }}
                >
                  {option.label}
                </div>
              ))
            )}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
