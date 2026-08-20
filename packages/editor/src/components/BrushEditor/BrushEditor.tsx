/**
 * Brush Editor — progressive disclosure over the brush engine's parameters.
 *
 * Controls are grouped into collapsible sections rather than presented as one
 * flat list of forty inputs, and each section is its own component so the file
 * stays navigable as the engine grows.
 *
 * The live preview renders the draft in isolation. Test marks are never painted
 * into the user's document — an editor that dirties the artwork to show you a
 * brush is worse than no preview.
 */
import type { BrushPreset } from '@varve/scene';
import { Button, Input } from '@varve/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { BrushPreviewCache, brushPreviewDataUrl } from '../../brush/brushPreview';
import { DisclosureSection } from '../Inspector/controls/DisclosureSection';
import { NumberField } from '../Inspector/controls/NumberField';
import './BrushEditor.css';
import {
  beginEditing,
  type BrushEditorState,
  commitDraft,
  editField,
  isDirty,
  relevantSections,
  resetDraft,
  saveAs,
} from './brushEditorModel';

const PREVIEW = { width: 240, height: 96 };

export interface BrushEditorProps {
  preset: BrushPreset;
  onSave: (preset: BrushPreset) => void;
  onClose?: () => void;
  makeId?: (base: string) => string;
}

export function BrushEditor({ preset, onSave, onClose, makeId }: BrushEditorProps) {
  const idFactory = useMemo(
    () => makeId ?? ((base: string) => `${base}-${Math.random().toString(36).slice(2, 8)}`),
    [makeId],
  );
  const [state, setState] = useState<BrushEditorState>(() => beginEditing(preset, idFactory));
  const cacheRef = useRef(new BrushPreviewCache(32));

  const set = useCallback(
    <K extends keyof BrushPreset>(key: K, value: BrushPreset[K]) =>
      setState((s) => editField(s, key, value)),
    [],
  );

  const draft = state.draft;
  const dirty = isDirty(state);
  const sections = relevantSections(draft);
  const previewUrl = brushPreviewDataUrl(draft, PREVIEW, cacheRef.current);

  return (
    <div className="brush-editor">
      <div className="brush-editor__header">
        <Input
          value={draft.name}
          aria-label="Brush name"
          onChange={(e) => set('name', e.currentTarget.value)}
        />
        {state.isNewCopy ? (
          <p className="brush-editor__note">
            Built-in brushes cannot be changed. Saving creates your own copy.
          </p>
        ) : null}
      </div>

      <figure className="brush-editor__preview">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`Preview of ${draft.name}`}
            width={PREVIEW.width}
            height={PREVIEW.height}
          />
        ) : null}
        <figcaption className="brush-editor__preview-caption">
          Preview stroke — pressure ramps up and back down
        </figcaption>
      </figure>

      <div className="brush-editor__sections">
        {sections.includes('tip') ? <TipSection draft={draft} set={set} /> : null}
        {sections.includes('shape-dynamics') ? <JitterSection draft={draft} set={set} /> : null}
        {sections.includes('transfer') ? <TransferSection draft={draft} set={set} /> : null}
        {sections.includes('grain') ? <GrainSection draft={draft} set={set} /> : null}
        {sections.includes('wet-media') ? <WetSection draft={draft} set={set} /> : null}
        {sections.includes('stroke') ? <StrokeSection draft={draft} set={set} /> : null}
      </div>

      <div className="brush-editor__actions">
        <Button variant="ghost" disabled={!dirty} onClick={() => setState(resetDraft)}>
          Reset
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const forked = saveAs(state, `${draft.name} copy`, idFactory);
            setState(forked);
            onSave(forked.draft);
          }}
        >
          Save As
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            onSave(draft);
            setState(commitDraft);
          }}
        >
          Save
        </Button>
        {onClose ? (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>
      {dirty ? (
        <p className="brush-editor__dirty" role="status">
          Unsaved changes
        </p>
      ) : null}
    </div>
  );
}

type Setter = <K extends keyof BrushPreset>(key: K, value: BrushPreset[K]) => void;

interface SectionProps {
  draft: BrushPreset;
  set: Setter;
}

function TipSection({ draft, set }: SectionProps) {
  return (
    <DisclosureSection title="Brush Tip">
      <NumberField
        label="Size"
        value={Math.round(draft.radius)}
        min={1}
        max={1000}
        step={1}
        shiftStep={10}
        unit="px"
        onChange={(v) => set('radius', v)}
      />
      <NumberField
        label="Hardness"
        value={Math.round(draft.hardness * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => set('hardness', v / 100)}
      />
      <NumberField
        label="Roundness"
        value={Math.round(draft.roundness * 100)}
        min={1}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => set('roundness', v / 100)}
      />
      <NumberField
        label="Angle"
        value={Math.round((draft.angle * 180) / Math.PI)}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(v) => set('angle', (v * Math.PI) / 180)}
      />
      <NumberField
        label="Spacing"
        value={Math.round(draft.spacing * 100)}
        min={1}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => set('spacing', v / 100)}
      />
    </DisclosureSection>
  );
}

function JitterSection({ draft, set }: SectionProps) {
  return (
    <DisclosureSection title="Shape Dynamics">
      <NumberField
        label="Size jitter"
        value={Math.round(draft.sizeJitter * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => set('sizeJitter', v / 100)}
      />
      <NumberField
        label="Angle jitter"
        value={Math.round(draft.rotationJitter * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => set('rotationJitter', v / 100)}
      />
      <NumberField
        label="Scatter"
        value={Math.round(draft.positionJitter * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => set('positionJitter', v / 100)}
      />
    </DisclosureSection>
  );
}

function TransferSection({ draft, set }: SectionProps) {
  return (
    <DisclosureSection title="Transfer">
      <NumberField
        label="Opacity"
        value={Math.round(draft.opacity * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => set('opacity', v / 100)}
      />
      <NumberField
        label="Flow"
        value={Math.round(draft.flow * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => set('flow', v / 100)}
      />
      <NumberField
        label="Opacity jitter"
        value={Math.round(draft.opacityJitter * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => set('opacityJitter', v / 100)}
      />
    </DisclosureSection>
  );
}

function GrainSection({ draft, set }: SectionProps) {
  return (
    <DisclosureSection title="Grain">
      <label className="brush-editor__field">
        <span>Texture</span>
        <Input
          value={draft.grainId ?? ''}
          placeholder="None"
          aria-label="Grain texture"
          onChange={(e) => set('grainId', e.currentTarget.value || undefined)}
        />
      </label>
      <label className="brush-editor__field">
        <span>Anchor</span>
        <select
          value={draft.grainAnchor}
          aria-label="Grain anchor"
          onChange={(e) => set('grainAnchor', e.currentTarget.value as BrushPreset['grainAnchor'])}
        >
          <option value="layer">Layer — fixed to the artwork</option>
          <option value="canvas">Canvas — fixed to the document</option>
          <option value="brush">Brush — travels with each dab</option>
          <option value="stroke">Stroke — slides along the stroke</option>
        </select>
      </label>
      <NumberField
        label="Scale"
        value={Math.round(draft.grainScale * 100)}
        min={1}
        max={800}
        step={1}
        unit="%"
        onChange={(v) => set('grainScale', v / 100)}
      />
      <NumberField
        label="Contrast"
        value={Math.round(draft.grainContrast * 100)}
        min={1}
        max={400}
        step={1}
        unit="%"
        onChange={(v) => set('grainContrast', v / 100)}
      />
      <label className="brush-editor__checkbox">
        <input
          type="checkbox"
          checked={draft.grainInvert}
          onChange={(e) => set('grainInvert', e.currentTarget.checked)}
        />
        <span>Invert grain</span>
      </label>
      <label className="brush-editor__checkbox">
        <input
          type="checkbox"
          checked={draft.grainFollowDirection}
          onChange={(e) => set('grainFollowDirection', e.currentTarget.checked)}
        />
        <span>Rotate with stroke direction</span>
      </label>
    </DisclosureSection>
  );
}

function WetSection({ draft, set }: SectionProps) {
  return (
    <DisclosureSection title="Wet Media">
      <label className="brush-editor__checkbox">
        <input
          type="checkbox"
          checked={draft.wetEnabled}
          onChange={(e) => set('wetEnabled', e.currentTarget.checked)}
        />
        <span>Wet paint</span>
      </label>
      <NumberField
        label="Mixing"
        value={Math.round(draft.wetMixStrength * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        disabled={!draft.wetEnabled}
        onChange={(v) => set('wetMixStrength', v / 100)}
      />
      <NumberField
        label="Drying"
        value={Math.round(draft.wetDryingRate * 100)}
        min={1}
        max={100}
        step={1}
        unit="%"
        disabled={!draft.wetEnabled}
        onChange={(v) => set('wetDryingRate', v / 100)}
      />
      <label className="brush-editor__checkbox">
        <input
          type="checkbox"
          checked={draft.wetEdge}
          disabled={!draft.wetEnabled}
          onChange={(e) => set('wetEdge', e.currentTarget.checked)}
        />
        <span>Wet edge</span>
      </label>
    </DisclosureSection>
  );
}

function StrokeSection({ draft, set }: SectionProps) {
  return (
    <DisclosureSection title="Stroke">
      <NumberField
        label="Smoothing"
        value={Math.round(draft.smoothing * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => set('smoothing', v / 100)}
      />
    </DisclosureSection>
  );
}
