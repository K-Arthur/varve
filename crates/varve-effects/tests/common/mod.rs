//! Shared test harness for the native kernel agreement tests.
//!
//! Fixtures are generated from the TS reference kernels by
//! `packages/engine/src/liveEffects/__tests__/fixtureGen.test.ts` (run with
//! GENERATE_EFFECT_FIXTURES=1). Each fixture carries the input RGBA buffer,
//! the params, the caller quality tier + coord space, and the expected output
//! with a tolerance mode (`exact` | `maxDelta`).

use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use varve_effects::{apply_effect, CoordSpace, EffectKind, EffectQuality, EffectRequest};

pub struct Fixture {
    pub name: String,
    pub effect: EffectKind,
    pub width: u32,
    pub height: u32,
    pub quality: EffectQuality,
    pub coord_space: Option<CoordSpace>,
    pub params: Value,
    pub input: Vec<u8>,
    pub expected: Vec<u8>,
    pub mode: String,
    pub max_delta: u8,
}

pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn parse_effect(s: &str) -> EffectKind {
    match s {
        "dither" => EffectKind::Dither,
        "paletteSnap" => EffectKind::PaletteSnap,
        "bloom" => EffectKind::Bloom,
        "rgbSplit" => EffectKind::RgbSplit,
        "crt" => EffectKind::Crt,
        "vhs" => EffectKind::Vhs,
        "lightShafts" => EffectKind::LightShafts,
        "lensFlare" => EffectKind::LensFlare,
        "lightLeak" => EffectKind::LightLeak,
        "caustics" => EffectKind::Caustics,
        other => panic!("unknown effect kind in fixture: {other}"),
    }
}

fn parse_quality(s: &str) -> EffectQuality {
    match s {
        "interactive" => EffectQuality::Interactive,
        "export" => EffectQuality::Export,
        _ => EffectQuality::Normal,
    }
}

/// Load every fixture listed in the manifest.
pub fn load_all() -> Vec<Fixture> {
    let dir = fixtures_dir();
    let manifest: Value =
        serde_json::from_str(&fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
    let mut out = Vec::new();
    for entry in manifest["cases"].as_array().unwrap() {
        let file = entry["file"].as_str().unwrap();
        let raw = fs::read_to_string(dir.join(file)).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        out.push(parse_one(v));
    }
    out
}

fn parse_one(v: Value) -> Fixture {
    let input: Vec<u8> = v["input"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_u64().unwrap() as u8)
        .collect();
    let expected: Vec<u8> = v["expected"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_u64().unwrap() as u8)
        .collect();
    let coord_space = v["coordSpace"].as_object().map(|cs| CoordSpace {
        scale: cs["scale"].as_f64().unwrap(),
        origin_x: cs["originX"].as_f64().unwrap(),
        origin_y: cs["originY"].as_f64().unwrap(),
        region_x: cs["regionX"].as_f64().unwrap(),
        region_y: cs["regionY"].as_f64().unwrap(),
    });
    Fixture {
        name: v["name"].as_str().unwrap().to_string(),
        effect: parse_effect(v["effect"].as_str().unwrap()),
        width: v["width"].as_u64().unwrap() as u32,
        height: v["height"].as_u64().unwrap() as u32,
        quality: parse_quality(v["quality"].as_str().unwrap()),
        coord_space,
        params: v["params"].clone(),
        input,
        expected,
        mode: v["tolerance"]["mode"]
            .as_str()
            .unwrap_or("exact")
            .to_string(),
        max_delta: v["tolerance"]["maxDelta"].as_u64().unwrap_or(0) as u8,
    }
}

/// Run `apply_effect` for a fixture and compare against the expected output.
/// Returns Ok(()) on agreement, Err with a summary of the first mismatches.
pub fn run_and_compare(fx: &Fixture) -> Result<(), String> {
    let request = EffectRequest {
        effect: fx.effect,
        width: fx.width,
        height: fx.height,
        quality: fx.quality,
        coord_space: fx.coord_space,
        params: fx.params.clone(),
    };
    let actual =
        apply_effect(&request, &fx.input).map_err(|e| format!("apply_effect failed: {e}"))?;
    if actual.len() != fx.expected.len() {
        return Err(format!(
            "length mismatch: got {}, expected {}",
            actual.len(),
            fx.expected.len()
        ));
    }
    match fx.mode.as_str() {
        "exact" => {
            for (i, (a, e)) in actual.iter().zip(fx.expected.iter()).enumerate() {
                if a != e {
                    return Err(format!(
                        "byte mismatch at {i} (pixel {}, channel {}): got {a}, expected {e}",
                        i / 4,
                        i % 4
                    ));
                }
            }
            Ok(())
        }
        "maxDelta" => {
            let mut worst = 0i32;
            let mut worst_at = 0usize;
            for (i, (a, e)) in actual.iter().zip(fx.expected.iter()).enumerate() {
                let d = (*a as i32 - *e as i32).abs();
                if d > worst {
                    worst = d;
                    worst_at = i;
                }
            }
            if worst > fx.max_delta as i32 {
                return Err(format!(
                    "maxDelta exceeded: worst {worst} at index {worst_at} (pixel {}, channel {}), bound {}",
                    worst_at / 4,
                    worst_at % 4,
                    fx.max_delta
                ));
            }
            Ok(())
        }
        other => Err(format!("unknown tolerance mode {other}")),
    }
}

/// Standard multi-case runner: `assert_all(&cases)`.
pub fn assert_all(cases: &[Fixture]) {
    let mut failures = Vec::new();
    for fx in cases {
        if let Err(e) = run_and_compare(fx) {
            failures.push(format!("{}: {e}", fx.name));
        }
    }
    assert!(
        failures.is_empty(),
        "agreement failures:\n{}",
        failures.join("\n")
    );
}
