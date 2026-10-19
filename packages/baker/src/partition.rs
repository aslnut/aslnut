//! Stage 6, one planar partition. Every designed line goes into one arrangement (a constrained triangulation per
//! 500 m tile, the tile's edge a line of it too): the kerb loops, each arm's cut line, each carriageway's crown, the
//! band lines (each an offset of its kerb loop: nature strip to footpath, footpath to the gap, the property line),
//! the links from kerb ramps to the footpath, and the frame. Every face of the arrangement is then labelled from the
//! design (which side of which kerb, how deep into the verge, which street or junction it belongs to); faces with the
//! same label are one; a scrap smaller than the rules' least area joins the neighbour it shares most edge with. So
//! neighbours share their edges and vertices exactly: no gap, no overlap, no seam, nothing cut away.
use crate::geom::*;
use crate::heights::Heights;
use crate::junctions::{Design, KerbLoop, LoopVertex};
use crate::rules::Rules;
use crate::seed::Ground;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Kind { None, Lot, Road, Strip, Footpath, Gap, Island }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Label {
    pub kind: Kind,
    /// a street (Road on a ribbon), a junction cluster (Road in a junction), a face (verge bands)
    pub owner: u32,
    /// a ribbon's side of its crown (0 left, 1 right); 2 a junction
    pub side: u8,
}
pub const NONE: Label = Label { kind: Kind::None, owner: 0, side: 0 };

/// what the labelling found about a point in a face's verge: the kerb point nearest, how deep, and the bands there
#[derive(Clone, Copy, Debug)]
pub struct KerbHit { pub lp: u32, pub i: u32, pub t: f64, pub d: f64, pub inside: bool, pub q: P2 }

pub struct Index<'a> {
    pub d: &'a Design,
    pub rules: &'a Rules,
    pub frame: BBox,
    kseg: Vec<(u32, u32)>,
    kgrid: Grid,
    cgrid: Grid,
    cseg: Vec<(u32, P2, P2, f64, f64)>,
    rects: Vec<[P2; 4]>,
    rgrid: Grid,
    /// each loop vertex: is it on a kerb ramp (its flares too), is it at the ramp's lip (its lowered middle)
    pub ramp: Vec<Vec<bool>>,
    pub lip: Vec<Vec<bool>>,
    /// each loop segment's piece along its loop: a street side's segment its own, a corner's run of segments one
    pub seg_bucket: Vec<Vec<u32>>,
}

impl<'a> Index<'a> {
    pub fn new(d: &'a Design, rules: &'a Rules, frame: BBox) -> Self {
        let mut kseg = Vec::new();
        let mut kgrid = Grid::new(8.0);
        for (li, lp) in d.loops.iter().enumerate() {
            let n = lp.verts.len();
            for i in 0..n {
                let a = lp.verts[i].p;
                let b = lp.verts[(i + 1) % n].p;
                kgrid.add_seg(a, b, kseg.len() as u32);
                kseg.push((li as u32, i as u32));
            }
        }
        let mut cseg = Vec::new();
        let mut cgrid = Grid::new(16.0);
        for (l, s) in d.streets.iter().enumerate() {
            let ss = s.curve.stations(0.0, s.len(), 0.0, 0.05, 6.0);
            for w in ss.windows(2) {
                let (a, b) = (s.curve.point(w[0]), s.curve.point(w[1]));
                cgrid.add(&BBox::of(&[a, b]).grow(s.sec.outer + 1.0), cseg.len() as u32);
                cseg.push((l as u32, a, b, w[0], w[1]));
            }
        }
        let mut rects = Vec::new();
        let mut rgrid = Grid::new(10.0);
        let mut ramp: Vec<Vec<bool>> = d.loops.iter().map(|l| vec![false; l.verts.len()]).collect();
        let mut lip: Vec<Vec<bool>> = ramp.clone();
        for c in &d.crossings {
            let s = &d.streets[c.link];
            for (k, sg) in [(0usize, 1.0f64), (1, -1.0)] {
                let side = &s.sec.sides[k];
                if side.footpath > 0.0 && side.strip > 0.05 {
                    let u0 = sg * s.sec.outer;
                    let u1 = sg * (s.sec.outer + side.strip + 0.4);
                    let hw = rules.ramp_width / 2.0;
                    let r = [s.curve.offset(c.s - hw, u0), s.curve.offset(c.s - hw, u1), s.curve.offset(c.s + hw, u1), s.curve.offset(c.s + hw, u0)];
                    rgrid.add(&BBox::of(&r), rects.len() as u32);
                    rects.push(r);
                }
            }
        }
        for (li, lp) in d.loops.iter().enumerate() {
            for (i, v) in lp.verts.iter().enumerate() {
                if let Some((l, _, s)) = v.side {
                    for c in d.crossings.iter().filter(|c| c.link == l) {
                        let e = (c.s - s).abs();
                        if e <= rules.ramp_width / 2.0 + 1e-6 { ramp[li][i] = true; lip[li][i] = true; }
                        else if e <= rules.ramp_width / 2.0 + rules.ramp_flare + 1e-6 { ramp[li][i] = true; }
                    }
                }
            }
        }
        let seg_bucket = d.loops.iter().map(|lp| {
            let n = lp.verts.len();
            let mut b = vec![0u32; n];
            let mut run = u32::MAX;
            for i in 0..n {
                let side = lp.verts[i].side.is_some() && lp.verts[(i + 1) % n].side.is_some();
                if side { b[i] = i as u32; run = u32::MAX; } else { if run == u32::MAX { run = i as u32; } b[i] = run; }
            }
            b
        }).collect();
        Index { d, rules, frame, kseg, kgrid, cgrid, cseg, rects, rgrid, ramp, lip, seg_bucket }
    }
    pub fn rects(&self) -> &[[P2; 4]] { &self.rects }

    /// the nearest kerb segment: which loop, where, how far, and whether the point is inside that loop's face
    pub fn kerb(&self, p: P2) -> Option<KerbHit> { self.kerb_within(p, 400.0) }
    pub fn kerb_within(&self, p: P2, rmax: f64) -> Option<KerbHit> {
        let mut buf = Vec::new();
        for r in [8.0, 24.0, 64.0, 160.0, 400.0] {
            if r > rmax * 1.0001 && r > 8.0 { break; }
            self.kgrid.near(p, r, &mut buf);
            let mut best: Option<KerbHit> = None;
            for &k in &buf {
                let (li, i) = self.kseg[k as usize];
                let lp = &self.d.loops[li as usize];
                let n = lp.verts.len();
                let a = lp.verts[i as usize].p;
                let b = lp.verts[(i as usize + 1) % n].p;
                let (dd, t) = seg_dist(p, a, b);
                if best.map_or(true, |h| dd < h.d - 1e-12) { best = Some(KerbHit { lp: li, i, t, d: dd, inside: false, q: lerp(a, b, t) }); }
            }
            if let Some(mut h) = best {
                if h.d <= r {
                    let lp = &self.d.loops[h.lp as usize];
                    let n = lp.verts.len();
                    let i = h.i as usize;
                    let a = lp.verts[i].p;
                    let b = lp.verts[(i + 1) % n].p;
                    let side = if h.t <= 1e-9 || h.t >= 1.0 - 1e-9 {
                        // at a vertex: its pseudo-normal (the two segments' left normals together)
                        let (v, pv, nv) = if h.t <= 1e-9 { (a, lp.verts[(i + n - 1) % n].p, b) } else { (b, a, lp.verts[(i + 2) % n].p) };
                        let pn = add(left(norm(sub(v, pv))), left(norm(sub(nv, v))));
                        dot(sub(p, v), pn)
                    } else { cross(sub(b, a), sub(p, a)) };
                    h.inside = side > 0.0;
                    return Some(h);
                }
            }
        }
        None
    }
    /// which piece along its street or loop a labelled point is in (pieces end at every station)
    pub fn bucket(&self, p: P2, lab: Label, hit: Option<KerbHit>) -> u32 {
        match lab.kind {
            Kind::Road if lab.side != 2 => {
                let l = lab.owner as usize;
                let (s, _, _) = self.d.streets[l].curve.project(p);
                self.d.stations[l].partition_point(|x| *x <= s) as u32
            }
            Kind::Strip | Kind::Footpath | Kind::Gap | Kind::Island => hit.map_or(0, |h| self.seg_bucket[h.lp as usize][h.i as usize]),
            _ => 0,
        }
    }
    /// the bands at a kerb hit
    pub fn bands(&self, h: &KerbHit) -> crate::sections::Side {
        let lp = &self.d.loops[h.lp as usize];
        let n = lp.verts.len();
        crate::junctions::lerp_side(&lp.verts[h.i as usize].w, &lp.verts[(h.i as usize + 1) % n].w, h.t)
    }
    fn in_rect(&self, p: P2) -> bool {
        let mut buf = Vec::new();
        self.rgrid.near(p, 0.0, &mut buf);
        buf.iter().any(|&i| pip(p, &self.rects[i as usize]))
    }
    /// the street or junction a point of carriageway belongs to: the street whose own carriageway it is on, else the
    /// junction of the street whose band it is in (by which end), else of the nearest street
    pub fn owner(&self, p: P2) -> Label {
        let d = self.d;
        let mut buf = Vec::new();
        self.cgrid.near(p, 0.0, &mut buf);
        let mut best_rib: Option<(f64, Label)> = None;
        let mut best_jn: Option<(f64, u32)> = None;
        let mut nearest: Option<(f64, usize)> = None;
        let mut seen: Vec<u32> = Vec::new();
        for &k in &buf {
            let (l, a, b, _, _) = self.cseg[k as usize];
            let (dd, _) = seg_dist(p, a, b);
            if nearest.map_or(true, |x| dd < x.0) { nearest = Some((dd, l as usize)); }
            if seen.contains(&l) { continue; }
            let st = &d.streets[l as usize];
            if dd > st.sec.outer + 0.6 { continue; }
            seen.push(l);
            let (s, u, _) = st.curve.project(p);
            let e = u.abs() - st.sec.outer;
            match d.ribbon[l as usize] {
                Some((r0, r1)) if s >= r0 - 1e-6 && s <= r1 + 1e-6 => {
                    if e <= 0.05 && best_rib.map_or(true, |x| e < x.0) { best_rib = Some((e, Label { kind: Kind::Road, owner: l, side: if u >= 0.0 { 0 } else { 1 } })); }
                }
                r => {
                    if e <= 0.5 {
                        let node = match r { Some((r0, _)) => if s < r0 { st.link.a } else { st.link.b }, None => st.link.a };
                        let c = d.cluster_of[&node] as u32;
                        if best_jn.map_or(true, |x| e < x.0) { best_jn = Some((e, c)); }
                    }
                }
            }
        }
        // the street or junction whose carriageway the point is deepest in
        match (best_rib, best_jn) {
            (Some((er, lab)), Some((ej, c))) => return if ej < er - 0.25 { Label { kind: Kind::Road, owner: c, side: 2 } } else { lab },
            (Some((_, lab)), None) => return lab,
            (None, Some((_, c))) => return Label { kind: Kind::Road, owner: c, side: 2 },
            _ => {}
        }
        let Some((_, l)) = nearest else {
            let mut bn: Option<(f64, i64)> = None;
            for (n, q) in &d.node_at { let dd = dist(*q, p); if bn.map_or(true, |b| dd < b.0) { bn = Some((dd, *n)); } }
            return Label { kind: Kind::Road, owner: bn.map_or(0, |b| d.cluster_of[&b.1] as u32), side: 2 };
        };
        let st = &d.streets[l];
        let (s, _, _) = st.curve.project(p);
        let mid = match d.ribbon[l] { Some((r0, r1)) => (r0 + r1) / 2.0, None => st.len() / 2.0 };
        let node = if s < mid { st.link.a } else { st.link.b };
        Label { kind: Kind::Road, owner: d.cluster_of[&node] as u32, side: 2 }
    }
    pub fn label(&self, p: P2) -> (Label, Option<KerbHit>) { self.label_within(p, 400.0) }
    /// the label, looking for a kerb no further than rmax (beyond: a lot)
    pub fn label_within(&self, p: P2, rmax: f64) -> (Label, Option<KerbHit>) {
        if !self.frame.has(p) { return (NONE, None); }
        let Some(h) = self.kerb_within(p, rmax) else { return (Label { kind: Kind::Lot, owner: 0, side: 0 }, None) };
        if !h.inside { return (self.owner(p), Some(h)); }
        let lp = &self.d.loops[h.lp as usize];
        if lp.island { return (Label { kind: Kind::Island, owner: h.lp, side: 0 }, Some(h)); }
        let w = self.bands(&h);
        let kind = if w.verge <= 0.01 { Kind::Lot } else if self.in_rect(p) && h.d < w.strip + 0.6 { Kind::Footpath } else if h.d < w.strip { Kind::Strip } else if h.d < w.strip + w.footpath { Kind::Footpath } else if h.d < w.verge { Kind::Gap } else { Kind::Lot };
        (Label { kind, owner: h.lp, side: 0 }, Some(h))
    }
}

/// a band line of a kerb loop: the loop moved into its face by each vertex's band depth (concentric round corners;
/// past a kerb return's own radius the two sides' offsets carried on to where they meet)
pub fn band_line(d: &Design, lp: &KerbLoop, depth: &dyn Fn(&LoopVertex) -> f64) -> Vec<(P2, bool, usize)> {
    let n = lp.verts.len();
    let mut out: Vec<(P2, bool, usize)> = Vec::with_capacity(n + 8);
    let tan_of = |v: &LoopVertex| -> P2 { [v.n[1], -v.n[0]] };
    let mut i = 0;
    while i < n {
        let v = &lp.verts[i];
        let dd = depth(v);
        if dd < 0.05 { out.push((v.p, false, i)); i += 1; continue; }
        if let Some((l, side, s)) = v.side {
            let st = &d.streets[l];
            let u = if side == 0 { st.sec.outer + dd } else { -(st.sec.outer + dd) };
            out.push((st.curve.offset(s, u), true, i));
            i += 1;
            continue;
        }
        match v.around {
            Some((c, r, true)) if dd >= r - 0.01 => {
                // past the corner's radius: the run of this corner's vertices replaced by where the sides' offsets meet
                let mut j = i;
                while j < n && lp.verts[j].side.is_none() && matches!(lp.verts[j].around, Some((c2, _, true)) if dist(c2, c) < 1e-6) { j += 1; }
                let pv = &lp.verts[(i + n - 1) % n];
                let nv = &lp.verts[j % n];
                let a = add(pv.p, mul(pv.n, depth(pv)));
                let b = add(nv.p, mul(nv.n, depth(nv)));
                let ta = tan_of(pv);
                let tb = tan_of(nv);
                let den = cross(ta, tb);
                if den.abs() > 1e-6 {
                    let w = sub(b, a);
                    let lam = cross(w, tb) / den;
                    if lam > -1e-6 && lam < 200.0 { out.push((add(a, mul(ta, lam)), true, i)); }
                }
                i = j.max(i + 1);
            }
            Some((c, r, toward)) => {
                let rr = if toward { (r - dd).max(0.0) } else { r + dd };
                let k = if r > 1e-9 { rr / r } else { 1.0 };
                out.push((add(c, mul(sub(v.p, c), k)), true, i));
                i += 1;
            }
            None => {
                // a sharp or tapered corner point: along its normal (sharp: where the neighbours' offsets meet)
                let pv = &lp.verts[(i + n - 1) % n];
                let nv = &lp.verts[(i + 1) % n];
                if dot(pv.n, nv.n) < 0.98 && pv.side.is_some() && nv.side.is_some() {
                    let a = add(pv.p, mul(pv.n, depth(pv)));
                    let b = add(nv.p, mul(nv.n, depth(nv)));
                    let ta = tan_of(pv);
                    let tb = tan_of(nv);
                    let den = cross(ta, tb);
                    if den.abs() > 1e-6 { let lam = cross(sub(b, a), tb) / den; if lam.abs() < 200.0 { out.push((add(a, mul(ta, lam)), true, i)); } }
                } else { out.push((add(v.p, mul(v.n, dd)), true, i)); }
                i += 1;
            }
        }
    }
    out
}

/// the arrangement's lines, each segment with what it is
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineKind { Kerb, Cut, Crown, Band, Ramp, Frame }

pub struct Lines { pub segs: Vec<(P2, P2, LineKind)>, pub grid: Grid, pub dropped: usize, pub band_lines: Vec<(u32, u8, Vec<(P2, bool, usize)>)> }

pub fn lines(ix: &Index, d: &Design) -> Lines {
    let mut segs: Vec<(P2, P2, LineKind)> = Vec::new();
    let fr = ix.frame.grow(1.0);
    let keep = |a: P2, b: P2| fr.hits(&BBox::of(&[a, b]));
    // kerb loops
    for lp in &d.loops {
        let n = lp.verts.len();
        for i in 0..n { let (a, b) = (lp.verts[i].p, lp.verts[(i + 1) % n].p); if keep(a, b) && dist(a, b) > 1e-6 { segs.push((a, b, LineKind::Kerb)); } }
    }
    // cuts and crowns
    for (l, r) in d.ribbon.iter().enumerate() {
        let Some((s0, s1)) = *r else { continue };
        let st = &d.streets[l];
        for s in [s0, s1] {
            let (a, c, b) = (st.curve.offset(s, st.sec.outer), st.curve.offset(s, 0.0), st.curve.offset(s, -st.sec.outer));
            if keep(a, b) { segs.push((a, c, LineKind::Cut)); segs.push((c, b, LineKind::Cut)); }
        }
        let mut ss: Vec<f64> = vec![s0];
        ss.extend(d.stations[l].iter().copied().filter(|x| *x > s0 + 0.02 && *x < s1 - 0.02));
        ss.push(s1);
        for w in ss.windows(2) { let (a, b) = (st.curve.offset(w[0], 0.0), st.curve.offset(w[1], 0.0)); if keep(a, b) { segs.push((a, b, LineKind::Crown)); } }
        // straight across at each station (a piece between two of them is a quad: no long chord in it)
        for &x in &ss[1..ss.len() - 1] {
            let (a, c, b) = (st.curve.offset(x, st.sec.outer), st.curve.offset(x, 0.0), st.curve.offset(x, -st.sec.outer));
            if keep(a, b) { segs.push((a, c, LineKind::Cut)); segs.push((c, b, LineKind::Cut)); }
        }
    }
    // band lines: each kept where it is truly that deep into its own face (the rest, past a face's middle, is not)
    let mut dropped = 0;
    let mut band_lines = Vec::new();
    for (li, lp) in d.loops.iter().enumerate() {
        if lp.island { continue; }
        let depths: [&dyn Fn(&LoopVertex) -> f64; 3] = [&|v: &LoopVertex| v.w.strip, &|v: &LoopVertex| v.w.strip + v.w.footpath, &|v: &LoopVertex| v.w.verge];
        for (bi, dep) in depths.iter().enumerate() {
            if lp.verts.iter().all(|v| dep(v) < 0.05) { continue; }
            if bi == 1 && lp.verts.iter().all(|v| v.w.footpath < 0.05) { continue; }
            if bi == 2 && lp.verts.iter().all(|v| v.w.gap < 0.02) && lp.verts.iter().all(|v| v.w.footpath < 0.05) { continue; }
            let raw = band_line(d, lp, *dep);
            let m = raw.len();
            // valid: on this face's side and as deep as meant
            let ok: Vec<bool> = raw.iter().map(|(p, good, _)| {
                if !*good { return false; }
                match ix.kerb(*p) { Some(h) => h.lp as usize == li && h.inside && { let w = ix.bands(&h); let want = match bi { 0 => w.strip, 1 => w.strip + w.footpath, _ => w.verge }; h.d >= want - 0.08 - 0.02 * want }, None => false }
            }).collect();
            for i in 0..m {
                let j = (i + 1) % m;
                let (a, b) = (raw[i].0, raw[j].0);
                if !(ok[i] || ok[j]) || dist(a, b) < 1e-6 { dropped += 1; continue; }
                if keep(a, b) { segs.push((a, b, LineKind::Band)); }
            }
            band_lines.push((li as u32, bi as u8, raw.iter().zip(&ok).map(|(p, k)| (p.0, *k, p.2)).collect()));
        }
    }
    // radially across the verge at each street station (to the property line, or the face's middle if nearer)
    for (li, lp) in d.loops.iter().enumerate() {
        if lp.island {
            // an island or median: straight across from each station of its sides, to its other kerb
            for v in &lp.verts {
                let Some((l, side, x)) = v.side else { continue };
                let st = &d.streets[l];
                let sg = if side == 0 { 1.0 } else { -1.0 };
                let a = v.p;
                let mut end: Option<P2> = None;
                let mut dd = 0.5;
                while dd < 40.0 {
                    let q = st.curve.offset(x, sg * (st.sec.outer + dd));
                    match ix.kerb(q) { Some(h) if h.lp as usize == li && h.inside => { end = Some(q); } _ => break }
                    dd += 0.5;
                }
                if let Some(b) = end { let b2 = st.curve.offset(x, sg * (st.sec.outer + dd)); if keep(a, b2) { segs.push((a, b2, LineKind::Band)); } let _ = b; }
            }
            continue;
        }
        for v in &lp.verts {
            let Some((l, side, x)) = v.side else { continue };
            if v.w.verge < 0.05 { continue; }
            let st = &d.streets[l];
            let sg = if side == 0 { 1.0 } else { -1.0 };
            let mut deps = vec![0.0];
            for dd in [v.w.strip, v.w.strip + v.w.footpath, v.w.verge] { if dd > deps.last().unwrap() + 0.04 { deps.push(dd); } }
            let pts: Vec<P2> = deps.iter().map(|dd| st.curve.offset(x, sg * (st.sec.outer + dd))).collect();
            for w in pts.windows(2) {
                // as deep as the face is there (a radial past a narrow face's middle is not drawn)
                let ok = match ix.kerb(w[1]) { Some(h) => h.lp as usize == li && h.inside, None => false };
                if !ok { break; }
                if keep(w[0], w[1]) { segs.push((w[0], w[1], LineKind::Band)); }
            }
        }
    }
    // the links from the kerb ramps across the nature strip
    for r in ix.rects() { for k in 0..3 { segs.push((r[k], r[k + 1], LineKind::Ramp)); } }
    // the frame
    let f = ix.frame;
    let c = [[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]];
    for k in 0..4 { segs.push((c[k], c[(k + 1) % 4], LineKind::Frame)); }
    let mut grid = Grid::new(500.0);
    for (i, s) in segs.iter().enumerate() { grid.add_seg(s.0, s.1, i as u32); }
    Lines { segs, grid, dropped, band_lines }
}

/// a segment clipped to a square: canonical (the same numbers from both tiles sharing an edge)
fn clip(a: P2, b: P2, x0: f64, z0: f64, x1: f64, z1: f64) -> Option<(P2, P2)> {
    let swap = (a[0], a[1]) > (b[0], b[1]);
    let (p, q) = if swap { (b, a) } else { (a, b) };
    let (dx, dz) = (q[0] - p[0], q[1] - p[1]);
    let mut t0: f64 = 0.0;
    let mut t1: f64 = 1.0;
    let mut e0: Option<(u8, f64)> = None;
    let mut e1: Option<(u8, f64)> = None;
    for (pk, qk, side, val) in [(-dx, p[0] - x0, 0u8, x0), (dx, x1 - p[0], 0, x1), (-dz, p[1] - z0, 1, z0), (dz, z1 - p[1], 1, z1)] {
        if pk.abs() < 1e-15 { if qk < 0.0 { return None; } continue; }
        let r = qk / pk;
        if pk < 0.0 { if r > t0 { t0 = r; e0 = Some((side, val)); } } else if r < t1 { t1 = r; e1 = Some((side, val)); }
    }
    if t0 > t1 { return None; }
    let at = |t: f64, e: Option<(u8, f64)>| -> P2 {
        match e {
            Some((0, x)) => [x, p[1] + (x - p[0]) * dz / dx],
            Some((_, z)) => [p[0] + (z - p[1]) * dx / dz, z],
            None => if t <= 0.0 { p } else { q },
        }
    };
    let (u, v) = (if t0 > 0.0 { at(t0, e0) } else { p }, if t1 < 1.0 { at(t1, e1) } else { q });
    if dist(u, v) < 1e-9 { return None; }
    Some(if swap { (v, u) } else { (u, v) })
}

/// a piece of a tile's partition: its label and its rings (the outline first, then holes), each point's handle
pub struct Piece { pub label: Label, pub rings: Vec<Vec<P2>>, pub area: f64, pub bucket: u32 }

#[derive(Default, Debug, Clone, serde::Serialize)]
pub struct TileReport { pub vertices: usize, pub dropped_points: usize, pub edges: usize, pub faces: usize, pub scraps_merged: usize, pub slivers_merged: usize, pub pieces: usize, pub panicked: bool }

pub struct TileOut { pub ix: i32, pub iz: i32, pub pieces: Vec<Piece>, pub report: TileReport }

pub fn tile(ix: &Index, ln: &Lines, tx: i32, tz: i32, cell: f64, size: f64) -> TileOut {
    let (x0, z0) = (tx as f64 * size, tz as f64 * size);
    let (x1, z1) = (x0 + size, z0 + size);
    let mut rep = TileReport::default();
    let mut buf = Vec::new();
    ln.grid.in_box(&BBox { x0, z0, x1, z1 }, &mut buf);
    let mut segs: Vec<(P2, P2)> = Vec::with_capacity(buf.len() + 64);
    for &k in &buf {
        let (a, b, _) = ln.segs[k as usize];
        if let Some((u, v)) = clip(a, b, x0, z0, x1, z1) { segs.push((u, v)); }
    }
    // the tile's edge and the cells' lines (their crossings with everything are found by the arrangement)
    let c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for k in 0..4 { segs.push((c[k], c[(k + 1) % 4])); }
    let _ = cell;
    let built = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| build(ix, &segs, cell, (x0, z0, x1, z1), &mut rep)));
    match built {
        Ok(p) => TileOut { ix: tx, iz: tz, pieces: p, report: rep },
        Err(_) => { rep.panicked = true; TileOut { ix: tx, iz: tz, pieces: vec![], report: rep } }
    }
}

/// a point well inside a polygon with holes: the middle of the widest chord along a few lines across it
pub fn inside_point(rings: &[Vec<P2>]) -> Option<(P2, f64)> {
    let b = BBox::of(&rings[0]);
    let mut best: Option<(P2, f64)> = None;
    for k in 1..8 {
        let f = k as f64 / 8.0;
        for horizontal in [true, false] {
            let c = if horizontal { b.z0 + (b.z1 - b.z0) * f } else { b.x0 + (b.x1 - b.x0) * f };
            let mut xs: Vec<f64> = Vec::new();
            for r in rings {
                for i in 0..r.len() {
                    let (p, q) = (r[i], r[(i + 1) % r.len()]);
                    let (pa, qa, pb, qb) = if horizontal { (p[1], q[1], p[0], q[0]) } else { (p[0], q[0], p[1], q[1]) };
                    if (pa > c) != (qa > c) { xs.push(pb + (c - pa) * (qb - pb) / (qa - pa)); }
                }
            }
            xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
            for w in xs.chunks(2) {
                if w.len() < 2 { continue; }
                let l = w[1] - w[0];
                if best.map_or(true, |x| l > x.1) { let m = (w[0] + w[1]) / 2.0; best = Some((if horizontal { [m, c] } else { [c, m] }, l)); }
            }
        }
    }
    best
}

fn build(ix: &Index, segs: &[(P2, P2)], cell: f64, tile: (f64, f64, f64, f64), rep: &mut TileReport) -> Vec<Piece> {
    use crate::arrangement::{build as arrange, to_f, to_i, Arr, I2};
    let isegs: Vec<(I2, I2)> = segs.iter().map(|(a, b)| (to_i(*a), to_i(*b))).collect();
    // the designed points (every line's own points): the arrangement's own (where lines cross) may be left out
    let designed: std::collections::HashSet<I2> = isegs.iter().flat_map(|(a, b)| [*a, *b]).collect();
    let arr = arrange(isegs);
    rep.vertices = arr.v.len();
    rep.edges = arr.org.len() / 2;
    let nf = arr.faces.len();
    // bounded faces (positive) and holes (negative, but the tile's outside, the most negative)
    let ring_of = |h0: u32| -> Vec<P2> { arr.cycle(h0).into_iter().map(|h| to_f(arr.from(h))).collect() };
    let outside = (0..nf).min_by(|a, b| arr.faces[*a].1.partial_cmp(&arr.faces[*b].1).unwrap()).unwrap_or(0);
    let bounded: Vec<usize> = (0..nf).filter(|f| arr.faces[*f].1 > 0.0).collect();
    let rings: HashMap<usize, Vec<P2>> = (0..nf).map(|f| (f, ring_of(arr.faces[f].0))).collect();
    let mut bgrid = Grid::new(50.0);
    for &f in &bounded { bgrid.add(&BBox::of(&rings[&f]), f as u32); }
    // each hole's face: the smallest bounded face round it
    let mut holes_of: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut host: Vec<usize> = (0..nf).collect();
    let mut cand = Vec::new();
    for f in 0..nf {
        if arr.faces[f].1 >= 0.0 || f == outside { continue; }
        let r = &rings[&f];
        let probe = r[0];
        bgrid.near(probe, 0.0, &mut cand);
        let mut best: Option<(f64, usize)> = None;
        for &g in &cand { let g = g as usize; let a = arr.faces[g].1; if best.map_or(false, |b| a >= b.0) { continue; } if BBox::of(&rings[&g]).has(probe) && pip(probe, &rings[&g]) { best = Some((a, g)); } }
        if let Some((_, g)) = best { holes_of.entry(g).or_default().push(f); host[f] = g; } else { host[f] = outside; }
    }
    // labels, from a point well inside each bounded face
    let mut label: Vec<Label> = vec![NONE; nf];
    let mut fcell: Vec<(i32, i32)> = vec![(0, 0); nf];
    let mut fbucket: Vec<u32> = vec![0; nf];
    for &f in &bounded {
        let mut rs = vec![rings[&f].clone()];
        for h in holes_of.get(&f).into_iter().flatten() { rs.push(rings[h].clone()); }
        if let Some((p, _)) = inside_point(&rs) {
            let (lab, hit) = ix.label(p);
            label[f] = lab;
            fcell[f] = ((p[0] / cell).floor() as i32, (p[1] / cell).floor() as i32);
            fbucket[f] = ix.bucket(p, lab, hit);
        }
    }
    // a half-edge's bounded face (a hole's half-edges belong to the face round the hole)
    let fof = |h: u32| -> usize { host[arr.face[h as usize] as usize] };
    let mut parent: Vec<usize> = (0..nf).collect();
    fn find(p: &mut [usize], i: usize) -> usize { let mut i = i; while p[i] != i { p[i] = p[p[i]]; i = p[i]; } i }
    // (ordered maps: the same faces joined the same way every run)
    let mut shared: std::collections::BTreeMap<(usize, usize), f64> = Default::default();
    for h in (0..arr.org.len() as u32).step_by(2) {
        let (f, g) = (fof(h), fof(h ^ 1));
        if f == g || f == outside || g == outside { continue; }
        let l = { let (a, b) = (to_f(arr.from(h)), to_f(arr.to(h))); dist(a, b) };
        if label[f] == label[g] && fbucket[f] == fbucket[g] { let (a, b) = (find(&mut parent, f), find(&mut parent, g)); if a != b { parent[a] = b; } continue; }
        *shared.entry((f.min(g), f.max(g))).or_default() += l;
    }
    // faces too small or too thin: joined to the neighbour they share most edge with (any cell)
    let mut garea: std::collections::BTreeMap<usize, f64> = Default::default();
    for &f in &bounded { let a = arr.faces[f].1 + holes_of.get(&f).map_or(0.0, |v| v.iter().map(|h| arr.faces[*h].1).sum()); *garea.entry(find(&mut parent, f)).or_default() += a; }
    let mut perim: std::collections::BTreeMap<usize, f64> = Default::default();
    let mut nb: std::collections::BTreeMap<usize, std::collections::BTreeMap<usize, f64>> = Default::default();
    for (&(a, b), &l) in &shared {
        let (fa, fb) = (find(&mut parent, a), find(&mut parent, b));
        *perim.entry(fa).or_default() += l; *perim.entry(fb).or_default() += l;
        if fa != fb { *nb.entry(fa).or_default().entry(fb).or_default() += l; *nb.entry(fb).or_default().entry(fa).or_default() += l; }
    }
    let glabel = |p: &mut Vec<usize>, label: &Vec<Label>, f: usize| -> Label { let _ = p; label[f] };
    let mut small: Vec<(f64, usize)> = garea.iter().filter(|(f, a)| {
        let lab = glabel(&mut parent.clone(), &label, **f);
        // (the carriageway keeps its small faces: joining one to a neighbour would bend that piece round it)
        if matches!(lab.kind, Kind::None | Kind::Lot | Kind::Road) { return false; }
        let p = perim.get(f).copied().unwrap_or(0.0);
        **a < ix.rules.scrap_area || (p > 0.0 && 2.0 * **a / p < 0.1 && **a < 20.0)
    }).map(|(f, a)| (*a, *f)).collect();
    small.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut relabel: std::collections::BTreeMap<usize, Label> = Default::default();
    for (a, f) in small {
        let Some(ns) = nb.get(&f) else { continue };
        let mut best: Option<(f64, usize)> = None;
        for (&g, &l) in ns {
            let gr = find(&mut parent, g);
            let lg = relabel.get(&gr).copied().unwrap_or(label[g]);
            if matches!(lg.kind, Kind::None | Kind::Lot) || gr == find(&mut parent, f) { continue; }
            if best.map_or(true, |b| l > b.0) { best = Some((l, gr)); }
        }
        if let Some((_, g)) = best {
            let lab = relabel.get(&g).copied().unwrap_or(label[g]);
            let p = perim.get(&f).copied().unwrap_or(0.0);
            if a < ix.rules.scrap_area { rep.scraps_merged += 1; } else if p > 0.0 { rep.slivers_merged += 1; }
            let fr = find(&mut parent, f);
            relabel.insert(fr, lab);
            relabel.insert(g, lab);
            parent[fr] = g;
        }
    }
    let mut final_label: Vec<Label> = vec![NONE; nf];
    for &f in &bounded { let r = find(&mut parent, f); final_label[f] = relabel.get(&r).copied().unwrap_or(label[f]); }
    // groups: joined faces (one label, one cell), each group's outline and holes walked on its boundary half-edges
    let group: Vec<usize> = (0..nf).map(|f| if f == outside { usize::MAX } else { let h = host[f]; if h == outside { usize::MAX } else { find(&mut parent, h) } }).collect();
    let gof = |h: u32| -> usize { group[arr.face[h as usize] as usize] };
    // points to leave out: made by the arrangement (not designed), on a line between just two pieces, not needed to
    // keep that line within a centimetre (Douglas-Peucker along each run of them), never on the tile's edge
    let (tx0, tz0, tx1, tz1) = (to_i([tile.0, tile.1]), to_i([tile.0, tile.1]), to_i([tile.2, tile.3]), to_i([tile.2, tile.3]));
    let _ = (tz0, tx1);
    let nv = arr.v.len();
    let mut bdeg = vec![0u8; nv];
    for h in (0..arr.org.len() as u32).step_by(2) { if gof(h) != gof(h ^ 1) { for v in [arr.org[h as usize], arr.org[(h ^ 1) as usize]] { bdeg[v as usize] = bdeg[v as usize].saturating_add(1); } } }
    let fixed = |v: usize| -> bool { let p = arr.v[v]; bdeg[v] != 2 || designed.contains(&p) || p[0] == tx0[0] || p[0] == tx1[0] || p[1] == tz0[1] || p[1] == tz1[1] };
    let mut drop = vec![false; nv];
    {
        // each boundary vertex's two boundary half-edges out of it
        let mut outb: Vec<[u32; 2]> = vec![[u32::MAX; 2]; nv];
        for h in 0..arr.org.len() as u32 { if gof(h) != gof(h ^ 1) { let v = arr.org[h as usize] as usize; if bdeg[v] == 2 { let o = &mut outb[v]; if o[0] == u32::MAX { o[0] = h; } else if o[1] == u32::MAX && o[0] != h { o[1] = h; } } } }
        let mut seen = vec![false; nv];
        for v0 in 0..nv {
            if !fixed(v0) || bdeg[v0] < 2 { continue; }
            // walk each run of loose points from a fixed one
            for h0 in 0..arr.org.len() as u32 {
                if arr.org[h0 as usize] as usize != v0 || gof(h0) == gof(h0 ^ 1) { continue; }
                let mut run: Vec<usize> = vec![v0];
                let mut h = h0;
                loop {
                    let w = arr.org[(h ^ 1) as usize] as usize;
                    run.push(w);
                    if fixed(w) || seen[w] { break; }
                    seen[w] = true;
                    let o = outb[w];
                    let back = h ^ 1;
                    let nxt = if o[0] == back { o[1] } else { o[0] };
                    if nxt == u32::MAX { break; }
                    h = nxt;
                }
                if run.len() < 3 { continue; }
                let pts: Vec<P2> = run.iter().map(|&v| to_f(arr.v[v])).collect();
                let mut keep = vec![false; pts.len()];
                keep[0] = true; *keep.last_mut().unwrap() = true;
                let mut st = vec![(0usize, pts.len() - 1)];
                while let Some((i, j)) = st.pop() {
                    let mut best = 0; let mut bd = 0.01;
                    for k in i + 1..j { let (dd, _) = seg_dist(pts[k], pts[i], pts[j]); if dd > bd { bd = dd; best = k; } }
                    if best > 0 { keep[best] = true; st.push((i, best)); st.push((best, j)); }
                    else if dist(pts[i], pts[j]) > ix.rules.max_segment { let m = (i + j) / 2; if m > i && m < j { keep[m] = true; st.push((i, m)); st.push((m, j)); } }
                }
                for (k, &v) in run.iter().enumerate() { if !keep[k] && !fixed(v) { drop[v] = true; } }
            }
        }
    }
    rep.dropped_points = drop.iter().filter(|x| **x).count();
    let mut used = vec![false; arr.org.len()];
    let mut out_rings: HashMap<usize, Vec<Vec<P2>>> = HashMap::new();
    for h0 in 0..arr.org.len() as u32 {
        let g = gof(h0);
        if g == usize::MAX || used[h0 as usize] || gof(h0 ^ 1) == g { continue; }
        let lab = final_label[g];
        if matches!(lab.kind, Kind::None | Kind::Lot) { continue; }
        let mut ring = Vec::new();
        let mut h = h0;
        let mut guard = 0;
        loop {
            used[h as usize] = true;
            if !drop[arr.org[h as usize] as usize] { ring.push(to_f(arr.from(h))); }
            let mut x = arr.next[h as usize];
            let mut spin = 0;
            while gof(x ^ 1) == g { x = arr.next[(x ^ 1) as usize]; spin += 1; if spin > 10_000 { break; } }
            h = x;
            guard += 1;
            if h == h0 || guard > 2_000_000 || used[h as usize] { break; }
        }
        if ring.len() >= 3 { out_rings.entry(g).or_default().push(ring); }
    }
    let _ = Arr::twin;
    let mut keys: Vec<usize> = out_rings.keys().copied().collect();
    keys.sort();
    let mut out = Vec::new();
    for g in keys {
        let rs = out_rings.remove(&g).unwrap();
        let mut outers: Vec<(Vec<P2>, Vec<Vec<P2>>)> = Vec::new();
        let mut holes: Vec<Vec<P2>> = Vec::new();
        for r in rs { if area(&r) > 0.0 { outers.push((r, vec![])); } else { holes.push(r); } }
        for hring in holes {
            let probe = lerp(hring[0], hring[1], 0.5);
            let mut best: Option<(f64, usize)> = None;
            for (k, (o, _)) in outers.iter().enumerate() { let a = area(o); if pip(probe, o) && best.map_or(true, |b| a < b.0) { best = Some((a, k)); } }
            if let Some((_, k)) = best { outers[k].1.push(hring); }
        }
        for (o, hs) in outers {
            let mut rings = vec![o];
            rings.extend(hs);
            let a: f64 = rings.iter().map(|r| area(r)).sum();
            out.push(Piece { label: final_label[g], rings, area: a, bucket: fbucket[g] });
        }
    }
    rep.faces = bounded.len();
    rep.pieces = out.len();
    out
}

/// the height of a point of the design: on the road (its street's surface or its junction's plane), on a verge or
/// footpath (the kerb's top, towards the property line's design height), on an island (its kerbs' tops)
pub struct Surface<'a> { pub ix: &'a Index<'a>, pub h: &'a Heights, pub g: &'a Ground, pub loop_h: Vec<Vec<f64>> }
impl<'a> Surface<'a> {
    pub fn new(ix: &'a Index<'a>, h: &'a Heights, g: &'a Ground) -> Self {
        let d = ix.d;
        let loop_h = d.loops.iter().map(|lp| lp.verts.iter().map(|v| h.road(d, &v.road, v.p)).collect()).collect();
        Surface { ix, h, g, loop_h }
    }
    pub fn road(&self, p: P2, lab: Label) -> f64 {
        let d = self.ix.d;
        if lab.side == 2 { return self.h.planes[lab.owner as usize].at(p); }
        let l = lab.owner as usize;
        let (s, u, _) = d.streets[l].curve.project(p);
        self.h.on_street(d, l, s, u)
    }
    /// the kerb's top at a kerb hit (a ramp's lip there)
    pub fn kerb_top(&self, k: &KerbHit) -> f64 {
        let lp = &self.ix.d.loops[k.lp as usize];
        let n = lp.verts.len();
        let (i, j) = (k.i as usize, (k.i as usize + 1) % n);
        let h = self.loop_h[k.lp as usize][i] * (1.0 - k.t) + self.loop_h[k.lp as usize][j] * k.t;
        // the kerb's top, down to the ramp's lip across its flares
        let up = |v: usize| if self.ix.lip[k.lp as usize][v] { self.ix.rules.ramp_lip } else { self.ix.rules.kerb_height };
        h + up(i) * (1.0 - k.t) + up(j) * k.t
    }
    /// the property line's design height behind a kerb hit: the ground there, within the verge's slope limits
    pub fn boundary(&self, k: &KerbHit, depth: f64) -> f64 {
        let lp = &self.ix.d.loops[k.lp as usize];
        let n = lp.verts.len();
        let nv = norm(add(mul(lp.verts[k.i as usize].n, 1.0 - k.t), mul(lp.verts[(k.i as usize + 1) % n].n, k.t)));
        let top = self.kerb_top(k);
        let b = add(k.q, mul(nv, depth));
        let g = self.g.at(b[0], b[1]);
        g.clamp(top + self.ix.rules.verge_slope_min * depth, top + self.ix.rules.verge_slope_max * depth)
    }
    pub fn verge(&self, p: P2, lab: Label, hit: Option<KerbHit>) -> f64 {
        let Some(k) = hit.or_else(|| self.ix.kerb(p)) else { return self.g.at(p[0], p[1]) };
        let top = self.kerb_top(&k);
        if lab.kind == Kind::Island {
            // between its kerbs: the nearest kerb on the other side too, weighted by distance
            let mut buf = Vec::new();
            let dir = sub(k.q, p);
            let mut other: Option<(f64, f64)> = None;
            self.ix.kgrid.near(p, 25.0, &mut buf);
            for &s in &buf {
                let (li, i) = self.ix.kseg[s as usize];
                if li != k.lp { continue; }
                let lp = &self.ix.d.loops[li as usize];
                let n = lp.verts.len();
                let (a, b) = (lp.verts[i as usize].p, lp.verts[(i as usize + 1) % n].p);
                let (dd, t) = seg_dist(p, a, b);
                let q = lerp(a, b, t);
                if dot(sub(q, p), dir) >= 0.0 { continue; }
                if other.map_or(true, |o| dd < o.0) {
                    let kh = KerbHit { lp: li, i, t, d: dd, inside: true, q };
                    other = Some((dd, self.kerb_top(&kh)));
                }
            }
            return match other { Some((d2, h2)) if k.d + d2 > 1e-6 => (top * d2 + h2 * k.d) / (k.d + d2), _ => top };
        }
        let w = self.ix.bands(&k);
        if w.verge <= 0.01 { return top; }
        let b = self.boundary(&k, w.verge);
        let f = (k.d / w.verge).clamp(0.0, 1.0);
        top + (b - top) * f + if lab.kind == Kind::Footpath { 0.0 } else { 0.0 }
    }
    pub fn at(&self, p: P2, lab: Label) -> f64 {
        match lab.kind {
            Kind::Road => self.road(p, lab),
            Kind::Strip | Kind::Footpath | Kind::Gap | Kind::Island => self.verge(p, lab, None),
            _ => self.g.at(p[0], p[1]),
        }
    }
}
