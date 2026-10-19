//! Plane geometry in place metres: x east, z south (the pack's axes). "Left" of a direction (tx, tz) is (-tz, tx).

pub type P2 = [f64; 2];

#[inline] pub fn add(a: P2, b: P2) -> P2 { [a[0] + b[0], a[1] + b[1]] }
#[inline] pub fn sub(a: P2, b: P2) -> P2 { [a[0] - b[0], a[1] - b[1]] }
#[inline] pub fn mul(a: P2, k: f64) -> P2 { [a[0] * k, a[1] * k] }
#[inline] pub fn dot(a: P2, b: P2) -> f64 { a[0] * b[0] + a[1] * b[1] }
#[inline] pub fn cross(a: P2, b: P2) -> f64 { a[0] * b[1] - a[1] * b[0] }
#[inline] pub fn len(a: P2) -> f64 { a[0].hypot(a[1]) }
#[inline] pub fn dist(a: P2, b: P2) -> f64 { (a[0] - b[0]).hypot(a[1] - b[1]) }
#[inline] pub fn lerp(a: P2, b: P2, t: f64) -> P2 { [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] }
#[inline] pub fn left(t: P2) -> P2 { [-t[1], t[0]] }
#[inline] pub fn norm(a: P2) -> P2 { let l = len(a); if l > 1e-12 { [a[0] / l, a[1] / l] } else { [1.0, 0.0] } }
#[inline] pub fn smooth(t: f64) -> f64 { let u = t.clamp(0.0, 1.0); u * u * (3.0 - 2.0 * u) }
/// the angle of a direction, in (-pi, pi]
#[inline] pub fn angle(a: P2) -> f64 { a[1].atan2(a[0]) }
/// an angle brought into [0, 2 pi)
#[inline] pub fn wrap2pi(a: f64) -> f64 { let t = std::f64::consts::TAU; ((a % t) + t) % t }

/// the distance from p to the segment ab, and where along it (0..1)
#[inline]
pub fn seg_dist(p: P2, a: P2, b: P2) -> (f64, f64) {
    let d = sub(b, a);
    let l2 = dot(d, d);
    let t = if l2 > 1e-18 { (dot(sub(p, a), d) / l2).clamp(0.0, 1.0) } else { 0.0 };
    (dist(p, lerp(a, b, t)), t)
}

/// where two segments cross (proper or touching): (t along ab, u along cd)
pub fn seg_cross(a: P2, b: P2, c: P2, d: P2) -> Option<(f64, f64)> {
    let r = sub(b, a);
    let s = sub(d, c);
    let den = cross(r, s);
    if den.abs() < 1e-14 { return None; }
    let w = sub(c, a);
    let t = cross(w, s) / den;
    let u = cross(w, r) / den;
    if (-1e-12..=1.0 + 1e-12).contains(&t) && (-1e-12..=1.0 + 1e-12).contains(&u) { Some((t, u)) } else { None }
}

/// shoelace area (positive when the ring turns from +x towards +z)
pub fn area(ring: &[P2]) -> f64 {
    let n = ring.len();
    let mut s = 0.0;
    for i in 0..n { let a = ring[i]; let b = ring[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
    s / 2.0
}

pub fn pip(p: P2, ring: &[P2]) -> bool {
    let mut inside = false;
    let n = ring.len();
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        let a = ring[i];
        let b = ring[j];
        if (a[1] > p[1]) != (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0] { inside = !inside; }
        j = i;
    }
    inside
}

pub fn polyline_len(p: &[P2]) -> f64 { p.windows(2).map(|w| dist(w[0], w[1])).sum() }

#[derive(Clone, Copy, Debug)]
pub struct BBox { pub x0: f64, pub z0: f64, pub x1: f64, pub z1: f64 }
impl BBox {
    pub fn empty() -> Self { BBox { x0: f64::INFINITY, z0: f64::INFINITY, x1: f64::NEG_INFINITY, z1: f64::NEG_INFINITY } }
    pub fn of(pts: &[P2]) -> Self { let mut b = Self::empty(); for p in pts { b.add(*p); } b }
    pub fn add(&mut self, p: P2) { self.x0 = self.x0.min(p[0]); self.z0 = self.z0.min(p[1]); self.x1 = self.x1.max(p[0]); self.z1 = self.z1.max(p[1]); }
    pub fn grow(&self, d: f64) -> Self { BBox { x0: self.x0 - d, z0: self.z0 - d, x1: self.x1 + d, z1: self.z1 + d } }
    pub fn hits(&self, o: &BBox) -> bool { self.x0 <= o.x1 && o.x0 <= self.x1 && self.z0 <= o.z1 && o.z0 <= self.z1 }
    pub fn has(&self, p: P2) -> bool { p[0] >= self.x0 && p[0] <= self.x1 && p[1] >= self.z0 && p[1] <= self.z1 }
    pub fn ok(&self) -> bool { self.x0 <= self.x1 && self.z0 <= self.z1 }
}

/// a uniform grid of indices by box (nearby queries); cells kept in a hash map
pub struct Grid {
    pub cell: f64,
    map: std::collections::HashMap<(i32, i32), Vec<u32>>,
}
impl Grid {
    pub fn new(cell: f64) -> Self { Grid { cell, map: std::collections::HashMap::new() } }
    #[inline] fn k(&self, v: f64) -> i32 { (v / self.cell).floor() as i32 }
    pub fn add(&mut self, b: &BBox, id: u32) {
        for i in self.k(b.x0)..=self.k(b.x1) { for j in self.k(b.z0)..=self.k(b.z1) { self.map.entry((i, j)).or_default().push(id); } }
    }
    pub fn add_seg(&mut self, a: P2, b: P2, id: u32) { self.add(&BBox::of(&[a, b]), id) }
    /// every id whose box touches the square of radius r round p (may repeat)
    pub fn near(&self, p: P2, r: f64, out: &mut Vec<u32>) {
        out.clear();
        for i in self.k(p[0] - r)..=self.k(p[0] + r) { for j in self.k(p[1] - r)..=self.k(p[1] + r) { if let Some(v) = self.map.get(&(i, j)) { out.extend_from_slice(v); } } }
        out.sort_unstable();
        out.dedup();
    }
    pub fn in_box(&self, b: &BBox, out: &mut Vec<u32>) {
        out.clear();
        for i in self.k(b.x0)..=self.k(b.x1) { for j in self.k(b.z0)..=self.k(b.z1) { if let Some(v) = self.map.get(&(i, j)) { out.extend_from_slice(v); } } }
        out.sort_unstable();
        out.dedup();
    }
}

/// Douglas-Peucker: the points a line needs (none moves it more than eps); ends kept
pub fn rdp(line: &[P2], eps: f64) -> Vec<P2> {
    if line.len() < 3 { return line.to_vec(); }
    let mut keep = vec![false; line.len()];
    keep[0] = true;
    *keep.last_mut().unwrap() = true;
    let mut stack = vec![(0usize, line.len() - 1)];
    while let Some((i, j)) = stack.pop() {
        let mut best = 0usize;
        let mut bd = eps;
        for k in i + 1..j { let (d, _) = seg_dist(line[k], line[i], line[j]); if d > bd { bd = d; best = k; } }
        if best > 0 { keep[best] = true; stack.push((i, best)); stack.push((best, j)); }
    }
    line.iter().zip(keep).filter(|(_, k)| *k).map(|(p, _)| *p).collect()
}

/// a line with points added so that no piece is longer than step
pub fn densify(line: &[P2], step: f64) -> Vec<P2> {
    let mut out = Vec::with_capacity(line.len() * 2);
    if line.is_empty() { return out; }
    out.push(line[0]);
    for w in line.windows(2) {
        let l = dist(w[0], w[1]);
        let n = ((l / step).ceil() as usize).max(1);
        for k in 1..=n { out.push(lerp(w[0], w[1], k as f64 / n as f64)); }
    }
    out
}

/// JavaScript's Math.round (halves towards +infinity), to match the TypeScript writer bit for bit
#[inline] pub fn js_round(v: f64) -> f64 { (v + 0.5).floor() }
/// a number to 2 decimals, as the TypeScript writer rounds (r2)
#[inline] pub fn r2(v: f64) -> f64 { js_round(v * 100.0) / 100.0 }
