mod common;
use common::{assert_all, load_all};

#[test]
fn native_agrees_with_ts_reference() {
    let cases: Vec<_> = load_all()
        .into_iter()
        .filter(|f| {
            matches!(
                f.effect,
                varve_effects::EffectKind::Bloom
                    | varve_effects::EffectKind::LensFlare
                    | varve_effects::EffectKind::Caustics
            )
        })
        .collect();
    assert_eq!(cases.len(), 6, "expected 6 optics fixtures");
    assert_all(&cases);
}
