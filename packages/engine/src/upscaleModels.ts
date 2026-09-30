/** Offline super-resolution model metadata. */

export interface UpscaleModelMetadata {
  id: string;
  name: string;
  description: string;
  size: number;
  /** Manifest / download id; defaults to id. */
  filename: string;
  remoteUrl: string;
  sourceRelease: string;
  sourceUrl: string;
  checksum: string;
  bundled: boolean;
}

export const DEFAULT_UPSCALE_MODEL_ID = 'upscale-realesr-general';

export const UPSCALE_MODELS: UpscaleModelMetadata[] = [
  {
    id: 'upscale-realesr-general',
    name: 'Real-ESRGAN General (x4)',
    description: '4.8 MB offline x4 model for photos and illustrations.',
    size: 4_866_438,
    filename: 'realesr-general-x4v3.onnx',
    sourceRelease: 'Real-ESRGAN v0.3.0 (asset tag v0.2.5.0)',
    sourceUrl:
      'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth',
    remoteUrl: '',
    checksum: '856e1f4d77f553e8871302f1782b58e315a12dac52bb0b856dde2dde149b96f7',
    bundled: true,
  },
  {
    id: 'upscale-realesrgan-anime',
    name: 'Real-ESRGAN Anime (x4)',
    description:
      'Experimental optional x4 model based on the upstream anime_6B checkpoint. Varve has only synthetic browser-WASM smoke evidence; conversion provenance, artifact distribution, artist-quality results, and non-WASM runtimes remain unverified. Compare on a duplicate; it never silently substitutes the general model.',
    size: 17_906_556,
    filename: 'realesrgan-anime-6b.onnx',
    sourceRelease:
      'Real-ESRGAN anime_6B; deepghs ONNX upload @ 35e0ed8f35ce0dbea674568161a48b31ba7d2a99 (converter unrecorded)',
    sourceUrl:
      'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/RealESRGAN_x4plus_anime_6B.pth',
    remoteUrl:
      'https://github.com/K-Arthur/varve/releases/download/varve-models-v1/realesrgan-anime-6b.onnx',
    checksum: '2648cab4c4343541caa291c6754e9e8edbe7a813fffc2a677423dd12cb6b7f7',
    bundled: false,
  },
];

export function getUpscaleModel(id: string): UpscaleModelMetadata | undefined {
  return UPSCALE_MODELS.find((m) => m.id === id);
}
