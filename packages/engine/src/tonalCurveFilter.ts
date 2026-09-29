import { compileCurve } from './adjustment/curves';
import type { FilterIR } from './types';

/** Master components first, individual components second; alpha untouched. */
export function applyTonalCurves(
  source: ImageData,
  filter: Extract<FilterIR, { kind: 'curves' }>,
): ImageData {
  const channels = filter.channelPoints ?? { [filter.channel]: filter.points };
  const algorithm = filter.algorithmVersion === 2 ? 'pchip' : 'legacy';
  const curves = Object.fromEntries(
    Object.entries(channels).map(([channel, points]) => [
      channel,
      compileCurve(
        points.map((point) => ({ x: point.input / 255, y: point.output / 255 })),
        algorithm,
      ),
    ]),
  );
  // Keep the master result floating until the component transfer is finished.
  // Only the final RGBA8 surface quantizes; the hot loop uses compiled tables.
  const tables = ['red', 'green', 'blue'].map((channel) =>
    Uint8Array.from({ length: 256 }, (_, input) => {
      let master = curves.rgb?.(input / 255) ?? input / 255;
      if (algorithm === 'legacy') master = Math.round(master * 255) / 255;
      return Math.round((curves[channel]?.(master) ?? master) * 255);
    }),
  );
  const output = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  for (let i = 0; i < source.data.length; i += 4) {
    if (source.data[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      const input = source.data[i + c]!;
      output.data[i + c] = tables[c]![input]!;
    }
  }
  return output;
}
