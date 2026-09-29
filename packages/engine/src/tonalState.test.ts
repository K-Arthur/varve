import { describe, expect, it } from 'vitest';
import { applySoftwareFilter } from './filterCompositor';
import { adjustmentToFilter, makeAdjustment } from './filters';
import { applyTonalCurves } from './tonalCurveFilter';
import { mixerRows } from './tonalState';

describe('retained channel state', () => {
  it('swaps red and blue from the same original pixel through real IR dispatch', () => {
    const adjustment = makeAdjustment('mix', 'channelMixer');
    if (adjustment.kind !== 'channelMixer') throw new Error('wrong factory');
    const rows = mixerRows(adjustment);
    rows.red = { redPercent: 0, greenPercent: 0, bluePercent: 100, constant: 0 };
    rows.blue = { redPercent: 100, greenPercent: 0, bluePercent: 0, constant: 0 };
    const source = new ImageData(new Uint8ClampedArray([21, 90, 180, 120]), 1, 1);
    let output = source;
    const ctx = {
      getImageData: () => source,
      putImageData: (data: ImageData) => {
        output = data;
      },
    };
    applySoftwareFilter(
      ctx as unknown as CanvasRenderingContext2D,
      adjustmentToFilter({ ...adjustment, rows }),
      1,
      1,
    );
    expect(Array.from(output.data)).toEqual([180, 90, 21, 120]);
  });
  it('retains legacy monochrome coefficients regardless of the selected output tab', () => {
    const adjustment = makeAdjustment('legacy', 'channelMixer');
    if (adjustment.kind !== 'channelMixer') throw new Error('wrong factory');
    expect(
      mixerRows({
        ...adjustment,
        outputChannel: 'blue',
        monochrome: true,
        redPercent: 50,
        greenPercent: 50,
        bluePercent: 0,
      }).red,
    ).toEqual({ redPercent: 50, greenPercent: 50, bluePercent: 0, constant: 0 });
  });
  it('retains independent master and component curves after IR lowering', () => {
    const adjustment = makeAdjustment('curve', 'curves');
    if (adjustment.kind !== 'curves') throw new Error('wrong factory');
    const channelPoints = {
      red: [
        { input: 0, output: 255 },
        { input: 255, output: 0 },
      ],
      blue: [
        { input: 0, output: 0 },
        { input: 255, output: 127.5 },
      ],
    };
    const filter = adjustmentToFilter({ ...adjustment, channel: 'green', channelPoints });
    if (filter.kind !== 'curves') throw new Error('wrong IR');
    const output = applyTonalCurves(
      new ImageData(new Uint8ClampedArray([20, 80, 180, 128]), 1, 1),
      filter,
    );
    expect(Array.from(output.data)).toEqual([235, 80, 90, 128]);
    expect(filter.channelPoints).toEqual(channelPoints);
  });
});
