/**
 * @strata/scene — document model, component slots, and variable store.
 *
 * The editor manipulates this model (task 0.9+); the engine renders a
 * flattened projection of it. Slots (1.1) and variable math (1.2) extend these
 * stable shapes.
 */

export * from './adjustments';
export * from './bindings';
export * from './boolean';
export * from './brush';
export * from './clone';
export * from './colorManagement';
export * from './colorMode';
export * from './component';
export * from './component-sync';
export * from './constraints';
export * from './document';
export * from './documentCodec';
export { setBackgroundRemoval } from './document';
export * from './export-types';
export * from './expr';
export * from './fills';
export * from './governance';
export * from './intelligence';
export * from './interaction-types';
export * from './interactions';
export * from './library';
export * from './masks';
export * from './motion';
export * from './motion-types';
export * from './printPreflight';
export * from './profiles';
export * from './property-path';
export * from './state-machine';
export * from './state-machine-runtime';
export * from './state-machine-types';
export * from './styles';
export * from './swatches';
export * from './textFlow';
export * from './textWarp';
export * from './types';
export * from './typography';
export * from './typographyPreflight';
export * from './variables';
export * from './variant-apply';
export * from './version';
