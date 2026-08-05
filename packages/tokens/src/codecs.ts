/**
 * DTCG 2025.10 token-type codecs.
 *
 * Each codec validates a $value payload against the format report's type
 * grammar (section 8 / 9) and returns a normalized value plus diagnostics.
 * Unknown types are preserved without a codec (never guessed from shape).
 */
import { COLOR_SPACE_SPECS, isStableColorSpace, isStableTokenType } from './spec';
import type { TokenDiagnostic, TokenTypeKind } from './types';

export interface CodecContext {
  sourceFileId: string;
  pointer: string;
  path: string[];
}

export interface CodecResult<T = unknown> {
  value: T | undefined;
  diagnostics: TokenDiagnostic[];
}

export interface TokenTypeCodec {
  type: TokenTypeKind;
  validate(value: unknown, ctx: CodecContext): CodecResult;
}

const DIMENSION_UNITS = new Set(['px', 'rem']);
const DURATION_UNITS = new Set(['ms', 's']);
const FONT_WEIGHT_ALIASES = new Set([
  'thin',
  'hairline',
  'extra-light',
  'ultra-light',
  'light',
  'normal',
  'regular',
  'book',
  'medium',
  'semi-bold',
  'demi-bold',
  'bold',
  'extra-bold',
  'ultra-bold',
  'black',
  'heavy',
  'extra-black',
  'ultra-black',
]);
const STROKE_STYLE_STRINGS = new Set([
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'outset',
  'inset',
]);
const LINE_CAPS = new Set(['round', 'butt', 'square']);

export const codecs: Readonly<Record<TokenTypeKind, TokenTypeCodec>> = {
  color: {
    type: 'color',
    validate(value, ctx) {
      if (!isRecord(value))
        return error(ctx, 'color.value-object', 'Color $value must be an object');
      const { colorSpace, components, alpha, hex } = value;
      if (typeof colorSpace !== 'string')
        return error(ctx, 'color.color-space', 'colorSpace is required and must be a string');
      if (!isStableColorSpace(colorSpace))
        return error(ctx, 'color.unknown-space', `Unknown color space "${colorSpace}"`);
      const spec = COLOR_SPACE_SPECS[colorSpace]!;
      if (!Array.isArray(components))
        return error(ctx, 'color.components', 'components must be an array');
      if (components.length !== spec.componentCount) {
        return error(
          ctx,
          'color.component-count',
          `"${colorSpace}" requires ${spec.componentCount} components, got ${components.length}`,
        );
      }
      for (const component of components) {
        if (component === 'none') {
          if (!spec.allowsNone)
            return error(
              ctx,
              'color.none-unsupported',
              `The 'none' keyword is not supported for "${colorSpace}"`,
            );
          continue;
        }
        if (typeof component !== 'number' || !Number.isFinite(component)) {
          return error(ctx, 'color.component-type', 'Color components must be numbers or "none"');
        }
      }
      for (let i = 0; i < components.length; i += 1) {
        const component = components[i];
        if (typeof component !== 'number') continue;
        const range = spec.ranges[i]!;
        const outOfRange =
          component < range.min ||
          (range.maxExclusive ? component >= range.max : component > range.max);
        if (outOfRange) {
          return error(
            ctx,
            'color.component-range',
            `Component ${i} of "${colorSpace}" is out of range [${range.min}, ${range.max}${range.maxExclusive ? ')' : ']'}`,
          );
        }
      }
      if (alpha !== undefined) {
        if (typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
          return error(ctx, 'color.alpha', 'alpha must be a number between 0 and 1');
        }
      }
      if (hex !== undefined) {
        if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
          return error(ctx, 'color.hex', 'hex must be a 6-digit CSS hex color like #ff00ff');
        }
      }
      const normalized = { colorSpace, components: [...components] };
      if (alpha !== undefined) (normalized as Record<string, unknown>).alpha = alpha;
      if (hex !== undefined) (normalized as Record<string, unknown>).hex = hex;
      return { value: normalized, diagnostics: [] };
    },
  },
  dimension: {
    type: 'dimension',
    validate(value, ctx) {
      if (!isRecord(value))
        return error(ctx, 'dimension.value-object', 'Dimension $value must be an object');
      const { value: numberValue, unit } = value;
      if (typeof numberValue !== 'number' || !Number.isFinite(numberValue)) {
        return error(ctx, 'dimension.value', 'Dimension value must be a finite number');
      }
      if (typeof unit !== 'string' || !DIMENSION_UNITS.has(unit)) {
        return error(ctx, 'dimension.unit', 'Dimension unit may only be "px" or "rem"');
      }
      return { value: { value: numberValue, unit }, diagnostics: [] };
    },
  },
  number: {
    type: 'number',
    validate(value, ctx) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return error(ctx, 'number.value', 'Number $value must be a finite JSON number');
      }
      return { value, diagnostics: [] };
    },
  },
  duration: {
    type: 'duration',
    validate(value, ctx) {
      if (!isRecord(value))
        return error(ctx, 'duration.value-object', 'Duration $value must be an object');
      const { value: numberValue, unit } = value;
      if (typeof numberValue !== 'number' || !Number.isFinite(numberValue)) {
        return error(ctx, 'duration.value', 'Duration value must be a finite number');
      }
      if (typeof unit !== 'string' || !DURATION_UNITS.has(unit)) {
        return error(ctx, 'duration.unit', 'Duration unit may only be "ms" or "s"');
      }
      return { value: { value: numberValue, unit }, diagnostics: [] };
    },
  },
  cubicBezier: {
    type: 'cubicBezier',
    validate(value, ctx) {
      if (!Array.isArray(value) || value.length !== 4) {
        return error(
          ctx,
          'cubic-bezier.length',
          'cubicBezier must be an array of four numbers [x1, y1, x2, y2]',
        );
      }
      for (const n of value) {
        if (typeof n !== 'number' || !Number.isFinite(n)) {
          return error(ctx, 'cubic-bezier.number', 'cubicBezier values must be finite numbers');
        }
      }
      const [x1, , x2] = value as [number, number, number, number];
      if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
        return error(
          ctx,
          'cubic-bezier.x-range',
          'cubicBezier x coordinates must be in the range [0, 1]',
        );
      }
      return { value: [...value], diagnostics: [] };
    },
  },
  fontFamily: {
    type: 'fontFamily',
    validate(value, ctx) {
      if (typeof value === 'string' && value.length > 0) return { value, diagnostics: [] };
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((v) => typeof v === 'string' && v.length > 0)
      ) {
        return { value: [...value], diagnostics: [] };
      }
      return error(
        ctx,
        'font-family.value',
        'fontFamily must be a non-empty string or an array of strings',
      );
    },
  },
  fontWeight: {
    type: 'fontWeight',
    validate(value, ctx) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 1000) {
        return { value, diagnostics: [] };
      }
      if (typeof value === 'string' && FONT_WEIGHT_ALIASES.has(value)) {
        return { value, diagnostics: [] };
      }
      return error(
        ctx,
        'font-weight.value',
        'fontWeight must be a number in [1, 1000] or a predefined alias string',
      );
    },
  },
  strokeStyle: {
    type: 'strokeStyle',
    validate(value, ctx) {
      if (typeof value === 'string' && STROKE_STYLE_STRINGS.has(value))
        return { value, diagnostics: [] };
      if (isRecord(value)) {
        if (Object.keys(value).some((k) => k !== 'dashArray' && k !== 'lineCap')) {
          return error(
            ctx,
            'stroke-style.properties',
            'strokeStyle object may only contain dashArray and lineCap',
          );
        }
        if (value.dashArray !== undefined) {
          if (!Array.isArray(value.dashArray) || value.dashArray.length === 0) {
            return error(
              ctx,
              'stroke-style.dash-array',
              'dashArray must be a non-empty array of dimensions or references',
            );
          }
        }
        if (
          value.lineCap !== undefined &&
          (typeof value.lineCap !== 'string' || !LINE_CAPS.has(value.lineCap))
        ) {
          return error(
            ctx,
            'stroke-style.line-cap',
            'lineCap must be "round", "butt", or "square"',
          );
        }
        return { value: { ...value }, diagnostics: [] };
      }
      return error(
        ctx,
        'stroke-style.value',
        'strokeStyle must be a predefined string or an object',
      );
    },
  },
  border: {
    type: 'border',
    validate(value, ctx) {
      if (!isRecord(value))
        return error(ctx, 'border.value-object', 'border $value must be an object');
      const { color: borderColor, width, style } = value;
      if (borderColor === undefined) return error(ctx, 'border.color', 'border.color is required');
      if (width === undefined) return error(ctx, 'border.width', 'border.width is required');
      if (style === undefined) return error(ctx, 'border.style', 'border.style is required');
      return { value: { ...value }, diagnostics: [] };
    },
  },
  transition: {
    type: 'transition',
    validate(value, ctx) {
      if (!isRecord(value))
        return error(ctx, 'transition.value-object', 'transition $value must be an object');
      const { duration, delay, timingFunction } = value;
      if (duration === undefined)
        return error(ctx, 'transition.duration', 'transition.duration is required');
      if (delay === undefined)
        return error(ctx, 'transition.delay', 'transition.delay is required');
      if (timingFunction === undefined)
        return error(ctx, 'transition.timing-function', 'transition.timingFunction is required');
      return { value: { ...value }, diagnostics: [] };
    },
  },
  shadow: {
    type: 'shadow',
    validate(value, ctx) {
      if (isRecord(value) && !Array.isArray(value)) {
        const result = validateShadowObject(value, ctx);
        return result;
      }
      if (Array.isArray(value) && value.length > 0) {
        for (const entry of value) {
          if (isRecord(entry)) {
            const result = validateShadowObject(entry, ctx);
            if (result.diagnostics.length > 0) return result;
          } else if (typeof entry !== 'string') {
            return error(
              ctx,
              'shadow.entry',
              'Shadow array entries must be shadow objects or references',
            );
          }
        }
        return { value: [...value], diagnostics: [] };
      }
      return error(
        ctx,
        'shadow.value',
        'shadow must be a shadow object or a non-empty array of shadow objects',
      );
    },
  },
  gradient: {
    type: 'gradient',
    validate(value, ctx) {
      if (!Array.isArray(value) || value.length === 0) {
        return error(ctx, 'gradient.value', 'gradient must be a non-empty array of gradient stops');
      }
      for (const stop of value) {
        if (typeof stop === 'string') continue; // reference to a gradient token
        if (!isRecord(stop) || stop.color === undefined || stop.position === undefined) {
          return error(ctx, 'gradient.stop', 'Each gradient stop must have color and position');
        }
        const position = stop.position;
        if (typeof position === 'number' && !Number.isFinite(position)) {
          return error(
            ctx,
            'gradient.position',
            'Gradient stop position must be a finite number in [0, 1]',
          );
        }
      }
      return { value: [...value], diagnostics: [] };
    },
  },
  typography: {
    type: 'typography',
    validate(value, ctx) {
      if (!isRecord(value))
        return error(ctx, 'typography.value-object', 'typography $value must be an object');
      const required = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight'];
      const missing = required.filter((key) => value[key] === undefined);
      if (missing.length > 0) {
        return error(ctx, 'typography.required', `typography requires ${missing.join(', ')}`);
      }
      return { value: { ...value }, diagnostics: [] };
    },
  },
};

function validateShadowObject(value: Record<string, unknown>, ctx: CodecContext): CodecResult {
  const required = ['color', 'offsetX', 'offsetY', 'blur', 'spread'];
  const missing = required.filter((key) => value[key] === undefined);
  if (missing.length > 0) {
    return error(ctx, 'shadow.required', `shadow requires ${missing.join(', ')}`);
  }
  if (value.inset !== undefined && typeof value.inset !== 'boolean') {
    return error(ctx, 'shadow.inset', 'shadow.inset must be a boolean');
  }
  return { value: { ...value }, diagnostics: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function error(ctx: CodecContext, code: string, message: string): CodecResult {
  return {
    value: undefined,
    diagnostics: [
      {
        severity: 'error',
        code: `codec.${code}`,
        message,
        sourceFileId: ctx.sourceFileId,
        pointer: ctx.pointer,
      },
    ],
  };
}

/**
 * Validate a token's value against its type codec. Unknown types are
 * preserved without validation (with a warning from the parser layer).
 * Returns diagnostics only — the store applies values after validation.
 */
export function validateTokenValue(type: string, value: unknown, ctx: CodecContext): CodecResult {
  if (!isStableTokenType(type)) {
    return { value, diagnostics: [] };
  }
  // Property-level $ref inside $value is a reference, not a literal —
  // codecs must not reject it (format report example 32).
  if (isRecord(value) && typeof value.$ref === 'string' && Object.keys(value).length === 1) {
    return { value, diagnostics: [] };
  }
  const codec = codecs[type];
  return codec.validate(value, ctx);
}
