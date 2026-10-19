//! An arrangement of segments: the planar map they make, exactly. Points are whole millimetres (place metres x 1000)
//! so the same point from two tiles is the same number; segments are split where they cross, touch or pass within a
//! millimetre of a point (snap rounding, repeated until nothing crosses); then half-edges, each vertex's edges in
//! turn round it, and the faces as cycles (a face on the left of each of its half-edges).
use std::collections::HashMap;

pub type I2 = [i64; 2];

#[inline] fn orient(a: I2, b: I2, c: I2) -> i128 { (b[0] - a[0]) as i128 * (c[1] - a[1]) as i128 - (b[1] - a[1]) as i128 * (c[0] - a[0]) as i128 }
#[inline] fn dot3(a: I2, b: I2, c: I2) -> i128 { (b[0] - a[0]) as i128 * (c[0] - a[0]) as i128 + (b[1] - a[1]) as i128 * (c[1] - a[1]) as i128 }
#[inline] fn len2(a: I2, b: I2) -> i128 { let dx = (b[0] - a[0]) as i128; let dz = (b[1] - a[1]) as i128; dx * dx + dz * dz }

pub fn to_i(p: [f64; 2]) -> I2 { [(p[0] * 1000.0).round() as i64, (p[1] * 1000.0).round() as i64] }
pub fn to_f(p: I2) -> [f64; 2] { [p[0] as f64 / 1000.0, p[1] as f64 / 1000.0] }

pub struct Arr {
    pub v: Vec<I2>,
    /// half-edge h: from v[org[h]] to v[org[h ^ 1]]
    pub org: Vec<u32>,
    pub next: Vec<u32>,
    pub face: Vec<u32>,
    /// each face's first half-edge and its signed area (m², positive: a bounded face's outline)
    pub faces: Vec<(u32, f64)>,
    pub rounds: usize,
    pub unresolved: usize,
}
impl Arr {
    #[inline] pub fn twin(h: u32) -> u32 { h ^ 1 }
    #[inline] pub fn from(&self, h: u32) -> I2 { self.v[self.org[h as usize] as usize] }
    #[inline] pub fn to(&self, h: u32) -> I2 { self.v[self.org[(h ^ 1) as usize] as usize] }
    pub fn cycle(&self, h0: u32) -> Vec<u32> { let mut out = vec![h0]; let mut h = self.next[h0 as usize]; let mut g = 0; while h != h0 && g < 10_000_000 { out.push(h); h = self.next[h as usize]; g += 1; } out }
}

/// the segments split until no two cross; each kept once
fn split_all(mut segs: Vec<(I2, I2)>, rounds_max: usize) -> (Vec<(I2, I2)>, usize, usize) {
    let canon = |s: (I2, I2)| if s.0 <= s.1 { s } else { (s.1, s.0) };
    segs = segs.into_iter().filter(|s| s.0 != s.1).map(canon).collect();
    segs.sort_unstable();
    segs.dedup();
    let mut rounds = 0;
    let mut left = 0;
    loop {
        rounds += 1;
        // a grid of the segments (4 m cells)
        const C: i64 = 4000;
        let mut grid: HashMap<(i64, i64), Vec<u32>> = HashMap::new();
        for (i, s) in segs.iter().enumerate() {
            let (x0, x1) = (s.0[0].min(s.1[0]).div_euclid(C), s.0[0].max(s.1[0]).div_euclid(C));
            let (z0, z1) = (s.0[1].min(s.1[1]).div_euclid(C), s.0[1].max(s.1[1]).div_euclid(C));
            for gx in x0..=x1 { for gz in z0..=z1 { grid.entry((gx, gz)).or_default().push(i as u32); } }
        }
        let mut cuts: Vec<Vec<I2>> = vec![Vec::new(); segs.len()];
        let mut any = false;
        let on_open = |a: I2, b: I2, p: I2| -> bool {
            // p strictly inside ab, or within half a millimetre of it (a hot pixel)
            if p == a || p == b { return false; }
            let l2 = len2(a, b);
            let d = dot3(a, b, p);
            if d <= 0 || d >= l2 { return false; }
            let o = orient(a, b, p);
            o == 0 || (o as f64).abs() / (l2 as f64).sqrt() < 0.75
        };
        let mut seen: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();
        for list in grid.values() {
            for x in 0..list.len() {
                for y in x + 1..list.len() {
                    let (i, j) = (list[x].min(list[y]), list[x].max(list[y]));
                    if !seen.insert((i, j)) { continue; }
                    let (a, b) = segs[i as usize];
                    let (c, d) = segs[j as usize];
                    if a.max(b)[0] < c[0].min(d[0]) || c[0].max(d[0]) < a[0].min(b[0]) { continue; }
                    let (o1, o2, o3, o4) = (orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b));
                    if ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0)) {
                        // a proper crossing: the point rounded to the millimetre
                        let t_num = o3.abs();
                        let t_den = o3.abs() + o4.abs();
                        let px = a[0] as i128 * t_den + (b[0] - a[0]) as i128 * t_num;
                        let pz = a[1] as i128 * t_den + (b[1] - a[1]) as i128 * t_num;
                        let r = |n: i128, d: i128| -> i64 { let q = n.div_euclid(d); let rem = n.rem_euclid(d); (if rem * 2 >= d { q + 1 } else { q }) as i64 };
                        let p = [r(px, t_den), r(pz, t_den)];
                        if p != a && p != b { cuts[i as usize].push(p); any = true; }
                        if p != c && p != d { cuts[j as usize].push(p); any = true; }
                        continue;
                    }
                    for (s, t, p) in [(i, (a, b), c), (i, (a, b), d), (j, (c, d), a), (j, (c, d), b)] {
                        if on_open(t.0, t.1, p) { cuts[s as usize].push(p); any = true; }
                    }
                }
            }
        }
        if !any { break; }
        let mut next: Vec<(I2, I2)> = Vec::with_capacity(segs.len() + segs.len() / 4);
        for (i, s) in segs.iter().enumerate() {
            let c = &mut cuts[i];
            if c.is_empty() { next.push(*s); continue; }
            let (a, b) = *s;
            c.sort_by_key(|p| dot3(a, b, *p));
            c.dedup();
            let mut prev = a;
            for p in c.iter() { if *p != prev && *p != b { next.push(canon((prev, *p))); prev = *p; } }
            if prev != b { next.push(canon((prev, b))); }
        }
        next.sort_unstable();
        next.dedup();
        segs = next;
        if rounds >= rounds_max { left = 1; break; }
    }
    (segs, rounds, left)
}

/// the half-plane-then-turn order of directions round a vertex (exact)
fn dir_cmp(a: I2, b: I2) -> std::cmp::Ordering {
    let half = |d: I2| if d[1] > 0 || (d[1] == 0 && d[0] > 0) { 0 } else { 1 };
    let (ha, hb) = (half(a), half(b));
    if ha != hb { return ha.cmp(&hb); }
    let c = a[0] as i128 * b[1] as i128 - a[1] as i128 * b[0] as i128;
    0.cmp(&c)
}

pub fn build(segs: Vec<(I2, I2)>) -> Arr {
    let (segs, rounds, unresolved) = split_all(segs, 8);
    let mut vid: HashMap<I2, u32> = HashMap::with_capacity(segs.len());
    let mut v: Vec<I2> = Vec::new();
    let mut org: Vec<u32> = Vec::with_capacity(segs.len() * 2);
    for (a, b) in &segs {
        for p in [a, b] { if !vid.contains_key(p) { vid.insert(*p, v.len() as u32); v.push(*p); } }
        org.push(vid[a]);
        org.push(vid[b]);
    }
    let nh = org.len();
    // each vertex's outgoing half-edges, in turn
    let mut out: Vec<Vec<u32>> = vec![Vec::new(); v.len()];
    for h in 0..nh { out[org[h] as usize].push(h as u32); }
    let dir = |h: u32| -> I2 { let a = v[org[h as usize] as usize]; let b = v[org[(h ^ 1) as usize] as usize]; [b[0] - a[0], b[1] - a[1]] };
    let mut pos: Vec<u32> = vec![0; nh];
    for list in out.iter_mut() {
        list.sort_by(|x, y| dir_cmp(dir(*x), dir(*y)));
        for (k, h) in list.iter().enumerate() { pos[*h as usize] = k as u32; }
    }
    // next of h (u to v): at v, the outgoing edge just clockwise from the twin (v to u)
    let mut next = vec![0u32; nh];
    for h in 0..nh as u32 {
        let t = h ^ 1;
        let at = org[t as usize] as usize;
        let list = &out[at];
        let k = pos[t as usize] as usize;
        next[h as usize] = list[(k + list.len() - 1) % list.len()];
    }
    let mut face = vec![u32::MAX; nh];
    let mut faces = Vec::new();
    for h0 in 0..nh as u32 {
        if face[h0 as usize] != u32::MAX { continue; }
        let f = faces.len() as u32;
        let mut a2: i128 = 0;
        let mut h = h0;
        let mut g = 0usize;
        loop {
            face[h as usize] = f;
            let p = v[org[h as usize] as usize];
            let q = v[org[(h ^ 1) as usize] as usize];
            a2 += p[0] as i128 * q[1] as i128 - q[0] as i128 * p[1] as i128;
            h = next[h as usize];
            g += 1;
            if h == h0 || g > nh { break; }
        }
        faces.push((h0, a2 as f64 / 2.0 / 1e6));
    }
    Arr { v, org, next, face, faces, rounds, unresolved }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crossing_squares_make_three_faces_and_the_outside() {
        let sq = |x: i64, z: i64, s: i64| vec![([x, z], [x + s, z]), ([x + s, z], [x + s, z + s]), ([x + s, z + s], [x, z + s]), ([x, z + s], [x, z])];
        let mut segs = sq(0, 0, 10_000);
        segs.extend(sq(5_000, 5_000, 10_000));
        let a = build(segs);
        let bounded: Vec<f64> = a.faces.iter().filter(|f| f.1 > 0.0).map(|f| f.1).collect();
        assert_eq!(bounded.len(), 3, "{bounded:?}");
        let total: f64 = bounded.iter().sum();
        assert!((total - 175.0).abs() < 1e-9, "{total}");
        assert!(a.faces.iter().filter(|f| f.1 < 0.0).count() == 1);
    }
}
