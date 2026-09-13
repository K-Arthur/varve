//! Native resource checks for local generative editing.
//!
//! The renderer cannot reliably observe available system memory, especially
//! on ChromeOS and embedded browser environments. The desktop command owns
//! the last preflight immediately before starting the helper so a low-memory
//! device receives a deterministic refusal instead of an avoidable OOM.

const BYTES_PER_MIB: u64 = 1024 * 1024;
const BYTES_PER_GIB: u64 = 1024 * BYTES_PER_MIB;
pub(crate) const NATIVE_DIFFUSION_MINIMUM_MEMORY_BYTES: u64 = 6 * BYTES_PER_GIB;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NativeResourceSnapshot {
    pub(crate) available_memory_bytes: Option<u64>,
    pub(crate) required_memory_bytes: u64,
    pub(crate) resource_tier: &'static str,
    pub(crate) execution_backend: &'static str,
    pub(crate) platform: &'static str,
    pub(crate) architecture: &'static str,
}

/// Parse Linux's stable MemAvailable field. ChromeOS's Linux desktop runtime
/// exposes the same procfs contract, so this also covers the native Linux
/// container without special-case ChromeOS detection.
fn parse_linux_available_memory(contents: &str) -> Option<u64> {
    contents.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        if fields.next()? != "MemAvailable:" {
            return None;
        }
        let kib = fields.next()?.parse::<u64>().ok()?;
        kib.checked_mul(1024)
    })
}

/// Read a cgroup memory value. cgroup v2 uses `max` for an unlimited limit;
/// treating that as absent lets the host's MemAvailable value remain the
/// authority. Very large v1 sentinel values are also treated as unlimited.
fn parse_cgroup_memory_value(contents: &str) -> Option<u64> {
    let value = contents.trim();
    if value == "max" {
        return None;
    }
    let bytes = value.parse::<u64>().ok()?;
    (bytes < (1 << 60)).then_some(bytes)
}

fn cgroup_available_memory(limit: &str, current: &str) -> Option<u64> {
    let limit = parse_cgroup_memory_value(limit)?;
    let current = parse_cgroup_memory_value(current)?;
    // A transient usage value above the limit is pressure, not evidence that
    // the host budget is usable. Keep the refusal conservative in that case.
    Some(limit.saturating_sub(current))
}

#[cfg(target_os = "linux")]
fn available_memory_bytes_impl() -> Option<u64> {
    let host_available = std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|contents| parse_linux_available_memory(&contents));

    // Crostini and other sandboxed Linux environments may expose the host's
    // MemAvailable while enforcing a smaller memory.max for the app. The
    // effective budget is the lower of the host value and the current cgroup
    // allowance. Try cgroup v2 first, then the legacy v1 mount.
    let cgroup_available = [
        ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"),
        (
            "/sys/fs/cgroup/memory/memory.limit_in_bytes",
            "/sys/fs/cgroup/memory/memory.usage_in_bytes",
        ),
    ]
    .into_iter()
    .find_map(|(limit_path, current_path)| {
        let limit = std::fs::read_to_string(limit_path).ok()?;
        let current = std::fs::read_to_string(current_path).ok()?;
        cgroup_available_memory(&limit, &current)
    });

    match (host_available, cgroup_available) {
        (Some(host), Some(cgroup)) => Some(host.min(cgroup)),
        (Some(host), None) => Some(host),
        (None, Some(cgroup)) => Some(cgroup),
        (None, None) => None,
    }
}

#[cfg(target_os = "windows")]
fn available_memory_bytes_impl() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    // SAFETY: Windows initializes the caller-owned structure when the size
    // field is set as required by GlobalMemoryStatusEx.
    let success = unsafe { GlobalMemoryStatusEx(&mut status) };
    (success != 0).then_some(status.ullAvailPhys)
}

#[cfg(target_os = "macos")]
fn available_memory_bytes_impl() -> Option<u64> {
    let mut statistics = std::mem::MaybeUninit::<libc::vm_statistics64>::zeroed();
    let mut count = libc::HOST_VM_INFO64_COUNT;
    // SAFETY: `statistics` is writable storage of the exact structure used by
    // HOST_VM_INFO64, and `count` is initialized to its element count.
    let result = unsafe {
        libc::host_statistics64(
            libc::mach_host_self(),
            libc::HOST_VM_INFO64,
            statistics.as_mut_ptr().cast(),
            &mut count,
        )
    };
    if result != 0 {
        return None;
    }
    // SAFETY: host_statistics64 returned success and initialized the output.
    let statistics = unsafe { statistics.assume_init() };
    let available_pages = u64::from(statistics.free_count)
        .checked_add(u64::from(statistics.inactive_count))?
        .checked_add(u64::from(statistics.speculative_count))?;
    let page_size = unsafe { u64::from(libc::vm_page_size) };
    available_pages.checked_mul(page_size)
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn available_memory_bytes_impl() -> Option<u64> {
    None
}

pub(crate) fn available_memory_bytes() -> Option<u64> {
    available_memory_bytes_impl()
}

pub(crate) fn resource_tier(available_memory_bytes: Option<u64>) -> &'static str {
    match available_memory_bytes {
        Some(bytes) if bytes < 4 * BYTES_PER_GIB => "constrained",
        Some(bytes) if bytes < 8 * BYTES_PER_GIB => "standard",
        Some(_) => "high",
        None => "unknown",
    }
}

pub(crate) fn estimated_required_memory_bytes(width: u32, height: u32) -> Option<u64> {
    let pixels = u64::from(width).checked_mul(u64::from(height))?;
    if pixels == 0 {
        return None;
    }
    // The fixed model minimum is deliberately conservative. The frame term
    // prevents a future larger output from bypassing the check merely because
    // the model itself fits; six RGBA working buffers cover helper input,
    // latent staging, output, and conversion copies.
    let frame_working_bytes = pixels.checked_mul(4)?.checked_mul(6)?;
    NATIVE_DIFFUSION_MINIMUM_MEMORY_BYTES.checked_add(frame_working_bytes)
}

/// Estimate the reservation for a native ONNX model whose measured peak RSS
/// is already known. The model peak covers the model graph and its fixed-size
/// inference tensors; the command still has to retain the source image and
/// one or more conversion/output buffers. Three RGBA source-sized buffers are
/// a deliberately conservative allowance for that command-side lifetime.
pub(crate) fn estimated_required_memory_bytes_for_model(
    width: u32,
    height: u32,
    measured_peak_memory_bytes: u64,
) -> Option<u64> {
    let pixels = u64::from(width).checked_mul(u64::from(height))?;
    if pixels == 0 {
        return None;
    }
    let source_working_bytes = pixels.checked_mul(4)?.checked_mul(3)?;
    measured_peak_memory_bytes.checked_add(source_working_bytes)
}

fn snapshot_with_requirement(required_memory_bytes: u64) -> NativeResourceSnapshot {
    let available_memory_bytes = available_memory_bytes();
    NativeResourceSnapshot {
        available_memory_bytes,
        required_memory_bytes,
        resource_tier: resource_tier(available_memory_bytes),
        execution_backend: "native-cpu",
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
    }
}

fn memory_shortage_error(
    operation: &str,
    required_memory_bytes: u64,
    available_memory_bytes: u64,
    architecture: &str,
) -> Option<String> {
    if available_memory_bytes >= required_memory_bytes {
        return None;
    }
    let available_mib = (available_memory_bytes / BYTES_PER_MIB).max(1);
    let required_mib = required_memory_bytes.div_ceil(BYTES_PER_MIB);
    Some(format!(
        "{operation} needs about {required_mib} MiB, but only {available_mib} MiB is currently available on this {architecture} device. Close other memory-heavy apps or use Quick Cleanup, which does not load a model."
    ))
}

/// Perform the native-side check for a model-backed ONNX operation. This is
/// intentionally separate from the diffusion check because segmentation and
/// inpainting have measured footprints that are materially smaller (or, for
/// BiRefNet, larger) than the six-GiB diffusion floor.
pub(crate) fn preflight_model(
    operation: &str,
    width: u32,
    height: u32,
    measured_peak_memory_bytes: u64,
) -> Result<NativeResourceSnapshot, String> {
    let required_memory_bytes =
        estimated_required_memory_bytes_for_model(width, height, measured_peak_memory_bytes)
            .ok_or_else(|| format!("{operation} source dimensions are empty or overflowed"))?;
    let snapshot = snapshot_with_requirement(required_memory_bytes);
    if let Some(available) = snapshot.available_memory_bytes {
        if let Some(error) = memory_shortage_error(
            operation,
            snapshot.required_memory_bytes,
            available,
            snapshot.architecture,
        ) {
            return Err(error);
        }
    }
    Ok(snapshot)
}

pub(crate) fn snapshot(width: u32, height: u32) -> NativeResourceSnapshot {
    let available_memory_bytes = available_memory_bytes();
    NativeResourceSnapshot {
        available_memory_bytes,
        required_memory_bytes: estimated_required_memory_bytes(width, height)
            .unwrap_or(NATIVE_DIFFUSION_MINIMUM_MEMORY_BYTES),
        resource_tier: resource_tier(available_memory_bytes),
        execution_backend: "native-cpu",
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
    }
}

pub(crate) fn preflight(width: u32, height: u32) -> Result<NativeResourceSnapshot, String> {
    let snapshot = snapshot(width, height);
    if let Some(available) = snapshot.available_memory_bytes {
        if let Some(error) = memory_shortage_error(
            "Local diffusion generation",
            snapshot.required_memory_bytes,
            available,
            snapshot.architecture,
        ) {
            return Err(error);
        }
    }
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::{
        cgroup_available_memory, estimated_required_memory_bytes,
        estimated_required_memory_bytes_for_model, memory_shortage_error,
        parse_cgroup_memory_value, parse_linux_available_memory, resource_tier, BYTES_PER_MIB,
    };

    const GIB: u64 = 1024 * 1024 * 1024;

    #[test]
    fn parses_linux_mem_available_without_confusing_total_memory() {
        let contents =
            "MemTotal:       8000000 kB\nMemFree:        1000000 kB\nMemAvailable:   3500000 kB\n";
        assert_eq!(
            parse_linux_available_memory(contents),
            Some(3_500_000 * 1024)
        );
    }

    #[test]
    fn uses_the_effective_crostini_cgroup_budget() {
        let host_available = 8 * GIB;
        let cgroup_available =
            cgroup_available_memory("2147483648\n", "536870912\n").expect("finite cgroup budget");
        assert_eq!(cgroup_available, 1536 * 1024 * 1024);
        assert_eq!(host_available.min(cgroup_available), cgroup_available);
    }

    #[test]
    fn ignores_unlimited_and_malformed_cgroup_limits() {
        assert_eq!(parse_cgroup_memory_value("max\n"), None);
        assert_eq!(parse_cgroup_memory_value("9223372036854771712\n"), None);
        assert_eq!(cgroup_available_memory("max", "1024"), None);
        assert_eq!(cgroup_available_memory("not-a-number", "1024"), None);
        assert_eq!(cgroup_available_memory("1024", "2048"), Some(0));
    }

    #[test]
    fn unknown_or_low_memory_is_classified_conservatively() {
        assert_eq!(resource_tier(None), "unknown");
        assert_eq!(resource_tier(Some(4 * GIB - 1)), "constrained");
        assert_eq!(resource_tier(Some(4 * GIB)), "standard");
        assert_eq!(resource_tier(Some(8 * GIB)), "high");
    }

    #[test]
    fn diffusion_requirement_is_nonzero_and_scales_for_large_frames() {
        let base = estimated_required_memory_bytes(512, 512).expect("valid dimensions");
        let large = estimated_required_memory_bytes(2048, 2048).expect("valid dimensions");
        assert!(base >= 6 * GIB);
        assert!(large > base);
        assert_eq!(estimated_required_memory_bytes(0, 512), None);
    }

    #[test]
    fn measured_model_peak_includes_bounded_source_buffers() {
        let base =
            estimated_required_memory_bytes_for_model(1, 1, 850_000_000).expect("valid dimensions");
        let large = estimated_required_memory_bytes_for_model(4096, 4096, 850_000_000)
            .expect("valid dimensions");
        assert!(base > 850_000_000);
        assert!(large > base);
        assert_eq!(estimated_required_memory_bytes_for_model(0, 1, 1), None);
    }

    #[test]
    fn memory_shortage_is_actionable_and_architecture_specific() {
        let error = memory_shortage_error(
            "Native background removal",
            850_000_000,
            512 * BYTES_PER_MIB,
            "aarch64",
        )
        .expect("insufficient memory should be refused");
        assert!(error.contains("Native background removal"));
        assert!(error.contains("aarch64"));
        assert!(error.contains("Quick Cleanup"));
        assert!(memory_shortage_error("operation", 1, 2, "x86_64").is_none());
    }
}
