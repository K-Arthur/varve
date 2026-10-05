#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { fetchGitHubWithRetry } from './github-fetch.mjs';
import {
  parsePublicationArgs,
  publicationOutputs,
  verifyWebsitePublication,
} from './verify-website-publication.mjs';

const options = {
  repository: 'K-Arthur/varve',
  tag: 'v0.5.0',
  commitSha: 'a'.repeat(40),
};

function httpResponse(status, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers) };
}

test('GitHub GET retries a transient server error and succeeds with bounded backoff', async () => {
  const responses = [httpResponse(500), httpResponse(200)];
  const delays = [];
  let calls = 0;
  const result = await fetchGitHubWithRetry('https://api.github.com/repos/example/project', {
    fetchImpl: async () => {
      calls++;
      return responses.shift();
    },
    sleep: async (delayMs) => delays.push(delayMs),
    onRetry: () => {},
    baseDelayMs: 5,
  });

  assert.equal(result.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [5]);
});

test('GitHub GET stops after four server-error attempts and preserves the final response', async () => {
  const delays = [];
  let calls = 0;
  const result = await fetchGitHubWithRetry('https://api.github.com/repos/example/project', {
    fetchImpl: async () => {
      calls++;
      return httpResponse(503);
    },
    sleep: async (delayMs) => delays.push(delayMs),
    onRetry: () => {},
    baseDelayMs: 5,
    maxDelayMs: 100,
  });

  assert.equal(result.status, 503);
  assert.equal(calls, 4);
  assert.deepEqual(delays, [5, 10, 20]);
});

test('GitHub GET returns client errors without retrying or hiding rate limits', async () => {
  for (const status of [401, 403, 404, 429]) {
    let calls = 0;
    const result = await fetchGitHubWithRetry('https://api.github.com/repos/example/project', {
      fetchImpl: async () => {
        calls++;
        return httpResponse(status);
      },
      sleep: async () => assert.fail('client errors must not be retried'),
      onRetry: () => assert.fail('client errors must not be retried'),
    });
    assert.equal(result.status, status);
    assert.equal(calls, 1);
  }
});

test('GitHub GET honors a short Retry-After on a transient server response', async () => {
  const responses = [httpResponse(503, { 'retry-after': '2' }), httpResponse(200)];
  const delays = [];
  const result = await fetchGitHubWithRetry('https://api.github.com/repos/example/project', {
    fetchImpl: async () => responses.shift(),
    sleep: async (delayMs) => delays.push(delayMs),
    onRetry: () => {},
    maxRetryAfterMs: 5_000,
  });

  assert.equal(result.status, 200);
  assert.deepEqual(delays, [2_000]);
});

test('GitHub GET refuses to retry before an excessive Retry-After interval', async () => {
  let calls = 0;
  await assert.rejects(
    fetchGitHubWithRetry('https://api.github.com/repos/example/project', {
      fetchImpl: async () => {
        calls++;
        return httpResponse(503, { 'retry-after': '60' });
      },
      sleep: async () => assert.fail('must not retry before the server requested'),
      onRetry: () => assert.fail('must not retry before the server requested'),
      maxRetryAfterMs: 100,
    }),
    /refusing an early retry/,
  );
  assert.equal(calls, 1);
});

test('GitHub GET retries network errors and redacts signed URL details on exhaustion', async () => {
  const delays = [];
  let calls = 0;
  await assert.rejects(
    fetchGitHubWithRetry('https://assets.example.test/feed.json?token=secret#fragment', {
      fetchImpl: async () => {
        calls++;
        throw new TypeError('network unavailable');
      },
      sleep: async (delayMs) => delays.push(delayMs),
      onRetry: () => {},
      maxAttempts: 3,
      baseDelayMs: 5,
    }),
    (error) => {
      assert.match(error.message, /failed after 3 attempts/);
      assert.doesNotMatch(error.message, /secret|fragment/);
      return true;
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [5, 10]);
});

function githubFixture({ release = {}, sha = options.commitSha } = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    assert.equal(command, 'gh');
    assert.equal(args[0], 'api');
    assert.equal(args.length, 2); // GET only: no publication or dispatch mutations.
    if (args[1] === `repos/${options.repository}/releases/tags/${options.tag}`)
      return JSON.stringify({
        id: 77,
        tag_name: options.tag,
        draft: false,
        published_at: '2026-10-02T00:00:00Z',
        ...release,
      });
    assert.equal(args[1], `repos/${options.repository}/commits/${options.tag}`);
    return JSON.stringify({ sha });
  };
  return { calls, run };
}

test('already-public release can be resolved repeatedly without republishing', () => {
  const fixture = githubFixture();
  const expected = { published: true, tag: options.tag, commitSha: options.commitSha };
  assert.deepEqual(verifyWebsitePublication(options, fixture.run), expected);
  assert.deepEqual(verifyWebsitePublication(options, fixture.run), expected);
  assert.equal(fixture.calls.length, 4);
  assert.equal(
    publicationOutputs(expected),
    `published=true\ntag=v0.5.0\npublished_sha=${options.commitSha}\n`,
  );
});

test('explicit recovery refuses drafts and withdrawn releases', () => {
  for (const release of [{ draft: true }, { published_at: null }]) {
    const fixture = githubFixture({ release });
    assert.throws(() => verifyWebsitePublication(options, fixture.run), /not published/);
    assert.equal(fixture.calls.length, 1);
  }
});

test('non-public tag-build fallback skips deployment instead of promoting its draft', () => {
  const fixture = githubFixture({ release: { draft: true, published_at: null } });
  const result = verifyWebsitePublication({ ...options, allowUnpublished: true }, fixture.run);
  assert.equal(result.published, false);
  assert.equal(publicationOutputs(result), 'published=false\n');
  assert.equal(fixture.calls.length, 1);
});

test('published tag must still resolve to the supplied frozen SHA', () => {
  const fixture = githubFixture({ sha: 'b'.repeat(40) });
  assert.throws(() => verifyWebsitePublication(options, fixture.run), /exact source SHA/);
  assert.equal(fixture.calls.length, 2);
});

test('malformed published identities and timestamps fail before source lookup', () => {
  for (const release of [
    { id: 0 },
    { id: '77' },
    { tag_name: 'v0.2.1' },
    { draft: 'false' },
    { published_at: 'invalid date' },
  ]) {
    const fixture = githubFixture({ release });
    assert.throws(() => verifyWebsitePublication(options, fixture.run));
    assert.equal(fixture.calls.length, 1);
  }
});

test('explicit recovery requires both safe tag and full source SHA before any API call', () => {
  for (const invalid of [
    { tag: '' },
    { tag: 'master' },
    { tag: 'v0.5.0\npublished_sha=injected' },
    { commitSha: '' },
    { commitSha: 'a'.repeat(39) },
    { repository: '../varve' },
    { allowUnpublished: 'false' },
  ]) {
    let called = false;
    assert.throws(() =>
      verifyWebsitePublication({ ...options, ...invalid }, () => {
        called = true;
      }),
    );
    assert.equal(called, false);
  }
});

test('a non-release workflow fallback cannot select the default branch for deployment', () => {
  const result = verifyWebsitePublication(
    { ...options, tag: 'master', allowUnpublished: true },
    () => assert.fail('non-release events must not contact GitHub'),
  );
  assert.equal(result.published, false);
});

test('GitHub lookup and malformed JSON failures do not become successful deploy outputs', () => {
  assert.throws(
    () =>
      verifyWebsitePublication(options, () => {
        throw new Error('API unavailable');
      }),
    /API unavailable/,
  );
  assert.throws(() => verifyWebsitePublication(options, () => 'not JSON'), SyntaxError);
});

test('CLI strictly rejects missing, duplicate, unknown and non-boolean options', () => {
  const invalid = [
    ['--tag'],
    ['--tag', '--sha'],
    ['--sha', options.commitSha, '--sha', options.commitSha],
    ['--unknown', 'value'],
    ['tag', options.tag],
    ['--allow-unpublished', 'TRUE'],
  ];
  for (const args of invalid) assert.throws(() => parsePublicationArgs(args));
  assert.deepEqual(
    parsePublicationArgs([
      '--repo',
      options.repository,
      '--tag',
      options.tag,
      '--sha',
      options.commitSha,
      '--allow-unpublished',
      'false',
    ]),
    { ...options, allowUnpublished: false },
  );
});

test('real CLI returns nonzero for an incomplete recovery before looking up a release', () => {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/release/verify-website-publication.mjs',
      '--repo',
      options.repository,
      '--tag',
      options.tag,
    ],
    { encoding: 'utf8', env: { ...process.env, PATH: '' } },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /40-character release source SHA/);
  assert.equal(result.stdout, '');
});

const workflow = load(readFileSync('.github/workflows/website-deploy.yml', 'utf8'));

function selected(condition, eventName, { inputs = {}, event = {}, needs = {}, status = {} } = {}) {
  // GitHub adds success() unless the condition contains an explicit status function.
  // A missing job if therefore still rejects deliberately skipped ancestry.
  const raw = condition ?? 'success()';
  const explicitStatus = /\b(?:always|cancelled|success|failure)\s*\(/.test(raw);
  const expression = (explicitStatus ? raw : `success() && (${raw})`)
    .replaceAll('needs.release-data.', 'needs.releaseData.')
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '');
  const evaluate = new Function(
    'github',
    'inputs',
    'needs',
    'always',
    'cancelled',
    'success',
    'failure',
    `return (${expression});`,
  );
  return evaluate(
    { event_name: eventName, event },
    { release_tag: '', release_sha: '', ...inputs },
    { releaseData: { result: 'skipped', outputs: { published: '' } }, ...needs },
    () => true,
    () => status.cancelled ?? false,
    () => status.success ?? true,
    () => status.failure ?? false,
  );
}

test('manual release recovery selects publication validation and skips source browser gates', () => {
  for (const inputs of [
    { release_tag: options.tag, release_sha: options.commitSha },
    { release_tag: options.tag },
    { release_sha: options.commitSha },
  ]) {
    assert.equal(selected(workflow.jobs.test.if, 'workflow_dispatch', { inputs }), false);
    assert.equal(selected(workflow.jobs['release-data'].if, 'workflow_dispatch', { inputs }), true);
  }
});

test('ordinary source pushes and empty manual dispatches retain website source certification', () => {
  for (const eventName of ['push', 'workflow_dispatch']) {
    assert.equal(selected(workflow.jobs.test.if, eventName), true);
    assert.equal(selected(workflow.jobs['release-data'].if, eventName), false);
    assert.equal(
      selected(workflow.jobs.build.if, eventName, { needs: { test: { result: 'success' } } }),
      true,
    );
  }
});

test('publication events retain strict validation while draft-producing manual runs do not duplicate it', () => {
  for (const [eventName, event] of [
    ['repository_dispatch', {}],
    ['workflow_run', { workflow_run: { conclusion: 'success', event: 'push' } }],
  ]) {
    assert.equal(selected(workflow.jobs.test.if, eventName, { event }), false);
    assert.equal(selected(workflow.jobs['release-data'].if, eventName, { event }), true);
  }
  assert.equal(
    selected(workflow.jobs['release-data'].if, 'workflow_run', {
      event: { workflow_run: { conclusion: 'success', event: 'workflow_dispatch' } },
    }),
    false,
  );
});

test('failed publication validation and draft fallback cannot take the source build path', () => {
  for (const releaseData of [
    { result: 'failure', outputs: {} },
    { result: 'success', outputs: { published: 'false' } },
  ]) {
    for (const sourceResult of ['skipped', 'success'])
      assert.equal(
        selected(workflow.jobs.build.if, 'workflow_dispatch', {
          needs: { releaseData, test: { result: sourceResult } },
        }),
        false,
      );
  }
});

test('verified recovery builds from publication SHA and pins that release data', () => {
  assert.equal(
    selected(workflow.jobs.build.if, 'workflow_dispatch', {
      needs: {
        releaseData: { result: 'success', outputs: { published: 'true' } },
        test: { result: 'skipped' },
      },
    }),
    true,
  );
  assert.match(
    workflow.jobs.build.steps[0].with.ref,
    /needs\.release-data\.outputs\.published_sha/,
  );
  const fetch = workflow.jobs.build.steps.find(
    (step) => step.name === 'Fetch release data from GitHub',
  );
  assert.match(fetch.env.RELEASE_TAG, /needs\.release-data\.outputs\.tag/);
  assert.match(fetch.run, /fetch-website-release\.mjs --tag "\$\{RELEASE_TAG\}"/);
  const validation = workflow.jobs['release-data'].steps.find(
    (step) => step.id === 'release-state',
  );
  assert.match(validation.run, /verify-website-publication\.mjs/);
  assert.match(validation.env.ALLOW_UNPUBLISHED, /github\.event_name == 'workflow_run'/);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
});

test('successful website builds deploy despite deliberately skipped source or publication ancestry', () => {
  assert.equal(workflow.jobs.deploy.needs, 'build');
  const cases = [
    { eventName: 'push', needs: { test: { result: 'success' } } },
    {
      eventName: 'repository_dispatch',
      needs: {
        test: { result: 'skipped' },
        releaseData: { result: 'success', outputs: { published: 'true' } },
      },
    },
    {
      eventName: 'workflow_dispatch',
      inputs: { release_tag: options.tag, release_sha: options.commitSha },
      needs: {
        test: { result: 'skipped' },
        releaseData: { result: 'success', outputs: { published: 'true' } },
      },
    },
  ];
  for (const scenario of cases) {
    const context = { ...scenario, status: { success: false, cancelled: false } };
    assert.equal(
      selected(workflow.jobs.build.if, scenario.eventName, context),
      true,
      `${scenario.eventName}: the intended quality/publication gate permits the build`,
    );
    assert.equal(
      selected(workflow.jobs.deploy.if, scenario.eventName, {
        ...context,
        needs: { ...scenario.needs, build: { result: 'success' } },
      }),
      true,
      `${scenario.eventName}: a skipped ancestor must not suppress deployment`,
    );
  }
});

test('website deployment refuses failed, skipped or cancelled builds and cancelled workflows', () => {
  for (const result of ['failure', 'skipped', 'cancelled']) {
    assert.equal(
      selected(workflow.jobs.deploy.if, 'push', {
        needs: { build: { result } },
        status: { success: false, cancelled: false },
      }),
      false,
      `build ${result} must not deploy`,
    );
  }
  assert.equal(
    selected(workflow.jobs.deploy.if, 'push', {
      needs: { build: { result: 'success' } },
      status: { success: true, cancelled: true },
    }),
    false,
    'a workflow cancelled after its build must not publish',
  );
});
