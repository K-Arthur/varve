import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const release = JSON.parse(
  fs.readFileSync(new URL('../data/release-manifest.json', import.meta.url), 'utf8'),
);
const llms = fs.readFileSync(new URL('../../public/llms.txt', import.meta.url), 'utf8');

describe('public LLM release facts', () => {
  it('matches the committed verified release snapshot', () => {
    expect(release.hasRelease).toBe(true);
    expect(llms).toContain(
      `latest **published** application release is **Varve ${release.version}**`,
    );
    expect(llms).toContain(`published ${release.releaseDate}`);
    expect(llms).toContain(`Can I download version ${release.version}? Yes.`);
    expect(llms).not.toMatch(
      /is prepared and in release-candidate validation but is \*\*not published yet\*\*/i,
    );
    expect(llms).not.toMatch(/Can I download version [^?]+\? Not yet\./i);
  });
});
