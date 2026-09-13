import { Select, Switch } from '@varve/ui';
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react';
import { getToolManager } from '../../canvas/toolDispatcher';
import type { CloneStampOptions, CloneStampTool } from '../../tools/CloneStampTool';
import type { HealingBrushOptions, HealingBrushTool } from '../../tools/HealingBrushTool';
import type { PatchTool, PatchToolOptions } from '../../tools/PatchTool';
import type { SpotHealOptions, SpotHealTool } from '../../tools/SpotHealTool';
import type { Tool as EditorTool } from '../../tools/types';
import { NumberField } from '../Inspector/controls/NumberField';

export type RetouchToolId = 'cloneStamp' | 'healBrush' | 'spotHeal' | 'patch';

const DEFAULT_CLONE_OPTIONS: CloneStampOptions = {
  brushSize: 40,
  hardness: 0.8,
  opacity: 1,
  flow: 1,
  spacing: 0.15,
  aligned: true,
  sampleAllLayers: false,
};

const DEFAULT_HEAL_OPTIONS: HealingBrushOptions = {
  brushSize: 40,
  hardness: 0.7,
  opacity: 1,
  flow: 1,
  spacing: 0.15,
  sampleAllLayers: false,
};

const DEFAULT_SPOT_OPTIONS: SpotHealOptions = {
  brushSize: 20,
  hardness: 1,
  opacity: 1,
  flow: 1,
  sampleAllLayers: false,
};

const DEFAULT_PATCH_OPTIONS: PatchToolOptions = {
  featherRadius: 12,
  opacity: 1,
  sampleAllLayers: false,
};

export function RetouchToolOptions({ tool }: { tool: RetouchToolId }) {
  if (tool === 'cloneStamp') return <CloneStampOptionsPanel />;
  if (tool === 'healBrush') return <HealingBrushOptionsPanel />;
  if (tool === 'spotHeal') return <SpotHealOptionsPanel />;
  return <PatchOptionsPanel />;
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
      <SamplingScope
        value={options.sampleAllLayers}
        onChange={(value) => update('sampleAllLayers', value)}
      />
      <p className="tool-options__hint">
        Alt-click an existing pixel to set the anchor. The repair is deposited on the editable
        raster target; merged sampling never flattens those source layers.
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
      <SamplingScope
        value={options.sampleAllLayers}
        onChange={(value) => update('sampleAllLayers', value)}
      />
      <p className="tool-options__hint">
        Alt-click sets the source. Colour is adapted from the destination while texture comes from
        the frozen source snapshot.
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
      <SamplingScope
        value={options.sampleAllLayers}
        onChange={(value) => update('sampleAllLayers', value)}
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
      <SamplingScope
        value={options.sampleAllLayers}
        onChange={(value) => update('sampleAllLayers', value)}
      />
      <p className="tool-options__hint">
        Drag a source region, then click its destination. The source is frozen before the patch is
        committed and the operation remains undoable.
      </p>
    </div>
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
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Select
      label="Sampling scope"
      value={value ? 'merged' : 'current'}
      options={[
        { value: 'current', label: 'Current raster layer' },
        { value: 'merged', label: 'Current and visible raster layers' },
      ]}
      onChange={(next) => onChange(next === 'merged')}
    />
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
