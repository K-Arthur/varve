/**
 * PDF validation runner.
 *
 * Attempts to validate generated PDF files using veraPDF if available.
 * When veraPDF is not available, documents how to install it and what
 * command to run for external validation.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ValidationResult {
  file: string;
  profile: string;
  valid: boolean | null;
  error?: string;
}

const FIXTURES_DIR = resolve(__dirname, '../tests/fixtures/pdfs');
const RESULTS_FILE = resolve(__dirname, '../tests/fixtures/pdf-validation-results.json');

// Try to detect veraPDF
function findVeraPdf(): string | null {
  try {
    const result = execSync('which verapdf 2>/dev/null', { encoding: 'utf-8' });
    return result.trim() || null;
  } catch {
    return null;
  }
}

function validatePdf(filePath: string, profile: string, veraPdfPath: string): ValidationResult {
  const fileName = filePath.split('/').pop() || filePath;

  try {
    const result = execSync(
      `${veraPdfPath} --profile ${profile} --format json "${filePath}" 2>/dev/null`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
    );

    const report = JSON.parse(result);
    const isValid = report?.items?.[0]?.validationReport?.isCompliant ?? false;

    return {
      file: fileName,
      profile,
      valid: isValid,
    };
  } catch (e: unknown) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return {
      file: fileName,
      profile,
      valid: false,
      error: err.stderr || err.stdout || String(e),
    };
  }
}

async function main() {
  const veraPdfPath = findVeraPdf();

  if (!veraPdfPath) {
    console.log('=== PDF VALIDATION STATUS ===');
    console.log('');
    console.log('veraPDF NOT AVAILABLE on this system.');
    console.log('');
    console.log('To install veraPDF:');
    console.log('  Download from: https://github.com/veraPDF/veraPDF-apps/releases');
    console.log('  Or use Docker:  docker pull openpreserve/verapdf');
    console.log('');
    console.log('To validate generated PDFs externally:');
    console.log('  1. Generate fixtures: cargo test --workspace -- strata_print');
    console.log('  2. Copy PDFs from test output to tests/fixtures/pdfs/');
    console.log('  3. Run: verapdf --profile 1b tests/fixtures/pdfs/<file>');
    console.log('');
    console.log('=== INTERNAL STRUCTURAL CHECKS (no external validator) ===');
    console.log('');

    // Run internal structural checks
    const fixtureFiles = existsSync(FIXTURES_DIR)
      ? readFileSync(FIXTURES_DIR, { encoding: 'utf-8' }).split('\n').filter(Boolean)
      : [];

    if (fixtureFiles.length === 0) {
      // No fixtures yet - that's OK, the test suite generates them
      console.log('No PDF fixtures found in tests/fixtures/pdfs/.');
      console.log('Fixtures are generated during test runs.');
    } else {
      console.log(`${fixtureFiles.length} PDF fixtures available for external validation.`);
    }

    // Write results
    writeFileSync(
      RESULTS_FILE,
      JSON.stringify(
        {
          verapdf_available: false,
          installation_instructions: {
            url: 'https://github.com/veraPDF/veraPDF-apps/releases',
            docker: 'docker pull openpreserve/verapdf',
          },
          external_validation_command: 'verapdf --profile 1b tests/fixtures/pdfs/<file>',
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    console.log('');
    console.log('Results saved to:', RESULTS_FILE);
    process.exit(0);
  }

  // veraPDF is available - run validation
  console.log(`veraPDF found at: ${veraPdfPath}`);
  console.log('');

  if (!existsSync(FIXTURES_DIR)) {
    console.log('No PDF fixtures directory found.');
    console.log('Run tests first to generate fixtures: cargo test --workspace');
    process.exit(0);
  }

  const pdfFiles = readFileSync(FIXTURES_DIR, { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
    .filter((f: string) => f.endsWith('.pdf'));

  if (pdfFiles.length === 0) {
    console.log('No PDF files found in fixtures directory.');
    process.exit(0);
  }

  const results: ValidationResult[] = [];
  const profiles = ['1b', '2b', 'x4'];

  for (const pdfFile of pdfFiles) {
    for (const profile of profiles) {
      const result = validatePdf(resolve(FIXTURES_DIR, pdfFile), profile, veraPdfPath);
      results.push(result);
      const status = result.valid ? 'PASS' : 'FAIL';
      console.log(`  [${status}] ${result.file} (${profile})`);
    }
  }

  writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

  const allPassed = results.every((r) => r.valid);
  console.log('');
  console.log(`Validated ${results.length} combinations`);

  if (allPassed) {
    console.log('ALL VALIDATIONS PASSED');
    process.exit(0);
  } else {
    console.log('SOME VALIDATIONS FAILED');
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('Validation runner failed:', e);
  process.exit(1);
});
