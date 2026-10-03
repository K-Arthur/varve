import { createHash } from 'node:crypto';
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

export function sourceSceneProvenance(previous, sourceHash, freshCapture) {
  const unchanged = previous.sha256 === sourceHash;
  if (freshCapture) {
    return { ...freshCapture, provenanceUnknown: false };
  }
  return {
    capturedAt: unchanged ? previous.capturedAt : freshCapture?.capturedAt,
    lastValidatedAgainst: unchanged
      ? previous.lastValidatedAgainst
      : (freshCapture?.lastValidatedAgainst ?? null),
    provenanceUnknown: unchanged ? previous.provenanceUnknown : !freshCapture,
    ...(unchanged && previous.provenance
      ? { provenance: previous.provenance }
      : freshCapture?.provenance
        ? { provenance: freshCapture.provenance }
        : !unchanged && previous.provenance
          ? { provenance: undefined }
          : {}),
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

/** A promotion assembles reviewed pixels; it does not perform a new capture. */
export function reviewedAssemblyMetadata({
  scenes,
  sourceIdentity,
  assembledAt,
  reviewSha256,
  reviewedAgainst,
  promotedSceneIDs,
}) {
  if (
    !/^[a-f0-9]{40}$/.test(sourceIdentity?.sourceRevision ?? '') ||
    !/^[a-f0-9]{64}$/.test(sourceIdentity?.sourceDigest ?? '') ||
    typeof sourceIdentity?.sourceDirty !== 'boolean'
  ) {
    throw new Error('Reviewed assembly requires the actual promotion source identity');
  }
  const captured = Object.values(scenes).filter((scene) => scene.status === 'captured');
  return {
    note: 'GENERATED FILE — reviewed mixed-source assembly; no new capture. Top-level identity records the assembly revision and input digest. Per-scene producer provenance remains authoritative for the pixels.',
    sourceRevision: sourceIdentity.sourceRevision,
    sourceDigest: sourceIdentity.sourceDigest,
    captureTool: 'reviewed assembly; original capture and browser versions are recorded per scene',
    provenance: {
      kind: 'reviewed-mixed-source-assembly',
      runtime: 'metadata-only reviewed assembly; no new capture',
      assemblyRevision: sourceIdentity.sourceRevision,
      assemblySourceDigest: sourceIdentity.sourceDigest,
      assemblySourceDirty: sourceIdentity.sourceDirty,
      assembledAt,
      reviewManifestSha256: reviewSha256,
      reviewedAgainst,
      promotedSceneIDs: [...promotedSceneIDs],
      capturedSourceRevisions: [
        ...new Set(captured.map((scene) => scene.provenance?.sourceRevision).filter(Boolean)),
      ].sort(),
      captureTools: [
        ...new Set(captured.map((scene) => scene.provenance?.captureTool).filter(Boolean)),
      ].sort(),
      provenanceUnknownSceneIDs: Object.entries(scenes)
        .filter(
          ([, scene]) =>
            scene.status === 'captured' &&
            (scene.provenanceUnknown !== false || !scene.provenance?.sourceRevision),
        )
        .map(([id]) => id),
      sceneIdentitySha256: createHash('sha256')
        .update(
          JSON.stringify(
            Object.entries(scenes)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([id, scene]) => ({
                id,
                file: scene.file,
                sha256: scene.sha256,
                capturedAt: scene.capturedAt,
                provenanceUnknown: scene.provenanceUnknown,
                provenance: scene.provenance,
              })),
          ),
        )
        .digest('hex'),
    },
  };
}
