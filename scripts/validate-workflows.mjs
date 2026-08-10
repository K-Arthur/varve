#!/usr/bin/env node

/**
 * GitHub Actions Workflow Validation Tool
 *
 * Validates workflow YAML syntax and structure before commit.
 * Research basis: GitHub Actions workflow schema validation.
 *
 * Usage:
 *   node scripts/validate-workflows.mjs              # Validate all workflows
 *   node scripts/validate-workflows.mjs --staged     # Validate only staged workflows
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

const WORKFLOWS_DIR = '.github/workflows';

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = { staged: false };

  for (const arg of args) {
    if (arg === '--staged') flags.staged = true;
  }

  return flags;
}

function getWorkflowFiles(flags) {
  const files = [];

  if (flags.staged) {
    try {
      const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' });
      const stagedFiles = staged
        .trim()
        .split('\n')
        .filter((f) => f.length > 0);

      for (const file of stagedFiles) {
        if (
          file.startsWith('.github/workflows/') &&
          (file.endsWith('.yml') || file.endsWith('.yaml'))
        ) {
          files.push(file);
        }
      }
    } catch {
      // Not in git repo or no staged files
      return getAllWorkflowFiles();
    }
  }

  if (files.length === 0) {
    return getAllWorkflowFiles();
  }

  return files;
}

function getAllWorkflowFiles() {
  const files = [];
  for (const file of readdirSync(WORKFLOWS_DIR)) {
    if (file.endsWith('.yml') || file.endsWith('.yaml')) {
      files.push(join(WORKFLOWS_DIR, file));
    }
  }
  return files;
}

function validateYAMLSyntax(content) {
  // Prefer a real YAML parser when available (node_modules/.pnpm may expose
  // js-yaml). The naive indentation check below catches tabs and odd indents
  // but MISSES actual parse errors (bad anchors, invalid block scalars,
  // unclosed quotes) — those are what break a workflow at parse time.
  try {
    const yamlPath = require.resolve('js-yaml');
    const { load } = require(yamlPath);
    const doc = load(content);
    if (!doc || typeof doc !== 'object') {
      return { valid: false, errors: ['YAML parsed to a non-object document'] };
    }
    return { valid: true, errors: [] };
  } catch {
    // js-yaml not resolvable — fall through to the heuristic checker.
  }

  try {
    // Basic YAML syntax validation without external dependencies
    // Check for common YAML syntax errors
    const lines = content.split('\n');
    const errors = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check for tabs (YAML forbids tabs)
      if (line.includes('\t')) {
        errors.push(`Line ${lineNum}: Tabs are not allowed in YAML`);
      }

      // Check for indentation consistency
      if (line.length > 0 && line[0] === ' ') {
        const indent = line.match(/^\s*/)[0].length;
        if (indent % 2 !== 0) {
          errors.push(`Line ${lineNum}: Indentation should be multiples of 2 spaces`);
        }
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  } catch (e) {
    return { valid: false, errors: [`YAML syntax error: ${e.message}`] };
  }
}

function validateWorkflowStructure(content, filename) {
  const errors = [];

  // Check for required top-level keys
  if (!content.includes('name:')) {
    errors.push('Missing required field: name');
  }

  if (!content.includes('on:')) {
    errors.push('Missing required field: on (triggers)');
  }

  if (!content.includes('jobs:')) {
    errors.push('Missing required field: jobs');
  }

  // Check for SHA-pinned actions (supply chain security)
  const unpinnedActions = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/uses:\s*(['"])?([^'"\s@]+)(?:@([^'"\s]+))?\1/);

    if (match) {
      const [, , action, version] = match;
      if (
        !version ||
        version.match(/^v\d+$/) ||
        version === 'stable' ||
        version === 'main' ||
        version === 'master'
      ) {
        unpinnedActions.push({
          line: i + 1,
          action: action,
          version: version || 'none',
        });
      }
    }
  }

  if (unpinnedActions.length > 0) {
    errors.push(`Found ${unpinnedActions.length} unpinned action(s) (supply chain security risk):`);
    for (const { line, action, version } of unpinnedActions) {
      errors.push(`  Line ${line}: ${action}@${version}`);
    }
    errors.push('Run: node scripts/pin-github-actions.mjs --pin');
  }

  // Check for concurrency control (best practice)
  if (!content.includes('concurrency:')) {
    console.warn(`⚠️  ${filename}: Missing concurrency control (recommended for cost optimization)`);
  }

  // Check for timeout settings (best practice)
  if (!content.includes('timeout-minutes:')) {
    console.warn(
      `⚠️  ${filename}: Missing timeout-minutes (recommended for runaway job prevention)`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Varve-specific workflow rules, checked with line scanning (consistent with
 * the heuristic YAML checker above — js-yaml is not resolvable from the root).
 *
 * These are regression guards for failure modes this repo has actually hit or
 * must never hit:
 *
 *   - release.yml gate ordering: the desktop crate's `tauri::generate_context!`
 *     reads `frontendDist` and hard-fails when apps/desktop/dist does not
 *     exist. Any workflow that compiles the desktop crate MUST build the
 *     frontend first (build.yml documents the original failure).
 *   - website-deploy.yml: least-privilege permissions (no `actions: write`),
 *     a `release: published` trigger, and a Pages artifact that contains the
 *     built site.
 *   - No workflow that can run on `pull_request` may publish releases or
 *     upload release assets (a PR-triggered workflow has no business touching
 *     releases, and a forked-PR context must never hold release write tokens).
 */
function validateVarveRules(content, filename) {
  const errors = [];
  const name = filename.split('/').pop();

  const stepBlocks = extractStepBlocks(content);

  if (name === 'release.yml') {
    const gateSteps = stepBlocks.gate ?? [];
    const frontendIdx = gateSteps.findIndex(
      (s) => s.name.includes('frontend') && /pnpm build/.test(s.run),
    );
    const desktopCompileIdx = gateSteps.findIndex(
      (s) => /cargo (test|clippy|build|run)/.test(s.run) && s.run.includes('src-tauri'),
    );
    if (frontendIdx === -1) {
      errors.push(
        'release.yml gate job: missing "Build frontend" step before desktop cargo tests ' +
          '(tauri::generate_context!() requires apps/desktop/dist to exist)',
      );
    } else if (desktopCompileIdx === -1 || frontendIdx > desktopCompileIdx) {
      errors.push(
        'release.yml gate job: desktop compilation must come AFTER the frontend build ' +
          'step (generate_context!() reads frontendDist at compile time)',
      );
    }
    validateReleaseSigningRules(content, stepBlocks, errors);
  }

  if (name === 'website-deploy.yml') {
    const perms = content.match(/permissions:\n(?: {2}\w[^\n]*\n?)*/);
    if (perms && /\bactions:\s*write\b/.test(perms[0])) {
      errors.push('website-deploy.yml: `actions: write` is not needed for Pages deployment');
    }
    if (
      !/release:\s*\n\s+types:\s*(\[[^\]]*published|[\s\S]*?-\s+published)/.test(content) &&
      !/workflow_run:\s*\n\s+workflows:\s*\[['"]?Release/.test(content)
    ) {
      errors.push(
        'website-deploy.yml: missing release rebuild trigger — either ' +
          '`release: types: [published]` or a `workflow_run` on the Release ' +
          'workflow (workflow_run is preferred: it runs on the default branch, ' +
          'so the github-pages environment protection accepts the deploy)',
      );
    }
    if (!/-\s*['"]?scripts\/release/.test(content)) {
      errors.push(
        'website-deploy.yml: missing scripts/release/** path trigger — release-manifest ' +
          'generation changes must redeploy the site',
      );
    }
    const pagesUpload = content.match(/upload-pages-artifact@[0-9a-f]{40}[\s\S]*?path:\s*(\S+)/);
    if (pagesUpload && !pagesUpload[1].includes('dist')) {
      errors.push(
        `website-deploy.yml: Pages artifact path ${pagesUpload[1]} does not look like a build output`,
      );
    }
    const uploadIdx = content.indexOf('upload-pages-artifact');
    const buildIdx = content.indexOf('@varve/website build');
    if (uploadIdx !== -1 && (buildIdx === -1 || buildIdx > uploadIdx)) {
      errors.push(
        'website-deploy.yml: the website must be built (pnpm --filter @varve/website build) ' +
          'before its output is uploaded to Pages',
      );
    }
  }

  if (/on:[\s\S]*?pull_request/.test(content)) {
    if (/action-gh-release@[0-9a-f]{40}/.test(content)) {
      errors.push(
        `${name}: uses action-gh-release but can run on pull_request — release publication ` +
          'must never be possible from a PR-triggered workflow',
      );
    }
    if (/gh release (create|edit|upload|delete)/.test(content)) {
      errors.push(
        `${name}: calls \`gh release ...\` but can run on pull_request — release writes ` +
          'must never be possible from a PR-triggered workflow',
      );
    }
  }

  return errors;
}

/**
 * Release signing regression guards.
 *
 * These encode the fail-closed release policy as structure:
 *
 *   1. A signing-preflight job exists and the bundle job depends on it, so
 *      missing credentials fail BEFORE any platform build starts.
 *   2. The bundle job actually invokes the platform signature verification
 *      scripts, so signedness is always measured on the artifact bytes.
 *   3. verify-release-trust.mjs runs before generate-final-checksums.mjs, so
 *      published hashes always describe verified bytes.
 *   4. GitHub artifact attestation (actions/attest) runs on the FINAL bytes
 *      after checksums, with the least privilege it needs.
 *   5. No step may write `signed=true` literally — signedness must come from
 *      the verification reports, never from workflow text or secret presence.
 */
function validateReleaseSigningRules(content, stepBlocks, errors) {
  if (!/^\s{2}signing-preflight:\s*$/m.test(content)) {
    errors.push(
      'release.yml: missing `signing-preflight` job — signing credentials must be validated ' +
        'BEFORE the platform build starts',
    );
  }

  // The bundle job's needs must include signing-preflight.
  const jobText = {};
  let currentJob = null;
  for (const line of content.split('\n')) {
    const jobMatch = line.match(/^ {2}([a-zA-Z][a-zA-Z0-9-]*):\s*$/);
    if (jobMatch) {
      currentJob = jobMatch[1];
      jobText[currentJob] = [];
      continue;
    }
    if (currentJob) jobText[currentJob].push(line);
  }
  if (!/signing-preflight/.test((jobText.bundle ?? []).join('\n'))) {
    errors.push(
      'release.yml: bundle job must depend on signing-preflight (needs: [... signing-preflight])',
    );
  }

  const bundleSteps = stepBlocks.bundle ?? [];
  const hasWindowsVerify = bundleSteps.some(
    (s) => /verify-windows-signature\.ps1/.test(s.run) || s.name.includes('verify windows'),
  );
  const hasMacosVerify = bundleSteps.some(
    (s) => /verify-macos-signature\.sh/.test(s.run) || s.name.includes('verify macos'),
  );
  if (!hasWindowsVerify) {
    errors.push(
      'release.yml: bundle job must run scripts/release/verify-windows-signature.ps1 on the ' +
        'collected artifact — signedness is measured on bytes, not claimed',
    );
  }
  if (!hasMacosVerify) {
    errors.push(
      'release.yml: bundle job must run scripts/release/verify-macos-signature.sh on the ' +
        'collected artifact (codesign + spctl + stapler)',
    );
  }

  const trustIdx = content.indexOf('verify-release-trust.mjs');
  const checksumIdx = content.indexOf('generate-final-checksums.mjs');
  if (trustIdx === -1) {
    errors.push(
      'release.yml: missing verify-release-trust.mjs step — the fail-closed trust gate must ' +
        'run before checksums are generated',
    );
  } else if (checksumIdx !== -1 && trustIdx > checksumIdx) {
    errors.push(
      'release.yml: verify-release-trust.mjs must run BEFORE generate-final-checksums.mjs — ' +
        'checksums must describe verified (post-signing) bytes',
    );
  }

  // Attestation of the FINAL bytes, after checksums, with least privilege.
  const attestIdx = content.indexOf('actions/attest@');
  if (attestIdx === -1) {
    errors.push(
      'release.yml: missing actions/attest step — final release bytes should be attested',
    );
  } else {
    if (checksumIdx !== -1 && attestIdx < checksumIdx) {
      errors.push(
        'release.yml: actions/attest must run AFTER generate-final-checksums.mjs — attest the ' +
          'final verified bytes, not intermediates',
      );
    }
    const perms = content.match(/permissions:\n(?: {2,8}\w[^\n]*\n?)*/g) ?? [];
    if (!perms.some((p) => /\battestations:\s*write\b/.test(p))) {
      errors.push('release.yml: no job grants `attestations: write` — required by actions/attest');
    }
  }

  if (/signed\s*=\s*["']?true/.test(content)) {
    errors.push(
      'release.yml: a step writes `signed=true` literally — signedness must derive from ' +
        'verification reports (verify-release-trust.mjs), never from workflow text',
    );
  }
}

export { validateVarveRules };

/**
 * Extract `steps:` entries per job as {name, run} pairs, line-scanned.
 * Handles steps defined with `- name:` plus `run:` or `uses:` (name may be
 * absent; run is the single source of truth for ordering checks).
 */
export function extractStepBlocks(content) {
  const jobs = {};
  const lines = content.split('\n');
  let currentJob = null;
  let currentStep = null;
  let inSteps = false;

  const flush = () => {
    if (currentStep && currentJob) {
      jobs[currentJob] ??= [];
      jobs[currentJob].push(currentStep);
    }
    currentStep = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const jobMatch = line.match(/^ {2}(\S[^:]*):\s*$/);
    if (jobMatch && !line.startsWith('    ') && !line.startsWith('#')) {
      flush();
      inSteps = false;
      currentJob = jobMatch[1];
      jobs[currentJob] ??= [];
      continue;
    }
    if (currentJob && /^\s+steps:\s*$/.test(line)) {
      flush();
      inSteps = true;
      continue;
    }
    if (inSteps) {
      if (/^\s{4,6}-\s+name:\s*(.+)$/.test(line)) {
        flush();
        currentStep = { name: line.match(/^\s{4,6}-\s+name:\s*(.+)$/)[1], run: '' };
        continue;
      }
      if (/^\s{4,6}-\s+uses:\s*(\S+)/.test(line)) {
        flush();
        currentStep = { name: line.match(/^\s{4,6}-\s+uses:\s*(\S+)/)[1], run: '' };
        continue;
      }
      // A `run: |` (or `run: >`) block: capture every following line that is
      // blank or indented deeper than the `run:` key, until a line at the step
      // key depth (a new step or a new step key like `env:`/`if:`).
      if (/^\s{4,12}run:\s*[|>]\s*$/.test(line) && currentStep) {
        const body = [];
        const contentIndent = line.match(/^\s*/)[0].length + 2;
        let j = i + 1;
        while (j < lines.length) {
          const next = lines[j];
          if (
            next.trim() === '' ||
            (next.startsWith(' '.repeat(contentIndent)) && /\S/.test(next))
          ) {
            body.push(next.trim());
            j++;
          } else {
            break;
          }
        }
        currentStep.run = body.join('\n');
        i = j - 1;
        continue;
      }
      if (/^\s{4,6}-\s+run:\s*(\|?\s*)$/.test(line) && currentStep) {
        // Multi-line block run: collect until the next step or dedent.
        const body = [];
        let j = i + 1;
        while (j < lines.length && /^\s{6,}\S/.test(lines[j])) {
          body.push(lines[j].trim());
          j++;
        }
        currentStep.run = body.join('\n');
        i = j - 1;
        continue;
      }
      if (/^\s{4,6}-\s+run:\s*(.+)$/.test(line)) {
        if (!currentStep) currentStep = { name: '', run: '' };
        currentStep.run = line.match(/^\s{4,6}-\s+run:\s*(.+)$/)[1];
        continue;
      }
      if (/^\s{6,}\S/.test(line) && currentStep && !currentStep.run) {
        currentStep.run += line.trim();
      }
      if (/^\s{2,4}\S/.test(line)) {
        // New section under this job (with, env, etc.) — keep the step open.
        if (currentStep && !/^\s+steps:/.test(line)) continue;
      }
    }
  }
  flush();
  return jobs;
}

function validateWorkflow(filename) {
  const content = readFileSync(filename, 'utf8');

  // YAML syntax validation
  const yamlResult = validateYAMLSyntax(content);
  if (!yamlResult.valid) {
    return { valid: false, errors: yamlResult.errors };
  }

  // Workflow structure validation
  const structureResult = validateWorkflowStructure(content, filename);
  if (!structureResult.valid) {
    return { valid: false, errors: structureResult.errors };
  }

  // Varve-specific regression guards
  const varveErrors = validateVarveRules(content, filename);
  if (varveErrors.length > 0) {
    return { valid: false, errors: varveErrors };
  }

  return { valid: true, errors: [] };
}

function main() {
  const flags = parseArgs();
  const files = getWorkflowFiles(flags);

  if (files.length === 0) {
    console.log('No workflow files to validate');
    process.exit(0);
  }

  console.log(`Validating ${files.length} workflow file(s)...`);

  let hasErrors = false;

  for (const file of files) {
    const result = validateWorkflow(file);

    if (result.valid) {
      console.log(`✅ ${file}`);
    } else {
      console.log(`❌ ${file}`);
      for (const error of result.errors) {
        console.log(`   ${error}`);
      }
      hasErrors = true;
    }
  }

  if (hasErrors) {
    console.log('\n❌ Workflow validation failed');
    process.exit(1);
  }

  console.log('\n✅ All workflows are valid');
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
