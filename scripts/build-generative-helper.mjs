import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

execFileSync('cargo', ['build', '-p', 'varve-generative-helper', '--release', '--locked'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});
