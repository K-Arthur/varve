export const ID_PREFIXES = {
  node: 'n',
  style: 's',
  page: 'p',
  guide: 'g',
  componentProp: 'prop',
  variant: 'var',
  propertySet: 'set',
  variableCollection: 'col',
  variableGroup: 'grp',
  variable: 'v',
  timeline: 'tl',
  track: 'trk',
  keyframe: 'kf',
  stateMachine: 'sm',
  smState: 'st',
  smTransition: 'trn',
  smInput: 'inp',
  library: 'lib',
  booleanResult: 'bool',
  mask: 'msk',
  document: 'doc',
  colorSwatch: 'sw',
  colorStyle: 'cs',
  textStyle: 'ts',
  effectStyle: 'es',
  layoutStyle: 'ls',
} as const;

export type IdNamespace = keyof typeof ID_PREFIXES;

export interface IdGenerator {
  counters: Record<IdNamespace, number>;
}

export function createIdGenerator(): IdGenerator {
  const counters = {} as Record<IdNamespace, number>;
  for (const key of Object.keys(ID_PREFIXES) as IdNamespace[]) {
    counters[key] = 0;
  }
  return { counters };
}

export function generateId(gen: IdGenerator, namespace: IdNamespace): string {
  gen.counters[namespace] += 1;
  return `${ID_PREFIXES[namespace]}${gen.counters[namespace]}`;
}

export function nextId(gen: IdGenerator, namespace: IdNamespace): [string, IdGenerator] {
  const next = gen.counters[namespace] + 1;
  return [`${ID_PREFIXES[namespace]}${next}`, { counters: { ...gen.counters, [namespace]: next } }];
}
