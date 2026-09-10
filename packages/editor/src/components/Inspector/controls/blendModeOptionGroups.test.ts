import { describe, expect, it } from 'vitest';
import { groupBlendOptions } from './blendModeOptionGroups';

describe('groupBlendOptions', () => {
  it('clusters known blend modes into the standard families, in a stable order', () => {
    const options = [
      { value: 'normal', label: 'Normal' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' },
      { value: 'difference', label: 'Difference' },
      { value: 'hue', label: 'Hue' },
    ];
    const groups = groupBlendOptions(options);
    expect(groups.map((g) => g.label)).toEqual([
      'Normal',
      'Darken',
      'Lighten',
      'Contrast',
      'Comparative',
      'Component',
    ]);
    expect(groups.find((g) => g.label === 'Normal')?.options).toEqual([options[0]]);
    expect(groups.find((g) => g.label === 'Darken')?.options).toEqual([options[1]]);
  });

  it('preserves every input option exactly once, including extras not in the standard set', () => {
    const options = [
      { value: 'normal', label: 'Normal' },
      { value: 'plusDarker', label: 'Plus Darker' },
      { value: 'plusLighter', label: 'Plus Lighter' },
      { value: 'somethingNew', label: 'Something New' },
    ];
    const groups = groupBlendOptions(options);
    const flattened = groups.flatMap((g) => g.options);
    expect(flattened).toHaveLength(options.length);
    expect(flattened).toEqual(expect.arrayContaining(options));
    // An unrecognized value lands in a trailing "Other" group instead of
    // being silently dropped.
    expect(groups.at(-1)?.label).toBe('Other');
    expect(groups.at(-1)?.options).toEqual([options[3]]);
  });

  it('omits empty groups', () => {
    const groups = groupBlendOptions([{ value: 'normal', label: 'Normal' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Normal');
  });

  it('returns no groups for an empty input', () => {
    expect(groupBlendOptions([])).toEqual([]);
  });
});
