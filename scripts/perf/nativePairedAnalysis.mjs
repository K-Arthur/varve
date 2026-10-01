import { validateBenchmarkEvent, validatePresentationEvidence } from './nativeQualification.mjs';
import { decideQualification } from './qualificationAnalysis.mjs';

function sorted(values) {
  return values.filter(Number.isFinite).sort((a, b) => a - b);
}

function nearest(values, percentile) {
  const ascending = sorted(values);
  if (!ascending.length) return null;
  return ascending[Math.max(0, Math.ceil((percentile / 100) * ascending.length) - 1)] ?? null;
}

function median(values) {
  const ascending = sorted(values);
  if (!ascending.length) return null;
  const center = Math.floor(ascending.length / 2);
  return ascending.length % 2 ? ascending[center] : (ascending[center - 1] + ascending[center]) / 2;
}

function normalize(report, { renderer, fixture, workload, block }) {
  const blockers = [];
  if (report?.mode !== 'benchmark') blockers.push('native-benchmark-mode-required');
  if (report?.status !== 'passed') blockers.push('native-run-not-passed');
  const expectedTargetSignal =
    report?.driverExit?.signal === 'SIGTERM' &&
    report?.requestedStop === 'interaction-target-reached' &&
    Number.isInteger(report?.targetInteractions) &&
    report.nativeInteractions >= report.targetInteractions;
  if (report?.driverExit?.code !== 0 && !expectedTargetSignal) {
    blockers.push('native-driver-did-not-exit-cleanly');
  }
  if (report?.blockers?.length !== 0) blockers.push('native-run-has-recorded-blockers');
  if (report?.source?.dirty !== false) blockers.push('native-source-not-clean');
  if (
    typeof report?.source?.commit !== 'string' ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(report.source.commit)
  ) {
    blockers.push('native-source-commit-unavailable');
  }
  if (
    typeof report?.source?.binarySha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(report.source.binarySha256)
  ) {
    blockers.push('native-binary-hash-unavailable');
  }
  if (
    typeof report?.scenario?.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(report.scenario.sha256)
  ) {
    blockers.push('frozen-scenario-hash-unavailable');
  }
  if (report?.host?.platform !== 'linux') blockers.push('native-linux-host-required');
  if (report?.renderer !== renderer) blockers.push('native-renderer-mode-mismatch');
  if (report?.fixture !== fixture || report?.workload !== workload)
    blockers.push('native-cell-identity-mismatch');
  if (report?.block !== block) blockers.push('native-block-identity-mismatch');
  if (report?.scenario?.fixtureId !== fixture || report?.scenario?.gestureId !== workload) {
    blockers.push('frozen-scenario-does-not-match-native-cell');
  }
  if (
    !Array.isArray(report?.scenario?.assetSha256s) ||
    report.scenario.assetSha256s.some((hash) => !/^[a-f0-9]{64}$/i.test(hash))
  ) {
    blockers.push('frozen-scenario-assets-unavailable');
  }

  const allEvents = Array.isArray(report?.events) ? report.events : [];
  if (report?.nativeInteractions !== allEvents.length) blockers.push('native-event-count-mismatch');
  if (report?.invalidEvents?.length) blockers.push('native-run-contains-invalid-events');
  const events = [];
  const inputIdentities = new Set();
  const frameIdentities = new Set();
  const submissionIdentities = new Set();
  const executionIdentities = new Set();
  for (let index = 0; index < allEvents.length; index++) {
    const event = allEvents[index];
    for (const [identity, seen, reason] of [
      [event?.inputIdentity, inputIdentities, 'input-identity-reused'],
      [event?.frameIdentity, frameIdentities, 'content-frame-identity-reused'],
      ...(renderer === 'webgl2'
        ? [
            [event?.gpuSubmissionIdentity, submissionIdentities, 'gpu-submission-identity-reused'],
            [
              event?.hardwareExecutionEvidence?.executionIdentity,
              executionIdentities,
              'gpu-execution-identity-reused',
            ],
          ]
        : []),
    ]) {
      if (typeof identity === 'string' && identity.length > 0) {
        if (seen.has(identity)) blockers.push(`event-${index + 1}:${reason}`);
        seen.add(identity);
      }
    }
    const reconstructed = {
      type: event?.type,
      index: event?.index,
      fixture: event?.fixture,
      workload: event?.workload,
      block: event?.block,
      foreground: event?.foreground,
      input: {
        source: event?.inputSource,
        trusted: event?.inputTrusted,
        identity: event?.inputIdentity,
        clockId: event?.inputClockId,
        monotonicTimestampMs: event?.inputMonotonicTimestampMs,
      },
      frame: { changed: event?.frameChanged, identity: event?.frameIdentity },
      rendererPath: event?.rendererPath,
      hardwareExecution: event?.hardwareExecution,
      hardwareExecutionEvidence: event?.hardwareExecutionEvidence,
      gpuSubmissionIdentity: event?.gpuSubmissionIdentity,
      gpuSubmittedItems: event?.gpuSubmittedItems,
      gpuTextureBytes: event?.gpuTextureBytes,
      gpuTextureEntries: event?.gpuTextureEntries,
      applicationCacheBytes: event?.applicationCacheBytes,
      throttlingEvidence: event?.throttlingEvidence,
      presentation: {
        source: event?.declaredPresentationSource,
        clockTrust: event?.presentationClockTrust,
        clockId: event?.presentationClockId,
        monotonicTimestampMs: event?.presentationMonotonicTimestampMs,
        clockCorrelation: event?.presentationClockCorrelation,
        inputIdentity: event?.inputIdentity,
        contentFrameIdentity: event?.frameIdentity,
        uncertaintyMs: event?.declaredPresentationUncertaintyMs,
        inputToPresentationMs: event?.declaredInputToPresentationMs,
      },
    };
    const eventBlockers = validateBenchmarkEvent(reconstructed, index + 1, {
      renderer,
      fixture,
      workload,
      block,
    });
    if (eventBlockers.length)
      blockers.push(...eventBlockers.map((reason) => `event-${index + 1}:${reason}`));
    const presentation = validatePresentationEvidence(reconstructed);
    if (!presentation.authoritative) {
      blockers.push(`event-${index + 1}:presentation-evidence-invalid`);
      continue;
    }
    if (
      !Number.isFinite(event?.inputToPresentationMs) ||
      Math.abs(event.inputToPresentationMs - presentation.measuredInputToPresentationMs) > 1e-6 ||
      Math.abs(event.presentationUncertaintyMs - presentation.totalUncertaintyMs) > 1e-6
    ) {
      blockers.push(`event-${index + 1}:validated-presentation-summary-mismatch`);
      continue;
    }
    events.push({ ...event, inputToPresentationMs: presentation.measuredInputToPresentationMs });
  }
  if (events.length < 100) blockers.push('fewer-than-100-authoritative-presentation-samples');
  if (report?.authoritativePresentationSamples !== events.length) {
    blockers.push('authoritative-presentation-count-mismatch');
  }
  if (report?.presentationUnavailableSamples !== allEvents.length - events.length) {
    blockers.push('unavailable-presentation-count-mismatch');
  }
  if (renderer === 'webgl2') {
    if (report?.hardwareExecution !== 'driver-reported-hardware')
      blockers.push('physical-gpu-execution-unverified');
    if (events.some((event) => !['webgl2', 'webgl2-mixed'].includes(event.rendererPath))) {
      blockers.push('one-or-more-webgl2-samples-lack-correlated-hardware-execution');
    }
  } else if (events.some((event) => event.rendererPath !== renderer)) {
    blockers.push('one-or-more-canvas2d-samples-used-another-path');
  }
  const values = events.map((event) => event.inputToPresentationMs);
  const calculatedP95 = nearest(values, 95);
  if (
    report?.inputToPresentationMs?.count !== values.length ||
    report?.inputToPresentationMs?.p95 !== calculatedP95
  ) {
    blockers.push('native-presentation-summary-does-not-match-raw-events');
  }
  return {
    blockers,
    valid: blockers.length === 0,
    values,
    p95: calculatedP95,
    report,
  };
}

export function summarizeNativeRun(report, expected) {
  const normalized = normalize(report, expected);
  const profileIds = new Set(
    normalized.report?.events
      ?.map((event) => event.hardwareExecutionEvidence?.deviceProfileId)
      .filter((value) => typeof value === 'string') ?? [],
  );
  return {
    valid: normalized.valid,
    blockers: normalized.blockers,
    p95: normalized.p95,
    sampleCount: normalized.values.length,
    identity: {
      commit: normalized.report?.source?.commit ?? null,
      binarySha256: normalized.report?.source?.binarySha256 ?? null,
      scenarioSha256: normalized.report?.scenario?.sha256 ?? null,
      host: normalized.report?.host ?? null,
      gpuDeviceProfileId: profileIds.size === 1 ? [...profileIds][0] : null,
    },
  };
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function bootstrapInterval(
  pairs,
  metric,
  { draws = 10_000, withinDraws = 500, seed = 0x71e4 } = {},
) {
  if (!pairs.length) return { count: 0, lower95: null, upper95: null };
  const next = random(seed);
  const withWithinRunSamples = pairs.map((pair) => {
    const samples = (values) =>
      Array.from({ length: withinDraws }, () => {
        const resampled = Array.from(
          { length: values.length },
          () => values[Math.floor(next() * values.length)],
        );
        return nearest(resampled, 95);
      });
    return {
      canvasP95: samples(pair.canvas2d.values),
      webglP95: samples(pair.webgl2.values),
    };
  });
  const distribution = [];
  for (let draw = 0; draw < draws; draw++) {
    const changes = [];
    for (let index = 0; index < pairs.length; index++) {
      const pairIndex = Math.floor(next() * pairs.length);
      const block = withWithinRunSamples[pairIndex];
      const canvasP95 = block.canvasP95[Math.floor(next() * block.canvasP95.length)];
      const webglP95 = block.webglP95[Math.floor(next() * block.webglP95.length)];
      if (canvasP95 > 0 && webglP95 !== null) {
        changes.push(
          metric === 'regression'
            ? ((webglP95 - canvasP95) / canvasP95) * 100
            : ((canvasP95 - webglP95) / canvasP95) * 100,
        );
      }
    }
    if (changes.length) distribution.push(nearest(changes, 50));
  }
  return {
    count: pairs.length,
    lower95: nearest(distribution, 2.5),
    upper95: nearest(distribution, 97.5),
    method: `nested paired-block and OS-input-to-presentation gesture bootstrap (${metric}; ${draws}×${withinDraws})`,
  };
}

/** Compare raw native presentation samples only when each run has exact matching provenance. */
export function analyzeNativeCell({ id, fixture, workload, baselineRenderer, pairs }) {
  const accepted = [];
  const rejected = [];
  let referenceIdentity = null;
  const seenBlocks = new Set();
  for (const pair of pairs) {
    const canvas2d = normalize(pair.canvas2d, {
      renderer: baselineRenderer,
      fixture,
      workload,
      block: pair.block,
    });
    const webgl2 = normalize(pair.webgl2, {
      renderer: 'webgl2',
      fixture,
      workload,
      block: pair.block,
    });
    const identityBlockers = [];
    if (canvas2d.valid && webgl2.valid) {
      const canvasIdentity = canvas2d.report;
      const webglIdentity = webgl2.report;
      const sameRun =
        canvasIdentity.source.commit === webglIdentity.source.commit &&
        canvasIdentity.source.binarySha256 === webglIdentity.source.binarySha256 &&
        canvasIdentity.scenario.sha256 === webglIdentity.scenario.sha256 &&
        JSON.stringify(canvasIdentity.host) === JSON.stringify(webglIdentity.host) &&
        canvasIdentity.scenario.fixtureSha256 === webglIdentity.scenario.fixtureSha256 &&
        canvasIdentity.scenario.gestureSequenceSha256 ===
          webglIdentity.scenario.gestureSequenceSha256;
      if (!sameRun) identityBlockers.push('paired-runs-differ-in-source-binary-host-or-scenario');
      const profileIds = new Set(
        webglIdentity.events
          .map((event) => event.hardwareExecutionEvidence?.deviceProfileId)
          .filter((value) => typeof value === 'string'),
      );
      if (profileIds.size !== 1)
        identityBlockers.push('gpu-device-profile-varies-within-webgl-run');
      const identity = {
        commit: webglIdentity.source.commit,
        binarySha256: webglIdentity.source.binarySha256,
        scenarioSha256: webglIdentity.scenario.sha256,
        host: webglIdentity.host,
        gpuDeviceProfileId: [...profileIds][0] ?? null,
      };
      if (referenceIdentity && JSON.stringify(referenceIdentity) !== JSON.stringify(identity)) {
        identityBlockers.push('paired-blocks-differ-in-source-binary-host-scenario-or-gpu-profile');
      }
      if (!referenceIdentity && identityBlockers.length === 0) referenceIdentity = identity;
    }
    const blockers = [...canvas2d.blockers, ...webgl2.blockers, ...identityBlockers];
    if (seenBlocks.has(pair.block)) blockers.push('duplicate-paired-block-index');
    seenBlocks.add(pair.block);
    if (canvas2d.p95 !== null && canvas2d.p95 <= 0) blockers.push('canvas2d-p95-must-be-positive');
    if (blockers.length) {
      rejected.push({ block: pair.block, blockers: [...new Set(blockers)] });
      continue;
    }
    accepted.push({ block: pair.block, canvas2d, webgl2 });
  }
  const blockChanges = accepted.map(({ block, canvas2d, webgl2 }) => ({
    block,
    canvas2dP95Ms: canvas2d.p95,
    webgl2P95Ms: webgl2.p95,
    improvementPercent: ((canvas2d.p95 - webgl2.p95) / canvas2d.p95) * 100,
    regressionPercent: ((webgl2.p95 - canvas2d.p95) / canvas2d.p95) * 100,
  }));
  return {
    id,
    fixture,
    workload,
    baselineRenderer,
    blocks: blockChanges,
    validPairCount: blockChanges.length,
    medianCanvas2dRunP95Ms: median(blockChanges.map((pair) => pair.canvas2dP95Ms)),
    medianWebgl2RunP95Ms: median(blockChanges.map((pair) => pair.webgl2P95Ms)),
    medianImprovementPercent: median(blockChanges.map((pair) => pair.improvementPercent)),
    improvementInterval95: bootstrapInterval(accepted, 'improvement'),
    medianRegressionPercent: median(blockChanges.map((pair) => pair.regressionPercent)),
    regressionInterval95: bootstrapInterval(accepted, 'regression', { seed: 0x94bb }),
    rejectedBlocks: rejected,
    identity: referenceIdentity,
  };
}

export { decideQualification };
