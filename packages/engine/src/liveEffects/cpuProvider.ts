/** Canonical TypeScript effect kernels shared by replay and worker jobs. */
import { applyBloom } from './bloom';
import { applyCaustics } from './caustics';
import { applyCrt } from './crt';
import type { EffectDispatchRequest, LiveEffectProvider } from './dispatch';
import { applyDither } from './dither';
import { applyLensFlare } from './lensFlare';
import { applyLightLeak } from './lightLeak';
import { applyLightShafts } from './lightShafts';
import { applyPaletteSnap } from './paletteSnap';
import { applyRgbSplit } from './rgbSplit';
import { applyVhs } from './vhs';

/** Reference provider: the existing TS kernels, byte-identical to replay. */
export const cpuEffectProvider: LiveEffectProvider = {
  id: 'cpu-effects',
  label: 'CPU (TypeScript)',
  isAvailable() {
    return Promise.resolve(true);
  },
  async apply(request: EffectDispatchRequest, rgba: Uint8ClampedArray) {
    const imageData = new ImageData(new Uint8ClampedArray(rgba), request.width, request.height);
    const options = {
      quality: request.quality,
      coordSpace: request.coordSpace,
    };
    switch (request.effect) {
      case 'dither':
        applyDither(
          imageData,
          request.params as unknown as Parameters<typeof applyDither>[1],
          options.coordSpace,
        );
        break;
      case 'paletteSnap':
        applyPaletteSnap(
          imageData,
          request.params as unknown as Parameters<typeof applyPaletteSnap>[1],
          options.coordSpace,
        );
        break;
      case 'bloom':
        applyBloom(
          imageData,
          request.params as unknown as Parameters<typeof applyBloom>[1],
          options,
        );
        break;
      case 'rgbSplit':
        applyRgbSplit(
          imageData,
          request.params as unknown as Parameters<typeof applyRgbSplit>[1],
          options.coordSpace,
        );
        break;
      case 'crt':
        applyCrt(imageData, request.params as unknown as Parameters<typeof applyCrt>[1]);
        break;
      case 'vhs':
        applyVhs(imageData, request.params as unknown as Parameters<typeof applyVhs>[1], options);
        break;
      case 'lightShafts':
        applyLightShafts(
          imageData,
          request.params as unknown as Parameters<typeof applyLightShafts>[1],
          options,
        );
        break;
      case 'lensFlare':
        applyLensFlare(
          imageData,
          request.params as unknown as Parameters<typeof applyLensFlare>[1],
          options,
        );
        break;
      case 'lightLeak':
        applyLightLeak(
          imageData,
          request.params as unknown as Parameters<typeof applyLightLeak>[1],
        );
        break;
      case 'caustics':
        applyCaustics(
          imageData,
          request.params as unknown as Parameters<typeof applyCaustics>[1],
          options,
        );
        break;
    }
    return new Uint8ClampedArray(imageData.data);
  },
};
