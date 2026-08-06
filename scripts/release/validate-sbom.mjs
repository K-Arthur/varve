#!/usr/bin/env node
/**
 * Validate a CycloneDX SBOM structurally before it ships.
 *
 * CycloneDX schema validation normally means pulling a JSON Schema from
 * cyclonedx.org at build time — a supply-chain question for a supply-chain
 * document, on a repo whose release pipeline is deliberately zero-network
 * beyond the tools it already uses. Instead this validator checks every
 * structural rule the schema enforces that matters here, plus the Varve
 * identity rules the release process requires (an SBOM that calls the
 * application "Strata" is a release failure even though it is schema-valid).
 *
 * Usage:
 *   node scripts/release/validate-sbom.mjs dist/release/varve-sbom.cdx.json [more...]
 */
import { readFileSync } from 'node:fs';

const PURL = /^pkg:[a-z0-9.+-]+\/[^\s]+$/;

function validate(path) {
  let sbom;
  try {
    sbom = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`${path}: not valid JSON: ${err.message}`);
  }

  const errors = [];

  if (sbom.bomFormat !== 'CycloneDX') errors.push('bomFormat must be "CycloneDX"');
  if (!/^1\.[4-6]$/.test(sbom.specVersion ?? '')) {
    errors.push(`specVersion must be a supported CycloneDX version (got ${sbom.specVersion})`);
  }
  if (typeof sbom.version !== 'number' || sbom.version < 1) {
    errors.push('top-level version must be a positive integer');
  }

  const component = sbom.metadata?.component;
  if (!component) {
    errors.push('metadata.component is required');
  } else {
    if (component.type !== 'application')
      errors.push('metadata.component.type must be "application"');
    if (component.name !== 'Varve')
      errors.push(`component name must be "Varve" (got ${component.name})`);
    if (component['bom-ref'] && !component['bom-ref'].startsWith('pkg:generic/varve@')) {
      errors.push(`component bom-ref must be pkg:generic/varve@... (got ${component['bom-ref']})`);
    }
    if (!component.version) errors.push('component version is required');
    const metaText = JSON.stringify(sbom.metadata);
    if (/strata/i.test(metaText) && !/strata\.design/i.test(metaText)) {
      errors.push('metadata still identifies the application as "Strata"');
    }
  }

  const tools = sbom.metadata?.tools ?? [];
  for (const tool of tools) {
    if (String(tool.vendor ?? '').toLowerCase() === 'strata') {
      errors.push('tool vendor must not be "Strata"');
    }
  }

  if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
    errors.push('components must be a non-empty array');
  } else {
    const refs = new Set();
    for (const comp of sbom.components) {
      const ref = comp['bom-ref'];
      if (!ref || refs.has(ref)) {
        errors.push(`duplicate or missing bom-ref: ${JSON.stringify(ref)}`);
      }
      refs.add(ref);
      if (comp.purl && !PURL.test(comp.purl)) {
        errors.push(`malformed purl: ${JSON.stringify(comp.purl)}`);
      }
      if (!Array.isArray(comp.licenses) && comp.licenses !== undefined) {
        errors.push(`licenses must be an array for ${ref}`);
      }
      const props = (comp.properties ?? []).filter((p) => String(p.name).startsWith('strata:'));
      if (props.length > 0) {
        errors.push(
          `component ${ref} still carries strata: properties: ${props.map((p) => p.name).join(', ')}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    process.stderr.write(`${path}: invalid SBOM\n  - ${errors.join('\n  - ')}\n`);
    process.exitCode = 1;
    return false;
  }
  process.stdout.write(
    `${path}: valid CycloneDX ${sbom.specVersion} SBOM, ` +
      `${sbom.components.length} components\n`,
  );
  return true;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  process.stderr.write('usage: node scripts/release/validate-sbom.mjs <sbom.json> [more...]\n');
  process.exit(2);
}

let ok = true;
for (const file of files) {
  try {
    ok = validate(file) && ok;
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    ok = false;
  }
}
process.exit(ok ? 0 : 1);
