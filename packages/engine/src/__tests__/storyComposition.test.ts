/**
 * Deterministic story composition (M10, ADR-0161): frame ranges derived
 * from real measurement — Latin, CJK, multi-column, insets, overset, and
 * composition-key stability.
 */
import { describe, expect, it } from 'vitest';
import type { StoryContent } from '../storyComposition';
import {
  buildCompositionKey,
  composeStory,
  graphemeCount,
  splitBreakUnits,
  splitGraphemes,
} from '../storyComposition';

function text(content: string): StoryContent {
  return { paragraphs: [{ runs: [{ text: content }] }] };
}

const DEFAULT_FONT = { fontSize: 16, fontFamily: 'sans-serif' };

describe('composeStory (M10)', () => {
  it('flows a short story through one frame with no overset', () => {
    const story = text('Hello world.');
    const result = composeStory({
      storyId: 's1',
      content: story,
      frames: [{ frameId: 'f1', width: 400, height: 300 }],
      defaultFont: DEFAULT_FONT,
    });
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toMatchObject({
      frameId: 'f1',
      startGrapheme: 0,
      endGrapheme: 12,
      overset: false,
    });
    expect(result.oversetGraphemes).toBe(0);
    expect(result.totalGraphemes).toBe(12);
  });

  it('flows into the next frame when the first overflows', () => {
    const story = text(Array.from({ length: 30 }, () => 'word ').join(''));
    const result = composeStory({
      storyId: 's1',
      content: story,
      frames: [
        { frameId: 'f1', width: 200, height: 96 },
        { frameId: 'f2', width: 200, height: 96 },
      ],
      defaultFont: DEFAULT_FONT,
    });
    expect(result.frames[0]!.overset).toBe(true);
    expect(result.frames[1]!.startGrapheme).toBe(result.frames[0]!.endGrapheme);
    expect(result.frames[1]!.overset).toBe(false);
    expect(result.oversetGraphemes).toBe(0);
  });

  it('reports overset when frames run out', () => {
    const story = text(Array.from({ length: 200 }, () => 'word ').join(''));
    const result = composeStory({
      storyId: 's1',
      content: story,
      frames: [{ frameId: 'f1', width: 120, height: 32 }],
      defaultFont: DEFAULT_FONT,
    });
    expect(result.frames[0]!.overset).toBe(true);
    expect(result.oversetGraphemes).toBeGreaterThan(0);
    expect(result.oversetGraphemes + result.frames[0]!.endGrapheme).toBe(result.totalGraphemes);
  });

  it('composes CJK text by cluster without word spaces', () => {
    const story = text('天地玄黄宇宙洪荒日月盈昃辰宿列张');
    const result = composeStory({
      storyId: 's1',
      content: story,
      frames: [{ frameId: 'f1', width: 100, height: 200 }],
      defaultFont: DEFAULT_FONT,
    });
    expect(result.totalGraphemes).toBe(story.paragraphs[0]!.runs[0]!.text.length);
    expect(result.frames[0]!.endGrapheme).toBeLessThanOrEqual(result.totalGraphemes);
    expect(result.frames[0]!.overset).toBe(false);
  });

  it('respects frame insets and multiple columns', () => {
    const story = text(Array.from({ length: 300 }, () => 'word ').join(''));
    const singleColumn = composeStory({
      storyId: 's1',
      content: story,
      frames: [
        {
          frameId: 'f1',
          width: 600,
          height: 300,
          insets: { left: 50, right: 50, top: 20, bottom: 20 },
        },
      ],
      defaultFont: DEFAULT_FONT,
    });
    const twoColumn = composeStory({
      storyId: 's1',
      content: story,
      frames: [{ frameId: 'f1', width: 600, height: 300, columnCount: 2, columnGap: 24 }],
      defaultFont: DEFAULT_FONT,
    });
    // Two columns hold strictly more text than one column with insets.
    expect(twoColumn.frames[0]!.endGrapheme).toBeGreaterThan(singleColumn.frames[0]!.endGrapheme);
  });

  it('emits explicit empty ranges for frames after the story ends', () => {
    const story = text('tiny');
    const result = composeStory({
      storyId: 's1',
      content: story,
      frames: [
        { frameId: 'f1', width: 400, height: 100 },
        { frameId: 'f2', width: 400, height: 100 },
        { frameId: 'f3', width: 400, height: 100 },
      ],
      defaultFont: DEFAULT_FONT,
    });
    expect(result.frames).toHaveLength(3);
    expect(result.frames[1]).toEqual({
      frameId: 'f2',
      startGrapheme: result.totalGraphemes,
      endGrapheme: result.totalGraphemes,
      overset: false,
    });
  });

  it('is deterministic and the composition key tracks layout inputs', () => {
    const story = text('The quick brown fox jumps over the lazy dog.');
    const frames = [
      { frameId: 'f1', width: 300, height: 200 },
      { frameId: 'f2', width: 300, height: 200 },
    ];
    const a = composeStory({ storyId: 's1', content: story, frames, defaultFont: DEFAULT_FONT });
    const b = composeStory({ storyId: 's1', content: story, frames, defaultFont: DEFAULT_FONT });
    expect(a).toEqual(b);
    expect(a.compositionKey).toBe(b.compositionKey);

    const resized = composeStory({
      storyId: 's1',
      content: story,
      frames: [
        { frameId: 'f1', width: 300, height: 200 },
        { frameId: 'f2', width: 600, height: 200 },
      ],
      defaultFont: DEFAULT_FONT,
    });
    expect(resized.compositionKey).not.toBe(a.compositionKey);

    const biggerFont = composeStory({
      storyId: 's1',
      content: story,
      frames,
      defaultFont: { fontSize: 24, fontFamily: 'sans-serif' },
    });
    expect(biggerFont.compositionKey).not.toBe(a.compositionKey);
  });

  it('buildCompositionKey includes content, frames, fonts and version', () => {
    const content = text('abc');
    const frames = [{ frameId: 'f1', width: 100, height: 100 }];
    const key = buildCompositionKey(
      { storyId: 's1', content, frames, defaultFont: DEFAULT_FONT },
      3,
    );
    expect(key).toContain('compose-story/v1');
    expect(key).toContain('f1:100x100:1:0:');
    expect(key).toContain('sans-serif@16');
  });
});

describe('grapheme segmentation helpers', () => {
  it('counts grapheme clusters, not code points, for emoji and combining marks', () => {
    // "e" + combining acute (1 cluster), space (1), family emoji ZWJ (1).
    // Written as escapes so the zero-emoji audit stays clean.
    const s = 'e\u0301 \u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const clusters = splitGraphemes(s);
    expect(clusters).toHaveLength(3);
    expect(graphemeCount({ paragraphs: [{ runs: [{ text: s }] }] })).toBe(clusters.length);
  });

  it('splits words with whitespace preserved for Latin text', () => {
    expect(splitBreakUnits('two words')).toEqual(['two', ' ', 'words']);
  });

  it('breaks CJK per cluster', () => {
    const units = splitBreakUnits('天地玄黄');
    expect(units.join('')).toBe('天地玄黄');
    expect(units.length).toBeGreaterThan(1);
  });
});
