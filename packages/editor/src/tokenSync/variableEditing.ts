/** Typed edits of imported values preserve their units and structured source form. */
import type { Variable, VariableStore, VariableValue } from '@varve/scene';
import { resolveAuthoredTokenValue, tokenForVariableId } from '@varve/scene/tokens';
import { formatVariableValue } from '../variableValueFormat';

export function parseVariableEdit(
  store: VariableStore,
  variable: Variable,
  text: string,
): VariableValue {
  const displayed = variable.valuesByMode[store.activeMode] ?? variable.valuesByMode.default;
  // An unchanged display value must not quantize source channels or turn a
  // dimension's formatted "8 px" label into a parse error.
  if (displayed !== undefined && text.trim() === formatVariableValue(displayed).trim())
    return displayed;
  const token = tokenForVariableId(store, variable.id);
  if (!token) {
    if (variable.type === 'number') return Number(text) || 0;
    if (variable.type === 'boolean') return text === 'true';
    return text;
  }
  const original =
    token.type === 'dimension' ? resolveAuthoredTokenValue(store, variable.id) : token.value;
  return parseAuthoredTokenEdit(token.type, original, text);
}

export function parseAuthoredTokenEdit(
  type: string,
  previousValue: unknown,
  text: string,
): VariableValue {
  const trimmed = text.trim();
  if (/^\{[^{}]+\}$/.test(trimmed) && !trimmed.includes(':')) return trimmed;
  if (type === 'color' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(trimmed)) {
    const channels = [1, 3, 5].map(
      (offset) => Number.parseInt(trimmed.slice(offset, offset + 2), 16) / 255,
    );
    return {
      colorSpace: 'srgb',
      components: channels,
      ...(trimmed.length === 9 ? { alpha: Number.parseInt(trimmed.slice(7), 16) / 255 } : {}),
    };
  }
  if (type === 'dimension' && trimmed !== '' && Number.isFinite(Number(trimmed))) {
    const original = previousValue as { unit?: string };
    if (!original?.unit) throw new Error('Choose an explicit px or rem unit for this dimension.');
    return { value: Number(trimmed), unit: original.unit };
  }
  if (type === 'fontFamily' && !/^[[{"]/.test(trimmed)) return trimmed;
  if (type === 'fontWeight' && !Number.isFinite(Number(trimmed))) return trimmed;
  try {
    return JSON.parse(trimmed) as VariableValue;
  } catch {
    throw new Error(
      'Enter a valid typed value, a complete {token.path} alias, or a color as #RRGGBB or #RRGGBBAA.',
    );
  }
}
