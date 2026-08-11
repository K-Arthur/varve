import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SolidIcon } from '../icons/SolidIcon';
import { FloatingPortal } from './FloatingPortal';
import { useNestedOverlayRegistration } from './NestedOverlayContext';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  searchable?: boolean;
}

const SEARCHABLE_THRESHOLD = 10;

export function Select({
  options,
  value,
  onChange,
  label,
  placeholder = 'Select...',
  disabled = false,
  error,
  searchable = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [filterText, setFilterText] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const announcerId = useId();
  const listboxId = useId();
  const errorId = useId();

  const registerOverlay = useNestedOverlayRegistration();
  useEffect(() => {
    if (open) {
      const unregister = registerOverlay();
      return unregister;
    }
  }, [open, registerOverlay]);

  const selectedOption = useMemo(() => options.find((o) => o.value === value), [options, value]);

  const shouldShowSearch = searchable && options.length > SEARCHABLE_THRESHOLD;

  const filteredOptions = useMemo(() => {
    if (!shouldShowSearch || !filterText) return options;
    const lower = filterText.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
  }, [options, filterText, shouldShowSearch]);

  useEffect(() => {
    if (!open) return;
    const listbox = listboxRef.current;
    if (!listbox) return;
    const highlighted = listbox.querySelector<HTMLElement>('[data-highlighted="true"]');
    highlighted?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  useEffect(() => {
    if (open && shouldShowSearch) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [open, shouldShowSearch]);

  useEffect(() => {
    if (!open) {
      setHighlightedIdx(0);
      setFilterText('');
    }
  }, [open]);

  const openListbox = useCallback(() => {
    if (disabled) return;
    const idx = value ? options.findIndex((o) => o.value === value) : 0;
    setHighlightedIdx(Math.max(0, idx));
    setOpen(true);
  }, [disabled, value, options]);

  const closeListbox = useCallback(() => {
    const active = document.activeElement;
    const listbox = listboxRef.current;
    const trigger = triggerRef.current;
    if (active && listbox?.contains(active) && trigger) {
      trigger.focus();
    }
    setOpen(false);
  }, []);

  const selectHighlighted = useCallback(() => {
    const option = filteredOptions[highlightedIdx];
    if (option && !option.disabled) {
      onChange(option.value);
    }
    closeListbox();
  }, [filteredOptions, highlightedIdx, onChange, closeListbox]);

  const handleTriggerClick = useCallback(() => {
    if (disabled) return;
    if (open) {
      closeListbox();
    } else {
      openListbox();
    }
  }, [disabled, open, closeListbox, openListbox]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openListbox();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIdx((i) => Math.min(i + 1, filteredOptions.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIdx((i) => Math.max(i - 1, 0));
          break;
        case 'Home':
          e.preventDefault();
          setHighlightedIdx(0);
          break;
        case 'End':
          e.preventDefault();
          setHighlightedIdx(filteredOptions.length - 1);
          break;
        case 'Enter':
          e.preventDefault();
          selectHighlighted();
          break;
        case 'Escape':
          e.preventDefault();
          closeListbox();
          break;
        case 'Tab':
          closeListbox();
          break;
      }
    },
    [open, filteredOptions.length, selectHighlighted, closeListbox, openListbox],
  );

  const typeAheadBuffer = useRef('');
  const typeAheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (typeAheadTimer.current) clearTimeout(typeAheadTimer.current);
    };
  }, []);

  const handleTypeAhead = useCallback(
    (char: string) => {
      typeAheadBuffer.current += char.toLowerCase();
      const idx = filteredOptions.findIndex((o) =>
        o.label.toLowerCase().startsWith(typeAheadBuffer.current),
      );
      if (idx !== -1) {
        setHighlightedIdx(idx);
      }
      if (typeAheadTimer.current) clearTimeout(typeAheadTimer.current);
      typeAheadTimer.current = setTimeout(() => {
        typeAheadBuffer.current = '';
      }, 500);
    },
    [filteredOptions],
  );

  const handleTriggerKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key.length === 1 && e.key !== ' ') {
        if (!open) {
          openListbox();
        }
        if (!shouldShowSearch) {
          handleTypeAhead(e.key);
        }
        return;
      }
      handleKeyDown(e);
    },
    [handleKeyDown, handleTypeAhead, open, openListbox, shouldShowSearch],
  );

  const highlightedId = useMemo(() => {
    if (!open || filteredOptions.length === 0) return undefined;
    return `${listboxId}-option-${highlightedIdx}`;
  }, [open, filteredOptions.length, highlightedIdx, listboxId]);

  const prevValueRef = useRef(value);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (prevValueRef.current !== value) {
      const opt = options.find((o) => o.value === value);
      if (opt) {
        setAnnouncement(`${opt.label} selected`);
      }
      prevValueRef.current = value;
    }
  }, [value, options]);

  const handleOptionClick = useCallback(
    (option: SelectOption) => {
      if (option.disabled) return;
      onChange(option.value);
      closeListbox();
    },
    [onChange, closeListbox],
  );

  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeListbox();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.stopPropagation();
        handleKeyDown(e);
        return;
      }
      if (e.key === 'Enter') {
        e.stopPropagation();
        selectHighlighted();
        return;
      }
    },
    [closeListbox, handleKeyDown, selectHighlighted],
  );

  return (
    <div ref={containerRef} className="varve-select">
      <div
        ref={triggerRef}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={highlightedId}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        tabIndex={disabled ? -1 : 0}
        className={`varve-select__trigger${error ? ' varve-select__trigger--error' : ''}${disabled ? ' varve-select__trigger--disabled' : ''}`}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        data-disabled={disabled || undefined}
      >
        <span className={selectedOption ? 'varve-select__value' : 'varve-select__placeholder'}>
          {selectedOption?.label ?? placeholder}
        </span>
        <SolidIcon name="CaretDown" className="varve-select__chevron" />
      </div>

      <FloatingPortal
        anchorRef={triggerRef}
        open={open}
        onClose={closeListbox}
        matchAnchorWidth
        maxHeight={256}
        placement="bottom-start"
      >
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="varve-select__listbox"
        >
          {shouldShowSearch && (
            <div className="varve-select__search">
              <input
                ref={searchInputRef}
                type="search"
                className="varve-select__search-input"
                placeholder="Filter..."
                value={filterText}
                onChange={(e) => {
                  setFilterText(e.target.value);
                  setHighlightedIdx(0);
                }}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
          )}
          {filteredOptions.length === 0 ? (
            <div className="varve-select__no-results">No results</div>
          ) : (
            filteredOptions.map((option, i) => {
              const isSelected = option.value === value;
              const isHighlighted = i === highlightedIdx;
              return (
                // biome-ignore lint/a11y/useFocusableInteractive: focus managed by aria-activedescendant on parent combobox
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard nav handled by parent listbox via aria-activedescendant
                <div
                  key={option.value}
                  id={`${listboxId}-option-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  data-highlighted={isHighlighted || undefined}
                  data-option-index={i}
                  className={`varve-select__option${isHighlighted ? ' varve-select__option--highlighted' : ''}${isSelected ? ' varve-select__option--selected' : ''}${option.disabled ? ' varve-select__option--disabled' : ''}`}
                  onClick={() => handleOptionClick(option)}
                  onMouseEnter={() => setHighlightedIdx(i)}
                >
                  <span className="varve-select__option-label">{option.label}</span>
                  {isSelected && <SolidIcon name="Check" className="varve-select__check" />}
                </div>
              );
            })
          )}
        </div>
      </FloatingPortal>

      <div
        id={announcerId}
        role="status"
        aria-live="polite"
        aria-atomic
        className="varve-visually-hidden"
      >
        {announcement}
      </div>

      {error && (
        <div id={errorId} role="alert" className="varve-select__error">
          {error}
        </div>
      )}
    </div>
  );
}
