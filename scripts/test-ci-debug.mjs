#!/usr/bin/env node

/**
 * Test script for CI debug log extraction
 * Simulates a failure scenario and verifies the debug tool works correctly
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractFailures, isFailureLine, rankLine } from './ci-debug.mjs';

const TEST_DIR = '/tmp/ci-debug-test';
const TEST_LOG = join(TEST_DIR, 'test-failure.log');

function setupTestEnvironment() {
  console.log('Setting up test environment...');

  try {
    mkdirSync(TEST_DIR, { recursive: true });
  } catch {
    // Directory might already exist
  }

  // Create a simulated failure log with various error patterns
  const testLogContent = `
Run pnpm install
  pnpm install --frozen-lockfile
  Error: Cannot find module 'missing-package'
  at /home/runner/work/_temp/install.js:42:15
  at Module.load (node:internal/modules/closure:45:32)
  npm ERR! code ENOENT
  npm ERR! syscall open
  npm ERR! path /tmp/missing-package.tgz
  npm ERR! errno -2

Run cargo test
  cargo test --workspace --all-targets
    Compiling strata-core v0.1.0
    Compiling strata-engine v0.1.0
  error: failed to compile: unused import: \`std::collections::HashMap\`
  --> crates/strata-core/src/lib.rs:15:23
   |
15 | use std::collections::HashMap;
   |                      ^^^^^^^
   |
note: lint level set to \`deny-warnings\`
  error: aborting due to previous error
  cargo test failed with exit code 101

Run pnpm test
  pnpm test
  FAIL test/canvas.spec.ts
  ● Canvas rendering › should render rectangle
    expect(received).toBe(expected)
    Expected: 200
    Received: 150
      at test/canvas.spec.ts:42:18
  AssertionError: expected 150 to be 200
  test failed: 1/10 tests failed

Run typecheck
  pnpm typecheck
  error TS2307: Cannot find module 'missing-types' or its type declarations
  error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
  Typecheck failed with 2 errors
`;

  writeFileSync(TEST_LOG, testLogContent);
  console.log('✅ Test log created');
}

function testExtractionLogic() {
  console.log('\n=== Testing extraction logic ===');

  const testLog = readFileSync(TEST_LOG, 'utf8');
  const failures = extractFailures(testLog, 2);

  console.log(`Found ${failures.length} failure patterns`);

  if (failures.length === 0) {
    console.log('❌ No failures found - extraction logic may be broken');
    return false;
  }

  console.log('\nTop failures:');
  for (let i = 0; i < Math.min(5, failures.length); i++) {
    const failure = failures[i];
    console.log(`  ${i + 1}. Line ${failure.line}: ${failure.text.substring(0, 80)}...`);
  }

  // Verify we caught the key errors
  const errorTypes = failures.map((f) => f.text);
  const hasNpmError = errorTypes.some((e) => e.includes('npm ERR!'));
  const hasCargoError = errorTypes.some((e) => e.includes('cargo test failed'));
  const hasTestError = errorTypes.some((e) => e.includes('test failed'));
  const hasTypeError = errorTypes.some((e) => e.includes('TypeScript') || e.includes('TS'));

  console.log('\nError type detection:');
  console.log(`  npm errors: ${hasNpmError ? '✅' : '❌'}`);
  console.log(`  cargo errors: ${hasCargoError ? '✅' : '❌'}`);
  console.log(`  test failures: ${hasTestError ? '✅' : '❌'}`);
  console.log(`  TypeScript errors: ${hasTypeError ? '✅' : '❌'}`);

  const allDetected = hasNpmError && hasCargoError && hasTestError && hasTypeError;

  if (allDetected) {
    console.log('\n✅ All error types detected correctly');
  } else {
    console.log('\n❌ Some error types not detected');
  }

  return allDetected;
}

function testFailureLineDetection() {
  console.log('\n=== Testing failure line detection ===');

  const testCases = [
    { line: 'Error: something broke', expected: true },
    { line: '  ERROR: missing file', expected: true },
    { line: 'cargo test failed with exit code 101', expected: true },
    { line: 'npm ERR! code ENOENT', expected: true },
    { line: 'normal output line', expected: false },
    { line: '  + exit 0', expected: false },
  ];

  let allPassed = true;

  for (const { line, expected } of testCases) {
    const result = isFailureLine(line);
    const passed = result === expected;
    allPassed = allPassed && passed;

    console.log(`  ${passed ? '✅' : '❌'} "${line.substring(0, 40)}..." -> ${result}`);
  }

  return allPassed;
}

function testRanking() {
  console.log('\n=== Testing failure ranking ===');

  const testCases = [
    { line: 'error: foo', expectedRank: 0 }, // Matches ERROR/FAIL/FATAL pattern at index 0
    { line: 'panicked at foo', expectedRank: 7 }, // Lower priority
  ];

  let allPassed = true;

  for (const { line, expectedRank } of testCases) {
    const rank = rankLine(line);
    const passed = rank === expectedRank;
    allPassed = allPassed && passed;

    console.log(`  ${passed ? '✅' : '❌'} "${line}" -> rank ${rank} (expected ${expectedRank})`);
  }

  // The invariant that matters: generic error outranks panic regardless of
  // where new patterns are inserted into FAILURE_PATTERNS.
  const genericRank = rankLine('error: foo');
  const panicRank = rankLine('panicked at foo');
  if (genericRank >= panicRank) {
    console.log('  ❌ invariant broken: generic "error:" must outrank "panicked at"');
    allPassed = false;
  } else {
    console.log('  ✅ invariant: "error:" outranks "panicked at"');
  }

  return allPassed;
}

function cleanup() {
  console.log('\nCleaning up test environment...');
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
    console.log('✅ Cleanup complete');
  } catch (error) {
    console.warn(`⚠️  Cleanup warning: ${error.message}`);
  }
}

function main() {
  console.log('=== CI Debug Tool Verification ===\n');

  try {
    setupTestEnvironment();

    const extractionPassed = testExtractionLogic();
    const detectionPassed = testFailureLineDetection();
    const rankingPassed = testRanking();

    const allPassed = extractionPassed && detectionPassed && rankingPassed;

    console.log('\n=== Test Results ===');
    console.log(`Extraction logic: ${extractionPassed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Failure detection: ${detectionPassed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Failure ranking: ${rankingPassed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`\nOverall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

    cleanup();

    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error(`\n❌ Test execution failed: ${error.message}`);
    cleanup();
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
