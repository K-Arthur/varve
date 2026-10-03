/** Real parallel contenders reproduce free/stale lease acquisition races. */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leasePaths } from './heavy-lease.mjs';

const script =
  process.env.VARVE_TEST_LEASE_SCRIPT ??
  fileURLToPath(new URL('./heavy-lease.mjs', import.meta.url));
const gitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
const lockName = process.env.VARVE_TEST_LEASE_SCRIPT
  ? `${Buffer.from(gitDir).toString('hex').slice(0, 32)}.lock`
  : leasePaths().primary.split(/[/\\]/).at(-1);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate() && Date.now() < deadline) await delay(5);
  assert.ok(predicate(), 'parallel lease fixture did not reach its scheduling barrier');
}

for (const stale of process.env.VARVE_TEST_LEASE_CASE === 'stale' ? [true] : [false, true]) {
  const directory = mkdtempSync(join(tmpdir(), 'varve-lease-atomic-'));
  const owners = [];
  const finish = join(directory, 'finish');
  let sentinel;
  try {
    const leaseDirectory = join(directory, 'varve-leases');
    mkdirSync(leaseDirectory);
    if (stale) {
      const stopped = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], {
        encoding: 'utf8',
      });
      writeFileSync(
        join(leaseDirectory, lockName),
        JSON.stringify({
          pid: Number(stopped.stdout.trim()),
          leaseId: 'dead-fixture',
          label: 'dead-owner',
          startedAt: 0,
        }),
      );
    }
    const preload = join(directory, 'admission.mjs');
    // Scheduling-only instrumentation: current CLI transactions serialize
    // the reads/writes; the old unsynchronized CLI has both stale/absent reads
    // complete before either writes. No fs result or identity is fabricated.
    writeFileSync(
      preload,
      `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const original={read:fs.readFileSync,write:fs.writeFileSync,unlink:fs.unlinkSync,mkdir:fs.mkdirSync};const directory=${JSON.stringify(directory)};let admitted=false,read=false,wrote=false;
const wait=(predicate)=>{const deadline=Date.now()+3000;while(!predicate()){if(Date.now()>deadline)throw Error('admission barrier timed out');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5)}};
const count=(prefix)=>fs.readdirSync(directory).filter(p=>p.startsWith(prefix)).length;
globalThis.setTimeout=((actual)=>(callback,ms,...args)=>actual(callback,ms>1000&&ms<=5000?20:ms,...args))(globalThis.setTimeout);
fs.mkdirSync=function(path,...args){const result=original.mkdir.call(this,path,...args);if(!admitted&&String(path).endsWith('varve-leases')){admitted=true;original.write(directory+'/admitted-'+process.pid,'ready');wait(()=>count('admitted-')===2)}return result};
fs.readFileSync=function(path,...args){let result,error;try{result=original.read.call(this,path,...args)}catch(e){error=e}if(!read&&!wrote&&String(path).endsWith('.lock')&&!fs.existsSync(String(path)+'.acquire')){read=true;original.write(directory+'/read-'+process.pid,'ready');wait(()=>count('read-')===2)}if(error)throw error;return result};
fs.unlinkSync=function(path,...args){if(${stale}&&String(path).endsWith('.lock')&&!fs.existsSync(String(path)+'.acquire')&&count('attempt-')===0){try{original.write(directory+'/first-unlink','claimed',{flag:'wx'})}catch{wait(()=>count('attempt-')>0)}}return original.unlink.call(this,path,...args)};
fs.writeFileSync=function(path,...args){const result=original.write.call(this,path,...args);if(!wrote&&String(path).endsWith('.lock')){wrote=true;original.write(directory+'/attempt-'+process.pid,'acquired');if(!fs.existsSync(String(path)+'.acquire'))wait(()=>count('attempt-')===2)}return result};syncBuiltinESMExports();
`,
    );
    const events = join(directory, 'events.jsonl');
    const critical = join(directory, 'critical');
    const ready = join(directory, 'critical-ready');
    const source = `const fs=require('node:fs');try{fs.writeFileSync(${JSON.stringify(critical)},String(process.pid),{flag:'wx'})}catch{process.exit(9)}fs.writeFileSync(${JSON.stringify(directory)}+'/child-'+process.pid,String(process.pid));fs.appendFileSync(${JSON.stringify(events)},'start\\n');fs.writeFileSync(${JSON.stringify(ready)},'ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(finish)})){fs.appendFileSync(${JSON.stringify(events)},'end\\n');fs.unlinkSync(${JSON.stringify(critical)});clearInterval(timer)}},5);`;
    sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    for (let index = 0; index < 2; index++) {
      const owner = spawn(
        process.execPath,
        ['--import', preload, script, `parallel-${index}`, '--', process.execPath, '-e', source],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            XDG_RUNTIME_DIR: directory,
            VARVE_LEASE_MIN_MEM_MB: '0',
            VARVE_LEASE_TIMEOUT: '5000',
          },
        },
      );
      let output = '';
      owner.stdout.setEncoding('utf8').on('data', (chunk) => {
        output += chunk;
      });
      owner.stderr.setEncoding('utf8').on('data', (chunk) => {
        output += chunk;
      });
      owners.push({
        output: () => output,
        child: owner,
        exit: new Promise((resolve) =>
          owner.once('exit', (code, signal) => resolve({ code, signal })),
        ),
      });
    }
    await waitFor(() => existsSync(ready));
    assert.equal(
      readdirSync(directory).filter((p) => p.startsWith('attempt-')).length,
      1,
      'only one live owner may acquire a free or reclaimed lease',
    );
    writeFileSync(finish, 'release');
    const results = await Promise.all(owners.map((owner) => owner.exit));
    assert.deepEqual(
      results.map((result) => result.code),
      [0, 0],
      owners.map((owner) => owner.output()).join('\n'),
    );
    assert.equal(
      readFileSync(events, 'utf8'),
      'start\nend\nstart\nend\n',
      'critical sections must never overlap',
    );
    assert.doesNotThrow(() => process.kill(sentinel.pid, 0), 'unrelated sentinel remains alive');
    console.log(`atomic lease acquisition: ${stale ? 'stale' : 'free'} contenders serialized`);
  } finally {
    writeFileSync(finish, 'release');
    for (const owner of owners) owner.child.kill('SIGTERM');
    await Promise.all(owners.map((owner) => owner.exit));
    for (const name of readdirSync(directory).filter((p) => p.startsWith('child-'))) {
      try {
        process.kill(Number(readFileSync(join(directory, name), 'utf8')), 'SIGKILL');
      } catch {}
    }
    sentinel?.kill('SIGKILL');
    rmSync(directory, { recursive: true, force: true });
  }
}

// Malformed lease metadata is neither deleted nor spun on; an incomplete
// transaction mutex polls to its bounded deadline without unsafe reclamation.
if (!process.env.VARVE_TEST_LEASE_SCRIPT) {
  for (const mutex of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), 'varve-lease-corrupt-'));
    const leaseDirectory = join(directory, 'varve-leases');
    mkdirSync(leaseDirectory);
    const path = join(leaseDirectory, lockName + (mutex ? '.acquire' : ''));
    writeFileSync(path, '{');
    try {
      const result = spawnSync(process.execPath, [script, 'corrupt-metadata'], {
        encoding: 'utf8',
        timeout: 2000,
        env: { ...process.env, XDG_RUNTIME_DIR: directory, VARVE_LEASE_TIMEOUT: '80' },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.match(
        `${result.stdout}${result.stderr}`,
        mutex ? /incomplete acquisition metadata|deadline reached/ : /invalid lease metadata/,
      );
      assert.equal(
        readFileSync(path, 'utf8'),
        '{',
        'unknown ownership metadata must not be deleted',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  const directory = mkdtempSync(join(tmpdir(), 'varve-lease-unknown-cleanup-'));
  const leaseDirectory = join(directory, 'varve-leases');
  mkdirSync(leaseDirectory);
  const path = join(leaseDirectory, lockName);
  const metadata = JSON.stringify({ pid: 2147483647, leaseId: 'unverified', cleanupUnknown: true });
  writeFileSync(path, metadata);
  try {
    const result = spawnSync(process.execPath, [script, 'unverified-cleanup'], {
      encoding: 'utf8',
      timeout: 2000,
      env: { ...process.env, XDG_RUNTIME_DIR: directory, VARVE_LEASE_TIMEOUT: '80' },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cleanup is unverified; refusing to reclaim/);
    assert.equal(readFileSync(path, 'utf8'), metadata);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
