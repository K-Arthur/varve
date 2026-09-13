//! Native GPU device discovery and device creation via wgpu.
//!
//! Discovery never consults `navigator.gpu` or the webview: a native GPU is
//! found through the OS graphics stack, which is why this module is separate
//! from the browser adapter logic in `packages/engine/src/gpuAdapter.ts`.
//! Software adapters (Lavapipe, SwiftShader, Basic Render Driver, …) are
//! discovered but never selected — a CPU rasterizer behind a GPU API is not
//! hardware acceleration.

use std::collections::BTreeMap;
use std::fmt;
use std::time::{Duration, Instant};

use crate::capability::{
    AccelStage, AcceleratorDevice, ComputeCapabilities, DeviceKind, UnavailableReason,
};

/// Markers shared with the browser adapter policy. Keep in sync with
/// `SOFTWARE_ADAPTER_MARKERS` in `packages/engine/src/gpuAdapter.ts`.
pub const SOFTWARE_ADAPTER_MARKERS: &[&str] = &[
    "swiftshader",
    "swift",
    "fallback",
    "software",
    "llvmpipe",
    "lavapipe",
    "basic render",
];

/// Upper bound on device creation + self-test work done during one probe.
pub const DEVICE_CREATE_TIMEOUT: Duration = Duration::from_secs(8);
/// Upper bound for a single synchronous result readback.
pub const READBACK_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub enum AccelError {
    Unavailable(UnavailableReason, String),
    DeviceLost(String),
    Execution(String),
}

impl AccelError {
    pub fn reason(&self) -> UnavailableReason {
        match self {
            AccelError::Unavailable(reason, _) => *reason,
            AccelError::DeviceLost(_) => UnavailableReason::DeviceLost,
            AccelError::Execution(_) => UnavailableReason::InitFailed,
        }
    }
}

impl fmt::Display for AccelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AccelError::Unavailable(_, detail) => write!(f, "{detail}"),
            AccelError::DeviceLost(detail) => write!(f, "GPU device lost: {detail}"),
            AccelError::Execution(detail) => write!(f, "GPU execution failed: {detail}"),
        }
    }
}

impl std::error::Error for AccelError {}

/// A usable native GPU device with its queue. Created on demand and held by
/// the application; dropped when device loss is observed.
pub struct GpuCompute {
    device: wgpu::Device,
    queue: wgpu::Queue,
    info: AcceleratorDevice,
    adapter_info: wgpu::AdapterInfo,
}

impl GpuCompute {
    /// Create a device on the best available hardware adapter. `preferred_id`
    /// selects a previously reported device id; otherwise the highest-scoring
    /// hardware adapter wins.
    pub fn create(preferred_id: Option<&str>) -> Result<Self, AccelError> {
        let instance = wgpu::Instance::default();
        let adapters = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all()));
        if adapters.is_empty() {
            return Err(AccelError::Unavailable(
                UnavailableReason::NotPresent,
                "No GPU adapter was reported by Vulkan, Metal, or D3D12".into(),
            ));
        }

        let mut ranked: Vec<(u8, &wgpu::Adapter, wgpu::AdapterInfo)> = adapters
            .iter()
            .map(|adapter| {
                let info = adapter.get_info();
                (adapter_score(&info), adapter, info)
            })
            .collect();
        ranked.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.2.name.cmp(&b.2.name)));

        let selected = ranked
            .iter()
            .find(|(score, _, info)| {
                *score > 0 && preferred_id.is_none_or(|id| device_id(info) == id)
            })
            .or_else(|| ranked.iter().find(|(score, _, _)| *score > 0));

        let (_, adapter, adapter_info) = selected.ok_or_else(|| {
            let software = ranked.iter().any(|(score, _, _)| *score <= 0);
            AccelError::Unavailable(
                if software {
                    UnavailableReason::SoftwareOnly
                } else {
                    UnavailableReason::NotPresent
                },
                "Only software or unsupported GPU adapters were reported".into(),
            )
        })?;

        let descriptor = wgpu::DeviceDescriptor {
            label: Some("varve-accel"),
            required_features: wgpu::Features::empty(),
            required_limits: adapter.limits(),
            memory_hints: wgpu::MemoryHints::Performance,
            ..Default::default()
        };
        let started = Instant::now();
        let (device, queue) =
            pollster::block_on(adapter.request_device(&descriptor)).map_err(|err| {
                AccelError::Unavailable(
                    UnavailableReason::InitFailed,
                    format!("GPU device creation failed: {err}"),
                )
            })?;
        if started.elapsed() > DEVICE_CREATE_TIMEOUT {
            return Err(AccelError::Unavailable(
                UnavailableReason::Timeout,
                "GPU device creation exceeded the bounded probe budget".into(),
            ));
        }

        let info = describe_adapter(&adapter_info, Some(adapter.limits()));
        Ok(Self {
            device,
            queue,
            info,
            adapter_info: adapter_info.clone(),
        })
    }

    pub fn device(&self) -> &wgpu::Device {
        &self.device
    }

    pub fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }

    pub fn info(&self) -> &AcceleratorDevice {
        &self.info
    }

    pub fn adapter_info(&self) -> &wgpu::AdapterInfo {
        &self.adapter_info
    }

    /// Bounded hardware self-test: dispatches a small compute shader and
    /// verifies the readback. This is what moves a device from
    /// `DeviceUsable` to `ExecutionVerified`.
    pub fn self_test(&self) -> Result<SelfTestReport, AccelError> {
        const ELEMENTS: u64 = 256;
        let shader = self
            .device
            .create_shader_module(wgpu::include_wgsl!("shaders/self_test.wgsl"));
        let layout = self
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("self-test-layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
        let pipeline = self
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("self-test"),
                layout: Some(&self.device.create_pipeline_layout(
                    &wgpu::PipelineLayoutDescriptor {
                        label: Some("self-test-pipeline-layout"),
                        bind_group_layouts: &[Some(&layout)],
                        immediate_size: 0,
                    },
                )),
                module: &shader,
                entry_point: Some("main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                cache: None,
            });
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("self-test-buffer"),
            size: ELEMENTS * 4,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let staging = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("self-test-staging"),
            size: ELEMENTS * 4,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("self-test-bind-group"),
            layout: &layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: buffer.as_entire_binding(),
            }],
        });

        let started = Instant::now();
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("self-test-encoder"),
            });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("self-test-pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(4, 1, 1);
        }
        encoder.copy_buffer_to_buffer(&buffer, 0, &staging, 0, ELEMENTS * 4);
        self.queue.submit(Some(encoder.finish()));

        let slice = staging.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        self.device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(READBACK_TIMEOUT),
            })
            .map_err(|err| AccelError::DeviceLost(format!("{err}")))?;
        rx.recv_timeout(READBACK_TIMEOUT)
            .map_err(|_| AccelError::Execution("self-test readback timed out".into()))?
            .map_err(|err| AccelError::Execution(format!("self-test map failed: {err}")))?;

        let mut mismatch = None;
        {
            let data = slice.get_mapped_range().map_err(|err| {
                AccelError::DeviceLost(format!("self-test map range failed: {err}"))
            })?;
            for (index, word) in data.chunks_exact(4).enumerate() {
                let value = u32::from_le_bytes([word[0], word[1], word[2], word[3]]);
                let expected = index as u32 * 3 + 7;
                if value != expected {
                    mismatch = Some((index, value, expected));
                    break;
                }
            }
        }
        staging.unmap();
        if let Some((index, value, expected)) = mismatch {
            return Err(AccelError::Execution(format!(
                "self-test mismatch at {index}: got {value}, expected {expected}"
            )));
        }

        Ok(SelfTestReport {
            device_id: self.info.id.clone(),
            device_name: self.info.name.clone(),
            backend: self.info.backend.clone(),
            elements_checked: ELEMENTS,
            duration_ms: started.elapsed().as_secs_f64() * 1000.0,
        })
    }
}

/// Result of the bounded hardware self-test.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfTestReport {
    pub device_id: String,
    pub device_name: String,
    pub backend: String,
    pub elements_checked: u64,
    pub duration_ms: f64,
}

/// Enumerate native GPU devices without creating one. This is the compute
/// side of the capability report.
pub fn discover_compute_devices() -> ComputeCapabilities {
    let instance = wgpu::Instance::default();
    let adapters = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all()));
    if adapters.is_empty() {
        return ComputeCapabilities {
            available: false,
            selected_id: None,
            devices: vec![AcceleratorDevice::unavailable(
                "compute:none",
                "No GPU adapter",
                UnavailableReason::NotPresent,
            )],
        };
    }

    let mut devices: Vec<AcceleratorDevice> = adapters
        .iter()
        .map(|adapter| {
            let info = adapter.get_info();
            let limits = adapter.limits();
            let mut device = describe_adapter(&info, Some(limits));
            let score = adapter_score(&info);
            if score <= 0 {
                device.stage = AccelStage::Unavailable;
                device.software = true;
                device.reason = Some(UnavailableReason::SoftwareOnly);
                device.detail = Some(format!(
                    "{} is a software rasterizer and is never selected for compute",
                    info.name
                ));
            }
            device
        })
        .collect();
    devices.sort_by(|a, b| {
        adapter_score_from_device(b)
            .cmp(&adapter_score_from_device(a))
            .then_with(|| a.name.cmp(&b.name))
    });

    let selected = devices
        .iter()
        .find(|device| device.stage != AccelStage::Unavailable);

    ComputeCapabilities {
        available: selected.is_some(),
        selected_id: selected.map(|device| device.id.clone()),
        devices,
    }
}

/// Score an adapter: discrete GPU > integrated > virtual > software/unknown.
pub fn adapter_score(info: &wgpu::AdapterInfo) -> u8 {
    adapter_score_fields(info.device_type, is_software_adapter(info))
}

fn adapter_score_fields(device_type: wgpu::DeviceType, software: bool) -> u8 {
    if software {
        return 0;
    }
    match device_type {
        wgpu::DeviceType::DiscreteGpu => 3,
        wgpu::DeviceType::IntegratedGpu => 2,
        wgpu::DeviceType::VirtualGpu => 1,
        wgpu::DeviceType::Other => 1,
        wgpu::DeviceType::Cpu => 0,
    }
}

fn adapter_score_from_device(device: &AcceleratorDevice) -> u8 {
    if device.software || device.stage == AccelStage::Unavailable {
        return 0;
    }
    match device.device_type.as_str() {
        "discreteGpu" => 3,
        "integratedGpu" => 2,
        "virtualGpu" => 1,
        _ => 1,
    }
}

/// Software detection matching the browser policy plus the Windows Basic
/// Render Driver. A substring match is a heuristic, not a guarantee.
pub fn is_software_adapter(info: &wgpu::AdapterInfo) -> bool {
    is_software_fields(
        &info.name,
        &info.driver,
        &info.driver_info,
        info.device_type,
    )
}

fn is_software_fields(
    name: &str,
    driver: &str,
    driver_info: &str,
    device_type: wgpu::DeviceType,
) -> bool {
    if matches!(device_type, wgpu::DeviceType::Cpu) {
        return true;
    }
    let haystack = format!("{name} {driver} {driver_info}").to_lowercase();
    SOFTWARE_ADAPTER_MARKERS
        .iter()
        .any(|marker| haystack.contains(marker))
}

/// Stable device identity string. Built from adapter facts, never from an
/// adapter index that can change across driver updates or hotplug.
pub fn device_id(info: &wgpu::AdapterInfo) -> String {
    device_id_fields(info.backend, info.vendor, info.device, &info.name)
}

fn device_id_fields(backend: wgpu::Backend, vendor: u32, device: u32, name: &str) -> String {
    let vendor = if vendor == 0 {
        "unknown".to_string()
    } else {
        format!("{vendor:04x}")
    };
    let device = if device == 0 {
        "unknown".to_string()
    } else {
        format!("{device:04x}")
    };
    format!("{}:{vendor}:{device}:{}", backend_name(backend), slug(name))
}

fn backend_name(backend: wgpu::Backend) -> &'static str {
    match backend {
        wgpu::Backend::Vulkan => "vulkan",
        wgpu::Backend::Metal => "metal",
        wgpu::Backend::Dx12 => "dx12",
        wgpu::Backend::Gl => "gles",
        wgpu::Backend::BrowserWebGpu => "webgpu",
        wgpu::Backend::Noop => "noop",
    }
}

fn device_type_name(device_type: wgpu::DeviceType) -> &'static str {
    match device_type {
        wgpu::DeviceType::DiscreteGpu => "discreteGpu",
        wgpu::DeviceType::IntegratedGpu => "integratedGpu",
        wgpu::DeviceType::VirtualGpu => "virtualGpu",
        wgpu::DeviceType::Cpu => "cpu",
        wgpu::DeviceType::Other => "unknown",
    }
}

fn slug(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn describe_adapter(info: &wgpu::AdapterInfo, limits: Option<wgpu::Limits>) -> AcceleratorDevice {
    let mut limit_map = BTreeMap::new();
    if let Some(limits) = limits {
        limit_map.insert(
            "maxTextureDimension2d".into(),
            u64::from(limits.max_texture_dimension_2d),
        );
        limit_map.insert(
            "maxStorageBufferBindingSize".into(),
            limits.max_storage_buffer_binding_size,
        );
        limit_map.insert("maxBufferSize".into(), limits.max_buffer_size);
        limit_map.insert(
            "maxComputeWorkgroupSizeX".into(),
            u64::from(limits.max_compute_workgroup_size_x),
        );
        limit_map.insert(
            "maxComputeInvocationsPerWorkgroup".into(),
            u64::from(limits.max_compute_invocations_per_workgroup),
        );
    }
    AcceleratorDevice {
        id: device_id(info),
        kind: DeviceKind::Gpu,
        name: info.name.clone(),
        vendor: format!("{:04x}", info.vendor),
        backend: backend_name(info.backend).to_string(),
        driver: if info.driver.is_empty() {
            None
        } else {
            Some(info.driver.clone())
        },
        device_type: device_type_name(info.device_type).to_string(),
        software: is_software_adapter(info),
        stage: AccelStage::Discovered,
        reason: None,
        detail: if info.driver_info.is_empty() {
            None
        } else {
            Some(info.driver_info.clone())
        },
        limits: limit_map,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capability::AccelStage;

    #[test]
    fn software_adapters_are_never_selected() {
        assert!(is_software_fields(
            "llvmpipe (LLVM 18)",
            "llvmpipe",
            "",
            wgpu::DeviceType::Cpu
        ));
        assert_eq!(adapter_score_fields(wgpu::DeviceType::Cpu, true), 0);
        assert!(is_software_fields(
            "Google SwiftShader",
            "SwiftShader",
            "",
            wgpu::DeviceType::Cpu
        ));
        // A hardware iGPU with a normal driver is not software.
        assert!(!is_software_fields(
            "AMD Radeon Graphics (RADV RENOIR)",
            "radv",
            "Mesa 26.2.2",
            wgpu::DeviceType::IntegratedGpu
        ));
    }

    #[test]
    fn hardware_adapters_rank_discrete_first() {
        let igpu = adapter_score_fields(wgpu::DeviceType::IntegratedGpu, false);
        let dgpu = adapter_score_fields(wgpu::DeviceType::DiscreteGpu, false);
        assert!(dgpu > igpu);
        assert!(igpu > 0);
    }

    #[test]
    fn device_ids_are_descriptive_and_stable() {
        let id = device_id_fields(
            wgpu::Backend::Vulkan,
            0x1002,
            0x164c,
            "AMD Radeon Graphics (RADV RENOIR)",
        );
        assert!(id.starts_with("vulkan:1002:164c:"));
        assert!(id.contains("radv-renoir"));
    }

    #[test]
    fn discovery_returns_a_report_even_without_adapters() {
        let caps = discover_compute_devices();
        if caps.available {
            assert!(caps.selected_id.is_some());
            let selected = caps.selected().expect("selected device");
            assert_ne!(selected.stage, AccelStage::Unavailable);
            assert!(!selected.software);
        } else {
            assert!(caps.selected_id.is_none());
            assert!(!caps.devices.is_empty());
        }
    }
}
