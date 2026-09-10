#!/usr/bin/env node
/**
 * Impact-config integrity audit.
 *
 * Verifies that validation-impact.config.mjs does not rot:
 *  - every path glob matches at least one real file
 *  - every rule id is unique
 *  - every rule references known lanes
 *  - every e2e domain maps to an existing directory
 *  - every fullEscalation/sharedContract glob matches something
 *
 * Exits 1 on any violation. Called by tests/unit/validationPolicy.test.ts
 * and by `pnpm verify:plan` itself (cheap).
 */

import { existsSync, globSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IMPACT_CONFIG } from '../../validation-impact.config.mjs';

const ROOT = process.cwd();

const LANE_PREFIXES = [
  'js-unit:',
  'typecheck:',
  'rust-test:',
  'rust-clippy:',
  'e2e:',
  'bench:',
  'audit:',
  'format:',
  'lint:',
];
const STATIC_LANES = new Set([
  'js-unit:all',
  'typecheck:all',
  'rust-test:all',
  'rust-clippy:all',
  'e2e:all',
  'e2e:visual',
  'desktop-native',
  'website-unit',
  'website-e2e',
  'bench:render',
  'bench:table',
  'bench:table-layout',
  'wasm',
  'models',
  'ci-tools',
  'policy',
  'audit:tokens',
  'audit:emoji',
  'audit:docs',
  'audit:health',
  'audit:architecture',
  'audit:typecheck-regression',
]);

function toRegExp(glob) {
  return new RegExp(
    '^' +
      glob
        .replace(/\./g, '\\.')
        .replace(/\*\*\//g, '(?:.*/)?')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*') +
      '$',
  );
}

function globMatchesAny(glob) {
  const _re = toRegExp(glob);
  if (!glob.includes('*')) return existsSync(join(ROOT, glob));
  return globSync(glob, { cwd: ROOT }).length > 0;
}

function laneExists(lane) {
  if (STATIC_LANES.has(lane)) return true;
  for (const p of LANE_PREFIXES) {
    if (lane.startsWith(p) && lane.length > p.length) return true;
  }
  return false;
}

export function auditImpactConfig({ cwd = ROOT } = {}) {
  const errors = [];
  const seen = new Set();

  // `cwd` exists for API symmetry with the other audit entry points; the
  // config globs are relative to ROOT by design, so it is intentionally not
  // used here.
  void cwd;

  for (const glob of IMPACT_CONFIG.fullEscalationPaths) {
    if (!globMatchesAny(glob)) errors.push(`fullEscalationPaths glob matches nothing: ${glob}`);
  }
  for (const glob of IMPACT_CONFIG.sharedContractPaths) {
    if (!globMatchesAny(glob)) errors.push(`sharedContractPaths glob matches nothing: ${glob}`);
  }

  for (const rule of IMPACT_CONFIG.impactRules) {
    if (!rule.id || seen.has(rule.id))
      errors.push(`impact rule id missing/duplicate: ${rule.id ?? '<none>'}`);
    seen.add(rule.id);
    if (!rule.why)
      errors.push(
        `impact rule ${rule.id}: missing 'why' (required — documents the implicit dependency)`,
      );
    for (const glob of rule.paths ?? []) {
      if (!globMatchesAny(glob))
        errors.push(`impact rule ${rule.id}: path glob matches nothing: ${glob}`);
    }
    for (const lane of rule.require ?? []) {
      if (!laneExists(lane)) errors.push(`impact rule ${rule.id}: unknown lane: ${lane}`);
    }
  }

  for (const [domain, globs] of Object.entries(IMPACT_CONFIG.e2eDomains)) {
    for (const g of globs) {
      if (!globMatchesAny(g)) errors.push(`e2e domain '${domain}': glob matches nothing: ${g}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function _statSyncSafe(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { ok, errors } = auditImpactConfig();
  for (const e of errors) console.error(`  ✗ ${e}`);
  if (!ok) {
    console.error('validation-impact config is stale — fix the violations above.');
    process.exit(1);
  }
  console.log('audit-impact-config: ok');
}
