import { afterEach, describe, expect, it } from 'vitest';
import { varveGitHubRepo, varveHostedReleaseUrl } from './hostedReleaseUrl';

const originalGithub = process.env.GITHUB_REPOSITORY;
const originalOverride = process.env.VARVE_GITHUB_REPOSITORY;

afterEach(() => {
  if (originalGithub === undefined) delete process.env.GITHUB_REPOSITORY;
  else process.env.GITHUB_REPOSITORY = originalGithub;
  if (originalOverride === undefined) delete process.env.VARVE_GITHUB_REPOSITORY;
  else process.env.VARVE_GITHUB_REPOSITORY = originalOverride;
});

describe('varveHostedReleaseUrl', () => {
  it('defaults to the published model-release owner so existing assets keep resolving', () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.VARVE_GITHUB_REPOSITORY;
    expect(varveGitHubRepo()).toBe('K-Arthur/varve');
    expect(varveHostedReleaseUrl('models-v1', 'ddcolor.onnx')).toBe(
      'https://github.com/K-Arthur/varve/releases/download/models-v1/ddcolor.onnx',
    );
  });

  it('follows GITHUB_REPOSITORY so a transferred owner still builds download URLs', () => {
    delete process.env.VARVE_GITHUB_REPOSITORY;
    process.env.GITHUB_REPOSITORY = 'varvedesign/varve';
    expect(varveHostedReleaseUrl('varve-models-v1', 'realesrgan-anime-6b.onnx')).toBe(
      'https://github.com/varvedesign/varve/releases/download/varve-models-v1/realesrgan-anime-6b.onnx',
    );
  });

  it('prefers VARVE_GITHUB_REPOSITORY over GITHUB_REPOSITORY', () => {
    process.env.GITHUB_REPOSITORY = 'other/fork';
    process.env.VARVE_GITHUB_REPOSITORY = 'varvedesign/varve';
    expect(varveGitHubRepo()).toBe('varvedesign/varve');
  });

  it('ignores malformed repository slugs', () => {
    delete process.env.VARVE_GITHUB_REPOSITORY;
    process.env.GITHUB_REPOSITORY = 'not-a-slug';
    expect(varveGitHubRepo()).toBe('K-Arthur/varve');
  });
});
