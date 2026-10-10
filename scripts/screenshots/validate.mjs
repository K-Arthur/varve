#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
/**
 * Screenshot manifest validation — the independent check on the pipeline's
 * self-reported success.
 *
 * Checks that the screenshot manifest
 * (apps/website/src/data/screenshot-manifest.json) is internally consistent,
 * that every captured file it references really exists, *decodes* as a PNG,
 * matches its recorded hash and dimensions, and is byte-identical to its
 * canonical copy under `docs/screenshots/product/`.
 *
 * "Decodes" is deliberate: the previous implementation read the 8-byte
 * signature and the IHDR, which a truncated file or a byte-flipped file keeps
 * intact. This version verifies every chunk CRC and inflates the image data
 * (see `lib/image-analysis.mjs`), and flags uniformly blank output.
 *
 * It also verifies documentation/website references: any `/screenshots/` path
 * in docs, README or website sources must resolve to a captured manifest entry
 * or a documented generated asset.
 *
 *   node scripts/screenshots/validate.mjs [--strict] [--scenes a,b]
 *
 * --strict  additionally fails when any scene is skipped.
 * --scenes  asserts the named scenes exist in the manifest, so a mistyped
 *           filter cannot pass as "nothing to check".
 *
 * This script never writes. Promotion is `product.mjs --sync-reviewed`.
 */
import { createHash } from 'node:crypto';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyseImage, buffersEqual, pngDimensions } from './lib/image-analysis.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const MANIFEST_PATH = join(ROOT, 'apps', 'website', 'src', 'data', 'screenshot-manifest.json');
const PUBLIC_DIR = join(ROOT, 'apps', 'website', 'public', 'screenshots');
const DOCS_DIR = join(ROOT, 'docs', 'screenshots', 'product');
const args = process.argv.slice(2);
const strict = args.includes('--strict');

/** Read-only git query; `null` when git is unavailable (then we assume committed). */
function git(gitArgs) {
  try {
    return execFileSync('git', gitArgs, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}
const scenesFlag = args.indexOf('--scenes');
const requested = new Set(
  (scenesFlag === -1 ? '' : (args[scenesFlag + 1] ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
if (scenesFlag >= 0 && requested.size === 0) {
  console.error('FAIL --scenes requires a comma-separated list of scene ids');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const scenes = manifest.scenes ?? {};
let failures = 0;
let verified = 0;

function fail(msg) {
  failures++;
  console.error(`FAIL ${msg}`);
}

const PNG_BUDGET_WARN = 1_000_000; // 1 MB
const PNG_BUDGET_FAIL = 2_000_000; // 2 MB
const PNG_TOTAL_BUDGET_WARN = 5_000_000; // 5 MB
const PNG_TOTAL_BUDGET_FAIL = 10_000_000; // 10 MB
const VIDEO_BUDGET_WARN = 5_000_000;
const VIDEO_BUDGET_FAIL = 10_000_000;
const KINDS = new Set(['full', 'detail', 'panel', 'wide']);

/**
 * Generated assets that are real, referenced files but deliberately have no
 * product-scene manifest entry. Every entry states where it comes from so it
 * cannot become an undocumented bypass of the manifest.
 *
 * `public/screenshots/workflows/**` is a separate, separately validated
 * deliverable (`scripts/capture/verify-workflows.mjs`) and is scoped out of
 * this check entirely.
 */
const generatedAssets = new Map([
  [
    'workflow-poster.png',
    'first frame of the workflow recording (scripts/screenshots/workflow.mjs)',
  ],
  ['workflow.webm', 'workflow recording (scripts/screenshots/workflow.mjs)'],
  ['workflow.mp4', 'workflow recording (scripts/screenshots/workflow.mjs)'],
]);

if (!manifest.schemaVersion) fail('manifest missing schemaVersion');
for (const key of ['sourceRevision', 'sourceDigest', 'captureTool']) {
  if (!manifest[key]) fail(`manifest missing provenance field "${key}"`);
}

const ids = Object.keys(scenes);
if (ids.length === 0) fail('manifest has no scenes');
for (const id of requested) {
  if (!(id in scenes)) fail(`--scenes requested "${id}" but the manifest has no such scene`);
}

const capturedFiles = new Set();
const capturedNames = new Map();
let totalPngBytes = 0;

for (const [id, scene] of Object.entries(scenes)) {
  if (typeof scene.file !== 'string' || !scene.file.endsWith('.png')) {
    fail(`${id}: missing/odd file name`);
    continue;
  }
  // A manifest is data, but a traversal or a nested path in `file` would let a
  // generated manifest reference (and the sync step write) outside the
  // published directory.
  if (basename(scene.file) !== scene.file) {
    fail(`${id}: file must be a bare file name in the screenshots directory, got "${scene.file}"`);
    continue;
  }
  if (capturedNames.has(scene.file)) {
    fail(`${id}: file "${scene.file}" is already used by scene "${capturedNames.get(scene.file)}"`);
  }
  capturedNames.set(scene.file, id);
  if (!scene.alt || scene.alt.length < 10) fail(`${id}: missing meaningful alt text`);
  if (!scene.caption || scene.caption.length < 5) fail(`${id}: missing caption`);
  if (!scene.feature) fail(`${id}: missing feature`);
  if (scene.theme !== 'light' && scene.theme !== 'dark') {
    fail(`${id}: theme must be "light" or "dark", got ${JSON.stringify(scene.theme)}`);
  }
  if (scene.lastValidatedAgainst != null && !/^[0-9a-f]{40}$/.test(scene.lastValidatedAgainst)) {
    fail(`${id}: lastValidatedAgainst must be null or a 40-char git revision`);
  }
  if (scene.source !== undefined) {
    if (typeof scene.source !== 'string' || !existsSync(join(ROOT, scene.source))) {
      fail(`${id}: source "${scene.source}" does not exist in the repository`);
    }
  }

  if (scene.status === 'captured') {
    const path = join(PUBLIC_DIR, scene.file);
    let buf;
    try {
      buf = readFileSync(path);
    } catch {
      fail(`${id}: referenced file ${scene.file} does not exist in public/screenshots`);
      continue;
    }
    if (buf.length === 0) {
      fail(`${id}: ${scene.file} is 0 bytes`);
      continue;
    }
    totalPngBytes += buf.length;
    if (buf.length > PNG_BUDGET_FAIL) {
      fail(
        `${id}: ${scene.file} exceeds ${PNG_BUDGET_FAIL / 1_000_000} MB budget (${(buf.length / 1_000_000).toFixed(2)} MB)`,
      );
    } else if (buf.length > PNG_BUDGET_WARN) {
      console.warn(
        `WARN ${id}: ${scene.file} is ${(buf.length / 1_000_000).toFixed(2)} MB (warn threshold ${PNG_BUDGET_WARN / 1_000_000} MB)`,
      );
    }
    const analysis = analyseImage(buf);
    if (!analysis.valid) {
      fail(`${id}: ${scene.file} does not decode cleanly: ${analysis.errors.join('; ')}`);
      continue;
    }
    const dims = { width: analysis.width, height: analysis.height };
    // Full application frames are 1440x900; cropped detail scenes are
    // deliberately smaller but still have to be large enough to read.
    if (dims.width < 280 || dims.height < 260) {
      fail(`${id}: ${scene.file} dimensions too small (${dims.width}x${dims.height})`);
    }
    if (scene.width !== dims.width || scene.height !== dims.height) {
      fail(
        `${id}: manifest dims (${scene.width}x${scene.height}) mismatch file (${dims.width}x${dims.height})`,
      );
    }
    if (!KINDS.has(scene.kind)) {
      fail(`${id}: kind must be one of ${[...KINDS].join('/')}, got ${JSON.stringify(scene.kind)}`);
    }
    // The crop, when declared, has to describe a window that exists inside the
    // viewport it was taken from — a crop wider than its viewport is a
    // mis-recorded capture, not a stylistic choice.
    if (scene.crop) {
      const expected = scene.viewport ?? { width: 1440, height: 900 };
      const { x, y, width, height } = scene.crop;
      if (
        ![x, y, width, height].every((n) => Number.isFinite(n) && n >= 0) ||
        x + width > expected.width ||
        y + height > expected.height
      ) {
        fail(`${id}: crop ${JSON.stringify(scene.crop)} does not fit its viewport`);
      }
      if (width !== dims.width || height !== dims.height) {
        fail(`${id}: crop ${width}x${height} does not match the file ${dims.width}x${dims.height}`);
      }
    }
    if (scene.viewport) {
      const { width, height } = scene.viewport;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        fail(`${id}: viewport ${JSON.stringify(scene.viewport)} is not a size`);
      } else if (!scene.crop && (width !== dims.width || height !== dims.height)) {
        fail(
          `${id}: viewport ${width}x${height} does not match the file ${dims.width}x${dims.height}`,
        );
      }
    }
    if (scene.scale !== undefined && scene.scale !== 1) {
      fail(`${id}: unsupported capture scale ${scene.scale} (captures are DPR 1)`);
    }
    const actualHash = createHashHex(buf);
    if (!/^[0-9a-f]{64}$/.test(scene.sha256 ?? '')) {
      fail(`${id}: missing or invalid sha256`);
    } else if (scene.sha256 !== actualHash) {
      fail(`${id}: ${scene.file} sha256 does not match manifest`);
    }
    try {
      const docsBuf = readFileSync(join(DOCS_DIR, scene.file));
      if (!buffersEqual(docsBuf, buf)) {
        fail(`${id}: docs/screenshots/product/${scene.file} differs from public/screenshots`);
      }
    } catch {
      fail(`${id}: missing docs/screenshots/product/${scene.file}`);
    }
    // Optional responsive derivatives. Each must exist, decode, be byte-equal
    // across both output directories, never be an upscale of the source, and
    // never be the only copy.
    if (scene.variants !== undefined) {
      if (!Array.isArray(scene.variants) || scene.variants.length === 0) {
        fail(`${id}: variants must be a non-empty array when present`);
      } else {
        for (const variant of scene.variants) {
          if (typeof variant?.file !== 'string' || basename(variant.file) !== variant.file) {
            fail(
              `${id}: variant file must be a bare file name, got ${JSON.stringify(variant?.file)}`,
            );
            continue;
          }
          if (!/\.(webp|avif)$/.test(variant.file)) {
            fail(`${id}: variant ${variant.file} must be a .webp or .avif derivative`);
          }
          let variantBuf;
          try {
            variantBuf = readFileSync(join(PUBLIC_DIR, variant.file));
          } catch {
            fail(`${id}: variant ${variant.file} does not exist in public/screenshots`);
            continue;
          }
          const variantAnalysis = analyseImage(variantBuf);
          if (!variantAnalysis.valid) {
            fail(
              `${id}: variant ${variant.file} does not decode cleanly: ${variantAnalysis.errors.join('; ')}`,
            );
            continue;
          }
          const expectedFormat = variant.file.endsWith('.avif') ? 'avif' : 'webp';
          if (variantAnalysis.format !== expectedFormat) {
            fail(
              `${id}: variant ${variant.file} is ${variantAnalysis.format}, expected ${expectedFormat}`,
            );
          }
          if (createHashHex(variantBuf) !== variant.sha256) {
            fail(`${id}: variant ${variant.file} sha256 does not match manifest`);
          }
          if (variant.width > dims.width || variant.height > dims.height) {
            fail(
              `${id}: variant ${variant.file} (${variant.width}x${variant.height}) upscales the source (${dims.width}x${dims.height})`,
            );
          }
          try {
            const docsVariant = readFileSync(join(DOCS_DIR, variant.file));
            if (!buffersEqual(docsVariant, variantBuf)) {
              fail(`${id}: variant ${variant.file} differs between docs and public copies`);
            }
          } catch {
            fail(`${id}: variant ${variant.file} missing docs/screenshots/product copy`);
          }
        }
      }
    }
    verified++;
    capturedFiles.add(scene.file);
    for (const variant of scene.variants ?? []) {
      if (variant?.file) capturedFiles.add(variant.file);
    }
  } else if (scene.status === 'skipped') {
    if (!scene.reason || scene.reason.length < 5) fail(`${id}: skipped without a reason`);
  } else {
    fail(`${id}: unknown status "${scene.status}"`);
  }
}

if (totalPngBytes > PNG_TOTAL_BUDGET_FAIL) {
  fail(
    `captured PNG set exceeds ${PNG_TOTAL_BUDGET_FAIL / 1_000_000} MB total budget (${(totalPngBytes / 1_000_000).toFixed(2)} MB)`,
  );
} else if (totalPngBytes > PNG_TOTAL_BUDGET_WARN) {
  console.warn(
    `WARN captured PNG set is ${(totalPngBytes / 1_000_000).toFixed(2)} MB total (warn threshold ${PNG_TOTAL_BUDGET_WARN / 1_000_000} MB)`,
  );
}

// Every reference to screenshots in docs/marketing must resolve to a captured
// manifest entry (no stale paths, no hand-copied copies). Video and poster
// references resolve against the generated workflow assets instead of the
// manifest — they are not manifest scenes.
//
// Two forms are matched. The attribute form covers plain markup; the bare form
// catches a path inside a template expression (`src={sitePath('/screenshots/
// x.png')}`), which the attribute pattern cannot see because of the quote and
// parenthesis between `src=` and the path. That gap let three references to
// files that do not exist pass this validator while the built pages served
// 404s (found 2026-09-29).
const refPatterns = [
  /(?:src|href|poster)=["']?[^"'\s>]*\/screenshots\/([a-z0-9-]+\.(?:png|webp|avif|webm|mp4))["']?/g,
  /!\[[^\]]*\]\([^)\s]*\/screenshots\/([a-z0-9-]+\.(?:png|webp|avif|webm|mp4))/g,
  /\/screenshots\/([a-z0-9-]+\.(?:png|webp|avif|webm|mp4))/g,
];
const haystack = [
  ...globSync('docs/**/*.md', { cwd: ROOT }),
  ...globSync('README.md', { cwd: ROOT }),
  ...globSync('apps/website/src/**/*.{astro,md,ts,tsx}', { cwd: ROOT }),
]
  // Unit tests may name synthetic screenshot files; they are not references
  // the built site resolves.
  .filter((rel) => !/\.test\.(ts|tsx)$/.test(rel))
  .map((rel) => ({ rel, text: readFileSync(join(ROOT, rel), 'utf8') }));

// A reference that exists in the committed tree must resolve. A reference that
// only exists in an uncommitted local edit is reported as a warning instead of
// failing the gate: the checkout is shared, another task may be mid-edit and
// about to add the asset, and the commit/CI run will fail on it then. This is
// the difference between "the repository is broken" and "my neighbour's
// working tree is incomplete".
const dirtyPaths = new Set(
  (git(['status', '--porcelain', '--', 'apps/website/src', 'docs', 'README.md']) ?? '')
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean),
);

const missingRefs = new Map();
for (const { rel, text } of haystack) {
  for (const re of refPatterns) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const file = m[1];
      if (capturedFiles.has(file)) continue;
      if (generatedAssets.has(file) && existsSync(join(PUBLIC_DIR, file))) continue;
      if (/\.(webm|mp4|webp|avif)$/.test(file)) {
        if (!existsSync(join(PUBLIC_DIR, file))) missingRefs.set(file, rel);
        continue;
      }
      missingRefs.set(file, rel);
    }
  }
}
for (const [ref, rel] of missingRefs) {
  if (dirtyPaths.has(rel)) {
    console.warn(
      `WARN uncommitted reference to missing screenshot: ${ref} (from ${rel}, currently modified)`,
    );
    continue;
  }
  fail(`reference to missing screenshot: ${ref} (from ${rel})`);
}

// No file may exist in a published screenshots directory without a manifest
// entry (avoids drift between generated assets and the manifest). Both output
// directories are checked: a renamed scene leaves its old file behind in each,
// and only the manifest knows which name is current. `workflows/` is excluded
// because it is a separate validated deliverable.
for (const [label, dir] of [
  ['public/screenshots', PUBLIC_DIR],
  ['docs/screenshots/product', DOCS_DIR],
]) {
  for (const file of globSync('*.{png,webp,avif}', { cwd: dir })) {
    if (capturedFiles.has(file) || generatedAssets.has(file)) continue;
    if (/^debug-/.test(file)) {
      // A diagnostic dump from a VARVE_SHOT_DEBUG run. Since 2026-09-29 the
      // pipeline writes these under reports/screenshot-debug/, so one landing
      // here is stale local state rather than a repository defect — surfaced,
      // not fatal, because an untracked local file must not block the gate.
      console.warn(
        `WARN diagnostic artifact in ${label}: ${file} — delete it; the pipeline now writes diagnostics to reports/screenshot-debug/`,
      );
      continue;
    }
    fail(`orphan file in ${label}: ${file}`);
  }
}

// Video asset validation: workflow.webm / workflow.mp4 are optional but if
// present must pass budget checks and be byte-identical in both directories.
for (const ext of ['webm', 'mp4']) {
  const fileName = `workflow.${ext}`;
  const docsPath = join(DOCS_DIR, fileName);
  const publicPath = join(PUBLIC_DIR, fileName);
  try {
    const buf = readFileSync(publicPath);
    if (buf.length === 0) {
      fail(`workflow video ${fileName} is 0 bytes`);
    } else if (buf.length > VIDEO_BUDGET_FAIL) {
      fail(
        `workflow video ${fileName} exceeds ${VIDEO_BUDGET_FAIL / 1_000_000} MB budget (${(buf.length / 1_000_000).toFixed(1)} MB)`,
      );
    } else if (buf.length > VIDEO_BUDGET_WARN) {
      console.warn(
        `WARN workflow video ${fileName} is ${(buf.length / 1_000_000).toFixed(1)} MB (warn threshold ${VIDEO_BUDGET_WARN / 1_000_000} MB)`,
      );
    }
    try {
      const docsBuf = readFileSync(docsPath);
      if (!buffersEqual(docsBuf, buf)) {
        fail(
          `workflow video ${fileName}: docs/screenshots copy differs from public/screenshots (bytes, not just length)`,
        );
      }
    } catch {
      fail(
        `workflow video ${fileName} exists in public/screenshots but missing from docs/screenshots/product/`,
      );
    }
  } catch {
    // Video is optional — not a failure if absent
  }
}

// Poster frame: optional, but when present it must be a sane PNG within the
// standard image budget and consistent across both output directories.
{
  const fileName = 'workflow-poster.png';
  const docsPath = join(DOCS_DIR, fileName);
  const publicPath = join(PUBLIC_DIR, fileName);
  let publicBuf = null;
  try {
    publicBuf = readFileSync(publicPath);
  } catch {
    // Optional — the website embed degrades to no poster / no still
  }
  if (publicBuf) {
    if (publicBuf.length === 0) {
      fail(`workflow poster ${fileName} is 0 bytes`);
    } else if (publicBuf.length > PNG_BUDGET_FAIL) {
      fail(
        `workflow poster ${fileName} exceeds ${PNG_BUDGET_FAIL / 1_000_000} MB budget (${(publicBuf.length / 1_000_000).toFixed(2)} MB)`,
      );
    } else if (!pngDimensions(publicBuf)) {
      fail(`workflow poster ${fileName} is not a PNG`);
    }
    try {
      const docsBuf = readFileSync(docsPath);
      if (!buffersEqual(docsBuf, publicBuf)) {
        fail(
          `workflow poster ${fileName}: docs/screenshots copy differs from public/screenshots (bytes, not just length)`,
        );
      }
    } catch {
      fail(
        `workflow poster ${fileName} exists in public/screenshots but missing from docs/screenshots/product/`,
      );
    }
  } else if (existsSync(docsPath)) {
    fail(
      `workflow poster ${fileName} exists in docs/screenshots/product but missing from public/screenshots`,
    );
  }
}

const skipped = Object.values(scenes).filter((s) => s.status === 'skipped');
const untouched = requested.size > 0 ? ids.length - requested.size : 0;

// README is the repository's first-run surface. Validate every relative link
// and HTML asset reference there, not only screenshot references: a renamed
// logo, guide, or local media file must fail CI instead of silently degrading
// the page on GitHub. Remote URLs, anchors, and mailto links are intentionally
// outside this filesystem check.
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const readmeRefs = new Set();
const addReadmeRef = (raw) => {
  const target = raw.trim().replace(/^<|>$/g, '').split(/[?#]/, 1)[0];
  if (
    !target ||
    target.startsWith('#') ||
    target.startsWith('/') ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)
  ) {
    return;
  }
  readmeRefs.add(target);
};
for (const match of readme.matchAll(/!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
  addReadmeRef(match[1]);
}
for (const match of readme.matchAll(/\b(?:src|href|poster)=["']([^"']+)["']/g)) {
  addReadmeRef(match[1]);
}
for (const ref of readmeRefs) {
  if (!existsSync(join(ROOT, ref))) fail(`README references missing local path: ${ref}`);
}
console.log(`README local references: ${readmeRefs.size} checked`);

if (strict && skipped.length > 0) {
  fail(`strict mode: ${skipped.length} scene(s) skipped`);
}

const captured = Object.values(scenes).filter((s) => s.status === 'captured').length;
console.log(
  `screenshot manifest: ${captured} captured (${verified} verified this run), ` +
    `${skipped.length} skipped, ${untouched} untouched by the filter, ${failures} violation(s)`,
);
process.exit(failures > 0 ? 1 : 0);

/** sha256 hex of a buffer. */
function createHashHex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
