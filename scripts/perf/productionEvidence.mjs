/** Pure production-workload evidence aggregation and validity classification. */

export const VALIDITY_ORDER = [
  'valid',
  'unsupported_presentation',
  'insufficient_samples',
  'threshold_breach',
  'background_activity',
  'thermally_suspect',
  'contended',
  'instrumentation_error',
  'dirty_build',
];

function percentile(sorted, percent) {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)] ?? null;
}

export function distribution(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? null,
  };
}

export function classifyRun(state, identity = null, evidence = null, cpuCount = 1) {
  if (identity?.dirty) return 'dirty_build';
  if (!state || state.instrumentationError || evidence?.instrumentationError) {
    return 'instrumentation_error';
  }
  if (evidence?.insufficientSamples) return 'insufficient_samples';
  if (evidence?.presentationUnavailable) return 'unsupported_presentation';
  if (evidence?.thresholdBreaches?.length) return 'threshold_breach';
  const loadOK = Number.isFinite(state.load1) && state.load1 > cpuCount * 1.5;
  if (loadOK) return 'contended';
  if (Array.isArray(state.backgroundActivity) && state.backgroundActivity.length > 0) {
    return 'background_activity';
  }
  if (state.thermalMaxC !== null && state.thermalMaxC > 90) return 'thermally_suspect';
  return 'valid';
}

export function worstValidity(...values) {
  return (
    values
      .filter(Boolean)
      .sort((a, b) => VALIDITY_ORDER.indexOf(b) - VALIDITY_ORDER.indexOf(a))[0] ?? 'valid'
  );
}

export function performanceEvidence(traces, record, minWarmSamples = 100) {
  const largeDocument =
    Number(record.sceneNodeCount ?? record.fixture?.nodeCount ?? 0) >= 5_000 ||
    /(?:5k|10k|50k)/i.test(String(record.fixture?.id ?? ''));
  const limits = largeDocument
    ? {
        queueP95: 8,
        handlerP95: 8,
        commitP95: 50,
        commitP99: 83.4,
        nextPaintP95: 50,
        nextPaintP99: 83.4,
      }
    : {
        queueP95: 4,
        handlerP95: 4,
        commitP95: 33.4,
        commitP99: 50,
        nextPaintP95: 33.4,
        nextPaintP99: 50,
      };
  const handlerValues = traces.flatMap((trace) =>
    (trace.spans ?? [])
      .filter((span) => /(?:pointer|wheel|pinch|keyboard|gesture).*\.input$/.test(span.name))
      .map((span) => span.durationMs),
  );
  const queueValues = traces.flatMap((trace) => {
    const values = [];
    const ids = new Set();
    if (Number.isFinite(trace.initialQueueDelayMs)) {
      values.push(trace.initialQueueDelayMs);
      ids.add('initial');
    }
    for (const span of trace.spans ?? []) {
      const delay = span.attributes?.queueDelayMs;
      if (!Number.isFinite(delay)) continue;
      const id = span.attributes?.eventSequenceId;
      if (typeof id === 'string' && ids.has(id)) continue;
      if (typeof id === 'string') ids.add(id);
      values.push(delay);
    }
    return values;
  });
  const commitValues = traces
    .map((trace) => trace.inputToCommitMs)
    .filter((value) => Number.isFinite(value));
  const nextPaintValues = traces
    .map((trace) => trace.inputToNextPaintMs)
    .filter((value) => Number.isFinite(value));
  const distributions = {
    queueDelay: distribution(queueValues),
    handler: distribution(handlerValues),
    commit: distribution(commitValues),
    nextPaint: distribution(nextPaintValues),
  };
  const breaches = [];
  if (
    distributions.queueDelay.count >= minWarmSamples &&
    distributions.queueDelay.p95 > limits.queueP95
  ) {
    breaches.push(`queue-delay p95 ${distributions.queueDelay.p95}ms > ${limits.queueP95}ms`);
  }
  if (
    distributions.handler.count >= minWarmSamples &&
    distributions.handler.p95 > limits.handlerP95
  ) {
    breaches.push(`handler p95 ${distributions.handler.p95}ms > ${limits.handlerP95}ms`);
  }
  if (distributions.commit.count >= minWarmSamples) {
    if (distributions.commit.p95 > limits.commitP95) {
      breaches.push(`commit p95 ${distributions.commit.p95}ms > ${limits.commitP95}ms`);
    }
    if (distributions.commit.p99 > limits.commitP99) {
      breaches.push(`commit p99 ${distributions.commit.p99}ms > ${limits.commitP99}ms`);
    }
  }
  const eventTiming = record.presentation?.capabilities?.eventTiming === true;
  const nativeProfiler = traces.some(
    (trace) => trace.presentationEvidence?.source === 'native-profiler',
  );
  if ((eventTiming || nativeProfiler) && nextPaintValues.length >= minWarmSamples) {
    if (distributions.nextPaint.p95 > limits.nextPaintP95) {
      breaches.push(`next-paint p95 ${distributions.nextPaint.p95}ms > ${limits.nextPaintP95}ms`);
    }
    if (distributions.nextPaint.p99 > limits.nextPaintP99) {
      breaches.push(`next-paint p99 ${distributions.nextPaint.p99}ms > ${limits.nextPaintP99}ms`);
    }
  }
  return {
    largeDocument,
    limits,
    distributions,
    thresholdBreaches: breaches,
    insufficientSamples:
      distributions.commit.count < minWarmSamples ||
      distributions.queueDelay.count < minWarmSamples ||
      distributions.handler.count < minWarmSamples ||
      ((eventTiming || nativeProfiler) && nextPaintValues.length < minWarmSamples),
    presentationUnavailable:
      eventTiming && !nativeProfiler && nextPaintValues.length < minWarmSamples,
  };
}

export function summarizeRunnerTraces(traces) {
  const inputToCommit = traces
    .map((trace) => trace.inputToCommitMs)
    .filter((value) => typeof value === 'number');
  const inputToNextPaint = traces
    .map((trace) => trace.inputToNextPaintMs)
    .filter((value) => typeof value === 'number');
  const totals = traces.map((trace) => trace.totalMs);
  const queueDelay = traces.flatMap((trace) => {
    const values = [];
    const eventIds = new Set();
    if (typeof trace.initialQueueDelayMs === 'number') {
      values.push(trace.initialQueueDelayMs);
      eventIds.add('initial');
    }
    for (const span of trace.spans ?? []) {
      const delay = span.attributes?.queueDelayMs;
      if (typeof delay !== 'number' || !Number.isFinite(delay)) continue;
      const eventId = span.attributes?.eventSequenceId;
      if (typeof eventId === 'string') {
        if (eventIds.has(eventId)) continue;
        eventIds.add(eventId);
      } else if (eventIds.has('initial') && values.length === 1 && delay === values[0]) {
        eventIds.delete('initial');
        continue;
      }
      values.push(delay);
    }
    return values;
  });
  const spanDurations = {};
  const traceKinds = {};
  const frameDispositions = {};
  const frameTotals = [];
  let droppedSpans = 0;
  let droppedFrames = 0;
  let missingPresentation = 0;
  let instrumentationErrors = 0;
  let untrustedQueueDelayCount = 0;
  const timestampSources = { 'dom.event.timeStamp': 0, 'handler.performance.now': 0 };

  for (const trace of traces) {
    traceKinds[trace.kind] = (traceKinds[trace.kind] ?? 0) + 1;
    droppedSpans += trace.droppedSpanCount ?? 0;
    droppedFrames += trace.droppedFrameCount ?? 0;
    untrustedQueueDelayCount += trace.untrustedQueueDelayCount ?? 0;
    if (trace.timestampSource in timestampSources) timestampSources[trace.timestampSource]++;
    const hasCausedFrame = (trace.frames ?? []).some((frame) => {
      const relation = frame.causalRelation ?? frame.disposition;
      return relation === 'caused' || relation === 'coalesced' || relation === 'reused';
    });
    if (trace.presentationExpected && !hasCausedFrame) missingPresentation++;
    instrumentationErrors += trace.instrumentationErrors?.length ?? 0;
    for (const span of trace.spans ?? []) {
      const durations = spanDurations[span.name] ?? [];
      durations.push(span.durationMs);
      spanDurations[span.name] = durations;
    }
    for (const frame of trace.frames ?? []) {
      const disposition = frame.causalRelation ?? frame.disposition ?? 'unspecified';
      frameDispositions[disposition] = (frameDispositions[disposition] ?? 0) + 1;
      frameTotals.push(frame.totalMs);
    }
  }

  const total = distribution(totals);
  return {
    interactions: {
      count: traces.length,
      slowCount: traces.filter((trace) => trace.slow).length,
      avgTotalMs:
        totals.length > 0 ? totals.reduce((sum, value) => sum + value, 0) / totals.length : 0,
      p95TotalMs: total.p95 ?? 0,
      maxTotalMs: total.max ?? 0,
      inputToCommit: distribution(inputToCommit),
      inputToNextPaint: distribution(inputToNextPaint),
      total,
      queueDelay: distribution(queueDelay),
      untrustedQueueDelayCount,
      timestampSources,
      presentationEvidence: traces.reduce((sources, trace) => {
        const source = trace.presentationEvidence?.source ?? 'unavailable';
        sources[source] = (sources[source] ?? 0) + 1;
        return sources;
      }, {}),
    },
    traceCount: traces.length,
    cumulativeSamples: {
      interactions: traces.length,
      queueDelay: queueDelay.length,
      frameTotals: frameTotals.length,
      spans: Object.values(spanDurations).reduce((sum, values) => sum + values.length, 0),
    },
    interactionBreakdown: {
      traceKinds,
      spans: Object.fromEntries(
        Object.entries(spanDurations).map(([name, values]) => [name, distribution(values)]),
      ),
      frameDispositions,
      frameTotal: distribution(frameTotals),
      droppedSpans,
      droppedFrames,
      missingPresentation,
      instrumentationErrors,
    },
    traceEvidence: traces,
  };
}
