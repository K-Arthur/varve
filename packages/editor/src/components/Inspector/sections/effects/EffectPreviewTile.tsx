/**
 * EffectPreviewTile — a live visual swatch rendered inside effect popovers.
 * Provides immediate visual feedback of shadow/glow contour, blur softness,
 * distortion, noise, or glass translucency as parameters are adjusted.
 *
 * Every effect family renders a preview so tuning is never "blind" — the
 * failure mode reported against modal Layer Style dialogs whose preview
 * checkbox stops updating (see
 * docs/research/effect-panel-competitive-2026-09-20.md). The preview is a
 * symbolic CSS approximation; the canvas render remains authoritative, which
 * is why the accessible name says "Preview of <effect>".
 */
import type { Effect, ManagedColor } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { useMemo } from 'react';
import { effectGradientEndpoints } from './EffectTypes';

interface EffectPreviewTileProps {
  effect: Effect | undefined;
  label?: string;
}

/** Source-RGB channel colours used when a chromatic effect declares none. */
const FALLBACK_CA_COLORS: readonly ManagedColor[] = [
  { space: 'rgb', r: 255, g: 64, b: 64, a: 255 },
  { space: 'rgb', r: 64, g: 255, b: 128, a: 255 },
  { space: 'rgb', r: 64, g: 214, b: 255, a: 255 },
];

function colorWithOpacity(color: ManagedColor | undefined, opacity = 1): string {
  if (!color) return `rgba(0, 0, 0, ${opacity})`;
  const [r, g, b, a] = managedColorToRgba(color);
  const effectiveAlpha = Math.min(1, Math.max(0, (a / 255) * opacity));
  return `rgba(${r}, ${g}, ${b}, ${effectiveAlpha.toFixed(2)})`;
}

function clampBlurPx(value: number, max = 16): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, value / 2));
}

/**
 * Representative blur amount for the symbolic tile. Field/Iris/Tilt-Shift
 * regions carry their own geometry, so their tile uses the effect's maximum
 * radius when one is declared and a fixed softness otherwise.
 */
function spatialBlurPx(effect: Effect, fallback = 8): number {
  switch (effect.type) {
    case 'gaussianBlur':
      return Math.max(effect.sigmaX, effect.sigmaY);
    case 'fieldBlur':
      return effect.maxRadius ?? fallback;
    case 'pathBlur':
      return effect.amount;
    case 'spinBlur':
      return effect.amount;
    default:
      return fallback;
  }
}

export function EffectPreviewTile({ effect, label }: EffectPreviewTileProps) {
  const style = useMemo<React.CSSProperties>(() => {
    if (!effect?.visible) return {};

    switch (effect.type) {
      case 'dropShadow': {
        const c = colorWithOpacity(effect.color, effect.opacity ?? 1);
        const shadow = `${effect.x}px ${effect.y}px ${effect.blur}px ${effect.spread}px ${c}`;
        return { boxShadow: shadow };
      }
      case 'innerShadow': {
        const c = colorWithOpacity(effect.color, effect.opacity ?? 1);
        const shadow = `inset ${effect.x}px ${effect.y}px ${effect.blur}px ${effect.spread}px ${c}`;
        return { boxShadow: shadow };
      }
      case 'outerGlow': {
        const opacity = effect.opacity ?? 1;
        const blur = effect.blur ?? 8;
        const spread = effect.spread ?? 0;
        const endpoints =
          effect.colorMode === 'gradient' && effect.gradient
            ? effectGradientEndpoints(effect.gradient)
            : null;
        if (endpoints) {
          return {
            boxShadow: `0 0 ${blur}px ${spread}px ${colorWithOpacity(endpoints.start, opacity)}, 0 0 ${Math.round(blur * 1.6)}px ${Math.round(spread * 1.6)}px ${colorWithOpacity(endpoints.end, opacity)}`,
          };
        }
        return {
          boxShadow: `0 0 ${blur}px ${spread}px ${colorWithOpacity(effect.color, opacity)}`,
        };
      }
      case 'innerGlow': {
        const opacity = effect.opacity ?? 1;
        const blur = effect.blur ?? 8;
        const spread = effect.spread ?? 0;
        const endpoints =
          effect.colorMode === 'gradient' && effect.gradient
            ? effectGradientEndpoints(effect.gradient)
            : null;
        if (endpoints) {
          return {
            boxShadow: `inset 0 0 ${blur}px ${spread}px ${colorWithOpacity(endpoints.start, opacity)}, inset 0 0 ${Math.round(blur * 1.6)}px ${Math.round(spread * 1.6)}px ${colorWithOpacity(endpoints.end, opacity)}`,
          };
        }
        return {
          boxShadow: `inset 0 0 ${blur}px ${spread}px ${colorWithOpacity(effect.color, opacity)}`,
        };
      }
      case 'layerBlur': {
        return { filter: `blur(${clampBlurPx(effect.radius)}px)` };
      }
      case 'backgroundBlur': {
        return {
          backdropFilter: `blur(${clampBlurPx(effect.radius)}px)`,
          background: 'rgba(255, 255, 255, 0.2)',
        };
      }
      case 'depthBlur': {
        // A soft focal band: sharp inside the focus interval, soft outside it.
        const softness = clampBlurPx(effect.blurStrength, 14);
        return {
          filter: `blur(${softness}px)`,
          boxShadow: `inset 0 0 ${Math.max(2, effect.blurStrength / 4)}px rgba(255,255,255,0.35)`,
        };
      }
      case 'glassMaterial': {
        const tint = effect.tint
          ? colorWithOpacity(effect.tint, effect.tintOpacity ?? 0.3)
          : 'rgba(255, 255, 255, 0.25)';
        return {
          background: tint,
          backdropFilter: `blur(${Math.min(20, effect.blur / 2)}px)`,
          border: effect.edgeHighlight
            ? `${effect.edgeHighlightWidth ?? 1.5}px solid ${colorWithOpacity(effect.edgeHighlightColor, effect.edgeHighlightOpacity ?? 0.4)}`
            : undefined,
        };
      }
      case 'chromaticAberration': {
        const opacity = (effect.opacity ?? 1) * (effect.mix ?? 1);
        const copies: Array<{ x: number; y: number; color: ManagedColor }> = [];
        if (effect.channelMode === 'custom' && (effect.customChannels?.length ?? 0) > 0) {
          for (const contribution of effect
            .customChannels!.filter((entry) => entry.enabled)
            .slice(0, 3)) {
            copies.push({ x: contribution.x, y: contribution.y, color: contribution.color });
          }
        } else {
          const channelColors = effect.channelColors;
          copies.push(
            {
              x: effect.offsets.redX,
              y: effect.offsets.redY,
              color: channelColors?.red ?? FALLBACK_CA_COLORS[0]!,
            },
            {
              x: effect.offsets.greenX,
              y: effect.offsets.greenY,
              color: channelColors?.green ?? FALLBACK_CA_COLORS[1]!,
            },
            {
              x: effect.offsets.blueX,
              y: effect.offsets.blueY,
              color: channelColors?.blue ?? FALLBACK_CA_COLORS[2]!,
            },
          );
        }
        return {
          color: `rgba(255,255,255,${(0.9 * opacity).toFixed(2)})`,
          textShadow: copies
            .map((copy) => `${copy.x}px ${copy.y}px 0 ${colorWithOpacity(copy.color, opacity)}`)
            .join(', '),
        };
      }
      case 'glitch': {
        const opacity = effect.opacity ?? 1;
        const slice = Math.max(1, Math.min(6, effect.sliceHeight / 4));
        return {
          color: `rgba(255,255,255,${(0.9 * opacity).toFixed(2)})`,
          backgroundImage: `repeating-linear-gradient(0deg, rgba(120,235,255,0.22) 0 ${slice}px, transparent ${slice}px ${slice * 2.5}px), linear-gradient(90deg, rgba(255,64,64,0.28), rgba(64,214,255,0.28))`,
          textShadow: `${Math.min(4, Math.abs(effect.channelShift.redX))}px 0 rgba(255,64,64,0.75), ${-Math.min(4, Math.abs(effect.channelShift.blueX))}px 0 rgba(64,214,255,0.75)`,
          transform: `skewX(${Math.min(4, effect.strength / 12).toFixed(2)}deg)`,
        };
      }
      case 'gaussianBlur':
      case 'fieldBlur':
      case 'irisBlur':
      case 'tiltShiftBlur':
      case 'pathBlur':
      case 'spinBlur': {
        const blur = clampBlurPx(spatialBlurPx(effect));
        if (effect.type === 'tiltShiftBlur') {
          return {
            filter: `blur(${blur}px)`,
            backgroundImage:
              'linear-gradient(180deg, rgba(255,255,255,0.32) 0%, transparent 32%, transparent 68%, rgba(255,255,255,0.32) 100%)',
          };
        }
        if (effect.type === 'spinBlur') {
          return {
            filter: `blur(${blur}px)`,
            backgroundImage:
              'conic-gradient(from 0deg, rgba(255,255,255,0.28), transparent 25%, rgba(255,255,255,0.28) 50%, transparent 75%, rgba(255,255,255,0.28))',
          };
        }
        if (effect.type === 'pathBlur') {
          return {
            filter: `blur(${blur}px)`,
            backgroundImage:
              'linear-gradient(115deg, rgba(255,255,255,0.3) 0%, transparent 45%, rgba(255,255,255,0.3) 100%)',
          };
        }
        if (effect.type === 'irisBlur') {
          return {
            filter: `blur(${blur}px)`,
            backgroundImage:
              'radial-gradient(ellipse at center, transparent 0%, transparent 42%, rgba(255,255,255,0.32) 70%)',
          };
        }
        return { filter: `blur(${blur}px)` };
      }
      default:
        return {};
    }
  }, [effect]);

  return (
    <div
      className="insp-preview-tile"
      role="img"
      aria-label={`Preview of ${label ?? effect?.type ?? 'effect'}`}
    >
      <div className="insp-preview-tile__shape" style={style}>
        <span>{label ?? 'Sample'}</span>
      </div>
    </div>
  );
}
