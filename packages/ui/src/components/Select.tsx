import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { SolidIconName } from '../icons/SolidIcon';
import { SolidIcon } from '../icons/SolidIcon';
import { FloatingPortal } from './FloatingPortal';
import { useNestedOverlayRegistration } from './NestedOverlayContext';

export type SelectStatus = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface SelectOption {
  /** Stable persisted value. Display labels must not be used as identifiers. */
  value: string;
  label: string;
  disabled?: boolean;
  /** Optional supporting copy for rich or constrained choices. */
  description?: string;
  /** Explain an important disabled constraint instead of relying on opacity. */
  disabledReason?: string;
  /** Semantic state only; do not use this to decorate ordinary options. */
  status?: SelectStatus;
  /** Recognition aid for object types or other semantically meaningful choices. */
  icon?: SolidIconName;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectProps {
  /** Flat options. When groups are supplied, these render before the groups. */
  options?: SelectOption[];
  /** Meaningful labelled groups. Grouping is intentionally data-driven. */
  groups?: SelectOptionGroup[];
  /** Controlled value. Omit it to use `defaultValue`/uncontrolled state. */
  value?: string;
  defaultValue?: string;
  /** Preferred name for new callers. `onChange` remains a compatibility alias. */
  onValueChange?: (value: string) => void;
  onChange?: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  description?: string;
  searchable?: boolean;
  /** Text shown when a persisted value is absent from a dynamic option list. */
  staleValueLabel?: string;
  /** Text shown when search has no matches. */
  noResultsLabel?: string;
  loading?: boolean;
  loadingLabel?: string;
  loadError?: string;
  onRetry?: () => void;
  id?: string;
  className?: string;
  name?: string;
  required?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

const SELECT_SEARCH_MIN_OPTIONS = 10;

function optionGroups(options: SelectOption[], groups: SelectOptionGroup[]): SelectOptionGroup[] {
  const result: SelectOptionGroup[] = [];
  if (options.length > 0) result.push({ label: '', options });
  result.push(...groups);
  return result;
}

function enabledIndex(options: SelectOption[], preferred: number): number {
  if (options.length === 0) return -1;
  const start = preferred >= 0 && preferred < options.length ? preferred : 0;
  if (!options[start]?.disabled) return start;
  return options.findIndex((option) => !option.disabled);
}

export function Select({
  options = [],
  groups = [],
  value,
  defaultValue = '',
  onValueChange,
  onChange,
  label,
  placeholder = 'Select...',
  disabled = false,
  error,
  description,
  searchable = false,
  staleValueLabel = 'Unavailable selection',
  noResultsLabel = 'No matching options',
  loading = false,
  loadingLabel = 'Loading options…',
  loadError,
  onRetry,
  id,
  className,
  name,
  required = false,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: SelectProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [filterText, setFilterText] = useState('');

  const isControlled = value !== undefined;
  const selectedValue = isControlled ? value : internalValue;
  const allGroups = useMemo(() => optionGroups(options, groups), [options, groups]);
  const allOptions = useMemo(() => allGroups.flatMap((group) => group.options), [allGroups]);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const typeAheadBuffer = useRef('');
  const typeAheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const staleId = useId();
  const announcerId = useId();

  const registerOverlay = useNestedOverlayRegistration();
  useEffect(() => {
    if (!open) return;
    const unregister = registerOverlay();
    return unregister;
  }, [open, registerOverlay]);

  const selectedOption = useMemo(
    () => allOptions.find((option) => option.value === selectedValue),
    [allOptions, selectedValue],
  );
  const hasStaleValue = Boolean(selectedValue) && !selectedOption;
  const shouldShowSearch = searchable && allOptions.length > SELECT_SEARCH_MIN_OPTIONS;

  const filteredOptions = useMemo(() => {
    if (!shouldShowSearch || !filterText) return allOptions;
    const normalizedFilter = filterText.trim().toLocaleLowerCase();
    if (!normalizedFilter) return allOptions;
    return allOptions.filter((option) => {
      const searchableText = `${option.label} ${option.description ?? ''}`.toLocaleLowerCase();
      return searchableText.includes(normalizedFilter);
    });
  }, [allOptions, filterText, shouldShowSearch]);

  const filteredGroups = useMemo(() => {
    if (!shouldShowSearch || !filterText) return allGroups;
    const visible = new Set(filteredOptions);
    return allGroups
      .map((group) => ({
        ...group,
        options: group.options.filter((option) => visible.has(option)),
      }))
      .filter((group) => group.options.length > 0);
  }, [allGroups, filterText, filteredOptions, shouldShowSearch]);

  const highlightedValue = filteredOptions[highlightedIdx]?.value;

  useEffect(() => {
    if (!open || !highlightedValue) return;
    const highlighted = listboxRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    highlighted?.scrollIntoView({ block: 'nearest' });
  }, [open, highlightedValue]);

  useEffect(() => {
    if (!open || !shouldShowSearch) return;
    const ownerWindow = triggerRef.current?.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const frame = ownerWindow.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => ownerWindow.cancelAnimationFrame(frame);
  }, [open, shouldShowSearch]);

  useEffect(() => {
    if (open) return;
    setHighlightedIdx(0);
    setFilterText('');
  }, [open]);

  useEffect(() => {
    if (!open || filteredOptions.length === 0) return;
    const current = filteredOptions[highlightedIdx];
    if (current && !current.disabled) return;
    const firstEnabled = filteredOptions.findIndex((option) => !option.disabled);
    if (firstEnabled >= 0) setHighlightedIdx(firstEnabled);
  }, [open, filteredOptions, highlightedIdx]);

  useEffect(() => {
    return () => {
      if (typeAheadTimer.current) clearTimeout(typeAheadTimer.current);
    };
  }, []);

  const closeListbox = useCallback(() => {
    const ownerDocument = triggerRef.current?.ownerDocument ?? document;
    const active = ownerDocument.activeElement;
    if (active && listboxRef.current?.contains(active)) triggerRef.current?.focus();
    setOpen(false);
  }, []);

  const openListbox = useCallback(() => {
    if (disabled) return;
    const selectedIndex = allOptions.findIndex((option) => option.value === selectedValue);
    setHighlightedIdx(enabledIndex(allOptions, selectedIndex));
    setOpen(true);
  }, [allOptions, disabled, selectedValue]);

  const emitChange = useCallback(
    (nextValue: string) => {
      if (!isControlled) setInternalValue(nextValue);
      (onValueChange ?? onChange)?.(nextValue);
    },
    [isControlled, onChange, onValueChange],
  );

  const selectOption = useCallback(
    (option: SelectOption) => {
      if (option.disabled) return;
      emitChange(option.value);
      closeListbox();
    },
    [closeListbox, emitChange],
  );

  const nextEnabledIdx = useCallback(
    (from: number, step: 1 | -1): number => {
      if (filteredOptions.length === 0) return -1;
      for (let i = 0; i < filteredOptions.length; i += 1) {
        const index = from + step * i;
        if (index < 0 || index >= filteredOptions.length) break;
        if (!filteredOptions[index]?.disabled) return index;
      }
      return from;
    },
    [filteredOptions],
  );

  const selectHighlighted = useCallback(() => {
    const option = filteredOptions[highlightedIdx];
    if (option) selectOption(option);
  }, [filteredOptions, highlightedIdx, selectOption]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!open) {
        if (
          event.key === 'ArrowDown' ||
          event.key === 'ArrowUp' ||
          event.key === 'Enter' ||
          event.key === ' '
        ) {
          event.preventDefault();
          openListbox();
        }
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setHighlightedIdx((index) =>
            nextEnabledIdx(Math.min(index + 1, filteredOptions.length - 1), 1),
          );
          break;
        case 'ArrowUp':
          event.preventDefault();
          setHighlightedIdx((index) => nextEnabledIdx(Math.max(index - 1, 0), -1));
          break;
        case 'Home':
          event.preventDefault();
          setHighlightedIdx(nextEnabledIdx(0, 1));
          break;
        case 'End':
          event.preventDefault();
          setHighlightedIdx(nextEnabledIdx(filteredOptions.length - 1, -1));
          break;
        case 'Enter':
          event.preventDefault();
          selectHighlighted();
          break;
        case 'Escape':
          event.preventDefault();
          closeListbox();
          break;
        case 'Tab':
          closeListbox();
          break;
      }
    },
    [closeListbox, filteredOptions.length, nextEnabledIdx, open, openListbox, selectHighlighted],
  );

  const handleTypeAhead = useCallback(
    (character: string) => {
      typeAheadBuffer.current += character.toLocaleLowerCase();
      const index = filteredOptions.findIndex(
        (option) =>
          !option.disabled && option.label.toLocaleLowerCase().startsWith(typeAheadBuffer.current),
      );
      if (index >= 0) setHighlightedIdx(index);
      if (typeAheadTimer.current) clearTimeout(typeAheadTimer.current);
      typeAheadTimer.current = setTimeout(() => {
        typeAheadBuffer.current = '';
      }, 500);
    },
    [filteredOptions],
  );

  const handleTriggerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key.length === 1 && event.key !== ' ' && !shouldShowSearch) {
        if (!open) openListbox();
        handleTypeAhead(event.key);
        return;
      }
      handleKeyDown(event);
    },
    [handleKeyDown, handleTypeAhead, open, openListbox, shouldShowSearch],
  );

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeListbox();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
        event.stopPropagation();
        handleKeyDown(event);
      }
    },
    [closeListbox, handleKeyDown],
  );

  const highlightedId =
    open && highlightedIdx >= 0 && filteredOptions[highlightedIdx]
      ? `${listboxId}-option-${highlightedIdx}`
      : undefined;
  const describedBy =
    [
      ariaDescribedBy,
      description ? descriptionId : undefined,
      error ? errorId : undefined,
      hasStaleValue ? staleId : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  const triggerLabel = ariaLabel ?? label;
  const selectClassName = ['varve-select', className].filter(Boolean).join(' ');

  const renderOption = (option: SelectOption) => {
    const index = filteredOptions.indexOf(option);
    const isSelected = option.value === selectedValue;
    const isHighlighted = index === highlightedIdx;
    return (
      // biome-ignore lint/a11y/useFocusableInteractive: focus is managed by the parent combobox via aria-activedescendant.
      // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation is handled by the parent combobox.
      <div
        key={option.value}
        id={`${listboxId}-option-${index}`}
        role="option"
        aria-selected={isSelected}
        aria-disabled={option.disabled || undefined}
        data-highlighted={isHighlighted || undefined}
        className={`varve-select__option${isHighlighted ? ' varve-select__option--highlighted' : ''}${isSelected ? ' varve-select__option--selected' : ''}${option.disabled ? ' varve-select__option--disabled' : ''}`}
        onClick={() => selectOption(option)}
        onMouseEnter={() => {
          if (!option.disabled) setHighlightedIdx(index);
        }}
      >
        {option.icon && <SolidIcon name={option.icon} className="varve-select__option-icon" />}
        {option.status && (
          <span
            aria-hidden
            className={`varve-select__status varve-select__status--${option.status}`}
          />
        )}
        <span className="varve-select__option-copy">
          <span className="varve-select__option-label">{option.label}</span>
          {(option.description || option.disabledReason) && (
            <span className="varve-select__option-description">
              {option.disabledReason ?? option.description}
            </span>
          )}
        </span>
        {isSelected && <SolidIcon name="Check" className="varve-select__check" />}
      </div>
    );
  };

  return (
    <div ref={containerRef} className={selectClassName} data-stale={hasStaleValue || undefined}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        name={name}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={highlightedId}
        aria-required={required || undefined}
        aria-label={triggerLabel}
        aria-labelledby={ariaLabelledBy}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`varve-select__trigger${error ? ' varve-select__trigger--error' : ''}${disabled ? ' varve-select__trigger--disabled' : ''}${hasStaleValue ? ' varve-select__trigger--stale' : ''}`}
        onClick={() => (open ? closeListbox() : openListbox())}
        onKeyDown={handleTriggerKeyDown}
        title={hasStaleValue ? `${staleValueLabel}: ${selectedValue}` : undefined}
      >
        {selectedOption?.icon && (
          <SolidIcon name={selectedOption.icon} className="varve-select__value-icon" />
        )}
        {selectedOption?.status && (
          <span
            aria-hidden
            className={`varve-select__status varve-select__status--${selectedOption.status}`}
          />
        )}
        <span className={selectedOption ? 'varve-select__value' : 'varve-select__placeholder'}>
          {selectedOption?.label ?? (hasStaleValue ? staleValueLabel : placeholder)}
        </span>
        <SolidIcon name="CaretDown" className="varve-select__chevron" />
      </button>

      <FloatingPortal
        anchorRef={triggerRef}
        open={open}
        onClose={closeListbox}
        kind="listbox"
        dismissOnEscape={false}
        matchAnchorWidth
        maxHeight={256}
        placement="bottom-start"
        className="varve-floating-layer"
      >
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="varve-select__listbox"
          style={{ position: 'static' }}
        >
          {shouldShowSearch && (
            <div className="varve-select__search">
              <input
                ref={searchInputRef}
                type="search"
                className="varve-select__search-input"
                placeholder="Filter options…"
                aria-label={`Filter ${label}`}
                aria-controls={listboxId}
                aria-activedescendant={highlightedId}
                value={filterText}
                onChange={(event) => {
                  setFilterText(event.target.value);
                  setHighlightedIdx(0);
                }}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
          )}
          {loading ? (
            <div className="varve-select__state" role="status">
              {loadingLabel}
            </div>
          ) : loadError ? (
            <div className="varve-select__state varve-select__state--error" role="alert">
              <span>{loadError}</span>
              {onRetry && (
                <button type="button" className="varve-select__retry" onClick={onRetry}>
                  Retry
                </button>
              )}
            </div>
          ) : filteredOptions.length === 0 ? (
            <div className="varve-select__state">{noResultsLabel}</div>
          ) : (
            filteredGroups.map((group) => {
              const content = group.options.map(renderOption);
              const groupKey = group.label || group.options[0]?.value || 'ungrouped';
              return group.label ? (
                <div key={`group-${groupKey}`} className="varve-select__group">
                  <div className="varve-select__group-label">{group.label}</div>
                  {content}
                </div>
              ) : (
                <div key={`ungrouped-${groupKey}`} className="varve-select__group">
                  {content}
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
        {open && filteredOptions.length > 0
          ? `${filteredOptions.length} option${filteredOptions.length === 1 ? '' : 's'} available`
          : ''}
      </div>
      {description && (
        <div id={descriptionId} className="varve-select__description">
          {description}
        </div>
      )}
      {hasStaleValue && (
        <div id={staleId} className="varve-select__stale" role="status">
          {staleValueLabel}
        </div>
      )}
      {error && (
        <div id={errorId} role="alert" className="varve-select__error">
          {error}
        </div>
      )}
    </div>
  );
}
