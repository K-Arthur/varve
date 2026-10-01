/**
 * PatternFillControls — source, generator, repeat arrangement, placement, and a
 * live repeat preview for one pattern fill or a multi-selection with a common
 * source.
 *
 * Numeric batch edits show Mixed when selected values differ. Typing sets the
 * named field to one absolute value; arrow, wheel, and label-scrub gestures
 * apply the same delta to each fill's own value. A fill that resolves through
 * a shared Paint/asset is edited on the shared object's own surface, so a
 * shared change cannot be mistaken for a per-object fill transform.
 *
 * Terminology used by the field labels (so a number is never ambiguous):
 * - **tile** — the bitmap the pattern is made of;
 * - **gap** — empty space between tile copies;
 * - **row shift** — how far every other row slides sideways;
 * - **phase** — where the lattice origin sits;
 * - **rotation** — the whole pattern field, about the object centre.
 *
 * Research basis: Adobe Illustrator "Create and apply patterns" (artwork → tile,
 * tile vs art bounds, shared swatch editing); the fill system contract in
 * `docs/architecture/fill-system.md`; APG file-input and listbox patterns.
 */
import {
  generatePatternTile,
  PATTERN_TYPE_LABELS,
  PATTERN_TYPES,
  randomPatternSeed,
} from '@varve/engine';
import type { PatternDefinition, PatternFillData, PatternGeneratorRecipe } from '@varve/scene';
import {
  PATTERN_ARRANGEMENT_LABELS,
  PATTERN_ARRANGEMENTS,
  type PatternArrangement,
} from '@varve/shared';
import { Checkbox, Icon, Select } from '@varve/ui';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PatternNumericField } from '../../../patterns/patternSelectionFields';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { PatternRepeatPreview } from './PatternRepeatPreview';

export function PatternFillControls({
  pattern,
  onChange,
  onImportTile,
  definition,
  definitionTileSrc,
  mixedFields,
  onFieldChange,
  onFieldDelta,
  onPatternPatch,
  allowDetach = true,
  mixedRepeatSettings,
}: {
  pattern: PatternFillData;
  onChange: (p: PatternFillData) => void;
  onImportTile?: (dataUrl: string) => void;
  definition?: PatternDefinition;
  definitionTileSrc?: string;
  mixedFields?: Partial<Record<PatternNumericField, boolean>>;
  onFieldChange?: (field: PatternNumericField, value: number | undefined) => void;
  onFieldDelta?: (field: PatternNumericField, delta: number) => void;
  onPatternPatch?: (patch: Partial<PatternFillData>) => void;
  allowDetach?: boolean;
  mixedRepeatSettings?: { arrangement?: boolean; mirrorX?: boolean; mirrorY?: boolean };
}) {
  const linkedDefinition = definition?.id === pattern.definitionId ? definition : undefined;
  const resolvedPattern = linkedDefinition
    ? {
        ...pattern,
        tileSrc: definitionTileSrc ?? pattern.tileSrc,
        imageWidth: pattern.imageWidth ?? linkedDefinition.cell.width,
        imageHeight: pattern.imageHeight ?? linkedDefinition.cell.height,
        arrangement: pattern.arrangement ?? linkedDefinition.repeat.arrangement,
        gapX: pattern.gapX ?? linkedDefinition.repeat.gapX,
        gapY: pattern.gapY ?? linkedDefinition.repeat.gapY,
        rowShift: pattern.rowShift ?? linkedDefinition.repeat.rowShift,
        columnShift: pattern.columnShift ?? linkedDefinition.repeat.columnShift,
        mirrorX: pattern.mirrorX ?? linkedDefinition.repeat.mirrorX,
        mirrorY: pattern.mirrorY ?? linkedDefinition.repeat.mirrorY,
        offsetX: pattern.offsetX ?? linkedDefinition.repeat.originX,
        offsetY: pattern.offsetY ?? linkedDefinition.repeat.originY,
      }
    : {
        ...pattern,
        imageWidth: pattern.imageWidth ?? pattern.logicalWidth,
        imageHeight: pattern.imageHeight ?? pattern.logicalHeight,
      };
  const fileInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const pickPendingRef = useRef(false);
  const importGenerationRef = useRef(0);
  const pendingImportRef = useRef<{
    generation: number;
    pattern: PatternFillData;
    onChange: (value: PatternFillData) => void;
    onImportTile?: (dataUrl: string) => void;
    onPatternPatch?: (patch: Partial<PatternFillData>) => void;
  } | null>(null);
  const hasSrc = Boolean(resolvedPattern.tileSrc);
  const patch = useCallback(
    (next: Partial<PatternFillData>) => {
      if (onPatternPatch) onPatternPatch(next);
      else onChange({ ...pattern, ...next });
    },
    [onChange, onPatternPatch, pattern],
  );

  const openFilePicker = useCallback(() => {
    const generation = ++importGenerationRef.current;
    pendingImportRef.current = { generation, pattern, onChange, onImportTile, onPatternPatch };
    pickPendingRef.current = true;
    fileRef.current?.click();
  }, [pattern, onChange, onImportTile, onPatternPatch]);

  const handleFileChange = useCallback((e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const pending = pendingImportRef.current;
    pendingImportRef.current = null;
    if (!file || !pending) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string' && pending.generation === importGenerationRef.current) {
        // Importing a raster tile replaces any generator recipe: the bytes are
        // now the source, and the compiled tile is no longer editable
        // procedurally. Say so by dropping the recipe rather than keeping a
        // recipe that no longer feeds the tile.
        if (pending.onImportTile) pending.onImportTile(result);
        else if (pending.onPatternPatch)
          pending.onPatternPatch({ tileSrc: result, generator: undefined });
        else pending.onChange({ ...pending.pattern, tileSrc: result, generator: undefined });
      }
    };
    reader.readAsDataURL(file);
  }, []);

  // Ref-forwarded handler so all listeners stay attached once per node
  // lifetime while always invoking the logic for the CURRENT render.
  const handleFileChangeRef = useRef(handleFileChange);
  useEffect(() => {
    handleFileChangeRef.current = handleFileChange;
  });

  // The file-pick change must never be missed: a node-bound native listener
  // (survives detach mid-dialog) plus a document-capture fallback for a
  // subtree remount that replaces the input while the OS dialog is open.
  useEffect(() => {
    const dispatch = (e: Event) => {
      pickPendingRef.current = false;
      handleFileChangeRef.current(e);
    };
    const nodeHandler = (e: Event) => dispatch(e);
    const input = fileRef.current;
    input?.addEventListener('change', nodeHandler);
    const onDocChange = (e: Event) => {
      if (!pickPendingRef.current) return;
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'file') return;
      if (target === fileRef.current) return; // node listener handled it
      if (!target.classList.contains('insp-pattern-fill__file')) return;
      dispatch(e);
    };
    const onDocClick = (e: Event) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'file') return;
      if (!target.classList.contains('insp-pattern-fill__file')) return;
      pickPendingRef.current = true;
    };
    document.addEventListener('change', onDocChange, true);
    document.addEventListener('click', onDocClick, true);
    return () => {
      // The node listener is intentionally NOT removed on cleanup: if the
      // node is detached by a remount while the OS dialog is open, removing
      // it here would lose the user's file choice.
      document.removeEventListener('change', onDocChange, true);
      document.removeEventListener('click', onDocClick, true);
    };
  }, []);

  const clearTile = useCallback(() => {
    importGenerationRef.current += 1;
    pendingImportRef.current = null;
    patch({ tileSrc: '', generator: undefined });
  }, [patch]);

  const arrangement: PatternArrangement = pattern.arrangement ?? 'grid';
  const rowShiftDefault = arrangement === 'brick' ? 0.5 : 0;
  const columnShiftDefault = arrangement === 'half-drop' ? 0.5 : 0;
  const defaultSeedRef = useRef<number>(randomPatternSeed());
  const recipe = pattern.generator;
  const changeNumber = useCallback(
    (field: PatternNumericField, value: number | undefined) => {
      if (onFieldChange) onFieldChange(field, value);
      else patch({ [field]: value });
    },
    [onFieldChange, patch],
  );
  const deltaNumber = useCallback(
    (field: PatternNumericField) =>
      onFieldDelta ? (delta: number) => onFieldDelta(field, delta) : undefined,
    [onFieldDelta],
  );
  const hasMixedField = Object.values(mixedFields ?? {}).some(Boolean);
  const hasMixedRepeatSetting = Object.values(mixedRepeatSettings ?? {}).some(Boolean);

  const regenerate = useCallback(
    (nextRecipe: PatternGeneratorRecipe) => {
      const tile = generatePatternTile(
        // An unknown persisted type is kept in the recipe but cannot render
        // here; the generator falls back to a checkerboard.
        (PATTERN_TYPES as readonly string[]).includes(nextRecipe.type)
          ? (nextRecipe.type as (typeof PATTERN_TYPES)[number])
          : 'checkerboard',
        {
          tileSize: nextRecipe.tileWidth,
          tileWidth: nextRecipe.tileWidth,
          tileHeight: nextRecipe.tileHeight,
          color1: nextRecipe.color1,
          color2: nextRecipe.color2,
          seed: nextRecipe.seed,
          angle: nextRecipe.angle,
          density: nextRecipe.density,
          gap: nextRecipe.gap,
        },
      );
      if (!tile) return;
      patch({
        generator: nextRecipe,
        tileSrc: tile.dataUrl,
        // The generated raster is the *natural* size; placement overrides
        // (imageWidth/imageHeight) are left alone so a user's scale survives a
        // recipe edit. Logical size records what the artwork was authored at.
        logicalWidth: tile.width,
        logicalHeight: tile.height,
      });
    },
    [patch],
  );

  const editRecipe = useCallback(
    (next: Partial<PatternGeneratorRecipe>) => {
      const base: PatternGeneratorRecipe = recipe ?? {
        type: 'polka-dots',
        tileWidth: 64,
        tileHeight: 64,
        color1: '#ffffff',
        color2: '#101828',
        density: 0.3,
        seed: defaultSeedRef.current,
      };
      regenerate({ ...base, ...next });
    },
    [recipe, regenerate],
  );

  const sourceKind = recipe ? 'Procedural' : hasSrc ? 'Imported tile' : 'Empty';
  const logicalW = pattern.logicalWidth ?? resolvedPattern.imageWidth;
  const logicalH = pattern.logicalHeight ?? resolvedPattern.imageHeight;
  const sourceSummary = useMemo(() => {
    const parts = [sourceKind];
    if (recipe) {
      parts.push(
        PATTERN_TYPE_LABELS[recipe.type as keyof typeof PATTERN_TYPE_LABELS] ?? recipe.type,
      );
    }
    if (logicalW && logicalH) parts.push(`${logicalW}x${logicalH}px`);
    if (pattern.imageWidth || pattern.imageHeight) {
      parts.push(`placed at ${pattern.imageWidth ?? 'auto'}x${pattern.imageHeight ?? 'auto'}px`);
    }
    return parts.join(' · ');
  }, [sourceKind, recipe, logicalW, logicalH, pattern.imageWidth, pattern.imageHeight]);

  // A data URL is an implementation detail, not a useful source label. Keep
  // direct URL editing available on demand; choose/import and generator flows
  // are the normal entry points.
  const [showSourceField, setShowSourceField] = useState(!hasSrc);
  useEffect(() => {
    if (hasSrc) setShowSourceField(false);
  }, [hasSrc]);

  return (
    <div className="insp-pattern-controls">
      <PatternRepeatPreview pattern={resolvedPattern} />
      {hasMixedField || hasMixedRepeatSetting ? (
        <p className="insp-hint" role="note">
          Preview shows the first selected fill while these values are mixed.
        </p>
      ) : null}
      {!hasSrc && (
        <p className="insp-hint insp-image-fill__empty-hint" role="note">
          No tile selected — the fill is transparent until you choose a tile or generate one.
        </p>
      )}
      {linkedDefinition ? (
        <>
          <FieldRow label="Shared source">
            <span className="insp-pattern-summary">
              {linkedDefinition.name} · {linkedDefinition.source.kind} ·{' '}
              {linkedDefinition.cell.width} by {linkedDefinition.cell.height}px
            </span>
          </FieldRow>
          <p className="insp-hint" role="note">
            Source and repeat geometry are shared by {linkedDefinitionUsageLabel(linkedDefinition)}.
            Change this fill’s tile scale, phase and rotation below.
          </p>
          {allowDetach ? (
            <button
              type="button"
              className="insp-add-btn"
              onClick={() => onChange({ ...resolvedPattern, definitionId: undefined })}
            >
              Detach this fill from the definition
            </button>
          ) : (
            <p className="insp-hint" role="note">
              Detach one selected fill at a time to preserve different pattern sources.
            </p>
          )}
        </>
      ) : (
        <>
          <FieldRow label="Source">
            <span className="insp-pattern-summary" title={pattern.tileSrc || undefined}>
              {sourceSummary}
            </span>
          </FieldRow>
          <button
            type="button"
            className="insp-add-btn"
            aria-expanded={showSourceField}
            onClick={() => setShowSourceField((v) => !v)}
          >
            {showSourceField ? 'Hide source field' : 'Show source field'}
          </button>
          {showSourceField && (
            <FieldRow label="Tile source">
              <input
                type="text"
                value={pattern.tileSrc}
                aria-label="Pattern tile source"
                placeholder="URL or choose a file"
                onChange={(e) => patch({ tileSrc: e.target.value })}
                className="insp-num__input"
              />
            </FieldRow>
          )}
        </>
      )}
      {!linkedDefinition && (
        <div className="insp-image-fill__actions">
          <input
            ref={fileRef}
            id={fileInputId}
            type="file"
            accept="image/*"
            className="insp-image-fill__file insp-pattern-fill__file"
            aria-hidden
            tabIndex={-1}
          />
          <button
            type="button"
            className="insp-add-btn insp-image-fill__choose"
            onClick={openFilePicker}
          >
            <Icon name="Image" label={undefined} size="0.85em" />
            <span>{hasSrc ? 'Replace tile' : 'Choose tile'}</span>
          </button>
          {hasSrc && (
            <button
              type="button"
              className="insp-inline-btn"
              onClick={clearTile}
              aria-label="Clear tile"
            >
              <Icon name="X" label={undefined} size="0.85em" />
            </button>
          )}
        </div>
      )}
      {/* ── Generator ─────────────────────────────────────────────── */}
      {!linkedDefinition && !recipe && (
        <button type="button" className="insp-add-btn" onClick={() => editRecipe({})}>
          <Icon name="Sparkles" label={undefined} size="0.85em" />
          <span>Generate pattern</span>
        </button>
      )}
      {!linkedDefinition && recipe && (
        <>
          <Select
            label="Generator"
            value={recipe.type}
            options={PATTERN_TYPES.map((type) => ({
              value: type,
              label: PATTERN_TYPE_LABELS[type],
            }))}
            onValueChange={(value) => editRecipe({ type: value })}
          />
          <FieldRow label="Colours">
            <div className="insp-pattern-colors">
              <input
                type="color"
                aria-label="Pattern background colour"
                value={toHexInput(recipe.color1)}
                onChange={(e) => editRecipe({ color1: e.target.value })}
              />
              <input
                type="color"
                aria-label="Pattern motif colour"
                value={toHexInput(recipe.color2)}
                onChange={(e) => editRecipe({ color2: e.target.value })}
              />
            </div>
          </FieldRow>
          {recipe.type === 'stripes' && (
            <NumberField
              label="Band angle"
              unit="deg"
              value={recipe.angle ?? 45}
              onChange={(v) => editRecipe({ angle: v })}
            />
          )}
          {(recipe.type === 'polka-dots' || recipe.type === 'crosshatch') && (
            <NumberField
              label="Density"
              value={recipe.density ?? 0.3}
              min={0.02}
              max={0.95}
              step={0.05}
              onChange={(v) => editRecipe({ density: v })}
            />
          )}
          {recipe.type === 'hex-grid' && (
            <NumberField
              label="Hex gap"
              unit="px"
              value={recipe.gap ?? 2}
              min={0}
              onChange={(v) => editRecipe({ gap: v })}
            />
          )}
          <FieldRow label="Seed">
            <span className="insp-pattern-summary">{recipe.seed ?? 'random'}</span>
          </FieldRow>
          <button
            type="button"
            className="insp-add-btn"
            onClick={() => editRecipe({ seed: randomPatternSeed() })}
          >
            Randomize seed
          </button>
          <button
            type="button"
            className="insp-add-btn"
            onClick={() => patch({ generator: undefined })}
          >
            Detach generator (keep bitmap)
          </button>
        </>
      )}
      {/* ── Repeat arrangement ────────────────────────────────────── */}
      {linkedDefinition ? (
        <FieldRow label="Repeat geometry">
          <span className="insp-pattern-summary">
            {PATTERN_ARRANGEMENT_LABELS[resolvedPattern.arrangement ?? 'grid']} ·{' '}
            {resolvedPattern.gapX ?? 0}px across · {resolvedPattern.gapY ?? 0}px down
          </span>
        </FieldRow>
      ) : (
        <>
          <Select
            label="Arrangement"
            value={mixedRepeatSettings?.arrangement ? '' : arrangement}
            placeholder={mixedRepeatSettings?.arrangement ? 'Mixed' : undefined}
            options={[
              ...(mixedRepeatSettings?.arrangement
                ? [{ value: '', label: 'Mixed', disabled: true }]
                : []),
              ...PATTERN_ARRANGEMENTS.map((value) => ({
                value,
                label: PATTERN_ARRANGEMENT_LABELS[value],
              })),
            ]}
            onValueChange={(value) => patch({ arrangement: value as PatternArrangement })}
          />
          {(mixedRepeatSettings?.arrangement === true ||
            arrangement === 'brick' ||
            pattern.rowShift !== undefined) && (
            <NumberField
              label="Row offset"
              value={pattern.rowShift ?? rowShiftDefault}
              mixed={mixedFields?.rowShift}
              min={-8}
              max={8}
              step={0.05}
              labelWrap
              onChange={(v) => changeNumber('rowShift', v)}
              onDelta={deltaNumber('rowShift')}
            />
          )}
          {(mixedRepeatSettings?.arrangement === true ||
            arrangement === 'half-drop' ||
            pattern.columnShift !== undefined) && (
            <NumberField
              label="Column offset"
              value={pattern.columnShift ?? columnShiftDefault}
              mixed={mixedFields?.columnShift}
              min={-8}
              max={8}
              step={0.05}
              labelWrap
              onChange={(v) => changeNumber('columnShift', v)}
              onDelta={deltaNumber('columnShift')}
            />
          )}
          <NumberField
            label="Gap across"
            labelWrap
            unit="px"
            value={pattern.gapX ?? pattern.spacing}
            mixed={mixedFields?.gapX}
            onChange={(v) => changeNumber('gapX', v)}
            onDelta={deltaNumber('gapX')}
          />
          <NumberField
            label="Gap down"
            labelWrap
            unit="px"
            value={pattern.gapY ?? pattern.spacing}
            mixed={mixedFields?.gapY}
            onChange={(v) => changeNumber('gapY', v)}
            onDelta={deltaNumber('gapY')}
          />
          <Checkbox
            label="Mirror across columns"
            checked={mixedRepeatSettings?.mirrorX ? false : pattern.mirrorX === true}
            indeterminate={mixedRepeatSettings?.mirrorX}
            onChange={(e) => patch({ mirrorX: e.target.checked })}
          />
          <Checkbox
            label="Mirror down rows"
            checked={mixedRepeatSettings?.mirrorY ? false : pattern.mirrorY === true}
            indeterminate={mixedRepeatSettings?.mirrorY}
            onChange={(e) => patch({ mirrorY: e.target.checked })}
          />
        </>
      )}
      <NumberField
        label="Phase across"
        labelWrap
        unit="px"
        value={resolvedPattern.offsetX ?? 0}
        mixed={mixedFields?.offsetX}
        onChange={(v) => changeNumber('offsetX', v)}
        onDelta={deltaNumber('offsetX')}
      />
      <NumberField
        label="Phase down"
        labelWrap
        unit="px"
        value={resolvedPattern.offsetY ?? 0}
        mixed={mixedFields?.offsetY}
        onChange={(v) => changeNumber('offsetY', v)}
        onDelta={deltaNumber('offsetY')}
      />
      {/* ── Placement ─────────────────────────────────────────────── */}{' '}
      <NumberField
        label="Tile width"
        labelWrap
        unit="px"
        value={resolvedPattern.imageWidth ?? 0}
        mixed={mixedFields?.imageWidth}
        min={1}
        onChange={(v) => changeNumber('imageWidth', v || undefined)}
        onDelta={deltaNumber('imageWidth')}
      />
      <NumberField
        label="Tile height"
        labelWrap
        unit="px"
        value={resolvedPattern.imageHeight ?? 0}
        mixed={mixedFields?.imageHeight}
        min={1}
        onChange={(v) => changeNumber('imageHeight', v || undefined)}
        onDelta={deltaNumber('imageHeight')}
      />
      <NumberField
        label="Rotation"
        labelWrap
        unit="deg"
        value={pattern.rotation}
        mixed={mixedFields?.rotation}
        onChange={(v) => changeNumber('rotation', v)}
        onDelta={deltaNumber('rotation')}
      />
      {hasMixedField && (
        <p className="insp-hint" role="note">
          Mixed values: type a number to set it on every selected fill; use arrows or scrub to apply
          the same change to each fill’s current value.
        </p>
      )}
      <p className="insp-hint" role="note">
        {linkedDefinition
          ? 'Tile width and height scale this fill independently; phase shifts this fill and rotation turns its pattern field about the object centre.'
          : 'Arrangement, gaps and phase change this fill’s lattice. Tile width and height scale the placed raster; rotation turns the pattern field about the object centre.'}
      </p>
    </div>
  );
}

function linkedDefinitionUsageLabel(definition: PatternDefinition): string {
  return `the reusable definition “${definition.name}”`;
}

/** Coerce a CSS colour to the `#rrggbb` form an `<input type="color">` needs. */
function toHexInput(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return '#000000';
}
