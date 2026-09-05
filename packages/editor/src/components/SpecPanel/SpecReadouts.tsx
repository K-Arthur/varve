/**
 * SpecReadouts — grouped fieldset sections for layout, typography, color/fill,
 * and content data. Every value carries a CopyButton.
 *
 * Research basis: Figma Dev Mode spec readouts; WCAG 2.2 — color conveyed
 * with text (not color alone), contrast ratios shown numerically.
 */

import { resolveTokenName } from '@varve/codegen';
import type { Document, ManagedColor, SceneNode, VariableStore } from '@varve/scene';
import { textNodeLocalBounds } from '@varve/scene';
import { convertPx, formatValue, managedColorToRgba, type SpecUnit } from '@varve/shared';
import { CopyButton } from '@varve/ui';
import { useMemo } from 'react';

// ── Token reverse-lookup ───────────────────────────────────────────────────

function matchTokens(
  value: number | ManagedColor | string,
  store: VariableStore | undefined,
): string[] {
  if (!store) return [];

  const searchStr =
    typeof value === 'string'
      ? value.toLowerCase()
      : typeof value === 'number'
        ? String(value)
        : (() => {
            const [r, g, b, a] = managedColorToRgba(value);
            return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
          })();

  const matches: string[] = [];
  for (const v of Object.values(store.variables)) {
    for (const modeValue of Object.values(v.valuesByMode)) {
      const resolved = typeof modeValue === 'string' ? modeValue.toLowerCase() : String(modeValue);
      if (resolved === searchStr) {
        matches.push(v.name);
        break;
      }
    }
  }
  return matches;
}

function colorToHex(c: ManagedColor): string {
  const [r, g, b] = managedColorToRgba(c);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function colorToRgb(c: ManagedColor): string {
  const [r, g, b] = managedColorToRgba(c);
  return `rgb(${r}, ${g}, ${b})`;
}

function luminance(c: ManagedColor): number {
  const [r, g, b] = managedColorToRgba(c);
  const rs = r / 255;
  const gs = g / 255;
  const bs = b / 255;
  const rl = rs <= 0.03928 ? rs / 12.92 : ((rs + 0.055) / 1.055) ** 2.4;
  const gl = gs <= 0.03928 ? gs / 12.92 : ((gs + 0.055) / 1.055) ** 2.4;
  const bl = bs <= 0.03928 ? bs / 12.92 : ((bs + 0.055) / 1.055) ** 2.4;
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(fg: number, bg: number): number {
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface SpecReadoutsProps {
  node: SceneNode;
  doc: Document;
  unit: SpecUnit;
  baseFontSize: number;
  variableStore?: VariableStore;
}

// ── Layout Readout ─────────────────────────────────────────────────────────

function LayoutReadout({ node, unit, baseFontSize }: SpecReadoutsProps) {
  const fields: { label: string; value: string }[] = [];
  const tx = node.transform;

  const containerSize = 100;

  function p(px: number): string {
    return formatValue(convertPx(px, unit, baseFontSize, containerSize), unit);
  }

  fields.push({ label: 'X', value: p(tx[4] ?? 0) });
  fields.push({ label: 'Y', value: p(tx[5] ?? 0) });

  if (node.kind === 'shape' && node.shape.kind === 'rect') {
    fields.push({ label: 'Width', value: p(node.shape.w) });
    fields.push({ label: 'Height', value: p(node.shape.h) });
  }

  if (node.kind === 'text') {
    const bounds = textNodeLocalBounds(node);
    fields.push({ label: 'Width', value: p(bounds.w) });
    fields.push({ label: 'Height', value: p(bounds.h) });
  }

  if (node.kind === 'frame' && node.layoutStyle) {
    const l = node.layoutStyle;
    fields.push({
      label: 'Direction',
      value: l.direction,
    });
    fields.push({ label: 'Gap', value: p(l.gap) });
    if (l.padding) {
      const [t, r, b, l_] = l.padding;
      fields.push({ label: 'Padding', value: `${p(t)} ${p(r)} ${p(b)} ${p(l_)}` });
    }
  }

  return (
    <section className="spec-panel__section" aria-labelledby="spec-layout-heading">
      <h3 id="spec-layout-heading">Layout</h3>
      {fields.map((f) => (
        <div key={f.label} className="spec-row">
          <span className="spec-row__label">{f.label}</span>
          <span className="spec-row__value">{f.value}</span>
          <CopyButton value={f.value} label={f.label} className="spec-row__copy" />
        </div>
      ))}
    </section>
  );
}

// ── Typography Readout ─────────────────────────────────────────────────────

function TypographyReadout({ node, unit, baseFontSize, variableStore }: SpecReadoutsProps) {
  if (node.kind !== 'text') return null;

  const t = node;
  const containerSize = 100;

  function p(px: number): string {
    return formatValue(convertPx(px, unit, baseFontSize, containerSize), unit);
  }

  const fields: { label: string; value: string; rawValue?: string; tokenName?: string }[] = [];

  fields.push({ label: 'Font Size', value: t.fontSize ? p(t.fontSize) : '—' });
  fields.push({ label: 'Font Family', value: t.fontFamily ?? '—' });

  const tokens = matchTokens(t.fontSize, variableStore);
  if (tokens.length > 0) {
    const lastField = fields[fields.length - 1];
    if (lastField) lastField.tokenName = tokens[0];
  }

  fields.push({ label: 'Font Weight', value: '—' });
  fields.push({ label: 'Line Height', value: '—' });
  fields.push({ label: 'Letter Spacing', value: '—' });
  fields.push({ label: 'Text Align', value: '—' });

  return (
    <section className="spec-panel__section" aria-labelledby="spec-typography-heading">
      <h3 id="spec-typography-heading">Typography</h3>
      {fields.map((f) => (
        <div key={f.label} className="spec-row">
          <span className="spec-row__label">{f.label}</span>
          <span className="spec-row__value">
            {f.value}
            {f.tokenName && <span className="spec-row__token"> (token: {f.tokenName})</span>}
          </span>
          <CopyButton value={f.tokenName ?? f.value} label={f.label} className="spec-row__copy" />
        </div>
      ))}
    </section>
  );
}

// ── Color & Fill Readout ───────────────────────────────────────────────────

function ColorReadout({ node, variableStore }: SpecReadoutsProps) {
  const fill = node.fill;

  const hex = useMemo(() => colorToHex(fill), [fill]);
  const rgb = useMemo(() => colorToRgb(fill), [fill]);
  const boundToken = useMemo(
    () => resolveTokenName(node.bindings, 'fill', variableStore),
    [node.bindings, variableStore],
  );
  const tokens = useMemo(
    () => (boundToken ? [boundToken] : matchTokens(fill, variableStore)),
    [boundToken, fill, variableStore],
  );
  const bgLum = 1;
  const fgLum = useMemo(() => luminance(fill), [fill]);
  const cr = useMemo(() => contrastRatio(fgLum, bgLum), [fgLum]);
  const passesAA = cr >= 4.5;

  return (
    <section className="spec-panel__section" aria-labelledby="spec-color-heading">
      <h3 id="spec-color-heading">Color & Fill</h3>

      <div className="spec-row">
        <span className="spec-row__label">Fill</span>
        <span
          className="spec-swatch"
          role="img"
          style={{
            backgroundColor: (() => {
              if (typeof fill !== 'string' && 'space' in fill) {
                const [r, g, b, a] = managedColorToRgba(fill);
                return `rgba(${r},${g},${b},${a / 255})`;
              }
              return '';
            })(),
          }}
          aria-label={`Fill color: ${hex}`}
        />
        <span className="spec-row__value">{hex}</span>
        <CopyButton value={hex} label="HEX" className="spec-row__copy" />
        <CopyButton value={rgb} label="RGB" className="spec-row__copy" />
      </div>

      {tokens.length > 0 && (
        <div className="spec-row">
          <span className="spec-row__label">Token</span>
          <span className="spec-row__value">{tokens[0]}</span>
          <CopyButton value={tokens[0] ?? ''} label="Token name" className="spec-row__copy" />
        </div>
      )}

      <div className="spec-row">
        <span className="spec-row__label">Contrast</span>
        <span className={`spec-row__value ${passesAA ? '' : 'spec-row__value--warn'}`}>
          {hex} on white: {cr.toFixed(1)}:1
          {passesAA ? ' (AA)' : ' (fails AA)'}
        </span>
        <CopyButton value={cr.toFixed(2)} label="Contrast ratio" className="spec-row__copy" />
      </div>
    </section>
  );
}

// ── Content Readout ────────────────────────────────────────────────────────

function ContentReadout({ node, doc }: SpecReadoutsProps) {
  const fields: { label: string; value: string }[] = [];

  fields.push({ label: 'Name', value: node.name });
  fields.push({ label: 'Type', value: node.kind });

  if (node.kind === 'text' && node.text) {
    fields.push({ label: 'Text', value: node.text });
  }

  if (node.kind === 'frame' && node.componentId) {
    const comp = doc.components[node.componentId];
    if (comp) {
      fields.push({ label: 'Component', value: comp.name });
    }
    if (node.slots) {
      const slotCount = Object.keys(node.slots).length;
      fields.push({ label: 'Slots', value: `${slotCount} filled` });
    }
  }

  return (
    <section className="spec-panel__section" aria-labelledby="spec-content-heading">
      <h3 id="spec-content-heading">Content</h3>
      {fields.map((f) => (
        <div key={f.label} className="spec-row">
          <span className="spec-row__label">{f.label}</span>
          <span className="spec-row__value">{f.value}</span>
          <CopyButton value={f.value} label={f.label} className="spec-row__copy" />
        </div>
      ))}
    </section>
  );
}

// ── Main SpecReadouts ──────────────────────────────────────────────────────

export function SpecReadouts(props: SpecReadoutsProps) {
  return (
    <>
      <LayoutReadout {...props} />
      <TypographyReadout {...props} />
      <ColorReadout {...props} />
      <ContentReadout {...props} />
    </>
  );
}
