import { Button, Input, Select, ToggleButton } from '@varve/ui';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { LocalTokenDraft } from './localCreation';

export interface LocalTokenCandidate {
  path: string;
  type: string;
  value?: unknown;
}

export interface LocalTokenFormProps {
  onCreate: (draft: LocalTokenDraft) => void;
  tokens: readonly LocalTokenCandidate[];
}

type TokenType = LocalTokenDraft['type'];
type DimensionUnit = NonNullable<LocalTokenDraft['unit']>;

export function localTokenRuntimeNotice(
  draft: LocalTokenDraft,
  referencedValue?: unknown,
): string | undefined {
  const referenceIsRemDimension =
    referencedValue !== null &&
    typeof referencedValue === 'object' &&
    'unit' in referencedValue &&
    referencedValue.unit === 'rem';
  if (
    draft.type === 'dimension' &&
    (draft.reference ? referenceIsRemDimension : draft.unit === 'rem')
  ) {
    return 'This rem dimension stays in the token source. It cannot drive a length property until Varve has a document root font size.';
  }
  if (draft.type === 'fontFamily') {
    return 'This font family stays in the token source. Current scene bindings do not map font-family properties.';
  }
  if (draft.type === 'fontWeight') {
    return 'This font weight stays in the token source. Current scene bindings do not map font-weight properties.';
  }
  if (draft.type === 'color') {
    try {
      const authored = draft.reference
        ? referencedValue
        : (JSON.parse(draft.value) as { components?: unknown });
      if (!authored || typeof authored !== 'object') return undefined;
      const components = 'components' in authored ? authored.components : undefined;
      if (Array.isArray(components) && components.includes('none')) {
        return 'This color stays in the token source. Its “none” component needs an interpolation context before it can drive artwork.';
      }
    } catch {
      // Hex values and incomplete edits have no retained-only warning here.
    }
  }
  return undefined;
}

const TOKEN_TYPES: Array<{ value: TokenType; label: string }> = [
  { value: 'color', label: 'Color' },
  { value: 'number', label: 'Number' },
  { value: 'dimension', label: 'Dimension' },
  { value: 'fontFamily', label: 'Font family' },
  { value: 'fontWeight', label: 'Font weight (numeric)' },
];

const DIMENSION_UNITS: Array<{ value: DimensionUnit; label: string }> = [
  { value: 'px', label: 'px' },
  { value: 'rem', label: 'rem' },
];

export function LocalTokenForm({ onCreate, tokens }: LocalTokenFormProps) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const [type, setType] = useState<TokenType | ''>('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<DimensionUnit>('px');
  const [aliasEnabled, setAliasEnabled] = useState(false);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusAfterCloseRef = useRef(false);

  const aliasCandidates = type ? tokens.filter((token) => token.type === type) : [];
  const draftForNotice: LocalTokenDraft | undefined =
    type === ''
      ? undefined
      : {
          path,
          type,
          value,
          ...(type === 'dimension' ? { unit } : {}),
          ...(aliasEnabled ? { reference } : {}),
        };
  const referenceCandidate = aliasCandidates.find((token) => token.path === reference);
  const runtimeNotice = draftForNotice
    ? localTokenRuntimeNotice(draftForNotice, referenceCandidate?.value)
    : undefined;

  useEffect(() => {
    if (open) {
      pathInputRef.current?.focus();
      return;
    }
    if (returnFocusAfterCloseRef.current) {
      returnFocusAfterCloseRef.current = false;
      openButtonRef.current?.focus();
    }
  }, [open]);

  const resetAndClose = () => {
    returnFocusAfterCloseRef.current = true;
    setOpen(false);
    setPath('');
    setType('');
    setValue('');
    setUnit('px');
    setAliasEnabled(false);
    setReference('');
    setError(null);
  };

  const handleEscape = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    resetAndClose();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      setError('Enter the full dot-separated token path, such as color.brand.primary.');
      return;
    }
    if (!type) {
      setError('Choose a token type. The type is never inferred from the value.');
      return;
    }
    if (aliasEnabled && !reference) {
      setError('Choose an existing token with the same type to create this alias.');
      return;
    }
    if (!aliasEnabled && !value.trim()) {
      setError('Enter a value for this token.');
      return;
    }

    const draft: LocalTokenDraft = {
      path: normalizedPath,
      type,
      value: aliasEnabled ? '' : value,
      ...(type === 'dimension' ? { unit } : {}),
      ...(aliasEnabled ? { reference } : {}),
    };

    try {
      onCreate(draft);
      resetAndClose();
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'Token could not be created. Check the path and value, then try again.',
      );
    }
  };

  const updatePath = (next: string) => {
    setPath(next);
    setError(null);
  };
  const updateValue = (next: string) => {
    setValue(next);
    setError(null);
  };

  return (
    <div className="local-token-form">
      {!open ? (
        <Button ref={openButtonRef} variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Create token
        </Button>
      ) : (
        <form
          className="local-token-form__fields"
          aria-label="Create local token"
          onSubmit={handleSubmit}
          onKeyDown={handleEscape}
        >
          <h3 className="local-token-form__title">New local token</h3>
          <Input
            ref={pathInputRef}
            label="Full token path"
            hint="Use the complete dot-separated path, such as color.brand.primary."
            value={path}
            onChange={(event) => updatePath(event.target.value)}
            placeholder="color.brand.primary"
            autoComplete="off"
            aria-required="true"
          />
          <Select
            label="Token type"
            placeholder="Choose a type"
            value={type}
            options={TOKEN_TYPES}
            onValueChange={(next) => {
              setType(next as TokenType);
              setReference('');
              setAliasEnabled(false);
              setError(null);
            }}
            required
          />

          {!aliasEnabled && type === 'color' && (
            <Input
              label="Hex color value"
              hint="Enter a 6 or 8 digit hex color, or a structured DTCG color value as JSON."
              value={value}
              onChange={(event) => updateValue(event.target.value)}
              placeholder="#336699"
              autoComplete="off"
              aria-required={!aliasEnabled}
            />
          )}
          {!aliasEnabled && type === 'number' && (
            <Input
              label="Number value"
              type="number"
              step="any"
              value={value}
              onChange={(event) => updateValue(event.target.value)}
              placeholder="0"
              aria-required={!aliasEnabled}
            />
          )}
          {!aliasEnabled && type === 'dimension' && (
            <div className="local-token-form__dimension">
              <Input
                label="Dimension value"
                type="number"
                step="any"
                value={value}
                onChange={(event) => updateValue(event.target.value)}
                placeholder="8"
                aria-required={!aliasEnabled}
              />
              <Select
                label="Dimension unit"
                value={unit}
                options={DIMENSION_UNITS}
                onValueChange={(next) => setUnit(next as DimensionUnit)}
              />
            </div>
          )}
          {!aliasEnabled && type === 'fontFamily' && (
            <Input
              label="Font family value"
              value={value}
              onChange={(event) => updateValue(event.target.value)}
              placeholder="Inter"
              autoComplete="off"
              aria-required={!aliasEnabled}
            />
          )}
          {!aliasEnabled && type === 'fontWeight' && (
            <Input
              label="Numeric font weight"
              type="number"
              min={1}
              max={1000}
              step={1}
              value={value}
              onChange={(event) => updateValue(event.target.value)}
              placeholder="400"
              aria-required={!aliasEnabled}
            />
          )}

          <div className="local-token-form__alias">
            <ToggleButton
              size="sm"
              label="Create as alias"
              pressed={aliasEnabled}
              disabled={!type || aliasCandidates.length === 0}
              onPressedChange={(pressed) => {
                setAliasEnabled(pressed);
                setReference('');
                setError(null);
              }}
            >
              Create as alias
            </ToggleButton>
            {type && aliasCandidates.length === 0 && (
              <p className="local-token-form__hint">
                No existing {TOKEN_TYPES.find((item) => item.value === type)?.label.toLowerCase()}{' '}
                tokens are available to alias.
              </p>
            )}
          </div>
          {aliasEnabled && (
            <>
              <Select
                label="Alias target"
                placeholder="Choose a token path"
                value={reference}
                options={aliasCandidates.map((token) => ({
                  value: token.path,
                  label: token.path,
                }))}
                onValueChange={(next) => {
                  setReference(next);
                  setError(null);
                }}
                required
              />
              <p className="local-token-form__hint">
                The value will come from the selected same-type token.
              </p>
            </>
          )}

          <p className="local-token-form__hint">
            This form creates scalar tokens. Composite values remain available through source
            content JSON.
          </p>
          {runtimeNotice && (
            <p className="local-token-form__hint" role="status" aria-live="polite">
              {runtimeNotice}
            </p>
          )}
          {error && (
            <p className="local-token-form__error" role="alert">
              {error}
            </p>
          )}
          <div className="local-token-form__actions">
            <Button type="submit" size="sm">
              Add token
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={resetAndClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
