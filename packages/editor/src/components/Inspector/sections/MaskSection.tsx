import type { MaskType, SceneNode } from '@varve/scene';
import { walkNodes } from '@varve/scene';
import { Select, Tooltip } from '@varve/ui';
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
    setMaskHideSource,
    setMaskLinked,
    setMaskType,
    setMaskFillRule,
    setMaskVectorPath,
    setTool,
    state,
  } = editor;

  const node = nodes[0]!;
  const document = state.document;
  const container = node as SceneNode & { mask?: unknown; children?: string[] };
  const mask = (container.mask ?? null) as {
    type: MaskType;
    visible: boolean;
    inverted?: boolean;
    hideMaskSource?: boolean;
    feather?: number;
    density?: number;
    sourceNodeId?: string;
    linked?: boolean;
    fillRule?: 'nonzero' | 'evenodd';
    vectorMask?: {
      points: {
        x: number;
        y: number;
        handleIn?: { x: number; y: number } | null;
        handleOut?: { x: number; y: number } | null;
      }[];
      closed: boolean;
      fillRule: 'nonzero' | 'evenodd';
    };
  } | null;

  const canHaveMask = node.kind === 'frame' || node.kind === 'group' || node.kind === 'adjustment';
  const hasChildren = 'children' in container && (container.children?.length ?? 0) > 0;
  const canAddMask = canHaveMask && !mask && hasChildren;

  const nodeMap = useMemo(() => {
    if (!document || !mask?.sourceNodeId) return null;
    return walkNodes(document);
  }, [document, mask?.sourceNodeId]);

  const sourceNode = useMemo(() => {
    if (!mask?.sourceNodeId || !nodeMap) return null;
    const entry = nodeMap.get(mask.sourceNodeId);
    return entry?.node ?? null;
  }, [mask?.sourceNodeId, nodeMap]);

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

  const handleToggleHideSource = useCallback(() => {
    if (setMaskHideSource) {
      setMaskHideSource(!mask?.hideMaskSource);
    }
  }, [setMaskHideSource, mask?.hideMaskSource]);

  const handleToggleLinked = useCallback(() => {
    if (setMaskLinked) {
      setMaskLinked(!mask?.linked);
    }
  }, [setMaskLinked, mask?.linked]);

  const handleTypeChange = useCallback(
    (v: string) => {
      if (setMaskType) {
        setMaskType(v as MaskType);
      }
    },
    [setMaskType],
  );

  const handleSetFillRule = useCallback(
    (rule: 'nonzero' | 'evenodd') => {
      if (setMaskFillRule) {
        setMaskFillRule(rule);
      }
    },
    [setMaskFillRule],
  );

  const handleEditVectorPath = useCallback(() => {
    if (setMaskVectorPath && mask?.vectorMask) {
      setMaskVectorPath(
        mask.vectorMask.points as import('@varve/engine').PathPoint[],
        mask.vectorMask.closed,
      );
    }
  }, [setMaskVectorPath, mask?.vectorMask]);

  const supportsFillRule = mask?.type === 'clip' || mask?.vectorMask;

  if (!canHaveMask) return null;

  return (
    <DisclosureSection title="Mask" defaultExpanded={!!mask}>
      {canAddMask && (
        <div className="insp-field" style={{ flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span className="insp-field__label">Add Mask</span>
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            <Tooltip label="Clip mask: uses the first child's outline to clip other children">
              <button
                type="button"
                className="insp-btn-sm"
                onClick={handleAddClip}
                aria-label="Add clip mask"
              >
                Clip
              </button>
            </Tooltip>
            <Tooltip label="Alpha mask: uses the first child's alpha channel to modulate visibility">
              <button
                type="button"
                className="insp-btn-sm"
                onClick={handleAddAlpha}
                aria-label="Add alpha mask"
              >
                Alpha
              </button>
            </Tooltip>
            <Tooltip label="Luminance mask: uses the first child's luminance to modulate visibility">
              <button
                type="button"
                className="insp-btn-sm"
                onClick={handleAddLuminance}
                aria-label="Add luminance mask"
              >
                Luminance
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {node.kind === 'frame' && (
        <div className="insp-field" style={{ flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span className="insp-field__label">Brush mask</span>
          <button
            type="button"
            className="insp-btn-sm"
            onClick={() => {
              setTool?.('refineMask');
            }}
            aria-label="Paint mask with the brush tool"
          >
            {mask ? 'Paint mask…' : 'Create brush mask…'}
          </button>
          <p className="insp-field__hint">
            Paints a pixel alpha mask over the frame. Paint reveals, Alt+paint hides.
          </p>
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
              <Tooltip label={mask.visible ? 'Mask is active' : 'Mask is disabled'}>
                <button
                  type="button"
                  className="insp-btn-sm"
                  onClick={handleToggleVisible}
                  aria-label={mask.visible ? 'Disable mask' : 'Enable mask'}
                  aria-pressed={mask.visible}
                >
                  {mask.visible ? 'On' : 'Off'}
                </button>
              </Tooltip>
              <Tooltip label={mask.inverted ? 'Mask is inverted' : 'Mask is not inverted'}>
                <button
                  type="button"
                  className="insp-btn-sm"
                  onClick={handleToggleInverted}
                  aria-label={mask.inverted ? 'Disable inversion' : 'Enable inversion'}
                  aria-pressed={mask.inverted ?? false}
                >
                  Invert
                </button>
              </Tooltip>
              {mask.sourceNodeId && (
                <Tooltip
                  label={
                    mask.hideMaskSource
                      ? 'Mask source is hidden from direct rendering'
                      : 'Mask source is rendered normally'
                  }
                >
                  <button
                    type="button"
                    className="insp-btn-sm"
                    onClick={handleToggleHideSource}
                    aria-label={mask.hideMaskSource ? 'Show mask source' : 'Hide mask source'}
                    aria-pressed={mask.hideMaskSource ?? false}
                  >
                    Hide
                  </button>
                </Tooltip>
              )}
              {mask.sourceNodeId && (
                <Tooltip
                  label={
                    mask.linked !== false
                      ? 'Mask transforms with masked content'
                      : 'Mask has independent transform'
                  }
                >
                  <button
                    type="button"
                    className="insp-btn-sm"
                    onClick={handleToggleLinked}
                    aria-label={
                      mask.linked !== false ? 'Unlink mask transform' : 'Link mask transform'
                    }
                    aria-pressed={mask.linked !== false}
                  >
                    Link
                  </button>
                </Tooltip>
              )}
              <Tooltip label="Remove mask (source node is preserved)">
                <button
                  type="button"
                  className="insp-btn-sm"
                  onClick={handleRemove}
                  aria-label="Remove mask"
                  style={{ color: 'var(--color-feedback-danger, #e74c3c)' }}
                >
                  Remove
                </button>
              </Tooltip>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              marginTop: 'var(--space-1)',
            }}
          >
            <span className="insp-field__label" style={{ fontSize: 'var(--font-size-xs)' }}>
              Type
            </span>
            <Select
              label="Mask type"
              value={mask.type}
              options={[
                { value: 'clip', label: 'Clip' },
                { value: 'alpha', label: 'Alpha' },
                { value: 'luminance', label: 'Luminance' },
              ]}
              onChange={handleTypeChange}
            />
          </div>

          {supportsFillRule && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
              }}
            >
              <span className="insp-field__label" style={{ fontSize: 'var(--font-size-xs)' }}>
                Fill Rule
              </span>
              <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                <Tooltip label="Nonzero winding rule: determines interior by winding direction">
                  <button
                    type="button"
                    className="insp-btn-sm"
                    onClick={() => handleSetFillRule('nonzero')}
                    aria-pressed={mask.fillRule !== 'evenodd'}
                    aria-label="Nonzero fill rule"
                    style={{
                      fontWeight: mask.fillRule !== 'evenodd' ? 'bold' : 'normal',
                    }}
                  >
                    Nonzero
                  </button>
                </Tooltip>
                <Tooltip label="Even-odd rule: determines interior by raycast parity">
                  <button
                    type="button"
                    className="insp-btn-sm"
                    onClick={() => handleSetFillRule('evenodd')}
                    aria-pressed={mask.fillRule === 'evenodd'}
                    aria-label="Even-odd fill rule"
                    style={{
                      fontWeight: mask.fillRule === 'evenodd' ? 'bold' : 'normal',
                    }}
                  >
                    Even-Odd
                  </button>
                </Tooltip>
              </div>
            </div>
          )}

          {mask.vectorMask && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-1)',
              }}
            >
              <span className="insp-field__label" style={{ fontSize: 'var(--font-size-xs)' }}>
                Vector: {mask.vectorMask.points.length} pt
                {mask.vectorMask.points.length !== 1 ? 's' : ''}
                {mask.vectorMask.closed ? ' (closed)' : ' (open)'}
              </span>
              <Tooltip label="Edit the vector mask path points">
                <button
                  type="button"
                  className="insp-btn-sm"
                  onClick={handleEditVectorPath}
                  aria-label="Edit vector mask path"
                >
                  Edit path
                </button>
              </Tooltip>
            </div>
          )}

          {mask.type === 'clip' ? (
            <p className="insp-field__hint">
              Feather and density apply to clip masks as soft-edged masking: feather blurs the clip
              boundary and density reduces its strength.
            </p>
          ) : null}

          {
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
          }

          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-subtle)' }}>
            Source: {sourceNode?.name ?? mask.sourceNodeId?.slice(0, 8) ?? 'none'}
          </div>
        </div>
      )}
    </DisclosureSection>
  );
}
