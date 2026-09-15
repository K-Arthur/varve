//! Native acceleration capability model.
//!
//! The same stage vocabulary is used for compute and inference so the UI and
//! diagnostics can distinguish "the driver is missing" from "the device was
//! discovered but the runtime cannot load it" from "execution was observed".
//! Nothing in this module performs I/O; discovery lives in [`crate::discovery`]
//! and [`crate::effects`].

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Version of the serialized report contract shared with the frontend.
pub const REPORT_SCHEMA_VERSION: u32 = 1;

/// What a device can be used for. Compute (shaders/effects) and inference
/// (ONNX graphs) are separate capabilities even when they share silicon.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceKind {
    Cpu,
    Gpu,
    Npu,
}

/// Explicit lifecycle stages for a candidate accelerator. A boolean cannot
/// distinguish these, and provider registration alone is not execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccelStage {
    /// Not probed yet.
    Unknown,
    /// Present in the OS/driver view, not yet exercised.
    Discovered,
    /// The runtime/library that drives it can be loaded.
    RuntimeLoadable,
    /// A logical device (and queue) could actually be created.
    DeviceUsable,
    /// A real workload executed and its output was verified.
    ExecutionVerified,
    /// Not available; `reason` says why and names the missing component.
    Unavailable,
}

impl AccelStage {
    /// True once a device exists and can be submitted work.
    pub fn is_usable(self) -> bool {
        matches!(
            self,
            AccelStage::DeviceUsable | AccelStage::ExecutionVerified
        )
    }
}

/// Why a candidate accelerator is not usable. Deliberately finer-grained than
/// a boolean: the fallback explanation shown to users must name the exact
/// missing component (driver, runtime library, artifact, permission).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UnavailableReason {
    /// No such device class on this machine.
    NotPresent,
    /// Device node or PCI function exists but the kernel driver is absent.
    DriverMissing,
    /// Driver present, but the userspace runtime (ORT/EP/vendor stack) is not.
    RuntimeMissing,
    /// Runtime present, but the provider/plugin artifact needed is not.
    ArtifactMissing,
    /// The OS denied access (permissions, sandbox, container boundary).
    PermissionDenied,
    /// Only a software/emulated implementation was found; not hardware.
    SoftwareOnly,
    /// Platform combination is explicitly unsupported by the provider.
    UnsupportedPlatform,
    /// The model or kernel needs operators the provider cannot run.
    UnsupportedOperator,
    /// Device/runtime initialization failed (driver crash, allocator, etc.).
    InitFailed,
    /// Probing exceeded its bounded time budget.
    Timeout,
    /// Previously usable device was lost (reset, unplug, driver reload).
    DeviceLost,
    /// The user disabled this accelerator.
    UserDisabled,
    /// Failure cause could not be determined.
    Unknown,
}

/// One candidate device with its observed stage and provenance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceleratorDevice {
    /// Stable-for-session identifier (backend + device identity), never a
    /// persisted adapter index.
    pub id: String,
    pub kind: DeviceKind,
    pub name: String,
    pub vendor: String,
    /// Graphics/compute backend: `vulkan`, `metal`, `dx12`, `cpu`, …
    pub backend: String,
    pub driver: Option<String>,
    /// `discreteGpu`, `integratedGpu`, `virtualGpu`, `cpu`, `unknown`.
    pub device_type: String,
    /// True when the device reports itself as a software implementation.
    pub software: bool,
    pub stage: AccelStage,
    pub reason: Option<UnavailableReason>,
    pub detail: Option<String>,
    /// Selected device limits relevant to tiling/admission, when known.
    pub limits: BTreeMap<String, u64>,
}

impl AcceleratorDevice {
    pub fn unavailable(
        id: impl Into<String>,
        name: impl Into<String>,
        reason: UnavailableReason,
    ) -> Self {
        Self {
            id: id.into(),
            kind: DeviceKind::Cpu,
            name: name.into(),
            vendor: String::new(),
            backend: String::new(),
            driver: None,
            device_type: "unknown".into(),
            software: false,
            stage: AccelStage::Unavailable,
            reason: Some(reason),
            detail: None,
            limits: BTreeMap::new(),
        }
    }
}

/// Compute-device view (effects, resampling). Presentation is a webview
/// concern and is intentionally not represented here.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeCapabilities {
    /// True when at least one hardware device is usable for compute.
    pub available: bool,
    /// `id` of the chosen device, when one is usable.
    pub selected_id: Option<String>,
    pub devices: Vec<AcceleratorDevice>,
}

impl ComputeCapabilities {
    pub fn selected(&self) -> Option<&AcceleratorDevice> {
        let id = self.selected_id.as_deref()?;
        self.devices.iter().find(|d| d.id == id)
    }
}

/// Host CPU facts used for provider policy and to explain the baseline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuCapabilities {
    pub architecture: String,
    pub logical_cores: usize,
    /// Sorted feature names, e.g. `avx2`, `avx512f`, `vnni`, `neon`.
    pub features: Vec<String>,
}

/// Runtime-verified status of one inference provider. `observed` stays false
/// unless placement was actually inspected; registration is not placement.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferenceProviderStatus {
    pub id: String,
    pub label: String,
    pub device_kind: DeviceKind,
    pub stage: AccelStage,
    pub reason: Option<UnavailableReason>,
    /// Human-readable provenance, e.g. the runtime version or artifact path.
    pub detail: Option<String>,
}

/// Inference view: what the loaded ONNX Runtime can actually offer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferenceCapabilities {
    /// Runtime shared library was loaded and initialized.
    pub runtime_loaded: bool,
    pub runtime_version: Option<String>,
    pub library: Option<String>,
    pub providers: Vec<InferenceProviderStatus>,
}

impl InferenceCapabilities {
    /// CPU is always a truthful baseline: ORT ships a CPU EP or fails to run.
    pub fn baseline() -> Self {
        Self {
            runtime_loaded: false,
            runtime_version: None,
            library: None,
            providers: vec![InferenceProviderStatus {
                id: "cpu".into(),
                label: "CPU".into(),
                device_kind: DeviceKind::Cpu,
                stage: AccelStage::Discovered,
                reason: None,
                detail: None,
            }],
        }
    }
}

/// Full native acceleration report returned to the frontend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAccelerationReport {
    pub schema_version: u32,
    /// Unix milliseconds; lets the UI discard stale probes.
    pub generated_at_ms: u64,
    pub host_os: String,
    pub host_arch: String,
    pub cpu: CpuCapabilities,
    pub compute: ComputeCapabilities,
    pub inference: InferenceCapabilities,
}

/// What a workload asked for. `Auto` means "prefer hardware when the
/// capability model says it is genuinely usable, otherwise CPU".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestedBackend {
    #[default]
    Auto,
    Cpu,
    Gpu,
}

/// What actually produced the result. Reported by the native command so the
/// UI never has to infer it from a requested preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EffectiveBackend {
    Cpu,
    Gpu,
}

/// CPU feature detection for the host architecture.
pub fn cpu_capabilities() -> CpuCapabilities {
    let architecture = std::env::consts::ARCH.to_string();
    let logical_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    let mut features = Vec::new();

    #[cfg(any(target_arch = "x86_64", target_arch = "x86"))]
    {
        if std::arch::is_x86_feature_detected!("sse4.2") {
            features.push("sse4.2");
        }
        if std::arch::is_x86_feature_detected!("avx") {
            features.push("avx");
        }
        if std::arch::is_x86_feature_detected!("avx2") {
            features.push("avx2");
        }
        if std::arch::is_x86_feature_detected!("fma") {
            features.push("fma");
        }
        if std::arch::is_x86_feature_detected!("avx512f") {
            features.push("avx512f");
        }
        if std::arch::is_x86_feature_detected!("avx512vnni") {
            features.push("avx512vnni");
        }
        if std::arch::is_x86_feature_detected!("avxvnni") {
            features.push("avxvnni");
        }
    }

    #[cfg(target_arch = "aarch64")]
    {
        if std::arch::is_aarch64_feature_detected!("neon") {
            features.push("neon");
        }
        if std::arch::is_aarch64_feature_detected!("dotprod") {
            features.push("dotprod");
        }
        if std::arch::is_aarch64_feature_detected!("i8mm") {
            features.push("i8mm");
        }
    }

    CpuCapabilities {
        architecture,
        logical_cores,
        features: features.into_iter().map(str::to_string).collect(),
    }
}

/// Current time as Unix milliseconds, saturating at 0 before the epoch.
pub fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_usable_only_after_device_creation() {
        assert!(!AccelStage::Discovered.is_usable());
        assert!(!AccelStage::RuntimeLoadable.is_usable());
        assert!(AccelStage::DeviceUsable.is_usable());
        assert!(AccelStage::ExecutionVerified.is_usable());
        assert!(!AccelStage::Unavailable.is_usable());
    }

    #[test]
    fn cpu_report_always_has_positive_cores() {
        let cpu = cpu_capabilities();
        assert!(cpu.logical_cores >= 1);
        assert!(!cpu.architecture.is_empty());
    }

    #[test]
    fn baseline_inference_reports_cpu_as_discovered_not_verified() {
        let caps = InferenceCapabilities::baseline();
        assert_eq!(caps.providers.len(), 1);
        assert_eq!(caps.providers[0].stage, AccelStage::Discovered);
        assert!(!caps.runtime_loaded);
    }
}
