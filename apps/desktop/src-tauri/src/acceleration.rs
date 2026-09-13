//! Native acceleration commands and the shared GPU compute engine.
//!
//! Separation of concerns (see `docs/architecture/native-acceleration.md`):
//! presentation stays in the webview; this module owns native device
//! discovery, the bounded hardware self-test, and offscreen effect/resample
//! compute. Inference provider status is reported from what the shipped
//! runtime actually provides, never from compiled-in feature flags.

use std::sync::{Arc, Mutex};

use serde::Serialize;
use varve_accel::capability::{
    AccelStage, DeviceKind, InferenceCapabilities, InferenceProviderStatus,
    NativeAccelerationReport, UnavailableReason,
};
use varve_accel::discovery::{self, AccelError, SelfTestReport};
use varve_accel::effects::GpuEffectEngine;

/// Application-wide acceleration state. The engine is created lazily on the
/// first GPU workload or explicit self-test and dropped after device loss.
pub struct AccelerationState {
    engine: Mutex<Option<Arc<GpuEffectEngine>>>,
    verified_device_id: Mutex<Option<String>>,
    last_error: Mutex<Option<String>>,
}

impl Default for AccelerationState {
    fn default() -> Self {
        Self::new()
    }
}

impl AccelerationState {
    pub fn new() -> Self {
        Self {
            engine: Mutex::new(None),
            verified_device_id: Mutex::new(None),
            last_error: Mutex::new(None),
        }
    }

    /// A cloneable handle for moving into blocking workers.
    pub fn workers(self: &Arc<Self>) -> Result<GpuWorkers, String> {
        Ok(GpuWorkers {
            engine: self.engine()?,
            state: Arc::clone(self),
        })
    }

    /// Get the shared engine, creating it on first use.
    pub fn engine(&self) -> Result<Arc<GpuEffectEngine>, String> {
        let mut guard = self
            .engine
            .lock()
            .map_err(|_| "acceleration engine lock poisoned".to_string())?;
        if let Some(engine) = guard.as_ref() {
            return Ok(Arc::clone(engine));
        }
        match GpuEffectEngine::create() {
            Ok(engine) => {
                let engine = Arc::new(engine);
                *guard = Some(Arc::clone(&engine));
                if let Ok(mut error) = self.last_error.lock() {
                    *error = None;
                }
                Ok(engine)
            }
            Err(err) => {
                if let Ok(mut error) = self.last_error.lock() {
                    *error = Some(err.to_string());
                }
                Err(err.to_string())
            }
        }
    }

    pub fn current_engine(&self) -> Option<Arc<GpuEffectEngine>> {
        self.engine.lock().ok().and_then(|guard| guard.clone())
    }

    /// Drop the engine after device loss or an explicit re-detect.
    pub fn reset(&self) {
        if let Ok(mut guard) = self.engine.lock() {
            *guard = None;
        }
        if let Ok(mut verified) = self.verified_device_id.lock() {
            *verified = None;
        }
    }

    fn record_verified(&self, device_id: String) {
        if let Ok(mut verified) = self.verified_device_id.lock() {
            *verified = Some(device_id);
        }
    }

    fn verified_device_id(&self) -> Option<String> {
        self.verified_device_id
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
    }

    fn last_error(&self) -> Option<String> {
        self.last_error.lock().ok().and_then(|guard| guard.clone())
    }
}

/// A GPU engine plus its owning state, usable from blocking workers.
#[derive(Clone)]
pub struct GpuWorkers {
    pub engine: Arc<GpuEffectEngine>,
    pub state: Arc<AccelerationState>,
}

/// Capability report plus runtime state for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAccelerationStatus {
    pub report: NativeAccelerationReport,
    /// True when a GPU device has actually been created this session.
    pub engine_ready: bool,
    pub verified_device_id: Option<String>,
    /// Most recent device-creation failure, if any.
    pub last_error: Option<String>,
}

/// Cheap (no device creation) native capability report. Device stages are
/// `discovered` until a device is created; `native_gpu_self_test` performs
/// the bounded execution verification.
#[tauri::command]
pub async fn native_acceleration_status(
    state: tauri::State<'_, Arc<AccelerationState>>,
    redetect: Option<bool>,
) -> Result<NativeAccelerationStatus, String> {
    if redetect == Some(true) {
        state.reset();
    }

    let mut compute =
        tauri::async_runtime::spawn_blocking(discovery::discover_compute_devices)
            .await
            .map_err(|err| format!("acceleration discovery task failed: {err}"))?;

    let engine_ready = state.current_engine().is_some();
    let verified_device_id = state.verified_device_id();
    if let Some(selected_id) = compute.selected_id.clone() {
        if let Some(device) = compute.devices.iter_mut().find(|d| d.id == selected_id) {
            if verified_device_id.as_deref() == Some(device.id.as_str()) {
                device.stage = AccelStage::ExecutionVerified;
            } else if engine_ready {
                device.stage = AccelStage::DeviceUsable;
            }
        }
    }

    Ok(NativeAccelerationStatus {
        report: NativeAccelerationReport {
            schema_version: varve_accel::capability::REPORT_SCHEMA_VERSION,
            generated_at_ms: varve_accel::capability::now_unix_ms(),
            host_os: std::env::consts::OS.to_string(),
            host_arch: std::env::consts::ARCH.to_string(),
            cpu: varve_accel::capability::cpu_capabilities(),
            compute,
            inference: inference_capabilities(),
        },
        engine_ready,
        verified_device_id,
        last_error: state.last_error(),
    })
}

/// Bounded hardware self-test. Creates the device if needed, dispatches a
/// small compute shader, verifies the readback, and records the device as
/// execution-verified.
#[tauri::command]
pub async fn native_gpu_self_test(
    state: tauri::State<'_, Arc<AccelerationState>>,
) -> Result<SelfTestReport, String> {
    let engine = state.engine()?;
    let report = tauri::async_runtime::spawn_blocking(move || engine.self_test())
        .await
        .map_err(|err| format!("GPU self-test task failed: {err}"))?
        .map_err(|err| err.to_string())?;
    state.record_verified(report.device_id.clone());
    Ok(report)
}

/// Apply a live effect on the GPU. Errors map to a string; device-loss
/// errors reset the cached engine so the next attempt recreates it.
pub fn apply_effect_on_gpu(
    workers: &GpuWorkers,
    request: &varve_effects::EffectRequest,
    rgba: &[u8],
) -> Result<Vec<u8>, String> {
    if !varve_accel::effects::gpu_effect_supported(request.effect) {
        return Err(format!(
            "No native GPU kernel for {:?}; use the CPU path",
            request.effect
        ));
    }
    workers
        .engine
        .apply(request, rgba)
        .map(|(bytes, _)| bytes)
        .map_err(|err| {
            if matches!(err, AccelError::DeviceLost(_)) {
                workers.state.reset();
            }
            err.to_string()
        })
}

/// Resample RGBA bytes on the GPU for the non-AI upscale methods.
#[allow(clippy::too_many_arguments)]
pub fn resample_on_gpu(
    workers: &GpuWorkers,
    rgba: &[u8],
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
    method: &str,
) -> Result<Vec<u8>, String> {
    workers
        .engine
        .resample(
            rgba,
            src_width,
            src_height,
            dst_width,
            dst_height,
            varve_accel::effects::GpuResampleFilter::from_method(method),
        )
        .map(|(bytes, _)| bytes)
        .map_err(|err| {
            if matches!(err, AccelError::DeviceLost(_)) {
                workers.state.reset();
            }
            err.to_string()
        })
}

fn provider(
    id: &str,
    label: &str,
    device_kind: DeviceKind,
    detail: &str,
) -> InferenceProviderStatus {
    InferenceProviderStatus {
        id: id.to_string(),
        label: label.to_string(),
        device_kind,
        stage: AccelStage::Unavailable,
        reason: Some(UnavailableReason::ArtifactMissing),
        detail: Some(detail.to_string()),
    }
}

/// Inference providers, reported from the shipped runtime rather than from
/// compiled features. The staged ORT artifact is a CPU-only build; every
/// accelerated provider stays `unavailable(artifactMissing)` until a
/// provider library actually ships and initializes.
fn inference_capabilities() -> InferenceCapabilities {
    #[cfg(feature = "ai")]
    let runtime_loaded = varve_bgremove::runtime::native_ai_ready();
    #[cfg(not(feature = "ai"))]
    let runtime_loaded = false;

    let cpu_stage = if runtime_loaded {
        AccelStage::RuntimeLoadable
    } else {
        AccelStage::Discovered
    };
    let mut caps = InferenceCapabilities::baseline();
    caps.runtime_loaded = runtime_loaded;
    caps.providers = vec![
        InferenceProviderStatus {
            id: "cpu".into(),
            label: "CPU".into(),
            device_kind: DeviceKind::Cpu,
            stage: cpu_stage,
            reason: None,
            detail: Some("ONNX Runtime CPU execution provider (bundled)".into()),
        },
        provider(
            "cuda",
            "CUDA (NVIDIA)",
            DeviceKind::Gpu,
            "Requires a CUDA-enabled ONNX Runtime build and NVIDIA driver; not present in the shipped CPU runtime",
        ),
        provider(
            "tensorrt",
            "TensorRT (NVIDIA)",
            DeviceKind::Gpu,
            "Requires a TensorRT-enabled ONNX Runtime build; not present in the shipped CPU runtime",
        ),
        provider(
            "openvino",
            "OpenVINO (Intel)",
            DeviceKind::Gpu,
            "Externally provided OpenVINO runtime required; not bundled",
        ),
        provider(
            "migraphx",
            "MIGraphX (AMD ROCm)",
            DeviceKind::Gpu,
            "Requires ROCm userspace and a supported AMD GPU; ROCm does not support this class of integrated GPU",
        ),
        provider(
            "directml",
            "DirectML (Windows)",
            DeviceKind::Gpu,
            "Windows-only ONNX Runtime build required; not bundled",
        ),
        provider(
            "qnn",
            "QNN (Qualcomm NPU)",
            DeviceKind::Npu,
            "Requires Snapdragon X hardware, QNN runtime, and ARM64 artifacts; not bundled",
        ),
        provider(
            "vitisai",
            "Vitis AI (AMD XDNA NPU)",
            DeviceKind::Npu,
            "Requires Ryzen AI XDNA hardware, XRT plus amdxdna driver/firmware, and a Vitis-enabled ONNX Runtime; not bundled",
        ),
        provider(
            "coreml",
            "Core ML (Apple)",
            DeviceKind::Npu,
            "Requires a Core ML-enabled ONNX Runtime build; compute-unit policy is separate from observed placement",
        ),
        provider(
            "webgpu",
            "WebGPU plugin EP",
            DeviceKind::Gpu,
            "Native plugin execution provider (onnxruntime_providers_webgpu) is a candidate for a future milestone; not bundled or registered today",
        ),
    ];
    caps
}
