//! Stage 2, clean: the map lines as a graph of streets. Ways split where they share a node; duplicate points merged;
//! zigzags (a point turning straight back on a short leg) dropped; a dead end that stops just short of another road
//! joined to it; ways that continue one another through a two-way node (same name, class, width) chained into one
//! street. Structures (bridges, tunnels, other levels) are left out of this first baker and listed.
use crate::geom::*;
use crate::rules::Rules;
use crate::seed::{Seed, Tags};
use std::collections::{BTreeMap, HashMap};

#[derive(Clone, Debug)]
pub struct Link {
    pub id: usize,
    pub a: i64,
    pub b: i64,
    pub pts: Vec<P2>,
    pub tags: Tags,
    pub ways: Vec<i64>,
    pub cls: usize,
    pub oneway: bool,
    pub roundabout: bool,
    pub name: String,
}
#[derive(Clone, Debug)]
pub struct Node { pub id: i64, pub at: P2, pub ends: Vec<(usize, u8)> }

#[derive(Default, Debug, Clone)]
pub struct CleanReport { pub ways: usize, pub structures: Vec<i64>, pub edges: usize, pub duplicates: usize, pub zigzags: usize, pub snapped: usize, pub links: usize, pub joints: usize, pub outside: usize }

pub struct Network { pub links: Vec<Link>, pub nodes: BTreeMap<i64, Node>, pub report: CleanReport }

fn is_oneway(t: &Tags) -> bool {
    let o = t.get("oneway").map(|s| s.as_str()).unwrap_or("");
    let h = t.get("highway").map(|s| s.as_str()).unwrap_or("");
    o == "yes" || o == "1" || o == "-1" || t.get("junction").map_or(false, |j| j == "roundabout") || h == "motorway" || (h.ends_with("_link") && o != "no")
}
pub fn is_structure(t: &Tags) -> bool {
    let layer: i64 = t.get("layer").and_then(|l| l.parse().ok()).unwrap_or(0);
    let bridge = t.get("bridge").map_or(false, |b| b != "no");
    let tunnel = t.get("tunnel").map_or(false, |b| b != "no" && b != "building_passage");
    layer != 0 || bridge || tunnel
}

pub fn clean(seed: &Seed, rules: &Rules, frame: &BBox) -> Network {
    let mut rep = CleanReport::default();
    // roads at grade
    let mut ways = Vec::new();
    for w in &seed.ways {
        let Some(h) = w.tags.get("highway") else { continue };
        if w.tags.get("area").map_or(false, |a| a == "yes") { continue; }
        if !rules.classes.contains_key(h.strip_suffix("_link").unwrap_or(h)) { continue; }
        rep.ways += 1;
        if is_structure(&w.tags) { rep.structures.push(w.id); continue; }
        let mut w = w.clone();
        if w.tags.get("oneway").map_or(false, |o| o == "-1") { w.nodes.reverse(); w.pts.reverse(); w.tags.insert("oneway".into(), "yes".into()); }
        ways.push(w);
    }
    // split where ways share a node
    let mut uses: HashMap<i64, u32> = HashMap::new();
    for w in &ways { for (i, n) in w.nodes.iter().enumerate() { *uses.entry(*n).or_default() += if i == 0 || i == w.nodes.len() - 1 { 2 } else { 1 }; } }
    struct Edge { a: i64, b: i64, pts: Vec<P2>, way: usize }
    let mut at: HashMap<i64, P2> = HashMap::new();
    let mut edges: Vec<Edge> = Vec::new();
    for (wi, w) in ways.iter().enumerate() {
        let mut start = 0;
        for i in 1..w.nodes.len() {
            if i < w.nodes.len() - 1 && uses[&w.nodes[i]] < 2 { continue; }
            let pts: Vec<P2> = w.pts[start..=i].to_vec();
            at.insert(w.nodes[start], w.pts[start]);
            at.insert(w.nodes[i], w.pts[i]);
            if w.nodes[start] != w.nodes[i] || pts.len() > 2 { edges.push(Edge { a: w.nodes[start], b: w.nodes[i], pts, way: wi }); }
            start = i;
        }
    }
    // duplicate points and zigzags
    for e in &mut edges {
        let mut v: Vec<P2> = Vec::with_capacity(e.pts.len());
        for (i, p) in e.pts.iter().enumerate() {
            if let Some(l) = v.last() { if dist(*l, *p) < rules.merge_distance && i != e.pts.len() - 1 { rep.duplicates += 1; continue; } }
            v.push(*p);
        }
        let mut changed = true;
        while changed && v.len() > 2 {
            changed = false;
            for i in 1..v.len() - 1 {
                let d1 = sub(v[i], v[i - 1]);
                let d2 = sub(v[i + 1], v[i]);
                let t = cross(d1, d2).atan2(dot(d1, d2)).abs().to_degrees();
                if t > rules.zigzag_angle && len(d1).min(len(d2)) < rules.zigzag_leg { v.remove(i); rep.zigzags += 1; changed = true; break; }
            }
        }
        e.pts = v;
    }
    rep.edges = edges.len();
    // dead ends just short of another node: joined to it
    let mut degree: HashMap<i64, u32> = HashMap::new();
    for e in &edges { *degree.entry(e.a).or_default() += 1; *degree.entry(e.b).or_default() += 1; }
    let mut remap: HashMap<i64, i64> = HashMap::new();
    {
        let ids: Vec<i64> = at.keys().copied().collect();
        let mut grid = Grid::new(10.0);
        for (i, id) in ids.iter().enumerate() { let p = at[id]; grid.add(&BBox::of(&[p]), i as u32); }
        let mut near = Vec::new();
        let mut sorted = ids.clone();
        sorted.sort();
        for id in sorted {
            if degree.get(&id).copied().unwrap_or(0) != 1 || remap.contains_key(&id) { continue; }
            let p = at[&id];
            grid.near(p, rules.snap_distance, &mut near);
            let mut best: Option<(f64, i64)> = None;
            for &k in &near {
                let o = ids[k as usize];
                if o == id || remap.contains_key(&o) { continue; }
                // never onto the other end of its own edge
                if edges.iter().any(|e| (e.a == id && e.b == o) || (e.b == id && e.a == o)) { continue; }
                let d = dist(p, at[&o]);
                if d < rules.snap_distance && best.map_or(true, |b| d < b.0) { best = Some((d, o)); }
            }
            if let Some((_, o)) = best { remap.insert(id, o); rep.snapped += 1; }
        }
    }
    for e in &mut edges {
        if let Some(n) = remap.get(&e.a) { e.a = *n; e.pts[0] = at[n]; }
        if let Some(n) = remap.get(&e.b) { e.b = *n; *e.pts.last_mut().unwrap() = at[n]; }
    }
    // chains: through two-way nodes where the street goes on
    let mut ends: HashMap<i64, Vec<(usize, u8)>> = HashMap::new();
    for (i, e) in edges.iter().enumerate() { ends.entry(e.a).or_default().push((i, 0)); ends.entry(e.b).or_default().push((i, 1)); }
    let same = |x: &Tags, y: &Tags| -> bool {
        let g = |t: &Tags, k: &str| t.get(k).cloned().unwrap_or_default();
        g(x, "highway") == g(y, "highway") && g(x, "name") == g(y, "name") && g(x, "lanes") == g(y, "lanes") && g(x, "width") == g(y, "width") && is_oneway(x) == is_oneway(y) && g(x, "junction") == g(y, "junction")
    };
    let mut used = vec![false; edges.len()];
    let mut links = Vec::new();
    let through = |n: i64, from: usize, used: &Vec<bool>| -> Option<(usize, u8)> {
        let l = ends.get(&n)?;
        if l.len() != 2 { return None; }
        let other = if l[0].0 == from && l[1].0 != from { l[1] } else if l[1].0 == from && l[0].0 != from { l[0] } else { return None };
        if used[other.0] { return None; }
        if !same(&ways[edges[from].way].tags, &ways[edges[other.0].way].tags) { return None; }
        // one-way streets chain only head to tail
        if is_oneway(&ways[edges[from].way].tags) && ((other.1 == 1) == (edges[from].b == n)) { return None; }
        Some(other)
    };
    // start chains at nodes that are not pass-through (so loops are found last)
    let mut order: Vec<usize> = (0..edges.len()).collect();
    order.sort_by_key(|&i| { let pass = |n: i64| ends.get(&n).map_or(false, |l| l.len() == 2); (pass(edges[i].a) && pass(edges[i].b)) as u8 });
    for &start in &order {
        if used[start] { continue; }
        used[start] = true;
        // walk backwards from a, then forwards from b
        let mut pts = edges[start].pts.clone();
        let mut wids = vec![ways[edges[start].way].id];
        let (mut a, mut b) = (edges[start].a, edges[start].b);
        let mut cur = start;
        while let Some((o, end)) = through(b, cur, &used) {
            used[o] = true;
            let mut q = edges[o].pts.clone();
            let nb = if end == 0 { edges[o].b } else { q.reverse(); edges[o].a };
            pts.extend_from_slice(&q[1..]);
            wids.push(ways[edges[o].way].id);
            b = nb; cur = o;
            if b == a { break; }
        }
        cur = start;
        while a != b {
            let Some((o, end)) = through(a, cur, &used) else { break };
            used[o] = true;
            let mut q = edges[o].pts.clone();
            let na = if end == 1 { edges[o].a } else { q.reverse(); edges[o].b };
            q.pop();
            q.extend_from_slice(&pts);
            pts = q;
            wids.insert(0, ways[edges[o].way].id);
            a = na; cur = o;
        }
        let t = ways[edges[start].way].tags.clone();
        wids.dedup();
        let cls = rules.class_of(t.get("highway").map(|s| s.as_str()).unwrap_or(""));
        let bb = BBox::of(&pts);
        if !bb.hits(&frame.grow(80.0)) { rep.outside += 1; continue; }
        if polyline_len(&pts) < 0.5 { continue; }
        links.push(Link { id: links.len(), a, b, oneway: is_oneway(&t), roundabout: t.get("junction").map_or(false, |j| j == "roundabout"), name: t.get("name").cloned().unwrap_or_default(), pts, tags: t, ways: wids, cls });
    }
    let mut nodes: BTreeMap<i64, Node> = BTreeMap::new();
    for l in &links {
        nodes.entry(l.a).or_insert_with(|| Node { id: l.a, at: l.pts[0], ends: vec![] }).ends.push((l.id, 0));
        nodes.entry(l.b).or_insert_with(|| Node { id: l.b, at: *l.pts.last().unwrap(), ends: vec![] }).ends.push((l.id, 1));
    }
    rep.joints = nodes.values().filter(|n| n.ends.len() == 2).count();
    rep.links = links.len();
    Network { links, nodes, report: rep }
}
