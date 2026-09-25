import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const bindgenShim = path.join(
  repositoryRoot,
  'crates',
  'varve-generative-helper',
  'bindgen-stdio-shim.h',
);
const existingBindgenArgs = process.env.BINDGEN_EXTRA_CLANG_ARGS?.trim();
const linuxBindgenArgs =
  process.platform === 'linux' ? ['-D_STDIO_H', `-include${bindgenShim}`] : [];

execFileSync('cargo', ['build', '-p', 'varve-generative-helper', '--release'], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    BINDGEN_EXTRA_CLANG_ARGS: [existingBindgenArgs, ...linuxBindgenArgs].filter(Boolean).join(' '),
  },
  stdio: 'inherit',
});
