export type InferenceErrorCode =
  | 'runtime_unavailable'
  | 'runtime_initialisation_failed'
  | 'runtime_asset_missing'
  | 'execution_provider_unavailable'
  | 'model_not_installed'
  | 'model_download_failed'
  | 'download_interrupted'
  | 'insufficient_disk_space'
  | 'checksum_mismatch'
  | 'invalid_onnx_model'
  | 'unsupported_opset'
  | 'missing_custom_operator'
  | 'contract_mismatch'
  | 'unsupported_input'
  | 'out_of_memory'
  | 'inference_cancelled'
  | 'inference_timeout'
  | 'invalid_output'
  | 'postprocessing_failure'
  | 'native_bridge_failure'
  | 'worker_crash'
  | 'unknown';

export interface InferenceErrorDetails {
  code: InferenceErrorCode;
  message: string;
  userMessage: string;
  technical?: string;
  recovery?: string;
  retrySafe: boolean;
  fallbackAvailable: boolean;
  cause?: Error;
}

const ERROR_MAP: Record<InferenceErrorCode, Omit<InferenceErrorDetails, 'cause'>> = {
  runtime_unavailable: {
    code: 'runtime_unavailable',
    message: 'ONNX Runtime is not available in this environment.',
    userMessage:
      'AI features require ONNX Runtime, which is not available in your browser or system.',
    technical: 'onnxruntime-web could not be imported or onnxruntime native library not found.',
    recovery: 'Try using a Chromium-based browser, or switch to Quick mode for basic operations.',
    retrySafe: false,
    fallbackAvailable: true,
  },
  runtime_initialisation_failed: {
    code: 'runtime_initialisation_failed',
    message: 'ONNX Runtime failed to initialise.',
    userMessage: 'The AI model engine could not start. This may be a temporary issue.',
    technical: 'ONNX Runtime threw an error during init_from() or module import.',
    recovery:
      'Restart the application. If the problem persists, try clearing the model cache in Settings.',
    retrySafe: true,
    fallbackAvailable: true,
  },
  runtime_asset_missing: {
    code: 'runtime_asset_missing',
    message: 'Required ONNX Runtime WASM asset not found.',
    userMessage:
      'An AI engine file is missing. This may happen after an update or in development mode.',
    technical: 'Expected WASM files (ort-wasm-simd-threaded.*) not found at /ort-wasm/.',
    recovery: 'Run `pnpm postinstall` to copy the required files, or restart the application.',
    retrySafe: true,
    fallbackAvailable: false,
  },
  execution_provider_unavailable: {
    code: 'execution_provider_unavailable',
    message: 'No compatible execution provider found.',
    userMessage:
      'Your system does not support any AI acceleration method (WebGPU, WebGL, or WASM).',
    technical: 'All execution providers failed or are unavailable.',
    recovery: 'Try a different browser, or use the native desktop app for AI features.',
    retrySafe: false,
    fallbackAvailable: true,
  },
  model_not_installed: {
    code: 'model_not_installed',
    message: 'Model is not installed.',
    userMessage: 'This AI model has not been downloaded yet.',
    technical: 'Model file not found at expected path or in IndexedDB.',
    recovery: 'Download the model from Settings > AI and Models, or use a bundled model.',
    retrySafe: true,
    fallbackAvailable: true,
  },
  model_download_failed: {
    code: 'model_download_failed',
    message: 'Failed to download model.',
    userMessage: 'The model could not be downloaded. Check your internet connection and try again.',
    technical: 'HTTP error or network failure during model download.',
    recovery: 'Check your connection and retry. The download will resume from where it stopped.',
    retrySafe: true,
    fallbackAvailable: false,
  },
  download_interrupted: {
    code: 'download_interrupted',
    message: 'Download was interrupted.',
    userMessage: 'The model download was interrupted. You can resume it later.',
    technical: 'Download aborted by user or network loss.',
    recovery: 'Resume the download from Settings > AI and Models.',
    retrySafe: true,
    fallbackAvailable: false,
  },
  insufficient_disk_space: {
    code: 'insufficient_disk_space',
    message: 'Not enough disk space.',
    userMessage:
      'There is not enough free space to download this model. Free up space and try again.',
    technical: 'Storage quota exceeded or disk full.',
    recovery: 'Free up disk space or delete unused models in Settings > AI and Models.',
    retrySafe: false,
    fallbackAvailable: true,
  },
  checksum_mismatch: {
    code: 'checksum_mismatch',
    message: 'Model file failed integrity check.',
    userMessage: 'The downloaded model file is corrupt or does not match its expected signature.',
    technical: 'SHA-256 checksum verification failed.',
    recovery: 'Delete the model and download it again. If the problem persists, report it.',
    retrySafe: true,
    fallbackAvailable: false,
  },
  invalid_onnx_model: {
    code: 'invalid_onnx_model',
    message: 'Invalid ONNX model file.',
    userMessage: 'The model file could not be loaded because it is invalid or corrupt.',
    technical: 'ONNX Runtime could not parse the model graph.',
    recovery: 'Delete the model and download it again.',
    retrySafe: true,
    fallbackAvailable: true,
  },
  unsupported_opset: {
    code: 'unsupported_opset',
    message: 'Unsupported ONNX opset version.',
    userMessage: 'This model requires a newer ONNX format than your system supports.',
    technical: 'The model uses an ONNX opset not supported by the installed runtime.',
    recovery: 'Update the application to get a newer runtime version.',
    retrySafe: false,
    fallbackAvailable: true,
  },
  missing_custom_operator: {
    code: 'missing_custom_operator',
    message: 'Model requires custom operators not available in this runtime.',
    userMessage:
      'This model needs custom operations that are not available in your AI engine build.',
    technical: 'Custom operator not registered in ONNX Runtime.',
    recovery: 'Use a different model or runtime variant.',
    retrySafe: false,
    fallbackAvailable: true,
  },
  contract_mismatch: {
    code: 'contract_mismatch',
    message: 'Model tensor contract mismatch.',
    userMessage: 'The model does not match its declared interface. It may be a different version.',
    technical: 'Actual input/output tensor names, shapes, or dtypes differ from manifest.',
    recovery: 'Update the model or report the issue.',
    retrySafe: true,
    fallbackAvailable: true,
  },
  unsupported_input: {
    code: 'unsupported_input',
    message: 'Input is not supported by this model.',
    userMessage: 'The image or data you provided is not compatible with this AI model.',
    technical: 'Input dimensions, channels, or format outside model contract.',
    recovery: 'Try a smaller image or a different model.',
    retrySafe: true,
    fallbackAvailable: true,
  },
  out_of_memory: {
    code: 'out_of_memory',
    message: 'Insufficient memory for inference.',
    userMessage: 'There is not enough memory to run this AI model on the current input.',
    technical: 'Estimated memory usage exceeds the safe budget.',
    recovery: 'Try a smaller image, a smaller model, or switch to the native desktop app.',
    retrySafe: false,
    fallbackAvailable: true,
  },
  inference_cancelled: {
    code: 'inference_cancelled',
    message: 'Inference was cancelled.',
    userMessage: 'The AI operation was cancelled.',
    technical: 'AbortSignal triggered during inference.',
    recovery: '',
    retrySafe: true,
    fallbackAvailable: false,
  },
  inference_timeout: {
    code: 'inference_timeout',
    message: 'Inference timed out.',
    userMessage: 'The AI model took too long to respond. Try a smaller image or a faster model.',
    technical: 'Inference exceeded the maximum allowed time.',
    recovery: 'Try a smaller image or switch to a faster/bundled model.',
    retrySafe: true,
    fallbackAvailable: true,
  },
  invalid_output: {
    code: 'invalid_output',
    message: 'Model produced invalid output.',
    userMessage: 'The AI model returned an unexpected result. This may be a compatibility issue.',
    technical: 'Output validation failed (NaN, wrong shape, out of range, or empty).',
    recovery: 'Try a different model or input. If the problem persists, report it.',
    retrySafe: true,
    fallbackAvailable: true,
  },
  postprocessing_failure: {
    code: 'postprocessing_failure',
    message: 'Failed to process AI model output.',
    userMessage: 'Something went wrong while processing the AI result.',
    technical: 'Postprocessing step threw an error.',
    recovery: 'Try again. If the problem persists, use a different model.',
    retrySafe: true,
    fallbackAvailable: true,
  },
  native_bridge_failure: {
    code: 'native_bridge_failure',
    message: 'Native AI bridge failed.',
    userMessage: 'The native AI engine encountered an error.',
    technical: 'Tauri IPC command failed or returned an error.',
    recovery: 'Restart the application. If using the desktop app, try reinstalling.',
    retrySafe: true,
    fallbackAvailable: true,
  },
  worker_crash: {
    code: 'worker_crash',
    message: 'AI worker process crashed.',
    userMessage: 'The background AI worker stopped unexpectedly.',
    technical: 'Web Worker terminated unexpectedly.',
    recovery: 'Restart the operation. If the problem persists, restart the application.',
    retrySafe: true,
    fallbackAvailable: true,
  },
  unknown: {
    code: 'unknown',
    message: 'An unexpected AI error occurred.',
    userMessage: 'Something unexpected happened. Please try again.',
    technical: '',
    recovery: 'Try again. If the problem persists, report the issue.',
    retrySafe: true,
    fallbackAvailable: true,
  },
};

export class InferenceError extends Error {
  public readonly code: InferenceErrorCode;
  public readonly userMessage: string;
  public readonly technical: string;
  public readonly recovery: string;
  public readonly retrySafe: boolean;
  public readonly fallbackAvailable: boolean;

  constructor(code: InferenceErrorCode, cause?: Error, overrides?: Partial<InferenceErrorDetails>) {
    const base = ERROR_MAP[code] ?? ERROR_MAP.unknown;
    const message = overrides?.message ?? base.message;
    super(message);
    this.name = 'InferenceError';
    this.code = code;
    this.userMessage = overrides?.userMessage ?? base.userMessage;
    this.technical = overrides?.technical ?? base.technical ?? '';
    this.recovery = overrides?.recovery ?? base.recovery ?? '';
    this.retrySafe = overrides?.retrySafe ?? base.retrySafe;
    this.fallbackAvailable = overrides?.fallbackAvailable ?? base.fallbackAvailable;
    if (cause) {
      this.cause = cause;
    }
  }

  toJSON(): InferenceErrorDetails {
    return {
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      technical: this.technical,
      recovery: this.recovery,
      retrySafe: this.retrySafe,
      fallbackAvailable: this.fallbackAvailable,
    };
  }
}

export function isInferenceError(error: unknown): error is InferenceError {
  return error instanceof InferenceError;
}

export function toUserMessage(error: unknown): string {
  if (error instanceof InferenceError) {
    return error.userMessage;
  }
  if (error instanceof Error) {
    if (error.message.includes('abort') || error.message.includes('cancel')) {
      return 'The operation was cancelled.';
    }
    if (error.message.includes('memory') || error.message.includes('quota')) {
      return 'There is not enough memory or storage. Free up space and try again.';
    }
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return 'A network error occurred. Check your connection and try again.';
    }
    return 'Something went wrong. Please try again.';
  }
  return 'An unexpected error occurred.';
}
