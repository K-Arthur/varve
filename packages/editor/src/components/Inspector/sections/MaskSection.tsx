import type { MaskType, SceneNode } from '@strata/scene';
import { useCallback, useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';

export function MaskSection({ nodes }: { nodes: SceneNode[] }) {
  const editor = useEditor();
  const {
    addMaskToSelected,
    removeMaskFromSelected,
    toggleMask,
    invertMask,
    setMaskFeather,
    setMaskDensity,
  } = editor;

  const node = nodes[0];
  const container = node as SceneNode & { mask?: unknown; children?: string[] };
  const mask = (container.mask ?? null) as {
    type: MaskType;
    visible: boolean;
    inverted?: boolean;
    hideMaskSource?: boolean;
    feather?: number;
    density?: number;
    sourceNodeId: string;
  } | null;

  const canHaveMask = node.kind === 'frame' || node.kind === 'group' || node.kind === 'adjustment';
  const hasChildren = 'children' in container && (container.children?.length ?? 0) > 0;
  const canAddMask = canHaveMask && !mask && hasChildren;

  const maskTypeLabel = useMemo(() => {
    if (!mask) return '';
    const labels: Record<string, string> = {
      clip: 'Clip',
      alpha: 'Alpha',
      luminance: 'Luminance',
    };
    return labels[mask.type] ?? mask.type;
  }, [mask]);

  const handleToggleVisible = useCallback(() => {
    toggleMask();
  }, [toggleMask]);

  const handleToggleInverted = useCallback(() => {
    invertMask();
  }, [invertMask]);

  const handleRemove = useCallback(() => {
    removeMaskFromSelected();
  }, [removeMaskFromSelected]);

  const handleAddClip = useCallback(() => {
    addMaskToSelected('clip');
  }, [addMaskToSelected]);

  const handleAddAlpha = useCallback(() => {
    addMaskToSelected('alpha');
  }, [addMaskToSelected]);

  const handleAddLuminance = useCallback(() => {
    addMaskToSelected('luminance');
  }, [addMaskToSelected]);

  const handleFeather = useCallback(
    (v: number) => {
      setMaskFeather(Math.max(0, v));
    },
    [setMaskFeather],
  );

  const handleDensity = useCallback(
    (v: number) => {
      setMaskDensity(Math.max(0, Math.min(1, v)));
    },
    [setMaskDensity],
  );

  if (!canHaveMask) return null;

  return (
    <DisclosureSection title="Mask" defaultExpanded={!!mask}>
      {canAddMask && (
        <div className="insp-field" style={{ flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span className="insp-field__label">Add Mask</span>
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            <button
              type="button"
              className="insp-btn-sm"
              onClick={handleAddClip}
              aria-label="Add clip mask"
              title="Clip mask: uses the first child's outline to clip other children"
            >
              Clip
            </button>
            <button
              type="button"
              className="insp-btn-sm"
              onClick={handleAddAlpha}
              aria-label="Add alpha mask"
              title="Alpha mask: uses the first child's alpha channel to modulate visibility"
            >
              Alpha
            </button>
            <button
              type="button"
              className="insp-btn-sm"
              onClick={handleAddLuminance}
              aria-label="Add luminance mask"
              title="Luminance mask: uses the first child's luminance to modulate visibility"
            >
              Luminance
            </button>
          </div>
        </div>
      )}

      {mask && (
        <div className="insp-field" style={{ flexDirection: 'column', gap: 'var(--space-1)' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--space-1)',
            }}
          >
            <span className="insp-field__label" style={{ fontSize: 'var(--font-size-sm)' }}>
              Type: {maskTypeLabel}
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
              <button
                type="button"
                className="insp-btn-sm"
                onClick={handleToggleVisible}
                aria-label={mask.visible ? 'Disable mask' : 'Enable mask'}
                aria-pressed={mask.visible}
                title={mask.visible ? 'Mask is active' : 'Mask is disabled'}
              >
                {mask.visible ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                className="insp-btn-sm"
                onClick={handleToggleInverted}
                aria-label={mask.inverted ? 'Disable inversion' : 'Enable inversion'}
                aria-pressed={mask.inverted ?? false}
                title={mask.inverted ? 'Mask is inverted' : 'Mask is not inverted'}
              >
                Invert
              </button>
              <button
                type="button"
                className="insp-btn-sm"
                onClick={handleRemove}
                aria-label="Remove mask"
                title="Remove mask (source node is preserved)"
                style={{ color: 'var(--color-text-danger, #e74c3c)' }}
              >
                Remove
              </button>
            </div>
          </div>

          {mask.type !== 'clip' && (
            <>
              <div className="insp-field">
                <NumberField
                  label="Feather"
                  value={mask.feather ?? 0}
                  min={0}
                  step={0.5}
                  onChange={handleFeather}
                  fieldName="maskFeather"
                />
              </div>
              <div className="insp-field">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    width: '100%',
                  }}
                >
                  <label className="insp-field__label" htmlFor="mask-density">
                    Density
                  </label>
                  <input
                    id="mask-density"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={mask.density ?? 1}
                    onChange={(e) => handleDensity(Number(e.target.value))}
                    aria-label="Mask density"
                    style={{ flex: 1 }}
                  />
                  <span
                    className="insp-field__value"
                    style={{ minWidth: '2.5em', textAlign: 'right' }}
                  >
                    {Math.round((mask.density ?? 1) * 100)}%
                  </span>
                </div>
              </div>
            </>
          )}

          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-subtle)' }}>
            Source: {mask.sourceNodeId?.slice(0, 8) ?? 'none'}
          </div>
        </div>
      )}
    </DisclosureSection>
  );
}
