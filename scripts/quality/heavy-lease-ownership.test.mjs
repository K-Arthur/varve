/** Real wrapper interoperability, with small isolated child-process fixtures. */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leasePaths, legacyLeasePaths } from './heavy-lease.mjs';

const script = fileURLToPath(new URL('./heavy-lease.mjs', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'varve-lease-ownership-'));
const env = {
  ...process.env,
  XDG_RUNTIME_DIR: directory,
  VARVE_LEASE_MIN_MEM_MB: '0',
  VARVE_LEASE_TIMEOUT: '4000',
  VARVE_LEASE_POLL_MS: '10',
};
delete env.VARVE_HEAVY_LEASE_OWNER;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate() && Date.now() < deadline) await delay(5);
  assert.ok(predicate(), 'lease fixture did not reach its scheduling barrier');
}
function launch(argv, options = {}) {
  const child = spawn(process.execPath, argv, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  return {
    child,
    output: () => output,
    exit: new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    }),
  };
}
function ownerCommand(ready, finish) {
  return `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(finish)}))clearInterval(timer)},5);`;
}

try {
  const windowsLeaseBase = join(directory, 'windows-path-fixture');
  const forwardSlashAliases = legacyLeasePaths(
    windowsLeaseBase,
    'C:/Users/runnera',
    'c:\\users\\runnera',
  ).sort();
  const backslashAliases = legacyLeasePaths(
    windowsLeaseBase,
    'C:\\Users\\runnera',
    'c:\\users\\runnera',
  ).sort();
  assert.deepEqual(forwardSlashAliases, backslashAliases);
  assert.equal(forwardSlashAliases.length, 5);

  // A genuine nested invocation authenticates the inherited owner and must
  // not wait on itself or replace/release the parent's canonical lease.
  const inner = `const fs=require('node:fs');const token=JSON.parse(process.env.VARVE_HEAVY_LEASE_OWNER);const record=JSON.parse(fs.readFileSync(token.primary));if(record.leaseId!==token.leaseId||record.pid!==token.pid)process.exit(8);console.log('inherited:'+record.leaseId);process.exit(7);`;
  const nested = spawnSync(
    process.execPath,
    [script, 'outer', '--', process.execPath, script, 'inner', '--', process.execPath, '-e', inner],
    {
      env,
      encoding: 'utf8',
      // Windows authenticates inherited ownership with a bounded PowerShell
      // process-tree query. Leave room for that probe, nested Node startup, and
      // the inner 4s lease deadline so a real rejection surfaces its diagnostic
      // instead of this outer spawnSync killing the test at 6s.
      timeout: 15_000,
    },
  );
  assert.equal(nested.error, undefined);
  assert.equal(nested.status, 7, nested.stderr);
  assert.match(nested.stdout, /inherited:/);
  assert.doesNotMatch(nested.stdout, /waiting for/);
  assert.deepEqual(readdirSync(join(directory, 'varve-leases')), []);

  // Matching readable metadata is insufficient for an unrelated sibling to
  // inherit. Its command remains blocked and it never removes the owner.
  const ready = join(directory, 'sibling-ready'),
    finish = join(directory, 'sibling-finish');
  const owner = launch([
    script,
    'sibling-owner',
    '--',
    process.execPath,
    '-e',
    ownerCommand(ready, finish),
  ]);
  try {
    await waitFor(() => existsSync(ready));
    const keys = leasePaths({ runtimeDirectory: directory });
    const original = readFileSync(keys.primary, 'utf8');
    const marker = join(directory, 'forged-child');
    const rejected = spawnSync(
      process.execPath,
      [
        script,
        'unrelated',
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)},'launched')`,
      ],
      {
        env: { ...env, VARVE_HEAVY_LEASE_OWNER: original, VARVE_LEASE_TIMEOUT: '100' },
        encoding: 'utf8',
        // Windows performs a bounded PowerShell ancestry query (up to 3s)
        // before the fixture reaches its deliberately short lease deadline.
        timeout: 10_000,
      },
    );
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.equal(existsSync(marker), false);
    assert.equal(readFileSync(keys.primary, 'utf8'), original);
  } finally {
    writeFileSync(finish, 'release');
    assert.equal((await owner.exit).code, 0, owner.output());
  }

  // Real main and detached worktrees resolve to one full canonical key and
  // serialize their children, despite Git printing .git versus an absolute path.
  const repo = join(directory, 'repo'),
    tree = join(directory, 'tree');
  const git = (args) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  execFileSync('git', ['init', '-q', '-b', 'master', repo]);
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'fixture',
  ]);
  git(['worktree', 'add', '--detach', '--quiet', tree, 'HEAD']);
  const mainKeys = leasePaths({ cwd: repo, runtimeDirectory: directory });
  const treeKeys = leasePaths({ cwd: tree, runtimeDirectory: directory });
  assert.equal(mainKeys.primary, treeKeys.primary);
  assert.match(mainKeys.primary, /[/\\][0-9a-f]{64}\.lock$/);
  assert.deepEqual(mainKeys.paths, treeKeys.paths);
  const mainReady = join(directory, 'main-ready'),
    mainFinish = join(directory, 'main-finish');
  const treeReady = join(directory, 'tree-ready');
  const main = launch(
    [script, 'main', '--', process.execPath, '-e', ownerCommand(mainReady, mainFinish)],
    { cwd: repo },
  );
  let worktree;
  try {
    await waitFor(() => existsSync(mainReady));
    worktree = launch(
      [
        script,
        'worktree',
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(treeReady)},'launched')`,
      ],
      { cwd: tree },
    );
    await waitFor(() => worktree.output().includes('waiting for main'));
    assert.equal(existsSync(treeReady), false);
    writeFileSync(mainFinish, 'release');
    assert.equal((await main.exit).code, 0, main.output());
    assert.equal((await worktree.exit).code, 0, worktree.output());
    assert.equal(existsSync(treeReady), true);
  } finally {
    writeFileSync(mainFinish, 'release');
    main.child.kill('SIGTERM');
    worktree?.child.kill('SIGTERM');
    await Promise.all([main.exit, worktree?.exit]);
    git(['worktree', 'remove', '--force', tree]);
  }

  // An old client uses only the old alias and its old acquisition mutex.
  // Launch it *after* canonical admission: a check-only migration lets this
  // client run concurrently; the held compatibility alias must block it.
  const legacy = leasePaths({ runtimeDirectory: directory }).paths.find((path) =>
    /[/\\]2e676974\.lock$/.test(path),
  );
  assert.ok(legacy);
  const raceReady = join(directory, 'race-ready'),
    raceFinish = join(directory, 'race-finish');
  const legacyReady = join(directory, 'legacy-ready');
  const canonical = launch([
    script,
    'canonical',
    '--',
    process.execPath,
    '-e',
    ownerCommand(raceReady, raceFinish),
  ]);
  let old;
  try {
    await waitFor(() => existsSync(raceReady));
    const oldSource = `const fs=require('node:fs');const path=${JSON.stringify(legacy)};const mutex=path+'.acquire';const alive=p=>{try{process.kill(p,0);return true}catch{return false}};const poll=()=>{let acquired=false;try{fs.writeFileSync(mutex,JSON.stringify({pid:process.pid}),{flag:'wx'});acquired=true;let previous=fs.existsSync(path)?JSON.parse(fs.readFileSync(path)):null;if(previous&&(alive(previous.pid)||(previous.cleanupRemaining??[]).some(p=>alive(p.pid)))){console.log('old-client-waiting');return setTimeout(poll,10)}if(previous)fs.unlinkSync(path);fs.writeFileSync(path,JSON.stringify({pid:process.pid,leaseId:'old-fixture'}),{flag:'wx'});fs.writeFileSync(${JSON.stringify(legacyReady)},'launched');fs.unlinkSync(path)}catch(error){if(error.code!=='EEXIST')throw error;setTimeout(poll,10)}finally{if(acquired)fs.unlinkSync(mutex)}};poll();`;
    old = launch(['-e', oldSource]);
    await waitFor(() => old.output().includes('old-client-waiting'));
    assert.equal(existsSync(legacyReady), false);
    const record = JSON.parse(readFileSync(legacy, 'utf8'));
    assert.equal(record.pid, canonical.child.pid);
    writeFileSync(raceFinish, 'release');
    assert.equal((await canonical.exit).code, 0, canonical.output());
    assert.equal((await old.exit).code, 0, old.output());
    assert.equal(existsSync(legacyReady), true);
  } finally {
    writeFileSync(raceFinish, 'release');
    canonical.child.kill('SIGTERM');
    old?.child.kill('SIGTERM');
    await Promise.all([canonical.exit, old?.exit]);
  }
  assert.deepEqual(readdirSync(join(directory, 'varve-leases')), []);
  console.log('canonical worktree keys, authenticated nesting and legacy admission bridge passed');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
