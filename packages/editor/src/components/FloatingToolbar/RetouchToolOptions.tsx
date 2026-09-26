import { Select, Switch } from '@varve/ui';
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react';
import { getToolManager } from '../../canvas/toolDispatcher';
import type { CloneStampOptions, CloneStampTool } from '../../tools/CloneStampTool';
import type { DodgeBurnOptions, DodgeBurnTool } from '../../tools/DodgeBurnTool';
import type { HealingBrushOptions, HealingBrushTool } from '../../tools/HealingBrushTool';
import type { PatchTool, PatchToolOptions } from '../../tools/PatchTool';
import type { SamplingScope as RetouchSamplingScope } from '../../tools/retouchSampling';
import type { SpotHealOptions, SpotHealTool } from '../../tools/SpotHealTool';
import type { Tool as EditorTool } from '../../tools/types';
import { NumberField } from '../Inspector/controls/NumberField';

export type RetouchToolId = 'cloneStamp' | 'healBrush' | 'spotHeal' | 'patch' | 'dodgeBurn';

const DEFAULT_CLONE_OPTIONS: CloneStampOptions = {
  brushSize: 40,
  hardness: 0.8,
  opacity: 1,
  flow: 1,
  spacing: 0.15,
  aligned: true,
  alphaLock: false,
  samplingScope: 'current',
};

const DEFAULT_HEAL_OPTIONS: HealingBrushOptions = {
  brushSize: 40,
  hardness: 0.7,
  opacity: 1,
  flow: 1,
  spacing: 0.15,
  alphaLock: false,
  samplingScope: 'current',
};

const DEFAULT_SPOT_OPTIONS: SpotHealOptions = {
  brushSize: 20,
  hardness: 1,
  opacity: 1,
  flow: 1,
  alphaLock: false,
  samplingScope: 'current',
};

const DEFAULT_PATCH_OPTIONS: PatchToolOptions = {
  featherRadius: 12,
  opacity: 1,
  alphaLock: false,
  samplingScope: 'current',
};

const DEFAULT_DODGE_BURN_OPTIONS: DodgeBurnOptions = {
  brushSize: 40,
  hardness: 0.5,
  opacity: 1,
  flow: 1,
  spacing: 0.15,
  mode: 'dodge',
  exposure: 0.5,
  range: 'midtones',
};

export function RetouchToolOptions({ tool }: { tool: RetouchToolId }) {
  if (tool === 'cloneStamp') return <CloneStampOptionsPanel />;
  if (tool === 'healBrush') return <HealingBrushOptionsPanel />;
  if (tool === 'spotHeal') return <SpotHealOptionsPanel />;
  if (tool === 'dodgeBurn') return <DodgeBurnOptionsPanel />;
  return <PatchOptionsPanel />;
}

function DodgeBurnOptionsPanel() {
  const [options, setOptions] = useToolOptions<DodgeBurnOptions, DodgeBurnTool>(
    'dodgeBurn',
    DEFAULT_DODGE_BURN_OPTIONS,
  );
  const update = useCallback(
    <K extends keyof DodgeBurnOptions>(key: K, value: DodgeBurnOptions[K]) => {
      setOptions((current) => ({ ...current, [key]: value }));
    },
    [setOptions],
  );
  return (
    <div className="tool-options__selection" data-testid="retouch-options">
      <div className="tool-options__heading">Dodge Burn</div>
      <div className="tool-options__field">
        <span className="tool-options__label">Mode</span>
        <Select
          className="tool-options__scope-select"
          label="Dodge or burn mode"
          value={options.mode}
          options={[
            { value: 'dodge', label: 'Dodge (lighten)' },
            { value: 'burn', label: 'Burn (darken)' },
          ]}
          onChange={(next) => update('mode', next as DodgeBurnOptions['mode'])}
        />
      </div>
      <RetouchBrushFields options={options} onChange={update} />
      <NumberField
        label="Exposure"
        value={Math.round(options.exposure * 100)}
        min={1}
        max={200}
        step={5}
        unit="%"
        onChange={(value) => update('exposure', value / 100)}
      />
      <div className="tool-options__field">
        <span className="tool-options__label">Range</span>
        <Select
          className="tool-options__scope-select"
          label="Luminance range focus"
          value={options.range}
          options={[
            { value: 'shadows', label: 'Shadows' },
            { value: 'midtones', label: 'Midtones' },
            { value: 'highlights', label: 'Highlights' },
          ]}
          onChange={(next) => update('range', next as DodgeBurnOptions['range'])}
        />
      </div>
      <p className="tool-options__hint">
        Adjusts existing pixels in linear light, like the global Exposure control under the brush.
        It cannot paint onto transparent areas. Pen pressure modulates flow when pressure is enabled
        in drawing settings.
      </p>
    </div>
  );
}

function CloneStampOptionsPanel() {
  const [options, setOptions] = useToolOptions<CloneStampOptions, CloneStampTool>(
    'cloneStamp',
    DEFAULT_CLONE_OPTIONS,
  );
  const update = useCallback(
    <K extends keyof CloneStampOptions>(key: K, value: CloneStampOptions[K]) => {
      setOptions((current) => ({ ...current, [key]: value }));
    },
    [setOptions],
  );
  return (
    <div className="tool-options__selection" data-testid="retouch-options">
      <div className="tool-options__heading">Clone Stamp</div>
      <RetouchBrushFields options={options} onChange={update} />
      <Switch
        className="tool-options__check"
        label="Aligned source"
        aria-label="Aligned clone source"
        checked={options.aligned}
        onChange={(event) => update('aligned', event.target.checked)}
      />
      <AlphaLockField
        checked={options.alphaLock}
        onChange={(checked) => update('alphaLock', checked)}
      />
      <SamplingScope
        value={options.samplingScope}
        onChange={(value) => update('samplingScope', value)}
      />
      <p className="tool-options__hint">
        Alt-click an existing pixel to set the anchor. The repair is deposited on the editable
        raster target; merged sampling never flattens those source layers. Pen pressure modulates
        flow when pressure is enabled in drawing settings.
      </p>
    </div>
  );
}

function HealingBrushOptionsPanel() {
  const [options, setOptions] = useToolOptions<HealingBrushOptions, HealingBrushTool>(
    'healBrush',
    DEFAULT_HEAL_OPTIONS,
  );
  const update = useCallback(
    <K extends keyof HealingBrushOptions>(key: K, value: HealingBrushOptions[K]) => {
      setOptions((current) => ({ ...current, [key]: value }));
    },
    [setOptions],
  );
  return (
    <div className="tool-options__selection" data-testid="retouch-options">
      <div className="tool-options__heading">Healing Brush</div>
      <RetouchBrushFields options={options} onChange={update} />
      <AlphaLockField
        checked={options.alphaLock}
        onChange={(checked) => update('alphaLock', checked)}
      />
      <SamplingScope
        value={options.samplingScope}
        onChange={(value) => update('samplingScope', value)}
      />
      <p className="tool-options__hint">
        Alt-click sets the source. Colour is adapted from the destination while texture comes from
        the frozen source snapshot. Pen pressure modulates flow when pressure is enabled in drawing
        settings.
      </p>
    </div>
  );
}

function SpotHealOptionsPanel() {
  const [options, setOptions] = useToolOptions<SpotHealOptions, SpotHealTool>(
    'spotHeal',
    DEFAULT_SPOT_OPTIONS,
  );
  const update = useCallback(
    <K extends keyof SpotHealOptions>(key: K, value: SpotHealOptions[K]) => {
      setOptions((current) => ({ ...current, [key]: value }));
    },
    [setOptions],
  );
  return (
    <div className="tool-options__selection" data-testid="retouch-options">
      <div className="tool-options__heading">Spot Heal</div>
      <RetouchBrushFields options={options} onChange={update} includeFlow={false} />
      <AlphaLockField
        checked={options.alphaLock}
        onChange={(checked) => update('alphaLock', checked)}
      />
      <SamplingScope
        value={options.samplingScope}
        onChange={(value) => update('samplingScope', value)}
      />
      <p className="tool-options__hint">
        Proximity match only: the bounded repair selects an existing nearby texture patch. It does
        not invent content or download a model.
      </p>
    </div>
  );
}

function PatchOptionsPanel() {
  const [options, setOptions] = useToolOptions<PatchToolOptions, PatchTool>(
    'patch',
    DEFAULT_PATCH_OPTIONS,
  );
  const update = useCallback(
    <K extends keyof PatchToolOptions>(key: K, value: PatchToolOptions[K]) => {
      setOptions((current) => ({ ...current, [key]: value }));
    },
    [setOptions],
  );
  return (
    <div className="tool-options__selection" data-testid="retouch-options">
      <div className="tool-options__heading">Patch Tool</div>
      <NumberField
        label="Edge feather"
        value={options.featherRadius}
        min={0}
        max={500}
        step={1}
        unit="px"
        onChange={(value) => update('featherRadius', value)}
      />
      <NumberField
        label="Opacity"
        value={Math.round(options.opacity * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(value) => update('opacity', value / 100)}
      />
      <AlphaLockField
        checked={options.alphaLock}
        onChange={(checked) => update('alphaLock', checked)}
      />
      <SamplingScope
        value={options.samplingScope}
        onChange={(value) => update('samplingScope', value)}
      />
      <p className="tool-options__hint">
        Drag a source region, then click its destination. The source is frozen before the patch is
        committed and the operation remains undoable.
      </p>
    </div>
  );
}

function AlphaLockField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Switch
      className="tool-options__check"
      label="Alpha lock"
      aria-label="Protect existing transparency"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

function RetouchBrushFields<
  T extends { brushSize: number; hardness: number; opacity: number; flow?: number },
>({
  options,
  onChange,
  includeFlow = true,
}: {
  options: T;
  onChange: <K extends keyof T>(key: K, value: T[K]) => void;
  includeFlow?: boolean;
}) {
  return (
    <>
      <NumberField
        label="Brush size"
        value={options.brushSize}
        min={1}
        max={1000}
        step={1}
        unit="px"
        onChange={(value) => onChange('brushSize' as keyof T, value as T[keyof T])}
      />
      <NumberField
        label="Hardness"
        value={Math.round(options.hardness * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(value) => onChange('hardness' as keyof T, (value / 100) as T[keyof T])}
      />
      <NumberField
        label="Opacity"
        value={Math.round(options.opacity * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(value) => onChange('opacity' as keyof T, (value / 100) as T[keyof T])}
      />
      {includeFlow && options.flow !== undefined && (
        <NumberField
          label="Flow"
          value={Math.round(options.flow * 100)}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(value) => onChange('flow' as keyof T, (value / 100) as T[keyof T])}
        />
      )}
    </>
  );
}

function SamplingScope({
  value,
  onChange,
}: {
  value: RetouchSamplingScope;
  onChange: (value: RetouchSamplingScope) => void;
}) {
  return (
    <div className="tool-options__field">
      <span className="tool-options__label">Sampling</span>
      <Select
        className="tool-options__scope-select"
        label="Sampling scope"
        value={value}
        options={[
          { value: 'current', label: 'Current layer' },
          { value: 'below', label: 'Current and below' },
          { value: 'allVisible', label: 'All visible layers' },
        ]}
        onChange={(next) => onChange(next as RetouchSamplingScope)}
      />
    </div>
  );
}

function useToolOptions<
  Options extends object,
  ToolInstance extends EditorTool & {
    getOptions: () => Readonly<Options>;
    setOptions: (options: Partial<Options>) => void;
  },
>(toolId: RetouchToolId, defaults: Options): [Options, Dispatch<SetStateAction<Options>>] {
  const [options, setOptions] = useState<Options>(() => {
    const instance = getToolManager().getTool<ToolInstance>(toolId);
    return instance ? { ...defaults, ...instance.getOptions() } : defaults;
  });
  useEffect(() => {
    const instance = getToolManager().getTool<ToolInstance>(toolId);
    instance?.setOptions(options);
  }, [options, toolId]);
  return [options, setOptions];
}
