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
import type { SelectOption, SelectOptionGroup } from './Select';

export interface MultiSelectProps {
  options?: SelectOption[];
  groups?: SelectOptionGroup[];
  values?: string[];
  defaultValues?: string[];
  onValuesChange?: (values: string[]) => void;
  /** Compatibility alias for callers that use the single-select naming. */
  onChange?: (values: string[]) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  description?: string;
  searchable?: boolean;
  maxSelected?: number;
  limitMessage?: string;
  noResultsLabel?: string;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

const SEARCH_MIN_OPTIONS = 10;

function flattenOptions(options: SelectOption[], groups: SelectOptionGroup[]): SelectOption[] {
  return [...options, ...groups.flatMap((group) => group.options)];
}

function enabledIndex(options: SelectOption[], preferred: number): number {
  if (options.length === 0) return -1;
  const start = preferred >= 0 && preferred < options.length ? preferred : 0;
  if (!options[start]?.disabled) return start;
  return options.findIndex((option) => !option.disabled);
}

export function MultiSelect({
  options = [],
  groups = [],
  values,
  defaultValues = [],
  onValuesChange,
  onChange,
  label,
  placeholder = 'Select options',
  disabled = false,
  error,
  description,
  searchable = false,
  maxSelected,
  limitMessage = 'Selection limit reached',
  noResultsLabel = 'No matching options',
  id,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: MultiSelectProps) {
  const [internalValues, setInternalValues] = useState(defaultValues);
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [filterText, setFilterText] = useState('');
  const [limitReached, setLimitReached] = useState(false);
  const isControlled = values !== undefined;
  const selectedValues = isControlled ? values : internalValues;
  const allOptions = useMemo(() => flattenOptions(options, groups), [groups, options]);
  const shouldShowSearch = searchable && allOptions.length > SEARCH_MIN_OPTIONS;
  const filteredOptions = useMemo(() => {
    const query = filterText.trim().toLocaleLowerCase();
    if (!shouldShowSearch || !query) return allOptions;
    return allOptions.filter((option) => {
      const text = `${option.label} ${option.description ?? ''}`.toLocaleLowerCase();
      return text.includes(query);
    });
  }, [allOptions, filterText, shouldShowSearch]);
  const filteredGroups = useMemo(() => {
    if (!shouldShowSearch || !filterText) {
      return groups.length > 0
        ? [...(options.length > 0 ? [{ label: '', options }] : []), ...groups]
        : [{ label: '', options }];
    }
    const visible = new Set(filteredOptions);
    return [...(options.length > 0 ? [{ label: '', options }] : []), ...groups]
      .map((group) => ({
        ...group,
        options: group.options.filter((option) => visible.has(option)),
      }))
      .filter((group) => group.options.length > 0);
  }, [filterText, filteredOptions, groups, options, shouldShowSearch]);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const limitId = useId();
  const staleId = useId();

  const registerOverlay = useNestedOverlayRegistration();
  useEffect(() => {
    if (!open) return;
    const unregister = registerOverlay();
    return unregister;
  }, [open, registerOverlay]);

  const selectedOptionLabels = useMemo(
    () => selectedValues.map((value) => allOptions.find((option) => option.value === value)?.label),
    [allOptions, selectedValues],
  );
  const hasStaleValues = selectedOptionLabels.some((label) => !label);
  const activeDescendant =
    open && highlightedIdx >= 0 && filteredOptions[highlightedIdx]
      ? `${listboxId}-option-${highlightedIdx}`
      : undefined;
  const highlightedValue = filteredOptions[highlightedIdx]?.value;
  const describedBy =
    [
      ariaDescribedBy,
      description ? descriptionId : undefined,
      error ? errorId : undefined,
      limitReached ? limitId : undefined,
      hasStaleValues ? staleId : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  useEffect(() => {
    if (!open || filteredOptions.length === 0) return;
    const current = filteredOptions[highlightedIdx];
    if (current && !current.disabled) return;
    const firstEnabled = filteredOptions.findIndex((option) => !option.disabled);
    if (firstEnabled >= 0) setHighlightedIdx(firstEnabled);
  }, [filteredOptions, highlightedIdx, open]);

  useEffect(() => {
    if (!open || !highlightedValue) return;
    const highlighted = listboxRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    highlighted?.scrollIntoView({ block: 'nearest' });
  }, [highlightedValue, open]);

  useEffect(() => {
    if (!open || !shouldShowSearch) return;
    const ownerWindow = triggerRef.current?.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const frame = ownerWindow.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => ownerWindow.cancelAnimationFrame(frame);
  }, [open, shouldShowSearch]);

  useEffect(() => {
    if (open) return;
    setFilterText('');
    setHighlightedIdx(0);
    setLimitReached(false);
  }, [open]);

  const close = useCallback(() => {
    const ownerDocument = triggerRef.current?.ownerDocument ?? document;
    if (listboxRef.current?.contains(ownerDocument.activeElement)) triggerRef.current?.focus();
    setOpen(false);
  }, []);

  const emitValues = useCallback(
    (nextValues: string[]) => {
      const uniqueValues = [...new Set(nextValues)];
      if (!isControlled) setInternalValues(uniqueValues);
      (onValuesChange ?? onChange)?.(uniqueValues);
    },
    [isControlled, onChange, onValuesChange],
  );

  const toggleOption = useCallback(
    (option: SelectOption) => {
      if (option.disabled) return;
      const selected = selectedValues.includes(option.value);
      if (!selected && maxSelected !== undefined && selectedValues.length >= maxSelected) {
        setLimitReached(true);
        return;
      }
      setLimitReached(false);
      emitValues(
        selected
          ? selectedValues.filter((value) => value !== option.value)
          : [...selectedValues, option.value],
      );
    },
    [emitValues, maxSelected, selectedValues],
  );

  const nextEnabledIdx = useCallback(
    (from: number, step: 1 | -1) => {
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

  const activateHighlighted = useCallback(() => {
    const option = filteredOptions[highlightedIdx];
    if (option) toggleOption(option);
  }, [filteredOptions, highlightedIdx, toggleOption]);

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
          setHighlightedIdx(enabledIndex(filteredOptions, 0));
          setOpen(true);
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
        case ' ':
          event.preventDefault();
          activateHighlighted();
          break;
        case 'Escape':
          event.preventDefault();
          close();
          break;
        case 'Tab':
          close();
          break;
      }
    },
    [activateHighlighted, close, filteredOptions, nextEnabledIdx, open],
  );

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        event.stopPropagation();
        handleKeyDown(event);
      }
    },
    [close, handleKeyDown],
  );

  const renderOption = (option: SelectOption) => {
    const index = filteredOptions.indexOf(option);
    const isSelected = selectedValues.includes(option.value);
    const isHighlighted = index === highlightedIdx;
    return (
      // biome-ignore lint/a11y/useFocusableInteractive: focus is managed by the listbox owner.
      // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation is managed by the listbox owner.
      <div
        key={option.value}
        id={`${listboxId}-option-${index}`}
        role="option"
        aria-selected={isSelected}
        aria-disabled={option.disabled || undefined}
        data-highlighted={isHighlighted || undefined}
        className={`varve-multi-select__option${isHighlighted ? ' varve-multi-select__option--highlighted' : ''}${isSelected ? ' varve-multi-select__option--selected' : ''}${option.disabled ? ' varve-multi-select__option--disabled' : ''}`}
        onClick={() => toggleOption(option)}
        onMouseEnter={() => {
          if (!option.disabled) setHighlightedIdx(index);
        }}
      >
        <span className="varve-multi-select__option-copy">
          <span className="varve-multi-select__option-label">{option.label}</span>
          {(option.description || option.disabledReason) && (
            <span className="varve-multi-select__option-description">
              {option.disabledReason ?? option.description}
            </span>
          )}
        </span>
        {isSelected && <SolidIcon name="Check" className="varve-multi-select__check" />}
      </div>
    );
  };

  const selectedCount = selectedValues.length;
  const summary =
    selectedCount === 0
      ? placeholder
      : selectedCount === 1
        ? (selectedOptionLabels[0] ?? 'Unavailable selection')
        : `${selectedCount} selected`;
  const rootClassName = ['varve-multi-select', className].filter(Boolean).join(' ');

  return (
    <div className={rootClassName} data-stale={hasStaleValues || undefined}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeDescendant}
        aria-label={ariaLabel ?? label}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={`varve-multi-select__trigger${error ? ' varve-multi-select__trigger--error' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={handleKeyDown}
      >
        <span
          className={
            selectedCount > 0 ? 'varve-multi-select__value' : 'varve-multi-select__placeholder'
          }
        >
          {summary}
        </span>
        <SolidIcon name="CaretDown" className="varve-multi-select__chevron" />
      </button>

      <FloatingPortal
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        kind="listbox"
        dismissOnEscape={false}
        matchAnchorWidth
        maxHeight={280}
        placement="bottom-start"
        className="varve-floating-layer"
      >
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          className="varve-multi-select__listbox"
          style={{ position: 'static' }}
        >
          {shouldShowSearch && (
            <div className="varve-multi-select__search">
              <input
                ref={searchInputRef}
                type="search"
                value={filterText}
                placeholder="Filter options…"
                aria-label={`Filter ${label}`}
                aria-controls={listboxId}
                aria-activedescendant={activeDescendant}
                onChange={(event) => {
                  setFilterText(event.target.value);
                  setHighlightedIdx(0);
                }}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
          )}
          {filteredOptions.length === 0 ? (
            <div className="varve-multi-select__state">{noResultsLabel}</div>
          ) : (
            filteredGroups.map((group) => {
              const content = group.options.map(renderOption);
              return group.label ? (
                <div key={`group-${group.label}`} className="varve-multi-select__group">
                  <div className="varve-multi-select__group-label">{group.label}</div>
                  {content}
                </div>
              ) : (
                <div
                  key={`ungrouped-${group.options[0]?.value ?? 'options'}`}
                  className="varve-multi-select__group"
                >
                  {content}
                </div>
              );
            })
          )}
        </div>
      </FloatingPortal>

      {description && (
        <div id={descriptionId} className="varve-multi-select__description">
          {description}
        </div>
      )}
      {hasStaleValues && (
        <div id={staleId} className="varve-multi-select__stale" role="status">
          Some selected values are unavailable
        </div>
      )}
      {limitReached && (
        <div id={limitId} className="varve-multi-select__limit" role="status">
          {limitMessage}
        </div>
      )}
      {error && (
        <div id={errorId} className="varve-multi-select__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
