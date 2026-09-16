/**
 * EffectPreviewTile — a live visual swatch rendered inside effect popovers.
 * Provides immediate visual feedback of shadow/glow contour, blur softness,
 * or glass translucency as parameters are adjusted.
 */
import type { Effect, ManagedColor } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { useMemo } from 'react';

interface EffectPreviewTileProps {
  effect: Effect | undefined;
  label?: string;
}

function colorWithOpacity(color: ManagedColor | undefined, opacity = 1): string {
  if (!color) return `rgba(0, 0, 0, ${opacity})`;
  const [r, g, b, a] = managedColorToRgba(color);
  const effectiveAlpha = Math.min(1, Math.max(0, (a / 255) * opacity));
  return `rgba(${r}, ${g}, ${b}, ${effectiveAlpha.toFixed(2)})`;
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
        const c = colorWithOpacity(effect.color, effect.opacity ?? 1);
        const blur = (effect.choke ?? 0) + (effect.spread ?? 12);
        return { boxShadow: `0 0 ${blur}px ${effect.spread ?? 2}px ${c}` };
      }
      case 'innerGlow': {
        const c = colorWithOpacity(effect.color, effect.opacity ?? 1);
        const blur = (effect.choke ?? 0) + (effect.spread ?? 8);
        return { boxShadow: `inset 0 0 ${blur}px ${effect.spread ?? 2}px ${c}` };
      }
      case 'layerBlur': {
        return { filter: `blur(${Math.min(16, effect.radius / 2)}px)` };
      }
      case 'backgroundBlur': {
        return {
          backdropFilter: `blur(${Math.min(16, effect.radius / 2)}px)`,
          background: 'rgba(255, 255, 255, 0.2)',
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
