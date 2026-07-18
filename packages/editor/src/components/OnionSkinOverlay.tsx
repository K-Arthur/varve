/**
 * Onion skin overlay — ghosted previous/next frame previews for animation.
 *
 * Renders translucent overlays of frames before and after the current playhead
 * position, helping animators see motion trajectories and maintain spacing.
 *
 * Research basis: Adobe Animate onion skinning, Toon Boom Harmony,
 * Blender onion skinning (range + color per direction).
 */

import type { Affine, SceneNode as EngineNode, ReplayTarget } from '@strata/engine';
import { createEngine, replayIr } from '@strata/engine';
import type { Document, SceneNode, Timeline } from '@strata/scene';
import { buildParentIndexMap, isContainer } from '@strata/scene';
import { useEffect, useRef } from 'react';
import { useEditor } from '../context';
import { sceneNodeToEngineNode } from '../render/sceneToEngine';
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
  _doc: unknown,
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
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (renderedRef.current === time) return;
    renderedRef.current = time;

    let cancelled = false;

    const render = async () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvasSize.width * dpr;
      canvas.height = canvasSize.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

      const sample = sampleTimeline(timeline, time);
      const eng = await createEngine('stub');
      const parentIndex = buildParentIndexMap(doc);
      const nodes: EngineNode[] = [];

      for (const [nodeId, overrides] of sample.overrides) {
        const node = doc.nodes[nodeId];
        if (!node || isContainer(node)) continue;
        const worldTransform = nodeWorldTransform(doc, nodeId, parentIndex);
        const engineNode = toEngineNodeForOnion(node, overrides, worldTransform, doc);
        if (engineNode) nodes.push(engineNode);
      }

      const ir = await eng.buildIr({ nodes });
      if (cancelled) return;

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.translate(canvasSize.width / 2, canvasSize.height / 2);
      ctx.translate(pan.x * zoom, pan.y * zoom);
      ctx.scale(zoom, zoom);

      const tintR = tint[0] / 255;
      const tintG = tint[1] / 255;
      const tintB = tint[2] / 255;

      const _originalFill = ctx.fillStyle;
      for (const item of ir) {
        if (item.fill) {
          ctx.fillStyle = `rgba(${Math.round(tintR * 255)},${Math.round(tintG * 255)},${Math.round(tintB * 255)},0.6)`;
        }
      }

      replayIr(ctx as unknown as ReplayTarget, ir);

      ctx.fillStyle = _originalFill;
      ctx.restore();
      ctx.globalAlpha = 1;
    };

    render();

    return () => {
      cancelled = true;
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
  worldTransform: Affine,
  doc: Document,
): EngineNode | null {
  if (isContainer(node)) return null;

  const engineNode = sceneNodeToEngineNode(node, {}, doc) as EngineNode & Record<string, unknown>;
  engineNode.transform = worldTransform;
  engineNode.opacity = (overrides.get('opacity') as number | undefined) ?? engineNode.opacity ?? 1;

  const transformOverride = overrides.get('transform');
  if (transformOverride && Array.isArray(transformOverride) && transformOverride.length === 6) {
    engineNode.transform = transformOverride as unknown as Affine;
  }

  const rotationOverride = overrides.get('rotation');
  if (typeof rotationOverride === 'number') {
    const [a, b, c, d, e, f] = engineNode.transform;
    const t: [number, number, number, number, number, number] = [a, b, c, d, e, f];
    const rad = rotationOverride * (Math.PI / 180);
    t[0] = Math.cos(rad);
    t[1] = Math.sin(rad);
    t[2] = -Math.sin(rad);
    t[3] = Math.cos(rad);
    engineNode.transform = t;
  }

  for (const [prop, value] of overrides) {
    if (prop === 'opacity' || prop === 'transform' || prop === 'rotation') continue;
    engineNode[prop] = value;
  }

  return engineNode as EngineNode;
}
