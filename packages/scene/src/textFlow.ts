/**
 * Text flow chain operations — linked text frames with overset detection.
 *
 * Chains connect text frames so content flows from one to the next when
 * a frame overflows. This mirrors InDesign's threaded text frames.
 *
 * Research basis: Adobe InDesign threading text frames.
 */

import type { NodeId } from './types';
import type { OversetInfo, RichText } from './typography';

export function createChain(
  id: string,
  name: string,
  frameIds: NodeId[] = [],
): import('./typography').TextChain {
  return { id, name, frameIds: [...frameIds] };
}

export function appendFrame(
  chain: import('./typography').TextChain,
  frameId: NodeId,
): import('./typography').TextChain {
  if (chain.frameIds.includes(frameId)) return chain;
  return { ...chain, frameIds: [...chain.frameIds, frameId] };
}

export function insertFrame(
  chain: import('./typography').TextChain,
  frameId: NodeId,
  afterFrameId?: NodeId,
): import('./typography').TextChain {
  if (chain.frameIds.includes(frameId)) return chain;
  if (!afterFrameId) {
    return { ...chain, frameIds: [frameId, ...chain.frameIds] };
  }
  const idx = chain.frameIds.indexOf(afterFrameId);
  if (idx === -1) return appendFrame(chain, frameId);
  const frameIds = [...chain.frameIds];
  frameIds.splice(idx + 1, 0, frameId);
  return { ...chain, frameIds };
}

export function removeFrame(
  chain: import('./typography').TextChain,
  frameId: NodeId,
): import('./typography').TextChain {
  return { ...chain, frameIds: chain.frameIds.filter((id) => id !== frameId) };
}

export function reorderFrame(
  chain: import('./typography').TextChain,
  frameId: NodeId,
  newIndex: number,
): import('./typography').TextChain {
  const idx = chain.frameIds.indexOf(frameId);
  if (idx === -1) return chain;
  const frameIds = [...chain.frameIds];
  frameIds.splice(idx, 1);
  const clamped = Math.max(0, Math.min(newIndex, frameIds.length));
  frameIds.splice(clamped, 0, frameId);
  return { ...chain, frameIds };
}

export function isChainHead(chain: import('./typography').TextChain, frameId: NodeId): boolean {
  return chain.frameIds[0] === frameId;
}

export function isChainTail(chain: import('./typography').TextChain, frameId: NodeId): boolean {
  return chain.frameIds[chain.frameIds.length - 1] === frameId;
}

export function nextFrame(
  chain: import('./typography').TextChain,
  frameId: NodeId,
): NodeId | undefined {
  const idx = chain.frameIds.indexOf(frameId);
  if (idx === -1 || idx === chain.frameIds.length - 1) return undefined;
  return chain.frameIds[idx + 1];
}

export function previousFrame(
  chain: import('./typography').TextChain,
  frameId: NodeId,
): NodeId | undefined {
  const idx = chain.frameIds.indexOf(frameId);
  if (idx <= 0) return undefined;
  return chain.frameIds[idx - 1];
}

export function detectOverset(
  chain: import('./typography').TextChain,
  frameId: NodeId,
  fittedChars: number,
  totalChars: number,
): OversetInfo | undefined {
  if (totalChars <= fittedChars) return undefined;
  const isLast = isChainTail(chain, frameId);
  if (!isLast) return undefined;
  return {
    chainId: chain.id,
    frameId,
    oversetChars: totalChars - fittedChars,
    isLastFrame: true,
  };
}

export function splitRichTextByCharLimit(
  rich: RichText,
  charLimit: number,
): { fitted: RichText; overset: RichText } {
  let charCount = 0;
  const fittedParas: typeof rich.paragraphs = [];
  const oversetParas: typeof rich.paragraphs = [];

  for (const para of rich.paragraphs) {
    const paraText = para.runs.map((r) => r.text).join('');
    const paraLen = paraText.length;

    if (charCount + paraLen <= charLimit) {
      fittedParas.push(para);
      charCount += paraLen;
    } else {
      const remaining = charLimit - charCount;
      if (remaining > 0) {
        let consumed = 0;
        const fittedRuns: typeof para.runs = [];
        const oversetRuns: typeof para.runs = [];
        for (const run of para.runs) {
          if (consumed >= remaining) {
            oversetRuns.push(run);
            continue;
          }
          if (consumed + run.text.length <= remaining) {
            fittedRuns.push(run);
            consumed += run.text.length;
          } else {
            const split = remaining - consumed;
            fittedRuns.push({ ...run, text: run.text.slice(0, split) });
            oversetRuns.push({ ...run, text: run.text.slice(split) });
            consumed = remaining;
          }
        }
        fittedParas.push({ ...para, runs: fittedRuns });
        oversetParas.push({ ...para, runs: oversetRuns });
      } else {
        oversetParas.push(para);
      }
      charCount = charLimit;
    }
  }

  return { fitted: { paragraphs: fittedParas }, overset: { paragraphs: oversetParas } };
}
