/**
 * Onion skin overlay — ghosted previous/next frame previews for animation.
 *
 * Renders translucent overlays of frames before and after the current playhead
 * position, helping animators see motion trajectories and maintain spacing.
 *
 * Research basis: Adobe Animate onion skinning, Toon Boom Harmony,
 * Blender onion skinning (range + color per direction).
 */

import type { ReplayTarget } from '@strata/engine';
import { createEngine, replayIr } from '@strata/engine';
import type { Document, SceneNode, Timeline } from '@strata/scene';
import { buildParentIndexMap, isContainer } from '@strata/scene';
import { useEffect, useRef } from 'react';
import { useEditor } from '../context';
import { nodeWorldTransform } from '../scene/world';
import { sampleTimeline } from '../timeline/TimelineSampler';

export interface OnionSkinState {
  enabled: boolean;
  beforeCount: number;
  afterCount: number;
  opacity: number;
  beforeTint: [number, number, number];
  afterTint: [number, number, number];
}

export const DEFAULT_ONION_SKIN: OnionSkinState = {
  enabled: false,
  beforeCount: 3,
  afterCount: 3,
  opacity: 0.25,
  beforeTint: [255, 100, 100],
  afterTint: [100, 200, 100],
};

export function getOnionSkinFrames(
  _doc: Document,
  timeline: Timeline,
  currentTime: number,
  state: OnionSkinState,
): { before: number[]; after: number[] } {
  if (!state.enabled || timeline.duration <= 0) {
    return { before: [], after: [] };
  }

  const fps = 60;
  const frameDuration = 1000 / fps;
  const currentFrame = Math.round(currentTime / frameDuration);
  const totalFrames = Math.round(timeline.duration / frameDuration);

  const before: number[] = [];
  const after: number[] = [];

  for (let i = 1; i <= state.beforeCount; i++) {
    const frame = currentFrame - i;
    if (frame >= 0) {
      before.push(frame * frameDuration);
    }
  }

  for (let i = 1; i <= state.afterCount; i++) {
    const frame = currentFrame + i;
    if (frame <= totalFrames) {
      after.push(frame * frameDuration);
    }
  }

  return { before: before.reverse(), after };
}

interface OnionSkinOverlayProps {
  canvasSize: { width: number; height: number };
  zoom: number;
  pan: { x: number; y: number };
}

export function OnionSkinOverlay({ canvasSize, zoom, pan }: OnionSkinOverlayProps) {
  const editor = useEditor();
  const { state } = editor;
  const isMotionWorkspace = state.workspaceMode === 'motion';
  const motion = state.motion;
  const onionSkin: OnionSkinState = {
    enabled: motion?.onionSkinEnabled ?? false,
    beforeCount: motion?.onionSkinBeforeCount ?? DEFAULT_ONION_SKIN.beforeCount,
    afterCount: motion?.onionSkinAfterCount ?? DEFAULT_ONION_SKIN.afterCount,
    opacity: motion?.onionSkinOpacity ?? DEFAULT_ONION_SKIN.opacity,
    beforeTint: DEFAULT_ONION_SKIN.beforeTint,
    afterTint: DEFAULT_ONION_SKIN.afterTint,
  };

  if (!onionSkin?.enabled || !isMotionWorkspace) return null;

  const timelineId = state.motion.activeTimelineId;
  const timeline = timelineId ? state.document.timelines?.[timelineId] : null;
  if (!timeline) return null;

  const { before, after } = getOnionSkinFrames(
    state.document,
    timeline,
    state.motion.currentTime,
    onionSkin,
  );

  return (
    <div
      className="onion-skin-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      {before.map((time, i) => (
        <OnionSkinFrame
          key={`before-${Math.round(time)}`}
          doc={state.document}
          timeline={timeline}
          time={time}
          opacity={onionSkin.opacity * (1 - (i + 1) / (onionSkin.beforeCount + 1))}
          tint={onionSkin.beforeTint}
          canvasSize={canvasSize}
          zoom={zoom}
          pan={pan}
          label={`-${before.length - i}`}
        />
      ))}
      {after.map((time, i) => (
        <OnionSkinFrame
          key={`after-${Math.round(time)}`}
          doc={state.document}
          timeline={timeline}
          time={time}
          opacity={onionSkin.opacity * (1 - (i + 1) / (onionSkin.afterCount + 1))}
          tint={onionSkin.afterTint}
          canvasSize={canvasSize}
          zoom={zoom}
          pan={pan}
          label={`+${i + 1}`}
        />
      ))}
    </div>
  );
}

interface OnionSkinFrameProps {
  doc: Document;
  timeline: Timeline;
  time: number;
  opacity: number;
  tint: [number, number, number];
  canvasSize: { width: number; height: number };
  zoom: number;
  pan: { x: number; y: number };
  label?: string;
}

function OnionSkinFrame({
  doc,
  timeline,
  time,
  opacity,
  tint,
  canvasSize,
  zoom,
  pan,
  label: _label,
}: OnionSkinFrameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderedRef = useRef<number | null>(null);

  useEffect(() => {
    if (renderedRef.current === time) return;
    renderedRef.current = time;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    const sample = sampleTimeline(timeline, time);
    const eng = createEngine('stub');
    const parentIndex = buildParentIndexMap(doc);
    const nodes: import('@strata/engine').SceneNode[] = [];

    for (const [nodeId, overrides] of sample.overrides) {
      const node = doc.nodes[nodeId];
      if (!node || isContainer(node as unknown as SceneNode)) continue;
      const worldTransform = nodeWorldTransform(doc, nodeId, parentIndex);
      const engineNode = toEngineNodeForOnion(
        node as unknown as SceneNode,
        overrides,
        worldTransform,
      );
      if (engineNode) nodes.push(engineNode);
    }

    const ir = eng.buildIr({ nodes });
    ctx.save();

    ctx.globalAlpha = opacity;
    ctx.translate(canvasSize.width / 2, canvasSize.height / 2);
    ctx.translate(pan.x * zoom, pan.y * zoom);
    ctx.scale(zoom, zoom);

    const tintR = tint[0] / 255;
    const tintG = tint[1] / 255;
    const tintB = tint[2] / 255;

    const tintedTarget: ReplayTarget = {
      ...ctx,
      drawImage: ctx.drawImage.bind(ctx),
      createPattern: (img: CanvasImageSource, repetition: string) =>
        ctx.createPattern(img, repetition as RepeatMode)!,
      roundRect: (
        x: number,
        y: number,
        w: number,
        h: number,
        radii: number | DOMPointInit | Iterable<number | DOMPointInit>,
      ) => {
        ctx.roundRect(x, y, w, h, radii);
      },
      fillText: (text: string, x: number, y: number, maxWidth?: number) => {
        ctx.fillText(text, x, y, maxWidth);
      },
    };

    const _originalFill = ctx.fillStyle;
    for (const item of ir) {
      if (item.fill) {
        ctx.fillStyle = `rgba(${Math.round(tintR * 255)},${Math.round(tintG * 255)},${Math.round(tintB * 255)},0.6)`;
      }
    }

    replayIr(tintedTarget, ir);

    ctx.restore();
    ctx.globalAlpha = 1;

    return () => {
      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    };
  }, [doc, timeline, time, opacity, tint, canvasSize, zoom, pan]);

  return (
    <canvas
      ref={canvasRef}
      className="onion-skin-frame"
      style={{
        position: 'absolute',
        inset: 0,
        width: canvasSize.width,
        height: canvasSize.height,
        pointerEvents: 'none',
      }}
    />
  );
}

function toEngineNodeForOnion(
  node: SceneNode,
  overrides: Map<string, unknown>,
  worldTransform: number[] | null,
): import('@strata/engine').SceneNode | null {
  const engineNode: import('@strata/engine').SceneNode & Record<string, unknown> = {
    id: node.id,
    kind: node.kind,
    transform: node.transform ?? [1, 0, 0, 1, 0, 0],
    opacity: node.opacity ?? 1,
    blendMode: node.blendMode ?? 'normal',
  };

  if ('w' in node) engineNode.w = (node as Record<string, unknown>).w;
  if ('h' in node) engineNode.h = (node as Record<string, unknown>).h;
  if ('cornerRadius' in node)
    engineNode.cornerRadius = (node as Record<string, unknown>).cornerRadius;
  if ('shape' in node) engineNode.shape = (node as Record<string, unknown>).shape;
  if ('fill' in node) engineNode.fill = (node as Record<string, unknown>).fill;
  if ('stroke' in node) engineNode.stroke = (node as Record<string, unknown>).stroke;
  if ('text' in node) engineNode.text = (node as Record<string, unknown>).text;
  if ('fontSize' in node) engineNode.fontSize = (node as Record<string, unknown>).fontSize;
  if ('fontFamily' in node) engineNode.fontFamily = (node as Record<string, unknown>).fontFamily;

  if (worldTransform) {
    engineNode.transform = worldTransform;
  }

  for (const [prop, value] of overrides) {
    if (prop === 'opacity') engineNode.opacity = value as number;
    else if (prop === 'transform' && Array.isArray(value)) engineNode.transform = value as number[];
    else if (prop === 'rotation') {
      const t = [...((engineNode.transform as number[]) || [1, 0, 0, 1, 0, 0])];
      const rad = (value as number) * (Math.PI / 180);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      t[0] = cos;
      t[1] = sin;
      t[2] = -sin;
      t[3] = cos;
      engineNode.transform = t;
    } else engineNode[prop] = value;
  }

  return engineNode as unknown as import('@strata/engine').SceneNode;
}
