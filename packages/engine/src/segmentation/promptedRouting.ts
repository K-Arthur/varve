/**
 * Quality-first routing for prompted object selection.
 *
 * This function deliberately knows nothing about React, the editor, or model
 * downloads. It takes observed availability/runtime facts plus *measured*
 * provider validation records and returns a decision record that can be shown
 * in diagnostics.
 *
 * Product invariant: automatic routing selects the highest-quality provider
 * whose measured validation clears the safety floors and whose working set
 * fits the runtime's hard budget. Speed, warm embeddings, and memory only
 * break ties between providers whose validated quality is equivalent. A
 * provider with no measured corpus evidence, or an experimental provider,
 * can never win automatic routing.
 *
 * Automatic foreground estimates are a different capability and must never be
 * substituted here.
 */

export const MOBILE_SAM_PROVIDER_ID = 'mobile-sam';
export const SAM2_PROVIDER_ID = 'sam2-hiera-tiny';

export const MOBILE_SAM_ENCODER_ID = 'mobile-sam-encoder';
export const MOBILE_SAM_DECODER_ID = 'mobile-sam-decoder';
export const SAM2_ENCODER_ID = 'sam2-hiera-tiny-encoder';
export const SAM2_DECODER_ID = 'sam2-hiera-tiny-decoder';

/** User-visible provider choice. `auto` is the only value that enables routing. */
export type PromptedProviderPreference =
  | 'auto'
  | typeof MOBILE_SAM_PROVIDER_ID
  | typeof SAM2_PROVIDER_ID;

export type PromptedSelectionPreference = 'auto' | 'fast' | 'balanced' | 'quality';
export type PromptedSelectionExecutionProvider = 'wasm' | 'webgpu' | 'native' | 'cpu';

/**
 * Absolute safety floors below which a prompted mask is not a usable editor
 * selection regardless of how the provider compares to its peers. Measured on
 * the shared object-selection corpus (IoU / boundary F in 0-1). The 0.5 floor
 * is the conventional "mask covers at least half of the intended object"
 * acceptance line; category floors use the same value so thin features, tiny
 * objects, edge-touching subjects, and hair/fur cannot be traded for average
 * gains elsewhere.
 */
export const PROMPTED_MIN_MEAN_IOU = 0.5;
export const PROMPTED_MIN_MEAN_BOUNDARY_F = 0.5;
export const PROMPTED_MIN_CRITICAL_IOU = 0.5;
export const PROMPTED_MIN_CRITICAL_BOUNDARY_F = 0.5;

/**
 * Quality-equivalence band for automatic routing.
 *
 * Derived from the measured provider A/B run on the shared corpus: on the
 * categories where both validated providers clear the safety floors, the
 * largest per-category IoU gap was 0.023 (low-contrast). A 0.03 band is the
 * next 0.01 step above that observed spread, so a difference at or below it is
 * treated as "practically equivalent" and resolved by warm-state, measured
 * prompt latency, memory, and stable provider id instead of by noise.
 *
 * The band is intentionally a policy constant, not a per-run guess: changing
 * it requires new corpus evidence.
 */
export const PROMPTED_QUALITY_EQUIVALENCE_BAND = 0.03;

/** Relative weights for the `balanced` normalized score (documented policy). */
export const PROMPTED_BALANCED_MAX_LATENCY_PENALTY = 0.15;
export const PROMPTED_BALANCED_MAX_MEMORY_PENALTY = 0.1;

export interface PromptedProviderCapabilities {
  pointPrompts: boolean;
  boxPrompts: boolean;
  maskPrompts: boolean;
  multipleCandidates: boolean;
}

export type PromptedRequiredCapabilities = Partial<PromptedProviderCapabilities>;

export interface PromptedQualityValidation {
  validated: true;
  /** Version of the corpus and acceptance meaning the numbers were measured against. */
  corpusVersion: string;
  /** Runtime/host the measurement was taken on, never a claim about other hosts. */
  runtimeEnvironment: string;
  validatedAt: string;
  meanIoU: number;
  meanBoundaryF: number;
  categoryIoU: Readonly<Record<string, number>>;
  criticalCategories: readonly string[];
  worstCriticalIoU: number;
  worstCriticalBoundaryF: number;
}

export interface PromptedProviderFact {
  id: string;
  label: string;
  encoderId: string;
  decoderId: string;
  installed: boolean;
  /** Measured or conservatively audited peak working set for encoder + decode. */
  workingSetBytes: number;
  /** Measured warm prompt p95; omitted when no measurement exists. */
  warmPromptP95Ms?: number;
  warmPromptP50Ms?: number;
  /** `estimated` values are proxy measurements from another runtime and are labelled as such. */
  warmPromptP95Source?: 'measured' | 'estimated';
  /** Experimental providers are never eligible for automatic routing. */
  experimental?: boolean;
  capabilities: PromptedProviderCapabilities;
  /** Measured corpus evidence. Missing evidence cannot win automatic routing. */
  validation?: PromptedQualityValidation;
  supportedExecutionProviders: readonly PromptedSelectionExecutionProvider[];
}

export interface PromptedRoutingRequest {
  preference: PromptedSelectionPreference;
  sourceWidth: number;
  sourceHeight: number;
  executionProvider: PromptedSelectionExecutionProvider;
  /** Runtime's safe reservation ceiling, when measured/reported. */
  safeWorkingSetBytes?: number;
  /** A warm embedding avoids re-paying the encoder cost. */
  cachedEmbeddingProvider?: string;
  /** Capabilities the requested operation needs, e.g. a box or mask prompt. */
  requiredCapabilities?: PromptedRequiredCapabilities;
  /**
   * Explicit provider choice from the model-preference UI. When set to a
   * concrete provider, every other provider is out of scope and there is no
   * silent fallback. `auto` (or omission) enables measured routing.
   */
  preferredProviderId?: PromptedProviderPreference | string;
  /**
   * Explicit opt-in for a provider marked experimental. This is intentionally
   * separate from `preferredProviderId` so callers cannot accidentally make an
   * experimental provider eligible for automatic routing.
   */
  allowExperimentalProvider?: boolean;
  /** Diagnostic override; the router default is corpus-derived. */
  qualityEquivalenceBand?: number;
  providers: readonly PromptedProviderFact[];
}

export type PromptedRoutingRejectionCode =
  | 'not-installed'
  | 'unsupported-runtime'
  | 'missing-capability'
  | 'exceeds-hard-budget'
  | 'experimental-provider'
  | 'unvalidated'
  | 'below-quality-floor';

export interface PromptedRoutingRejection {
  providerId: string;
  code: PromptedRoutingRejectionCode;
  reason: string;
}

export interface PromptedProviderRanking {
  providerId: string;
  label: string;
  eligible: boolean;
  rejectionCode?: PromptedRoutingRejectionCode;
  validatedMeanIoU?: number;
  validatedMeanBoundaryF?: number;
  warm: boolean;
  estimatedWorkingSetBytes: number;
  warmPromptP95Ms?: number;
  scoreComponents: {
    qualityUtility?: number;
    latencyPenalty?: number;
    memoryPenalty?: number;
  };
  finalRankReason: string;
}

export interface PromptedRoutingDecision {
  providerId: string | null;
  providerLabel: string | null;
  encoderId: string | null;
  decoderId: string | null;
  reason: string;
  /** Every candidate with its eligibility, evidence, and rank explanation. */
  candidates: PromptedProviderRanking[];
  rejected: PromptedRoutingRejection[];
  sourceBytes: number;
  /** Used by the admission gate and recorded for diagnostics. */
  estimatedWorkingSetBytes: number | null;
  qualitySource: 'validated-corpus' | 'none';
}

interface RankedProvider {
  fact: PromptedProviderFact;
  estimatedWorkingSetBytes: number;
  warm: boolean;
  quality: number;
  boundary: number;
  latencyPenalty: number;
  memoryPenalty: number;
}

export function routePromptedSelection(request: PromptedRoutingRequest): PromptedRoutingDecision {
  const sourceBytes = request.sourceWidth * request.sourceHeight * 4;
  const rejected: PromptedRoutingRejection[] = [];
  const candidates: PromptedProviderRanking[] = [];
  const eligible: RankedProvider[] = [];
  const preferredProviderId =
    request.preferredProviderId && request.preferredProviderId !== 'auto'
      ? request.preferredProviderId
      : undefined;
  const consideredProviders = preferredProviderId
    ? request.providers.filter((provider) => provider.id === preferredProviderId)
    : request.providers;

  // An explicit choice is a capability request, not a hint. If the requested
  // provider is absent, fail with an actionable decision instead of quietly
  // changing the model behind the user's back.
  if (preferredProviderId && consideredProviders.length === 0) {
    const reason = `The requested prompted-selection provider (${preferredProviderId}) is not installed or is unavailable for this build. Choose another installed provider explicitly or switch Model preference to Auto.`;
    rejected.push({ providerId: preferredProviderId, code: 'not-installed', reason });
    candidates.push({
      providerId: preferredProviderId,
      label: preferredProviderId,
      eligible: false,
      rejectionCode: 'not-installed',
      warm: false,
      estimatedWorkingSetBytes: sourceBytes,
      scoreComponents: {},
      finalRankReason: reason,
    });
    return {
      providerId: null,
      providerLabel: null,
      encoderId: null,
      decoderId: null,
      reason,
      candidates,
      rejected,
      sourceBytes,
      estimatedWorkingSetBytes: null,
      qualitySource: 'none',
    };
  }

  for (const provider of consideredProviders) {
    const estimatedWorkingSetBytes = provider.workingSetBytes + sourceBytes;
    const base = {
      providerId: provider.id,
      label: provider.label,
      eligible: false as const,
      validatedMeanIoU: provider.validation?.meanIoU,
      validatedMeanBoundaryF: provider.validation?.meanBoundaryF,
      warm: request.cachedEmbeddingProvider === provider.id,
      estimatedWorkingSetBytes,
      warmPromptP95Ms: provider.warmPromptP95Ms,
      scoreComponents: {} as PromptedProviderRanking['scoreComponents'],
    };

    const rejection =
      checkInstalled(provider) ??
      checkRuntime(provider, request) ??
      checkCapabilities(provider, request) ??
      checkBudget(provider, estimatedWorkingSetBytes, request) ??
      checkValidation(
        provider,
        preferredProviderId === provider.id && request.allowExperimentalProvider === true,
      );

    if (rejection) {
      rejected.push({ providerId: provider.id, code: rejection.code, reason: rejection.reason });
      candidates.push({
        ...base,
        rejectionCode: rejection.code,
        finalRankReason: rejection.reason,
      });
      continue;
    }

    const quality = provider.validation?.meanIoU ?? Number.NEGATIVE_INFINITY;
    eligible.push({
      fact: provider,
      estimatedWorkingSetBytes,
      warm: base.warm,
      quality,
      boundary: provider.validation?.meanBoundaryF ?? Number.NEGATIVE_INFINITY,
      latencyPenalty: 0,
      memoryPenalty: 0,
    });
  }

  if (eligible.length === 0) {
    const allMissing = rejected.every((item) => item.code === 'not-installed');
    const reason = preferredProviderId
      ? `The requested provider (${preferredProviderId}) cannot run for this image and runtime. No other provider was selected automatically. Choose another installed provider explicitly or switch Model preference to Auto.`
      : allMissing
        ? 'Prompted object selection needs an optional local model. Install or download a validated model from this panel, then try again.'
        : 'Prompted object selection is unavailable for this runtime and source size. Install a validated local model or use the model-free selection and brush tools.';
    return {
      providerId: null,
      providerLabel: null,
      encoderId: null,
      decoderId: null,
      reason,
      candidates,
      rejected,
      sourceBytes,
      estimatedWorkingSetBytes: null,
      qualitySource: 'none',
    };
  }

  applyBalancedPenalties(eligible);
  const preference = request.preference;
  const band = request.qualityEquivalenceBand ?? PROMPTED_QUALITY_EQUIVALENCE_BAND;

  const byQuality = [...eligible].sort((left, right) => {
    if (right.quality !== left.quality) return right.quality - left.quality;
    if (right.boundary !== left.boundary) return right.boundary - left.boundary;
    return compareStable(left, right);
  });

  let ordered: RankedProvider[];
  if (preference === 'quality') {
    ordered = byQuality;
  } else if (preference === 'fast') {
    ordered = [...eligible].sort(compareSpeed);
  } else {
    const best = byQuality[0]!;
    const runnerUp = byQuality[1];
    const material = !runnerUp || best.quality - runnerUp.quality > band + Number.EPSILON;
    if (material) {
      ordered = byQuality;
    } else {
      const inBand = eligible.filter(
        (candidate) => candidate.quality >= best.quality - band - Number.EPSILON,
      );
      ordered =
        preference === 'balanced'
          ? [...inBand].sort(compareBalanced).concat(eligible.filter((c) => !inBand.includes(c)))
          : [...inBand]
              .sort(compareAutoTieBreak)
              .concat(eligible.filter((c) => !inBand.includes(c)));
    }
  }

  const selected = ordered[0]!;
  const estimatedWorkingSetBytes = selected.estimatedWorkingSetBytes;
  const routeReason = buildReason(request, selected, ordered, band);

  for (const ranked of ordered) {
    const rankReason =
      ranked.fact.id === selected.fact.id
        ? routeReason
        : describeLoser(request, ranked, selected, band);
    candidates.push({
      providerId: ranked.fact.id,
      label: ranked.fact.label,
      eligible: true,
      validatedMeanIoU: ranked.fact.validation?.meanIoU,
      validatedMeanBoundaryF: ranked.fact.validation?.meanBoundaryF,
      warm: ranked.warm,
      estimatedWorkingSetBytes: ranked.estimatedWorkingSetBytes,
      warmPromptP95Ms: ranked.fact.warmPromptP95Ms,
      scoreComponents: {
        qualityUtility: ranked.quality === Number.NEGATIVE_INFINITY ? undefined : ranked.quality,
        latencyPenalty: ranked.latencyPenalty,
        memoryPenalty: ranked.memoryPenalty,
      },
      finalRankReason: rankReason,
    });
  }

  return {
    providerId: selected.fact.id,
    providerLabel: selected.fact.label,
    encoderId: selected.fact.encoderId,
    decoderId: selected.fact.decoderId,
    reason: routeReason,
    candidates,
    rejected,
    sourceBytes,
    estimatedWorkingSetBytes,
    qualitySource: selected.fact.validation ? 'validated-corpus' : 'none',
  };
}

function checkInstalled(
  provider: PromptedProviderFact,
): { code: PromptedRoutingRejectionCode; reason: string } | null {
  if (provider.installed) return null;
  return {
    code: 'not-installed',
    reason: `${provider.label} is not installed locally. Install or download it explicitly from the model panel; automatic routing never starts a download.`,
  };
}

function checkRuntime(
  provider: PromptedProviderFact,
  request: PromptedRoutingRequest,
): { code: PromptedRoutingRejectionCode; reason: string } | null {
  if (provider.supportedExecutionProviders.includes(request.executionProvider)) return null;
  return {
    code: 'unsupported-runtime',
    reason: `${provider.label} is not validated for ${executionProviderLabel(request.executionProvider)} on this platform.`,
  };
}

function checkCapabilities(
  provider: PromptedProviderFact,
  request: PromptedRoutingRequest,
): { code: PromptedRoutingRejectionCode; reason: string } | null {
  const required = request.requiredCapabilities;
  if (!required) return null;
  const missing = (Object.keys(required) as Array<keyof PromptedRequiredCapabilities>).filter(
    (capability) => required[capability] === true && provider.capabilities[capability] !== true,
  );
  if (missing.length === 0) return null;
  return {
    code: 'missing-capability',
    reason: `${provider.label} cannot provide the requested ${missing.join(', ')} prompt.`,
  };
}

function checkBudget(
  provider: PromptedProviderFact,
  estimatedWorkingSetBytes: number,
  request: PromptedRoutingRequest,
): { code: PromptedRoutingRejectionCode; reason: string } | null {
  if (request.safeWorkingSetBytes == null) return null;
  if (estimatedWorkingSetBytes <= request.safeWorkingSetBytes) return null;
  return {
    code: 'exceeds-hard-budget',
    reason: `${provider.label} needs about ${formatBytes(estimatedWorkingSetBytes)}, above the current ${formatBytes(request.safeWorkingSetBytes)} working-set budget.`,
  };
}

function checkValidation(
  provider: PromptedProviderFact,
  allowExperimental: boolean,
): { code: PromptedRoutingRejectionCode; reason: string } | null {
  if (provider.experimental && !allowExperimental) {
    return {
      code: 'experimental-provider',
      reason: `${provider.label} is experimental and cannot be selected automatically. Choose it explicitly if you want to test it; model quality scores are not a probability of user intent.`,
    };
  }
  const validation = provider.validation;
  if (!validation?.validated) {
    return {
      code: 'unvalidated',
      reason: `${provider.label} has no measured object-selection validation record, so it cannot outrank a validated provider automatically.`,
    };
  }
  if (validation.meanIoU < PROMPTED_MIN_MEAN_IOU) {
    return {
      code: 'below-quality-floor',
      reason: `${provider.label} measured mean IoU ${formatQuality(validation.meanIoU)}, below the ${PROMPTED_MIN_MEAN_IOU.toFixed(2)} usability floor (${validation.corpusVersion}).`,
    };
  }
  if (validation.meanBoundaryF < PROMPTED_MIN_MEAN_BOUNDARY_F) {
    return {
      code: 'below-quality-floor',
      reason: `${provider.label} measured mean boundary F ${formatQuality(validation.meanBoundaryF)}, below the ${PROMPTED_MIN_MEAN_BOUNDARY_F.toFixed(2)} usability floor (${validation.corpusVersion}).`,
    };
  }
  if (validation.worstCriticalIoU < PROMPTED_MIN_CRITICAL_IOU) {
    return {
      code: 'below-quality-floor',
      reason: `${provider.label} measured IoU ${formatQuality(validation.worstCriticalIoU)} on ${worstCriticalCategory(validation) ?? 'a critical category'}, below the ${PROMPTED_MIN_CRITICAL_IOU.toFixed(2)} critical-category floor.`,
    };
  }
  if (validation.worstCriticalBoundaryF < PROMPTED_MIN_CRITICAL_BOUNDARY_F) {
    return {
      code: 'below-quality-floor',
      reason: `${provider.label} measured boundary F ${formatQuality(validation.worstCriticalBoundaryF)} on ${worstCriticalCategory(validation) ?? 'a critical category'}, below the ${PROMPTED_MIN_CRITICAL_BOUNDARY_F.toFixed(2)} critical-category floor.`,
    };
  }
  return null;
}

function worstCriticalCategory(validation: PromptedQualityValidation): string | null {
  let worst: string | null = null;
  let worstValue = Number.POSITIVE_INFINITY;
  for (const category of validation.criticalCategories) {
    const value = validation.categoryIoU[category];
    if (value != null && value < worstValue) {
      worst = category;
      worstValue = value;
    }
  }
  return worst;
}

function applyBalancedPenalties(providers: RankedProvider[]): void {
  const latencies = providers.map((provider) => latencyOf(provider.fact));
  const memories = providers.map((provider) => provider.estimatedWorkingSetBytes);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);
  const minMemory = Math.min(...memories);
  const maxMemory = Math.max(...memories);
  for (const provider of providers) {
    const latency = latencyOf(provider.fact);
    const latencySpan = maxLatency - minLatency;
    const memorySpan = maxMemory - minMemory;
    provider.latencyPenalty =
      latencySpan > 0
        ? PROMPTED_BALANCED_MAX_LATENCY_PENALTY * ((latency - minLatency) / latencySpan)
        : 0;
    provider.memoryPenalty =
      memorySpan > 0
        ? PROMPTED_BALANCED_MAX_MEMORY_PENALTY *
          ((provider.estimatedWorkingSetBytes - minMemory) / memorySpan)
        : 0;
  }
}

function latencyOf(provider: PromptedProviderFact): number {
  return provider.warmPromptP95Ms ?? Number.POSITIVE_INFINITY;
}

function compareSpeed(left: RankedProvider, right: RankedProvider): number {
  if (left.warm !== right.warm) return left.warm ? -1 : 1;
  const leftLatency = latencyOf(left.fact);
  const rightLatency = latencyOf(right.fact);
  if (leftLatency !== rightLatency) return leftLatency - rightLatency;
  return compareStable(left, right);
}

function compareAutoTieBreak(left: RankedProvider, right: RankedProvider): number {
  if (left.warm !== right.warm) return left.warm ? -1 : 1;
  const leftLatency = latencyOf(left.fact);
  const rightLatency = latencyOf(right.fact);
  if (leftLatency !== rightLatency) return leftLatency - rightLatency;
  if (left.estimatedWorkingSetBytes !== right.estimatedWorkingSetBytes) {
    return left.estimatedWorkingSetBytes - right.estimatedWorkingSetBytes;
  }
  return compareStable(left, right);
}

function compareBalanced(left: RankedProvider, right: RankedProvider): number {
  const leftScore = left.quality - left.latencyPenalty - left.memoryPenalty;
  const rightScore = right.quality - right.latencyPenalty - right.memoryPenalty;
  if (Math.abs(rightScore - leftScore) > Number.EPSILON) return rightScore - leftScore;
  return compareAutoTieBreak(left, right);
}

function compareStable(left: RankedProvider, right: RankedProvider): number {
  if (left.fact.id === right.fact.id) return 0;
  return left.fact.id < right.fact.id ? -1 : 1;
}

function buildReason(
  request: PromptedRoutingRequest,
  selected: RankedProvider,
  ordered: RankedProvider[],
  band: number,
): string {
  const runtime = executionProviderLabel(request.executionProvider);
  const provider = selected.fact;
  const validation = provider.validation!;
  const budget = request.safeWorkingSetBytes;
  const budgetClause =
    budget != null
      ? `; estimated working set ${formatBytes(selected.estimatedWorkingSetBytes)} within the ${formatBytes(budget)} budget`
      : '';
  const warmClause = selected.warm ? '; warm embedding available' : '';
  const latencyClause =
    provider.warmPromptP95Ms != null
      ? `; measured warm prompt p95 ${Math.round(provider.warmPromptP95Ms)} ms${provider.warmPromptP95Source === 'estimated' ? ' (estimated)' : ''}`
      : '';

  if (request.preferredProviderId && request.preferredProviderId !== 'auto') {
    return `Selected ${provider.label} (explicit provider choice): validated mean IoU ${formatQuality(validation.meanIoU)} and boundary F ${formatQuality(validation.meanBoundaryF)} clear the safety floors; ${runtime} runtime${budgetClause}${warmClause}${provider.experimental ? '; experimental provider explicitly enabled' : ''}.`;
  }

  if (request.preference === 'fast') {
    const runnerUp = ordered[1];
    const comparison =
      runnerUp && runnerUp.fact.warmPromptP95Ms != null
        ? ` vs ${Math.round(runnerUp.fact.warmPromptP95Ms)} ms for ${runnerUp.fact.label}`
        : '';
    return `Selected ${provider.label} (fast): validated mean IoU ${formatQuality(validation.meanIoU)} clears the safety floor; warm prompt p95 ${Math.round(provider.warmPromptP95Ms ?? 0)} ms${comparison}; ${runtime} runtime${budgetClause}${warmClause}.`;
  }

  if (request.preference === 'quality') {
    return `Selected ${provider.label} (quality preference): highest validated quality (mean IoU ${formatQuality(validation.meanIoU)}, boundary F ${formatQuality(validation.meanBoundaryF)}); ${runtime} runtime${budgetClause}${warmClause}.`;
  }

  if (request.preference === 'balanced') {
    const score = selected.quality - selected.latencyPenalty - selected.memoryPenalty;
    return `Selected ${provider.label} (balanced): normalized score ${score.toFixed(3)} from validated quality ${formatQuality(selected.quality)} minus latency/memory penalties; ${runtime} runtime${budgetClause}${warmClause}${latencyClause}.`;
  }

  const runnerUp = ordered.find((candidate) => candidate.fact.id !== provider.id);
  const materiallyBetter =
    runnerUp != null && provider.validation!.meanIoU - runnerUp.quality > band + Number.EPSILON;
  if (materiallyBetter && runnerUp) {
    return `Selected ${provider.label} (auto): validated mean IoU ${formatQuality(validation.meanIoU)} vs ${formatQuality(runnerUp.quality)} for ${runnerUp.fact.label} — a material quality advantage above the ${band.toFixed(2)} equivalence band; ${runtime} runtime${budgetClause}${warmClause}.`;
  }
  return `Selected ${provider.label} (auto): validated quality is within the ${band.toFixed(2)} equivalence band of the other feasible provider${runnerUp ? ` (${runnerUp.fact.label}, mean IoU ${formatQuality(runnerUp.quality)})` : ''}; preferred on ${selected.warm ? 'warm embedding, ' : ''}measured prompt latency, memory, and stable provider id; ${runtime} runtime${budgetClause}${latencyClause}.`;
}

function describeLoser(
  request: PromptedRoutingRequest,
  ranked: RankedProvider,
  selected: RankedProvider,
  band: number,
): string {
  const reason =
    request.preference === 'fast'
      ? `Feasible; slower measured prompt p95 (${formatLatency(ranked.fact)} vs ${formatLatency(selected.fact)}).`
      : // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        ranked.quality < selected.quality - band
        ? `Feasible; lower validated quality (${formatQuality(
            ranked.fact.validation?.meanIoU ?? 0,
          )} vs ${formatQuality(selected.fact.validation!.meanIoU)}).`
        : `Feasible and quality-equivalent; ${describeTieBreakLoser(request, ranked, selected)}.`;
  return reason;
}

function describeTieBreakLoser(
  request: PromptedRoutingRequest,
  ranked: RankedProvider,
  selected: RankedProvider,
): string {
  if (selected.warm && !ranked.warm) return 'the selected provider had a warm embedding';
  const rankedLatency = latencyOf(ranked.fact);
  const selectedLatency = latencyOf(selected.fact);
  if (rankedLatency !== selectedLatency) {
    return `higher measured prompt latency (${formatLatency(ranked.fact)} vs ${formatLatency(selected.fact)})`;
  }
  if (ranked.estimatedWorkingSetBytes !== selected.estimatedWorkingSetBytes) {
    return `larger estimated working set (${formatBytes(ranked.estimatedWorkingSetBytes)} vs ${formatBytes(selected.estimatedWorkingSetBytes)})`;
  }
  if (request.preference === 'balanced') return 'lower normalized balanced score';
  return 'stable provider-id tie-break';
}

function formatLatency(provider: PromptedProviderFact): string {
  if (provider.warmPromptP95Ms == null) return 'unmeasured';
  const estimate = provider.warmPromptP95Source === 'estimated' ? ' (estimated)' : '';
  return `${Math.round(provider.warmPromptP95Ms)} ms${estimate}`;
}

function executionProviderLabel(provider: PromptedSelectionExecutionProvider): string {
  switch (provider) {
    case 'wasm':
      return 'WASM';
    case 'webgpu':
      return 'WebGPU';
    case 'native':
      return 'native';
    default:
      return 'CPU';
  }
}

function formatQuality(value: number): string {
  return value.toFixed(2);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
