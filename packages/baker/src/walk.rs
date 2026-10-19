//! The walking graph from the designed lines (footpath middles, crossings, the links from each kerb ramp, the mapped
//! paths), joined as the TypeScript bake's `walkGraph` joins them: every line cut where it crosses another, every end
//! within `snap` of another line joined to it (a short link, the other line cut there), every point to the centimetre,
//! so aslnut's `network({ lines, snap: 0.05 })` joins them exactly.
use crate::geom::*;

pub fn graph(lines: Vec<(&'static str, Vec<P2>)>, snap: f64) -> (Vec<(&'static str, Vec<P2>)>, usize, usize) {
    struct L { kind: &'static str, pts: Vec<P2>, cuts: Vec<(usize, f64, P2)> }
    let mut ls: Vec<L> = lines.into_iter().filter(|(_, p)| p.len() > 1).map(|(k, p)| L { kind: k, pts: p, cuts: vec![] }).collect();
    let mut grid = Grid::new(20.0);
    let mut segs: Vec<(usize, usize)> = Vec::new();
    for (li, l) in ls.iter().enumerate() { for i in 1..l.pts.len() { grid.add_seg(l.pts[i - 1], l.pts[i], segs.len() as u32); segs.push((li, i)); } }
    let mut buf = Vec::new();
    // crossings: a cut on both
    let mut crossings = 0;
    let mut new_cuts: Vec<(usize, usize, f64, P2)> = Vec::new();
    for (si, &(li, i)) in segs.iter().enumerate() {
        let (a, b) = (ls[li].pts[i - 1], ls[li].pts[i]);
        grid.near(lerp(a, b, 0.5), dist(a, b) / 2.0 + 0.1, &mut buf);
        for &sj in &buf {
            let sj = sj as usize;
            if sj <= si { continue; }
            let (lj, j) = segs[sj];
            if lj == li && (j as i64 - i as i64).abs() <= 1 { continue; }
            let (c, d) = (ls[lj].pts[j - 1], ls[lj].pts[j]);
            if let Some((t, u)) = seg_cross(a, b, c, d) {
                if t <= 0.0 || t >= 1.0 || u <= 0.0 || u >= 1.0 { continue; }
                let p = lerp(a, b, t);
                new_cuts.push((li, i, t, p)); new_cuts.push((lj, j, u, p));
                crossings += 1;
            }
        }
    }
    for (l, i, t, p) in new_cuts { ls[l].cuts.push((i, t, p)); }
    // ends near another line: joined to it
    let mut links: Vec<(&'static str, Vec<P2>)> = Vec::new();
    let mut joined = 0;
    let mut join_cuts: Vec<(usize, usize, f64, P2)> = Vec::new();
    for li in 0..ls.len() {
        for e in [0, ls[li].pts.len() - 1] {
            let p = ls[li].pts[e];
            grid.near(p, snap, &mut buf);
            let mut best: Option<(usize, usize, f64, P2, f64)> = None;
            for &s in &buf {
                let (lj, j) = segs[s as usize];
                if lj == li { continue; }
                let (a, b) = (ls[lj].pts[j - 1], ls[lj].pts[j]);
                let (d, t) = seg_dist(p, a, b);
                if d <= snap && best.map_or(true, |x| d < x.4) { best = Some((lj, j, t, lerp(a, b, t), d)); }
            }
            if let Some((lj, j, t, q, d)) = best {
                join_cuts.push((lj, j, t, q));
                if d > 0.01 { links.push(("link", vec![p, q])); }
                joined += 1;
            }
        }
    }
    for (l, i, t, p) in join_cuts { ls[l].cuts.push((i, t, p)); }
    // each line cut at its cuts, its points to the centimetre
    let c = |p: P2| -> P2 { [r2(p[0]), r2(p[1])] };
    let mut out: Vec<(&'static str, Vec<P2>)> = Vec::new();
    for l in &mut ls {
        l.cuts.sort_by(|x, y| x.0.cmp(&y.0).then(x.1.partial_cmp(&y.1).unwrap()));
        let mut cur = vec![c(l.pts[0])];
        let mut k = 0;
        for i in 1..l.pts.len() {
            while k < l.cuts.len() && l.cuts[k].0 == i {
                let p = c(l.cuts[k].2);
                if *cur.last().unwrap() != p { cur.push(p); }
                if cur.len() > 1 { out.push((l.kind, std::mem::take(&mut cur))); }
                cur = vec![p];
                k += 1;
            }
            let q = c(l.pts[i]);
            if *cur.last().unwrap() != q { cur.push(q); }
        }
        if cur.len() > 1 { out.push((l.kind, cur)); }
    }
    for (k, p) in links { out.push((k, p.into_iter().map(c).collect())); }
    (out, crossings, joined)
}
