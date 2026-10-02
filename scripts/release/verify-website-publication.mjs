#!/usr/bin/env node
/** Resolve an already-published release for an exact-source website deployment. */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TAG = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
    });
  } catch (error) {
    const detail = String(error.stderr ?? '')
      .replace(/https?:\/\/\S+/g, '[redacted URL]')
      .trim();
    throw new Error(
      `Published release lookup failed (exit ${error.status ?? 'unknown'}): ${detail.slice(0, 1500)}`,
    );
  }
}

export function parsePublicationArgs(argv) {
  const allowed = new Set(['repo', 'tag', 'sha', 'allow-unpublished']);
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const key = flag?.startsWith('--') ? flag.slice(2) : '';
    const value = argv[index + 1];
    if (!allowed.has(key)) throw new Error(`Unknown publication option: ${flag}`);
    if (Object.hasOwn(args, key)) throw new Error(`Duplicate publication option: ${flag}`);
    if (value === undefined || value.startsWith('--'))
      throw new Error(`Missing value for publication option: ${flag}`);
    args[key] = value;
  }
  const allow = args['allow-unpublished'] ?? 'false';
  if (allow !== 'true' && allow !== 'false')
    throw new Error('--allow-unpublished must be true or false');
  return {
    repository: args.repo ?? process.env.GITHUB_REPOSITORY,
    tag: args.tag,
    commitSha: args.sha,
    allowUnpublished: allow === 'true',
  };
}

export function verifyWebsitePublication(options, run = runCommand) {
  const { repository, tag, commitSha, allowUnpublished = false } = options;
  if (
    !REPOSITORY.test(repository ?? '') ||
    repository.split('/').some((segment) => segment === '.' || segment === '..')
  )
    throw new Error('Invalid release repository');
  if (!SHA.test(commitSha ?? ''))
    throw new Error('An exact 40-character release source SHA is required');
  if (typeof allowUnpublished !== 'boolean') throw new Error('allowUnpublished must be a boolean');
  if (!TAG.test(tag ?? '')) {
    if (allowUnpublished) return { published: false, reason: 'Not a release-tag event' };
    throw new Error('A valid release tag is required for website recovery');
  }

  const release = JSON.parse(run('gh', ['api', `repos/${repository}/releases/tags/${tag}`]));
  if (release?.tag_name !== tag || !Number.isSafeInteger(release.id) || release.id <= 0)
    throw new Error('Published release identity does not match the requested tag');
  if (
    release.draft !== false ||
    typeof release.published_at !== 'string' ||
    !Number.isFinite(Date.parse(release.published_at))
  ) {
    if (allowUnpublished) return { published: false, reason: 'Release is not published' };
    throw new Error(`Release ${tag} is not published; website recovery cannot deploy a draft`);
  }
  const commit = JSON.parse(run('gh', ['api', `repos/${repository}/commits/${tag}`]));
  if (commit?.sha !== commitSha)
    throw new Error(`Published tag ${tag} does not match the requested exact source SHA`);
  return { published: true, tag, commitSha };
}

export function publicationOutputs(result) {
  return result.published
    ? `published=true\ntag=${result.tag}\npublished_sha=${result.commitSha}\n`
    : 'published=false\n';
}

function main() {
  const result = verifyWebsitePublication(parsePublicationArgs(process.argv.slice(2)));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, publicationOutputs(result));
  process.stdout.write(
    result.published
      ? `Published release ${result.tag} verified at ${result.commitSha}; website deployment may proceed.\n`
      : `${result.reason}; website deployment is not started.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Website publication verification FAILED: ${error.message}\n`);
    process.exitCode = 1;
  }
}
