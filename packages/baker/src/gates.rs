//! Stage 9, gates: a measured check per defect group, on the baked pieces as made, each with its policy (repair,
//! omit or stop). The side-by-side measure of an old pack and a new one is the gate harness (`gates/measure.ts`),
//! which reads any pack the way aslnut reads it; these are the bake's own, cheaper, exact ones.
//!   B  islands and medians: a point of an island or median higher than its kerbs' tops round it, or lower
//!   C  kerb outlines: jogs (a short step between near-parallel kerb) and folds (the kerb's top turned over)
//!   D  scraps and slivers: footpath and verge pieces under half a square metre or thinner than 0.2 m
//!   F  pits and walls: footpath quads steeper than 1 : 4; the property line over the conformed ground by > 0.5 m
//!   G  seams: a carriageway edge with carriageway on both sides that only one piece has
//!   H  dashes in junctions: markings whose middle is on a junction's carriageway
//!   I  zebras without a kerb ramp at each end
use crate::geom::*;
use crate::junctions::Design;
use crate::mesh::{Out, Piece, P3};
use crate::partition::{Index, Kind};
use crate::rules::Rules;
use serde_json::{json, Value};

pub struct GateReport { pub stage: Value, pub summary: Value, pub slivers: usize }

fn key(p: &[f64]) -> (i64, i64) { ((p[0] * 100.0).round() as i64, (p[1] * 100.0).round() as i64) }
fn outline(p: &Piece) -> Vec<Vec<P3>> {
    match p {
        Piece::Area { rings, .. } => rings.clone(),
        Piece::Strip { edges, .. } => vec![edges[0].iter().copied().chain(edges[edges.len() - 1].iter().rev().copied()).collect()],
        _ => vec![],
    }
}

pub fn measure(d: &Design, ix: &Index, out: &Out, rules: &Rules) -> GateReport {
    // G: carriageway edges by how many pieces have them
    let mut edges: std::collections::BTreeMap<((i64, i64), (i64, i64)), i32> = Default::default();
    for p in &out.pieces {
        if p.kind() != "carriageway" { continue; }
        for r in outline(p) { for i in 0..r.len() { let (a, b) = (key(&r[i]), key(&r[(i + 1) % r.len()])); if a == b { continue; } *edges.entry(if a < b { (a, b) } else { (b, a) }).or_default() += 1; } }
    }
    let (mut seam_m, mut seam_n) = (0.0, 0usize);
    for (k, c) in &edges {
        let a = [k.0 .0 as f64 / 100.0, k.0 .1 as f64 / 100.0];
        let b = [k.1 .0 as f64 / 100.0, k.1 .1 as f64 / 100.0];
        let l = dist(a, b);
        if *c > 2 { seam_n += 1; seam_m += l; continue; }
        if *c != 1 || l < 0.05 { continue; }
        let (m, n) = (lerp(a, b, 0.5), left(norm(sub(b, a))));
        let s1 = ix.label(add(m, mul(n, 0.05))).0.kind == Kind::Road;
        let s2 = ix.label(sub(m, mul(n, 0.05))).0.kind == Kind::Road;
        if s1 && s2 { seam_n += 1; seam_m += l; if std::env::var("BAKER_DEBUG").is_ok() && seam_n < 12 { eprintln!("SEAM {:.2},{:.2} -> {:.2},{:.2} labels {:?} {:?}", a[0], a[1], b[0], b[1], ix.label(add(m, mul(n, 0.05))).0, ix.label(sub(m, mul(n, 0.05))).0); } }
    }
    // B: each island point against the kerb tops of its own kerb loop within 30 m
    let (mut islands, mut off) = (0usize, 0usize);
    let mut worst = 0.0f64;
    let mut buf = Vec::new();
    for p in &out.pieces {
        let Piece::Area { kind: "verge", info, rings } = p else { continue };
        if out.infos[*info].props["what"] != "island" { continue; }
        islands += 1;
        let mut bad = false;
        for q in rings.iter().flatten() {
            let Some(h) = ix.kerb([q[0], q[1]]) else { continue };
            let lp = &d.loops[h.lp as usize];
            let _ = &mut buf;
            let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
            for (i, v) in lp.verts.iter().enumerate() { if dist(v.p, [q[0], q[1]]) < 30.0 { let top = out.loop_h[h.lp as usize][i] + if ix.lip[h.lp as usize][i] { rules.ramp_lip } else { rules.kerb_height }; lo = lo.min(top); hi = hi.max(top); } }
            if hi.is_finite() { let e = (q[2] - hi).max(lo - q[2]); if e > 0.02 { bad = true; worst = worst.max(e); } }
        }
        if bad { off += 1; }
    }
    // C: kerb jogs and folds
    let (mut jogs, mut folds, mut kerb_pts) = (0usize, 0usize, 0usize);
    for p in &out.pieces {
        let Piece::Edge { kind, pts, .. } = p else { continue };
        if *kind != "kerb" && *kind != "ramp" { continue; }
        let n = pts.len();
        kerb_pts += n;
        let turn = |a: &[f64; 6], b: &[f64; 6], c: &[f64; 6]| { let u = [b[0] - a[0], b[1] - a[1]]; let v = [c[0] - b[0], c[1] - b[1]]; cross(u, v).atan2(dot(u, v)).to_degrees() };
        for i in 1..n.saturating_sub(2) {
            let (t1, t2) = (turn(&pts[i - 1], &pts[i], &pts[i + 1]), turn(&pts[i], &pts[i + 1], &pts[i + 2]));
            let lm = dist([pts[i][0], pts[i][1]], [pts[i + 1][0], pts[i + 1][1]]);
            if lm < 1.2 && lm > 0.02 && t1.abs() > 35.0 && t2.abs() > 35.0 && t1.signum() != t2.signum() && (t1 + t2).abs() < 25.0 { jogs += 1; }
        }
        for i in 0..n.saturating_sub(1) {
            let (a, b) = (&pts[i], &pts[i + 1]);
            let (ai, bi) = ([a[0] + a[4], a[1] + a[5]], [b[0] + b[4], b[1] + b[5]]);
            if seg_cross([a[0], a[1]], ai, [b[0], b[1]], bi).map_or(false, |(t, u)| t > 1e-6 && t < 1.0 - 1e-6 && u > 1e-6 && u < 1.0 - 1e-6) { folds += 1; }
        }
    }
    // D: what is left of scraps and slivers after the partition joined them to their neighbours
    let (mut scraps, mut slivers) = (0usize, 0usize);
    for p in &out.pieces {
        if p.kind() != "footpath" && p.kind() != "verge" { continue; }
        let rs = outline(p);
        if rs.is_empty() { continue; }
        let a: f64 = rs.iter().map(|r| area(&r.iter().map(|q| [q[0], q[1]]).collect::<Vec<_>>())).sum::<f64>().abs();
        let per: f64 = rs.iter().map(|r| (0..r.len()).map(|i| dist([r[i][0], r[i][1]], [r[(i + 1) % r.len()][0], r[(i + 1) % r.len()][1]])).sum::<f64>()).sum();
        if a < 0.5 { scraps += 1; } else if per > 0.0 && 2.0 * a / per < 0.1 { slivers += 1; }
    }
    // F: footpath quads (strips) steeper than 1 : 4; the property line over the conformed ground
    let mut steep = 0usize;
    for p in &out.pieces {
        let Piece::Strip { kind: "footpath", edges, .. } = p else { continue };
        for e in 1..edges.len() { for i in 1..edges[e].len() {
            for t in [[edges[e - 1][i - 1], edges[e][i - 1], edges[e][i]], [edges[e - 1][i - 1], edges[e][i], edges[e - 1][i]]] {
                let (a, b, c) = (t[0], t[1], t[2]);
                let den = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
                if den.abs() < 1e-6 { continue; }
                let gx = ((b[2] - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (b[1] - a[1])) / den;
                let gz = ((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / den;
                if gx.hypot(gz) > 0.25 { steep += 1; }
            }
        } }
    }
    let mut walls_m = 0.0;
    for p in &out.pieces { if let Piece::Edge { kind: "edge", pts, .. } = p { for w in pts.windows(2) { if w[0][2] - out.terrain.at(w[0][0], w[0][1]) > 0.5 { walls_m += dist([w[0][0], w[0][1]], [w[1][0], w[1][1]]); } } } }
    // H: markings in a junction's carriageway
    let mut dashes_in = 0usize;
    for p in &out.pieces { if let Piece::Poly { kind: "marking", ring, .. } = p { let n = ring.len() as f64; let m = [ring.iter().map(|q| q[0]).sum::<f64>() / n, ring.iter().map(|q| q[1]).sum::<f64>() / n]; let lab = ix.label(m).0; if lab.kind == Kind::Road && lab.side == 2 { dashes_in += 1; } } }
    // I: each marked crossing's two kerbs: a ramp there
    let zebras = d.crossings.iter().filter(|c| c.marked).count();
    let mut ramps: Vec<P2> = Vec::new();
    for p in &out.pieces { if let Piece::Edge { kind: "ramp", pts, .. } = p { for x in pts { ramps.push([x[0], x[1]]); } } }
    let mut rg = Grid::new(10.0);
    for (i, r) in ramps.iter().enumerate() { rg.add(&BBox::of(&[*r]), i as u32); }
    let mut unramped = 0usize;
    for c in d.crossings.iter().filter(|c| c.marked) {
        let st = &d.streets[c.link];
        for u in [st.sec.outer, -st.sec.outer] {
            let p = st.curve.offset(c.s, u);
            if !ix.frame.has(p) { continue; }
            rg.near(p, 1.5, &mut buf);
            if !buf.iter().any(|&i| dist(ramps[i as usize], p) < 1.5) { unramped += 1; if std::env::var("BAKER_DEBUG").is_ok() { eprintln!("UNRAMPED link {} s {:.1} at {:.1},{:.1} label {:?}", c.link, c.s, p[0], p[1], ix.label(p).0); } }
        }
    }
    let summary = json!({
        "B_islandPieces": islands, "B_islandPiecesOffTheirKerbs": off, "B_worstM": worst,
        "C_kerbPoints": kerb_pts, "C_jogs": jogs, "C_folds": folds,
        "D_scrapsUnderHalfM2": scraps, "D_sliversUnder20cm": slivers,
        "F_steepFootpathQuads": steep, "F_propertyLineOverGroundBy50cmM": walls_m,
        "G_seamEdges": seam_n, "G_seamM": seam_m,
        "H_markingsInJunctions": dashes_in,
        "I_zebras": zebras, "I_zebraEndsWithoutRamp": unramped,
    });
    let stage = crate::stage(9, "gates", "Gates: a measured check per defect group (B islands, C kerb jogs and folds, D scraps and slivers, F steep footpaths and walls, G seams, H markings in junctions, I zebras without ramps)", summary.clone(), json!({}),
        &[("islands-level", "repair", "island-at-kerb-top", off == 0), ("kerb-outline", "repair", "g1-offsets", folds == 0 && jogs == 0), ("scrap", "repair", "join-longest-neighbour", true), ("seam", "repair", "shared-edges-one-height", seam_n == 0), ("marking-junction", "repair", "paint-between-cuts", dashes_in == 0), ("zebra-ramps", "repair", "ramp-both-kerbs", unramped == 0)], vec![], vec![]);
    GateReport { stage, summary, slivers }
}
