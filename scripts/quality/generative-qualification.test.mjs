#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCorpus, validateEvidence } from './generative-qualification.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const corpus = JSON.parse(
  fs.readFileSync(
    path.join(
      repositoryRoot,
      'tests/e2e/fixtures/generative-evidence/photo-corpus-2026-09-12.json',
    ),
    'utf8',
  ),
);

const corpusSummary = validateCorpus(corpus, {
  provenancePath: path.join(repositoryRoot, 'tests/e2e/fixtures/PROVENANCE.md'),
});
assert.deepEqual(corpusSummary.modeCounts, { fill: 8, remove: 8, replace: 8, expand: 8 });
assert.equal(corpusSummary.fixtureCount, 24);
assert.equal(corpusSummary.taskCount, 32);

function writeEvidenceFile(root, name) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  return name;
}

function candidate(root, task, seed, sourceHash, status = 'passed') {
  const artifacts = {
    source: writeEvidenceFile(root, `${task.id}-${seed}-source.png`),
    mask: writeEvidenceFile(root, `${task.id}-${seed}-mask.png`),
    maskForms: [writeEvidenceFile(root, `${task.id}-${seed}-mask-form.png`)],
    preparedContext: writeEvidenceFile(root, `${task.id}-${seed}-context.png`),
    rawCandidate:
      status === 'passed' ? writeEvidenceFile(root, `${task.id}-${seed}-raw.png`) : null,
    finalComposite:
      status === 'passed' ? writeEvidenceFile(root, `${task.id}-${seed}-composite.png`) : null,
    differenceMap:
      status === 'passed' ? writeEvidenceFile(root, `${task.id}-${seed}-difference.png`) : null,
    boundaryCrop:
      status === 'passed' ? writeEvidenceFile(root, `${task.id}-${seed}-boundary.png`) : null,
  };
  return {
    seed,
    status,
    prompt: task.prompt,
    settings: { quality: 'fast', contextPadding: 32 },
    provider: { id: 'varve-quick-cleanup', runtime: 'patchmatch', modelChecksum: 'a'.repeat(64) },
    timing: { wallMs: 10, providerMs: 9 },
    memory: { peakBytes: 1024 },
    sourceFixtureSha256: sourceHash,
    artifacts,
    ...(status === 'passed'
      ? {
          review: {
            acceptable: true,
            taskSuccess: 4,
            seams: 4,
            preservation: 4,
            plausibility: 4,
            ...(task.prompt ? { promptAdherence: 4 } : {}),
          },
          checks: {
            outsideMaskChangedPixels: 0,
            outsideMaskMaxDelta: 0,
            preservedSourcePlacement: true,
            alphaSafe: true,
          },
        }
      : { failureReason: 'the provider timed out before producing a candidate' }),
  };
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'varve-generative-qualification-test-'));
try {
  const evidence = {
    schemaVersion: 1,
    kind: 'generative-editing-qualification',
    model: { id: 'varve-quick-cleanup', runtime: 'patchmatch', checksumSha256: 'a'.repeat(64) },
    target: { platform: 'browser', backend: 'wasm', architecture: 'x86_64' },
    tasks: corpus.tasks.map((task) => ({
      id: task.id,
      mode: task.mode,
      maskTemplate: task.maskTemplate,
      candidates: task.seeds.map((seed) =>
        candidate(tempRoot, task, seed, corpusSummary.fixtureByFile.get(task.fixture).sha256),
      ),
    })),
  };
  const summary = validateEvidence(corpus, evidence, tempRoot, {
    provenancePath: path.join(repositoryRoot, 'tests/e2e/fixtures/PROVENANCE.md'),
  });
  assert.equal(summary.passingTasks, 32);
  assert.equal(summary.requiredPassingTasks, 29);

  const failed = structuredClone(evidence);
  failed.tasks[0].candidates[0].status = 'error';
  failed.tasks[0].candidates[0].review = { acceptable: true };
  failed.tasks[0].candidates[0].failureReason = '';
  assert.throws(
    () =>
      validateEvidence(corpus, failed, tempRoot, {
        provenancePath: path.join(repositoryRoot, 'tests/e2e/fixtures/PROVENANCE.md'),
      }),
    /cannot be accepted|must explain/,
  );

  const leaked = structuredClone(evidence);
  leaked.tasks[0].candidates[0].checks.outsideMaskMaxDelta = 1;
  assert.throws(
    () =>
      validateEvidence(corpus, leaked, tempRoot, {
        provenancePath: path.join(repositoryRoot, 'tests/e2e/fixtures/PROVENANCE.md'),
      }),
    /protected-pixel delta/,
  );

  const placeholder = structuredClone(evidence);
  fs.writeFileSync(path.join(tempRoot, 'placeholder.txt'), 'generation failed');
  placeholder.tasks[0].candidates[0].artifacts.rawCandidate = 'placeholder.txt';
  assert.throws(
    () =>
      validateEvidence(corpus, placeholder, tempRoot, {
        provenancePath: path.join(repositoryRoot, 'tests/e2e/fixtures/PROVENANCE.md'),
      }),
    /raster artifact/,
  );

  const mismatchedProvider = structuredClone(evidence);
  mismatchedProvider.tasks[0].candidates[0].provider.modelChecksum = 'b'.repeat(64);
  assert.throws(
    () =>
      validateEvidence(corpus, mismatchedProvider, tempRoot, {
        provenancePath: path.join(repositoryRoot, 'tests/e2e/fixtures/PROVENANCE.md'),
      }),
    /does not match evidence\.model\.checksumSha256/,
  );

  const unaccepted = structuredClone(evidence);
  unaccepted.tasks[0].candidates[0].review.acceptable = false;
  assert.throws(
    () =>
      validateEvidence(corpus, unaccepted, tempRoot, {
        provenancePath: path.join(repositoryRoot, 'tests/e2e/fixtures/PROVENANCE.md'),
      }),
    /review\.acceptable must be true/,
  );

  const failedWithoutSourceIdentity = structuredClone(evidence);
  delete failedWithoutSourceIdentity.tasks[0].candidates[0].sourceFixtureSha256;
  failedWithoutSourceIdentity.tasks[0].candidates[0].status = 'failed';
  failedWithoutSourceIdentity.tasks[0].candidates[0].failureReason = 'model timed out';
  failedWithoutSourceIdentity.tasks[0].candidates[0].review = { acceptable: false };
  assert.throws(
    () =>
      validateEvidence(corpus, failedWithoutSourceIdentity, tempRoot, {
        provenancePath: path.join(repositoryRoot, 'tests/e2e/fixtures/PROVENANCE.md'),
      }),
    /sourceFixtureSha256 does not match/,
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('generative qualification tests passed');
