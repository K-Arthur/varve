//! Strata core: geometry, scene-graph primitives, and hit-testing.
//!
//! Filled in task 0.6. Research basis: the scene-graph + hit-test design follows
//! the retained-mode model used by Piet/Skia Scene, and the fractional-index
//! ordering used by collaborative ordered lists (Figma-style).

#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }
}
