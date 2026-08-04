//! Bounded, model-keyed reuse for expensive native inference sessions.
//!
//! The pool only retains idle sessions. Checked-out sessions count against the
//! concurrency limit but not the cache byte budget until they are returned.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Hard resource limits for an inference session pool.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SessionPoolLimits {
    pub max_cached_entries: usize,
    pub max_cached_bytes: u64,
    pub max_concurrent: usize,
}

impl Default for SessionPoolLimits {
    fn default() -> Self {
        Self {
            max_cached_entries: 2,
            max_cached_bytes: 1_500 * 1024 * 1024,
            max_concurrent: 2,
        }
    }
}

/// Whether a checkout reused an idle session or loaded a new one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionCheckoutKind {
    Warm,
    Cold,
}

/// Low-overhead counters suitable for diagnostics export.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SessionPoolMetrics {
    pub warm_checkouts: u64,
    pub cold_loads: u64,
    pub cold_load_micros: u64,
    pub rejected_busy: u64,
    pub rejected_cancelled: u64,
    pub evicted_lru: u64,
    pub evicted_oversize: u64,
    pub explicit_unloads: u64,
    pub active: usize,
    pub cached_entries: usize,
    pub cached_bytes: u64,
}

/// Cooperative cancellation used at safe boundaries around native inference.
#[derive(Clone, Default)]
pub struct InferenceCancellationToken {
    cancelled: Arc<std::sync::atomic::AtomicBool>,
}

impl InferenceCancellationToken {
    pub fn cancel(&self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(std::sync::atomic::Ordering::Acquire)
    }
}

struct Cached<S> {
    value: S,
    estimated_bytes: u64,
    last_used: u64,
}

struct State<S> {
    idle: HashMap<String, Vec<Cached<S>>>,
    active: usize,
    cached_entries: usize,
    cached_bytes: u64,
    logical_clock: u64,
    metrics: SessionPoolMetrics,
}

impl<S> Default for State<S> {
    fn default() -> Self {
        Self {
            idle: HashMap::new(),
            active: 0,
            cached_entries: 0,
            cached_bytes: 0,
            logical_clock: 0,
            metrics: SessionPoolMetrics::default(),
        }
    }
}

struct Shared<S> {
    limits: SessionPoolLimits,
    state: Mutex<State<S>>,
}

/// Thread-safe pool whose leases automatically return sessions on every exit
/// path, including `?` propagation and panic unwinding.
pub struct SessionPool<S> {
    shared: Arc<Shared<S>>,
}

impl<S> Clone for SessionPool<S> {
    fn clone(&self) -> Self {
        Self {
            shared: Arc::clone(&self.shared),
        }
    }
}

impl<S> SessionPool<S> {
    pub fn new(limits: SessionPoolLimits) -> Self {
        assert!(limits.max_concurrent > 0, "max_concurrent must be non-zero");
        Self {
            shared: Arc::new(Shared {
                limits,
                state: Mutex::new(State::default()),
            }),
        }
    }

    pub fn checkout<F>(
        &self,
        model_key: &str,
        estimated_bytes: u64,
        cancellation: &InferenceCancellationToken,
        create: F,
    ) -> Result<SessionLease<S>, String>
    where
        F: FnOnce() -> Result<S, String>,
    {
        if cancellation.is_cancelled() {
            let mut state = self.shared.state.lock().expect("session pool poisoned");
            state.metrics.rejected_cancelled += 1;
            return Err("Inference cancelled".to_owned());
        }

        {
            let mut state = self.shared.state.lock().expect("session pool poisoned");
            if state.active >= self.shared.limits.max_concurrent {
                state.metrics.rejected_busy += 1;
                return Err("Inference session capacity is busy; retry later".to_owned());
            }
            let cached = state.idle.get_mut(model_key).and_then(Vec::pop);
            if let Some(cached) = cached {
                if state.idle.get(model_key).is_some_and(Vec::is_empty) {
                    state.idle.remove(model_key);
                }
                state.active += 1;
                state.cached_entries -= 1;
                state.cached_bytes -= cached.estimated_bytes;
                state.metrics.warm_checkouts += 1;
                sync_gauges(&mut state);
                return Ok(SessionLease::new(
                    Arc::clone(&self.shared),
                    model_key.to_owned(),
                    cached.estimated_bytes,
                    cached.value,
                    SessionCheckoutKind::Warm,
                    Duration::ZERO,
                ));
            }
            state.active += 1;
            sync_gauges(&mut state);
        }

        let started = Instant::now();
        let created = create();
        let load_duration = started.elapsed();
        let mut state = self.shared.state.lock().expect("session pool poisoned");
        match created {
            Ok(value) => {
                state.metrics.cold_loads += 1;
                state.metrics.cold_load_micros = state
                    .metrics
                    .cold_load_micros
                    .saturating_add(load_duration.as_micros() as u64);
                sync_gauges(&mut state);
                drop(state);
                Ok(SessionLease::new(
                    Arc::clone(&self.shared),
                    model_key.to_owned(),
                    estimated_bytes,
                    value,
                    SessionCheckoutKind::Cold,
                    load_duration,
                ))
            }
            Err(error) => {
                state.active -= 1;
                sync_gauges(&mut state);
                Err(error)
            }
        }
    }

    /// Drop every idle session for `model_key`. Active leases are safely
    /// returned later and may be unloaded with another call.
    pub fn unload(&self, model_key: &str) -> usize {
        let mut state = self.shared.state.lock().expect("session pool poisoned");
        let removed = state.idle.remove(model_key).unwrap_or_default();
        let count = removed.len();
        let bytes = removed
            .iter()
            .map(|entry| entry.estimated_bytes)
            .sum::<u64>();
        state.cached_entries -= count;
        state.cached_bytes -= bytes;
        state.metrics.explicit_unloads += count as u64;
        sync_gauges(&mut state);
        count
    }

    pub fn unload_all(&self) -> usize {
        let mut state = self.shared.state.lock().expect("session pool poisoned");
        let count = state.cached_entries;
        state.idle.clear();
        state.cached_entries = 0;
        state.cached_bytes = 0;
        state.metrics.explicit_unloads += count as u64;
        sync_gauges(&mut state);
        count
    }

    pub fn metrics(&self) -> SessionPoolMetrics {
        self.shared
            .state
            .lock()
            .expect("session pool poisoned")
            .metrics
    }
}

fn sync_gauges<S>(state: &mut State<S>) {
    state.metrics.active = state.active;
    state.metrics.cached_entries = state.cached_entries;
    state.metrics.cached_bytes = state.cached_bytes;
}

/// Exclusive access to one model session.
pub struct SessionLease<S> {
    shared: Arc<Shared<S>>,
    model_key: String,
    estimated_bytes: u64,
    value: Option<S>,
    kind: SessionCheckoutKind,
    load_duration: Duration,
}

impl<S> SessionLease<S> {
    fn new(
        shared: Arc<Shared<S>>,
        model_key: String,
        estimated_bytes: u64,
        value: S,
        kind: SessionCheckoutKind,
        load_duration: Duration,
    ) -> Self {
        Self {
            shared,
            model_key,
            estimated_bytes,
            value: Some(value),
            kind,
            load_duration,
        }
    }

    pub fn kind(&self) -> SessionCheckoutKind {
        self.kind
    }

    pub fn load_duration(&self) -> Duration {
        self.load_duration
    }
}

impl<S> std::ops::Deref for SessionLease<S> {
    type Target = S;

    fn deref(&self) -> &Self::Target {
        self.value.as_ref().expect("session lease already returned")
    }
}

impl<S> std::ops::DerefMut for SessionLease<S> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.value.as_mut().expect("session lease already returned")
    }
}

impl<S> Drop for SessionLease<S> {
    fn drop(&mut self) {
        let Some(value) = self.value.take() else {
            return;
        };
        let mut state = self.shared.state.lock().expect("session pool poisoned");
        state.active -= 1;
        state.logical_clock += 1;
        let last_used = state.logical_clock;
        state
            .idle
            .entry(self.model_key.clone())
            .or_default()
            .push(Cached {
                value,
                estimated_bytes: self.estimated_bytes,
                last_used,
            });
        state.cached_entries += 1;
        state.cached_bytes = state.cached_bytes.saturating_add(self.estimated_bytes);
        enforce_limits(&self.shared.limits, &mut state);
        sync_gauges(&mut state);
    }
}

fn enforce_limits<S>(limits: &SessionPoolLimits, state: &mut State<S>) {
    while state.cached_entries > limits.max_cached_entries
        || state.cached_bytes > limits.max_cached_bytes
    {
        let oldest = state
            .idle
            .iter()
            .flat_map(|(key, entries)| {
                entries
                    .iter()
                    .enumerate()
                    .map(move |(index, entry)| (key.clone(), index, entry.last_used))
            })
            .min_by_key(|(_, _, last_used)| *last_used);
        let Some((key, index, _)) = oldest else {
            break;
        };
        let entries = state.idle.get_mut(&key).expect("LRU key disappeared");
        let removed = entries.swap_remove(index);
        if entries.is_empty() {
            state.idle.remove(&key);
        }
        state.cached_entries -= 1;
        state.cached_bytes -= removed.estimated_bytes;
        if removed.estimated_bytes > limits.max_cached_bytes {
            state.metrics.evicted_oversize += 1;
        } else {
            state.metrics.evicted_lru += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{InferenceCancellationToken, SessionCheckoutKind, SessionPool, SessionPoolLimits};
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn pool(entries: usize, bytes: u64, concurrent: usize) -> SessionPool<String> {
        SessionPool::new(SessionPoolLimits {
            max_cached_entries: entries,
            max_cached_bytes: bytes,
            max_concurrent: concurrent,
        })
    }

    #[test]
    fn reuses_session_by_model_key_and_records_warm_cold_metrics() {
        let pool = pool(2, 100, 1);
        let token = InferenceCancellationToken::default();
        let loads = AtomicUsize::new(0);
        {
            let lease = pool
                .checkout("model-a", 40, &token, || {
                    loads.fetch_add(1, Ordering::Relaxed);
                    Ok("session-a".to_owned())
                })
                .unwrap();
            assert_eq!(lease.kind(), SessionCheckoutKind::Cold);
        }
        let lease = pool
            .checkout("model-a", 40, &token, || {
                panic!("warm checkout loaded model")
            })
            .unwrap();
        assert_eq!(lease.kind(), SessionCheckoutKind::Warm);
        assert_eq!(loads.load(Ordering::Relaxed), 1);
        drop(lease);
        let metrics = pool.metrics();
        assert_eq!(metrics.cold_loads, 1);
        assert_eq!(metrics.warm_checkouts, 1);
        assert_eq!(metrics.cached_bytes, 40);
    }

    #[test]
    fn evicts_least_recently_used_session_by_byte_budget() {
        let pool = pool(3, 70, 2);
        let token = InferenceCancellationToken::default();
        drop(
            pool.checkout("a", 40, &token, || Ok("a".to_owned()))
                .unwrap(),
        );
        drop(
            pool.checkout("b", 40, &token, || Ok("b".to_owned()))
                .unwrap(),
        );
        assert_eq!(pool.metrics().cached_entries, 1);
        assert_eq!(pool.metrics().cached_bytes, 40);
        assert_eq!(pool.metrics().evicted_lru, 1);
        let b = pool
            .checkout("b", 40, &token, || panic!("newest entry was evicted"))
            .unwrap();
        assert_eq!(b.kind(), SessionCheckoutKind::Warm);
    }

    #[test]
    fn rejects_work_at_concurrency_limit_without_loading() {
        let pool = pool(3, 100, 2);
        let token = InferenceCancellationToken::default();
        drop(
            pool.checkout("b", 10, &token, || Ok("b".to_owned()))
                .unwrap(),
        );
        let _active = pool
            .checkout("a", 10, &token, || Ok("a".to_owned()))
            .unwrap();
        let _second_active = pool
            .checkout("c", 10, &token, || Ok("c".to_owned()))
            .unwrap();
        let error = pool
            .checkout("b", 10, &token, || {
                panic!("must not load or reuse while busy")
            })
            .err()
            .expect("busy checkout should fail");
        assert!(error.contains("busy"));
        assert_eq!(pool.metrics().rejected_busy, 1);
    }

    #[test]
    fn cancellation_rejects_before_load_and_drop_returns_active_lease() {
        let pool = pool(2, 100, 1);
        let cancelled = InferenceCancellationToken::default();
        cancelled.cancel();
        assert!(pool
            .checkout("a", 10, &cancelled, || panic!("cancelled load ran"))
            .err()
            .expect("cancelled checkout should fail")
            .contains("cancelled"));

        let token = InferenceCancellationToken::default();
        let lease = pool
            .checkout("a", 10, &token, || Ok("a".to_owned()))
            .unwrap();
        assert_eq!(pool.metrics().active, 1);
        drop(lease);
        assert_eq!(pool.metrics().active, 0);
        assert_eq!(pool.metrics().cached_entries, 1);
    }

    #[test]
    fn explicit_unload_drops_only_requested_idle_model() {
        let pool = pool(2, 100, 2);
        let token = InferenceCancellationToken::default();
        drop(
            pool.checkout("a", 10, &token, || Ok("a".to_owned()))
                .unwrap(),
        );
        drop(
            pool.checkout("b", 20, &token, || Ok("b".to_owned()))
                .unwrap(),
        );
        assert_eq!(pool.unload("a"), 1);
        assert_eq!(pool.metrics().cached_entries, 1);
        assert_eq!(pool.metrics().cached_bytes, 20);
        assert_eq!(pool.unload_all(), 1);
        assert_eq!(pool.metrics().cached_entries, 0);
        assert_eq!(pool.metrics().explicit_unloads, 2);
    }

    #[test]
    fn failed_load_releases_concurrency_admission() {
        let pool = pool(1, 100, 1);
        let token = InferenceCancellationToken::default();
        assert!(pool
            .checkout("a", 10, &token, || Err("load failed".to_owned()))
            .is_err());
        let lease = pool
            .checkout("b", 10, &token, || Ok("b".to_owned()))
            .unwrap();
        assert_eq!(lease.kind(), SessionCheckoutKind::Cold);
    }

    #[test]
    fn oversize_session_is_used_then_not_retained() {
        let pool = pool(1, 10, 1);
        let token = InferenceCancellationToken::default();
        drop(
            pool.checkout("large", 11, &token, || Ok("large".to_owned()))
                .unwrap(),
        );
        let metrics = pool.metrics();
        assert_eq!(metrics.cached_entries, 0);
        assert_eq!(metrics.evicted_oversize, 1);
    }
}
