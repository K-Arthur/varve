//! Agreement tests: native retro-effect kernels (crt, vhs, lightShafts,
//! lightLeak) vs fixtures generated from the TS reference implementations.

mod common;
use common::{assert_all, load_all};

#[test]
fn native_agrees_with_ts_reference() {
    let cases: Vec<_> = load_all()
        .into_iter()
        .filter(|f| {
            matches!(
                f.effect,
                varve_effects::EffectKind::Crt
                    | varve_effects::EffectKind::Vhs
                    | varve_effects::EffectKind::LightShafts
                    | varve_effects::EffectKind::LightLeak
            )
        })
        .collect();
    assert_eq!(cases.len(), 8, "expected 8 retro fixtures");
    assert_all(&cases);
}
