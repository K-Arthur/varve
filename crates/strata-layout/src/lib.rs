//! Strata layout: CSS-native flex/grid/container-query layout.
//!
//! Research basis: Taffy implements the CSS Box / Flexbox / Grid specs and is
//! the layout engine used by Bevy/UI toolkits. The design file's layout IS the
//! handoff CSS (Strata plan §3.1). Filled in task 1.3.

#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }
}
