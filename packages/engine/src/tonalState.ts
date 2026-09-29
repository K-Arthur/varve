import type { ChannelMixerAdjustment, ChannelMixerRow, CurvesAdjustment } from './filters';

export function mixerRows(
  value: Pick<
    ChannelMixerAdjustment,
    'rows' | 'outputChannel' | 'redPercent' | 'greenPercent' | 'bluePercent' | 'constant'
  > &
    Partial<Pick<ChannelMixerAdjustment, 'monochrome'>>,
): Record<'red' | 'green' | 'blue', ChannelMixerRow> {
  if (value.rows) return value.rows;
  const rows = {
    red: { redPercent: 100, greenPercent: 0, bluePercent: 0, constant: 0 },
    green: { redPercent: 0, greenPercent: 100, bluePercent: 0, constant: 0 },
    blue: { redPercent: 0, greenPercent: 0, bluePercent: 100, constant: 0 },
  };
  rows[value.monochrome ? 'red' : value.outputChannel] = {
    redPercent: value.redPercent,
    greenPercent: value.greenPercent,
    bluePercent: value.bluePercent,
    constant: value.constant,
  };
  return rows;
}

export function curveChannels(
  value: Pick<CurvesAdjustment, 'channelPoints' | 'channel' | 'points'>,
): NonNullable<CurvesAdjustment['channelPoints']> {
  return value.channelPoints ?? { [value.channel]: value.points };
}
