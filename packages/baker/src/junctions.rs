//! Stage 5, junctions: the street graph's faces (city blocks, islands, medians) and, at every corner of every face,
//! a recognised pattern:
//!   kerb return: a circular arc tangent to both kerbs, its radius by the smaller road's class (rules);
//!   nose: the same with the nose radius, where two arms leave nearly together or the face is an island or median;
//!   cap: a dead end's half circle; join: a road going on round the outside of a bend (the arc round the node);
//!   taper: a road going on at another width (a smooth S between the two kerbs).
//! A face's kerb loop is its sides (each street side's kerb, an exact offset of its curve) and its corners, in turn,
//! tangent to tangent. Where two corners of one face meet along a short street they are merged into one (the street
//! is taken into the junction). Each arm's cut station (where its own carriageway starts) is the furthest reach of
//! the corners beside it; streets whose cuts meet are taken into one junction (a cluster of nodes).
use crate::clean::{Link, Network};
use crate::curve::Curve;
use crate::geom::*;
use crate::rules::Rules;
use crate::sections::{Section, Side};
use std::collections::{BTreeMap, HashMap};

pub struct Street { pub link: Link, pub curve: Curve, pub rev: Curve, pub sec: Section }
impl Street {
    pub fn len(&self) -> f64 { self.curve.length }
    /// the curve outward from an end (0: from a, 1: from b)
    pub fn out(&self, end: u8) -> &Curve { if end == 0 { &self.curve } else { &self.rev } }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ArmRef { pub link: usize, pub end: u8 }

#[derive(Clone, Debug, PartialEq)]
pub enum CornerKind { Fillet, Nose, Cap, Join, Taper, Sharp, Merged }

#[derive(Clone, Debug)]
pub struct Corner {
    pub a: ArmRef,
    pub b: ArmRef,
    /// tangent stations, outward from each arm's node
    pub ta: f64,
    pub tb: f64,
    pub kind: CornerKind,
    pub r: f64,
    /// from A's kerb to B's kerb, each with its normal into the face
    pub pts: Vec<(P2, P2)>,
    /// streets taken into this corner (merged)
    pub absorbed: Vec<usize>,
    /// the arc's centre (its points are concentric round it)
    pub centre: Option<P2>,
}

#[derive(Clone, Debug)]
pub struct Face {
    /// half-edges: (link, dir) dir 0 walks a to b; the face on the left
    pub hes: Vec<(usize, u8)>,
    pub corners: Vec<Corner>,
    pub island: bool,
    /// the unbounded face (round the whole network)
    pub outside: bool,
    /// too small to be anything but road (a sliver between streets that nearly meet): no kerb round it
    pub vanish: bool,
    pub area: f64,
    pub depth: f64,
}

/// what a kerb point's road height comes from
#[derive(Clone, Copy, Debug)]
pub enum RoadRef { Link { link: usize, s: f64, u: f64 }, Junction { cluster: usize } }

#[derive(Clone, Debug)]
pub struct LoopVertex {
    pub p: P2,
    /// unit normal into the face (away from the road)
    pub n: P2,
    /// the verge's bands here
    pub w: Side,
    pub road: RoadRef,
    /// for a concentric offset: the centre and radius (corner arcs), or None (a street side: exact curve offset)
    pub around: Option<(P2, f64, bool)>,
    pub side: Option<(usize, u8, f64)>,
}

pub struct KerbLoop { pub face: usize, pub verts: Vec<LoopVertex>, pub island: bool, pub outside: bool }

#[derive(Clone, Debug)]
pub struct Crossing { pub link: usize, pub s: f64, pub marked: bool, pub from_data: bool, pub at_junction: bool }

pub struct Design {
    pub streets: Vec<Street>,
    pub faces: Vec<Face>,
    pub loops: Vec<KerbLoop>,
    /// each node's cluster (one junction)
    pub cluster_of: HashMap<i64, usize>,
    pub clusters: Vec<Vec<i64>>,
    /// each street's carriageway between its cuts (None: taken into a junction)
    pub ribbon: Vec<Option<(f64, f64)>>,
    pub cut: HashMap<ArmRef, f64>,
    pub node_at: HashMap<i64, P2>,
    pub crossings: Vec<Crossing>,
    /// each street's stations (both kerbs, the crown, the cuts and ramp edges among them)
    pub stations: Vec<Vec<f64>>,
    /// the stations a street must have (its cuts, its crossings' edges)
    pub forced: Vec<Vec<f64>>,
    pub report: JunctionReport,
}

#[derive(Default, Debug, Clone, serde::Serialize)]
pub struct JunctionReport {
    pub faces: usize, pub islands: usize, pub vanished: usize, pub corners: usize, pub fillets: usize, pub noses: usize, pub caps: usize, pub joins: usize, pub tapers: usize,
    pub sharp: usize, pub merged: usize, pub shrunk: usize, pub absorbed: usize, pub clusters: usize,
    pub patterns: BTreeMap<String, usize>,
    pub crossings_data: usize, pub crossings_arms: usize, pub crossings_marked: usize,
}

fn arm_dir(st: &[Street], a: ArmRef) -> f64 {
    let c = st[a.link].out(a.end);
    let s = (c.length * 0.5).min(5.0);
    angle(sub(c.point(s), c.point(0.0)))
}
/// a point on an arm's kerb side: u > 0 its left (outward frame)
fn arm_off(st: &[Street], a: ArmRef, s: f64, u: f64) -> P2 { st[a.link].out(a.end).offset(s, u) }
fn arm_outer(st: &[Street], a: ArmRef) -> f64 { st[a.link].sec.outer }
/// the verge bands on an arm's side: left (outward frame) is link side `end`, right is the other
fn arm_side(st: &[Street], a: ArmRef, left: bool) -> Side { let k = if left { a.end } else { 1 - a.end }; st[a.link].sec.sides[k as usize].clone() }

/// a polyline offset of an arm (u in its outward frame), with the stations it was drawn at
fn offset_line(st: &[Street], a: ArmRef, u: f64, reach: f64, rules: &Rules) -> (Vec<P2>, Vec<f64>) {
    let c = st[a.link].out(a.end);
    let ss = c.stations(0.0, reach.min(c.length), u, rules.chord_tolerance * 2.0, 4.0);
    (ss.iter().map(|&s| c.offset(s, u)).collect(), ss)
}
/// the first crossing of two polylines along the first: (station on A, station on B, the point)
fn first_cross(pa: &(Vec<P2>, Vec<f64>), pb: &(Vec<P2>, Vec<f64>)) -> Option<(f64, f64, P2)> {
    let mut best: Option<(f64, f64, P2)> = None;
    let bb: Vec<BBox> = pb.0.windows(2).map(|w| BBox::of(w)).collect();
    for i in 0..pa.0.len().saturating_sub(1) {
        let (a0, a1) = (pa.0[i], pa.0[i + 1]);
        let ba = BBox::of(&[a0, a1]);
        for j in 0..pb.0.len().saturating_sub(1) {
            if !ba.hits(&bb[j]) { continue; }
            if let Some((t, u)) = seg_cross(a0, a1, pb.0[j], pb.0[j + 1]) {
                let sa = pa.1[i] + (pa.1[i + 1] - pa.1[i]) * t;
                let sb = pb.1[j] + (pb.1[j + 1] - pb.1[j]) * u;
                if best.map_or(true, |b| sa < b.0) { best = Some((sa, sb, lerp(a0, a1, t))); }
            }
        }
        if best.is_some() { break; }
    }
    best
}
fn arc_points(c: P2, r0: f64, r1: f64, a0: f64, sweep: f64, tol: f64, toward: bool) -> Vec<(P2, P2)> {
    // radius may change along (a spiral between two widths); normals: towards the centre (toward) or away
    let rm = r0.max(r1).max(1e-3);
    let dth = if rm > tol { 2.0 * (1.0 - tol / rm).clamp(-1.0, 1.0).acos() } else { 0.5 };
    let n = ((sweep.abs() / dth.max(0.02)).ceil() as usize).clamp(1, 512);
    (0..=n).map(|k| {
        let t = k as f64 / n as f64;
        let th = a0 + sweep * t;
        let r = r0 + (r1 - r0) * t;
        let d = [th.cos(), th.sin()];
        (add(c, mul(d, r)), if toward { mul(d, -1.0) } else { d })
    }).collect()
}

/// the corner between arm A (its right side faces the face) and arm B (its left side faces it)
fn corner(st: &[Street], node_at: &HashMap<i64, P2>, a: ArmRef, b: ArmRef, theta: f64, radius: f64, rules: &Rules, reach_a: f64, reach_b: f64) -> Corner {
    let oa = arm_outer(st, a);
    let ob = arm_outer(st, b);
    let tol = rules.chord_tolerance;
    let mk = |kind, ta, tb, r, pts, centre| Corner { a, b, ta, tb, kind, r, pts, absorbed: vec![], centre };
    if a == b {
        // a dead end: half a circle round the end
        let c = st[a.link].out(a.end);
        let (p0, t0) = c.frame(0.0);
        let ta = sub(p0, mul(left(t0), oa));
        let a0 = angle(sub(ta, p0));
        let _ = node_at;
        return mk(CornerKind::Cap, 0.0, 0.0, oa, arc_points(p0, oa, oa, a0, -std::f64::consts::PI, tol, false), Some(p0));
    }
    let deg = theta.to_degrees();
    if deg >= 179.0 {
        // round the outside of a bend (or straight on): the arc round the node, from one width to the other
        let p0 = st[a.link].out(a.end).point(0.0);
        let ta = arm_off(st, a, 0.0, -oa);
        let tb = arm_off(st, b, 0.0, ob);
        if (oa - ob).abs() < 0.3 || deg > 200.0 {
            let a0 = angle(sub(ta, p0));
            let a1 = angle(sub(tb, p0));
            let sweep = -wrap2pi(a0 - a1);
            let sweep = if sweep < -std::f64::consts::PI * 1.5 { 0.0 } else { sweep };
            let mut pts = arc_points(p0, oa, ob, a0, sweep, tol, false);
            pts[0].0 = ta;
            pts.last_mut().unwrap().0 = tb;
            return mk(CornerKind::Join, 0.0, 0.0, oa.min(ob), pts, Some(p0));
        }
    }
    let nose = deg < rules.nose_angle;
    let mut r = if nose { rules.nose_radius } else { radius };
    // nearly straight on: a corner reaching far along its arms is a change of width, a taper
    let far = |sa: f64, sb: f64, r: f64| deg > 150.0 && sa.max(sb) > (4.0 * r).max(25.0);
    let r_first = r;
    let near = |u_a: f64, u_b: f64| -> Option<(f64, f64, P2)> {
        let r1 = (6.0 * (oa + ob + r_first) + 20.0).min(reach_a.max(reach_b));
        let (pa, pb) = (offset_line(st, a, u_a, r1.min(reach_a), rules), offset_line(st, b, u_b, r1.min(reach_b), rules));
        if let Some(x) = first_cross(&pa, &pb) { return Some(x); }
        if r1 >= reach_a && r1 >= reach_b { return None; }
        first_cross(&offset_line(st, a, u_a, reach_a, rules), &offset_line(st, b, u_b, reach_b, rules))
    };
    for _ in 0..6 {
        if let Some((sa, sb, c)) = near(-(oa + r), ob + r).filter(|x| !far(x.0, x.1, r)) {
            let ta = arm_off(st, a, sa, -oa);
            let tb = arm_off(st, b, sb, ob);
            let a0 = angle(sub(ta, c));
            let a1 = angle(sub(tb, c));
            let sweep = wrap2pi(a1 - a0);
            // (a kerb return turns less than half round: more is the arc the wrong way round its centre)
            if sweep > std::f64::consts::PI * 1.02 { r *= 0.5; if r < 0.2 { break; } continue; }
            let mut pts = arc_points(c, r, r, a0, sweep, tol, true);
            pts[0].0 = ta;
            pts.last_mut().unwrap().0 = tb;
            return mk(if nose || r <= rules.nose_radius + 1e-9 { CornerKind::Nose } else { CornerKind::Fillet }, sa, sb, r, pts, Some(c));
        }
        r *= 0.5;
        if r < 0.2 { break; }
    }
    // the kerbs themselves where they cross: a sharp corner
    if let Some((sa, sb, x)) = near(-oa, ob).filter(|x| !far(x.0, x.1, 1.0)) {
        // (its two ends exactly on the two kerbs, where they cross)
        let na = mul(left(st[a.link].out(a.end).tangent(sa)), -1.0);
        let nb = left(st[b.link].out(b.end).tangent(sb));
        let _ = x;
        return mk(CornerKind::Sharp, sa, sb, 0.0, vec![(arm_off(st, a, sa, -oa), na), (arm_off(st, b, sb, ob), nb)], None);
    }
    // a taper: from A's kerb a little out to B's (a Hermite curve, tangent to both)
    let tau = (5.0 * (oa - ob).abs()).clamp(3.0, 20.0).min(reach_a * 0.45).min(reach_b * 0.45);
    let (pa0, ta0) = st[a.link].out(a.end).frame(tau);
    let (pb0, tb0) = st[b.link].out(b.end).frame(tau);
    let p0 = sub(pa0, mul(left(ta0), oa));
    let p1 = add(pb0, mul(left(tb0), ob));
    let d0 = mul(ta0, -1.0);
    let d1 = tb0;
    let l = dist(p0, p1).max(0.1);
    let n = ((l / 1.0).ceil() as usize).clamp(2, 64);
    let mut pts = Vec::new();
    for k in 0..=n {
        let t = k as f64 / n as f64;
        let h00 = 2.0 * t * t * t - 3.0 * t * t + 1.0; let h10 = t * t * t - 2.0 * t * t + t; let h01 = -2.0 * t * t * t + 3.0 * t * t; let h11 = t * t * t - t * t;
        let p = add(add(mul(p0, h00), mul(d0, h10 * l)), add(mul(p1, h01), mul(d1, h11 * l)));
        let dt = add(add(mul(p0, 6.0 * t * t - 6.0 * t), mul(d0, (3.0 * t * t - 4.0 * t + 1.0) * l)), add(mul(p1, -6.0 * t * t + 6.0 * t), mul(d1, (3.0 * t * t - 2.0 * t) * l)));
        pts.push((p, left(norm(dt))));
    }
    mk(CornerKind::Taper, tau, tau, 0.0, pts, None)
}

/// a face's kerb loop as a rough polygon (sides by their ends, corners by their points): to measure it
fn rough_ring(st: &[Street], f: &Face) -> Vec<P2> {
    let mut ring = Vec::new();
    for c in &f.corners { for (p, _) in &c.pts { ring.push(*p); } }
    let _ = st;
    ring
}
/// how deep a ring is: the largest distance from its outline of points inside (on a coarse grid)
fn depth_of(ring: &[P2]) -> f64 {
    let b = BBox::of(ring);
    if !b.ok() { return 0.0; }
    let w = (b.x1 - b.x0).max(b.z1 - b.z0);
    let step = (w / 40.0).clamp(0.5, 5.0);
    let mut best = 0.0f64;
    let mut x = b.x0 + step / 2.0;
    while x < b.x1 {
        let mut z = b.z0 + step / 2.0;
        while z < b.z1 {
            let p = [x, z];
            if pip(p, ring) {
                let mut d = f64::INFINITY;
                for i in 0..ring.len() { d = d.min(seg_dist(p, ring[i], ring[(i + 1) % ring.len()]).0); }
                best = best.max(d);
            }
            z += step;
        }
        x += step;
    }
    best
}

pub fn design(net: &Network, streets: Vec<Street>, rules: &Rules, points: &[crate::seed::Point]) -> Design {
    let st = &streets;
    let mut rep = JunctionReport::default();
    let node_at: HashMap<i64, P2> = net.nodes.iter().map(|(k, n)| (*k, n.at)).collect();
    // arms round each node, by angle
    let mut arms: HashMap<i64, Vec<ArmRef>> = HashMap::new();
    for (id, n) in &net.nodes {
        let mut v: Vec<ArmRef> = n.ends.iter().map(|&(l, e)| ArmRef { link: l, end: e }).collect();
        v.sort_by(|x, y| arm_dir(st, *x).partial_cmp(&arm_dir(st, *y)).unwrap().then(x.cmp(y)));
        arms.insert(*id, v);
    }
    let end_node = |l: usize, d: u8| -> i64 { if d == 0 { st[l].link.b } else { st[l].link.a } };
    // faces: walk each half-edge with the face on the left; at a node turn to the next arm clockwise
    let mut seen: HashMap<(usize, u8), usize> = HashMap::new();
    let mut faces: Vec<Face> = Vec::new();
    for l in 0..st.len() {
        for d in 0..2u8 {
            if seen.contains_key(&(l, d)) { continue; }
            let fi = faces.len();
            let mut hes = Vec::new();
            let (mut cl, mut cd) = (l, d);
            let mut guard = 0;
            loop {
                if seen.contains_key(&(cl, cd)) { break; }
                seen.insert((cl, cd), fi);
                hes.push((cl, cd));
                let n = end_node(cl, cd);
                let a = ArmRef { link: cl, end: if cd == 0 { 1 } else { 0 } };
                let list = &arms[&n];
                let i = list.iter().position(|x| *x == a).unwrap();
                let b = list[(i + list.len() - 1) % list.len()];
                cl = b.link; cd = b.end;
                guard += 1;
                if guard > 100000 { break; }
            }
            faces.push(Face { hes, corners: vec![], island: false, outside: false, vanish: false, area: 0.0, depth: 0.0 });
        }
    }
    // the corners of each face, with each corner's reach along its arms
    let build = |f: &Face, nose_all: bool| -> Vec<Corner> {
        let m = f.hes.len();
        (0..m).map(|k| {
            let (l, d) = f.hes[k];
            let (l2, d2) = f.hes[(k + 1) % m];
            let a = ArmRef { link: l, end: if d == 0 { 1 } else { 0 } };
            let b = ArmRef { link: l2, end: d2 };
            let theta = if a == b { std::f64::consts::TAU } else { wrap2pi(arm_dir(st, a) - arm_dir(st, b)) };
            let cls = st[l].link.cls.max(st[l2].link.cls);
            let r = if nose_all { rules.nose_radius } else { rules.corner_radius.at(cls) };
            corner(st, &node_at, a, b, theta, r, rules, st[l].len(), st[l2].len())
        }).collect()
    };
    // each face on its own (in parallel): its corners; islands and medians (a small or shallow face, measured on its
    // corners' points) rebuilt with noses; then conflicts (two corners meeting along a short side): shrink them,
    // else merge them across it (that street taken into the junction)
    let resolved: Vec<(Face, Vec<usize>, [usize; 2])> = crate::mesh::par_map(faces, |mut f| {
        f.corners = build(&f, false);
        let ring = rough_ring(st, &f);
        f.area = area(&ring);
        if f.area <= 0.0 { f.outside = true; } else {
            f.depth = depth_of(&ring);
            if f.area < rules.least_island_area || f.depth < rules.least_island_depth { f.vanish = true; }
            // a median: a face between one-way carriageways (and the short links across), no wider on average than
            // the rules' median width; an island: small or shallow
            let per: f64 = (0..ring.len()).map(|i| dist(ring[i], ring[(i + 1) % ring.len()])).sum();
            let mean_width = if per > 0.0 { 2.0 * f.area / per } else { 0.0 };
            let long_sides: Vec<&(usize, u8)> = f.hes.iter().filter(|(l, _)| st[*l].len() > 30.0).collect();
            let oneway_only = !long_sides.is_empty() && long_sides.iter().all(|(l, _)| st[*l].link.oneway || st[*l].link.roundabout);
            if f.area < rules.island_area || f.depth < rules.island_depth || (oneway_only && mean_width < rules.median_width) {
                f.island = true;
                f.corners = build(&f, true);
            }
        }
        let mut absorbed = Vec::new();
        let (mut shrunk, mut merged) = (0usize, 0usize);
        let mut guard = 0;
        loop {
            guard += 1;
            if guard > 200 || f.corners.len() < 2 { break; }
            let m = f.corners.len();
            let mut changed = false;
            for k in 0..m {
                let prev = (k + m - 1) % m;
                let (l, _) = f.hes[k];
                let ln = st[l].len();
                let used = f.corners[prev].tb + f.corners[k].ta;
                if used <= ln - 0.05 || f.corners[prev].kind == CornerKind::Cap && f.corners[k].kind == CornerKind::Cap { continue; }
                let can_shrink = [prev, k].iter().any(|&i| matches!(f.corners[i].kind, CornerKind::Fillet | CornerKind::Nose) && f.corners[i].r > 0.6);
                if can_shrink && f.corners[prev].absorbed.is_empty() && f.corners[k].absorbed.is_empty() {
                    let scale = (ln / used * 0.9).clamp(0.25, 0.7);
                    for &i in &[prev, k] {
                        let c = &f.corners[i];
                        if !matches!(c.kind, CornerKind::Fillet | CornerKind::Nose) || c.r <= 0.6 { continue; }
                        let (a, b, r) = (c.a, c.b, (c.r * scale).max(0.5));
                        let theta = wrap2pi(arm_dir(st, a) - arm_dir(st, b));
                        let mut nc = corner(st, &node_at, a, b, theta, r, rules, st[a.link].len(), st[b.link].len());
                        if nc.kind == CornerKind::Nose && r > rules.nose_radius { nc.kind = CornerKind::Fillet; }
                        if nc.r > r { nc.r = r; }
                        f.corners[i] = nc;
                    }
                    shrunk += 1;
                    changed = true;
                    break;
                }
                if m <= 2 { break; }
                let a = f.corners[prev].a;
                let b = f.corners[k].b;
                let theta = wrap2pi(arm_dir(st, a) - arm_dir(st, b));
                let r = f.corners[prev].r.min(f.corners[k].r).max(rules.nose_radius);
                let mut nc = corner(st, &node_at, a, b, if a == b { std::f64::consts::TAU } else { theta }, r, rules, st[a.link].len(), st[b.link].len());
                nc.kind = CornerKind::Merged;
                nc.absorbed = f.corners[prev].absorbed.iter().chain(f.corners[k].absorbed.iter()).copied().chain([l]).collect();
                absorbed.push(l);
                merged += 1;
                f.corners[prev] = nc;
                f.corners.remove(k);
                f.hes.remove(k);
                changed = true;
                break;
            }
            if !changed { break; }
        }
        (f, absorbed, [shrunk, merged])
    });
    let mut absorbed: Vec<bool> = vec![false; st.len()];
    let mut faces: Vec<Face> = Vec::with_capacity(resolved.len());
    for (f, ab, [sh, me]) in resolved { for l in ab { absorbed[l] = true; } rep.shrunk += sh; rep.merged += me; faces.push(f); }
    // cut stations: each arm's carriageway starts past both corners beside it
    let mut cut: HashMap<ArmRef, f64> = HashMap::new();
    for f in &faces {
        if f.vanish { continue; }
        for c in &f.corners {
            let ea = cut.entry(c.a).or_insert(0.0); *ea = ea.max(c.ta);
            let eb = cut.entry(c.b).or_insert(0.0); *eb = eb.max(c.tb);
        }
    }
    // clusters: nodes joined by absorbed streets, or by streets whose cuts meet
    let mut ids: Vec<i64> = net.nodes.keys().copied().collect();
    ids.sort();
    let idx: HashMap<i64, usize> = ids.iter().enumerate().map(|(i, n)| (*n, i)).collect();
    let mut parent: Vec<usize> = (0..ids.len()).collect();
    fn find(p: &mut Vec<usize>, i: usize) -> usize { let mut i = i; while p[i] != i { p[i] = p[p[i]]; i = p[i]; } i }
    let mut ribbon: Vec<Option<(f64, f64)>> = vec![None; st.len()];
    for (l, s) in st.iter().enumerate() {
        let ca = cut.get(&ArmRef { link: l, end: 0 }).copied().unwrap_or(0.0);
        let cb = cut.get(&ArmRef { link: l, end: 1 }).copied().unwrap_or(0.0);
        if absorbed[l] || ca + cb > s.len() - 1.0 {
            absorbed[l] = true;
            let (x, y) = (find(&mut parent, idx[&s.link.a]), find(&mut parent, idx[&s.link.b]));
            parent[x] = y;
        } else { ribbon[l] = Some((ca, s.len() - cb)); }
    }
    rep.absorbed = absorbed.iter().filter(|a| **a).count();
    let mut cluster_of: HashMap<i64, usize> = HashMap::new();
    let mut roots: HashMap<usize, usize> = HashMap::new();
    let mut clusters: Vec<Vec<i64>> = Vec::new();
    for n in &ids {
        let r = find(&mut parent, idx[n]);
        let c = *roots.entry(r).or_insert_with(|| { clusters.push(vec![]); clusters.len() - 1 });
        clusters[c].push(*n);
        cluster_of.insert(*n, c);
    }
    rep.clusters = clusters.len();
    // patterns at each cluster (for the report): by its arms' count and angles
    for (ci, nodes) in clusters.iter().enumerate() {
        let mut ext: Vec<ArmRef> = Vec::new();
        for n in nodes { for a in &arms[n] { if ribbon[a.link].is_some() || cluster_of[&if a.end == 0 { st[a.link].link.b } else { st[a.link].link.a }] != ci { ext.push(*a); } } }
        let ring = nodes.iter().any(|n| arms[n].iter().any(|a| st[a.link].link.roundabout));
        let name = if ring { "roundabout".to_string() } else {
            match ext.len() {
                0 => "none".into(), 1 => "dead end".into(), 2 => "joint".into(),
                3 => { let mut ang: Vec<f64> = ext.iter().map(|a| arm_dir(st, *a)).collect(); ang.sort_by(|a, b| a.partial_cmp(b).unwrap()); let gaps = [ang[1] - ang[0], ang[2] - ang[1], ang[0] + std::f64::consts::TAU - ang[2]]; if gaps.iter().any(|g| (g.to_degrees() - 180.0).abs() < 30.0) { "T".into() } else { "Y".into() } }
                4 => if nodes.len() > 1 { "X (divided)".into() } else { "X".into() },
                n => format!("{n} arms"),
            }
        };
        *rep.patterns.entry(name).or_default() += 1;
    }
    // crossings: mapped ones on a street's carriageway (moved out of a junction), and one at each arm of a junction
    let mut crossings: Vec<Crossing> = Vec::new();
    {
        let mut grid = Grid::new(25.0);
        for (l, s) in st.iter().enumerate() { if ribbon[l].is_some() { grid.add(&s.curve.bbox(), l as u32); } }
        let mut buf = Vec::new();
        for p in points {
            if p.tags.get("highway").map_or(true, |h| h != "crossing") { continue; }
            grid.near(p.at, 3.0, &mut buf);
            let mut best: Option<(f64, usize, f64)> = None;
            for &l in &buf {
                let s = &st[l as usize];
                let (ss, _, d) = s.curve.project(p.at);
                if d < 2.5 && best.map_or(true, |b| d < b.0) { best = Some((d, l as usize, ss)); }
            }
            let Some((_, l, mut s)) = best else { continue };
            let (s0, s1) = ribbon[l].unwrap();
            if !st[l].sec.kerbed || st[l].sec.sides.iter().all(|x| x.verge <= 0.0) { continue; }
            let half = 1.6;
            if s1 - s0 < 2.0 * half + 1.0 { continue; }
            s = s.clamp(s0 + half + 0.5, s1 - half - 0.5);
            let tags = format!("{} {}", p.tags.get("crossing").map(|s| s.as_str()).unwrap_or(""), p.tags.get("crossing:markings").map(|s| s.as_str()).unwrap_or(""));
            let marked = ["zebra", "marked", "uncontrolled", "traffic_signals"].iter().any(|k| tags.contains(k)) && !tags.contains("unmarked") || tags.contains("zebra");
            if crossings.iter().any(|c| c.link == l && (c.s - s).abs() < 6.0) { continue; }
            crossings.push(Crossing { link: l, s, marked, from_data: true, at_junction: false });
            rep.crossings_data += 1;
            if marked { rep.crossings_marked += 1; }
        }
        for nodes in clusters.iter() {
            let narms: usize = nodes.iter().map(|n| arms[n].iter().filter(|a| ribbon[a.link].is_some()).count()).sum();
            if narms < 3 { continue; }
            for n in nodes {
                for a in &arms[n] {
                    let Some((s0, s1)) = ribbon[a.link] else { continue };
                    let s = &st[a.link];
                    if !s.sec.kerbed || s.sec.sides.iter().any(|x| x.footpath <= 0.0) { continue; }
                    let at = if a.end == 0 { s0 + 2.5 } else { s1 - 2.5 };
                    if s1 - s0 < 8.0 { continue; }
                    if crossings.iter().any(|c| c.link == a.link && (c.s - at).abs() < 15.0) { continue; }
                    crossings.push(Crossing { link: a.link, s: at, marked: false, from_data: false, at_junction: true });
                    rep.crossings_arms += 1;
                }
            }
        }
    }
    // the stations every street must have: its cuts, and each crossing's ramp and link edges
    let mut forced: Vec<Vec<f64>> = vec![Vec::new(); st.len()];
    for (l, r) in ribbon.iter().enumerate() { if let Some((s0, s1)) = r { forced[l].extend([*s0, *s1]); } }
    // (the link across the nature strip as wide as the ramp: one station each side)
    // (and the flares either side, where the kerb comes down to the ramp's lip)
    for c in &crossings { let (h, f) = (rules.ramp_width / 2.0, rules.ramp_width / 2.0 + rules.ramp_flare); forced[c.link].extend([c.s - f, c.s - h, c.s + h, c.s + f]); }
    for f in &faces {
        rep.faces += 1;
        if f.island && !f.vanish { rep.islands += 1; }
        if f.vanish { rep.vanished += 1; }
        for c in &f.corners {
            rep.corners += 1;
            match c.kind { CornerKind::Fillet => rep.fillets += 1, CornerKind::Nose => rep.noses += 1, CornerKind::Cap => rep.caps += 1, CornerKind::Join => rep.joins += 1, CornerKind::Taper => rep.tapers += 1, CornerKind::Sharp => rep.sharp += 1, CornerKind::Merged => {} }
        }
    }
    Design { streets, faces, loops: vec![], cluster_of, clusters, ribbon, cut, node_at, crossings, stations: vec![], forced, report: rep }
}

/// Each street's stations (one set for both its kerbs and its crown, so a carriageway is cut straight across at each
/// and each verge band radially): its arcs' (within the chord tolerance), the ones its heights need (`vertical`:
/// where the surface stops being straight within a centimetre), its cuts and crossings; at most `max_segment` apart.
/// Then each face's kerb loop: its sides at their exact offsets at those stations, its corners between.
pub fn kerb_loops(d: &mut Design, rules: &Rules, vertical: &dyn Fn(usize) -> Vec<f64>) {
    let st = &d.streets;
    let faces = &d.faces;
    let cluster_of = &d.cluster_of;
    let stations: Vec<Vec<f64>> = (0..st.len()).map(|l| {
        let s = &st[l];
        let ln = s.len();
        let mut ss: Vec<f64> = Vec::new();
        let w = s.sec.outer + s.sec.sides.iter().map(|x| x.verge).fold(0.0, f64::max);
        ss.extend(s.curve.band_stations(0.0, ln, w, rules.chord_tolerance, rules.max_segment));
        ss.extend(vertical(l));
        ss.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mut fs: Vec<f64> = d.forced[l].clone();
        fs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        fs.dedup();
        // the forced stations win: plain ones within the least station spacing of them go, and of each other
        let gap = rules.least_station;
        let mut plain: Vec<f64> = Vec::new();
        for x in ss { if fs.iter().all(|f| (f - x).abs() >= gap) && plain.last().map_or(true, |l| x - l >= gap) { plain.push(x); } }
        let mut out: Vec<f64> = plain;
        out.extend(fs.iter().copied().filter(|x| *x > 0.0 && *x < ln));
        out.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mut dd: Vec<f64> = Vec::with_capacity(out.len());
        for x in out { if dd.last().map_or(true, |l| x - l >= 0.02) { dd.push(x); } }
        dd
    }).collect();
    let mut loops = Vec::new();
    for (fi, f) in faces.iter().enumerate() {
        if f.vanish { continue; }
        let m = f.hes.len();
        // a side its two corners overran (a conflict the corners could not settle): an island so knotted is road;
        // elsewhere the corners are joined across it
        let overrun: Vec<bool> = (0..m).map(|k| { let (l, _) = f.hes[k]; f.corners[(k + m - 1) % m].tb + f.corners[k].ta > st[l].len() + 0.01 && m > 1 }).collect();
        if f.island && overrun.iter().any(|x| *x) { continue; }
        let mut verts: Vec<LoopVertex> = Vec::new();
        for k in 0..m {
            let (l, d) = f.hes[k];
            let s = &st[l];
            let prev = &f.corners[(k + m - 1) % m];
            let next = &f.corners[k];
            // corner prev's points (from its A kerb to this side's start)
            let cl = cluster_of[&if d == 0 { s.link.a } else { s.link.b }];
            let wa = arm_side(st, prev.a, false);
            let wb = arm_side(st, prev.b, true);
            let np = prev.pts.len();
            for (i, (p, n)) in prev.pts.iter().enumerate() {
                if i == np - 1 { break; } // the side starts there
                let t = if np > 1 { i as f64 / (np - 1) as f64 } else { 0.0 };
                // concentric round the corner's centre: towards it (a kerb return, the face inside the arc) or away
                let around = prev.centre.map(|c| (c, dist(*p, c), matches!(prev.kind, CornerKind::Fillet | CornerKind::Nose | CornerKind::Merged)));
                verts.push(LoopVertex { p: *p, n: *n, w: lerp_side(&wa, &wb, t), road: RoadRef::Junction { cluster: cl }, around, side: None });
            }
            // the side: link stations from the start trim to the end trim
            let ln = s.len();
            let (s_from, s_to) = if d == 0 { (prev.tb, ln - next.ta) } else { (ln - prev.tb, next.ta) };
            let u = if d == 0 { s.sec.outer } else { -s.sec.outer };
            let (lo, hi) = (s_from.min(s_to), s_from.max(s_to));
            if overrun[k] { continue; }
            // its ends (the corners' tangent points), the street's stations between
            let mut ss: Vec<f64> = vec![lo];
            ss.extend(stations[l].iter().copied().filter(|x| *x > lo + 0.02 && *x < hi - 0.02));
            if hi > lo { ss.push(hi); }
            if d == 1 { ss.reverse(); }
            let w = s.sec.sides[d as usize].clone();
            for &x in &ss {
                let (_, t) = s.curve.frame(x);
                let nrm = if d == 0 { left(t) } else { mul(left(t), -1.0) };
                verts.push(LoopVertex { p: s.curve.offset(x, u), n: nrm, w: w.clone(), road: RoadRef::Link { link: l, s: x, u }, around: None, side: Some((l, d, x)) });
            }
        }
        // a corner's first point is the previous side's last: drop the duplicate
        let mut clean: Vec<LoopVertex> = Vec::with_capacity(verts.len());
        for v in verts { if clean.last().map_or(true, |l: &LoopVertex| dist(l.p, v.p) > 1e-4) { clean.push(v); } }
        if clean.len() > 2 && dist(clean[0].p, clean.last().unwrap().p) < 1e-4 { clean.pop(); }
        loops.push(KerbLoop { face: fi, verts: clean, island: f.island, outside: f.outside });
    }
    d.stations = stations;
    d.loops = loops;
}

pub fn lerp_side(a: &Side, b: &Side, t: f64) -> Side {
    // a street without a verge on one side (a service lane): the verge keeps the other's
    let (a, b) = if a.verge <= 0.0 { (b, b) } else if b.verge <= 0.0 { (a, a) } else { (a, b) };
    let f = |x: f64, y: f64| x + (y - x) * t;
    Side { verge: f(a.verge, b.verge), strip: f(a.strip, b.strip), footpath: f(a.footpath, b.footpath), gap: f(a.gap, b.gap), from_data: a.from_data && b.from_data }
}
