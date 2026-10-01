import { createServer } from 'node:net';
import { isAbsolute, relative } from 'node:path';

function isWithin(parent, target) {
  const path = relative(parent, target);
  const separator = process.platform === 'win32' ? '\\' : '/';
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${separator}`));
}

export function assertReviewDirectorySafe(reviewDir, protectedDirs) {
  if (protectedDirs.some((protectedDir) => isWithin(protectedDir, reviewDir))) {
    throw new Error(
      '--review-dir must be outside the canonical and published screenshot directories',
    );
  }
}

export function sourceSceneProvenance(previous, sourceHash) {
  const unchanged = previous.sha256 === sourceHash;
  return {
    capturedAt: unchanged ? previous.capturedAt : undefined,
    lastValidatedAgainst: unchanged ? previous.lastValidatedAgainst : null,
    provenanceUnknown: unchanged ? previous.provenanceUnknown : true,
  };
}

export function assertPortAvailable(port) {
  return (async () => {
    for (const host of ['127.0.0.1', '::1']) {
      await new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', (error) => {
          if (error.code === 'EADDRINUSE') {
            reject(
              new Error(
                `Screenshot capture port ${port} is already occupied on ${host}; choose VARVE_SHOT_PORT.`,
              ),
            );
          } else if (
            host === '::1' &&
            ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL', 'EPROTONOSUPPORT'].includes(error.code)
          ) {
            resolve();
          } else {
            reject(error);
          }
        });
        server.listen(port, host, () =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      });
    }
  })();
}
