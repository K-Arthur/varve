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
import { join } from 'node:path';

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
