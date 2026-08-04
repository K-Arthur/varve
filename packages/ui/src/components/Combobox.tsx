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
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  /** When true, only allows selecting from the options list. */
  restrictToOptions?: boolean;
}

export function Combobox({
  value,
  onChange,
  options,
  label,
  placeholder = '',
  disabled = false,
  error,
  restrictToOptions = false,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const [inputValue, setInputValue] = useState(value);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const announcerId = useId();
  const listboxId = useId();
  const errorId = useId();

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const filteredOptions = useMemo(() => {
    if (!inputValue) return options;
    const lower = inputValue.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
  }, [options, inputValue]);

  // Clamp the highlighted index when filtering shrinks the option list so
  // aria-activedescendant never references a missing option.
  useEffect(() => {
    if (highlightedIdx >= filteredOptions.length) {
      setHighlightedIdx(filteredOptions.length - 1);
    } else if (filteredOptions.length > 0 && highlightedIdx < 0) {
      setHighlightedIdx(0);
    }
  }, [filteredOptions.length, highlightedIdx]);

  const close = useCallback(() => {
    setOpen(false);
    setHighlightedIdx(-1);
  }, []);

  const commit = useCallback(
    (val: string) => {
      if (restrictToOptions) {
        const match = options.find((o) => o.label === val);
        if (match) {
          onChange(match.value);
          setInputValue(match.label);
        }
      } else {
        onChange(val);
      }
      close();
    },
    [options, onChange, restrictToOptions, close],
  );

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, close]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIdx((i) => (i + 1) % filteredOptions.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIdx((i) => (i - 1 + filteredOptions.length) % filteredOptions.length);
          break;
        case 'Enter': {
          e.preventDefault();
          const option = filteredOptions[highlightedIdx];
          if (highlightedIdx >= 0 && highlightedIdx < filteredOptions.length && option) {
            commit(option.label);
          } else {
            commit(inputValue);
          }
          break;
        }
        case 'Escape':
          e.preventDefault();
          close();
          break;
        case 'Tab':
          close();
          break;
      }
    },
    [open, filteredOptions, highlightedIdx, inputValue, commit, close],
  );

  return (
    <div
      className={`varve-combobox${error ? ' varve-combobox--error' : ''}${
        disabled ? ' varve-combobox--disabled' : ''
      }`}
      ref={containerRef}
    >
      <label
        className="varve-combobox__label"
        id={`${listboxId}-label`}
        htmlFor={`${listboxId}-input`}
      >
        {label}
      </label>
      <div className="varve-combobox__wrapper" ref={wrapperRef}>
        <input
          ref={inputRef}
          id={`${listboxId}-input`}
          type="text"
          className="varve-combobox__input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-labelledby={`${listboxId}-label`}
          aria-activedescendant={
            highlightedIdx >= 0 ? `${listboxId}-option-${highlightedIdx}` : undefined
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder={placeholder}
          disabled={disabled}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (restrictToOptions) {
              const match = options.find((o) => o.label === inputValue);
              if (match) {
                onChange(match.value);
              }
            }
          }}
        />
      </div>
      {error && (
        <span className="varve-combobox__error" id={errorId} role="alert">
          {error}
        </span>
      )}
      <div className="sr-only" role="status" aria-live="polite" id={announcerId}>
        {open && filteredOptions.length > 0
          ? `${filteredOptions.length} suggestion${filteredOptions.length === 1 ? '' : 's'} available`
          : ''}
      </div>
      {open && filteredOptions.length > 0 && (
        <FloatingPortal anchorRef={wrapperRef} open={open}>
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={`${listboxId}-label`}
            className="varve-combobox__listbox"
          >
            {filteredOptions.map((opt, idx) => (
              // biome-ignore lint/a11y/useFocusableInteractive: APG combobox pattern — options are non-focusable in an aria-activedescendant listbox; the input owns keyboard navigation.
              <div
                key={opt.value}
                id={`${listboxId}-option-${idx}`}
                role="option"
                aria-selected={opt.label === inputValue}
                aria-disabled={opt.disabled}
                className={`varve-combobox__option${
                  idx === highlightedIdx ? ' varve-combobox__option--highlighted' : ''
                }${opt.disabled ? ' varve-combobox__option--disabled' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!opt.disabled) commit(opt.label);
                }}
                onMouseEnter={() => setHighlightedIdx(idx)}
              >
                {opt.label}
              </div>
            ))}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
