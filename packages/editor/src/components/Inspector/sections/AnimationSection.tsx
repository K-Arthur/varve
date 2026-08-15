/**
 * AnimationSection — animated-media playback controls for a selected
 * animated image node.
 *
 * Appears only when a single node with an animated-media fill is selected;
 * static images gain no dead animation UI. Playback is driven by the media
 * clock (slaved to the motion timeline while it plays); settings changes
 * (loop, speed, offset, trim, poster) are document edits (undoable);
 * playback/scrub state is runtime editor state (never undoable).
 */

import { getMediaRegistry } from '@varve/engine';
import type { Document, SceneNode } from '@varve/scene';
import { getAnimatedMediaFill } from '@varve/scene';
import { defaultMediaFillSettings, type MediaLoopMode } from '@varve/shared';
import { Button, Select, Tooltip } from '@varve/ui';
import { useCallback, useMemo } from 'react';
import { useEditor } from '../../../context';
import { MediaFrameStrip } from '../../../timeline/MediaFrameStrip';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import type { SectionId } from '../sectionRegistry';

const LOOP_OPTIONS: Array<{ value: MediaLoopMode; label: string }> = [
  { value: 'source', label: 'Source' },
  { value: 'once', label: 'Once' },
  { value: 'loop', label: 'Loop' },
  { value: 'pingpong', label: 'Ping-pong' },
];

interface AnimationSectionProps {
  nodes: SceneNode[];
  sectionId?: SectionId;
}

export function AnimationSection({ nodes, sectionId }: AnimationSectionProps) {
  const editor = useEditor();
  const node = nodes[0];
  const fill = node ? getAnimatedMediaFill(node, editor.state.document) : undefined;
  const assetId = fill?.image?.assetId;
  const asset = assetId ? editor.state.document?.assets?.[assetId] : undefined;

  const session = assetId ? getMediaRegistry().get(assetId) : undefined;
  const timing = session?.timing;

  const media = useMemo(() => editor.state.media, [editor.state.media]);
  const animated = asset?.animated;
  const settings = fill?.image?.media ?? defaultMediaFillSettings();

  const updateSettings = useCallback(
    (patch: Partial<typeof settings>) => {
      if (!node || !fill) return;
      editor.updateDoc((doc) => {
        const target = doc.nodes[node.id];
        if (target?.kind !== 'shape' || !target.fills) return doc;
        const next = target.fills.map((f, i) => {
          if (i !== fillIndex(fill, target.fills)) return f;
          const image = f.image;
          if (!image) return f;
          return {
            ...f,
            image: {
              ...image,
              media: { ...(image.media ?? defaultMediaFillSettings()), ...patch },
            },
          };
        });
        return {
          ...doc,
          nodes: { ...doc.nodes, [node.id]: { ...target, fills: next } },
        } as Document;
      });
    },
    [editor, node?.id, fill],
  );

  const inPoint = settings.inPointMs;
  const outPoint = settings.outPointMs > 0 ? settings.outPointMs : (animated?.durationMs ?? 0);

  const step = useCallback(
    (direction: 1 | -1) => {
      editor.stepMediaFrame(direction);
    },
    [editor],
  );

  if (!node || nodes.length !== 1 || !fill?.image || !animated || !session || !timing) {
    return null;
  }

  return (
    <DisclosureSection title="Animation" sectionId={sectionId ?? 'animation'} defaultExpanded>
      <div className="animation-section">
        <div className="animation-section__meta">
          <span>
            Duration {formatMs(animated.durationMs)} · {animated.frameCount} frames
          </span>
          <span className="animation-section__kind">{animated.kind.toUpperCase()}</span>
        </div>

        <MediaFrameStrip
          timing={timing}
          frameCount={animated.frameCount}
          currentTimeMs={media.currentTime}
          isPlaying={media.isPlaying}
          onScrub={editor.seekMedia}
          onTogglePlay={editor.toggleMedia}
          onStep={step}
          ariaLabel={`Animation scrubber: ${animated.frameCount} frames, ${formatMs(animated.durationMs)}`}
        />

        <FieldRow label="Loop">
          <Select
            label="Loop mode"
            value={settings.loopMode}
            onChange={(value) => updateSettings({ loopMode: value as MediaLoopMode })}
            options={LOOP_OPTIONS}
          />
        </FieldRow>

        <FieldRow label="Speed">
          <NumberField
            label="Speed"
            value={settings.rate}
            min={-8}
            max={8}
            step={0.1}
            onChange={(value) => updateSettings({ rate: value })}
          />
        </FieldRow>

        <FieldRow label="Start offset">
          <NumberField
            label="Start offset"
            value={settings.startOffsetMs}
            min={0}
            step={10}
            onChange={(value) => updateSettings({ startOffsetMs: value })}
          />
          <span className="animation-section__unit">ms</span>
        </FieldRow>

        <FieldRow label="In / Out">
          <NumberField
            label="In point"
            value={inPoint}
            min={0}
            max={outPoint}
            step={10}
            onChange={(value) => updateSettings({ inPointMs: value })}
          />
          <span className="animation-section__unit">–</span>
          <NumberField
            label="Out point"
            value={outPoint}
            min={inPoint}
            max={animated.durationMs}
            step={10}
            onChange={(value) => updateSettings({ outPointMs: value })}
          />
          <span className="animation-section__unit">ms</span>
        </FieldRow>

        <FieldRow label="Poster frame">
          <NumberField
            label="Poster frame"
            value={settings.posterFrame}
            min={0}
            max={animated.frameCount - 1}
            step={1}
            onChange={(value) => updateSettings({ posterFrame: Math.round(value) })}
          />
          <Tooltip label="Frame shown in static exports and thumbnails">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => updateSettings({ posterFrame: frameAt(media.currentTime, timing) })}
            >
              Use current
            </Button>
          </Tooltip>
        </FieldRow>
      </div>
    </DisclosureSection>
  );
}

function fillIndex(
  fill: { image?: { assetId?: string } },
  fills: import('@varve/scene').Fill[] | undefined,
): number {
  return (fills ?? []).findIndex(
    (f) => f?.type === 'image' && f.image?.assetId === fill.image?.assetId,
  );
}

function frameAt(timeMs: number, timing: { cum: Float64Array; frameCount: number }): number {
  for (let i = timing.frameCount - 1; i >= 0; i--) {
    if (timing.cum[i]! <= timeMs) return i;
  }
  return 0;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
