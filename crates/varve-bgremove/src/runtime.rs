//! Native ONNX Runtime environment initialization (`ai` feature only).
//!
//! `ort`'s `load-dynamic` build doesn't link `libonnxruntime` at compile
//! time — it `dlopen`s it the first time a `Session` is created, either
//! from the `ORT_DYLIB_PATH` env var or an explicit path passed to
//! `ort::init_from`. Neither requires the host to have onnxruntime
//! installed system-wide (verified absent via `pacman -Q onnxruntime`
//! during the 2026-07-18 WASM memory hardening audit — see
//! docs/audits/background-removal-wasm-memory-hardening-2026-07-18.md).
//!
//! `has_ai()` in lib.rs only reflects whether the Cargo feature was
//! compiled in — it says nothing about whether the dylib actually loaded.
//! A default-on feature with a missing or incompatible dylib must not be
//! reported as "available" to the frontend, or the provider chain would
//! keep routing `ai-quality` at a native path that fails every time.
//! `native_ai_ready()` reports the real, attempted-and-verified outcome.

use std::path::Path;
use std::sync::OnceLock;

static NATIVE_AI_READY: OnceLock<bool> = OnceLock::new();

/// Attempt to initialize the ONNX Runtime environment from an explicit
/// dylib path (e.g. a bundled Tauri resource). Must be called before the
/// first `Session` is created anywhere in the process — `ort::init_from`
/// only takes effect if no environment has been committed yet.
///
/// Callers must not invoke this from a Tauri `setup()` hook or anywhere
/// else that runs before the webview has finished initializing. Loading a
/// native dylib (which may spawn its own thread pool or install its own
/// signal handlers — onnxruntime does both) at that point races WebKitGTK's
/// own process/thread startup; call it lazily instead, from a command
/// handler invoked by already-running frontend JS (see `native_ai_status`
/// in apps/desktop/src-tauri/src/lib.rs), so the dylib load can only ever
/// happen strictly after the webview is already up.
///
/// Idempotent: only the first call's outcome is recorded, and later calls
/// return that cached outcome instead of re-attempting the dlopen. Safe to
/// call with a path that doesn't exist or isn't a valid onnxruntime build;
/// on failure this returns `Err` and `native_ai_ready()` stays `false`, so
/// callers fall back to WASM/heuristic providers rather than crashing.
pub fn init_native_runtime(dylib_path: &Path) -> Result<(), String> {
    if let Some(&ready) = NATIVE_AI_READY.get() {
        return if ready {
            Ok(())
        } else {
            Err("A previous native ONNX Runtime init attempt already failed".to_string())
        };
    }

    let builder = match ort::init_from(dylib_path) {
        Ok(b) => b,
        Err(e) => {
            let _ = NATIVE_AI_READY.set(false);
            return Err(format!(
                "Failed to load onnxruntime dylib at {}: {e}",
                dylib_path.display()
            ));
        }
    };
    let result = builder.commit();

    // `commit()` returns false if an environment was already configured
    // elsewhere (e.g. a previous call, or `ort` lazily creating a default
    // one). Either way, `Session::builder()` will work from here on — the
    // question `native_ai_ready()` answers is "did *our* dylib take"; a
    // `false` here after we're first to call it would indicate a bug, not
    // a recoverable runtime condition, so it's still worth recording as
    // not-ready to avoid over-claiming.
    let _ = NATIVE_AI_READY.set(result);
    if result {
        Ok(())
    } else {
        Err("ONNX Runtime environment was already configured before this call".to_string())
    }
}

/// Whether native inference is actually usable right now — i.e.
/// `init_native_runtime` was called and its dylib loaded successfully.
/// `false` (not just absent) whenever init was never attempted, failed,
/// or the `ai` feature isn't compiled in.
pub fn native_ai_ready() -> bool {
    NATIVE_AI_READY.get().copied().unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_ai_ready_is_false_before_init() {
        // NATIVE_AI_READY is process-global; this only holds if no other
        // test in this binary has called init_native_runtime first. Kept
        // as documentation of the default rather than a strict guarantee
        // under parallel test execution.
        if NATIVE_AI_READY.get().is_none() {
            assert!(!native_ai_ready());
        }
    }

    #[test]
    fn init_with_nonexistent_path_fails_cleanly() {
        let bogus = Path::new("/nonexistent/path/to/libonnxruntime.so");
        // Only meaningful if nothing has committed an environment yet in
        // this test binary; otherwise ort::init_from itself may still
        // reject the bad path before reaching commit(). Either branch
        // must return Err, never panic.
        let result = init_native_runtime(bogus);
        assert!(result.is_err() || !native_ai_ready());
    }
}
