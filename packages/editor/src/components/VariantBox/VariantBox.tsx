/**
 * VariantBox — floating popover for variant switching on component instances.
 *
 * Appears near the selected component instance's bounding box. Shows the active
 * variant name, per-property controls (boolean toggle, text input,
 * instance-swap dropdown), a variant-picker list, and a "Create variant" button.
 *
 * Research basis: Figma variant picker popover.
 */
import type { ComponentProperty, Document, NodeId, Variant } from '@varve/scene';
import { getComponentProperties, resolveVariantProperties } from '@varve/scene';
import { SOLID_CHROME_ICONS, SolidIcon } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import './VariantBox.css';

export interface VariantBoxProps {
  nodeId: NodeId;
  document: Document;
  onSetVariant: (instanceId: NodeId, variantId: string) => void;
  onCreateVariant: (
    componentId: NodeId,
    name: string,
    propertyValues: Record<string, string | boolean | NodeId>,
    instanceId: NodeId,
  ) => void;
  onSetPropertyOverride: (
    instanceId: NodeId,
    propName: string,
    value: string | boolean | NodeId,
  ) => void;
  screenBounds: { x: number; y: number; w: number; h: number };
  onClose: () => void;
}

export function VariantBox({
  nodeId,
  document: doc,
  onSetVariant,
  onCreateVariant,
  onSetPropertyOverride,
  screenBounds,
  onClose,
}: VariantBoxProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newVariantName, setNewVariantName] = useState('');
  const [pendingProps, setPendingProps] = useState<Record<string, string | boolean | NodeId>>({});

  const node = doc.nodes[nodeId];
  const componentId: string | undefined = node?.kind === 'frame' ? node.componentId : undefined;
  const component = componentId ? doc.components[componentId] : undefined;
  const properties = component && componentId ? getComponentProperties(doc, componentId) : [];
  const variants = component?.variants ?? [];
  const activeVariant = node?.kind === 'frame' ? node.variant : undefined;
  const activeVariantData = activeVariant
    ? variants.find((v: Variant) => v.id === activeVariant)
    : undefined;

  const resolvedProps = useMemo(() => {
    if (!componentId || !activeVariant) return {};
    return resolveVariantProperties(doc, componentId, activeVariant);
  }, [doc, componentId, activeVariant]);

  const handleVariantSelect = useCallback(
    (variantId: string) => {
      onSetVariant(nodeId, variantId);
    },
    [nodeId, onSetVariant],
  );

  const handleCreateVariant = useCallback(() => {
    setShowCreateForm(true);
    setNewVariantName('');
    setPendingProps({ ...resolvedProps });
  }, [resolvedProps]);

  const confirmCreateVariant = useCallback(() => {
    if (!newVariantName.trim() || !componentId) return;
    onCreateVariant(componentId, newVariantName.trim(), pendingProps, nodeId);
    setShowCreateForm(false);
    setNewVariantName('');
  }, [newVariantName, componentId, nodeId, pendingProps, onCreateVariant]);

  const cancelCreateVariant = useCallback(() => {
    setShowCreateForm(false);
    setNewVariantName('');
  }, []);

  const handlePropChange = useCallback(
    (propName: string, value: string | boolean | NodeId) => {
      if (showCreateForm) {
        setPendingProps((prev) => ({ ...prev, [propName]: value }));
      } else {
        onSetPropertyOverride(nodeId, propName, value);
      }
    },
    [showCreateForm, nodeId, onSetPropertyOverride],
  );

  const PADDING = 8;
  const panX = screenBounds.x;
  const panY = screenBounds.y;

  const left = panX + screenBounds.w + PADDING;
  const top = panY;

  return (
    <div
      className="variant-box"
      role="dialog"
      aria-label="Variant picker"
      style={{ left: `${left}px`, top: `${top}px` }}
    >
      <div className="variant-box__header">
        <span className="variant-box__title">Variants</span>
        <button
          type="button"
          className="variant-box__close"
          aria-label="Close variant panel"
          onClick={onClose}
        >
          <SolidIcon name={SOLID_CHROME_ICONS.close} size="0.85em" />
        </button>
      </div>

      {variants.length === 0 && !showCreateForm ? (
        <div className="variant-box__empty">No Variants</div>
      ) : (
        <div className="variant-box__variant-list" role="listbox" aria-label="Variants">
          {variants.map((v: Variant) => (
            <button
              key={v.id}
              type="button"
              role="option"
              aria-selected={v.id === activeVariant}
              className={`variant-box__variant-item ${
                v.id === activeVariant ? 'variant-box__variant-item--active' : ''
              }`}
              onClick={() => handleVariantSelect(v.id)}
            >
              <span className="variant-box__variant-name">{v.name}</span>
              {v.id === activeVariant && (
                <SolidIcon
                  name={SOLID_CHROME_ICONS.check}
                  size="0.75em"
                  className="variant-box__check"
                />
              )}
            </button>
          ))}
        </div>
      )}

      {!showCreateForm && (
        <button
          type="button"
          className="variant-box__create-btn"
          aria-label="Create variant"
          onClick={handleCreateVariant}
        >
          <SolidIcon name={SOLID_CHROME_ICONS.plus} size="0.85em" />
          Create variant
        </button>
      )}

      {showCreateForm && (
        <div className="variant-box__create-form">
          <label className="variant-box__field-label">
            Name
            <input
              type="text"
              className="variant-box__input"
              value={newVariantName}
              onChange={(e) => setNewVariantName(e.target.value)}
              placeholder="e.g., Large"
              aria-label="Variant name"
            />
          </label>
          <div className="variant-box__props-preview">
            {properties.map((prop: ComponentProperty) => (
              <div key={prop.id} className="variant-box__prop-row">
                <span className="variant-box__prop-name">{prop.name}</span>
                <VariantPropControl
                  prop={prop}
                  value={
                    pendingProps[prop.name] !== undefined
                      ? (pendingProps[prop.name] as string | boolean | NodeId)
                      : prop.defaultValue
                  }
                  onChange={(v) => handlePropChange(prop.name, v)}
                />
              </div>
            ))}
          </div>
          <div className="variant-box__create-actions">
            <button type="button" className="variant-box__cancel-btn" onClick={cancelCreateVariant}>
              Cancel
            </button>
            <button
              type="button"
              className="variant-box__confirm-btn"
              disabled={!newVariantName.trim()}
              onClick={confirmCreateVariant}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {!showCreateForm && properties.length > 0 && activeVariant && (
        <div className="variant-box__properties">
          <div className="variant-box__props-title">Properties</div>
          {properties.map((prop: ComponentProperty) => (
            <div key={prop.id} className="variant-box__prop-row">
              <span className="variant-box__prop-name">{prop.name}</span>
              <span className="variant-box__prop-value">
                {prop.type === 'boolean'
                  ? String(resolvedProps[prop.name] ?? prop.defaultValue)
                  : String(resolvedProps[prop.name] ?? prop.defaultValue)}
              </span>
            </div>
          ))}
        </div>
      )}

      {!showCreateForm && (
        <div className="variant-box__prop-controls">
          {properties.map((prop: ComponentProperty) => (
            <div key={prop.id} className="variant-box__prop-row">
              <span className="variant-box__prop-name">{prop.name}</span>
              <VariantPropControl
                prop={prop}
                value={
                  activeVariantData
                    ? (activeVariantData.propertyValues[prop.name] ?? prop.defaultValue)
                    : prop.defaultValue
                }
                onChange={(value) => {
                  handlePropChange(prop.name, value);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface VariantPropControlProps {
  prop: ComponentProperty;
  value: string | boolean | NodeId;
  onChange: (value: string | boolean | NodeId) => void;
}

function VariantPropControl({ prop, value, onChange }: VariantPropControlProps) {
  if (prop.type === 'boolean') {
    return (
      <button
        type="button"
        className={`variant-box__bool-toggle ${value ? 'variant-box__bool-toggle--on' : ''}`}
        onClick={() => onChange(!value)}
        aria-label={`${prop.name}: ${String(value)}`}
        aria-pressed={Boolean(value)}
      >
        {value ? 'On' : 'Off'}
      </button>
    );
  }

  if (prop.type === 'text') {
    return (
      <input
        type="text"
        className="variant-box__text-input"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        aria-label={prop.name}
      />
    );
  }

  if (prop.type === 'instanceSwap') {
    return (
      <span
        className="variant-box__swap-label"
        role="img"
        aria-label={`${prop.name}: swap instance`}
      >
        <SolidIcon name={SOLID_CHROME_ICONS.maximize} size="0.75em" />
      </span>
    );
  }

  return <span className="variant-box__prop-value-display">{String(value)}</span>;
}
