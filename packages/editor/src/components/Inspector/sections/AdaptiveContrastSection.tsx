/**
 * AdaptiveContrastSection — collapsible inspector panel for adaptive text contrast.
 *
 * APG Disclosure pattern: a checkbox enables/disables adaptive contrast,
 * revealing policy dropdown, custom ratio slider, and candidate color pickers.
 * Shows the current resolved contrast status (ratio, WCAG level).
 *
 * Research basis: WCAG 2.1 §1.4.3, Figma's "Contrast check" overlay,
 * APG Disclosure (Show/Hide) pattern.
 */

import type { ManagedColor, SceneNode, TextNode } from '@varve/scene';
import { contrastRatio, managedColorToRgba, relativeLuminance, wcagLevel } from '@varve/shared';
import { Select } from '@varve/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';
import { NumberField } from '../controls/NumberField';

export interface AdaptiveContrastSectionProps {
  nodes: SceneNode[];
}

const POLICY_OPTIONS = [
  { value: 'wcag-aa', label: 'WCAG AA (4.5:1)' },
  { value: 'wcag-aaa', label: 'WCAG AAA (7:1)' },
  { value: 'custom', label: 'Custom' },
] as const;

const DEFAULT_LIGHT: ManagedColor = { space: 'rgb', r: 255, g: 255, b: 255, a: 255 };
const DEFAULT_DARK: ManagedColor = { space: 'rgb', r: 0, g: 0, b: 0, a: 255 };

function isTextNode(n: SceneNode): n is TextNode {
  return n.kind === 'text';
}

function resolveCommonConfig(nodes: SceneNode[]): {
  enabled: boolean | 'mixed';
  policy: 'wcag-aa' | 'wcag-aaa' | 'custom' | 'mixed';
  customRatio: number | 'mixed';
  lightColor: ManagedColor | 'mixed';
  darkColor: ManagedColor | 'mixed';
  hysteresis: number | 'mixed';
  resolvedRatio: number | null;
  resolvedColor: ManagedColor | null;
} {
  const textNodes = nodes.filter(isTextNode);
  if (textNodes.length === 0) {
    return {
      enabled: false,
      policy: 'wcag-aa',
      customRatio: 4.5,
      lightColor: DEFAULT_LIGHT,
      darkColor: DEFAULT_DARK,
      hysteresis: 0.5,
      resolvedRatio: null,
      resolvedColor: null,
    };
  }

  const first = textNodes[0]!.adaptiveContrast;

  const enabled = textNodes.every((n) => n.adaptiveContrast?.enabled === true)
    ? true
    : textNodes.every((n) => !n.adaptiveContrast?.enabled)
      ? false
      : 'mixed';

  const policy = textNodes.every((n) => n.adaptiveContrast?.policy === first?.policy)
    ? (first?.policy ?? 'wcag-aa')
    : 'mixed';

  const customRatio = textNodes.every((n) => n.adaptiveContrast?.customRatio === first?.customRatio)
    ? (first?.customRatio ?? 4.5)
    : 'mixed';

  const lightColor = textNodes.every((n) => {
    const lc = n.adaptiveContrast?.lightColor;
    const fc = first?.lightColor;
    if (!lc || !fc) return lc === fc;
    const [lr, lg, lb] = managedColorToRgba(lc as ManagedColor);
    const [fr, fg, fb] = managedColorToRgba(fc as ManagedColor);
    return lr === fr && lg === fg && lb === fb;
  })
    ? (first?.lightColor ?? DEFAULT_LIGHT)
    : 'mixed';

  const darkColor = textNodes.every((n) => {
    const dc = n.adaptiveContrast?.darkColor;
    const fc = first?.darkColor;
    if (!dc || !fc) return dc === fc;
    const [dr, dg, db] = managedColorToRgba(dc as ManagedColor);
    const [fr, fg, fb] = managedColorToRgba(fc as ManagedColor);
    return dr === fr && dg === fg && db === fb;
  })
    ? (first?.darkColor ?? DEFAULT_DARK)
    : 'mixed';

  const hysteresis = textNodes.every((n) => n.adaptiveContrast?.hysteresis === first?.hysteresis)
    ? (first?.hysteresis ?? 0.5)
    : 'mixed';

  const resolvedColor = textNodes[0]?.adaptiveContrast?.resolvedColor ?? null;
  const resolvedRatio =
    resolvedColor && textNodes[0]?.fill
      ? computeResolvedRatio(textNodes[0] as TextNode, resolvedColor)
      : null;

  return {
    enabled,
    policy,
    customRatio,
    lightColor,
    darkColor,
    hysteresis,
    resolvedRatio,
    resolvedColor,
  };
}

function computeResolvedRatio(node: TextNode, resolved: ManagedColor): number | null {
  if (!node.fill) return null;
  const [rr, rg, rb] = managedColorToRgba(resolved);
  const [br, bg, bb] = managedColorToRgba(node.fill);
  const fgLum = relativeLuminance(rr, rg, rb);
  const bgLum = relativeLuminance(br, bg, bb);
  return contrastRatio(fgLum, bgLum);
}

export function AdaptiveContrastSection({ nodes }: AdaptiveContrastSectionProps) {
  const textNodes = nodes.filter(isTextNode);
  if (textNodes.length === 0) return null;

  return <AdaptiveContrastSectionInner nodes={textNodes} />;
}

function AdaptiveContrastSectionInner({ nodes }: { nodes: TextNode[] }) {
  const editor = useEditor();
  const common = useMemo(() => resolveCommonConfig(nodes), [nodes]);
  const [localPolicy, setLocalPolicy] = useState<string>(
    common.policy === 'mixed' ? 'wcag-aa' : common.policy,
  );
  const [localCustomRatio, setLocalCustomRatio] = useState(
    common.customRatio === 'mixed' ? 4.5 : common.customRatio,
  );

  useEffect(() => {
    if (common.policy !== 'mixed') setLocalPolicy(common.policy);
    if (common.customRatio !== 'mixed') setLocalCustomRatio(common.customRatio);
  }, [common.policy, common.customRatio]);

  const handleToggle = useCallback(
    (enabled: boolean) => {
      for (const node of nodes) {
        const current = node.adaptiveContrast ?? {
          enabled: false,
          policy: localPolicy as 'wcag-aa' | 'wcag-aaa' | 'custom',
          hysteresis: 0.5,
        };
        const updated = {
          ...current,
          enabled,
          policy: localPolicy as 'wcag-aa' | 'wcag-aaa' | 'custom',
          customRatio: localPolicy === 'custom' ? localCustomRatio : undefined,
        };
        editor.updateNode(node.id, (n) => {
          if (n.kind !== 'text') return n;
          return { ...n, adaptiveContrast: updated } as TextNode;
        });
      }
    },
    [nodes, editor, localPolicy, localCustomRatio],
  );

  const handlePolicyChange = useCallback(
    (value: string) => {
      setLocalPolicy(value);
      for (const node of nodes) {
        const current = node.adaptiveContrast ?? {
          enabled: true,
          policy: 'wcag-aa',
          hysteresis: 0.5,
        };
        const updated = {
          ...current,
          enabled: true,
          policy: value as 'wcag-aa' | 'wcag-aaa' | 'custom',
          customRatio: value === 'custom' ? localCustomRatio : undefined,
        };
        editor.updateNode(node.id, (n) => {
          if (n.kind !== 'text') return n;
          return { ...n, adaptiveContrast: updated } as TextNode;
        });
      }
    },
    [nodes, editor, localCustomRatio],
  );

  const handleCustomRatioChange = useCallback(
    (value: number) => {
      setLocalCustomRatio(value);
      for (const node of nodes) {
        const current = node.adaptiveContrast ?? {
          enabled: true,
          policy: 'custom',
          hysteresis: 0.5,
        };
        const updated = { ...current, enabled: true, policy: 'custom', customRatio: value };
        editor.updateNode(node.id, (n) => {
          if (n.kind !== 'text') return n;
          return { ...n, adaptiveContrast: updated } as TextNode;
        });
      }
    },
    [nodes, editor],
  );

  const handleLightColorChange = useCallback(
    (color: ManagedColor) => {
      for (const node of nodes) {
        const current = node.adaptiveContrast ?? {
          enabled: true,
          policy: 'wcag-aa',
          hysteresis: 0.5,
        };
        editor.updateNode(node.id, (n) => {
          if (n.kind !== 'text') return n;
          return {
            ...n,
            adaptiveContrast: { ...current, enabled: true, lightColor: color },
          } as TextNode;
        });
      }
    },
    [nodes, editor],
  );

  const handleDarkColorChange = useCallback(
    (color: ManagedColor) => {
      for (const node of nodes) {
        const current = node.adaptiveContrast ?? {
          enabled: true,
          policy: 'wcag-aa',
          hysteresis: 0.5,
        };
        editor.updateNode(node.id, (n) => {
          if (n.kind !== 'text') return n;
          return {
            ...n,
            adaptiveContrast: { ...current, enabled: true, darkColor: color },
          } as TextNode;
        });
      }
    },
    [nodes, editor],
  );

  const isCustom = localPolicy === 'custom';
  const showRatioStatus = common.enabled !== false && common.resolvedColor != null;

  return (
    <DisclosureSection
      title="Adaptive Contrast"
      sectionId="adaptive-contrast"
      defaultExpanded={false}
    >
      <div className="insp-field-group">
        <label className="insp-field">
          <span className="insp-field__label">Enable</span>
          <div className="insp-field__control">
            <input
              type="checkbox"
              checked={common.enabled === true}
              onChange={(e) => handleToggle(e.target.checked)}
              className="insp-checkbox"
              aria-label="Enable adaptive contrast"
              ref={(el) => {
                if (el) el.indeterminate = common.enabled === 'mixed';
              }}
            />
          </div>
        </label>

        <FieldRow label="Policy">
          <Select
            label="Contrast policy"
            value={localPolicy}
            onChange={handlePolicyChange}
            options={POLICY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            aria-label="Contrast policy"
          />
        </FieldRow>

        {isCustom && (
          <FieldRow label="Target Ratio">
            <NumberField
              label="Custom contrast ratio"
              value={localCustomRatio}
              onChange={handleCustomRatioChange}
              min={4.5}
              max={21}
              step={0.5}
              aria-label="Custom contrast ratio"
            />
          </FieldRow>
        )}

        <FieldRow label="Light">
          <InspectorColorPopover
            label="Light candidate color"
            value={common.lightColor === 'mixed' ? DEFAULT_LIGHT : common.lightColor}
            onChange={handleLightColorChange}
            onEditStart={editor.beginTransaction}
            onEditEnd={editor.commitTransaction}
          />
        </FieldRow>

        <FieldRow label="Dark">
          <InspectorColorPopover
            label="Dark candidate color"
            value={common.darkColor === 'mixed' ? DEFAULT_DARK : common.darkColor}
            onChange={handleDarkColorChange}
            onEditStart={editor.beginTransaction}
            onEditEnd={editor.commitTransaction}
          />
        </FieldRow>

        {showRatioStatus && common.resolvedColor && (
          <div className="insp-field">
            <span className="insp-field__label">Status</span>
            <div className="insp-field__control">
              <span className="insp-adaptive-status">
                <span
                  className="insp-swatch insp-swatch--sm"
                  style={{
                    background: `rgb(${managedColorToRgba(common.resolvedColor).slice(0, 3).join(',')})`,
                  }}
                />{' '}
                {common.resolvedRatio != null &&
                  `${common.resolvedRatio.toFixed(1)}:1 — ${wcagLevel(common.resolvedRatio, nodes[0]?.fontSize != null && nodes[0].fontSize >= 18)}`}
              </span>
            </div>
          </div>
        )}
      </div>
    </DisclosureSection>
  );
}
