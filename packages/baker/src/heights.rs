//! Stage 7, heights from the design. Each street's profile: the ground along its curve, smoothed by its class and
//! held to its steepest grade, its ends brought to its junctions' heights. Each junction (cluster): one plane through
//! its arms' cut sections (its slope at most 12 %); each arm blends into that plane over its last metres, so the
//! cut line has one height from both sides. Across a street: a crown and a crossfall to each gutter. The kerb stands
//! 150 mm; a kerb ramp's lip 20 mm. Islands and medians lie at their kerbs' tops; verges run from the kerb's top to
//! the property line, meeting the ground there within the verge's slope limits.
use crate::geom::*;
use std::collections::HashMap;
use crate::junctions::{Design, RoadRef};
use crate::rules::Rules;
use crate::seed::Ground;

pub struct Profile { pub step: f64, pub h: Vec<f64> }
impl Profile {
    pub fn at(&self, s: f64) -> f64 {
        let f = (s / self.step).clamp(0.0, (self.h.len() - 1) as f64);
        let i = (f.floor() as usize).min(self.h.len().saturating_sub(2));
        let t = f - i as f64;
        if self.h.len() == 1 { return self.h[0]; }
        self.h[i] * (1.0 - t) + self.h[i + 1] * t
    }
}
/// h = h0 + gx (x - cx) + gz (z - cz)
#[derive(Clone, Copy, Debug)]
pub struct Plane { pub cx: f64, pub cz: f64, pub h0: f64, pub gx: f64, pub gz: f64, pub residual: f64 }
impl Plane { pub fn at(&self, p: P2) -> f64 { self.h0 + self.gx * (p[0] - self.cx) + self.gz * (p[1] - self.cz) } }

pub struct Heights { pub profiles: Vec<Profile>, pub planes: Vec<Plane>, pub crossfall: f64, pub blend: f64, pub report: HeightReport, pub plane_pts: Vec<Vec<[f64; 3]>> }
#[derive(Default, Debug, Clone, serde::Serialize)]
pub struct HeightReport { pub coupled_streets: usize, pub merged_planes: usize, pub planes: usize, pub non_planar: usize, pub worst_residual_m: f64, pub max_grade: f64, pub steep_streets: usize }

fn gaussian(v: &[f64], sigma_steps: f64) -> Vec<f64> {
    if sigma_steps < 0.5 || v.len() < 3 { return v.to_vec(); }
    let r = (sigma_steps * 3.0).ceil() as isize;
    let w: Vec<f64> = (-r..=r).map(|k| (-(k as f64).powi(2) / (2.0 * sigma_steps * sigma_steps)).exp()).collect();
    let n = v.len() as isize;
    (0..n).map(|i| {
        let (mut s, mut sw) = (0.0, 0.0);
        for k in -r..=r {
            // reflected at the ends (the end's own slope carries on)
            let mut j = i + k;
            if j < 0 { j = -j; }
            if j >= n { j = 2 * (n - 1) - j; }
            let j = j.clamp(0, n - 1);
            let ww = w[(k + r) as usize];
            s += ww * v[j as usize];
            sw += ww;
        }
        s / sw
    }).collect()
}

fn fit_plane(pts: &[[f64; 3]], max_slope: f64) -> Plane {
    let n = pts.len() as f64;
    let (mut mx, mut mz, mut mh) = (0.0, 0.0, 0.0);
    for p in pts { mx += p[0]; mz += p[1]; mh += p[2]; }
    mx /= n; mz /= n; mh /= n;
    let (mut a, mut b, mut c, mut pp, mut q) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for p in pts { let x = p[0] - mx; let z = p[1] - mz; let h = p[2] - mh; a += x * x; b += x * z; c += z * z; pp += x * h; q += z * h; }
    let det = a * c - b * b;
    let (mut gx, mut gz) = if det.abs() > 1e-6 * (a + c).max(1.0) { ((pp * c - q * b) / det, (q * a - pp * b) / det) } else if a + c > 1e-9 {
        // the points on a line: the slope along it
        let g = if a >= c { pp / a } else { q / c };
        if a >= c { (g, 0.0) } else { (0.0, g) }
    } else { (0.0, 0.0) };
    let gm = gx.hypot(gz);
    if gm > max_slope { gx *= max_slope / gm; gz *= max_slope / gm; }
    let mut pl = Plane { cx: mx, cz: mz, h0: mh, gx, gz, residual: 0.0 };
    pl.residual = pts.iter().map(|p| (pl.at([p[0], p[1]]) - p[2]).abs()).fold(0.0, f64::max);
    pl
}

pub fn solve(d: &Design, g: &Ground, rules: &Rules) -> Heights {
    let step = 2.0;
    let mut rep = HeightReport::default();
    // raw and smoothed profiles
    let mut profiles: Vec<Profile> = d.streets.iter().map(|s| {
        let n = ((s.len() / step).ceil() as usize).max(1) + 1;
        let raw: Vec<f64> = (0..n).map(|i| { let p = s.curve.point((i as f64 * step).min(s.len())); g.at(p[0], p[1]) }).collect();
        let sm = gaussian(&raw, rules.profile_sigma.at(s.link.cls) / step);
        Profile { step: s.len() / (n - 1) as f64, h: sm }
    }).collect();
    // each node's height: the mean of its streets' ends; each street brought to its ends' heights
    let mut node_h: HashMap<i64, (f64, f64)> = Default::default();
    for (i, s) in d.streets.iter().enumerate() {
        let p = &profiles[i];
        let e = node_h.entry(s.link.a).or_default(); e.0 += p.h[0]; e.1 += 1.0;
        let e = node_h.entry(s.link.b).or_default(); e.0 += *p.h.last().unwrap(); e.1 += 1.0;
    }
    for (i, s) in d.streets.iter().enumerate() {
        let ha = node_h[&s.link.a].0 / node_h[&s.link.a].1;
        let hb = node_h[&s.link.b].0 / node_h[&s.link.b].1;
        let p = &mut profiles[i];
        let n = p.h.len();
        let (ra, rb) = (ha - p.h[0], hb - p.h[n - 1]);
        let reach = (s.len() * 0.5).min(40.0).max(1.0);
        for k in 0..n {
            let sk = k as f64 * p.step;
            p.h[k] += ra * (1.0 - smooth(sk / reach)) + rb * (1.0 - smooth((s.len() - sk) / reach));
        }
        // the steepest grade: limited outward from the lower end, in both directions
        let gmax = rules.max_grade.at(s.link.cls);
        let lim = gmax * p.step;
        let mut steep = false;
        for _ in 0..2 {
            for k in 1..n { let dh = p.h[k] - p.h[k - 1]; if dh.abs() > lim { steep = true; } }
            for k in 1..n { let dh = p.h[k] - p.h[k - 1]; if dh.abs() > lim * 1.0001 { p.h[k] = p.h[k - 1] + dh.signum() * lim; } }
        }
        if steep { rep.steep_streets += 1; }
        for k in 1..n { rep.max_grade = rep.max_grade.max((p.h[k] - p.h[k - 1]).abs() / p.step); }
    }
    let cf = rules.crossfall;
    // streets running beside a greater street with no room between their carriageways (a service road along an
    // arterial, a slip lane): taken to the greater street's gutter there, blended in and out over 15 m
    {
        let rank = |l: usize| (d.streets[l].link.cls, -(d.streets[l].len() as i64), l);
        let mut order: Vec<usize> = (0..d.streets.len()).collect();
        order.sort_by_key(|&l| rank(l));
        let mut grid = Grid::new(20.0);
        let mut segs: Vec<(usize, P2, P2, f64, f64)> = Vec::new();
        for (l, st) in d.streets.iter().enumerate() {
            let ss = st.curve.stations(0.0, st.len(), 0.0, 0.05, 4.0);
            for w in ss.windows(2) { let (a, b) = (st.curve.point(w[0]), st.curve.point(w[1])); grid.add(&BBox::of(&[a, b]), segs.len() as u32); segs.push((l, a, b, w[0], w[1])); }
        }
        let pos: HashMap<usize, usize> = order.iter().enumerate().map(|(i, l)| (*l, i)).collect();
        let mut buf = Vec::new();
        let mut coupled = 0usize;
        for (oi, &l) in order.iter().enumerate() {
            if oi == 0 { continue; }
            let st = &d.streets[l];
            let n = profiles[l].h.len();
            let mut tgt: Vec<Option<f64>> = vec![None; n];
            for k in 0..n {
                let sk = k as f64 * profiles[l].step;
                let p = st.curve.point(sk);
                grid.near(p, st.sec.outer + 12.0, &mut buf);
                let mut best: Option<(f64, f64)> = None;
                for &i in &buf {
                    let (t, a, b, s0, s1) = segs[i as usize];
                    if t == l || pos[&t] > oi { continue; }
                    let ot = &d.streets[t];
                    let (dd, f) = seg_dist(p, a, b);
                    // touching (no room between), or the other carriageway of the same divided road across its median
                    let paired = st.link.oneway && ot.link.oneway && !st.link.name.is_empty() && st.link.name == ot.link.name && dd <= st.sec.outer + ot.sec.outer + rules.median_width;
                    if dd > st.sec.outer + ot.sec.outer + 1.0 && !paired { continue; }
                    // not where they meet at a junction of their own
                    let shared = [st.link.a, st.link.b].iter().any(|n| (*n == ot.link.a || *n == ot.link.b) && dist(d.node_at[n], p) < 40.0);
                    if shared { continue; }
                    let s_t = s0 + (s1 - s0) * f;
                    let h = if paired { profiles[t].at(s_t) } else { profiles[t].at(s_t) - cf * dd.min(ot.sec.half) };
                    if best.map_or(true, |x| dd < x.0) { best = Some((dd, h)); }
                }
                tgt[k] = best.map(|b| b.1);
            }
            if tgt.iter().all(|x| x.is_none()) { continue; }
            coupled += 1;
            // weights spread 15 m round the stretch beside it; targets carried to the stations beside them
            let step = profiles[l].step.max(0.1);
            let reach = (15.0 / step).ceil() as isize;
            let mut w = vec![0.0f64; n];
            let mut tv = vec![0.0f64; n];
            for k in 0..n as isize {
                let mut best: Option<(isize, f64)> = None;
                for j in (k - reach).max(0)..=(k + reach).min(n as isize - 1) { if let Some(h) = tgt[j as usize] { let dk = (j - k).abs(); if best.map_or(true, |b| dk < b.0) { best = Some((dk, h)); } } }
                if let Some((dk, h)) = best { w[k as usize] = 1.0 - smooth(dk as f64 / reach as f64); tv[k as usize] = h; }
            }
            let p = &mut profiles[l];
            for k in 0..n { p.h[k] = p.h[k] * (1.0 - w[k]) + tv[k] * w[k]; }
        }
        rep.coupled_streets = coupled;
    }
    // each junction's plane, through its arms' cut sections
    let mut pts: Vec<Vec<[f64; 3]>> = vec![Vec::new(); d.clusters.len()];
    for (l, s) in d.streets.iter().enumerate() {
        let half = s.sec.half;
        match d.ribbon[l] {
            Some((s0, s1)) => {
                for (end, st) in [(0u8, s0), (1u8, s1)] {
                    let node = if end == 0 { s.link.a } else { s.link.b };
                    let c = d.cluster_of[&node];
                    let h = profiles[l].at(st);
                    for u in [-half, 0.0, half] { let p = s.curve.offset(st, u); pts[c].push([p[0], p[1], h - cf * u.abs()]); }
                    // a little into the arm too: the arm's grade carries into the plane
                    let s2 = if end == 0 { (st + 4.0).min(s.len()) } else { (st - 4.0).max(0.0) };
                    let p = s.curve.point(s2);
                    pts[c].push([p[0], p[1], profiles[l].at(s2)]);
                }
            }
            None => {
                let c = d.cluster_of[&s.link.a];
                for k in 0..=4 { let st = s.len() * k as f64 / 4.0; let p = s.curve.point(st); pts[c].push([p[0], p[1], profiles[l].at(st)]); }
            }
        }
    }
    let planes: Vec<Plane> = pts.iter().enumerate().map(|(c, v)| {
        if v.is_empty() { let n = d.clusters[c][0]; let p = d.node_at[&n]; return Plane { cx: p[0], cz: p[1], h0: g.at(p[0], p[1]), gx: 0.0, gz: 0.0, residual: 0.0 }; }
        let pl = fit_plane(v, 0.12);
        rep.planes += 1;
        if pl.residual > 0.35 { rep.non_planar += 1; }
        rep.worst_residual_m = rep.worst_residual_m.max(pl.residual);
        pl
    }).collect();
    Heights { profiles, planes, crossfall: cf, blend: rules.junction_blend, report: rep, plane_pts: pts }
}

impl Heights {
    /// junctions whose surfaces touch (no street of their own between them) share one plane
    pub fn merge_planes(&mut self, groups: &[Vec<usize>]) -> usize {
        let mut n = 0;
        for g in groups {
            if g.len() < 2 { continue; }
            let pts: Vec<[f64; 3]> = g.iter().flat_map(|c| self.plane_pts[*c].iter().copied()).collect();
            if pts.is_empty() { continue; }
            let pl = fit_plane(&pts, 0.12);
            for c in g { self.planes[*c] = pl; }
            n += 1;
            self.report.worst_residual_m = self.report.worst_residual_m.max(pl.residual);
        }
        self.report.merged_planes = n;
        n
    }
    /// a street's surface at (s, u): its profile, crown and crossfall, blended into its junctions' planes
    pub fn on_street(&self, d: &Design, l: usize, s: f64, u: f64) -> f64 {
        let st = &d.streets[l];
        let p = st.curve.offset(s, u);
        let ca = d.cluster_of[&st.link.a];
        let cb = d.cluster_of[&st.link.b];
        let Some((s0, s1)) = d.ribbon[l] else { return self.planes[ca].at(p) };
        let own = self.profiles[l].at(s) - self.crossfall * u.abs().min(st.sec.half);
        // each end blends over at most half the carriageway, so at its own cut it is wholly its junction's plane
        let reach = self.blend.min((s1 - s0) / 2.0).max(1e-6);
        let wa = if s <= s0 { 1.0 } else { 1.0 - smooth((s - s0) / reach) };
        let wb = if s >= s1 { 1.0 } else { 1.0 - smooth((s1 - s) / reach) };
        own * (1.0 - wa - wb) + self.planes[ca].at(p) * wa + self.planes[cb].at(p) * wb
    }
    pub fn road(&self, d: &Design, r: &RoadRef, p: P2) -> f64 {
        match *r {
            RoadRef::Link { link, s, u } => { let _ = p; self.on_street(d, link, s, u) }
            RoadRef::Junction { cluster } => self.planes[cluster].at(p),
        }
    }
}
