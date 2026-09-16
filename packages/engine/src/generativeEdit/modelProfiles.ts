import type {
  DiffusionFrameContract,
  DiffusionInputKind,
  DiffusionMaskConvention,
} from './diffusionFrame';
import {
  SD2_INPAINTING_FRAME_CONTRACT,
  SD15_INPAINTING_FRAME_CONTRACT,
  SDXL_INPAINTING_FRAME_CONTRACT,
} from './diffusionFrame';
import type { GenerativeEditMode } from './types';

/**
 * A model profile is a complete local-runtime contract, not a file chooser
 * hint.  In particular, a quantized file does not become runnable merely
 * because its extension is recognised: the profile must name its adapter,
 * required components, frame/mask contract, and resource envelope.
 */
export type LocalGenerativeModelDisposition =
  | 'qualified'
  | 'research-only'
  | 'disabled-unqualified';

export type LocalGenerativeModelArtifactFormat = 'gguf' | 'safetensors' | 'onnx-components';

export interface LocalGenerativeModelArtifact {
  format: LocalGenerativeModelArtifactFormat;
  source: string;
  revision: string;
  sha256?: string;
  sizeBytes?: number;
  license: string;
  /** Every role must be present before the profile can be installed. */
  requiredComponentRoles: readonly string[];
}

export interface LocalGenerativeModelRuntimeRequirements {
  adapterId: string;
  /** Backends the adapter has been built and qualified to use. */
  executionBackends: readonly string[];
  /** Explicitly supported CPU families; empty means not yet qualified. */
  architectures: readonly string[];
  /** A lower bound for measured available system memory, when known. */
  minimumMemoryBytes?: number;
  /** A target memory budget for setup copy and concurrent editor work. */
  recommendedMemoryBytes?: number;
  /** A lower bound for measured dedicated or unified GPU memory, when known. */
  minimumVramBytes?: number;
  /** A target GPU-memory budget that leaves room for the editor and driver. */
  recommendedVramBytes?: number;
  /** Whether the runtime requires a discrete GPU rather than CPU fallback. */
  requiresGpu: boolean;
  /** Whether the installed profile remains usable with no network. */
  offlineAfterInstall: boolean;
}

export interface LocalGenerativeModelQualification {
  status: 'passed' | 'failed' | 'pending';
  /** Repository-relative evidence report or an equivalent durable artifact. */
  evidenceRef: string;
  /** Platform identities that actually ran the masked quality gate. */
  platforms: readonly string[];
}

export interface LocalGenerativeModelProfile {
  id: string;
  name: string;
  family: string;
  disposition: LocalGenerativeModelDisposition;
  supportedModes: readonly GenerativeEditMode[];
  inputKind: DiffusionInputKind;
  /** Required only for providers that consume an explicit edit mask. */
  maskConvention?: DiffusionMaskConvention;
  frameContract?: DiffusionFrameContract;
  artifact: LocalGenerativeModelArtifact;
  runtime: LocalGenerativeModelRuntimeRequirements;
  qualification?: LocalGenerativeModelQualification;
  limitations: readonly string[];
  /** Stable explanation shown by setup/qualification tooling. */
  reason: string;
}

const ALL_INPAINTING_MODES: readonly GenerativeEditMode[] = ['fill', 'remove', 'replace', 'expand'];

/**
 * The only profile understood by the current Varve native helper.  It stays
 * disabled until both runtime compatibility and the real-photo quality gate
 * pass; keeping the profile here prevents a future UI from treating its
 * 1.75GB GGUF as a generally compatible SD checkpoint.
 */
export const CURRENT_LOCAL_GENERATIVE_MODEL_PROFILE: LocalGenerativeModelProfile = {
  id: 'sd15-inpainting-q4_0-v1',
  name: 'Stable Diffusion 1.5 Inpainting · Q4_0',
  family: 'stable-diffusion-1.5-inpainting',
  disposition: 'disabled-unqualified',
  supportedModes: ALL_INPAINTING_MODES,
  inputKind: 'masked-inpainting',
  maskConvention: 'white-edit-black-preserve',
  frameContract: SD15_INPAINTING_FRAME_CONTRACT,
  artifact: {
    format: 'gguf',
    source: 'gpustack/stable-diffusion-v1-5-inpainting-GGUF',
    revision: '21491e4',
    sha256: 'd157ce24483f0c999062da140eacebe8f3ed015e652723e31f6d39119b800c16',
    sizeBytes: 1_747_219_584,
    license: 'CreativeML OpenRAIL-M',
    requiredComponentRoles: ['sd15-inpainting', 'clip-vit-l-14', 'vae'],
  },
  runtime: {
    adapterId: 'diffusion-rs-0.1.20-varve-image-cfg-profile-contract-v2',
    executionBackends: ['native-cpu'],
    architectures: [],
    minimumMemoryBytes: 6 * 1024 ** 3,
    recommendedMemoryBytes: 8 * 1024 ** 3,
    requiresGpu: false,
    offlineAfterInstall: true,
  },
  qualification: {
    status: 'failed',
    evidenceRef: 'docs/audits/generative-editing-runtime-qualification-2026-09-12.md',
    platforms: [],
  },
  limitations: [
    'The pinned artifact is documented for a patched llama-box/stable-diffusion.cpp runtime.',
    'It has not passed Varve real-photograph prompt-adherence or runtime-integrity qualification.',
    'A model handle must not be issued until the exact artifact, adapter, backend, and platform pass qualification.',
  ],
  reason:
    'Disabled until a compatible native adapter and the real-photograph quality gate pass; use local LaMa or Quick Cleanup for promptless edits.',
};

/**
 * Research candidates are deliberately explicit so model exploration cannot
 * turn into accidental product routing.  Their component/runtime requirements
 * are part of the data because file size alone is not enough to plan local
 * use, especially on ARM, ChromeOS, and low-memory desktops.
 */
export const LOCAL_GENERATIVE_MODEL_RESEARCH_PROFILES: readonly LocalGenerativeModelProfile[] = [
  {
    id: 'sd2-inpainting-f16-research',
    name: 'Stable Diffusion 2 Inpainting · F16',
    family: 'stable-diffusion-2-inpainting',
    disposition: 'research-only',
    supportedModes: ALL_INPAINTING_MODES,
    inputKind: 'masked-inpainting',
    maskConvention: 'white-edit-black-preserve',
    frameContract: SD2_INPAINTING_FRAME_CONTRACT,
    artifact: {
      format: 'safetensors',
      source: 'stabilityai/stable-diffusion-2-inpainting',
      revision: '512-inpainting-ema.safetensors (mirror; verify upstream pin)',
      sha256: 'b29e2ed9a8fe58e76f7e801bda091d23738bd74c1da3f339bcbe2d40922fcb60',
      sizeBytes: 5_214_662_094,
      license: 'CreativeML Open RAIL++-M',
      requiredComponentRoles: ['sd2-inpainting', 'openclip-vit-h-14', 'vae'],
    },
    runtime: {
      adapterId: 'diffusion-rs-0.1.20-sd2-diagnostic-only',
      executionBackends: [],
      architectures: [],
      minimumMemoryBytes: 7 * 1024 ** 3,
      recommendedMemoryBytes: 10 * 1024 ** 3,
      requiresGpu: false,
      offlineAfterInstall: true,
    },
    qualification: {
      status: 'failed',
      evidenceRef: 'docs/audits/generative-editing-native-probe-2026-09-14.md',
      platforms: [],
    },
    limitations: [
      'The 512px SD 2 model is a large F16 artifact and is not a low-memory Chromebook or ARM default.',
      'The retained Linux CPU diagnostic produced a recognizable but semantically wrong object and did not pass the real-photograph rubric.',
      'The current native helper is compiled for the SD 1.5 profile and rejects this profile until a separate adapter is implemented.',
    ],
    reason:
      'Research-only diagnostic candidate; no production SD 2 adapter or real-photograph quality certificate exists.',
  },
  {
    id: 'migan-512-places2-research',
    name: 'MI-GAN 512 Places2',
    family: 'migan',
    disposition: 'research-only',
    // MI-GAN is a mask-only image-inpainting model. It is useful for a
    // promptless magic-eraser tier, but it cannot satisfy prompt-conditioned
    // Replace or Expand, so those modes are deliberately not listed here.
    supportedModes: ['fill', 'remove'],
    inputKind: 'masked-inpainting',
    // The published MI-GAN conversion keeps white/one coverage and erases
    // black/zero coverage. The adapter still has to verify the GGUF metadata
    // and its resize/composite path before this convention can be trusted.
    maskConvention: 'white-preserve-black-edit',
    artifact: {
      format: 'gguf',
      source: 'Acly/MIGAN-GGUF',
      revision: '6c410de2373fe94080e739642339b3e9f748b034',
      sha256: '3e47592bf716d0dc306f8dc02d4476cfcdaf2c055fa3c3c8e0ced4db775eb64',
      sizeBytes: 14_758_080,
      license: 'MIT',
      requiredComponentRoles: ['migan-512-places2', 'vision.cpp-runtime'],
    },
    runtime: {
      adapterId: 'vision-cpp-migan-sidecar-unimplemented',
      executionBackends: [],
      architectures: [],
      requiresGpu: false,
      offlineAfterInstall: true,
    },
    qualification: {
      status: 'pending',
      evidenceRef: 'docs/audits/generative-editing-lightweight-model-screen-2026-09-16.md',
      platforms: [],
    },
    limitations: [
      'Mask-only model with no natural-language conditioning; it cannot implement prompt-conditioned Replace or Expand.',
      'The official GGUF is converted for vision.cpp; the current Varve ONNX and diffusion-rs runtimes cannot consume it.',
      'The fixed-resolution preprocessing, mask polarity, alpha handling, and protected-pixel composite require a separate Varve adapter.',
      'No Varve sidecar, cancellation, ARM/Vulkan/CPU, memory, or real-photograph qualification exists yet.',
    ],
    reason:
      'Research-only low-memory mask-repair candidate; an explicit vision.cpp adapter and real-photograph qualification are required before exposure.',
  },
  {
    id: 'moebius-onnx-research',
    name: 'Moebius · ONNX inpainting',
    family: 'moebius',
    disposition: 'research-only',
    // Moebius provides learned-category conditioning rather than a text
    // encoder. It is therefore a possible promptless removal/fill tier, not
    // a natural-language Replace or Expand provider.
    supportedModes: ['fill', 'remove'],
    inputKind: 'masked-inpainting',
    maskConvention: 'white-edit-black-preserve',
    artifact: {
      format: 'onnx-components',
      source: 'simonw/Moebius-ONNX',
      revision: '5bf1ef5d2861ec01a727183a3f95dc64f352120e',
      license: 'Apache-2.0',
      requiredComponentRoles: [
        'moebius-unet',
        'moebius-vae-encoder',
        'moebius-vae-decoder',
        'moebius-ddim-sampler',
      ],
    },
    runtime: {
      adapterId: 'moebius-onnx-ddim-sidecar-unimplemented',
      executionBackends: [],
      architectures: [],
      requiresGpu: false,
      offlineAfterInstall: true,
    },
    qualification: {
      status: 'pending',
      evidenceRef: 'docs/audits/generative-editing-lightweight-model-screen-2026-09-16.md',
      platforms: [],
    },
    limitations: [
      'The ONNX export is three static 512×512 graphs and needs a custom JavaScript DDIM loop plus the model-specific VAE scale of 0.13025.',
      'Its learned ten-token conditioning table is not natural-language prompting; prompt-conditioned Replace and Expand remain unsupported.',
      'The roughly 1.24 GB fp32 graph set has no Varve peak-memory, cancellation, browser/WebGPU, ARM, or real-photograph qualification.',
      'The current letterbox frame helper is not the published Moebius pipeline and must not be reused without numerical parity evidence.',
    ],
    reason:
      'Research-only fixed-resolution mask-repair candidate; the three-graph adapter and memory/platform qualification are not implemented.',
  },
  {
    id: 'powerpaint-v2-1-research',
    name: 'PowerPaint v2-1',
    family: 'powerpaint',
    disposition: 'research-only',
    supportedModes: ALL_INPAINTING_MODES,
    inputKind: 'masked-inpainting',
    maskConvention: 'white-edit-black-preserve',
    // The published bundle contains a Realistic Vision / SD 1.5 base and a
    // separate BrushNet adapter. It is not an SDXL checkpoint; retaining the
    // 512-frame contract prevents a future sidecar from silently using the
    // wrong latent geometry.
    frameContract: SD15_INPAINTING_FRAME_CONTRACT,
    artifact: {
      format: 'safetensors',
      source: 'JunhaoZhuang/PowerPaint-v2-1',
      revision: 'research-pinned-by-qualification-run',
      license: 'Apache-2.0 (model card; verify repository notices)',
      requiredComponentRoles: [
        'powerpaint-adapter',
        'base-diffusion-model',
        'text-encoder',
        'vae',
        'scheduler',
      ],
    },
    runtime: {
      adapterId: 'powerpaint-diffusers-sidecar-unimplemented',
      executionBackends: [],
      architectures: [],
      requiresGpu: false,
      offlineAfterInstall: true,
    },
    limitations: [
      'Requires a separately pinned Python/Diffusers/PyTorch sidecar or a qualified native port.',
      'No Varve production adapter or measured low-memory/ARM profile exists yet.',
    ],
    reason:
      'Research-only candidate; never route a request until every component and backend is qualified.',
  },
  {
    id: 'flux-fill-dev-research',
    name: 'FLUX.1-Fill-dev',
    family: 'flux-fill',
    disposition: 'research-only',
    supportedModes: ALL_INPAINTING_MODES,
    inputKind: 'masked-inpainting',
    maskConvention: 'white-edit-black-preserve',
    artifact: {
      format: 'safetensors',
      source: 'black-forest-labs/FLUX.1-Fill-dev',
      revision: 'research-pinned-by-qualification-run',
      license: 'flux-1-dev-non-commercial-license',
      requiredComponentRoles: ['flux-fill-transformer', 't5xxl', 'clip-l', 'vae', 'scheduler'],
    },
    runtime: {
      adapterId: 'flux-fill-native-sidecar-unimplemented',
      executionBackends: [],
      architectures: [],
      requiresGpu: true,
      offlineAfterInstall: true,
    },
    limitations: [
      'The official model is a large gated 12B workflow and is not a low-memory fallback.',
      'Quantized GGUF uploads require their own patched runtime and may omit text encoders or VAE components.',
      'No Varve production adapter or platform qualification exists yet.',
    ],
    reason:
      'Research-only high-memory candidate; local use requires explicit license acceptance and component/runtime qualification.',
  },
  {
    id: 'fibo-edit-1-5-turbo-research',
    name: 'FIBO-Edit 1.5 turbo',
    family: 'fibo-edit',
    disposition: 'research-only',
    supportedModes: ['fill', 'remove', 'replace'],
    inputKind: 'masked-inpainting',
    maskConvention: 'white-edit-black-preserve',
    artifact: {
      format: 'safetensors',
      source: 'briaai/Fibo-Edit-1.5-turbo',
      revision: 'research-pinned-by-qualification-run',
      license: 'non-commercial model terms',
      requiredComponentRoles: ['fibo-transformer', 'text-encoder', 'vae', 'scheduler'],
    },
    runtime: {
      adapterId: 'fibo-diffusers-sidecar-unimplemented',
      executionBackends: [],
      architectures: [],
      requiresGpu: true,
      offlineAfterInstall: true,
    },
    limitations: [
      'The structured prompt path must not use remote Gemini conversion or trust arbitrary model code.',
      'License suitability and memory usage are not release-qualified for Varve.',
    ],
    reason:
      'Research-only structured-edit candidate; its prompt and license requirements still need a local safe adapter.',
  },
  {
    id: 'sdxl-inpainting-research',
    name: 'Stable Diffusion XL Inpainting',
    family: 'stable-diffusion-xl-inpainting',
    disposition: 'research-only',
    supportedModes: ALL_INPAINTING_MODES,
    inputKind: 'masked-inpainting',
    maskConvention: 'white-edit-black-preserve',
    frameContract: SDXL_INPAINTING_FRAME_CONTRACT,
    artifact: {
      format: 'safetensors',
      source: 'diffusers/stable-diffusion-xl-1.0-inpainting-0.1',
      revision: 'research-pinned-by-qualification-run',
      license: 'CreativeML OpenRAIL-M',
      requiredComponentRoles: ['sdxl-unet', 'text-encoder', 'text-encoder-2', 'vae', 'scheduler'],
    },
    runtime: {
      adapterId: 'sdxl-diffusers-sidecar-unimplemented',
      executionBackends: [],
      architectures: [],
      requiresGpu: true,
      offlineAfterInstall: true,
    },
    limitations: [
      'The current SDXL probe exhausted the available memory budget before an acceptable semantic result.',
      'The frame contract is intentionally not exposed until a new adapter and memory profile pass.',
    ],
    reason:
      'Research-only high-memory comparison; the current desktop and browser profiles must refuse it.',
  },
  {
    id: 'flux2-klein-4b-reference-research',
    name: 'FLUX.2 Klein 4B · reference editing',
    family: 'flux2-klein-4b',
    disposition: 'research-only',
    // This profile intentionally has no generative-edit modes. The published
    // contract is image-to-image/reference editing, not a hard mask. Listing
    // it as Fill/Replace/Expand would let a future adapter silently discard
    // the user's protected-pixel boundary.
    supportedModes: [],
    inputKind: 'reference-edit',
    artifact: {
      format: 'safetensors',
      source: 'black-forest-labs/FLUX.2-klein-4B',
      revision: 'main (pin before install)',
      license: 'Apache-2.0',
      requiredComponentRoles: [
        'flux2-klein-4b-transformer',
        'qwen3-4b-text-encoder',
        'flux2-autoencoder',
        'tokenizer',
        'scheduler',
      ],
    },
    runtime: {
      adapterId: 'flux2-klein-reference-sidecar-unimplemented',
      executionBackends: [],
      architectures: [],
      // The Hugging Face card reports ~13 GB VRAM while the official runtime
      // repository reports ~8 GB for Klein 4B. Until Varve measures the full
      // component graph, use the conservative card figure and do not infer
      // Chromebook/ARM suitability from the 4B label or file size.
      minimumVramBytes: 13 * 1024 ** 3,
      recommendedVramBytes: 16 * 1024 ** 3,
      requiresGpu: true,
      offlineAfterInstall: true,
    },
    limitations: [
      'The published model supports single- and multi-reference image editing, not an explicit hard-mask inpainting or outpainting contract.',
      'The complete local graph includes the transformer, Qwen3 text encoder, FLUX.2 autoencoder, tokenizer, and scheduler; the transformer file alone is about 7.75 GB.',
      'The upstream memory estimates conflict (~8 GB versus ~13 GB VRAM), so no Varve memory, backend, ARM, or cancellation qualification exists.',
      'A future reference-edit command must composite through the same protected-pixel boundary and must not reuse the masked inpainting adapter.',
    ],
    reason:
      'Research-only reference editor; it is not a Fill, Remove, Replace, or Expand provider and must remain unavailable until a separate local adapter and qualification exist.',
  },
];

export const LOCAL_GENERATIVE_MODEL_PROFILES: readonly LocalGenerativeModelProfile[] = [
  CURRENT_LOCAL_GENERATIVE_MODEL_PROFILE,
  ...LOCAL_GENERATIVE_MODEL_RESEARCH_PROFILES,
];

export function getLocalGenerativeModelProfile(
  profileId: string,
): LocalGenerativeModelProfile | undefined {
  return LOCAL_GENERATIVE_MODEL_PROFILES.find((profile) => profile.id === profileId);
}

export function isLocalGenerativeModelRunnable(
  profile: LocalGenerativeModelProfile,
  options: {
    mode: GenerativeEditMode;
    availableMemoryBytes?: number;
    executionBackend?: string;
    architecture?: string;
    platform?: string;
    availableVramBytes?: number;
  },
): { runnable: true } | { runnable: false; reason: string } {
  if (profile.disposition !== 'qualified') {
    return { runnable: false, reason: profile.reason };
  }
  if (profile.inputKind !== 'masked-inpainting') {
    return {
      runnable: false,
      reason: `${profile.name} is a reference editor and cannot run a masked ${options.mode} edit.`,
    };
  }
  if (!profile.supportedModes.includes(options.mode)) {
    return { runnable: false, reason: `${profile.name} does not support ${options.mode}.` };
  }
  if (
    profile.qualification?.status !== 'passed' ||
    profile.qualification.evidenceRef.trim().length === 0 ||
    profile.qualification.platforms.length === 0
  ) {
    return {
      runnable: false,
      reason: `${profile.name} has no passed local quality qualification evidence.`,
    };
  }
  if (profile.artifact.sha256?.length !== 64) {
    return {
      runnable: false,
      reason: `${profile.name} has no pinned artifact checksum.`,
    };
  }
  if (profile.artifact.requiredComponentRoles.length === 0) {
    return {
      runnable: false,
      reason: `${profile.name} has no complete component manifest.`,
    };
  }
  if (!profile.runtime.adapterId || !profile.frameContract || !profile.maskConvention) {
    return {
      runnable: false,
      reason: `${profile.name} has no qualified model adapter and frame contract.`,
    };
  }
  if (!profile.runtime.offlineAfterInstall) {
    return {
      runnable: false,
      reason: `${profile.name} is not usable offline after installation.`,
    };
  }
  if (options.platform === undefined) {
    return {
      runnable: false,
      reason: `${profile.name} requires an explicitly qualified target platform.`,
    };
  }
  if (!profile.qualification.platforms.includes(options.platform)) {
    return {
      runnable: false,
      reason: `${profile.name} has not been qualified for ${options.platform}.`,
    };
  }
  if (options.executionBackend === undefined) {
    return {
      runnable: false,
      reason: `${profile.name} requires an explicitly selected qualified execution backend.`,
    };
  }
  if (!profile.runtime.executionBackends.includes(options.executionBackend)) {
    return {
      runnable: false,
      reason: `${profile.name} has not been qualified for the ${options.executionBackend} backend.`,
    };
  }
  if (profile.runtime.executionBackends.length === 0) {
    return {
      runnable: false,
      reason: `${profile.name} has no qualified execution backend.`,
    };
  }
  if (profile.runtime.architectures.length === 0) {
    return {
      runnable: false,
      reason: `${profile.name} has no qualified CPU architecture.`,
    };
  }
  if (options.architecture === undefined) {
    return {
      runnable: false,
      reason: `${profile.name} requires an explicitly qualified CPU architecture.`,
    };
  }
  if (!profile.runtime.architectures.includes(options.architecture)) {
    return {
      runnable: false,
      reason: `${profile.name} has not been qualified for ${options.architecture}.`,
    };
  }
  if (
    profile.runtime.minimumMemoryBytes !== undefined &&
    options.availableMemoryBytes === undefined
  ) {
    return {
      runnable: false,
      reason: `${profile.name} requires a measured available-memory value before startup.`,
    };
  }
  if (
    profile.runtime.minimumMemoryBytes !== undefined &&
    options.availableMemoryBytes !== undefined &&
    options.availableMemoryBytes < profile.runtime.minimumMemoryBytes
  ) {
    return {
      runnable: false,
      reason: `${profile.name} needs at least ${Math.ceil(profile.runtime.minimumMemoryBytes / 1024 ** 3)} GiB available memory for its qualified working set.`,
    };
  }
  if (profile.runtime.minimumVramBytes !== undefined && options.availableVramBytes === undefined) {
    return {
      runnable: false,
      reason: `${profile.name} requires a measured available-GPU-memory value before startup.`,
    };
  }
  if (
    profile.runtime.minimumVramBytes !== undefined &&
    options.availableVramBytes !== undefined &&
    options.availableVramBytes < profile.runtime.minimumVramBytes
  ) {
    return {
      runnable: false,
      reason: `${profile.name} needs at least ${Math.ceil(profile.runtime.minimumVramBytes / 1024 ** 3)} GiB available GPU memory for its qualified working set.`,
    };
  }
  return { runnable: true };
}
