#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
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

function selected(condition, eventName, { inputs = {}, event = {}, needs = {} } = {}) {
  const expression = condition.replaceAll('needs.release-data.', 'needs.releaseData.');
  const evaluate = new Function('github', 'inputs', 'needs', 'always', `return (${expression});`);
  return evaluate(
    { event_name: eventName, event },
    { release_tag: '', release_sha: '', ...inputs },
    { releaseData: { result: 'skipped', outputs: { published: '' } }, ...needs },
    () => true,
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
