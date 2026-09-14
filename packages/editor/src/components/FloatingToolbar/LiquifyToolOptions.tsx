/**
 * Liquify tool options — brush, mode, protection, and reference overlays.
 *
 * The panel writes tool state through the tool instance (same pattern as the
 * retouch panels) and performs document-level actions (Reset All) through the
 * editor context so they are ordinary undo transactions.
 */

import {
  canLiquifyNode,
  clearLiquifyOnNode,
  findFrequencySeparationForBand,
  getFrequencySeparationState,
} from '@varve/scene';
import { Select, Switch } from '@varve/ui';
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react';
import { getToolManager } from '../../canvas/toolDispatcher';
import { useEditor } from '../../context';
import type { LiquifyTool, LiquifyToolOptions } from '../../tools/LiquifyTool';
import { DEFAULT_LIQUIFY_OPTIONS } from '../../tools/LiquifyTool';
import type { Tool as EditorTool } from '../../tools/types';
import { NumberField } from '../Inspector/controls/NumberField';
import './liquifyToolOptions.css';

const MODE_OPTIONS = [
  { value: 'push', label: 'Push' },
  { value: 'bloat', label: 'Expand' },
  { value: 'pucker', label: 'Contract' },
  { value: 'twirl-cw', label: 'Twirl clockwise' },
  { value: 'twirl-ccw', label: 'Twirl counter-clockwise' },
  { value: 'restore', label: 'Restore' },
  { value: 'smooth', label: 'Smooth' },
];

const FREEZE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'freeze', label: 'Freeze' },
  { value: 'thaw', label: 'Thaw' },
];

function useLiquifyOptions(): [LiquifyToolOptions, Dispatch<SetStateAction<LiquifyToolOptions>>] {
  const [options, setOptions] = useState<LiquifyToolOptions>(() => {
    const instance = getToolManager().getTool<LiquifyTool>('liquify');
    return instance
      ? { ...DEFAULT_LIQUIFY_OPTIONS, ...instance.getOptions() }
      : DEFAULT_LIQUIFY_OPTIONS;
  });
  useEffect(() => {
    const instance = getToolManager().getTool<LiquifyTool & EditorTool>('liquify');
    instance?.setOptions(options);
  }, [options]);
  return [options, setOptions];
}

export function LiquifyOptionsPanel() {
  const editor = useEditor();
  const [options, setOptions] = useLiquifyOptions();
  const update = useCallback(
    <K extends keyof LiquifyToolOptions>(key: K, value: LiquifyToolOptions[K]) => {
      setOptions((current) => ({ ...current, [key]: value }));
    },
    [setOptions],
  );

  const targetId = editor.state.selection.length === 1 ? editor.state.selection[0]! : null;
  const targetNode = targetId ? editor.state.document.nodes[targetId] : null;
  const targetLabel = (() => {
    if (!targetNode) return 'No single selection';
    if (targetNode.kind === 'rasterLayer') return targetNode.name;
    if (targetNode.kind === 'group' && getFrequencySeparationState(targetNode)) {
      return `${targetNode.name} (shared deformation)`;
    }
    const separation = findFrequencySeparationForBand(editor.state.document, targetNode.id);
    return separation ? `${targetNode.name} (single component)` : targetNode.name;
  })();
  const targetSupported = canLiquifyNode(targetNode);

  const handleResetAll = useCallback(() => {
    if (!targetId || !targetSupported) return;
    const target = editor.state.document.nodes[targetId];
    const groupId =
      target?.kind === 'group' && getFrequencySeparationState(target)
        ? target.id
        : findFrequencySeparationForBand(editor.state.document, targetId)?.groupId;
    const clearId = groupId ?? targetId;
    const cleared = clearLiquifyOnNode(editor.state.document, clearId);
    if (!cleared) return;
    editor.beginTransaction();
    try {
      editor.updateDoc(() => cleared);
      editor.commitTransaction();
    } catch (error) {
      editor.abortTransaction();
      throw error;
    }
    editor.announce('Liquify reset');
  }, [editor, targetId, targetSupported]);

  return (
    <div className="liquify-options" data-testid="liquify-options">
      <div className="liquify-options__heading">
        Liquify
        <span className="liquify-options__target">{targetLabel}</span>
      </div>

      <div className="liquify-options__field">
        <span className="liquify-options__label">Mode</span>
        <Select
          value={options.mode}
          label="Liquify mode"
          options={MODE_OPTIONS}
          onChange={(value) => update('mode', value as LiquifyToolOptions['mode'])}
        />
      </div>

      <div className="liquify-options__field">
        <span className="liquify-options__label">Size</span>
        <NumberField
          label="Size"
          value={Math.round(options.brushSize)}
          min={4}
          max={4000}
          step={4}
          unit="px"
          onChange={(value) => update('brushSize', value)}
        />
      </div>

      <label className="liquify-options__slider">
        <span className="liquify-options__label">
          Strength {Math.round(options.strength * 100)}%
        </span>
        <input
          type="range"
          min={1}
          max={100}
          value={Math.round(options.strength * 100)}
          onChange={(event) => update('strength', Number(event.target.value) / 100)}
          aria-label="Liquify strength"
        />
      </label>

      <label className="liquify-options__slider">
        <span className="liquify-options__label">
          Falloff {Math.round((1 - options.hardness) * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round((1 - options.hardness) * 100)}
          onChange={(event) => update('hardness', 1 - Number(event.target.value) / 100)}
          aria-label="Liquify falloff"
        />
      </label>

      <Switch
        className="liquify-options__check"
        label="Pressure controls size"
        checked={options.pressureEnabled}
        onChange={(event) => update('pressureEnabled', event.target.checked)}
      />

      <div className="liquify-options__field">
        <span className="liquify-options__label">Protection</span>
        <Select
          value={options.freezeTool}
          label="Freeze protection"
          options={FREEZE_OPTIONS}
          onChange={(value) => update('freezeTool', value as LiquifyToolOptions['freezeTool'])}
        />
      </div>

      <Switch
        className="liquify-options__check"
        label="Show freeze overlay"
        checked={options.showFreeze}
        onChange={(event) => update('showFreeze', event.target.checked)}
      />
      <Switch
        className="liquify-options__check"
        label="Show deformation grid"
        checked={options.showGrid}
        onChange={(event) => update('showGrid', event.target.checked)}
      />

      <button
        type="button"
        className="liquify-options__reset"
        onClick={handleResetAll}
        disabled={!targetSupported}
      >
        Reset deformation
      </button>

      <p className="liquify-options__hint">
        Deformation is stored on the target and re-sampled from the original pixels, so it stays
        editable and reversible. Push follows the pointer; Expand, Contract, and Twirl build up
        while you move. Freeze protects an area from every later stroke.
      </p>
    </div>
  );
}
