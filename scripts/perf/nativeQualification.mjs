/** Pure validation for events emitted by a host-local native qualification driver. */

export function validateNativeInputAndFrame(event) {
  const blockers = [];
  const input = event?.input;
  const frame = event?.frame;
  if (input?.source !== 'os' || input?.trusted !== true) blockers.push('input-not-os-trusted');
  if (typeof input?.identity !== 'string' || input.identity.length === 0) {
    blockers.push('input-identity-missing');
  }
  if (frame?.changed !== true) blockers.push('content-frame-not-confirmed-changed');
  if (typeof frame?.identity !== 'string' || frame.identity.length === 0) {
    blockers.push('content-frame-identity-missing');
  }
  if (input?.identity && input.identity === frame?.identity) {
    blockers.push('input-and-frame-identities-not-distinct');
  }
  return blockers;
}

export function validateHardwareExecutionEvidence(event) {
  const evidence = event?.hardwareExecutionEvidence;
  const blockers = [];
  if (event?.hardwareExecution !== 'verified-hardware') {
    blockers.push('physical-gpu-execution-not-verified');
  }
  if (!['api-profiler', 'driver-counter', 'gpu-trace'].includes(evidence?.source)) {
    blockers.push('independent-gpu-execution-evidence-unavailable');
  }
  if (
    typeof event?.gpuSubmissionIdentity !== 'string' ||
    event.gpuSubmissionIdentity.length === 0 ||
    evidence?.submissionIdentity !== event.gpuSubmissionIdentity ||
    typeof evidence?.executionIdentity !== 'string' ||
    evidence.executionIdentity.length === 0
  ) {
    blockers.push('gpu-execution-not-correlated-to-submission');
  }
  if (typeof evidence?.deviceProfileId !== 'string' || evidence.deviceProfileId.length === 0) {
    blockers.push('gpu-device-profile-identity-unavailable');
  }
  if (evidence?.softwareRenderer !== false) {
    blockers.push('software-or-unknown-renderer-is-compatibility-only');
  }
  return blockers;
}

export function validateThrottlingEvidence(value) {
  const blockers = [];
  for (const component of ['cpu', 'gpu']) {
    const reading = value?.[component];
    if (
      !['clear', 'throttled'].includes(reading?.status) ||
      typeof reading?.source !== 'string' ||
      reading.source.length === 0
    ) {
      blockers.push(`${component}-throttling-status-unavailable`);
    } else if (reading.status === 'throttled') {
      blockers.push(`${component}-throttling-detected`);
    }
  }
  return blockers;
}

export function validateCycleEvent(event, expectedIndex) {
  const blockers = [];
  if (event?.type !== 'cycleComplete') blockers.push('cycle-event-type-invalid');
  if (event?.index !== expectedIndex) blockers.push('cycle-sequence-invalid');
  for (const phase of ['open', 'interact', 'close']) {
    if (event?.phases?.[phase] !== 'completed') blockers.push(`${phase}-phase-not-completed`);
  }
  blockers.push(...validateNativeInputAndFrame(event));
  if (event?.rendererPath !== 'webgl2' && event?.rendererPath !== 'webgl2-mixed') {
    blockers.push('webgl2-drawing-path-not-observed');
  }
  if (!Number.isInteger(event?.gpuSubmittedItems) || event.gpuSubmittedItems < 1) {
    blockers.push('webgl2-submissions-not-observed');
  }
  if (!Number.isFinite(event?.gpuTextureBytes) || event.gpuTextureBytes < 0) {
    blockers.push('gpu-texture-residency-unavailable');
  } else if (event.gpuTextureBytes > 32 * 1024 * 1024) {
    blockers.push('gpu-texture-residency-over-32-mib');
  }
  if (!Number.isInteger(event?.gpuTextureEntries) || event.gpuTextureEntries < 0) {
    blockers.push('gpu-texture-entry-count-unavailable');
  } else if (event.gpuTextureEntries > 32) {
    blockers.push('gpu-texture-entry-count-over-32');
  }
  if (!Number.isFinite(event?.applicationCacheBytes) || event.applicationCacheBytes < 0) {
    blockers.push('application-cache-residency-unavailable');
  }
  return blockers;
}

export function validateNavigationEvent(
  event,
  expectedIndex,
  expectedRenderer = 'webgl2',
  expectedType = 'navigationInteraction',
) {
  const blockers = [];
  if (event?.type !== expectedType) blockers.push('navigation-event-type-invalid');
  if (event?.index !== expectedIndex) blockers.push('navigation-sequence-invalid');
  blockers.push(...validateNativeInputAndFrame(event));
  if (event?.foreground !== true) blockers.push('application-not-confirmed-foreground');
  if (expectedRenderer === 'webgl2') {
    if (event?.rendererPath !== 'webgl2' && event?.rendererPath !== 'webgl2-mixed') {
      blockers.push('webgl2-drawing-path-not-observed');
    }
    if (!Number.isInteger(event?.gpuSubmittedItems) || event.gpuSubmittedItems < 1) {
      blockers.push('webgl2-submissions-not-observed');
    }
    blockers.push(...validateHardwareExecutionEvidence(event));
    if (
      !Number.isFinite(event?.gpuTextureBytes) ||
      event.gpuTextureBytes < 0 ||
      event.gpuTextureBytes > 32 * 1024 * 1024
    ) {
      blockers.push('gpu-texture-residency-unavailable-or-over-limit');
    }
    if (
      !Number.isInteger(event?.gpuTextureEntries) ||
      event.gpuTextureEntries < 0 ||
      event.gpuTextureEntries > 32
    ) {
      blockers.push('gpu-texture-entry-count-unavailable-or-over-limit');
    }
  } else if (
    !['canvas2d-main', 'canvas2d-worker'].includes(expectedRenderer) ||
    event?.rendererPath !== expectedRenderer
  ) {
    blockers.push('canvas2d-drawing-path-not-observed');
  }
  if (!Number.isFinite(event?.applicationCacheBytes) || event.applicationCacheBytes < 0) {
    blockers.push('application-cache-residency-unavailable');
  }
  blockers.push(...validateThrottlingEvidence(event?.throttlingEvidence));
  return blockers;
}

export function validateBenchmarkEvent(
  event,
  expectedIndex,
  { renderer = 'webgl2', fixture, workload, block } = {},
) {
  const blockers = validateNavigationEvent(event, expectedIndex, renderer, 'benchmarkInteraction');
  if (event?.fixture !== fixture) blockers.push('benchmark-fixture-mismatch');
  if (event?.workload !== workload) blockers.push('benchmark-workload-mismatch');
  if (event?.block !== block) blockers.push('benchmark-block-mismatch');
  return blockers;
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Compare the final two 20-sample median windows with a unit-aware allowance. */
export function memoryPlateau(
  samples,
  { absoluteAllowance = 8 * 1024, relativeAllowance = 0.05, unit = 'KiB' } = {},
) {
  if (samples.length < 40) {
    return {
      passed: false,
      reason: 'fewer-than-40-memory-samples',
      earlierMedian: null,
      finalMedian: null,
      growth: null,
      allowedGrowth: null,
      unit,
    };
  }
  const earlier = median(samples.slice(-40, -20));
  const final = median(samples.slice(-20));
  if (earlier === null || final === null) {
    return {
      passed: false,
      reason: 'memory-sample-unavailable',
      earlierMedian: earlier,
      finalMedian: final,
      growth: null,
      allowedGrowth: null,
      unit,
    };
  }
  const growth = final - earlier;
  const allowed = Math.max(absoluteAllowance, earlier * relativeAllowance);
  return {
    passed: growth <= allowed,
    reason: growth <= allowed ? null : 'final-memory-window-exceeds-plateau-limit',
    earlierMedian: earlier,
    finalMedian: final,
    growth,
    allowedGrowth: allowed,
    unit,
  };
}

export function validatePresentationEvidence(event) {
  const evidence = event?.presentation;
  const inputClock = event?.input?.clockId;
  const presentationClock = evidence?.clockId;
  const inputTimestamp = event?.input?.monotonicTimestampMs;
  const presentationTimestamp = evidence?.monotonicTimestampMs;
  let convertedInputTimestamp = inputTimestamp;
  let clockUncertaintyMs = 0;
  if (inputClock !== presentationClock) {
    const correlation = evidence?.clockCorrelation;
    if (
      correlation?.verified !== true ||
      correlation?.sourceClockId !== inputClock ||
      correlation?.targetClockId !== presentationClock ||
      !Number.isFinite(correlation?.offsetMs) ||
      !Number.isFinite(correlation?.uncertaintyMs) ||
      correlation.uncertaintyMs < 0
    ) {
      return { authoritative: false, reason: 'presentation-clock-correlation-unavailable' };
    }
    convertedInputTimestamp += correlation.offsetMs;
    clockUncertaintyMs = correlation.uncertaintyMs;
  }
  const timestampDelta = presentationTimestamp - convertedInputTimestamp;
  const totalUncertaintyMs = (evidence?.uncertaintyMs ?? NaN) + clockUncertaintyMs;
  if (
    (evidence?.source !== 'optical' && evidence?.source !== 'native-profiler-correlated') ||
    evidence?.clockTrust !== 'trusted' ||
    evidence?.inputIdentity !== event?.input?.identity ||
    evidence?.contentFrameIdentity !== event?.frame?.identity ||
    typeof inputClock !== 'string' ||
    inputClock.length === 0 ||
    typeof presentationClock !== 'string' ||
    presentationClock.length === 0 ||
    !Number.isFinite(inputTimestamp) ||
    inputTimestamp < 0 ||
    !Number.isFinite(presentationTimestamp) ||
    presentationTimestamp < 0 ||
    !Number.isFinite(evidence?.uncertaintyMs) ||
    evidence.uncertaintyMs < 0 ||
    !Number.isFinite(evidence?.inputToPresentationMs) ||
    evidence.inputToPresentationMs < 0 ||
    !Number.isFinite(timestampDelta) ||
    timestampDelta < 0 ||
    Math.abs(timestampDelta - evidence.inputToPresentationMs) > totalUncertaintyMs
  ) {
    return {
      authoritative: false,
      reason: 'identity-and-clock-correlated-presentation-unavailable',
    };
  }
  return {
    authoritative: true,
    reason: null,
    measuredInputToPresentationMs: timestampDelta,
    totalUncertaintyMs,
  };
}
