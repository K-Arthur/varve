import assert from 'node:assert/strict';
import test from 'node:test';
import {
  memoryPlateau,
  validateBenchmarkEvent,
  validateCycleEvent,
  validateHardwareExecutionEvidence,
  validateNavigationEvent,
  validatePresentationEvidence,
  validateThrottlingEvidence,
} from './nativeQualification.mjs';

function cycle(index) {
  return {
    type: 'cycleComplete',
    index,
    phases: { open: 'completed', interact: 'completed', close: 'completed' },
    input: { source: 'os', trusted: true, identity: `input-${index}` },
    frame: { changed: true, identity: `frame-${index}` },
    rendererPath: 'webgl2',
    gpuSubmittedItems: 12,
    gpuTextureBytes: 1024,
    gpuTextureEntries: 1,
    applicationCacheBytes: 2048,
    throttlingEvidence: {
      cpu: { status: 'clear', source: 'kernel-counter' },
      gpu: { status: 'clear', source: 'driver-telemetry' },
    },
  };
}

test('cycle evidence requires all lifecycle phases, trusted OS input, and bounded texture residency', () => {
  assert.deepEqual(validateCycleEvent(cycle(1), 1), []);
  const invalid = cycle(2);
  invalid.phases.close = 'missing';
  invalid.input.trusted = false;
  invalid.gpuTextureBytes = 40 * 1024 * 1024;
  assert.ok(validateCycleEvent(invalid, 2).includes('close-phase-not-completed'));
  assert.ok(validateCycleEvent(invalid, 2).includes('input-not-os-trusted'));
  assert.ok(validateCycleEvent(invalid, 2).includes('gpu-texture-residency-over-32-mib'));
});

test('navigation event identity and foreground are required; presentation must correlate both ids', () => {
  const event = {
    type: 'navigationInteraction',
    index: 1,
    foreground: true,
    input: {
      source: 'os',
      trusted: true,
      identity: 'input-1',
      clockId: 'host-monotonic',
      monotonicTimestampMs: 1000,
    },
    frame: { changed: true, identity: 'frame-1' },
    rendererPath: 'webgl2',
    gpuSubmittedItems: 8,
    gpuSubmissionIdentity: 'submission-1',
    hardwareExecution: 'verified-hardware',
    hardwareExecutionEvidence: {
      source: 'gpu-trace',
      submissionIdentity: 'submission-1',
      executionIdentity: 'gpu-work-1',
      deviceProfileId: 'local-profile-hash',
      softwareRenderer: false,
    },
    gpuTextureBytes: 1024,
    gpuTextureEntries: 1,
    applicationCacheBytes: 2048,
    throttlingEvidence: {
      cpu: { status: 'clear', source: 'kernel-counter' },
      gpu: { status: 'clear', source: 'driver-telemetry' },
    },
    presentation: {
      source: 'optical',
      clockTrust: 'trusted',
      clockId: 'host-monotonic',
      monotonicTimestampMs: 1016.7,
      inputIdentity: 'input-1',
      contentFrameIdentity: 'frame-1',
      uncertaintyMs: 0.2,
      inputToPresentationMs: 16.7,
    },
  };
  assert.deepEqual(validateNavigationEvent(event, 1), []);
  assert.equal(validatePresentationEvidence(event).authoritative, true);
  assert.ok(
    Math.abs(validatePresentationEvidence(event).measuredInputToPresentationMs - 16.7) < 1e-9,
  );
  event.presentation.contentFrameIdentity = 'other-frame';
  assert.equal(validatePresentationEvidence(event).authoritative, false);
});

test('native comparison cells accept only the requested Canvas2D path and frozen scenario labels', () => {
  const event = {
    type: 'benchmarkInteraction',
    index: 1,
    fixture: 'vector-1k',
    workload: 'pan',
    block: 2,
    foreground: true,
    input: { source: 'os', trusted: true, identity: 'input-1' },
    frame: { changed: true, identity: 'frame-1' },
    rendererPath: 'canvas2d-worker',
    applicationCacheBytes: 2048,
    throttlingEvidence: {
      cpu: { status: 'clear', source: 'kernel-counter' },
      gpu: { status: 'clear', source: 'driver-counter' },
    },
  };
  const expected = { renderer: 'canvas2d-worker', fixture: 'vector-1k', workload: 'pan', block: 2 };
  assert.deepEqual(validateBenchmarkEvent(event, 1, expected), []);
  assert.ok(
    validateBenchmarkEvent(event, 1, { ...expected, renderer: 'canvas2d-main' }).includes(
      'canvas2d-drawing-path-not-observed',
    ),
  );
  assert.ok(
    validateBenchmarkEvent(event, 1, { ...expected, fixture: 'raster-heavy' }).includes(
      'benchmark-fixture-mismatch',
    ),
  );
});

test('presentation timing rejects uncorrelated clocks and timestamp arithmetic', () => {
  const event = {
    input: { identity: 'input-1', clockId: 'os-monotonic', monotonicTimestampMs: 1000 },
    frame: { identity: 'frame-1' },
    presentation: {
      source: 'native-profiler-correlated',
      clockTrust: 'trusted',
      clockId: 'display-clock',
      monotonicTimestampMs: 1016.7,
      inputIdentity: 'input-1',
      contentFrameIdentity: 'frame-1',
      inputToPresentationMs: 16.7,
      uncertaintyMs: 0.2,
    },
  };
  assert.equal(validatePresentationEvidence(event).authoritative, false);
  event.presentation.clockCorrelation = {
    verified: true,
    sourceClockId: 'os-monotonic',
    targetClockId: 'display-clock',
    offsetMs: 0,
    uncertaintyMs: 0.1,
  };
  assert.equal(validatePresentationEvidence(event).authoritative, true);
  event.presentation.inputToPresentationMs = 9;
  assert.equal(validatePresentationEvidence(event).authoritative, false);
});

test('GPU evidence must correlate a real hardware execution to a submission', () => {
  const event = {
    hardwareExecution: 'verified-hardware',
    gpuSubmissionIdentity: 'submission-1',
    hardwareExecutionEvidence: {
      source: 'vulkan-enumeration',
      submissionIdentity: 'submission-2',
      executionIdentity: 'device-enumerated',
      deviceProfileId: 'local-profile-hash',
      softwareRenderer: false,
    },
  };
  const blockers = validateHardwareExecutionEvidence(event);
  assert.ok(blockers.includes('independent-gpu-execution-evidence-unavailable'));
  assert.ok(blockers.includes('gpu-execution-not-correlated-to-submission'));
  event.hardwareExecutionEvidence.source = 'gpu-trace';
  event.hardwareExecutionEvidence.submissionIdentity = 'submission-1';
  event.hardwareExecutionEvidence.softwareRenderer = true;
  assert.ok(
    validateHardwareExecutionEvidence(event).includes(
      'software-or-unknown-renderer-is-compatibility-only',
    ),
  );
});

test('native timing requires independent clear CPU and GPU throttle telemetry', () => {
  assert.deepEqual(
    validateThrottlingEvidence({
      cpu: { status: 'clear', source: 'kernel-counter' },
      gpu: { status: 'clear', source: 'driver-counter' },
    }),
    [],
  );
  assert.deepEqual(
    validateThrottlingEvidence({
      cpu: { status: 'throttled', source: 'kernel-counter' },
      gpu: { status: 'unavailable', source: null },
    }),
    ['cpu-throttling-detected', 'gpu-throttling-status-unavailable'],
  );
});

test('memory plateau compares the final two consecutive 20-cycle medians', () => {
  assert.deepEqual(memoryPlateau(Array(39).fill(100_000)).passed, false);
  assert.equal(memoryPlateau(Array(20).fill(100_000).concat(Array(20).fill(108_000))).passed, true);
  assert.equal(
    memoryPlateau(Array(20).fill(100_000).concat(Array(20).fill(109_000))).passed,
    false,
  );
  assert.equal(
    memoryPlateau(Array(20).fill(100_000_000).concat(Array(20).fill(108_000_000)), {
      absoluteAllowance: 8 * 1024 * 1024,
      unit: 'bytes',
    }).passed,
    true,
  );
  assert.equal(
    memoryPlateau(Array(20).fill(100_000_000).concat(Array(20).fill(109_000_000)), {
      absoluteAllowance: 8 * 1024 * 1024,
      unit: 'bytes',
    }).passed,
    false,
  );
});
