//! Deterministic seeded pseudo-random helpers — faithful port of
//! `packages/engine/src/liveEffects/prng.ts`.
//!
//! Never uses wall-clock state: every value derives from integer seeds so the
//! same (seed, time, frame) triple produces byte-identical output. All
//! integer hashes use `u32` wrapping arithmetic matching JS `Math.imul` /
//! `>>>` bit patterns. `Math.imul(a, b)` is `a * b` (i32 product) — the
//! operand order below mirrors the JS expressions exactly.

/// Mulberry32 PRNG step. JS: `a = (a + 0x6d2b79f5) >>> 0`;
/// `t = Math.imul(t ^ (t >>> 15), t | 1)`;
/// `t ^= t + Math.imul(t ^ (t >>> 7), t | 61)`;
/// return `((t ^ (t >>> 14)) >>> 0) / 4294967296`.
pub fn mulberry32_next(state: &mut u32) -> f64 {
    let a = state.wrapping_add(0x6d2b79f5);
    let mut t = a;
    t = (t ^ (t >> 15)).wrapping_mul(t | 1);
    t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
    let out = (t ^ (t >> 14)) as f64 / 4294967296.0;
    *state = a;
    out
}

/// Integer hash of (x, y, seed) → [0, 1). Port of `hash2` in prng.ts:
/// `h = seed ^ imul(x, 0x27d4eb2d) ^ imul(y, 0x165667b1)`;
/// `h = imul(h ^ h>>>15, 0x85ebca6b)`; `h ^= h>>>13`;
/// `h = imul(h ^ h>>>16, 0xc2b2ae35)`; `h ^= h>>>16`; return `h / 2^32`.
pub fn hash2(x: i32, y: i32, seed: u32) -> f64 {
    let mut h = seed
        ^ (x as u32).wrapping_mul(0x27d4eb2d)
        ^ (y as u32).wrapping_mul(0x165667b1);
    h = (h ^ (h >> 15)).wrapping_mul(0x85ebca6b);
    h ^= h >> 13;
    h = (h ^ (h >> 16)).wrapping_mul(0xc2b2ae35);
    h ^= h >> 16;
    h as f64 / 4294967296.0
}

/// Integer hash of (x, y, z, seed) → [0, 1). Port of `hash3` in prng.ts.
pub fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f64 {
    let mut h = seed
        ^ (x as u32).wrapping_mul(0x27d4eb2d)
        ^ (y as u32).wrapping_mul(0x165667b1)
        ^ (z as u32).wrapping_mul(0x9e3779b1);
    h = (h ^ (h >> 15)).wrapping_mul(0x85ebca6b);
    h ^= h >> 13;
    h = (h ^ (h >> 16)).wrapping_mul(0xc2b2ae35);
    h ^= h >> 16;
    h as f64 / 4294967296.0
}

fn smooth(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

/// Bilinear value noise at continuous coords → [0, 1). Port of `valueNoise2`.
pub fn value_noise2(x: f64, y: f64, seed: u32) -> f64 {
    let x0 = x.floor();
    let y0 = y.floor();
    let fx = smooth(x - x0);
    let fy = smooth(y - y0);
    let a = hash2(x0 as i32, y0 as i32, seed);
    let b = hash2(x0 as i32 + 1, y0 as i32, seed);
    let c = hash2(x0 as i32, y0 as i32 + 1, seed);
    let d = hash2(x0 as i32 + 1, y0 as i32 + 1, seed);
    a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/// Fractal Brownian motion (octave-summed value noise) → [0, 1]. Port of
/// `fbm2`.
pub fn fbm2(x: f64, y: f64, seed: u32, octaves: f64) -> f64 {
    let mut sum = 0.0;
    let mut amp = 0.5;
    let mut freq = 1.0;
    let mut total = 0.0;
    let o = octaves.round().max(1.0).min(8.0) as i32;
    for i in 0..o {
        sum += value_noise2(x * freq, y * freq, seed.wrapping_add((i * 1013) as u32)) * amp;
        total += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    if total > 0.0 {
        sum / total
    } else {
        0.0
    }
}

/// Deterministic [0,1) value from a 1D seed. Port of `seeded01`:
/// `h = imul(h ^ h>>>16, 0x45d9f3b)` twice, `h ^= h>>>16`.
pub fn seeded01(seed: u32) -> f64 {
    let mut h = seed;
    h = (h ^ (h >> 16)).wrapping_mul(0x45d9f3b);
    h = (h ^ (h >> 16)).wrapping_mul(0x45d9f3b);
    h ^= h >> 16;
    h as f64 / 4294967296.0
}

/// Deterministic integer in [0, max) from a seed. Port of `seededInt`.
pub fn seeded_int(seed: u32, max: u32) -> u32 {
    (seeded01(seed) * max as f64).floor() as u32
}

/// sRGB encoded byte → linear-light [0, 1] (piecewise sRGB transfer). Port
/// of `srgbToLinear01` in prng.ts.
pub fn srgb_to_linear01(byte: f64) -> f64 {
    let v = byte / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

/// Linear-light [0, 1] → sRGB encoded byte (clamped). Port of
/// `linearToSrgb01` in prng.ts.
pub fn linear_to_srgb01(linear: f64) -> f64 {
    let v = if linear < 0.0 {
        0.0
    } else if linear > 1.0 {
        1.0
    } else {
        linear
    };
    let srgb = if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    };
    (srgb * 255.0 + 0.5).floor()
}

/// sRGB encoded byte → linear-light [0, 1]. Port of `srgbToLinear` in
/// `@varve/shared` colorConversion.ts.
pub fn srgb_to_linear(c: f64) -> f64 {
    let v = c / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

/// Linear-light [0, 1] → sRGB encoded byte (clamped). Port of
/// `linearToSrgb` in `@varve/shared` colorConversion.ts.
pub fn linear_to_srgb(c: f64) -> f64 {
    let v = if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    };
    (v * 255.0 + 0.5).floor()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mulberry32_sequence_matches_js() {
        let mut state: u32 = 42;
        // Generated by running the TS mulberry32(42) in Node.
        let expected = [
            0.6011037519201636,
            0.44829055899754167,
            0.8524657934904099,
            0.6697340414393693,
            0.17481389874592423,
        ];
        for e in expected {
            let got = mulberry32_next(&mut state);
            assert!((got - e).abs() < 1e-15, "got {got}, expected {e}");
        }
    }

    #[test]
    fn hash2_matches_js() {
        // Generated by running the TS hash2 in Node.
        assert_eq!(hash2(0, 0, 0), 0.0);
        assert_eq!(hash2(1, 2, 3), 0.6634983655530959);
        assert_eq!(hash2(-4, 7, 99), 0.36132268072105944);
        assert_eq!(hash2(17, -3, 12345), 0.49226666428148746);
    }

    #[test]
    fn hash3_matches_js() {
        // Generated by running the TS hash3 in Node.
        assert_eq!(hash3(0, 0, 0, 0), 0.0);
        assert_eq!(hash3(1, 2, 3, 7), 0.3164952110964805);
        assert_eq!(hash3(5, -2, 8, 4242), 0.5516927135176957);
    }

    #[test]
    fn seeded01_matches_js() {
        // Generated by running the TS seeded01 in Node.
        assert_eq!(seeded01(0), 0.0);
        assert_eq!(seeded01(1), 0.19197247340343893);
        assert_eq!(seeded01(7919), 0.5851147130597383);
        assert_eq!(seeded01(0xffffffff), 0.1256184761878103);
    }
}
