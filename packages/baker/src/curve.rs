//! G1 curves: straights and circular arcs joined tangent to tangent. Every band of a street is an exact offset of
//! its curve (a straight stays a straight, an arc stays a concentric arc), so neighbouring bands never jog or fold.
use crate::geom::*;

#[derive(Clone, Debug)]
pub enum Prim {
    Line { a: P2, b: P2 },
    /// centre, radius, start angle, signed sweep (positive: turning from +x towards +z, the centre on the left)
    Arc { c: P2, r: f64, a0: f64, sweep: f64 },
}
impl Prim {
    pub fn len(&self) -> f64 {
        match self { Prim::Line { a, b } => dist(*a, *b), Prim::Arc { r, sweep, .. } => r * sweep.abs() }
    }
    /// point and unit tangent at t (0..1)
    pub fn at(&self, t: f64) -> (P2, P2) {
        match self {
            Prim::Line { a, b } => (lerp(*a, *b, t), norm(sub(*b, *a))),
            Prim::Arc { c, r, a0, sweep } => {
                let th = a0 + sweep * t;
                let (s, co) = th.sin_cos();
                let p = [c[0] + r * co, c[1] + r * s];
                let tg = if *sweep >= 0.0 { [-s, co] } else { [s, -co] };
                (p, tg)
            }
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Curve {
    pub prims: Vec<Prim>,
    /// each primitive's start along the curve
    pub starts: Vec<f64>,
    pub length: f64,
}

impl Curve {
    pub fn new(prims: Vec<Prim>) -> Self {
        let mut starts = Vec::with_capacity(prims.len());
        let mut s = 0.0;
        for p in &prims { starts.push(s); s += p.len(); }
        Curve { prims, starts, length: s }
    }
    pub fn polyline(pts: &[P2]) -> Self {
        Curve::new(pts.windows(2).filter(|w| dist(w[0], w[1]) > 1e-9).map(|w| Prim::Line { a: w[0], b: w[1] }).collect())
    }
    fn locate(&self, s: f64) -> (usize, f64) {
        let s = s.clamp(0.0, self.length);
        let i = match self.starts.binary_search_by(|v| v.partial_cmp(&s).unwrap()) { Ok(i) => i, Err(i) => i.saturating_sub(1) };
        let i = i.min(self.prims.len() - 1);
        let l = self.prims[i].len();
        (i, if l > 0.0 { ((s - self.starts[i]) / l).clamp(0.0, 1.0) } else { 0.0 })
    }
    /// point and unit tangent at s
    pub fn frame(&self, s: f64) -> (P2, P2) { let (i, t) = self.locate(s); self.prims[i].at(t) }
    pub fn point(&self, s: f64) -> P2 { self.frame(s).0 }
    pub fn tangent(&self, s: f64) -> P2 { self.frame(s).1 }
    /// the point at s offset by u to the left (an arc's offset never passes its centre)
    pub fn offset(&self, s: f64, u: f64) -> P2 {
        let (i, t) = self.locate(s);
        match &self.prims[i] {
            Prim::Line { .. } => { let (p, tg) = self.prims[i].at(t); add(p, mul(left(tg), u)) }
            Prim::Arc { c, r, a0, sweep } => {
                let th = a0 + sweep * t;
                let re = if *sweep >= 0.0 { (r - u).max(0.0) } else { (r + u).max(0.0) };
                [c[0] + re * th.cos(), c[1] + re * th.sin()]
            }
        }
    }
    /// the nearest point: (s, signed offset (left positive), distance)
    pub fn project(&self, p: P2) -> (f64, f64, f64) {
        let mut best = (0.0, 0.0, f64::INFINITY);
        for (i, pr) in self.prims.iter().enumerate() {
            let (s, q) = match pr {
                Prim::Line { a, b } => { let (_, t) = seg_dist(p, *a, *b); (self.starts[i] + t * pr.len(), lerp(*a, *b, t)) }
                Prim::Arc { c, a0, sweep, .. } => {
                    let th = angle(sub(p, *c));
                    // where along the sweep (clamped to its ends)
                    let rel = if *sweep >= 0.0 { wrap2pi(th - a0) } else { wrap2pi(a0 - th) };
                    let sw = sweep.abs();
                    let t = if rel <= sw { rel / sw } else if rel - sw < std::f64::consts::TAU - rel { 1.0 } else { 0.0 };
                    let (q, _) = pr.at(t);
                    (self.starts[i] + t * pr.len(), q)
                }
            };
            let d = dist(p, q);
            if d < best.2 {
                let tg = self.tangent(s);
                let u = dot(sub(p, q), left(tg));
                best = (s, u, d);
            }
        }
        best
    }
    /// stations from s0 to s1 for drawing the offset at u: each arc's chord within tol, no piece longer than step,
    /// every primitive's ends included
    pub fn stations(&self, s0: f64, s1: f64, u: f64, tol: f64, step: f64) -> Vec<f64> {
        let mut out = vec![s0];
        if s1 <= s0 { return out; }
        for (i, pr) in self.prims.iter().enumerate() {
            let a = self.starts[i];
            let b = a + pr.len();
            if b <= s0 || a >= s1 { continue; }
            let lo = a.max(s0);
            let hi = b.min(s1);
            let ds = match pr {
                Prim::Line { .. } => step,
                Prim::Arc { r, sweep, .. } => {
                    let re = if *sweep >= 0.0 { r - u } else { r + u };
                    if re <= tol { step } else {
                        let dth = 2.0 * (1.0 - tol / re).clamp(-1.0, 1.0).acos();
                        (dth * r).min(step * r / re.max(1e-6)).max(0.05)
                    }
                }
            };
            let n = (((hi - lo) / ds).ceil() as usize).max(1);
            for k in 1..=n { let s = lo + (hi - lo) * k as f64 / n as f64; if s - out.last().unwrap() > 1e-6 { out.push(s); } }
        }
        if (s1 - out.last().unwrap()).abs() > 1e-6 { out.push(s1); } else { *out.last_mut().unwrap() = s1; }
        out
    }
    /// stations for a band of half width w round the curve: each arc's chord within tol on its outer edge (the
    /// binding one), no piece longer than step, every primitive's ends included
    pub fn band_stations(&self, s0: f64, s1: f64, w: f64, tol: f64, step: f64) -> Vec<f64> {
        let mut out = vec![s0];
        if s1 <= s0 { return out; }
        for (i, pr) in self.prims.iter().enumerate() {
            let a = self.starts[i];
            let b = a + pr.len();
            if b <= s0 || a >= s1 { continue; }
            let (lo, hi) = (a.max(s0), b.min(s1));
            let ds = match pr {
                Prim::Line { .. } => step,
                Prim::Arc { r, .. } => { let re = r + w; let dth = 2.0 * (1.0 - tol / re).clamp(-1.0, 1.0).acos(); (dth * r).min(step).max(0.05) }
            };
            let n = (((hi - lo) / ds).ceil() as usize).max(1);
            for k in 1..=n { let s = lo + (hi - lo) * k as f64 / n as f64; if s - out.last().unwrap() > 1e-6 { out.push(s); } }
        }
        if (s1 - out.last().unwrap()).abs() > 1e-6 { out.push(s1); } else { *out.last_mut().unwrap() = s1; }
        out
    }
    /// the curve the other way round
    pub fn reversed(&self) -> Curve {
        let prims = self.prims.iter().rev().map(|p| match p {
            Prim::Line { a, b } => Prim::Line { a: *b, b: *a },
            Prim::Arc { c, r, a0, sweep } => Prim::Arc { c: *c, r: *r, a0: a0 + sweep, sweep: -sweep },
        }).collect();
        Curve::new(prims)
    }
    pub fn bbox(&self) -> BBox {
        let mut b = BBox::empty();
        for p in &self.prims {
            match p {
                Prim::Line { a, b: e } => { b.add(*a); b.add(*e); }
                Prim::Arc { c, r, a0, sweep } => {
                    // its ends, and each axis' extreme the sweep passes
                    let pr = Prim::Arc { c: *c, r: *r, a0: *a0, sweep: *sweep };
                    b.add(pr.at(0.0).0); b.add(pr.at(1.0).0);
                    for k in -4..=4 {
                        let th = k as f64 * std::f64::consts::FRAC_PI_2;
                        let rel = if *sweep >= 0.0 { wrap2pi(th - a0) } else { wrap2pi(a0 - th) };
                        if rel <= sweep.abs() { b.add([c[0] + r * th.cos(), c[1] + r * th.sin()]); }
                    }
                }
            }
        }
        b
    }
}

/// A polyline faired into straights and arcs: every inner vertex gets the largest arc that (a) stays within `tol` of
/// the vertex, (b) uses at most half of each neighbouring straight, (c) is at most `r_max`. The ends stay where they
/// are; the result is tangent-continuous (G1).
pub fn fair(pts: &[P2], tol: f64, r_max: f64) -> Curve {
    let p: Vec<P2> = {
        let mut v: Vec<P2> = Vec::with_capacity(pts.len());
        for q in pts { if v.last().map_or(true, |l| dist(*l, *q) > 0.05) { v.push(*q); } }
        if v.len() == 1 && pts.len() > 1 { v.push(*pts.last().unwrap()); }
        v
    };
    if p.len() < 3 { return Curve::polyline(&p); }
    let n = p.len();
    let seg: Vec<f64> = p.windows(2).map(|w| dist(w[0], w[1])).collect();
    // each inner vertex: its tangent length
    let mut tl = vec![0.0f64; n];
    let mut rad = vec![0.0f64; n];
    let mut turn = vec![0.0f64; n];
    for i in 1..n - 1 {
        let d1 = norm(sub(p[i], p[i - 1]));
        let d2 = norm(sub(p[i + 1], p[i]));
        let th = cross(d1, d2).atan2(dot(d1, d2));
        turn[i] = th;
        let half = th.abs() / 2.0;
        if half < 1e-4 { continue; }
        let r_tol = tol / (1.0 / half.cos() - 1.0);
        let t_avail = (seg[i - 1] * if i == 1 { 1.0 } else { 0.5 }).min(seg[i] * if i == n - 2 { 1.0 } else { 0.5 });
        let r_len = t_avail / half.tan();
        let r = r_tol.min(r_len).min(r_max);
        rad[i] = r;
        tl[i] = r * half.tan();
    }
    let mut prims = Vec::new();
    let mut cur = p[0];
    for i in 1..n - 1 {
        let d1 = norm(sub(p[i], p[i - 1]));
        let d2 = norm(sub(p[i + 1], p[i]));
        if tl[i] <= 1e-6 { if dist(cur, p[i]) > 1e-9 { prims.push(Prim::Line { a: cur, b: p[i] }); } cur = p[i]; continue; }
        let t1 = sub(p[i], mul(d1, tl[i]));
        let t2 = add(p[i], mul(d2, tl[i]));
        if dist(cur, t1) > 1e-9 { prims.push(Prim::Line { a: cur, b: t1 }); }
        // the centre: on the turning side of the incoming direction
        let side = if turn[i] > 0.0 { 1.0 } else { -1.0 };
        let c = add(t1, mul(left(d1), rad[i] * side));
        let a0 = angle(sub(t1, c));
        prims.push(Prim::Arc { c, r: rad[i], a0, sweep: turn[i] });
        cur = t2;
    }
    if dist(cur, p[n - 1]) > 1e-9 { prims.push(Prim::Line { a: cur, b: p[n - 1] }); }
    Curve::new(prims)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fair_is_g1_and_offsets_are_concentric() {
        let c = fair(&[[0.0, 0.0], [50.0, 0.0], [50.0, 50.0]], 2.0, 500.0);
        assert_eq!(c.prims.len(), 3);
        // tangent continuity at every joint
        for i in 1..c.prims.len() {
            let s = c.starts[i];
            let (_, t1) = c.prims[i - 1].at(1.0);
            let (_, t2) = c.prims[i].at(0.0);
            assert!(dist(t1, t2) < 1e-9, "joint {i} at {s}");
        }
        let (s, u, d) = c.project([60.0, 10.0]);
        assert!(d > 0.0 && s > 0.0 && u.is_finite());
        // a left turn here (from +x towards +z): offsets to the left move towards the centre
        let mid = c.starts[1] + c.prims[1].len() / 2.0;
        let r0 = dist(c.offset(mid, 0.0), match c.prims[1] { Prim::Arc { c, .. } => c, _ => unreachable!() });
        let r1 = dist(c.offset(mid, 1.0), match c.prims[1] { Prim::Arc { c, .. } => c, _ => unreachable!() });
        assert!((r0 - r1 - 1.0).abs() < 1e-9);
    }
}
