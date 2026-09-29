/** Straight encoded RGB component coverage multiplied by alpha. Alpha
 * snapshots use coverage directly; hidden RGB cannot select invisible pixels. */
export function channelCoverage(
  source: { data: Uint8ClampedArray; width: number; height: number },
  channel: 'red' | 'green' | 'blue' | 'alpha',
  invert = false,
): Uint8Array {
  const component = { red: 0, green: 1, blue: 2, alpha: 3 }[channel];
  const coverage = new Uint8Array(source.width * source.height);
  for (let i = 0; i < coverage.length; i++) {
    const alpha = source.data[i * 4 + 3]!;
    const value = source.data[i * 4 + component]!;
    coverage[i] =
      component === 3
        ? invert
          ? 255 - value
          : value
        : Math.round(((invert ? 255 - value : value) * alpha) / 255);
  }
  return coverage;
}
