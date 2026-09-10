mod common;

use common::{assert_all, load_all};

#[test]
fn native_agrees_with_ts_reference() {
    let cases: Vec<_> = load_all()
        .into_iter()
        .filter(|f| {
            matches!(
                f.effect,
                varve_effects::EffectKind::Dither
                    | varve_effects::EffectKind::PaletteSnap
                    | varve_effects::EffectKind::RgbSplit
            )
        })
        .collect();
    assert_eq!(cases.len(), 6, "expected 6 color fixtures");
    assert_all(&cases);
}
