//! Stage 8, mesh: the partition's faces as the pack's pieces (each at its points' design heights), the kerb along
//! every kerb loop (a ramp where a crossing meets it), the property line, the markings (lane lines only along a
//! street's own carriageway, never through a junction; stop and give-way lines at its cut; zebra stripes at marked
//! crossings), the walking graph, the clamp, and the ground conformed to the design.
use crate::geom::*;
use crate::heights::Heights;
use crate::junctions::Design;
use crate::partition::{Index, Kind, Label, Lines, Surface, TileOut};
use crate::rules::Rules;
use crate::seed::Seed;
use serde_json::{json, Value};
use std::collections::HashMap;

pub type P3 = [f64; 3];
#[derive(Clone, Debug)]
pub enum Piece {
    Area { kind: &'static str, info: usize, rings: Vec<Vec<P3>> },
    Poly { kind: &'static str, info: usize, ring: Vec<P3> },
    Edge { kind: &'static str, info: usize, pts: Vec<[f64; 6]> },
    /// lines side by side, as many points each: quads between neighbours
    Strip { kind: &'static str, info: usize, edges: Vec<Vec<P3>> },
}
impl Piece {
    pub fn kind(&self) -> &'static str { match self { Piece::Area { kind, .. } | Piece::Poly { kind, .. } | Piece::Edge { kind, .. } | Piece::Strip { kind, .. } => kind } }
    pub fn info(&self) -> usize { match self { Piece::Area { info, .. } | Piece::Poly { info, .. } | Piece::Edge { info, .. } | Piece::Strip { info, .. } => *info } }
    /// the mean of its points (the tile it goes in)
    pub fn middle(&self) -> P2 {
        let (mut x, mut z, mut n) = (0.0, 0.0, 0.0);
        match self {
            Piece::Area { rings, .. } => for q in &rings[0] { x += q[0]; z += q[1]; n += 1.0; },
            Piece::Poly { ring, .. } => for q in ring { x += q[0]; z += q[1]; n += 1.0; },
            Piece::Edge { pts, .. } => for q in pts { x += q[0]; z += q[1]; n += 1.0; },
            Piece::Strip { edges, .. } => for e in edges { for q in e { x += q[0]; z += q[1]; n += 1.0; } },
        }
        [x / n, z / n]
    }
}
pub struct Info { pub kind: &'static str, pub props: Value }

pub struct Terrain { pub x0: f64, pub z0: f64, pub step: f64, pub nx: usize, pub nz: usize, pub data: Vec<f64> }
impl Terrain {
    pub fn at(&self, x: f64, z: f64) -> f64 {
        let fx = ((x - self.x0) / self.step).clamp(0.0, (self.nx - 1) as f64 - 1e-9);
        let fz = ((z - self.z0) / self.step).clamp(0.0, (self.nz - 1) as f64 - 1e-9);
        let (i, j) = (fx.floor() as usize, fz.floor() as usize);
        let (u, v) = (fx - i as f64, fz - j as f64);
        let q = j * self.nx + i;
        let d = &self.data;
        (d[q] * (1.0 - u) + d[q + 1] * u) * (1.0 - v) + (d[q + self.nx] * (1.0 - u) + d[q + self.nx + 1] * u) * v
    }
}

pub struct Out {
    pub pieces: Vec<Piece>,
    pub infos: Vec<Info>,
    pub clamp_cells: Vec<Vec<Vec<P3>>>,
    pub clamp_edges: Vec<Vec<P3>>,
    pub terrain: Terrain,
    pub walk: Vec<(&'static str, Vec<P2>)>,
    pub report: MeshReport,
    /// each kerb loop point's road height
    pub loop_h: Vec<Vec<f64>>,
}
#[derive(Default, Debug, Clone, serde::Serialize)]
pub struct MeshReport {
    pub strips: usize,
    pub walk_crossings: usize,
    pub walk_joined: usize,
    pub area_pieces: usize, pub kerb_m: f64, pub ramp_m: f64, pub kerb_open_m: f64, pub property_line_m: f64, pub markings: usize, pub zebras: usize,
    pub stop_lines: usize, pub carriageway_m2: f64, pub footpath_m2: f64, pub verge_m2: f64, pub island_m2: f64,
    pub cut_cells: usize, pub fill_cells: usize, pub max_cut_m: f64, pub max_fill_m: f64,
}

fn road_info(d: &Design, l: usize, rules: &Rules) -> Value {
    let s = &d.streets[l];
    let (lanes, cw) = crate::sections::carriageway(&s.link, rules);
    json!({ "name": if s.link.name.is_empty() { "unnamed road".to_string() } else { s.link.name.clone() }, "highway": s.link.tags.get("highway"), "lanes": lanes, "carriageway (m)": (cw * 10.0).round() / 10.0, "oneway": s.link.oneway, "layer": 0,
        "osm": s.link.ways.iter().map(|w| w.to_string()).collect::<Vec<_>>().join(" "), "source": "OpenStreetMap (ODbL), designed (baker)" })
}

pub fn assemble(seed: &Seed, d: &Design, h: &Heights, ix: &Index, ln: &Lines, tiles: &[TileOut], rules: &Rules) -> Out {
    let mut rep = MeshReport::default();
    let g = &seed.ground;
    let surf = Surface::new(ix, h, g);
    // infos: one per street, one per junction, then the verge's
    let mut infos: Vec<Info> = d.streets.iter().enumerate().map(|(l, _)| Info { kind: "road", props: road_info(d, l, rules) }).collect();
    let jbase = infos.len();
    for (c, nodes) in d.clusters.iter().enumerate() {
        let mut names: Vec<String> = Vec::new();
        let mut osm: Vec<String> = Vec::new();
        for (l, s) in d.streets.iter().enumerate() {
            if d.cluster_of[&s.link.a] == c || d.cluster_of[&s.link.b] == c {
                if !s.link.name.is_empty() && !names.contains(&s.link.name) { names.push(s.link.name.clone()); }
                for w in &s.link.ways { let w = w.to_string(); if !osm.contains(&w) { osm.push(w); } }
                let _ = l;
            }
        }
        let name = if names.is_empty() { "junction".to_string() } else { names.join(" / ") };
        infos.push(Info { kind: "road", props: json!({ "name": name, "what": "junction", "nodes": nodes.len(), "osm": osm.join(" "), "source": "OpenStreetMap (ODbL), designed (baker)" }) });
    }
    let fid = infos.len(); infos.push(Info { kind: "footpath", props: json!({ "what": "footpath", "source": "designed from the street's cross-section (baker)" }) });
    let nid = infos.len(); infos.push(Info { kind: "nature strip", props: json!({ "what": "nature strip", "source": "designed from the street's cross-section (baker)" }) });
    let iid = infos.len(); infos.push(Info { kind: "nature strip", props: json!({ "what": "island", "source": "a small face between kerbs (baker)" }) });
    let pid = infos.len(); infos.push(Info { kind: "nature strip", props: json!({ "what": "property line", "source": "the verge's outer edge (baker)" }) });
    let info_of = |lab: Label| -> usize { match lab.kind { Kind::Road => if lab.side == 2 { jbase + lab.owner as usize } else { lab.owner as usize }, Kind::Footpath => fid, Kind::Island => iid, _ => nid } };

    // the ground conformed to the design: under the roads and verges a little below them, the lots blending back
    let mut terrain = Terrain { x0: g.x0, z0: g.z0, step: g.step, nx: g.nx, nz: g.nz, data: g.data.iter().map(|v| *v as f64).collect() };
    {
        let rows: Vec<Vec<(usize, f64)>> = par_map((0..g.nz).collect(), |j| {
            let mut row = Vec::new();
            for i in 0..g.nx {
                let p = [g.x0 + i as f64 * g.step, g.z0 + j as f64 * g.step];
                if !ix.frame.has(p) { continue; }
                let raw = g.data[j * g.nx + i] as f64;
                let (lab, hit) = ix.label_within(p, 64.0);
                let t = match lab.kind {
                    Kind::Road => Some(surf.road(p, lab) - 0.35),
                    Kind::Strip | Kind::Footpath | Kind::Gap | Kind::Island => Some(surf.verge(p, lab, hit) - 0.12),
                    Kind::Lot => hit.and_then(|k| {
                        let lp = &d.loops[k.lp as usize];
                        if lp.island { return None; }
                        let w = ix.bands(&k);
                        if w.verge <= 0.01 { return None; }
                        let beyond = k.d - w.verge;
                        let b = surf.boundary(&k, w.verge);
                        // a shoulder level with the property line, then back to its own ground over the batter
                        let shoulder = rules.boundary_shoulder;
                        let reach = rules.batter_reach.max(2.0 * (raw - b).abs()).min(30.0);
                        if beyond > shoulder + reach { return None; }
                        let t = smooth(((beyond - shoulder) / reach).max(0.0));
                        Some(b - 0.02 + (raw - b + 0.02) * t)
                    }),
                    Kind::None => None,
                };
                if let Some(t) = t { row.push((i, t)); }
            }
            row
        });
        for (j, row) in rows.into_iter().enumerate() {
            for (i, t) in row {
                let q = j * g.nx + i;
                let raw = terrain.data[q];
                if t < raw { rep.cut_cells += 1; rep.max_cut_m = rep.max_cut_m.max(raw - t); } else { rep.fill_cells += 1; rep.max_fill_m = rep.max_fill_m.max(t - raw); }
                terrain.data[q] = t;
            }
        }
    }

    let mut pieces: Vec<Piece> = Vec::new();
    let mut clamp_cells: Vec<Vec<Vec<P3>>> = Vec::new();
    let mut clamp_edges: Vec<Vec<P3>> = Vec::new();
    // the partition's faces
    // one height per point of the carriageway: a point shared by pieces of different streets or junctions (where
    // they touch with no cut between them) takes the junction's plane, else the streets' mean; a point on a tile's
    // edge takes the streets and junctions round it (the same from both tiles)
    let per_tile: Vec<Vec<(Piece, bool)>> = par_map(tiles.iter().collect(), |t| {
        let (x0, z0) = (t.ix as f64 * 500.0, t.iz as f64 * 500.0);
        let on_edge = |q: P2| (q[0] - x0).abs() < 1e-6 || (q[0] - x0 - 500.0).abs() < 1e-6 || (q[1] - z0).abs() < 1e-6 || (q[1] - z0 - 500.0).abs() < 1e-6;
        let key = |q: P2| ((q[0] * 1000.0).round() as i64, (q[1] * 1000.0).round() as i64);
        let mut owners: HashMap<(i64, i64), Vec<Label>> = HashMap::new();
        for p in &t.pieces { if p.label.kind != Kind::Road { continue; } for r in &p.rings { for q in r { let e = owners.entry(key(*q)).or_default(); if !e.contains(&p.label) { e.push(p.label); } } } }
        let mut memo: HashMap<(i64, i64), f64> = HashMap::new();
        let mut road_h = |q: P2, lab: Label| -> f64 {
            let k = key(q);
            if let Some(h) = memo.get(&k) { return *h; }
            let mut labs: Vec<Label> = if on_edge(q) {
                let mut v: Vec<Label> = Vec::new();
                for a in 0..8 { let th = a as f64 * std::f64::consts::PI / 4.0 + 0.1; let (l2, _) = ix.label([q[0] + 0.02 * th.cos(), q[1] + 0.02 * th.sin()]); if l2.kind == Kind::Road && !v.contains(&l2) { v.push(l2); } }
                v
            } else { owners.get(&k).cloned().unwrap_or_default() };
            if labs.is_empty() { labs.push(lab); }
            // a junction's plane wins where it touches a street's carriageway (its own area stays planar, so the
            // device's triangles of it are right whichever way they fall); streets touching each other: their mean
            if labs.iter().any(|l| l.side == 2) { labs.retain(|l| l.side == 2); }
            labs.sort();
            let h = labs.iter().map(|l| surf.road(q, *l)).sum::<f64>() / labs.len() as f64;
            memo.insert(k, h);
            h
        };
        let mut vmemo: HashMap<((i64, i64), bool), f64> = HashMap::new();
        let mut v: Vec<(Piece, bool)> = Vec::new();
        // each face at its points' heights; then the runs of four-cornered pieces along a street (its carriageway's
        // halves, its verge's bands, station to station) written as strips (quads between two lines, each point once)
        struct Q { lab: Label, run: (u32, usize, u8), a: [P3; 2], b: [P3; 2], s: f64 }
        let mut quads: Vec<Q> = Vec::new();
        let probe: Option<P2> = std::env::var("BAKER_AT").ok().and_then(|v| { let w: Vec<f64> = v.split(',').filter_map(|x| x.parse().ok()).collect(); if w.len() == 2 { Some([w[0], w[1]]) } else { None } });
        for p in &t.pieces {
            if let Some(q) = probe { if crate::geom::pip(q, &p.rings[0]) { let lab = ix.label(q); eprintln!("AT {:?} piece label {:?} bucket {} vertices {} | label there {:?}; ribbon of {}: {:?}", q, p.label, p.bucket, p.rings[0].len(), lab.0, p.label.owner, if p.label.side != 2 && p.label.kind == Kind::Road { d.ribbon[p.label.owner as usize] } else { None }); } }
            let kind: &'static str = match p.label.kind { Kind::Road => "carriageway", Kind::Footpath => "footpath", Kind::Strip | Kind::Gap | Kind::Island => "verge", _ => continue };
            let rings: Vec<Vec<P3>> = p.rings.iter().map(|r| r.iter().map(|q| [q[0], q[1], if p.label.kind == Kind::Road { road_h(*q, p.label) } else { *vmemo.entry((key(*q), p.label.kind == Kind::Island)).or_insert_with(|| surf.at(*q, p.label)) }]).collect()).collect();
            // which street a piece runs along (a ribbon's own; a verge band's side street)
            let street = match p.label.kind {
                Kind::Road if p.label.side != 2 => Some(p.label.owner as usize),
                Kind::Strip | Kind::Footpath | Kind::Gap => { let lp = &d.loops[p.label.owner as usize]; lp.verts.get(p.bucket as usize).and_then(|x| x.side).filter(|_| lp.verts.get((p.bucket as usize + 1) % lp.verts.len()).map_or(false, |y| y.side.is_some())).map(|x| x.0) }
                _ => None,
            };
            if let (Some(l), true) = (street, rings.len() == 1 && rings[0].len() == 4) {
                let c = &d.streets[l].curve;
                let mut pts: Vec<(f64, f64, P3)> = rings[0].iter().map(|q| { let (s, u, _) = c.project([q[0], q[1]]); (s, u.abs(), *q) }).collect();
                pts.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap());
                let (e0, e1) = ((pts[0], pts[1]), (pts[2], pts[3]));
                if (e0.0 .0 - e0.1 .0).abs() < 0.002 && (e1.0 .0 - e1.1 .0).abs() < 0.002 && e1.0 .0 - e0.0 .0 > 0.01 {
                    let ord = |a: (f64, f64, P3), b: (f64, f64, P3)| if a.1 <= b.1 { [a.2, b.2] } else { [b.2, a.2] };
                    let band = match p.label.kind { Kind::Road => 0u8, Kind::Strip => 1, Kind::Footpath => 2, _ => 3 };
                    quads.push(Q { lab: p.label, run: (p.label.owner, l, band), a: ord(e0.0, e0.1), b: ord(e1.0, e1.1), s: e0.0 .0 });
                    continue;
                }
            }
            if std::env::var("BAKER_DEBUG").is_ok() { let why = if street.is_none() { "no street" } else if rings.len() != 1 { "holes" } else if rings[0].len() != 4 { "not four" } else { "not square to its street" }; eprintln!("AREA {:?} {} {} {} {}", p.label.kind, p.label.side, why, rings.iter().map(|r| r.len()).sum::<usize>(), rings[0].iter().map(|q| format!("({:.3},{:.3})", q[0], q[1])).collect::<Vec<_>>().join(" ")); }
            v.push((Piece::Area { kind, info: info_of(p.label), rings }, true));
        }
        // chains: a quad whose start is the last one's end
        quads.sort_by(|x, y| x.run.cmp(&y.run).then(x.lab.side.cmp(&y.lab.side)).then(x.s.partial_cmp(&y.s).unwrap()));
        let k2 = |q: &P3| key([q[0], q[1]]);
        let mut i = 0;
        while i < quads.len() {
            let mut j = i + 1;
            while j < quads.len() && quads[j].run == quads[i].run && quads[j].lab == quads[i].lab && k2(&quads[j].a[0]) == k2(&quads[j - 1].b[0]) && k2(&quads[j].a[1]) == k2(&quads[j - 1].b[1]) { j += 1; }
            let q0 = &quads[i];
            let kind: &'static str = match q0.lab.kind { Kind::Road => "carriageway", Kind::Footpath => "footpath", _ => "verge" };
            let mut inner = vec![q0.a[0]];
            let mut outer = vec![q0.a[1]];
            for q in &quads[i..j] { inner.push(q.b[0]); outer.push(q.b[1]); }
            v.push((Piece::Strip { kind, info: info_of(q0.lab), edges: vec![inner, outer] }, true));
            i = j;
        }
        v
    });
    if std::env::var("BAKER_DEBUG").is_ok() {
        // where two carriageway pieces give one point two heights: which labels
        let mut at: HashMap<(i64, i64), Vec<(Label, f64)>> = HashMap::new();
        for t in tiles { for p in &t.pieces { if p.label.kind != Kind::Road { continue; } for r in &p.rings { for q in r { at.entry(((q[0] * 1000.0).round() as i64, (q[1] * 1000.0).round() as i64)).or_default().push((p.label, surf.at(*q, p.label))); } } } }
        let mut bad: Vec<(f64, (i64, i64), Vec<(Label, f64)>)> = at.into_iter().filter_map(|(k, v)| { let lo = v.iter().map(|x| x.1).fold(f64::INFINITY, f64::min); let hi = v.iter().map(|x| x.1).fold(f64::NEG_INFINITY, f64::max); if hi - lo > 0.01 { Some((hi - lo, k, v)) } else { None } }).collect();
        bad.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
        let kxv = crate::seed::kx(seed.origin[1]);
        eprintln!("seams: {} points with two heights", bad.len());
        for (dh, k, v) in bad.iter().take(25) { let (x, z) = (k.0 as f64 / 1000.0, k.1 as f64 / 1000.0); eprintln!("  {:.3} m at {:.6},{:.6} ({x:.1},{z:.1}): {:?}", dh, seed.origin[0] + x / kxv, seed.origin[1] - z / 110574.0, v.iter().map(|(l, h)| format!("{}{}:{:.2}", if l.side == 2 { "J" } else { "S" }, l.owner, h)).collect::<Vec<_>>()); }
    }
    for t in per_tile { for (p, _) in t { if let Piece::Strip { edges, kind, .. } = &p {
        let ring: Vec<P3> = edges[0].iter().copied().chain(edges[1].iter().rev().copied()).collect();
        let a = area(&ring.iter().map(|q| [q[0], q[1]]).collect::<Vec<_>>()).abs();
        match *kind { "carriageway" => rep.carriageway_m2 += a, "footpath" => rep.footpath_m2 += a, _ => rep.verge_m2 += a }
        if *kind == "carriageway" { clamp_cells.push(vec![ring]); }
        rep.strips += 1;
    } if let Piece::Area { rings, kind, .. } = &p {
        let a: f64 = rings.iter().map(|r| area(&r.iter().map(|q| [q[0], q[1]]).collect::<Vec<_>>())).sum();
        match *kind { "carriageway" => rep.carriageway_m2 += a, "footpath" => rep.footpath_m2 += a, _ => rep.verge_m2 += a }
        // the clamp: the carriageway's cells (the ground under the verges is the conformed grid's, and the kerb and
        // property lines' clamp edges)
        if *kind == "carriageway" { clamp_cells.push(rings.clone()); }
    } rep.area_pieces += 1; pieces.push(p); } }

    // the kerb: along each loop where the road is on its one side and not on the other
    let ground_at = |p: P2| terrain.at(p[0], p[1]);
    for (li, lp) in d.loops.iter().enumerate() {
        let n = lp.verts.len();
        if n < 2 { continue; }
        let mut run: Vec<[f64; 6]> = Vec::new();
        let mut run_kind: &'static str = "";
        let mut run_info = 0usize;
        let mut run_tile = (i32::MIN, i32::MIN);
        let mut clamp_line: Vec<P3> = Vec::new();
        let flush = |run: &mut Vec<[f64; 6]>, kind: &'static str, info: usize, pieces: &mut Vec<Piece>| { if run.len() > 1 { pieces.push(Piece::Edge { kind, info, pts: std::mem::take(run) }); } else { run.clear(); } };
        // a kerb point (its top drawn 150 mm over it): in a ramp's flare, set down so its top comes down to the lip
        let point = |i: usize, kind: &str| -> [f64; 6] {
            let v = &lp.verts[i];
            let road = surf.loop_h[li][i];
            let hh = if kind == "kerb" && ix.lip[li][i] { road + rules.ramp_lip - rules.kerb_height } else { road };
            [v.p[0], v.p[1], hh, ground_at(v.p).min(road), -v.n[0] * rules.kerb_width, -v.n[1] * rules.kerb_width]
        };
        for i in 0..n {
            let j = (i + 1) % n;
            let (a, b) = (lp.verts[i].p, lp.verts[j].p);
            let m = lerp(a, b, 0.5);
            let nn = norm(add(lp.verts[i].n, lp.verts[j].n));
            let ok = ix.frame.has(m) && {
                let (road, _) = ix.label(sub(m, mul(nn, 0.3)));
                let (face, _) = ix.label(add(m, mul(nn, 0.3)));
                road.kind == Kind::Road && !matches!(face.kind, Kind::Road | Kind::None)
            };
            let l = dist(a, b);
            if !ok {
                if ix.frame.has(m) { rep.kerb_open_m += l; }
                flush(&mut run, run_kind, run_info, &mut pieces);
                if clamp_line.len() > 1 { clamp_edges.push(gentle(std::mem::take(&mut clamp_line), 0.25)); } else { clamp_line.clear(); }
                continue;
            }
            let street = lp.verts[i].side.map(|s| s.0).or(lp.verts[j].side.map(|s| s.0));
            let kerbed = street.map_or(true, |s| d.streets[s].sec.kerbed);
            let kind = if ix.lip[li][i] && ix.lip[li][j] { "ramp" } else if kerbed { "kerb" } else { "edge" };
            let info = match street { Some(s) => s, None => match lp.verts[i].road { crate::junctions::RoadRef::Junction { cluster } => jbase + cluster, crate::junctions::RoadRef::Link { link, .. } => link } };
            let tile = ((m[0] / 500.0).floor() as i32, (m[1] / 500.0).floor() as i32);
            if kind != run_kind || info != run_info || tile != run_tile || run.is_empty() {
                flush(&mut run, run_kind, run_info, &mut pieces);
                run.push(point(i, kind));
                run_kind = kind; run_info = info; run_tile = tile;
            }
            run.push(point(j, kind));
            if kind == "ramp" { rep.ramp_m += l; } else { rep.kerb_m += l; }
            // (the clamp line at the kerb's top less the clamp's 6 cm: beside the road the ground is held level with
            // the kerb's top for 4 m, under the verge, which rises from there)
            let up = rules.kerb_height - 0.06;
            if clamp_line.is_empty() { clamp_line.push([a[0], a[1], surf.loop_h[li][i] + up]); }
            clamp_line.push([b[0], b[1], surf.loop_h[li][j] + up]);
        }
        flush(&mut run, run_kind, run_info, &mut pieces);
        if clamp_line.len() > 1 { clamp_edges.push(gentle(clamp_line, 0.25)); }
    }
    // the property line: the verge's outer band line where it is truly the verge's edge
    for (li, bi, line) in &ln.band_lines {
        if *bi != 2 { continue; }
        let m = line.len();
        let mut run: Vec<[f64; 6]> = Vec::new();
        let mut run_tile = (i32::MIN, i32::MIN);
        let push_run = |run: &mut Vec<[f64; 6]>, pieces: &mut Vec<Piece>, clamp_edges: &mut Vec<Vec<P3>>| { if run.len() > 1 { clamp_edges.push(gentle(run.iter().map(|q| [q[0], q[1], q[2]]).collect(), 0.4)); pieces.push(Piece::Edge { kind: "edge", info: pid, pts: std::mem::take(run) }); } else { run.clear(); } };
        for k in 0..=m {
            let (p, ok, src) = line[k % m];
            let tile = ((p[0] / 500.0).floor() as i32, (p[1] / 500.0).floor() as i32);
            let lab = Label { kind: Kind::Gap, owner: *li, side: 0 };
            let good = ok && ix.frame.has(p) && { let (l2, _) = ix.label(p); !matches!(l2.kind, Kind::Road | Kind::None) };
            if !good || tile != run_tile { if good && !run.is_empty() { let last = *run.last().unwrap(); let _ = last; } push_run(&mut run, &mut pieces, &mut clamp_edges); run_tile = tile; if !good { continue; } }
            // its height from its own kerb point (continuous along it): the kerb's top and the verge's rise
            let _ = lab;
            let lp = &d.loops[*li as usize];
            let v = &lp.verts[src];
            let up = if ix.lip[*li as usize][src] { rules.ramp_lip } else { rules.kerb_height };
            let top = surf.loop_h[*li as usize][src] + up;
            let hh = top + (rules.verge_slope_min.max(0.0).min(rules.verge_slope_max)) * v.w.verge;
            run.push([p[0], p[1], hh, ground_at(p).min(hh), 0.0, 0.0]);
            // (its clamp edge a little under the verge's edge: the ground beside it held below the verge)
            if run.len() > 1 { rep.property_line_m += dist([run[run.len() - 2][0], run[run.len() - 2][1]], p); }
        }
        push_run(&mut run, &mut pieces, &mut clamp_edges);
    }
    // markings: only on a street's own carriageway, between its cuts
    let lift = rules.marking_lift;
    let at = |l: usize, s: f64, u: f64| -> P3 { let p = d.streets[l].curve.offset(s, u); [p[0], p[1], h.on_street(d, l, s, u) + lift] };
    let quad = |l: usize, s0: f64, s1: f64, u0: f64, u1: f64| -> Vec<P3> { vec![at(l, s0, u0), at(l, s1, u0), at(l, s1, u1), at(l, s0, u1)] };
    let signals: Vec<P2> = seed.points.iter().filter(|p| p.tags.get("highway").map_or(false, |h| h == "traffic_signals")).map(|p| p.at).collect();
    let stops: Vec<P2> = seed.points.iter().filter(|p| p.tags.get("highway").map_or(false, |h| h == "stop" || h == "give_way")).map(|p| p.at).collect();
    for (l, st) in d.streets.iter().enumerate() {
        let Some((s0, s1)) = d.ribbon[l] else { continue };
        let cls = st.link.cls;
        if !ix.frame.has(st.curve.point((s0 + s1) / 2.0)) { continue; }
        let half = st.sec.half;
        let lanes = st.sec.lanes.max(1.0).round() as usize;
        let mut mk: Vec<Vec<P3>> = Vec::new();
        // the crossings on this carriageway: lane lines stop either side of each
        let zones: Vec<(f64, f64)> = d.crossings.iter().filter(|c| c.link == l).map(|c| if c.marked { (c.s - 2.0, c.s + 2.0) } else { (c.s - 1.2, c.s + 1.2) }).collect();
        let clear = |a: f64, b: f64| zones.iter().all(|z| b <= z.0 || a >= z.1);
        if rules.painted[cls.min(7)] && s1 - s0 > 3.0 {
            let dash = |u: f64, w: f64, mk: &mut Vec<Vec<P3>>| { let mut s = s0 + 0.5; while s + rules.dash <= s1 - 0.5 { if clear(s, s + rules.dash) { mk.push(quad(l, s, s + rules.dash, u - w / 2.0, u + w / 2.0)); } s += rules.dash + rules.dash_gap; } };
            let solid = |u: f64, w: f64, mk: &mut Vec<Vec<P3>>| {
                let mut s = s0 + 0.5;
                while s < s1 - 0.5 {
                    // (up to the next crossing, then on past it)
                    if let Some(z) = zones.iter().find(|z| s >= z.0 && s < z.1) { s = z.1; continue; }
                    let next = zones.iter().filter(|z| z.0 > s).map(|z| z.0).fold(f64::INFINITY, f64::min);
                    let e = (s + 20.0).min(s1 - 0.5).min(next);
                    // (no stub of a line under 1.5 m before a crossing)
                    if e - s < 1.5 { s = e.max(s + 0.3); continue; }
                    let ss = st.curve.stations(s, e, u, rules.chord_tolerance, 3.0);
                    let mut ring: Vec<P3> = ss.iter().map(|&x| at(l, x, u - w / 2.0)).collect();
                    ring.extend(ss.iter().rev().map(|&x| at(l, x, u + w / 2.0)));
                    mk.push(ring);
                    s = e;
                }
            };
            if st.link.oneway { for k in 1..lanes { dash(-half + 2.0 * half * k as f64 / lanes as f64, rules.line_width, &mut mk); } }
            else if lanes >= 4 { solid(-0.15, 0.1, &mut mk); solid(0.15, 0.1, &mut mk); for k in 1..lanes / 2 { let u = half * k as f64 / (lanes as f64 / 2.0); dash(u, rules.line_width, &mut mk); dash(-u, rules.line_width, &mut mk); } }
            else { dash(0.0, rules.line_width, &mut mk); }
        }
        // stop and give-way lines where a smaller (or signalled) road meets its junction
        if cls <= 4 {
            for end in [0u8, 1] {
                if st.link.oneway && end == 0 { continue; }
                let node = if end == 0 { st.link.a } else { st.link.b };
                let c = d.cluster_of[&node];
                let arms: Vec<usize> = d.streets.iter().enumerate().filter(|(_, o)| d.cluster_of[&o.link.a] == c || d.cluster_of[&o.link.b] == c).map(|(i, _)| i).collect();
                if arms.len() < 3 { continue; }
                let np = d.node_at[&node];
                let lit = signals.iter().any(|q| dist(*q, np) < 30.0);
                let stop = stops.iter().any(|q| dist(*q, np) < 30.0);
                let min_cls = arms.iter().map(|&i| d.streets[i].link.cls).min().unwrap_or(cls);
                if !lit && !stop && cls <= min_cls { continue; }
                // behind the crossing at this arm, if there is one (the crossing nearer the junction)
                let near: Option<f64> = d.crossings.iter().filter(|c| c.link == l && if end == 0 { c.s - s0 < 8.0 } else { s1 - c.s < 8.0 }).map(|c| c.s).next();
                let s = match near { Some(cs) => if end == 0 { cs + 2.6 } else { cs - 2.6 }, None => if end == 0 { s0 + 0.3 } else { s1 - 0.3 } };
                if s <= s0 || s >= s1 { continue; }
                // traffic keeps left: towards b its half is u < 0; towards a, u > 0
                let (ua, ub) = if st.link.oneway { (-half + 0.2, half - 0.2) } else if end == 0 { (0.1, half - 0.2) } else { (-half + 0.2, -0.1) };
                if lit || stop { mk.push(quad(l, s - 0.15, s + 0.15, ua, ub)); rep.stop_lines += 1; }
                else { let mut u = ua; while u + 0.6 <= ub + 0.01 { mk.push(quad(l, s - 0.15, s + 0.15, u, u + 0.6)); u += 1.2; } rep.stop_lines += 1; }
            }
        }
        rep.markings += mk.len();
        for ring in mk { pieces.push(Piece::Poly { kind: "marking", info: l, ring }); }
    }
    // zebra stripes at marked crossings
    for c in &d.crossings {
        if !c.marked { continue; }
        let st = &d.streets[c.link];
        let half = st.sec.half;
        let mut u = -half + 0.3;
        while u + 0.6 <= half - 0.2 { pieces.push(Piece::Poly { kind: "marking", info: c.link, ring: quad(c.link, c.s - 1.5, c.s + 1.5, u, u + 0.6) }); u += 1.2; rep.markings += 1; }
        rep.zebras += 1;
    }
    // the walking graph: footpath middles, crossings and links from the ramps
    let mut walk: Vec<(&'static str, Vec<P2>)> = Vec::new();
    for lp in d.loops.iter() {
        if lp.island || lp.verts.iter().all(|v| v.w.footpath < 0.05) { continue; }
        let raw = crate::partition::band_line(d, lp, &|v| if v.w.footpath >= 0.05 { v.w.strip + v.w.footpath / 2.0 } else { 0.0 });
        let mut cur: Vec<P2> = Vec::new();
        for (p, ok, src) in raw.iter() {
            let good = *ok && lp.verts[*src].w.footpath >= 0.05 && ix.frame.has(*p) && matches!(ix.label(*p).0.kind, Kind::Footpath);
            if good { cur.push(*p); } else { if cur.len() > 1 { walk.push(("footpath", std::mem::take(&mut cur))); } cur.clear(); }
        }
        if cur.len() > 1 { walk.push(("footpath", cur)); }
    }
    for c in &d.crossings {
        let st = &d.streets[c.link];
        let (a, b) = (st.curve.offset(c.s, st.sec.outer), st.curve.offset(c.s, -st.sec.outer));
        if !ix.frame.has(a) { continue; }
        walk.push(("crossing", vec![a, b]));
        for (k, sg) in [(0usize, 1.0f64), (1, -1.0)] {
            let sd = &st.sec.sides[k];
            if sd.footpath <= 0.0 { continue; }
            walk.push(("link", vec![st.curve.offset(c.s, sg * st.sec.outer), st.curve.offset(c.s, sg * (st.sec.outer + sd.strip + sd.footpath / 2.0))]));
        }
    }
    for p in &seed.paths { if p.tags.get("footway").map_or(true, |f| f != "sidewalk" && f != "crossing") && p.pts.iter().any(|q| ix.frame.has(*q)) { walk.push(("path", p.pts.clone())); } }
    let walk: Vec<(&'static str, Vec<P2>)> = walk.into_iter().map(|(k, p)| (k, rdp(&p, 0.05))).collect();
    // joined into a graph (lines cut where they cross, ends joined to the line beside them)
    let (walk, wx, wj) = crate::walk::graph(walk, 3.0);
    rep.walk_crossings = wx; rep.walk_joined = wj;
    Out { pieces, infos, clamp_cells, clamp_edges, terrain, walk, report: rep, loop_h: surf.loop_h.clone() }
}

/// a clamp line no steeper than `grade` anywhere, by lowering only (the clamp only lowers the ground, and the device
/// guards a steep line by lowering beside all of it)
fn gentle(mut l: Vec<P3>, grade: f64) -> Vec<P3> {
    for _ in 0..2 {
        for i in 1..l.len() { let d = dist([l[i][0], l[i][1]], [l[i - 1][0], l[i - 1][1]]); l[i][2] = l[i][2].min(l[i - 1][2] + grade * d); }
        for i in (0..l.len().saturating_sub(1)).rev() { let d = dist([l[i][0], l[i][1]], [l[i + 1][0], l[i + 1][1]]); l[i][2] = l[i][2].min(l[i + 1][2] + grade * d); }
    }
    l
}
/// map in parallel on the command line, in turn elsewhere (the browser)
#[cfg(feature = "native")]
pub fn par_map<T: Send, R: Send>(v: Vec<T>, f: impl Fn(T) -> R + Sync + Send) -> Vec<R> { use rayon::prelude::*; v.into_par_iter().map(f).collect() }
#[cfg(not(feature = "native"))]
pub fn par_map<T, R>(v: Vec<T>, f: impl Fn(T) -> R) -> Vec<R> { v.into_iter().map(f).collect() }
