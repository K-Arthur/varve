import type { ExportBatch, ExportJob } from '@strata/scene';
import {
  formatFileName,
  legacyFormatToCanonical,
  legacyScaleToCanonical,
  resolveCollisions,
} from '@strata/scene/export';

/**
 * Resolve the filename template, organization rule, and collisions once for
 * both destination preview and execution. ExportJob.fileName intentionally
 * carries the safe relative output path after this transform.
 */
export function applyExportBatchPaths(
  jobs: ExportJob[],
  template: string,
  folderRule: ExportBatch['folderRule'],
): ExportJob[] {
  const keyedJobs = jobs.map((job, index) => {
    const format = legacyFormatToCanonical(job.format);
    const context = {
      name: job.nodeName,
      format,
      scale: job.scale
        ? legacyScaleToCanonical(job.scale)
        : { mode: 'multiplier' as const, value: 1 },
      suffix: job.suffix,
      index: index + 1,
      width: job.dimensions.w,
      height: job.dimensions.h,
    };
    const fileName = formatFileName(template, context);
    const folder =
      folderRule === 'by-node'
        ? formatFileName('{name}', context)
        : folderRule === 'by-preset'
          ? formatFileName('{format}', context)
          : '';
    const relativePath = folder ? `${folder}/${fileName}` : fileName;
    return { job, key: `${job.nodeId}-${job.presetId}-${index}`, relativePath };
  });

  const resolved = resolveCollisions(
    keyedJobs.map(({ key, relativePath }) => ({
      configurationId: key,
      fileName: relativePath.split('/').pop() ?? relativePath,
      relativePath,
    })),
    'rename',
  );
  const pathByKey = new Map(
    resolved.outputs.map((output) => [output.configurationId, output.relativePath]),
  );

  return keyedJobs.map(({ job, key }) => ({
    ...job,
    fileName: pathByKey.get(key) ?? job.fileName,
  }));
}
