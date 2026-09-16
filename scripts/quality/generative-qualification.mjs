#!/usr/bin/env node

/**
 * Validate the frozen generative-editing input corpus and a model-evidence
 * report without running inference. This is intentionally an evidence gate:
 * it cannot promote a model, inspect pixels, or replace human review.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_CORPUS = path.join(
  REPOSITORY_ROOT,
  'tests/e2e/fixtures/generative-evidence/photo-corpus-2026-09-12.json',
);

const MODES = ['fill', 'remove', 'replace', 'expand'];
const PROMPT_MODES = new Set(['replace', 'expand']);
const REQUIRED_SCORES = ['taskSuccess', 'seams', 'preservation', 'plausibility'];
const REQUIRED_ARTIFACTS = [
  'source',
  'mask',
  'preparedContext',
  'rawCandidate',
  'finalComposite',
  'differenceMap',
  'boundaryCrop',
];
const RASTER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ACCEPTABLE_TASK_RATE = 0.9;

function errorList(errors) {
  return new Error(
    `Generative qualification evidence is invalid:\n${errors.map((error) => `- ${error}`).join('\n')}`,
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Could not read JSON ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIntegerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function parseProvenanceFixtureMetadata(provenancePath) {
  if (!provenancePath) return new Map();
  let markdown;
  try {
    markdown = fs.readFileSync(provenancePath, 'utf8');
  } catch {
    return new Map();
  }
  const fixtures = new Map();
  for (const line of markdown.split('\n')) {
    const columns = line.split('|').map((column) => column.trim());
    if (columns.length < 8) continue;
    const fileMatch = columns[1]?.match(/^`([^`]+)`$/);
    const checksum = columns.find((column) => /^`[0-9a-f]{64}`$/.test(column));
    if (!fileMatch || !checksum) continue;
    const note = columns.at(-2) ?? '';
    const categories = categoriesFromProvenance(note, columns.slice(2, -2).join(' '));
    fixtures.set(fileMatch[1], {
      file: fileMatch[1],
      sha256: checksum.slice(1, -1),
      categories,
    });
  }
  return fixtures;
}

function categoriesFromProvenance(note, columns) {
  const text = `${note} ${columns}`.toLowerCase();
  const categories = [];
  if (text.includes('landscape')) categories.push('landscape');
  if (text.includes('portrait') || text.includes('people')) categories.push('portrait');
  if (text.includes('still life')) categories.push('still life');
  if (text.includes('architecture') || text.includes('building')) categories.push('architecture');
  if (text.includes('interior')) categories.push('interior');
  if (text.includes('reflection') || text.includes('glass')) categories.push('reflective');
  if (text.includes('hair')) categories.push('hair');
  return categories.length > 0 ? [...new Set(categories)] : ['uncategorized'];
}

function validateCorpus(corpus, options = {}) {
  const errors = [];
  if (!isObject(corpus)) throw errorList(['the corpus root must be an object']);
  if (corpus.schemaVersion !== 1) errors.push('corpus schemaVersion must be 1');
  if (corpus.fixtureCount !== 24)
    errors.push(`corpus fixtureCount must be 24, got ${corpus.fixtureCount}`);
  if (corpus.taskCount !== 32) errors.push(`corpus taskCount must be 32, got ${corpus.taskCount}`);

  const fixtures = Array.isArray(corpus.fixtures) ? corpus.fixtures : [];
  const fixtureByFile = new Map();
  const manifestFiles = new Set();
  const metadataFromManifest =
    options.baseDir && typeof corpus.existingFixtureMetadata === 'string'
      ? path.resolve(options.baseDir, corpus.existingFixtureMetadata)
      : null;
  const provenancePath =
    options.provenancePath ??
    (metadataFromManifest && fs.existsSync(metadataFromManifest)
      ? metadataFromManifest
      : options.baseDir
        ? path.resolve(options.baseDir, '..', 'PROVENANCE.md')
        : null);
  for (const [file, fixture] of parseProvenanceFixtureMetadata(provenancePath)) {
    fixtureByFile.set(file, fixture);
  }
  if (fixtures.length > 24)
    errors.push(`corpus cannot list more than 24 fixtures, got ${fixtures.length}`);
  for (const [index, fixture] of fixtures.entries()) {
    if (!isObject(fixture)) {
      errors.push(`fixture ${index + 1} must be an object`);
      continue;
    }
    if (typeof fixture.file !== 'string' || fixture.file.length === 0) {
      errors.push(`fixture ${index + 1} has no file name`);
      continue;
    }
    if (manifestFiles.has(fixture.file)) errors.push(`duplicate fixture ${fixture.file}`);
    manifestFiles.add(fixture.file);
    fixtureByFile.set(fixture.file, {
      ...fixtureByFile.get(fixture.file),
      ...fixture,
      categories:
        Array.isArray(fixture.categories) && fixture.categories.length > 0
          ? fixture.categories
          : (fixtureByFile.get(fixture.file)?.categories ?? ['uncategorized']),
    });
    if (!Array.isArray(fixture.categories) || fixture.categories.length === 0) {
      errors.push(`fixture ${fixture.file} must declare at least one category`);
    }
    const merged = fixtureByFile.get(fixture.file);
    if (typeof merged?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(merged.sha256)) {
      errors.push(`fixture ${fixture.file} must declare a lowercase SHA-256 checksum`);
    }
  }
  if (fixtureByFile.size !== 24)
    errors.push(`corpus must resolve 24 fixtures, got ${fixtureByFile.size}`);
  for (const [file, fixture] of fixtureByFile) {
    if (!Array.isArray(fixture.categories) || fixture.categories.length === 0) {
      errors.push(`fixture ${file} must declare at least one category`);
    }
  }

  const templates = isObject(corpus.maskTemplates) ? corpus.maskTemplates : {};
  const tasks = Array.isArray(corpus.tasks) ? corpus.tasks : [];
  if (tasks.length !== 32) errors.push(`corpus must contain 32 tasks, got ${tasks.length}`);
  const taskIds = new Set();
  const modeCounts = Object.fromEntries(MODES.map((mode) => [mode, 0]));
  for (const [index, task] of tasks.entries()) {
    const label = `task ${index + 1}`;
    if (!isObject(task)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (typeof task.id !== 'string' || task.id.length === 0) errors.push(`${label} has no id`);
    else if (taskIds.has(task.id)) errors.push(`duplicate task ${task.id}`);
    else taskIds.add(task.id);
    if (!MODES.includes(task.mode)) {
      errors.push(`${task.id ?? label} has unsupported mode ${task.mode}`);
    } else {
      modeCounts[task.mode] += 1;
    }
    if (!fixtureByFile.has(task.fixture))
      errors.push(`${task.id ?? label} references unknown fixture ${task.fixture}`);
    if (typeof task.maskTemplate !== 'string' || !templates[task.maskTemplate]) {
      errors.push(`${task.id ?? label} references an unknown mask template`);
    }
    if (
      !Array.isArray(task.seeds) ||
      task.seeds.length !== 3 ||
      task.seeds.some((seed) => !Number.isSafeInteger(seed)) ||
      new Set(task.seeds).size !== 3
    ) {
      errors.push(`${task.id ?? label} must freeze three distinct integer seeds`);
    }
    if (PROMPT_MODES.has(task.mode)) {
      if (typeof task.prompt !== 'string' || task.prompt.trim().length === 0) {
        errors.push(`${task.id ?? label} must freeze a non-empty prompt`);
      }
    } else if (task.prompt !== null) {
      errors.push(`${task.id ?? label} must be promptless`);
    }
  }
  for (const mode of MODES) {
    if (modeCounts[mode] !== 8)
      errors.push(`mode ${mode} must contain 8 tasks, got ${modeCounts[mode]}`);
  }
  if (errors.length > 0) throw errorList(errors);

  return {
    fixtureCount: fixtureByFile.size,
    taskCount: tasks.length,
    modeCounts,
    categories: [
      ...new Set(tasks.flatMap((task) => fixtureByFile.get(task.fixture)?.categories ?? [])),
    ].sort(),
    fixtureByFile,
    taskById: new Map(tasks.map((task) => [task.id, task])),
  };
}

function sha256File(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let offset = 0;
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    } while (bytesRead > 0);
    return hash.digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
}

function resolveEvidenceArtifact(root, candidatePath, label, errors, expectedSha256) {
  if (typeof candidatePath !== 'string' || candidatePath.length === 0) {
    errors.push(`${label} must name a retained artifact`);
    return;
  }
  if (path.isAbsolute(candidatePath)) {
    errors.push(`${label} must use a relative path inside the evidence directory`);
    return;
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidatePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    errors.push(`${label} escapes the evidence directory`);
    return;
  }
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    errors.push(`${label} is missing: ${candidatePath}`);
    return;
  }
  if (!stat.isFile() || stat.size === 0)
    errors.push(`${label} must be a non-empty file: ${candidatePath}`);
  else if (!looksLikeRasterArtifact(resolved, candidatePath)) {
    errors.push(`${label} must be a PNG, JPEG, or WebP raster artifact: ${candidatePath}`);
  } else if (requireSha256(expectedSha256, `${label}Sha256`, errors)) {
    const actualSha256 = sha256File(resolved);
    if (actualSha256 !== expectedSha256) {
      errors.push(`${label} checksum does not match its retained artifact`);
    }
  }
}

function looksLikeRasterArtifact(filePath, reportedPath) {
  if (!RASTER_EXTENSIONS.has(path.extname(reportedPath).toLowerCase())) return false;
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(12);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    if (bytesRead < 2) return false;
    const isPng =
      bytesRead >= 8 &&
      header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = header[0] === 0xff && header[1] === 0xd8;
    const isWebp =
      bytesRead >= 12 &&
      header.subarray(0, 4).toString('ascii') === 'RIFF' &&
      header.subarray(8, 12).toString('ascii') === 'WEBP';
    return isPng || isJpeg || isWebp;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function requireString(object, key, label, errors) {
  if (typeof object?.[key] !== 'string' || object[key].trim().length === 0) {
    errors.push(`${label}.${key} must be a non-empty string`);
  }
}

function requireSha256(value, label, errors) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    errors.push(`${label} must be a lowercase hexadecimal SHA-256`);
    return false;
  }
  return true;
}

function validateCandidate(
  candidate,
  task,
  fixture,
  evidenceModel,
  evidenceRoot,
  candidateIndex,
  errors,
) {
  const label = `${task.id} candidate ${candidateIndex + 1}`;
  if (!isObject(candidate)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  if (candidate.sourceFixtureSha256 !== fixture.sha256) {
    errors.push(`${label} sourceFixtureSha256 does not match the frozen photograph`);
  }
  if (!task.seeds.includes(candidate.seed))
    errors.push(`${label} has seed ${candidate.seed}, not one of the frozen seeds`);
  if (!['passed', 'failed', 'error'].includes(candidate.status)) {
    errors.push(`${label} status must be passed, failed, or error`);
  }
  if (candidate.prompt !== task.prompt)
    errors.push(`${label} prompt does not match the frozen task prompt`);
  if (!isObject(candidate.settings) || Object.keys(candidate.settings).length === 0) {
    errors.push(`${label} must record effective generation settings`);
  }
  if (!isObject(candidate.provider)) {
    errors.push(`${label} must record provider/runtime provenance`);
  } else {
    requireString(candidate.provider, 'id', label, errors);
    requireString(candidate.provider, 'runtime', label, errors);
    if (
      requireSha256(candidate.provider.modelChecksum, `${label}.provider.modelChecksum`, errors)
    ) {
      if (candidate.provider.modelChecksum !== evidenceModel.checksumSha256) {
        errors.push(`${label}.provider.modelChecksum does not match evidence.model.checksumSha256`);
      }
    }
    if (typeof evidenceModel.id === 'string' && candidate.provider.id !== evidenceModel.id) {
      errors.push(`${label}.provider.id does not match evidence.model.id`);
    }
    if (
      typeof evidenceModel.runtime === 'string' &&
      candidate.provider.runtime !== evidenceModel.runtime
    ) {
      errors.push(`${label}.provider.runtime does not match evidence.model.runtime`);
    }
  }
  if (!isObject(candidate.timing)) errors.push(`${label} must record timing`);
  else {
    if (!isFiniteNumber(candidate.timing.wallMs) || candidate.timing.wallMs < 0)
      errors.push(`${label} timing.wallMs must be non-negative`);
    if (!isFiniteNumber(candidate.timing.providerMs) || candidate.timing.providerMs < 0)
      errors.push(`${label} timing.providerMs must be non-negative`);
  }
  if (
    !isObject(candidate.memory) ||
    !isFiniteNumber(candidate.memory.peakBytes) ||
    candidate.memory.peakBytes <= 0
  ) {
    errors.push(`${label} must record a positive measured peak memory value`);
  }

  const artifacts = isObject(candidate.artifacts) ? candidate.artifacts : {};
  const artifactHashes = isObject(artifacts.sha256) ? artifacts.sha256 : {};
  for (const key of REQUIRED_ARTIFACTS) {
    const artifact = artifacts[key];
    const outputArtifact = [
      'rawCandidate',
      'finalComposite',
      'differenceMap',
      'boundaryCrop',
    ].includes(key);
    if (candidate.status === 'passed' || !outputArtifact || artifact !== null) {
      resolveEvidenceArtifact(
        evidenceRoot,
        artifact,
        `${label}.artifacts.${key}`,
        errors,
        artifactHashes[key],
      );
    } else if (artifactHashes[key] !== null) {
      errors.push(`${label}.artifacts.sha256.${key} must be null when the artifact is null`);
    }
  }
  if (!Array.isArray(artifacts.maskForms) || artifacts.maskForms.length === 0) {
    errors.push(`${label}.artifacts.maskForms must retain at least one mask representation`);
  } else {
    const maskFormHashes = Array.isArray(artifactHashes.maskForms) ? artifactHashes.maskForms : [];
    if (maskFormHashes.length !== artifacts.maskForms.length) {
      errors.push(`${label}.artifacts.sha256.maskForms must hash every mask representation`);
    }
    for (const [index, maskForm] of artifacts.maskForms.entries()) {
      resolveEvidenceArtifact(
        evidenceRoot,
        maskForm,
        `${label}.artifacts.maskForms[${index}]`,
        errors,
        maskFormHashes[index],
      );
    }
  }

  if (candidate.status !== 'passed') {
    if (
      typeof candidate.failureReason !== 'string' ||
      candidate.failureReason.trim().length === 0
    ) {
      errors.push(`${label} must explain why the candidate failed`);
    }
    if (candidate.review?.acceptable === true)
      errors.push(`${label} cannot be accepted after status ${candidate.status}`);
    return false;
  }

  const scores = isObject(candidate.review) ? candidate.review : {};
  if (scores.acceptable !== true) {
    errors.push(`${label}.review.acceptable must be true for a passed candidate`);
  }
  for (const score of REQUIRED_SCORES) {
    if (!isIntegerInRange(scores[score], 0, 4))
      errors.push(`${label}.review.${score} must be an integer from 0 to 4`);
  }
  if (PROMPT_MODES.has(task.mode) && !isIntegerInRange(scores.promptAdherence, 0, 4)) {
    errors.push(`${label}.review.promptAdherence must be an integer from 0 to 4 for ${task.mode}`);
  }

  const checks = isObject(candidate.checks) ? candidate.checks : {};
  if (checks.outsideMaskChangedPixels !== 0)
    errors.push(`${label} changed protected pixels outside the effective mask`);
  if (checks.outsideMaskMaxDelta !== 0)
    errors.push(`${label} has a non-zero protected-pixel delta`);
  if (checks.preservedSourcePlacement !== true)
    errors.push(`${label} did not prove preserved source placement`);
  if (checks.alphaSafe !== true) errors.push(`${label} did not prove alpha-safe compositing`);
  const acceptable =
    REQUIRED_SCORES.every((score) => scores[score] >= 3) &&
    (!PROMPT_MODES.has(task.mode) || scores.promptAdherence >= 3) &&
    checks.outsideMaskChangedPixels === 0 &&
    checks.outsideMaskMaxDelta === 0 &&
    checks.preservedSourcePlacement === true &&
    checks.alphaSafe === true;
  if (!acceptable)
    errors.push(`${label} is marked passed but does not meet the 0–4 acceptance rubric`);
  return acceptable;
}

function validateEvidence(corpus, evidence, evidenceRoot, options = {}) {
  const corpusInfo = validateCorpus(corpus, options);
  const errors = [];
  if (!isObject(evidence)) throw errorList(['evidence report root must be an object']);
  if (evidence.schemaVersion !== 1) errors.push('evidence schemaVersion must be 1');
  if (evidence.kind !== 'generative-editing-qualification')
    errors.push('evidence kind is not generative-editing-qualification');
  if (!isObject(evidence.model)) errors.push('evidence must record model identity');
  else {
    requireString(evidence.model, 'id', 'evidence.model', errors);
    requireString(evidence.model, 'runtime', 'evidence.model', errors);
    requireString(evidence.model, 'checksumSha256', 'evidence.model', errors);
    if (
      typeof evidence.model.checksumSha256 === 'string' &&
      !/^[0-9a-f]{64}$/.test(evidence.model.checksumSha256)
    ) {
      errors.push('evidence.model.checksumSha256 must be lowercase hexadecimal SHA-256');
    }
  }
  if (!isObject(evidence.target))
    errors.push('evidence must record target platform/backend/architecture');
  else {
    requireString(evidence.target, 'platform', 'evidence.target', errors);
    requireString(evidence.target, 'backend', 'evidence.target', errors);
    requireString(evidence.target, 'architecture', 'evidence.target', errors);
  }
  const evidenceModel = isObject(evidence.model) ? evidence.model : {};
  const reportTasks = Array.isArray(evidence.tasks) ? evidence.tasks : [];
  if (reportTasks.length !== corpusInfo.taskCount)
    errors.push(
      `evidence must contain exactly ${corpusInfo.taskCount} tasks, got ${reportTasks.length}`,
    );
  const reportById = new Map();
  for (const task of reportTasks) {
    if (isObject(task) && typeof task.id === 'string') {
      if (reportById.has(task.id)) errors.push(`evidence contains duplicate task ${task.id}`);
      reportById.set(task.id, task);
    }
  }

  let passingTasks = 0;
  let firstCandidatePasses = 0;
  const passingCategories = new Set();
  for (const [taskId, task] of corpusInfo.taskById) {
    const reportTask = reportById.get(taskId);
    if (!reportTask) {
      errors.push(`evidence is missing task ${taskId}`);
      continue;
    }
    if (reportTask.mode !== task.mode)
      errors.push(`${taskId} mode does not match the frozen corpus`);
    if (reportTask.maskTemplate !== task.maskTemplate)
      errors.push(`${taskId} maskTemplate does not match the frozen corpus`);
    const candidates = Array.isArray(reportTask.candidates) ? reportTask.candidates : [];
    if (candidates.length !== 3) errors.push(`${taskId} must retain exactly three seed candidates`);
    const candidateBySeed = new Map(
      candidates.filter(isObject).map((candidate) => [candidate.seed, candidate]),
    );
    if (candidateBySeed.size !== candidates.length)
      errors.push(`${taskId} contains duplicate candidate seeds`);
    const fixture = corpusInfo.fixtureByFile.get(task.fixture);
    const acceptableCandidates = task.seeds.map((seed, index) => {
      const candidate = candidateBySeed.get(seed);
      if (!candidate) {
        errors.push(`${taskId} is missing frozen seed ${seed}`);
        return false;
      }
      return validateCandidate(
        candidate,
        task,
        fixture,
        evidenceModel,
        evidenceRoot,
        index,
        errors,
      );
    });
    if (acceptableCandidates[0] === true) firstCandidatePasses += 1;
    if (acceptableCandidates.some((value) => value === true)) {
      passingTasks += 1;
      for (const category of fixture.categories) passingCategories.add(category);
    }
  }
  for (const category of corpusInfo.categories) {
    if (!passingCategories.has(category))
      errors.push(`required category has no acceptable task: ${category}`);
  }
  const requiredPassingTasks = Math.ceil(corpusInfo.taskCount * ACCEPTABLE_TASK_RATE);
  if (passingTasks < requiredPassingTasks) {
    errors.push(
      `only ${passingTasks}/${corpusInfo.taskCount} tasks have an acceptable three-seed candidate; at least ${requiredPassingTasks} are required`,
    );
  }
  if (errors.length > 0) throw errorList(errors);
  return {
    fixtureCount: corpusInfo.fixtureCount,
    taskCount: corpusInfo.taskCount,
    passingTasks,
    requiredPassingTasks,
    firstCandidatePasses,
    firstCandidateSuccessRate: firstCandidatePasses / corpusInfo.taskCount,
    categories: corpusInfo.categories,
  };
}

function parseArgs(argv) {
  const args = { corpus: DEFAULT_CORPUS, evidenceDir: null, evidenceManifest: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--corpus') args.corpus = path.resolve(argv[++index] ?? '');
    else if (argument === '--evidence-dir') args.evidenceDir = path.resolve(argv[++index] ?? '');
    else if (argument === '--evidence-manifest')
      args.evidenceManifest = path.resolve(argv[++index] ?? '');
    else if (argument === '--json') args.json = true;
    else if (argument === '--help' || argument === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      'Usage: node scripts/quality/generative-qualification.mjs [--corpus FILE] [--evidence-dir DIR --evidence-manifest FILE] [--json]',
    );
    return;
  }
  const corpus = readJson(args.corpus);
  const inputSummary = validateCorpus(corpus, { baseDir: path.dirname(args.corpus) });
  if (!args.evidenceDir) {
    const summary = {
      status: 'input-only',
      message: 'Frozen inputs are valid; no model-quality claim was evaluated.',
      fixtureCount: inputSummary.fixtureCount,
      taskCount: inputSummary.taskCount,
      modeCounts: inputSummary.modeCounts,
    };
    console.log(
      args.json
        ? JSON.stringify(summary, null, 2)
        : `${summary.message} ${summary.fixtureCount} photographs / ${summary.taskCount} tasks.`,
    );
    return;
  }
  const evidenceManifest = args.evidenceManifest ?? path.join(args.evidenceDir, 'report.json');
  const summary = validateEvidence(corpus, readJson(evidenceManifest), args.evidenceDir, {
    baseDir: path.dirname(args.corpus),
  });
  console.log(
    args.json
      ? JSON.stringify({ status: 'qualified', ...summary }, null, 2)
      : `Qualification evidence passed: ${summary.passingTasks}/${summary.taskCount} tasks; first-candidate success ${(summary.firstCandidateSuccessRate * 100).toFixed(1)}%.`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { validateCorpus, validateEvidence };
