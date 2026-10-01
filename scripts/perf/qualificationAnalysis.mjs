function percentile(sorted, percent) {
  if (sorted.length === 0) return null;
  const position = (percent / 100) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return percentile(sorted, 50);
}

/** Paired-block bootstrap for the median p95 change, deterministic by seed. */
export function bootstrapMedianInterval(values, { draws = 10_000, seed = 0x51a7 } = {}) {
  const samples = values.filter(Number.isFinite);
  if (samples.length === 0) return { count: 0, lower95: null, upper95: null };
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const bootstrapped = [];
  for (let draw = 0; draw < draws; draw++) {
    const resample = Array.from(
      { length: samples.length },
      () => samples[Math.floor(next() * samples.length)],
    );
    bootstrapped.push(median(resample));
  }
  bootstrapped.sort((a, b) => a - b);
  return {
    count: samples.length,
    lower95: percentile(bootstrapped, 2.5),
    upper95: percentile(bootstrapped, 97.5),
  };
}

function comparableRun(run) {
  return Boolean(
    run &&
      run.status === 'ok' &&
      run.validity === 'valid' &&
      run.rendererModeVerified === true &&
      run.identity?.dirty === false &&
      (run.trustedInput?.measuredUntrusted ?? 0) === 0 &&
      (run.trustedInput?.measuredTrusted ?? 0) >= 100 &&
      run.interactions?.inputToCommit?.count >= 100 &&
      Number.isFinite(run.interactions?.inputToCommit?.p95),
  );
}

function nearestPercentile(values, percent) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1);
  return sorted[index] ?? null;
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function rawCommitSamples(run) {
  const values = (run?.rawSamples ?? [])
    .filter((sample) => sample.measurementSelected !== false)
    .filter((sample) => sample.timestampSource === 'dom.event.timeStamp')
    .map((sample) => sample.inputToCommitMs)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return values.length >= 100 ? values : null;
}

/**
 * Lift the workload row from the production runner's report envelope into the
 * paired-analysis shape. Run identity is intentionally stored once per report
 * (not redundantly on every workload row), so carry it onto the row here.
 */
export function qualificationWorkload(run) {
  const workload = run?.result?.workloads?.[0];
  if (!workload) return null;
  return {
    ...workload,
    identity: workload.identity ?? run.result.identity ?? null,
  };
}

/**
 * Nested bootstrap: resample paired blocks and then the interactions inside
 * each selected run. This keeps the run-to-run pairing while accounting for
 * finite gesture samples instead of pretending three run p95s are precise.
 */
function bootstrapPairedInterval(
  pairs,
  metric,
  { draws = 10_000, withinDraws = 500, seed = 0x51a7 } = {},
) {
  const random = createRandom(seed);
  const eligible = pairs
    .map(({ block, canvas2d, webgl2 }) => ({
      block,
      canvasSamples: rawCommitSamples(canvas2d),
      webglSamples: rawCommitSamples(webgl2),
    }))
    .filter(({ canvasSamples, webglSamples }) => canvasSamples && webglSamples)
    .map(({ block, canvasSamples, webglSamples }) => {
      const bootstrapP95 = (values) =>
        Array.from({ length: withinDraws }, () => {
          const resample = Array.from(
            { length: values.length },
            () => values[Math.floor(random() * values.length)],
          );
          return nearestPercentile(resample, 95);
        });
      return {
        block,
        canvasP95: bootstrapP95(canvasSamples),
        webglP95: bootstrapP95(webglSamples),
      };
    });
  if (eligible.length === 0) return { count: 0, lower95: null, upper95: null };
  const bootstrap = [];
  for (let draw = 0; draw < draws; draw++) {
    const improvements = [];
    for (let i = 0; i < eligible.length; i++) {
      const pair = eligible[Math.floor(random() * eligible.length)];
      const canvasP95 = pair.canvasP95[Math.floor(random() * pair.canvasP95.length)];
      const webglP95 = pair.webglP95[Math.floor(random() * pair.webglP95.length)];
      if (canvasP95 > 0 && webglP95 !== null) {
        improvements.push(
          metric === 'regression'
            ? ((webglP95 - canvasP95) / canvasP95) * 100
            : ((canvasP95 - webglP95) / canvasP95) * 100,
        );
      }
    }
    if (improvements.length > 0) bootstrap.push(nearestPercentile(improvements, 50));
  }
  bootstrap.sort((a, b) => a - b);
  return {
    count: eligible.length,
    lower95: nearestPercentile(bootstrap, 2.5),
    upper95: nearestPercentile(bootstrap, 97.5),
    method: `nested paired-block and within-run gesture bootstrap (${metric}; ${draws}×${withinDraws})`,
  };
}

export function pairedP95(samples) {
  const validSamples = samples.filter(
    ({ canvas2d, webgl2 }) => comparableRun(canvas2d) && comparableRun(webgl2),
  );
  const paired = validSamples.map(({ block, canvas2d, webgl2 }) => {
    const baseline = canvas2d.interactions.inputToCommit.p95;
    const accelerated = webgl2.interactions.inputToCommit.p95;
    return {
      block,
      canvas2dP95Ms: baseline,
      webgl2P95Ms: accelerated,
      improvementPercent: ((baseline - accelerated) / baseline) * 100,
      regressionPercent: ((accelerated - baseline) / baseline) * 100,
    };
  });
  const improvements = paired.map((sample) => sample.improvementPercent);
  const regressions = paired.map((sample) => sample.regressionPercent);
  return {
    blocks: paired,
    validPairCount: paired.length,
    canvas2dMedianRunP95Ms: median(paired.map((sample) => sample.canvas2dP95Ms)),
    webgl2MedianRunP95Ms: median(paired.map((sample) => sample.webgl2P95Ms)),
    medianImprovementPercent: median(improvements),
    improvementInterval95: bootstrapPairedInterval(validSamples, 'improvement'),
    medianRegressionPercent: median(regressions),
    regressionInterval95: bootstrapPairedInterval(validSamples, 'regression', { seed: 0xa3c9 }),
    unavailableBlocks: samples
      .filter(({ canvas2d, webgl2 }) => !comparableRun(canvas2d) || !comparableRun(webgl2))
      .map(({ block }) => block),
  };
}

export function decideQualification({
  slowTarget,
  otherWorkloads,
  correctnessPassed,
  memoryPassed,
}) {
  const blockers = [];
  if (!slowTarget || slowTarget.validPairCount < 3)
    blockers.push('fewer-than-three-valid-paired-blocks');
  if (!correctnessPassed) blockers.push('correctness-not-passed');
  if (!memoryPassed) blockers.push('memory-or-soak-not-passed');
  if (!slowTarget?.improvementInterval95 || slowTarget.improvementInterval95.lower95 === null) {
    blockers.push('slow-target-uncertainty-unavailable');
  } else if (slowTarget.improvementInterval95.upper95 < 20) {
    return { outcome: 'benefit-below-promotion-threshold', blockers };
  } else if (slowTarget.improvementInterval95.lower95 < 20) {
    blockers.push('slow-target-interval-overlaps-20-percent');
  }
  for (const workload of otherWorkloads ?? []) {
    if (workload.validPairCount < 3) {
      blockers.push(`insufficient-paired-blocks:${workload.id}`);
    } else if (workload.regressionInterval95.upper95 > 5) {
      if (workload.regressionInterval95.lower95 > 5) {
        return { outcome: 'regression-exceeds-guardrail', blockers, regression: workload.id };
      }
      blockers.push(`regression-interval-overlaps-5-percent:${workload.id}`);
    }
  }
  if (blockers.length > 0) return { outcome: 'inconclusive', blockers };
  return { outcome: 'benefit-thresholds-met-pending-native-evidence', blockers };
}
