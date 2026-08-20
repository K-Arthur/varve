/**
 * @varve/scene — document model, component slots, and variable store.
 *
 * The editor manipulates this model (task 0.9+); the engine renders a
 * flattened projection of it. Slots (1.1) and variable math (1.2) extend these
 * stable shapes.
 */

export * from './adjustmentScope';
export * from './adjustments';
export * from './assets';
export * from './auditAdapter';
export * from './auditEngine';
export * from './auditFinding';
export * from './auditProfiles';
export * from './bindings';
export * from './boolean';
export * from './brush';
export * from './canonical';
export * from './clippingMask';
export * from './clone';
export * from './colorManagement';
export * from './colorMode';
export * from './colorValidation';
export * from './component';
export * from './component-sync';
export * from './constraints';
export * from './coordinateService';
export type { CreateMasterOptions } from './document';
export * from './document';
export {
  activePageNodesWithMaster,
  addMasterOverride,
  assignMasterToPage,
  createMaster,
  deleteMaster,
  detachMasterOverride,
  duplicateMaster,
  getFormattedPageNumber,
  getPageNumber,
  getPageSide,
  getSpreadForPage,
  isPageOnLeftSide,
  pageHasOverrides,
  rebuildSpreads,
  removeMasterOverride,
  renameMaster,
  reorderMasters,
  resetMasterOverrides,
  resolveNodeOrigin,
  setBackgroundRemoval,
  setFacingPagesEnabled,
  setMasterAppliesTo,
  setPageSizeWithContentScale,
  toggleFacingPages,
} from './document';
export * from './documentCodec';
export * from './effectMasks';
export * from './effects';
export * from './emailTypes';
export * from './expandWarp';
export * from './export-types';
export * from './exportNaming';
export * from './expr';
export * from './fills';
export * from './findReplace';
export * from './flatten';
export * from './fontDefaults';
export * from './governance';
export * from './gradientPresets';
export * from './gridTypes';
export * from './iconAsset';
export * from './iconAttribution';
export * from './identity';
export * from './intelligence';
export * from './interaction-types';
export * from './interactions';
export * from './library';
export * from './liveTrace';
export * from './logo/logoProject';
export * from './maskCapability';
export * from './masks';
export * from './migrateIds';
export * from './mockup/builtinTemplates';
export * from './mockup/multimodal';
export * from './mockup/normalize';
export * from './mockup/ops';
export * from './mockup/types';
export * from './mockup/validate';
export * from './modifiers';
export * from './modifiersMigration';
export * from './motion';
export * from './motion-types';
export * from './newDocument';
export * from './nodeBounds';
export * from './operations';
export * from './pageNumbering';
export * from './pageOwnership';
export * from './pageRange';
export * from './pageScene';
export * from './paint';
export * from './pasteboardLayout';
export * from './preflight';
export * from './presetToDocument';
export * from './printGeometry';
export * from './printPreflight';
export * from './profiles';
export * from './proof';
export * from './property-path';
export * from './rasterLayer';
export * from './richTextIndex';
export * from './richTextOps';
export * from './paintCoverage';
export * from './strokeEngine';
export * from './selectionSet';
export * from './sha256';
export * from './spotLibraries';
export * from './state-machine';
export * from './state-machine-runtime';
export * from './state-machine-types';
export * from './state-machine-validation';
export * from './storyOps';
export * from './styles';
export * from './suppressions';
export * from './swatches';
export * from './table';
export * from './tableLayout';
export * from './tableOps';
export * from './text/glyphAdjustments';
export * from './text/grapheme';
export * from './textFlow';
export * from './textToOutlines';
export * from './textWarp';
export * from './thumbnail/resolve';
export * from './types';
export * from './typography';
export * from './typographyPreflight';
export * from './variables';
export * from './variant-apply';
export * from './version';
export * from './warpBounds';
export * from './warpMigration';
export * from './warpOps';
export * from './wetPaint';
