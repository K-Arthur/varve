import {
  type Adjustment,
  type AdjustmentKind,
  EFFECT_SURFACE_GUIDANCE,
  IMAGE_TREATMENT_SCHEMAS,
  IMAGE_TUNING_PRESETS,
  type ImageTreatmentGroup,
  type ImageTreatmentSchema,
  type SurfacePreset,
} from '@varve/engine';
import { cryptoId, isImageShape, makeSmartFilter, type SceneNode } from '@varve/scene';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed } from '../selection/selectionState';

import './imageTuning.css';

type TuningGroup = 'light' | 'color' | ImageTreatmentGroup;

interface TuningControl {
  id: string;
  group: TuningGroup;
  kind: AdjustmentKind;
  key: string;
  label: string;
  description: string;
  min: number;
  max: number;
  defaultValue: number;
  step: number;
  fineStep: number;
  unit?: '%' | 'px';
  advanced?: boolean;
}

const STANDARD_CONTROLS: readonly TuningControl[] = [
  {
    id: 'exposure',
    group: 'light',
    kind: 'exposure',
    key: 'value',
    label: 'Exposure',
    description: 'Adjust overall scene exposure in stops.',
    min: -5,
    max: 5,
    defaultValue: 0,
    step: 0.1,
    fineStep: 0.01,
  },
  {
    id: 'contrast',
    group: 'light',
    kind: 'contrast',
    key: 'value',
    label: 'Contrast',
    description: 'Adjust global tonal separation.',
    min: -100,
    max: 100,
    defaultValue: 0,
    step: 1,
    fineStep: 0.1,
    unit: '%',
  },
  {
    id: 'shadows',
    group: 'light',
    kind: 'shadowHighlight',
    key: 'shadows',
    label: 'Shadows',
    description: 'Recover detail in darker tonal regions.',
    min: 0,
    max: 100,
    defaultValue: 0,
    step: 1,
    fineStep: 0.1,
    unit: '%',
  },
  {
    id: 'highlights',
    group: 'light',
    kind: 'shadowHighlight',
    key: 'highlights',
    label: 'Highlights',
    description: 'Recover detail in brighter tonal regions.',
    min: 0,
    max: 100,
    defaultValue: 0,
    step: 1,
    fineStep: 0.1,
    unit: '%',
  },
  {
    id: 'temperature',
    group: 'color',
    kind: 'temperature',
    key: 'value',
    label: 'Temperature',
    description: 'Warm or cool the image without changing the original pixels.',
    min: -100,
    max: 100,
    defaultValue: 0,
    step: 1,
    fineStep: 0.1,
  },
  {
    id: 'tint',
    group: 'color',
    kind: 'tint',
    key: 'value',
    label: 'Tint',
    description: 'Balance the green–magenta axis.',
    min: -100,
    max: 100,
    defaultValue: 0,
    step: 1,
    fineStep: 0.1,
  },
  {
    id: 'vibrance',
    group: 'color',
    kind: 'vibrance',
    key: 'value',
    label: 'Vibrance',
    description: 'Increase less-saturated colours more gently.',
    min: -100,
    max: 100,
    defaultValue: 0,
    step: 1,
    fineStep: 0.1,
    unit: '%',
  },
  {
    id: 'saturation',
    group: 'color',
    kind: 'saturation',
    key: 'value',
    label: 'Saturation',
    description: 'Adjust overall colour intensity.',
    min: -100,
    max: 100,
    defaultValue: 0,
    step: 1,
    fineStep: 0.1,
    unit: '%',
  },
];

const IMAGE_TREATMENT_CONTROLS: readonly TuningControl[] = IMAGE_TREATMENT_SCHEMAS.flatMap(
  (schema) =>
    schema.parameters.map((parameter) => ({
      id: `${schema.id}-${parameter.key}`,
      group: schema.group,
      kind: schema.id,
      key: parameter.key,
      label: parameter.label,
      description: parameter.description,
      min: parameter.min,
      max: parameter.max,
      defaultValue: parameter.defaultValue,
      step: parameter.step,
      fineStep: parameter.fineStep,
      unit: parameter.unit,
      advanced: parameter.advanced,
    })),
);

const GROUPS: ReadonlyArray<{ id: TuningGroup; title: string; description: string }> = [
  { id: 'light', title: 'Light', description: 'Global tone recovery and tonal balance.' },
  { id: 'color', title: 'Color', description: 'White balance and colour intensity.' },
  { id: 'detail', title: 'Detail', description: 'Fine texture without destructive sharpening.' },
  {
    id: 'presence',
    title: 'Local Contrast & Depth',
    description: 'Medium contrast, broad depth, and atmospheric haze recovery.',
  },
  { id: 'finish', title: 'Finish', description: 'Edge shaping, grain, and highlight diffusion.' },
];

function matchesFor(node: SceneNode, kind: AdjustmentKind): Adjustment[] {
  return (node.smartFilters ?? []).filter((filter) => filter.kind === kind);
}

function parameterValue(filter: Adjustment | undefined, key: string, fallback: number): number {
  const value = filter ? (filter as unknown as Record<string, unknown>)[key] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function hasDuplicateKind(nodes: readonly SceneNode[], kind: AdjustmentKind): boolean {
  return nodes.some((node) => matchesFor(node, kind).length > 1);
}

function patchTreatmentParameter(
  node: SceneNode,
  control: TuningControl,
  value: number,
): SceneNode {
  const stack = node.smartFilters ?? [];
  const matches = matchesFor(node, control.kind);
  if (matches.length > 1) return node;
  const existing = matches[0];
  if (existing) {
    return {
      ...node,
      smartFiltersEnabled: true,
      smartFilters: stack.map((filter) =>
        filter.id === existing.id
          ? ({ ...filter, visible: true, [control.key]: value } as Adjustment)
          : filter,
      ),
    };
  }
  if (value === control.defaultValue) return node;
  return {
    ...node,
    smartFiltersEnabled: true,
    smartFilters: [
      ...stack,
      makeSmartFilter(cryptoId(), control.kind, {
        visible: true,
        [control.key]: value,
      } as Partial<Adjustment>),
    ],
  };
}

function resetTreatmentParameter(node: SceneNode, control: TuningControl): SceneNode {
  const matches = matchesFor(node, control.kind);
  if (matches.length !== 1) return node;
  const current = matches[0];
  if (!current) return node;
  return {
    ...node,
    smartFilters: (node.smartFilters ?? []).map((filter) =>
      filter.id === current.id
        ? ({ ...filter, [control.key]: control.defaultValue } as Adjustment)
        : filter,
    ),
  };
}

function applyImagePreset(node: SceneNode, preset: SurfacePreset): SceneNode {
  if (preset.surface !== 'image-tuning') return node;
  let next = node;
  for (const effect of preset.effects) {
    const matches = matchesFor(next, effect.kind);
    if (matches.length > 1) continue;
    const overrides = { ...effect.overrides, visible: true } as Partial<Adjustment>;
    if (matches.length === 1) {
      const existing = matches[0];
      if (!existing) continue;
      next = {
        ...next,
        smartFilters: (next.smartFilters ?? []).map((filter) =>
          filter.id === existing.id ? ({ ...filter, ...overrides } as Adjustment) : filter,
        ),
      };
    } else {
      next = {
        ...next,
        smartFilters: [
          ...(next.smartFilters ?? []),
          makeSmartFilter(cryptoId(), effect.kind, overrides),
        ],
      };
    }
  }
  return { ...next, smartFiltersEnabled: true };
}

function setTreatmentVisibility(
  node: SceneNode,
  kind: AdjustmentKind,
  visible: boolean,
): SceneNode {
  const matches = matchesFor(node, kind);
  if (matches.length > 1) return node;
  const current = matches[0];
  if (!current) {
    // An absent neutral treatment is functionally enabled. Persist an entry
    // only when the user explicitly bypasses it, so the toggle always means
    // "bypass this treatment" rather than "has this row been created yet".
    if (visible) return node;
    return {
      ...node,
      smartFiltersEnabled: true,
      smartFilters: [
        ...(node.smartFilters ?? []),
        makeSmartFilter(cryptoId(), kind, { visible: false }),
      ],
    };
  }
  return {
    ...node,
    smartFilters: (node.smartFilters ?? []).map((filter) =>
      filter.id === current.id ? ({ ...filter, visible } as Adjustment) : filter,
    ),
  };
}

function formatValue(control: TuningControl, value: number): string {
  const precision = control.step < 1 ? 2 : 0;
  const formatted = Number(value.toFixed(precision));
  return control.unit
    ? `${formatted}${control.unit === '%' ? '%' : ` ${control.unit}`}`
    : String(formatted);
}

export function ImageTuningSection({ nodes }: { nodes: SceneNode[] }) {
  const { abortTransaction, announce, beginTransaction, commitTransaction, updateNodes } =
    useEditor();
  const gestureOpenRef = useRef(false);

  const startGesture = useCallback(() => {
    if (gestureOpenRef.current) return;
    gestureOpenRef.current = true;
    beginTransaction();
  }, [beginTransaction]);

  const finishGesture = useCallback(() => {
    if (!gestureOpenRef.current) return;
    gestureOpenRef.current = false;
    commitTransaction();
  }, [commitTransaction]);

  const cancelGesture = useCallback(() => {
    if (!gestureOpenRef.current) return;
    gestureOpenRef.current = false;
    abortTransaction();
  }, [abortTransaction]);

  useEffect(() => cancelGesture, [cancelGesture]);

  const standardControlsByGroup = useMemo(
    () =>
      new Map(
        GROUPS.map((group) => [
          group.id,
          STANDARD_CONTROLS.filter((control) => control.group === group.id),
        ]),
      ),
    [],
  );

  const setParameter = useCallback(
    (control: TuningControl, value: number) => {
      updateNodes(
        nodes.map((node) => ({
          id: node.id,
          update: (current) => patchTreatmentParameter(current, control, value),
        })),
      );
    },
    [nodes, updateNodes],
  );

  const resetParameter = useCallback(
    (control: TuningControl) => {
      updateNodes(
        nodes.map((node) => ({
          id: node.id,
          update: (current) => resetTreatmentParameter(current, control),
        })),
      );
    },
    [nodes, updateNodes],
  );

  const toggleKind = useCallback(
    (kind: AdjustmentKind, nextVisible: boolean) => {
      updateNodes(
        nodes.map((node) => ({
          id: node.id,
          update: (current) => setTreatmentVisibility(current, kind, nextVisible),
        })),
      );
    },
    [nodes, updateNodes],
  );

  const applyPreset = useCallback(
    (preset: SurfacePreset) => {
      updateNodes(
        nodes.map((node) => ({
          id: node.id,
          update: (current) => applyImagePreset(current, preset),
        })),
      );
      announce(`Applied photo preset ${preset.name}`);
    },
    [announce, nodes, updateNodes],
  );

  if (nodes.length === 0 || !nodes.every(isImageShape)) return null;

  return (
    <DisclosureSection title="Image Tuning" sectionId="image-tuning">
      <div
        className="image-tuning"
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') cancelGesture();
          const target = event.target as HTMLInputElement;
          if (
            target.matches('input[type="range"]') &&
            (event.key === 'ArrowUp' ||
              event.key === 'ArrowDown' ||
              event.key === 'ArrowLeft' ||
              event.key === 'ArrowRight')
          ) {
            startGesture();
          }
        }}
        onKeyUpCapture={(event) => {
          const target = event.target as HTMLInputElement;
          if (target.matches('input[type="range"]')) finishGesture();
        }}
      >
        <p className="image-tuning__intro">
          {EFFECT_SURFACE_GUIDANCE['image-tuning'].rasterBehavior} Use Object Filters for stack
          order, masks, blend modes, or repeated effects. Image Tuning is intentionally unavailable
          for vector selections.
        </p>
        {nodes.length > 1 && <p className="image-tuning__batch">Editing {nodes.length} images</p>}

        <fieldset className="image-tuning__presets">
          <legend>Photo presets</legend>
          <div className="image-tuning__preset-grid">
            {IMAGE_TUNING_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className="image-tuning__preset"
                onClick={() => applyPreset(preset)}
                aria-label={`Apply photo preset ${preset.name}`}
              >
                <strong>{preset.name}</strong>
                <span>{preset.description}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {GROUPS.map((group) => {
          const controls = standardControlsByGroup.get(group.id) ?? [];
          const primary = controls.filter((control) => !control.advanced);
          const advanced = controls.filter((control) => control.advanced);
          const treatmentSchemas = IMAGE_TREATMENT_SCHEMAS.filter(
            (schema) => schema.group === group.id,
          );
          if (controls.length === 0 && treatmentSchemas.length === 0) return null;
          return (
            <section className="image-tuning__group" key={group.id} aria-label={group.title}>
              <div className="image-tuning__group-heading">
                <div>
                  <h3>{group.title}</h3>
                  <p>{group.description}</p>
                </div>
              </div>
              {primary.map((control) => (
                <TuningControlRow
                  control={control}
                  key={control.id}
                  nodes={nodes}
                  onChange={setParameter}
                  onReset={resetParameter}
                  onToggle={toggleKind}
                  onGestureStart={startGesture}
                  onGestureEnd={finishGesture}
                  onGestureCancel={cancelGesture}
                />
              ))}
              {advanced.length > 0 && (
                <details className="image-tuning__advanced">
                  <summary>Advanced {group.title} settings</summary>
                  {advanced.map((control) => (
                    <TuningControlRow
                      control={control}
                      key={control.id}
                      nodes={nodes}
                      onChange={setParameter}
                      onReset={resetParameter}
                      onToggle={toggleKind}
                      onGestureStart={startGesture}
                      onGestureEnd={finishGesture}
                      onGestureCancel={cancelGesture}
                    />
                  ))}
                </details>
              )}
              {treatmentSchemas.map((schema) => (
                <ImageTreatmentControlGroup
                  controls={IMAGE_TREATMENT_CONTROLS.filter(
                    (control) => control.kind === schema.id,
                  )}
                  key={schema.id}
                  nodes={nodes}
                  onChange={setParameter}
                  onGestureCancel={cancelGesture}
                  onGestureEnd={finishGesture}
                  onGestureStart={startGesture}
                  onReset={resetParameter}
                  onToggle={toggleKind}
                  schema={schema}
                />
              ))}
            </section>
          );
        })}
      </div>
    </DisclosureSection>
  );
}

function ImageTreatmentControlGroup({
  schema,
  controls,
  nodes,
  onChange,
  onReset,
  onToggle,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: {
  schema: ImageTreatmentSchema;
  controls: readonly TuningControl[];
  nodes: readonly SceneNode[];
  onChange: (control: TuningControl, value: number) => void;
  onReset: (control: TuningControl) => void;
  onToggle: (kind: AdjustmentKind, visible: boolean) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onGestureCancel: () => void;
}) {
  const primary = controls.filter((control) => !control.advanced);
  const advanced = controls.filter((control) => control.advanced);
  const descriptionId = `image-treatment-${schema.id}-description`;

  return (
    <fieldset
      className="image-tuning__treatment"
      data-image-treatment-group={schema.id}
      aria-describedby={descriptionId}
    >
      <legend className="image-tuning__treatment-legend">{schema.label}</legend>
      <p className="image-tuning__treatment-description" id={descriptionId}>
        {schema.description}
      </p>
      {primary.map((control) => (
        <TuningControlRow
          control={control}
          key={control.id}
          nodes={nodes}
          onChange={onChange}
          onGestureCancel={onGestureCancel}
          onGestureEnd={onGestureEnd}
          onGestureStart={onGestureStart}
          onReset={onReset}
          onToggle={onToggle}
        />
      ))}
      {advanced.length > 0 && (
        <details className="image-tuning__advanced">
          <summary>Advanced {schema.label} settings</summary>
          {advanced.map((control) => (
            <TuningControlRow
              control={control}
              key={control.id}
              nodes={nodes}
              onChange={onChange}
              onGestureCancel={onGestureCancel}
              onGestureEnd={onGestureEnd}
              onGestureStart={onGestureStart}
              onReset={onReset}
              onToggle={onToggle}
            />
          ))}
        </details>
      )}
    </fieldset>
  );
}

function TuningControlRow({
  control,
  nodes,
  onChange,
  onReset,
  onToggle,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: {
  control: TuningControl;
  nodes: readonly SceneNode[];
  onChange: (control: TuningControl, value: number) => void;
  onReset: (control: TuningControl) => void;
  onToggle: (kind: AdjustmentKind, visible: boolean) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onGestureCancel: () => void;
}) {
  const ambiguous = hasDuplicateKind(nodes, control.kind);
  const value = commonValue(nodes as SceneNode[], (node) =>
    parameterValue(matchesFor(node, control.kind)[0], control.key, control.defaultValue),
  );
  const visible = commonValue(nodes as SceneNode[], (node) => {
    const filter = matchesFor(node, control.kind)[0];
    return filter ? filter.visible !== false : true;
  });
  const mixed = isMixed(value);
  const enabledMixed = isMixed(visible);
  const numericValue = mixed ? control.defaultValue : value;
  const isVisible = !enabledMixed && visible;
  const nextVisible = enabledMixed || !isVisible;

  return (
    <div className="image-tuning__control" data-image-treatment={control.id}>
      <div className="image-tuning__control-heading">
        <span className="image-tuning__control-label" title={control.description}>
          {control.label}
        </span>
        <span className="image-tuning__value" aria-live="polite">
          {mixed ? 'Mixed' : formatValue(control, numericValue)}
        </span>
        <button
          type="button"
          className="image-tuning__toggle"
          disabled={ambiguous}
          aria-pressed={isVisible}
          aria-label={`${nextVisible ? 'Enable' : 'Disable'} ${control.label}`}
          onClick={() => onToggle(control.kind, nextVisible)}
        >
          {enabledMixed ? '—' : isVisible ? 'On' : 'Off'}
        </button>
        <button
          type="button"
          className="image-tuning__reset"
          disabled={ambiguous}
          aria-label={`Reset ${control.label}`}
          onClick={() => onReset(control)}
        >
          Reset
        </button>
      </div>
      <div className="image-tuning__input-row">
        <input
          type="range"
          className="varve-native-range image-tuning__slider"
          min={control.min}
          max={control.max}
          step={control.step}
          value={numericValue}
          disabled={ambiguous}
          aria-label={control.label}
          aria-description={control.description}
          aria-valuetext={mixed ? 'Mixed values' : formatValue(control, numericValue)}
          onPointerDown={onGestureStart}
          onPointerUp={onGestureEnd}
          onPointerCancel={onGestureCancel}
          onChange={(event) => onChange(control, Number(event.target.value))}
        />
        <NumberField
          label={control.label}
          displayLabel={`${control.label} value`}
          value={numericValue}
          min={control.min}
          max={control.max}
          step={control.step}
          altStep={control.fineStep}
          shiftStep={control.step * 10}
          unit={control.unit}
          mixed={mixed}
          disabled={ambiguous}
          onChange={(next) => onChange(control, next)}
        />
      </div>
      {ambiguous && (
        <p className="image-tuning__warning" role="status">
          Multiple {control.label} entries exist. Edit their order and values in Object Filters.
        </p>
      )}
    </div>
  );
}
