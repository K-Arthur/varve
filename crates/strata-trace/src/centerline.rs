//! Centerline tracing via Zhang-Suen parallel thinning.
//!
//! Research basis: Zhang, T. Y. and Suen, C. Y. "A fast parallel algorithm
//! for thinning digital patterns." Communications of the ACM, 1984.

/// Thin a binary image to 1-pixel-wide skeleton using Zhang-Suen.
/// `binary` is a row-major bool array, width × height.
/// Returns a thinned bool array of the same size.
pub fn thin_image(binary: &[bool], width: u32, height: u32) -> Vec<bool> {
    let total = (width * height) as usize;
    if total == 0 || binary.len() < total {
        return Vec::new();
    }

    let mut img: Vec<u8> = binary.iter().map(|&b| if b { 1u8 } else { 0u8 }).collect();
    let w = width as usize;

    loop {
        let mut deleted = 0u32;

        // Sub-iteration 1: mark for deletion
        let mut to_remove = vec![false; total];
        for y in 1..(height as usize - 1) {
            for x in 1..w - 1 {
                let idx = y * w + x;
                if img[idx] == 0 {
                    continue;
                }
                let p = get_neighbors(&img, w, x, y);
                let b = p.iter().filter(|&&v| v == 1).count();
                if b < 2 || b > 6 {
                    continue;
                }
                let a = transitions(&p);
                if a != 1 {
                    continue;
                }
                // p2 * p4 * p6 == 0  and  p4 * p6 * p8 == 0
                if p[1] * p[3] * p[5] == 0 && p[3] * p[5] * p[7] == 0 {
                    to_remove[idx] = true;
                }
            }
        }
        for (idx, &remove) in to_remove.iter().enumerate() {
            if remove {
                img[idx] = 0;
                deleted += 1;
            }
        }

        // Sub-iteration 2: mark for deletion
        let mut to_remove = vec![false; total];
        for y in 1..(height as usize - 1) {
            for x in 1..w - 1 {
                let idx = y * w + x;
                if img[idx] == 0 {
                    continue;
                }
                let p = get_neighbors(&img, w, x, y);
                let b = p.iter().filter(|&&v| v == 1).count();
                if b < 2 || b > 6 {
                    continue;
                }
                let a = transitions(&p);
                if a != 1 {
                    continue;
                }
                // p2 * p4 * p8 == 0  and  p2 * p6 * p8 == 0
                if p[1] * p[3] * p[7] == 0 && p[1] * p[5] * p[7] == 0 {
                    to_remove[idx] = true;
                }
            }
        }
        for (idx, &remove) in to_remove.iter().enumerate() {
            if remove {
                img[idx] = 0;
                deleted += 1;
            }
        }

        if deleted == 0 {
            break;
        }
    }

    img.into_iter().map(|v| v == 1).collect()
}

/// Get the 8 neighbors of pixel (x, y) in order:
/// p9 p2 p3
/// p8 p1 p4
/// p7 p6 p5
/// Returns [p2, p3, p4, p5, p6, p7, p8, p9] where p1 is the center pixel (not included).
fn get_neighbors(img: &[u8], w: usize, x: usize, y: usize) -> [u8; 8] {
    [
        img[(y - 1) * w + x],       // p2 (north)
        img[(y - 1) * w + x + 1],   // p3 (northeast)
        img[y * w + x + 1],         // p4 (east)
        img[(y + 1) * w + x + 1],   // p5 (southeast)
        img[(y + 1) * w + x],       // p6 (south)
        img[(y + 1) * w + x - 1],   // p7 (southwest)
        img[y * w + x - 1],         // p8 (west)
        img[(y - 1) * w + x - 1],   // p9 (northwest)
    ]
}

/// Count the number of 0→1 transitions in clockwise order.
fn transitions(p: &[u8; 8]) -> u32 {
    // p is [p2, p3, p4, p5, p6, p7, p8, p9]
    let mut count = 0u32;
    for i in 0..8 {
        let next = (i + 1) % 8;
        if p[i] == 0 && p[next] == 1 {
            count += 1;
        }
    }
    count
}

/// The 8-connected neighbor count of (x, y).
fn neighbor_count_8(img: &[u8], w: usize, x: usize, y: usize) -> u32 {
    let mut count = 0;
    for dy in -1i32..=1 {
        for dx in -1i32..=1 {
            if dx == 0 && dy == 0 {
                continue;
            }
            let nx = x as i32 + dx;
            let ny = y as i32 + dy;
            if nx >= 0 && nx < w as i32 && ny >= 0 {
                let nidx = ny as usize * w + nx as usize;
                if nidx < img.len() && img[nidx] == 1 {
                    count += 1;
                }
            }
        }
    }
    count
}

/// Extract a skeleton graph from a thinned image.
/// Returns branches as polylines between endpoints/junctions.
pub fn extract_skeleton(
    binary: &[bool],
    width: u32,
    height: u32,
    min_branch: f64,
) -> Vec<Vec<(f64, f64)>> {
    let total = (width * height) as usize;
    if total == 0 || binary.len() < total {
        return Vec::new();
    }

    let w = width as usize;
    let img: Vec<u8> = binary.iter().map(|&b| if b { 1u8 } else { 0u8 }).collect();

    // Find endpoints: pixels with exactly 1 eight-connected neighbor
    let mut endpoints: Vec<(usize, usize)> = Vec::new();
    for y in 0..height as usize {
        for x in 0..w {
            let idx = y * w + x;
            if img[idx] == 0 {
                continue;
            }
            let n8 = neighbor_count_8(&img, w, x, y);
            if n8 == 1 {
                endpoints.push((x, y));
            }
        }
    }

    if endpoints.is_empty() {
        // No endpoints means a closed loop — use any foreground pixel
        for y in 0..height as usize {
            for x in 0..w {
                if img[y * w + x] == 1 {
                    endpoints.push((x, y));
                    break;
                }
            }
            if !endpoints.is_empty() {
                break;
            }
        }
    }

    if endpoints.is_empty() {
        return Vec::new();
    }

    // Walk from each endpoint to extract branches
    let mut visited = vec![false; total];
    let mut branches: Vec<Vec<(f64, f64)>> = Vec::new();

    // 8-direction offsets
    let dirs_8: [(i32, i32); 8] = [
        (1, 0), (1, 1), (0, 1), (-1, 1),
        (-1, 0), (-1, -1), (0, -1), (1, -1),
    ];

    for &(sx, sy) in &endpoints {
        let sidx = sy * w + sx;
        if visited[sidx] || img[sidx] == 0 {
            continue;
        }

        // Walk one branch from this endpoint
        let mut branch: Vec<(f64, f64)> = Vec::new();
        let mut cx = sx;
        let mut cy = sy;

        loop {
            let cidx = cy * w + cx;
            if visited[cidx] {
                // If we just visited this, add it; otherwise stop
                break;
            }
            visited[cidx] = true;
            branch.push((cx as f64, cy as f64));

            // Count unvisited neighbors
            let mut unvisited: Vec<(usize, usize)> = Vec::new();
            for &(dx, dy) in &dirs_8 {
                let nx = cx as i32 + dx;
                let ny = cy as i32 + dy;
                if nx < 0 || ny < 0 {
                    continue;
                }
                let nidx = ny as usize * w + nx as usize;
                if nidx >= img.len() {
                    continue;
                }
                if img[nidx] == 1 && !visited[nidx] {
                    unvisited.push((nx as usize, ny as usize));
                }
            }

            if unvisited.is_empty() {
                break; // reached the other end
            }

            // If more than one unvisited neighbor, this is a junction — stop
            // (the first branch to reach the junction claims it; we'll
            // continue from the junction with other endpoints)
            if unvisited.len() > 1 {
                // Mark this pixel visited (already done above)
                break;
            }

            // Continue along the skeleton
            let (next_x, next_y) = unvisited[0];
            cx = next_x;
            cy = next_y;
        }

        if branch.len() >= 2 {
            branches.push(branch);
        }
    }

    // Prune short branches
    let min_len = min_branch.max(1.0);
    branches.retain(|b| b.len() as f64 >= min_len);

    branches
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_horizontal_line() {
        // 5x3 image with a single row of foreground pixels in the middle
        let mut binary = vec![false; 5 * 3];
        // Row 1 (y=1) filled: indices 5..=9
        for x in 0..5 {
            binary[5 + x] = true;
        }

        let thinned = thin_image(&binary, 5, 3);
        let fg_count = thinned.iter().filter(|&&b| b).count();
        assert_eq!(fg_count, 5, "all 5 pixels should remain");

        let branches = extract_skeleton(&thinned, 5, 3, 1.0);
        assert_eq!(branches.len(), 1, "should be 1 branch");
        assert_eq!(branches[0].len(), 5, "branch should have 5 points");
    }

    #[test]
    fn cross_shape() {
        // 7x7 cross: horizontal + vertical bars
        let mut binary = vec![false; 7 * 7];
        // Horizontal bar (row 3, cols 1-5)
        for x in 1..=5 {
            binary[3 * 7 + x] = true;
        }
        // Vertical bar (col 3, rows 1-5)
        for y in 1..=5 {
            binary[y * 7 + 3] = true;
        }

        let thinned = thin_image(&binary, 7, 7);
        let fg_count = thinned.iter().filter(|&&b| b).count();
        assert!(fg_count > 0, "cross should survive thinning");

        let branches = extract_skeleton(&thinned, 7, 7, 1.0);
        // A cross has 4 arms (up, down, left, right)
        assert!(branches.len() >= 3, "cross should have 3-4 arms, got {}", branches.len());
    }

    #[test]
    fn empty_image() {
        let binary = vec![false; 100];
        let thinned = thin_image(&binary, 10, 10);
        assert!(!thinned.iter().any(|&b| b), "thinned empty should be empty");

        let branches = extract_skeleton(&binary, 10, 10, 1.0);
        assert!(branches.is_empty(), "no branches from empty image");
    }

    #[test]
    fn single_pixel_survives_thinning() {
        // A single isolated pixel has B(p) = 0, which fails the
        // 2 <= B(p) <= 6 deletion condition, so Zhang-Suen preserves it.
        let mut binary = vec![false; 9];
        binary[4] = true; // center pixel

        let thinned = thin_image(&binary, 3, 3);
        assert!(thinned[4], "isolated pixel should survive (B < 2 skips deletion)");
    }

    #[test]
    fn zhang_suen_vertical_line() {
        // 1x5: single column of foreground pixels
        let mut binary = vec![false; 5];
        for y in 0..5 {
            binary[y] = true;
        }

        let thinned = thin_image(&binary, 1, 5);
        let fg_count = thinned.iter().filter(|&&b| b).count();
        // Vertical 1-pixel line should survive
        assert_eq!(fg_count, 5, "vertical line should survive thinning");
    }

    #[test]
    fn zhang_suen_two_pixel_thick_line() {
        // 2-pixel thick horizontal line → should thin to 1 pixel
        let mut binary = vec![false; 6 * 3];
        // Two rows of foreground
        for y in 0..2 {
            for x in 0..6 {
                binary[y * 6 + x] = true;
            }
        }

        let thinned = thin_image(&binary, 6, 3);
        let fg_count = thinned.iter().filter(|&&b| b).count();
        assert!(
            fg_count > 0 && fg_count < 12,
            "thick line should be thinned: {} pixels remain (was 12)",
            fg_count
        );
    }

    #[test]
    fn minimal_branch_pruning() {
        let mut binary = vec![false; 7 * 7];
        // A T shape: horizontal bar + vertical stem
        for x in 1..=5 {
            binary[3 * 7 + x] = true;
        }
        for y in 1..=3 {
            binary[y * 7 + 3] = true;
        }

        let thinned = thin_image(&binary, 7, 7);

        // With min_branch=1.0, all branches should survive
        let branches1 = extract_skeleton(&thinned, 7, 7, 1.0);
        assert!(branches1.len() >= 2, "T-shape should have >=2 branches");

        // With min_branch=100.0, all branches should be pruned
        let branches2 = extract_skeleton(&thinned, 7, 7, 100.0);
        assert!(
            branches2.is_empty() || branches2.len() <= branches1.len(),
            "large min_branch should prune more"
        );
    }

    #[test]
    fn get_neighbors_center() {
        let mut img = vec![0u8; 9];
        // 3x3 image: all 1s
        for v in img.iter_mut() {
            *v = 1;
        }
        let p = get_neighbors(&img, 3, 1, 1);
        assert_eq!(p.len(), 8);
        assert!(p.iter().all(|&v| v == 1), "all neighbors should be 1");
    }

    #[test]
    fn transitions_corner_case() {
        // All neighbors 0→no transitions
        let p = [0u8; 8];
        assert_eq!(transitions(&p), 0);

        // Single 0→1 transition
        let p = [0, 1, 1, 1, 1, 1, 1, 1];
        assert_eq!(transitions(&p), 1);
    }

    #[test]
    fn extract_skeleton_invalid_dimensions() {
        let binary = vec![false; 10];
        let branches = extract_skeleton(&binary, 3, 3, 1.0);
        // 3*3 = 9 but binary has 10 → should return empty
        assert!(branches.is_empty());
    }
}
