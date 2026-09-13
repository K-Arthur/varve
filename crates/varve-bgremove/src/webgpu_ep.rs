//! Native WebGPU plugin execution provider (`ai` feature only).
//!
//! ONNX Runtime ships the native WebGPU EP as a **plugin**: a shared library
//! registered at runtime alongside the core runtime
//! (`onnxruntime_providers_webgpu`), built on Dawn (Vulkan on Linux, D3D12 on
//! Windows, Metal on macOS). It is cross-vendor and requires no vendor SDK.
//!
//! Registration is explicit and honest:
//! - the plugin library must be staged next to `libonnxruntime` (see
//!   `scripts/fetch-onnxruntime.mjs`);
//! - `Environment::register_ep_library` must succeed against the *loaded*
//!   core runtime (the pinned 1.27.1 build exposes the plugin-EP API);
//! - a `WebGpuExecutionProvider` device must actually be reported;
//! - sessions are created with `SessionBuilder::with_devices`, and
//!   `session.execution_provider()` distinguishes GPU from CPU sessions.
//!
//! A failed registration never fails the app: the policy falls back to the
//! CPU provider, and the user-visible status names the missing component.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

use ort::environment::Environment;
use ort::ep::ExecutionProviderLibrary;
use ort::session::builder::SessionBuilder;

/// Execution provider policy for native inference sessions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InferenceProviderPolicy {
    /// Prefer the WebGPU EP when it is registered and a device exists,
    /// otherwise CPU. Never fails a request because of a missing accelerator.
    Auto,
    /// Always use the CPU execution provider.
    Cpu,
    /// Require the WebGPU EP; fail session creation when unavailable.
    /// Explicit advanced choice, not a default.
    Gpu,
}

impl InferenceProviderPolicy {
    fn code(self) -> u8 {
        match self {
            Self::Auto => 0,
            Self::Cpu => 1,
            Self::Gpu => 2,
        }
    }

    fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Cpu,
            2 => Self::Gpu,
            _ => Self::Auto,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Cpu => "cpu",
            Self::Gpu => "gpu",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value.to_ascii_lowercase().as_str() {
            "cpu" => Self::Cpu,
            "gpu" | "webgpu" => Self::Gpu,
            _ => Self::Auto,
        }
    }
}

static POLICY: AtomicU8 = AtomicU8::new(0);

pub fn set_inference_provider_policy(policy: InferenceProviderPolicy) {
    POLICY.store(policy.code(), Ordering::SeqCst);
}

pub fn inference_provider_policy() -> InferenceProviderPolicy {
    InferenceProviderPolicy::from_code(POLICY.load(Ordering::SeqCst))
}

/// Identity of the registered WebGPU execution provider device.
#[derive(Debug, Clone, PartialEq)]
pub struct WebGpuEpDevice {
    pub vendor: Option<String>,
    pub device_id: u32,
    pub device_type: String,
}

/// Registration outcome, reported to the capability UI.
#[derive(Debug, Clone, PartialEq)]
pub enum WebGpuEpStatus {
    /// `register` was never called (native runtime not initialized yet).
    NotAttempted,
    /// Registered and a WebGPU device is available.
    Registered(WebGpuEpDevice),
    /// Registration failed; the string names the missing component.
    Failed(String),
}

static REGISTRATION: OnceLock<Result<WebGpuEpDevice, String>> = OnceLock::new();
static LIBRARY: Mutex<Option<ExecutionProviderLibrary>> = Mutex::new(None);
static DEVICE_USABLE: AtomicBool = AtomicBool::new(false);
static EXECUTION_VERIFIED: AtomicBool = AtomicBool::new(false);
static LAST_ATTACH_ERROR: Mutex<Option<String>> = Mutex::new(None);
static LAST_RUN_PROVIDER: Mutex<&'static str> = Mutex::new("native-cpu");

/// Register the plugin library exactly once. Idempotent: later calls return
/// the first outcome. Safe to call when the file is absent (returns Err and
/// the CPU path stays untouched).
pub fn register(plugin_path: &Path) -> Result<(), String> {
    let outcome = REGISTRATION.get_or_init(|| init(plugin_path));
    outcome.as_ref().map(|_| ()).map_err(|err| err.clone())
}

fn init(plugin_path: &Path) -> Result<WebGpuEpDevice, String> {
    if !plugin_path.exists() {
        return Err(format!(
            "WebGPU plugin library not staged at {}",
            plugin_path.display()
        ));
    }
    let environment = Environment::current()
        .map_err(|err| format!("ONNX Runtime environment unavailable: {err}"))?;
    // ORT resolves a plugin library path relative to the core runtime's own
    // directory, so an absolute path is required.
    let canonical = std::fs::canonicalize(plugin_path)
        .map_err(|err| format!("Cannot resolve WebGPU plugin path: {err}"))?;
    let library = environment
        .register_ep_library("webgpu_ep_registration", &canonical)
        .map_err(|err| format!("Failed to register WebGPU plugin EP: {err}"))?;

    let mut device = None;
    for entry in environment.devices() {
        if !entry
            .ep()
            .map(|ep| ep == "WebGpuExecutionProvider")
            .unwrap_or(false)
        {
            continue;
        }
        let hardware = entry.hardware_device();
        device = Some(WebGpuEpDevice {
            vendor: hardware
                .vendor()
                .ok()
                .map(str::to_string)
                .filter(|vendor| !vendor.is_empty()),
            device_id: hardware.id(),
            device_type: format!("{:?}", hardware.ty()),
        });
        break;
    }
    let device = device.ok_or_else(|| {
        "WebGPU plugin registered but no WebGpuExecutionProvider device was reported".to_string()
    })?;

    if let Ok(mut guard) = LIBRARY.lock() {
        *guard = Some(library);
    }
    DEVICE_USABLE.store(true, Ordering::SeqCst);
    Ok(device)
}

pub fn status() -> WebGpuEpStatus {
    match REGISTRATION.get() {
        None => WebGpuEpStatus::NotAttempted,
        Some(Ok(device)) => WebGpuEpStatus::Registered(device.clone()),
        Some(Err(err)) => WebGpuEpStatus::Failed(err.clone()),
    }
}

pub fn device_usable() -> bool {
    DEVICE_USABLE.load(Ordering::SeqCst)
}

/// True once a WebGPU-backed session produced an inference result.
pub fn execution_verified() -> bool {
    EXECUTION_VERIFIED.load(Ordering::SeqCst)
}

/// Record that a session ran successfully and which provider produced the
/// result. Inference runs are serialized by the session pool (max concurrency
/// 1), so the immediately following result construction can read this safely.
pub fn note_run(provider: &'static str) {
    if provider == "native-webgpu" {
        EXECUTION_VERIFIED.store(true, Ordering::SeqCst);
    }
    if let Ok(mut guard) = LAST_RUN_PROVIDER.lock() {
        *guard = provider;
    }
}

/// Provider that produced the most recent inference result.
pub fn last_run_provider() -> &'static str {
    LAST_RUN_PROVIDER
        .lock()
        .map(|guard| *guard)
        .unwrap_or("native-cpu")
}

pub fn note_attach_failure(error: &str) {
    if let Ok(mut guard) = LAST_ATTACH_ERROR.lock() {
        *guard = Some(error.to_string());
    }
}

pub fn last_attach_error() -> Option<String> {
    LAST_ATTACH_ERROR
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

/// Attach the WebGPU EP to a session builder. Errors when no device is
/// available or attachment fails, so the caller can fall back to CPU.
pub fn attach_webgpu(builder: SessionBuilder) -> Result<SessionBuilder, String> {
    if !device_usable() {
        return Err("WebGPU execution provider is not registered".to_string());
    }
    let environment = Environment::current()
        .map_err(|err| format!("ONNX Runtime environment unavailable: {err}"))?;
    let devices: Vec<_> = environment
        .devices()
        .filter(|entry| {
            entry
                .ep()
                .map(|ep| ep == "WebGpuExecutionProvider")
                .unwrap_or(false)
        })
        .collect();
    if devices.is_empty() {
        return Err("No WebGPU execution provider device is available".to_string());
    }
    // Bucketed buffer caching is the recommended mode for repeated inference
    // with stable shapes; NHWC is the WebGPU EP's preferred layout. Keys are
    // prefixed with the EP name because `with_devices` filters options by
    // device group.
    let options = [
        (
            "WebGpuExecutionProvider.preferredLayout".to_string(),
            "NHWC".to_string(),
        ),
        (
            "WebGpuExecutionProvider.defaultBufferCacheMode".to_string(),
            "bucket".to_string(),
        ),
    ];
    builder
        .with_devices(devices, Some(&options))
        .map_err(|err| format!("Failed to attach WebGPU execution provider: {err}"))
}
