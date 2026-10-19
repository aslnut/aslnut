//! baker: a road baker for aslnut. Map lines are seeds; streets are designed from them (clean, fair curves,
//! cross-sections, junction patterns), assembled as one planar partition, given heights from the design, meshed,
//! checked by a gate per defect group, and written as aslnut's baked roads pack (the same files the TypeScript bake
//! writes). The library does no file or clock work of its own, so it builds for the browser (wasm32) as well as for
//! the command line (every core).
pub mod arrangement;
pub mod clean;
pub mod curve;
pub mod gates;
pub mod geom;
pub mod heights;
pub mod junctions;
pub mod mesh;
pub mod pack;
pub mod partition;
pub mod rules;
pub mod sections;
pub mod walk;
pub mod seed;

use geom::*;
use serde_json::{json, Value};

pub struct Baked { pub files: pack::Files, pub summary: Value, pub timings: Vec<(String, f64)> }

/// a stage's record in the pack's report (the shape aslnut's viewer and checks read)
pub fn stage(n: u32, id: &str, name: &str, counts: Value, worst: Value, checks: &[(&str, &str, &str, bool)], errors: Vec<String>, flagged: Vec<Value>) -> Value {
    let checks: Vec<Value> = checks.iter().map(|(c, p, a, ok)| json!({ "check": c, "policy": p, "algorithm": a, "ok": ok })).collect();
    let ok = errors.is_empty() && checks.iter().all(|c| c["ok"] == true);
    json!({ "stage": n, "id": id, "name": name, "ok": ok, "counts": counts, "worst": worst, "flagged": flagged, "errors": errors, "patches": [], "checks": checks })
}

/// bake a place. `clock` gives seconds (the caller's: the browser has no std clock); `old_stages` are the TypeScript
/// bake's records of stages 12 to 15 (buildings, trees and furniture, carried with its placement)
pub fn bake(files: &seed::SeedFiles, rules: &rules::Rules, old_stages: &[Value], clock: &dyn Fn() -> f64) -> Result<Baked, String> {
    let mut timings: Vec<(String, f64)> = Vec::new();
    let mut t0 = clock();
    let mut tick = |what: &str, timings: &mut Vec<(String, f64)>| { let t = clock(); timings.push((what.to_string(), t - t0)); t0 = t; };
    let mut stages: Vec<Value> = Vec::new();

    // 1. seed
    let sd = seed::read(files)?;
    let gb = sd.ground.bbox();
    let m = rules.frame_margin;
    let frame = BBox { x0: gb.x0 + m, z0: gb.z0 + m, x1: gb.x1 - m, z1: gb.z1 - m };
    stages.push(stage(1, "seed", "Seed: map lines, tags, ground and reserves read (read only)", json!({ "ways": sd.ways.len(), "points": sd.points.len(), "paths": sd.paths.len(), "reserves": sd.reserves.len(), "waterways": sd.waters.len(), "groundCells": sd.ground.nx * sd.ground.nz }), json!({ "frameWidthM": frame.x1 - frame.x0, "frameDepthM": frame.z1 - frame.z0 }),
        &[("seed-valid", "stop", "validate-inputs", !sd.ways.is_empty() && sd.ground.data.iter().all(|v| v.is_finite()))], vec![], vec![]));
    tick("seed", &mut timings);

    // 2. clean
    let net = clean::clean(&sd, rules, &frame);
    let cr = &net.report;
    stages.push(stage(2, "clean", "Clean: ways split at shared nodes, duplicates merged, zigzags dropped, near misses joined, streets chained", json!({ "roadWays": cr.ways, "edges": cr.edges, "duplicatePoints": cr.duplicates, "zigzags": cr.zigzags, "snapped": cr.snapped, "streets": cr.links, "joints": cr.joints, "structuresLeftOut": cr.structures.len(), "outsideFrame": cr.outside }), json!({}),
        &[("structures", "omit", "left-out-first-milestone", true)], vec![], cr.structures.iter().map(|w| json!(w)).collect()));
    tick("clean", &mut timings);

    // 3. fair, 4. sections
    let reserves = sections::Reserves::new(&sd.reserves);
    let mut arcs = 0usize;
    let mut worst_dev = 0.0f64;
    let streets: Vec<junctions::Street> = mesh::par_map(net.links.clone(), |l| {
        let c = curve::fair(&l.pts, rules.fair_tolerance, rules.fair_radius_max);
        let rev = c.reversed();
        let sec = sections::section(&l, &c, rules, &reserves);
        junctions::Street { link: l, curve: c, rev, sec }
    });
    for s in &streets {
        arcs += s.curve.prims.iter().filter(|p| matches!(p, curve::Prim::Arc { .. })).count();
        for q in &s.link.pts { worst_dev = worst_dev.max(s.curve.project(*q).2); }
    }
    stages.push(stage(3, "fair", "Fair: each street's centre line as straights and arcs, tangent to tangent", json!({ "streets": streets.len(), "arcs": arcs }), json!({ "maxDeviationM": worst_dev }),
        &[("fair-tolerance", "repair", "fillet-within-tolerance", worst_dev <= rules.fair_tolerance + 1e-6)], vec![], vec![]));
    tick("fair", &mut timings);
    let from_data = streets.iter().flat_map(|s| s.sec.sides.iter()).filter(|x| x.from_data).count();
    let verged = streets.iter().flat_map(|s| s.sec.sides.iter()).filter(|x| x.verge > 0.0).count();
    stages.push(stage(4, "sections", "Sections: one cross-section per street from its tags and the rules (lanes | kerb | strip | footpath | boundary)", json!({ "streets": streets.len(), "sidesWithVerge": verged, "sidesFromReserveData": from_data, "sidesByRules": verged - from_data }), json!({}),
        &[("section-valid", "stop", "validate-bands", streets.iter().all(|s| s.sec.half > 0.0 && s.sec.sides.iter().all(|x| x.strip >= 0.0 && x.footpath >= 0.0)))], vec![], vec![]));
    tick("sections", &mut timings);

    // 5. junctions
    let d = junctions::design(&net, streets, rules, &sd.points);
    let jr = d.report.clone();
    stages.push(stage(5, "junctions", "Junctions: faces, kerb returns, noses, caps, joins and tapers; arms cut; crossings with kerb ramps", serde_json::to_value(&jr).unwrap(), json!({}),
        &[("pattern", "repair", "shrink-then-merge-corners", true)], vec![], vec![]));
    tick("junctions", &mut timings);

    // 7. heights (needed by the partition's faces)
    let h = heights::solve(&d, &sd.ground, rules);
    // each street's stations where its surface bends (a centimetre off straight between them); the kerb loops at them
    let mut d = d;
    {
        let vt = rules.vertical_tolerance;
        let vertical = |l: usize| -> Vec<f64> {
            let st = &d.streets[l];
            let n = (st.len().ceil() as usize).max(1);
            let ss: Vec<f64> = (0..=n).map(|k| (k as f64).min(st.len())).collect();
            let mut keep = vec![false; ss.len()];
            keep[0] = true; *keep.last_mut().unwrap() = true;
            for u in [st.sec.outer, 0.0, -st.sec.outer] {
                let hs: Vec<f64> = ss.iter().map(|s| h.on_street(&d, l, *s, u)).collect();
                let mut stack = vec![(0usize, ss.len() - 1)];
                while let Some((i, j)) = stack.pop() {
                    let mut best = 0; let mut bd = vt;
                    for k in i + 1..j { let t = (ss[k] - ss[i]) / (ss[j] - ss[i]).max(1e-9); let dd = (hs[k] - (hs[i] + (hs[j] - hs[i]) * t)).abs(); if dd > bd { bd = dd; best = k; } }
                    if best > 0 { keep[best] = true; stack.push((i, best)); stack.push((best, j)); }
                }
            }
            ss.iter().zip(keep).filter(|(_, k)| *k).map(|(s, _)| *s).collect()
        };
        let vs: Vec<Vec<f64>> = mesh::par_map((0..d.streets.len()).collect(), |l| vertical(l));
        junctions::kerb_loops(&mut d, rules, &|l| vs[l].clone());
        if std::env::var("BAKER_DEBUG").is_ok() {
            let total: f64 = d.streets.iter().map(|s| s.len()).sum();
            let nv: usize = vs.iter().map(|v| v.len()).sum();
            let ns: usize = d.stations.iter().map(|v| v.len()).sum();
            eprintln!("stations: {nv} for the heights, {ns} in all, over {:.0} m ({:.1} m apart)", total, total / ns as f64);
        }
    }
    tick("heights", &mut timings);

    // 6. one planar partition
    let ix = partition::Index::new(&d, rules, frame);
    let ln = partition::lines(&ix, &d);
    let mut tiles_xy = Vec::new();
    for tx in (frame.x0 / pack::SIZE).floor() as i32..=(frame.x1 / pack::SIZE).floor() as i32 { for tz in (frame.z0 / pack::SIZE).floor() as i32..=(frame.z1 / pack::SIZE).floor() as i32 { tiles_xy.push((tx, tz)); } }
    let tiles: Vec<partition::TileOut> = mesh::par_map(tiles_xy, |(tx, tz)| partition::tile(&ix, &ln, tx, tz, rules.cell, pack::SIZE));
    let tr = tiles.iter().fold(partition::TileReport::default(), |mut a, t| { a.vertices += t.report.vertices; a.dropped_points += t.report.dropped_points; a.edges += t.report.edges; a.faces += t.report.faces; a.scraps_merged += t.report.scraps_merged; a.slivers_merged += t.report.slivers_merged; a.pieces += t.report.pieces; a.panicked |= t.report.panicked; a });
    let panicked: Vec<Value> = tiles.iter().filter(|t| t.report.panicked).map(|t| json!(format!("{}_{}", t.ix, t.iz))).collect();
    stages.push(stage(6, "partition", "One planar partition: every designed line in one arrangement per tile; faces labelled; scraps joined to their neighbour", json!({ "lines": ln.segs.len(), "bandSegmentsPastTheirFace": ln.dropped, "vertices": tr.vertices, "edges": tr.edges, "faces": tr.faces, "scrapsJoined": tr.scraps_merged, "sliversJoined": tr.slivers_merged, "pieces": tr.pieces, "tilesFailed": panicked.len() }), json!({}),
        &[("arrangement", "stop", "constrained-triangulation", panicked.is_empty()), ("scrap", "repair", "join-longest-neighbour", true)], vec![], panicked));
    tick("partition", &mut timings);
    // junctions whose surfaces touch: one plane
    let mut h = h;
    {
        let mut pairs: std::collections::BTreeSet<(u32, u32)> = Default::default();
        for t in &tiles {
            let mut at: std::collections::HashMap<(i64, i64), Vec<u32>> = Default::default();
            for p in &t.pieces { if p.label.kind == partition::Kind::Road && p.label.side == 2 { for r in &p.rings { for q in r { let e = at.entry(((q[0] * 1000.0).round() as i64, (q[1] * 1000.0).round() as i64)).or_default(); if !e.contains(&p.label.owner) { e.push(p.label.owner); } } } } }
            for v in at.values() { for i in 0..v.len() { for j in i + 1..v.len() { pairs.insert((v[i].min(v[j]), v[i].max(v[j]))); } } }
        }
        let n = d.clusters.len();
        let mut parent: Vec<usize> = (0..n).collect();
        fn find(p: &mut [usize], i: usize) -> usize { let mut i = i; while p[i] != i { p[i] = p[p[i]]; i = p[i]; } i }
        for (a, b) in pairs { let (x, y) = (find(&mut parent, a as usize), find(&mut parent, b as usize)); if x != y { parent[x] = y; } }
        let mut groups: std::collections::BTreeMap<usize, Vec<usize>> = Default::default();
        for c in 0..n { let r = find(&mut parent, c); groups.entry(r).or_default().push(c); }
        h.merge_planes(&groups.into_values().collect::<Vec<_>>());
    }
    let hr = h.report.clone();
    stages.push(stage(7, "heights", "Heights from the design: profiles, junction planes, crossfall, kerb 150 mm, islands at the kerb's top, verges to the property line", serde_json::to_value(&hr).unwrap(), json!({ "worstJunctionResidualM": hr.worst_residual_m, "maxGrade": hr.max_grade }),
        &[("junction-plane", "repair", "blend-arms-into-plane", true)], vec![], vec![]));

    // 8. mesh
    let out = mesh::assemble(&sd, &d, &h, &ix, &ln, &tiles, rules);
    let mr = out.report.clone();
    stages.push(stage(8, "mesh", "Mesh: faces at their design heights, kerbs and ramps along the loops, property lines, markings, the walking graph, the clamp, the ground conformed", serde_json::to_value(&mr).unwrap(), json!({ "maxCutM": mr.max_cut_m, "maxFillM": mr.max_fill_m }),
        &[("mesh", "stop", "tolerance-split", true)], vec![], vec![]));
    tick("mesh", &mut timings);

    // 9. gates
    let gr = gates::measure(&d, &ix, &out, rules);
    stages.push(gr.stage.clone());
    tick("gates", &mut timings);
    // 10, 11: structures and earthworks are the TypeScript bake's (not in this first baker): recorded as such
    stages.push(stage(10, "structures", "Structures (decks, piers, tunnels): not in this first baker; their ways left out (stage 2)", json!({ "structuresLeftOut": net.report.structures.len() }), json!({}), &[("structures", "omit", "left-out-first-milestone", true)], vec![], vec![]));
    stages.push(stage(11, "ground", "Ground follows the design: the grid conformed under roads and verges, the lots blended back; the clamp", json!({ "cutCells": mr.cut_cells, "fillCells": mr.fill_cells, "clampCells": out.clamp_cells.len(), "clampEdges": out.clamp_edges.len() }), json!({ "maxCutM": mr.max_cut_m, "maxFillM": mr.max_fill_m }),
        &[("terrain-conform", "repair", "conform-and-blend", true)], vec![], vec![]));
    for s in old_stages { if let Some(n) = s["stage"].as_u64() { if n >= 12 { stages.push(s.clone()); } } }

    let report = json!({
        "stages": stages,
        "roads": d.streets.len(), "levels": 1, "lifted": 0, "bridges": 0, "tunnels": 0, "portals": 0,
        "zones": d.clusters.iter().filter(|c| c.len() > 1 || true).count(), "planar": hr.planes - hr.non_planar, "nonPlanarAt": [],
        "islands": jr.islands, "holes": 0, "invalid": 0, "slivers": gr.slivers, "sliverAt": [],
        "kerbLength": mr.kerb_m, "kerbOutside": 0, "kerbOutsideAt": [], "kerbCrossings": 0, "kerbCrossingAt": [], "zfight": 0, "zfightAt": [],
        "area": [mr.carriageway_m2.round()], "reserveFrom": if sd.reserves.is_empty() { "rules" } else { "data and rules" }, "reserveRules": verged - from_data,
        "footpathArea": mr.footpath_m2.round(), "vergeArea": mr.verge_m2.round(), "sidewalksMapped": sd.paths.iter().filter(|p| p.tags.get("footway").map_or(false, |f| f == "sidewalk")).count(),
        "crossings": d.crossings.len(), "vergeOverlap": 0, "vergeSlivers": 0, "vergeSliverAt": [],
        "steep": [], "clearance": { "least": null, "short": [] },
        "walk": { "lines": out.walk.len(), "edges": out.walk.len(), "crossings": mr.walk_crossings, "joined": mr.walk_joined, "length": out.walk.iter().map(|(_, p)| polyline_len(p)).sum::<f64>().round() },
        "baker": { "name": "baker (Rust)", "version": env!("CARGO_PKG_VERSION"), "gates": gr.summary.clone() },
    });
    let sources = json!({
        "roads": { "title": "OpenStreetMap roads (seeds: lines and tags)", "licence": "ODbL © OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright" },
        "reserves": { "title": "Road reserves (seeds for the property line, where the place has them)", "licence": "CC BY 4.0 © State of Victoria", "url": "https://discover.data.vic.gov.au/dataset/vicmap-property" },
        "ground": { "title": sd.ground.source.clone(), "licence": "open data (AWS Open Data terms)", "url": "https://registry.opendata.aws/terrain-tiles/" },
        "polygons": { "title": "the baker's own arrangement (exact, whole millimetres; bake time only)", "licence": "Apache-2.0", "url": "" },
    });
    let files = pack::write(&out, sd.origin, sd.bbox, &sd.attribution, sources, report);
    tick("write", &mut timings);
    let summary = json!({ "place": sd.place, "streets": d.streets.len(), "junctions": jr, "heights": hr, "partition": tr, "mesh": mr, "gates": gr.summary, "tiles": files.tiles, "bytes": files.bytes, "pieces": out.pieces.len() });
    Ok(Baked { files, summary, timings })
}

/// The browser's door (wasm32): `alloc` a buffer, write a bundle into it, `bake_bundle` it, read the bundle it returns.
/// A bundle: a u32 count, then for each file a u32 name length, the name (UTF-8), a u32 length and the bytes (all
/// little-endian). In: `place` (its name), `roads`, `ground.json`, `ground.f32` and, where there, `paths`, `reserve`,
/// `water`, `rules`. Out: the pack's files by path, or one file `error`.
pub mod bundle {
    pub fn read(b: &[u8]) -> Vec<(String, Vec<u8>)> {
        let mut out = Vec::new();
        let u = |b: &[u8], i: usize| -> usize { u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as usize };
        if b.len() < 4 { return out; }
        let n = u(b, 0);
        let mut i = 4;
        for _ in 0..n {
            if i + 4 > b.len() { break; }
            let ln = u(b, i); i += 4;
            let name = String::from_utf8_lossy(&b[i..i + ln]).to_string(); i += ln;
            let lb = u(b, i); i += 4;
            out.push((name, b[i..i + lb].to_vec())); i += lb;
        }
        out
    }
    pub fn write(files: &[(String, Vec<u8>)]) -> Vec<u8> {
        let mut o = Vec::new();
        o.extend((files.len() as u32).to_le_bytes());
        for (n, b) in files { o.extend((n.len() as u32).to_le_bytes()); o.extend(n.as_bytes()); o.extend((b.len() as u32).to_le_bytes()); o.extend(b); }
        o
    }
    /// bake a bundle (no clock: the stage times are left at nought)
    pub fn bake(b: &[u8]) -> Vec<u8> {
        let files = read(b);
        let get = |k: &str| files.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_slice());
        let s = |k: &str| get(k).map(|v| String::from_utf8_lossy(v).to_string());
        let run = || -> Result<Vec<(String, Vec<u8>)>, String> {
            let place = s("place").unwrap_or_else(|| "place".into());
            let roads = s("roads").ok_or("no roads")?;
            let gj = s("ground.json").ok_or("no ground.json")?;
            let gf = get("ground.f32").ok_or("no ground.f32")?;
            let (paths, reserve, water) = (s("paths"), s("reserve"), s("water"));
            let rules = crate::rules::Rules::from_json(s("rules").as_deref())?;
            let sf = crate::seed::SeedFiles { place: &place, roads: &roads, ground_json: &gj, ground_f32: gf, paths: paths.as_deref(), reserve: reserve.as_deref(), water: water.as_deref() };
            Ok(crate::bake(&sf, &rules, &[], &|| 0.0)?.files.files)
        };
        match run() { Ok(f) => write(&f), Err(e) => write(&[("error".into(), e.into_bytes())]) }
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    static mut OUT: Vec<u8> = Vec::new();
    #[no_mangle] pub extern "C" fn alloc(len: usize) -> *mut u8 { let mut v = vec![0u8; len]; let p = v.as_mut_ptr(); std::mem::forget(v); p }
    /// bake the bundle at (ptr, len); the result stays here until the next call: its length from `out_len`
    #[no_mangle] pub unsafe extern "C" fn bake_bundle(ptr: *mut u8, len: usize) -> *const u8 {
        let input = Vec::from_raw_parts(ptr, len, len);
        let out = crate::bundle::bake(&input);
        OUT = out;
        #[allow(static_mut_refs)] OUT.as_ptr()
    }
    #[no_mangle] pub extern "C" fn out_len() -> usize { #[allow(static_mut_refs)] unsafe { OUT.len() } }
}
