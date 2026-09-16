import type {
  DiffusionFrameContract,
  DiffusionInputKind,
  DiffusionMaskConvention,
} from './diffusionFrame';
import { SD15_INPAINTING_FRAME_CONTRACT, SDXL_INPAINTING_FRAME_CONTRACT } from './diffusionFrame';
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
  /** Whether the runtime requires a discrete GPU rather than CPU fallback. */
  requiresGpu: boolean;
  /** Whether the installed profile remains usable with no network. */
  offlineAfterInstall: boolean;
}

export interface LocalGenerativeModelProfile {
  id: string;
  name: string;
  family: string;
  disposition: LocalGenerativeModelDisposition;
  supportedModes: readonly GenerativeEditMode[];
  inputKind: DiffusionInputKind;
  maskConvention: DiffusionMaskConvention;
  frameContract?: DiffusionFrameContract;
  artifact: LocalGenerativeModelArtifact;
  runtime: LocalGenerativeModelRuntimeRequirements;
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
    adapterId: 'diffusion-rs-0.1.20-varve-image-cfg-v1',
    executionBackends: ['native-cpu', 'native-vulkan', 'native-metal'],
    architectures: [],
    minimumMemoryBytes: 6 * 1024 ** 3,
    recommendedMemoryBytes: 8 * 1024 ** 3,
    requiresGpu: false,
    offlineAfterInstall: true,
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
    id: 'powerpaint-v2-1-research',
    name: 'PowerPaint v2-1',
    family: 'powerpaint',
    disposition: 'research-only',
    supportedModes: ALL_INPAINTING_MODES,
    inputKind: 'masked-inpainting',
    maskConvention: 'white-edit-black-preserve',
    frameContract: SDXL_INPAINTING_FRAME_CONTRACT,
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
  },
): { runnable: true } | { runnable: false; reason: string } {
  if (profile.disposition !== 'qualified') {
    return { runnable: false, reason: profile.reason };
  }
  if (!profile.supportedModes.includes(options.mode)) {
    return { runnable: false, reason: `${profile.name} does not support ${options.mode}.` };
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
  if (!profile.runtime.adapterId || !profile.frameContract) {
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
  return { runnable: true };
}
