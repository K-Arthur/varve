import type { FontSearchReason, FontSemanticRecord } from './semanticTypes';

export type FontSimilarityIntent =
  | 'visually-closest'
  | 'similar-mood'
  | 'similar-construction'
  | 'same-role'
  | 'metric-compatible';
export type FontAlternativeMode =
  | 'closest-appearance'
  | 'least-reflow'
  | 'open-source'
  | 'installed-only';
export type FontPairingIntent = 'harmonious' | 'contrasting' | 'restrained' | 'expressive';

export interface FontRecommendation<T extends FontSemanticRecord = FontSemanticRecord> {
  record: T;
  score: number;
  reasons: FontSearchReason[];
}

function visualFeatures(
  record: FontSemanticRecord,
): Array<[keyof FontSemanticRecord['profile']['visualFeatures'], number]> {
  return Object.entries(record.profile.visualFeatures).filter(
    (entry): entry is [keyof FontSemanticRecord['profile']['visualFeatures'], number] =>
      typeof entry[1] === 'number',
  );
}

function tagSet(record: FontSemanticRecord): Set<string> {
  return new Set(
    record.profile.assignments
      .filter(
        (assignment) => assignment.scope !== 'artifact' && !assignment.tagId.startsWith('source.'),
      )
      .map((assignment) => assignment.tagId),
  );
}

function sharedTags(a: FontSemanticRecord, b: FontSemanticRecord): string[] {
  const other = tagSet(b);
  return [...tagSet(a)].filter((tag) => other.has(tag));
}

function featureDistance(a: FontSemanticRecord, b: FontSemanticRecord): number | undefined {
  const bFeatures = new Map(visualFeatures(b));
  const distances: number[] = [];
  for (const [key, value] of visualFeatures(a)) {
    const other = bFeatures.get(key);
    if (other === undefined) continue;
    const scale =
      key.includes('Ratio') || key === 'widthRatio'
        ? 1
        : key.includes('Angle')
          ? 90
          : key.includes('Weight')
            ? 900
            : 1;
    distances.push(Math.min(Math.abs(value - other) / scale, 1));
  }
  return distances.length > 0
    ? distances.reduce((sum, value) => sum + value, 0) / distances.length
    : undefined;
}

function reason(
  label: string,
  kind: FontSearchReason['kind'],
  provenance = 'local semantic profile',
): FontSearchReason {
  return { kind, label, provenance };
}

function sortRecommendations(a: FontRecommendation, b: FontRecommendation): number {
  return (
    b.score - a.score ||
    a.record.familyName.localeCompare(b.record.familyName) ||
    a.record.familyId.localeCompare(b.record.familyId)
  );
}

/** Visual/structural similarity. Same-family duplicates are excluded. */
export function findSimilarFonts(
  target: FontSemanticRecord,
  candidates: readonly FontSemanticRecord[],
  options: { intent?: FontSimilarityIntent; limit?: number } = {},
): FontRecommendation[] {
  const intent = options.intent ?? 'visually-closest';
  const targetTags = tagSet(target);
  return candidates
    .filter(
      (candidate) =>
        candidate.familyId !== target.familyId && candidate.familyName !== target.familyName,
    )
    .map((candidate) => {
      const shared = sharedTags(target, candidate);
      const distance = featureDistance(target, candidate);
      const coverage =
        target.scripts.length > 0 &&
        target.scripts.some((script) => candidate.scripts.includes(script))
          ? 0.12
          : 0;
      const tagScore = targetTags.size > 0 ? shared.length / targetTags.size : 0;
      const metricScore = distance === undefined ? 0.25 : 1 - distance;
      const toneScore = shared.filter((tag) => tag.startsWith('tone.')).length * 0.08;
      const constructionScore =
        shared.filter((tag) => tag.startsWith('classification.')).length * 0.16;
      const roleScore = shared.filter((tag) => tag.startsWith('use.')).length * 0.08;
      let score =
        tagScore * 0.34 + metricScore * 0.32 + coverage + toneScore + constructionScore + roleScore;
      if (intent === 'similar-mood') score = toneScore * 3 + tagScore * 0.45 + metricScore * 0.2;
      if (intent === 'similar-construction')
        score = constructionScore * 3 + metricScore * 0.35 + coverage;
      if (intent === 'same-role') score = roleScore * 3 + tagScore * 0.35 + coverage;
      if (intent === 'metric-compatible') score = metricScore * 0.7 + tagScore * 0.2 + coverage;
      const reasons: FontSearchReason[] = [];
      for (const tag of shared.slice(0, 3))
        reasons.push(
          reason(
            `Shared ${tag.split('.').at(-1)?.replaceAll('-', ' ') ?? 'semantic trait'}`,
            tag.startsWith('classification.')
              ? 'semantic-tag'
              : tag.startsWith('use.')
                ? 'use-case'
                : 'similarity',
          ),
        );
      if (distance !== undefined)
        reasons.push(
          reason('Similar measured proportions', 'visual-feature', 'local font measurements'),
        );
      if (coverage > 0)
        reasons.push(reason('Overlapping script coverage', 'coverage', 'local coverage metadata'));
      return { record: candidate, score, reasons };
    })
    .filter((result) => result.score > 0)
    .sort(sortRecommendations)
    .slice(0, options.limit ?? 8);
}

function compatibleScripts(target: FontSemanticRecord, candidate: FontSemanticRecord): boolean {
  if (target.scripts.length === 0 || candidate.scripts.length === 0) return true;
  return target.scripts.every((script) => candidate.scripts.includes(script));
}

/** Metric-aware replacement ranking used by missing-font and export workflows. */
export function findFontAlternatives(
  target: FontSemanticRecord,
  candidates: readonly FontSemanticRecord[],
  options: { mode?: FontAlternativeMode; limit?: number; preserveScripts?: boolean } = {},
): FontRecommendation[] {
  const mode = options.mode ?? 'closest-appearance';
  return candidates
    .filter(
      (candidate) =>
        candidate.familyId !== target.familyId && candidate.familyName !== target.familyName,
    )
    .filter((candidate) => !options.preserveScripts || compatibleScripts(target, candidate))
    .filter((candidate) => mode !== 'installed-only' || candidate.installed)
    .filter(
      (candidate) =>
        mode !== 'open-source' ||
        Boolean(
          candidate.license &&
            (candidate.license.includes('Open') ||
              candidate.license.includes('Apache') ||
              candidate.license.includes('Ubuntu')),
        ),
    )
    .map((candidate) => {
      const distance = featureDistance(target, candidate);
      const metricScore = distance === undefined ? 0.35 : 1 - distance;
      const construction =
        sharedTags(target, candidate).filter((tag) => tag.startsWith('classification.')).length *
        0.15;
      const coverage = compatibleScripts(target, candidate) ? 0.12 : 0;
      const score =
        mode === 'least-reflow'
          ? metricScore * 0.65 + coverage + construction * 0.6
          : metricScore * 0.5 + construction + coverage;
      const reasons: FontSearchReason[] = [];
      if (distance !== undefined)
        reasons.push(
          reason(
            mode === 'least-reflow'
              ? 'Similar measured width and proportions'
              : 'Similar measured proportions',
            'visual-feature',
            'local font measurements',
          ),
        );
      const shared = sharedTags(target, candidate).filter((tag) =>
        tag.startsWith('classification.'),
      );
      if (shared[0])
        reasons.push(reason(`Same ${shared[0].split('.').at(-1)} construction`, 'similarity'));
      if (compatibleScripts(target, candidate) && target.scripts.length > 0)
        reasons.push(reason('Preserves known script coverage', 'coverage'));
      if (candidate.installed)
        reasons.push(reason('Already installed', 'availability', 'font registry'));
      if (mode === 'open-source')
        reasons.push(
          reason('Open-source license', 'availability', candidate.license ?? 'license metadata'),
        );
      return { record: candidate, score, reasons };
    })
    .sort(sortRecommendations)
    .slice(0, options.limit ?? 8);
}

/** Role-aware pairing; intentionally distinct from nearest-neighbour similarity. */
export function findFontPairings(
  source: FontSemanticRecord,
  candidates: readonly FontSemanticRecord[],
  options: {
    role?: 'headline-body' | 'display-supporting-sans' | 'ui-heading-body' | 'code-interface';
    intent?: FontPairingIntent;
    limit?: number;
  } = {},
): FontRecommendation[] {
  const role = options.role ?? 'headline-body';
  const intent = options.intent ?? 'harmonious';
  const sourceTags = tagSet(source);
  const wantsSerif = role === 'headline-body' || role === 'display-supporting-sans';
  return candidates
    .filter(
      (candidate) =>
        candidate.familyId !== source.familyId && candidate.familyName !== source.familyName,
    )
    .map((candidate) => {
      const candidateTags = tagSet(candidate);
      const sourceSerif = [...sourceTags].some((tag) => tag.startsWith('classification.serif'));
      const candidateSerif = [...candidateTags].some((tag) =>
        tag.startsWith('classification.serif'),
      );
      const roleFit =
        role === 'code-interface'
          ? candidateTags.has('use.ui') || candidateTags.has('use.body')
            ? 0.4
            : 0
          : wantsSerif && sourceSerif !== candidateSerif
            ? 0.42
            : wantsSerif
              ? 0.18
              : 0.25;
      const shared = sharedTags(source, candidate);
      const metric = featureDistance(source, candidate);
      const harmony = metric === undefined ? 0.2 : 1 - metric;
      const contrast = sourceSerif !== candidateSerif ? 0.25 : 0;
      let score =
        roleFit + harmony * (intent === 'harmonious' || intent === 'restrained' ? 0.42 : 0.15);
      if (intent === 'contrasting') score = roleFit + contrast + (1 - harmony) * 0.25;
      if (intent === 'expressive')
        score += [...candidateTags].some(
          (tag) => tag === 'tone.expressive' || tag === 'tone.playful',
        )
          ? 0.25
          : 0;
      const reasons = [
        reason(
          role === 'code-interface'
            ? 'Fits the code + interface role'
            : 'Creates a clear typographic hierarchy',
          'use-case',
        ),
      ];
      if (shared.length > 0) reasons.push(reason('Shares supporting structure', 'similarity'));
      if (metric !== undefined)
        reasons.push(
          reason(
            intent === 'contrasting'
              ? 'Measured proportions create contrast'
              : 'Measured proportions are compatible',
            'visual-feature',
            'local font measurements',
          ),
        );
      return { record: candidate, score, reasons };
    })
    .sort(sortRecommendations)
    .slice(0, options.limit ?? 6);
}
