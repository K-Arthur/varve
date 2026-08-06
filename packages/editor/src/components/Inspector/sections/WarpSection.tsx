/**
 * WarpSection — contextual Inspector section for the warp modifier stack.
 *
 * Shows the ordered modifier stack (enable/rename/duplicate/reset/reorder/
 * remove), per-kind parameter controls (numeric alternatives to canvas
 * handles), node-level evaluation settings, preset quick-add, and the
 * destructive Expand Appearance action with explicit warnings.
 */

import {
  MAX_WARPS_PER_NODE,
  WARP_PRESET_DESCRIPTIONS,
  type WarpModifier,
  type WarpPresetKind,
} from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import {
  clearWarps,
  duplicateWarp,
  renameWarp,
  reorderWarps,
  resetWarp,
  setWarpEnabled,
  setWarpSettings,
  updateWarp,
  warpsOnNode,
} from '@varve/scene';
import { Select } from '@varve/ui';
import { useState } from 'react';
import { useEditor } from '../../../context';
import {
  applyWarpToSelection,
  expandWarpAppearance,
  removeWarpFromSelection,
} from '../../../warp/warpActions';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';
import './WarpSection.css';

interface WarpSectionProps {
  nodes: SceneNode[];
  node?: SceneNode | null;
}

export function WarpSection({ nodes, node }: WarpSectionProps) {
  const editor = useEditor();
  const { state, updateDoc, setWarpEdit } = editor;
  const primary = node ?? nodes[0];
  const warps = primary ? warpsOnNode(primary) : [];
  const settings = (primary as { warpSettings?: import('@varve/engine').WarpSettings } | undefined)
    ?.warpSettings;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  if (!primary) return null;

  const activeModifierId = state.warpEdit?.modifierId;

  const patch = (modifierId: string, p: Record<string, unknown>) => {
    updateDoc((doc) => {
      let next = doc;
      for (const n of nodes) {
        next = updateWarp(next, n.id, modifierId, p as never);
      }
      return next;
    });
  };

  const setActive = (modifierId: string) => {
    setWarpEdit({ nodeId: primary.id, modifierId });
    if (state.tool !== 'warp') {
      // Allow the Inspector to drive editing without forcing the tool.
    }
  };

  const addPreset = (kind: WarpPresetKind) => {
    applyWarpToSelection(editor, kind);
  };

  const controls = (m: WarpModifier) => {
    switch (m.kind) {
      case 'skew':
        return (
          <div className="warp-section__row">
            <NumberField
              label="Skew X (deg)"
              value={m.skewX}
              onChange={(v) => patch(m.id, { skewX: Math.max(-89.9, Math.min(89.9, v)) })}
            />
            <NumberField
              label="Skew Y (deg)"
              value={m.skewY}
              onChange={(v) => patch(m.id, { skewY: Math.max(-89.9, Math.min(89.9, v)) })}
            />
          </div>
        );
      case 'perspective':
        return (
          <div className="warp-section__corners">
            {(['tl', 'tr', 'br', 'bl'] as const).map((c) => (
              <div key={c} className="warp-section__row">
                <span className="warp-section__corner-label">{c.toUpperCase()}</span>
                <NumberField
                  label="X"
                  value={Math.round(m.corners[c].x * 1000) / 1000}
                  onChange={(v) =>
                    patch(m.id, { corners: { ...m.corners, [c]: { ...m.corners[c], x: v } } })
                  }
                />
                <NumberField
                  label="Y"
                  value={Math.round(m.corners[c].y * 1000) / 1000}
                  onChange={(v) =>
                    patch(m.id, { corners: { ...m.corners, [c]: { ...m.corners[c], y: v } } })
                  }
                />
              </div>
            ))}
          </div>
        );
      case 'envelope':
        return (
          <p className="warp-section__hint">
            Drag the corner and edge handles on the canvas to shape the envelope. Edge handles are
            independent; hold Shift to move a corner alone.
          </p>
        );
      case 'mesh-warp': {
        const rows = m.rows;
        const columns = m.columns;
        return (
          <>
            <div className="warp-section__row">
              <NumberField
                label="Rows"
                value={rows}
                onChange={(v) => patch(m.id, { rows: Math.max(1, Math.min(32, Math.round(v))) })}
              />
              <NumberField
                label="Columns"
                value={columns}
                onChange={(v) => patch(m.id, { columns: Math.max(1, Math.min(32, Math.round(v))) })}
              />
            </div>
            <p className="warp-section__hint">
              {(rows + 1) * (columns + 1)} control points. Shift-click on canvas to multi-select,
              drag to move, Shift+drag to nudge.
            </p>
          </>
        );
      }
      case 'bend':
        return (
          <>
            <div className="warp-section__row">
              <Select
                label="Bend mode"
                value={m.mode}
                onChange={(v) => patch(m.id, { mode: v })}
                options={[
                  { value: 'arc', label: 'Arc' },
                  { value: 'arch', label: 'Arch' },
                  { value: 'bulge', label: 'Bulge' },
                  { value: 'shell', label: 'Shell' },
                  { value: 'flag', label: 'Flag' },
                  { value: 'wave', label: 'Wave' },
                  { value: 'rise', label: 'Rise' },
                ]}
              />
              <Select
                label="Bend axis"
                value={m.axis}
                onChange={(v) => patch(m.id, { axis: v })}
                options={[
                  { value: 'horizontal', label: 'Horizontal' },
                  { value: 'vertical', label: 'Vertical' },
                ]}
              />
            </div>
            <div className="warp-section__row">
              <NumberField
                label="Amount"
                value={Math.round(m.amount * 100)}
                onChange={(v) => patch(m.id, { amount: Math.max(-1, Math.min(1, v / 100)) })}
                unit="%"
              />
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <DisclosureSection title={`Warp (${warps.length})`}>
      {warps.length === 0 && (
        <p className="warp-section__hint">
          No warp modifiers. Add one below, or select a node and press W for the Warp tool.
        </p>
      )}
      <ol className="warp-section__stack">
        {warps.map((m, i) => {
          const isActive = m.id === activeModifierId;
          return (
            <li
              key={m.id}
              className={`warp-section__item${isActive ? ' warp-section__item--active' : ''}`}
            >
              <div className="warp-section__item-head">
                <button
                  type="button"
                  className="warp-section__name"
                  onClick={() => setActive(m.id)}
                  aria-pressed={isActive}
                >
                  {m.name ?? `${m.kind}`}
                </button>
                <span className="warp-section__item-tools">
                  <button
                    type="button"
                    aria-label={m.enabled === false ? 'Enable warp' : 'Disable warp'}
                    onClick={() =>
                      updateDoc((d) => setWarpEnabled(d, primary.id, m.id, m.enabled === false))
                    }
                  >
                    {m.enabled === false ? 'Off' : 'On'}
                  </button>
                  <button
                    type="button"
                    aria-label="Rename warp"
                    onClick={() => {
                      setRenaming(m.id);
                      setRenameValue(m.name ?? '');
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    aria-label="Duplicate warp"
                    onClick={() => updateDoc((d) => duplicateWarp(d, primary.id, m.id))}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    aria-label="Reset warp"
                    onClick={() => updateDoc((d) => resetWarp(d, primary.id, m.id))}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    aria-label="Remove warp"
                    onClick={() => removeWarpFromSelection(editor, m.id)}
                  >
                    Remove
                  </button>
                </span>
              </div>
              {renaming === m.id && (
                <div className="warp-section__row">
                  <input
                    aria-label="Warp name"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        updateDoc((d) => renameWarp(d, primary.id, m.id, renameValue));
                        setRenaming(null);
                      }
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                </div>
              )}
              {isActive && (
                <>
                  {controls(m)}
                  <div className="warp-section__row">
                    <button
                      type="button"
                      onClick={() => reorderWarpsInDoc(i, i - 1)}
                      disabled={i === 0}
                      aria-label="Move warp earlier"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderWarpsInDoc(i, i + 1)}
                      disabled={i === warps.length - 1}
                      aria-label="Move warp later"
                    >
                      Down
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div className="warp-section__presets">
        <Select
          label="Add warp preset"
          value=""
          onChange={(v) => {
            if (v) addPreset(v as WarpPresetKind);
          }}
          options={[
            { value: '', label: 'Add preset…' },
            ...WARP_PRESET_DESCRIPTIONS.map((d) => ({
              value: d.kind,
              label: `${d.label} (${d.category})`,
            })),
          ]}
        />
      </div>

      <DisclosureSection title="Settings">
        <div className="warp-section__row">
          <Select
            label="Stroke behavior"
            value={settings?.strokeBehavior ?? 'preserve-width'}
            onChange={(v) =>
              updateDoc((d) =>
                setWarpSettings(d, primary.id, {
                  ...settings,
                  strokeBehavior: v as import('@varve/engine').WarpStrokeBehavior,
                }),
              )
            }
            options={[
              { value: 'preserve-width', label: 'Preserve stroke width' },
              { value: 'warp-appearance', label: 'Warp stroke appearance' },
              { value: 'scale-approx', label: 'Scale approximately' },
            ]}
          />
        </div>
        <div className="warp-section__row">
          <Select
            label="Foldover policy"
            value={settings?.foldoverPolicy ?? 'warn'}
            onChange={(v) =>
              updateDoc((d) =>
                setWarpSettings(d, primary.id, {
                  ...settings,
                  foldoverPolicy: v as import('@varve/engine').WarpFoldoverPolicy,
                }),
              )
            }
            options={[
              { value: 'prevent', label: 'Prevent foldover (revert drag)' },
              { value: 'warn', label: 'Warn on foldover' },
              { value: 'allow', label: 'Allow freely' },
            ]}
          />
        </div>
        <div className="warp-section__row">
          <Select
            label="Layout bounds"
            value={settings?.layoutBounds ?? 'source'}
            onChange={(v) =>
              updateDoc((d) =>
                setWarpSettings(d, primary.id, {
                  ...settings,
                  layoutBounds: v as import('@varve/engine').WarpLayoutBounds,
                }),
              )
            }
            options={[
              { value: 'source', label: 'Layout uses source bounds' },
              { value: 'visual', label: 'Layout includes warped bounds' },
            ]}
          />
        </div>
      </DisclosureSection>

      <div className="warp-section__danger">
        <button type="button" onClick={() => expandWarpAppearance(editor)}>
          Expand Appearance
        </button>
        <p className="warp-section__hint">
          Destructive: bakes the warped geometry into paths (text stays editable). Undo restores the
          exact source.
        </p>
      </div>
      <div className="warp-section__danger">
        <button
          type="button"
          onClick={() => updateDoc((d) => clearWarps(d, primary.id))}
          disabled={warps.length === 0}
        >
          Remove All Warps
        </button>
      </div>
      {warps.length >= MAX_WARPS_PER_NODE && (
        <p className="warp-section__warn">
          Maximum of {MAX_WARPS_PER_NODE} modifiers per node reached.
        </p>
      )}
    </DisclosureSection>
  );

  function reorderWarpsInDoc(from: number, to: number) {
    const m = warps[from];
    const pid = primary?.id;
    if (!m || !pid) return;
    updateDoc((d) => reorderWarps(d, pid, m.id, to));
  }
}
