// Qualify an installed production payload; external driver parent owns process cleanup.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { captureDomFailure } from './failure-evidence.mjs';
import { productionDomPage } from './webdriver-dom.mjs';

const { values: v } = parseArgs({
  options: {
    exe: { type: 'string' },
    input: { type: 'string' },
    out: { type: 'string' },
    profile: { type: 'string' },
    version: { type: 'string' },
    schema: { type: 'string' },
    arch: { type: 'string' },
    seed: { type: 'boolean', default: false },
    port: { type: 'string', default: '4444' },
  },
});
assert.equal(process.platform, 'linux', 'Run on the native Linux target');
assert.equal(process.arch, v.arch, 'Native runner architecture');
for (const name of ['exe', 'input', 'out', 'profile', 'version', 'schema', 'arch'])
  assert.ok(v[name], `--${name} is required`);
const rootRequire = createRequire(join(process.cwd(), 'package.json'));
const { remote } = createRequire(rootRequire.resolve('@wdio/cli'))('webdriverio');
const engineRequire = createRequire(join(process.cwd(), 'packages/engine/package.json'));
const { PNG } = engineRequire('pngjs');
const out = resolve(v.out),
  profile = resolve(v.profile),
  exe = resolve(v.exe);
const homeRelative = relative(resolve(homedir()), out);
assert.ok(
  homeRelative &&
    homeRelative !== '..' &&
    !homeRelative.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) &&
    !isAbsolute(homeRelative),
  '--out must be an isolated child of HOME for genuine native binary export scope',
);
mkdirSync(out, { recursive: true });
mkdirSync(profile, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = readFileSync(resolve(v.input)),
  original = JSON.parse(sourceBytes);
const input = join(out, 'Published 0.2.1 β.varve');
copyFileSync(resolve(v.input), input);
const savedPath = join(out, 'Migrated save β.varve');
const executable = readFileSync(exe);
assert.equal(executable.subarray(0, 4).toString('binary'), '\x7fELF');
assert.equal(
  executable.readUInt16LE(18),
  v.arch === 'arm64' ? 183 : 62,
  'installed ELF payload architecture',
);
const receipt = {
  kind: 'Actual installed production app UI and native filesystem qualification',
  sourceSha: v.seed ? null : (process.env.VARVE_RELEASE_SHA ?? null),
  baselineTag: v.seed ? 'v0.2.1' : null,
  executable: { path: exe, sha256: hash(executable), architecture: v.arch },
  input: { path: input, sha256: hash(sourceBytes), schema: original.formatVersion },
  expected: { version: v.version, schema: v.schema },
  dialogSelection:
    'One-shot runtime result only; native filesystem/save/export commands forwarded unchanged',
  limitation:
    'Does not qualify the native file picker itself; installer/version switching belongs to the parent native job',
  startedAt: new Date().toISOString(),
  passed: false,
  evidence: [],
};
let driver, page;
const deadline = Date.now() + 8 * 60_000;
async function until(fn, timeout = 30_000) {
  const end = Math.min(deadline, Date.now() + timeout);
  let last;
  while (Date.now() < end) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw last ?? new Error('Bounded condition deadline expired');
}
function retained(doc) {
  assert.equal(doc.formatVersion, v.schema);
  assert.equal(doc.nodes['poster-title'].text, original.nodes['poster-title'].text);
  for (const [key, value] of Object.entries(original.nodes['poster-curve']))
    assert.deepEqual(doc.nodes['poster-curve'][key], value, `authored curve ${key}`);
  if (!v.seed)
    assert.equal(doc.designCanvases.length, 1, 'current migration creates the design canvas');
  assert.equal(
    doc.assets['asset-ca2aceaaa125b46e'].dataUrl,
    original.assets['asset-ca2aceaaa125b46e'].dataUrl,
  );
  assert.deepEqual(
    doc.nodes['published-embedded-image'].transform,
    original.nodes['published-embedded-image'].transform,
  );
}
async function fileAction(name) {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name }).click();
}
async function destination(path) {
  await page.evaluate((target) => {
    const core = window.__TAURI__?.core;
    if (!core?.invoke) throw new Error('Real Tauri core unavailable');
    if (!window.__qualificationDialog) {
      const originalInvoke = core.invoke.bind(core);
      const state = { next: null, consumed: 0, forwarded: [] };
      const invoke = async (command, args) => {
        if (command === 'plugin:dialog|save') {
          if (!state.next) throw new Error('Unexpected save dialog; no one-shot destination');
          const result = state.next;
          state.next = null;
          state.consumed++;
          return result;
        }
        if (command === 'home_write_text_file_approved' || command === 'write_binary_file')
          state.forwarded.push(command);
        return originalInvoke(command, args);
      };
      // Tauri's generated core namespace is frozen. The outer global's core
      // property is replaceable; retain all exports and forward genuine invoke.
      const facade = { ...core, invoke };
      if (!Reflect.set(window.__TAURI__, 'core', facade) || window.__TAURI__.core !== facade)
        throw new Error('Actual Tauri core facade is not replaceable');
      window.__qualificationDialog = state;
    }
    if (window.__qualificationDialog.next) throw new Error('Previous destination was not consumed');
    window.__qualificationDialog.next = target ?? null;
  }, path);
}
async function save(predicate = () => true) {
  await fileAction(/^Save\b(?! As| a Copy)/);
  await until(async () => (await page.locator('.save-status').text()) === 'Saved');
  return until(() => {
    const doc = JSON.parse(readFileSync(savedPath, 'utf8'));
    return predicate(doc) && doc;
  });
}
function matchingProcesses() {
  return execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', timeout: 3000 })
    .split('\n')
    .filter((line) => {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      return match && (match[2] === exe || match[2].startsWith(exe + ' '));
    });
}
async function launch(documentPath) {
  assert.equal(
    matchingProcesses().length,
    0,
    'A different instance must not already own this installed executable',
  );
  driver = await remote({
    hostname: '127.0.0.1',
    port: Number(v.port),
    path: '/',
    logLevel: 'warn',
    connectionRetryCount: 0,
    connectionRetryTimeout: 30_000,
    capabilities: {
      // tauri-driver translates only tauri:options on Linux; WebKit rejects
      // the invented browserName "wry" before launching the installed app.
      'tauri:options': { application: exe, args: [documentPath] },
    },
  });
  await driver.setTimeout({ script: 15_000, implicit: 0, pageLoad: 60_000 });
  page = productionDomPage(driver);
  await until(() => page.locator('.editor-shell').isVisible(), 60_000);
  assert.equal(
    await page.evaluate(() => window.__TAURI__.app.getVersion()),
    v.version,
    'actual production app version',
  );
  const appDataDirectory = await page.evaluate(() => window.__TAURI__.path.appDataDir());
  if (receipt.appDataDirectory)
    assert.equal(
      appDataDirectory,
      receipt.appDataDirectory,
      'Native profile retained after process restart',
    );
  receipt.appDataDirectory = appDataDirectory;
  await page.evaluate(() => {
    window.__qualificationErrors = [];
    window.addEventListener('error', (event) => window.__qualificationErrors.push(event.message));
  });
}
async function selectImage() {
  const image = page.locator('[role="treeitem"][data-node-id="published-embedded-image"]');
  const poster = page.locator('[role="treeitem"][data-node-id="poster-frame"]');
  if (!(await image.isVisible()))
    await poster.getByRole('button', { name: 'Expand', exact: true }).click();
  await image.click();
}
async function quit() {
  await fileAction('Quit Varve');
  await until(() => matchingProcesses().length === 0, 20_000);
  await driver.deleteSession().catch(() => {});
  driver = null;
}
try {
  await launch(input);
  await destination(savedPath);
  await fileAction(/^Save As/);
  await until(async () => (await page.locator('.save-status').text()) === 'Saved');
  const first = await until(() => JSON.parse(readFileSync(savedPath, 'utf8')));
  retained(first);
  await selectImage();
  if (!v.seed) {
    const x = page.getByRole('spinbutton', { name: /^X(?: \(ab\))? \(px\)$/i });
    await x.fill(String(Number(await x.inputValue()) + 1));
    await x.press('Enter');
    const changed = await save(
      (doc) =>
        doc.nodes['published-embedded-image'].transform[4] >
        first.nodes['published-embedded-image'].transform[4],
    );
    assert.ok(
      changed.nodes['published-embedded-image'].transform[4] >
        first.nodes['published-embedded-image'].transform[4],
    );
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: /^Undo/ }).click();
    retained(
      await save(
        (doc) =>
          doc.nodes['published-embedded-image'].transform[4] ===
          first.nodes['published-embedded-image'].transform[4],
      ),
    );
  }
  await page.screenshot({ path: join(out, 'native-saved.png') });
  assert.deepEqual(await page.evaluate(() => window.__qualificationErrors), []);
  receipt.evidence.push({
    phase: 'save and native quit',
    savedSha256: hash(readFileSync(savedPath)),
  });
  await quit();
  await launch(savedPath);
  await selectImage();
  if (!v.seed) {
    const tab = page.getByRole('tab', { name: 'Export', exact: true });
    if (await tab.isVisible()) await tab.click();
    else {
      await page.getByRole('button', { name: /^More inspector tabs/ }).click();
      await page
        .getByRole('menu', { name: 'More inspector tabs' })
        .getByRole('menuitem', { name: 'Export', exact: true })
        .click();
    }
    for (const format of ['PNG', 'SVG', 'PDF']) {
      const target = join(out, `native-export.${format.toLowerCase()}`);
      await destination(target);
      await page.getByRole('radio', { name: format, exact: true }).click();
      await page.getByRole('button', { name: /download/i }).click();
      const bytes = await until(() => {
        const b = readFileSync(target);
        return b.length > 100 && b;
      });
      if (format === 'PNG') {
        const png = PNG.sync.read(bytes),
          source = PNG.sync.read(
            Buffer.from(original.assets['asset-ca2aceaaa125b46e'].dataUrl.split(',')[1], 'base64'),
          );
        assert.deepEqual([png.width, png.height], [104, 80]);
        for (const nx of [0.25, 0.75])
          for (const ny of [0.25, 0.75]) {
            const at = (Math.floor(ny * png.height) * png.width + Math.floor(nx * png.width)) * 4;
            const sourceAt =
              (Math.floor(ny * source.height) * source.width + Math.floor(nx * source.width)) * 4;
            assert.deepEqual(
              png.data.subarray(at, at + 4),
              source.data.subarray(sourceAt, sourceAt + 4),
              'exported embedded-asset pixels',
            );
          }
      } else if (format === 'SVG') {
        assert.match(bytes.toString(), /<svg\b/);
        assert.match(bytes.toString(), /data:image\/png;base64,/);
      } else {
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        assert.match(bytes.toString(), /\/Type\s*\/Page\b/);
        assert.match(bytes.toString(), /%%EOF/);
      }
      receipt.evidence.push({
        phase: `actual native ${format} output`,
        path: target,
        sha256: hash(bytes),
        bytes: bytes.length,
      });
    }
  }
  await destination(null);
  retained(await save());
  assert.equal(hash(readFileSync(input)), hash(sourceBytes), 'backed-up source document unchanged');
  await page.screenshot({ path: join(out, 'native-reopened.png') });
  assert.deepEqual(await page.evaluate(() => window.__qualificationErrors), []);
  const calls = await page.evaluate(() => window.__qualificationDialog);
  assert.ok(
    calls.forwarded.includes('home_write_text_file_approved'),
    'real native save command was used',
  );
  if (!v.seed)
    assert.ok(calls.forwarded.includes('write_binary_file'), 'real native export writer was used');
  receipt.evidence.push({
    phase: 'native process restart and disk reopen',
    savedSha256: hash(readFileSync(savedPath)),
    forwardedCommands: calls.forwarded,
  });
  await quit();
  receipt.passed = true;
} catch (error) {
  receipt.error = error.stack ?? String(error);
  process.exitCode = 1;
  await captureDomFailure(page, out, receipt);
} finally {
  if (driver) await driver.deleteSession().catch(() => {});
  receipt.finishedAt = new Date().toISOString();
  writeFileSync(join(out, 'qualification.json'), JSON.stringify(receipt, null, 2) + '\n');
}
