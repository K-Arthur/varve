/**
 * Canonical measurement-record validation (G1).
 *
 * Every Varve quality, latency, or platform claim is supposed to be backed by
 * measurements, and those measurements are supposed to say what they measured,
 * where, with which artifacts, and whether failed cases were included. This
 * module is the single validator/aggregator for that evidence: record creation,
 * report generation, CI checks, and routing decisions all consume its output
 * instead of trusting a manually entered headline number or green boolean.
 *
 * The validator derives summaries from per-case data and compares them with
 * declarations. It never repairs a record silently and never turns missing
 * evidence into a perfect score: a missing category or metric is *unverified*,
 * not zero-error.
 */

export type MeasurementOutcome =
  | 'ok'
  | 'no-match'
  | 'timeout'
  | 'oom'
  | 'skipped'
  | 'aborted'
  | 'failed';

export type MetricDirection = 'higher-is-better' | 'lower-is-better';

/** How a metric's declared summary combines per-category values. */
export type MetricAggregation = 'macro' | 'micro';

/**
 * What a metric value means. `automatic` values come from the runtime's own
 * choice, `oracle` values require annotation, and `user-selected` values record
 * a human choice. A record must not present an oracle or user-selected value as
 * automatic performance.
 */
export type MetricRole = 'automatic' | 'oracle' | 'user-selected' | 'reference';

/**
 * `real-run` is inference through the production path; `real-model-harness`
 * runs the pinned artifacts through the production encode/decode functions in
 * a test harness; `mock-harness` and `synthetic-fixture` validate mechanics
 * only and can never authorize a platform claim.
 */
export type VerificationClass =
  | 'real-run'
  | 'real-model-harness'
  | 'mock-harness'
  | 'synthetic-fixture';

export type ClaimTopic = 'quality' | 'platform' | 'latency' | 'reliability';

export interface MeasurementClaim {
  topic: ClaimTopic;
  /** Runtime/platform the claim is about, e.g. `webgpu`, `wasm`, `cpu`. */
  scope: string;
}

export interface MeasurementRuntimeIdentity {
  /** `cpu`, `wasm`, `webgpu`, `native`, ... — never a requested provider alone. */
  executionProvider: string;
  runtimeName: string;
  runtimeVersion: string;
  /** Observed thread count, when the runtime reports it. */
  threads?: number;
  crossOriginIsolated?: boolean;
}

export interface MeasurementIdentity {
  /** Commit SHA or `dirty:<patch identity>` recorded at measurement time. */
  codeRevision: string;
  dirty: boolean;
  /** Component or artifact id -> byte-identity hash. */
  artifactChecksums: Readonly<Record<string, string>>;
  runtime: MeasurementRuntimeIdentity;
  host: {
    os: string;
    arch: string;
    browser?: string;
  };
}

export interface MeasurementCase {
  caseId: string;
  category: string;
  outcome: MeasurementOutcome;
  /**
   * Metric values for cases where they are computable. `ok` cases are expected
   * to carry every metric that is not explicitly optional; failed cases may
   * omit them but still count in reliability denominators.
   */
  metrics?: Readonly<Record<string, number>>;
  /** Prompt regime that produced the case, when the corpus distinguishes them. */
  promptRegime?: string;
  split?: string;
}

export interface MeasurementMetricDeclaration {
  name: string;
  direction: MetricDirection;
  /** Legal inclusive range for individual case values. */
  range: readonly [number, number];
  aggregation: MetricAggregation;
  role: MetricRole;
  /** Categories where the metric is not defined; missing here is not a defect. */
  optionalInCategories?: readonly string[];
  /**
   * Declared-vs-recomputed tolerance. Defaults to 1e-9 so rounded input is
   * caught; comparisons are always performed on unrounded values.
   */
  tolerance?: number;
}

export interface DeclaredWorstCritical {
  value: number;
  /** The tied worst set, or a named member of it, per the documented rule. */
  category: string | null;
}

export interface MeasurementRecord {
  schemaVersion: 1;
  kind: 'segmentation-quality' | 'detection-quality' | 'latency' | 'platform';
  corpus: {
    id: string;
    version: string;
    /** Byte-identity hash of the corpus/fixtures used. */
    hash: string;
    split: string;
    promptRegime?: string;
  };
  identity: MeasurementIdentity;
  verification: VerificationClass;
  claims: readonly MeasurementClaim[];
  metrics: readonly MeasurementMetricDeclaration[];
  /** Categories that must be present with at least one usable case. */
  requiredCategories: readonly string[];
  /** Categories whose worst value backs the critical floors. */
  criticalCategories: readonly string[];
  cases: readonly MeasurementCase[];
  declared: {
    summary: Readonly<Record<string, number>>;
    perCategory: Readonly<Record<string, Readonly<Record<string, number>>>>;
    worstCritical: Readonly<Record<string, DeclaredWorstCritical>>;
    caseCounts: { total: number; ok: number };
    reliability?: { successRate: number };
  };
}

export type MeasurementDiagnosticCode =
  | 'invalid-record'
  | 'duplicate-case-id'
  | 'empty-cases'
  | 'non-finite-value'
  | 'out-of-range'
  | 'missing-required-category'
  | 'empty-category'
  | 'missing-metric'
  | 'unexpected-metric'
  | 'declared-value-mismatch'
  | 'declared-count-mismatch'
  | 'declared-category-mismatch'
  | 'worst-category-tie'
  | 'unverified-worst-category'
  | 'oracle-requires-annotation'
  | 'provenance-class'
  | 'platform-binding'
  | 'split-leakage';

export interface MeasurementDiagnostic {
  code: MeasurementDiagnosticCode;
  field: string;
  declared?: unknown;
  recomputed?: unknown;
  caseId?: string;
  category?: string;
  remediation: string;
}

export type MeasurementRecordStatus = 'verified' | 'unverified' | 'mismatch' | 'invalid';

export interface RecomputedWorstCritical {
  value: number;
  /** Deterministically first category among the tied worst set. */
  canonicalCategory: string | null;
  tiedCategories: string[];
}

export interface VerifiedMeasurementSummary {
  status: MeasurementRecordStatus;
  perCategory: Record<string, Record<string, number>>;
  summary: Record<string, number>;
  worstCritical: Record<string, RecomputedWorstCritical>;
  caseCounts: {
    total: number;
    ok: number;
    noMatch: number;
    timeout: number;
    oom: number;
    skipped: number;
    aborted: number;
    failed: number;
  };
  reliability: { successRate: number };
  diagnostics: MeasurementDiagnostic[];
}

export interface MeasurementValidationOptions {
  /**
   * Byte-identity hashes the record must match, e.g. from the shipped model
   * manifest. A record that cites different bytes than the build ships is a
   * mismatch even when its arithmetic is perfect.
   */
  expectedArtifactChecksums?: Readonly<Record<string, string>>;
  expectedCorpusHash?: string;
}

const CONSTRAINT_CLASSES: readonly VerificationClass[] = ['mock-harness', 'synthetic-fixture'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function metricByName(
  record: MeasurementRecord,
  name: string,
): MeasurementMetricDeclaration | null {
  return record.metrics.find((metric) => metric.name === name) ?? null;
}

function summarizeCaseCounts(
  cases: readonly MeasurementCase[],
): VerifiedMeasurementSummary['caseCounts'] {
  const counts: VerifiedMeasurementSummary['caseCounts'] = {
    total: cases.length,
    ok: 0,
    noMatch: 0,
    timeout: 0,
    oom: 0,
    skipped: 0,
    aborted: 0,
    failed: 0,
  };
  for (const measurementCase of cases) {
    switch (measurementCase.outcome) {
      case 'ok':
        counts.ok += 1;
        break;
      case 'no-match':
        counts.noMatch += 1;
        break;
      case 'timeout':
        counts.timeout += 1;
        break;
      case 'oom':
        counts.oom += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      case 'aborted':
        counts.aborted += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
    }
  }
  return counts;
}

function sortedCategories(record: MeasurementRecord): string[] {
  return [...new Set(record.cases.map((measurementCase) => measurementCase.category))].sort();
}

/**
 * Validate a measurement record end to end: structure, coverage, per-category
 * aggregation, declared summaries, worst-category claims, provenance class, and
 * platform binding. The returned summary is the only authoritative form of the
 * record's numbers.
 */
export function validateMeasurementRecord(
  record: MeasurementRecord,
  options: MeasurementValidationOptions = {},
): VerifiedMeasurementSummary {
  const diagnostics: MeasurementDiagnostic[] = [];
  const invalid = (field: string, remediation: string, extra?: Partial<MeasurementDiagnostic>) => {
    diagnostics.push({ code: 'invalid-record', field, remediation, ...extra });
  };

  if (record.schemaVersion !== 1) {
    invalid('schemaVersion', 'Only schemaVersion 1 records are supported; migrate the record.');
  }
  if (
    options.expectedCorpusHash !== undefined &&
    options.expectedCorpusHash !== record.corpus.hash
  ) {
    diagnostics.push({
      code: 'invalid-record',
      field: 'corpus.hash',
      declared: record.corpus.hash,
      recomputed: options.expectedCorpusHash,
      remediation:
        'Corpus bytes differ from the referenced corpus; re-measure instead of relabeling.',
    });
  }
  if (options.expectedArtifactChecksums) {
    for (const [component, expected] of Object.entries(options.expectedArtifactChecksums)) {
      const actual = record.identity.artifactChecksums[component];
      if (actual !== expected) {
        diagnostics.push({
          code: 'invalid-record',
          field: `identity.artifactChecksums.${component}`,
          declared: actual ?? null,
          recomputed: expected,
          remediation:
            'Artifact identity substitution detected; the record does not describe the shipped bytes.',
        });
      }
    }
  }
  if (record.cases.length === 0) {
    diagnostics.push({
      code: 'empty-cases',
      field: 'cases',
      remediation: 'A record without cases is unverified evidence, not a result.',
    });
  }

  const seenCaseIds = new Set<string>();
  for (const measurementCase of record.cases) {
    if (seenCaseIds.has(measurementCase.caseId)) {
      diagnostics.push({
        code: 'duplicate-case-id',
        field: 'cases',
        caseId: measurementCase.caseId,
        remediation: 'Case ids must be unique; remove the duplicated observation.',
      });
    }
    seenCaseIds.add(measurementCase.caseId);
    for (const [metricName, value] of Object.entries(measurementCase.metrics ?? {})) {
      const declaration = metricByName(record, metricName);
      if (!declaration) {
        diagnostics.push({
          code: 'unexpected-metric',
          field: `cases.${measurementCase.caseId}.${metricName}`,
          caseId: measurementCase.caseId,
          remediation: `Declare metric '${metricName}' or remove the value.`,
        });
        continue;
      }
      if (!isFiniteNumber(value)) {
        diagnostics.push({
          code: 'non-finite-value',
          field: `cases.${measurementCase.caseId}.${metricName}`,
          caseId: measurementCase.caseId,
          remediation: 'Non-finite values are not measurements; record the case outcome instead.',
        });
      } else if (value < declaration.range[0] || value > declaration.range[1]) {
        diagnostics.push({
          code: 'out-of-range',
          field: `cases.${measurementCase.caseId}.${metricName}`,
          caseId: measurementCase.caseId,
          declared: value,
          recomputed: declaration.range,
          remediation: `Value outside the declared range [${declaration.range[0]}, ${declaration.range[1]}].`,
        });
      }
    }
  }

  // Coverage: required categories are unverified when absent or empty.
  const categoryCases = new Map<string, MeasurementCase[]>();
  for (const measurementCase of record.cases) {
    const bucket = categoryCases.get(measurementCase.category) ?? [];
    bucket.push(measurementCase);
    categoryCases.set(measurementCase.category, bucket);
  }
  for (const category of record.requiredCategories) {
    const bucket = categoryCases.get(category);
    if (!bucket) {
      diagnostics.push({
        code: 'missing-required-category',
        field: 'requiredCategories',
        category,
        remediation: `Category '${category}' has no cases; treat the record as unverified for it.`,
      });
    } else if (!bucket.some((measurementCase) => measurementCase.outcome === 'ok')) {
      diagnostics.push({
        code: 'empty-category',
        field: 'requiredCategories',
        category,
        remediation: `Category '${category}' has no usable case; a missing category is not a perfect score.`,
      });
    }
  }
  for (const category of record.criticalCategories) {
    if (!record.requiredCategories.includes(category)) {
      diagnostics.push({
        code: 'invalid-record',
        field: 'criticalCategories',
        category,
        remediation: `Critical category '${category}' must also be required so coverage is enforced.`,
      });
    }
  }

  // Per-category recomputation over usable cases only.
  const perCategory: Record<string, Record<string, number>> = {};
  for (const category of sortedCategories(record)) {
    const usable = (categoryCases.get(category) ?? []).filter(
      (measurementCase) => measurementCase.outcome === 'ok',
    );
    const values: Record<string, number> = {};
    for (const declaration of record.metrics) {
      const samples = usable
        .map((measurementCase) => measurementCase.metrics?.[declaration.name])
        .filter(isFiniteNumber);
      if (samples.length === 0) {
        if (usable.length === 0) continue;
        if (declaration.optionalInCategories?.includes(category)) continue;
        diagnostics.push({
          code: 'missing-metric',
          field: `perCategory.${category}.${declaration.name}`,
          category,
          remediation: `No usable '${declaration.name}' value in '${category}'; the category is unverified for this metric.`,
        });
        continue;
      }
      if (
        samples.length !== usable.length &&
        !declaration.optionalInCategories?.includes(category)
      ) {
        diagnostics.push({
          code: 'missing-metric',
          field: `perCategory.${category}.${declaration.name}`,
          category,
          declared: usable.length,
          recomputed: samples.length,
          remediation: `Only ${samples.length}/${usable.length} usable cases carry '${declaration.name}'.`,
        });
      }
      values[declaration.name] = mean(samples);
    }
    if (Object.keys(values).length > 0) perCategory[category] = values;
  }

  // Declared per-category values are checked against the recomputation.
  for (const [category, declaredValues] of Object.entries(record.declared.perCategory)) {
    const recomputed = perCategory[category];
    if (!recomputed) {
      diagnostics.push({
        code: 'declared-category-mismatch',
        field: `declared.perCategory.${category}`,
        category,
        remediation: `Declared category '${category}' has no recomputable data.`,
      });
      continue;
    }
    for (const [metricName, declaredValue] of Object.entries(declaredValues)) {
      const declaration = metricByName(record, metricName);
      if (!declaration) {
        diagnostics.push({
          code: 'invalid-record',
          field: `declared.perCategory.${category}.${metricName}`,
          remediation: `Declared metric '${metricName}' is not in the metric list.`,
        });
        continue;
      }
      const recomputedValue = recomputed[metricName];
      if (recomputedValue === undefined) {
        diagnostics.push({
          code: 'declared-category-mismatch',
          field: `declared.perCategory.${category}.${metricName}`,
          category,
          declared: declaredValue,
          remediation: 'Declared category value has no recomputable counterpart.',
        });
        continue;
      }
      compareDeclared(
        diagnostics,
        `declared.perCategory.${category}.${metricName}`,
        declaredValue,
        recomputedValue,
        toleranceOf(declaration),
      );
    }
  }

  // Summary: macro mean of category values or micro mean of case values.
  const summary: Record<string, number> = {};
  for (const declaration of record.metrics) {
    if (declaration.aggregation === 'micro') {
      const samples = record.cases
        .filter((measurementCase) => measurementCase.outcome === 'ok')
        .map((measurementCase) => measurementCase.metrics?.[declaration.name])
        .filter(isFiniteNumber);
      if (samples.length === 0) continue;
      summary[declaration.name] = mean(samples);
      continue;
    }
    const categoryValues = Object.values(perCategory)
      .map((values) => values[declaration.name])
      .filter(isFiniteNumber);
    if (categoryValues.length === 0) continue;
    summary[declaration.name] = mean(categoryValues);
  }
  for (const [metricName, declaredValue] of Object.entries(record.declared.summary)) {
    const declaration = metricByName(record, metricName);
    if (!declaration) {
      diagnostics.push({
        code: 'invalid-record',
        field: `declared.summary.${metricName}`,
        remediation: `Declared metric '${metricName}' is not in the metric list.`,
      });
      continue;
    }
    const recomputedValue = summary[metricName];
    if (recomputedValue === undefined) {
      diagnostics.push({
        code: 'missing-metric',
        field: `declared.summary.${metricName}`,
        remediation: `No usable '${metricName}' values exist; the declared summary is unverified.`,
      });
      continue;
    }
    compareDeclared(
      diagnostics,
      `declared.summary.${metricName}`,
      declaredValue,
      recomputedValue,
      toleranceOf(declaration),
    );
  }

  // Worst critical value per metric, with deterministic tie handling.
  const worstCritical: Record<string, RecomputedWorstCritical> = {};
  for (const declaration of record.metrics) {
    const criticalValues: Array<{ category: string; value: number }> = [];
    for (const category of record.criticalCategories) {
      const value = perCategory[category]?.[declaration.name];
      if (value !== undefined) criticalValues.push({ category, value });
    }
    if (criticalValues.length === 0) continue;
    const worst = worstOf(criticalValues, declaration.direction);
    worstCritical[declaration.name] = worst;
    const declared = record.declared.worstCritical[declaration.name];
    if (!declared) {
      // Reference metrics (e.g. the oracle best-available candidate) are
      // evaluation baselines, not routing claims; they need no declaration.
      if (declaration.role === 'reference') continue;
      diagnostics.push({
        code: 'unverified-worst-category',
        field: `declared.worstCritical.${declaration.name}`,
        remediation: `Recomputed worst '${declaration.name}' (${worst.value} in '${worst.canonicalCategory}') is not declared.`,
      });
      continue;
    }
    compareDeclared(
      diagnostics,
      `declared.worstCritical.${declaration.name}.value`,
      declared.value,
      worst.value,
      toleranceOf(declaration),
    );
    if (worst.tiedCategories.length > 1) {
      const tied = worst.tiedCategories.join(', ');
      if (declared.category === null || !worst.tiedCategories.includes(declared.category)) {
        diagnostics.push({
          code: 'worst-category-tie',
          field: `declared.worstCritical.${declaration.name}.category`,
          declared: declared.category,
          recomputed: worst.tiedCategories,
          remediation: `Worst values tie across [${tied}]; declare one of them or the canonical '${worst.canonicalCategory}'.`,
        });
      }
    } else if (declared.category !== worst.canonicalCategory) {
      diagnostics.push({
        code: 'declared-category-mismatch',
        field: `declared.worstCritical.${declaration.name}.category`,
        declared: declared.category,
        recomputed: worst.canonicalCategory,
        remediation: 'Worst category does not match the recomputed worst category.',
      });
    }
  }
  for (const metricName of Object.keys(record.declared.worstCritical)) {
    if (!worstCritical[metricName]) {
      diagnostics.push({
        code: 'unverified-worst-category',
        field: `declared.worstCritical.${metricName}`,
        remediation: `Metric '${metricName}' has no critical-category data; the worst value is unverified.`,
      });
    }
  }

  // Case counts and reliability must include every case, failed or not.
  const caseCounts = summarizeCaseCounts(record.cases);
  if (record.declared.caseCounts.total !== caseCounts.total) {
    diagnostics.push({
      code: 'declared-count-mismatch',
      field: 'declared.caseCounts.total',
      declared: record.declared.caseCounts.total,
      recomputed: caseCounts.total,
      remediation: 'Declared total must equal the number of observed cases.',
    });
  }
  if (record.declared.caseCounts.ok !== caseCounts.ok) {
    diagnostics.push({
      code: 'declared-count-mismatch',
      field: 'declared.caseCounts.ok',
      declared: record.declared.caseCounts.ok,
      recomputed: caseCounts.ok,
      remediation: 'Declared ok count must equal the recomputed usable-case count.',
    });
  }
  const successRate = caseCounts.total > 0 ? caseCounts.ok / caseCounts.total : 0;
  const declaredReliability = record.declared.reliability;
  if (declaredReliability) {
    compareDeclared(
      diagnostics,
      'declared.reliability.successRate',
      declaredReliability.successRate,
      successRate,
      1e-9,
    );
  }

  // Metric roles: oracle/user-selected values require annotation provenance.
  for (const declaration of record.metrics) {
    if (declaration.role !== 'oracle' && declaration.role !== 'user-selected') continue;
    if (declaration.role === 'oracle' && record.verification === 'mock-harness') {
      diagnostics.push({
        code: 'provenance-class',
        field: `metrics.${declaration.name}.role`,
        remediation:
          'Oracle metrics require human or scripted annotation over real artifacts; mock-harness records cannot back them.',
      });
    }
  }

  // Provenance class vs claimed scope: mechanics cannot validate a platform.
  const constraintClass = CONSTRAINT_CLASSES.includes(record.verification);
  for (const claim of record.claims) {
    if (claim.topic === 'platform') {
      const declaredProvider = claim.scope.toLowerCase();
      const measuredProvider = record.identity.runtime.executionProvider.toLowerCase();
      if (declaredProvider !== measuredProvider) {
        diagnostics.push({
          code: 'platform-binding',
          field: 'claims',
          declared: claim.scope,
          recomputed: record.identity.runtime.executionProvider,
          remediation: `A '${claim.scope}' claim cannot be backed by a '${record.identity.runtime.executionProvider}' measurement.`,
        });
      }
      if (constraintClass) {
        diagnostics.push({
          code: 'provenance-class',
          field: 'claims',
          declared: record.verification,
          remediation: `'${record.verification}' evidence validates policy, not '${claim.scope}' platform behavior.`,
        });
      }
    } else if (constraintClass) {
      diagnostics.push({
        code: 'provenance-class',
        field: 'claims',
        declared: record.verification,
        remediation: `'${record.verification}' evidence cannot authorize a '${claim.topic}' claim.`,
      });
    }
  }

  // Held-out claims must not aggregate development-split cases.
  if (record.corpus.split === 'held-out') {
    const devCases = record.cases.filter(
      (measurementCase) =>
        measurementCase.split !== undefined && measurementCase.split !== 'held-out',
    );
    if (devCases.length > 0) {
      diagnostics.push({
        code: 'split-leakage',
        field: 'corpus.split',
        declared: 'held-out',
        recomputed: devCases.length,
        remediation: `${devCases.length} case(s) are not from the held-out split; exclude them from held-out claims.`,
      });
    }
  }

  const status = recordStatus(diagnostics);
  return {
    status,
    perCategory,
    summary,
    worstCritical,
    caseCounts,
    reliability: { successRate },
    diagnostics,
  };
}

/**
 * The routing-facing projection of a validated record. `undefined` means the
 * record cannot authorize a quality preference at all.
 */
export interface VerifiedQualityEvidence {
  mean: Record<string, number>;
  worstCritical: Record<string, RecomputedWorstCritical>;
  caseCounts: VerifiedMeasurementSummary['caseCounts'];
  /** True only when every declaration matched the recomputation. */
  verified: boolean;
}

export function toVerifiedQualityEvidence(
  summary: VerifiedMeasurementSummary,
): VerifiedQualityEvidence | undefined {
  if (summary.status === 'invalid') return undefined;
  return {
    mean: summary.summary,
    worstCritical: summary.worstCritical,
    caseCounts: summary.caseCounts,
    verified: summary.status === 'verified',
  };
}

function recordStatus(diagnostics: MeasurementDiagnostic[]): MeasurementRecordStatus {
  if (diagnostics.some((diagnostic) => diagnostic.code === 'invalid-record')) return 'invalid';
  if (
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'declared-value-mismatch' ||
        diagnostic.code === 'declared-count-mismatch' ||
        diagnostic.code === 'declared-category-mismatch' ||
        diagnostic.code === 'duplicate-case-id' ||
        diagnostic.code === 'non-finite-value' ||
        diagnostic.code === 'out-of-range' ||
        diagnostic.code === 'unexpected-metric' ||
        diagnostic.code === 'split-leakage' ||
        diagnostic.code === 'worst-category-tie' ||
        diagnostic.code === 'platform-binding',
    )
  ) {
    return 'mismatch';
  }
  if (diagnostics.length > 0) return 'unverified';
  return 'verified';
}

function toleranceOf(declaration: MeasurementMetricDeclaration): number {
  return declaration.tolerance ?? 1e-9;
}

function compareDeclared(
  diagnostics: MeasurementDiagnostic[],
  field: string,
  declaredValue: number,
  recomputedValue: number,
  tolerance: number,
): void {
  if (!isFiniteNumber(declaredValue) || Math.abs(declaredValue - recomputedValue) > tolerance) {
    diagnostics.push({
      code: 'declared-value-mismatch',
      field,
      declared: declaredValue,
      recomputed: recomputedValue,
      remediation: `Update the declaration to the recomputed value or fix the observation; tolerance ${tolerance}.`,
    });
  }
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function worstOf(
  values: ReadonlyArray<{ category: string; value: number }>,
  direction: MetricDirection,
): RecomputedWorstCritical {
  const ordered = [...values].sort((left, right) => left.category.localeCompare(right.category));
  let worst = ordered[0]!;
  for (const candidate of ordered.slice(1)) {
    const isWorse =
      direction === 'higher-is-better'
        ? candidate.value < worst.value
        : candidate.value > worst.value;
    if (isWorse) worst = candidate;
  }
  const tiedCategories = ordered
    .filter((candidate) => candidate.value === worst.value)
    .map((candidate) => candidate.category);
  return {
    value: worst.value,
    canonicalCategory: tiedCategories[0] ?? null,
    tiedCategories,
  };
}
