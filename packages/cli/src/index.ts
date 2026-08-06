/**
 * @varve/cli — headless Varve tooling (M13, M14).
 */

export {
  type CliError,
  formatDiff,
  gitSetupInstructions,
  type LoadedDocument,
  type MergeDriverResult,
  main,
  type ParsedCommand,
  parseArgs,
  type ReviewBundleResult,
  runCanonicalize,
  runDiff,
  runMergeDriver,
  runReview,
  runValidate,
  type ValidateResult,
} from './cli';
export {
  buildReviewBundle,
  buildSummaryMarkdown,
  buildViewerHtml,
  type ReviewBundleFile,
} from './review';
