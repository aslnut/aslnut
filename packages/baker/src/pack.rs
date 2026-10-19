//! The pack, exactly as the TypeScript writer (core › data › loading › chunks › write) lays it out, so aslnut reads it
//! unchanged:
//!   index.json  { v: 2, size: 500, origin, bbox, kinds, tiles: [[ix, iz]], attribution, sources, report }
//!   ix_iz.json  { v: 3, ix, iz, size, infos: [{ kind, props }], numericScale: 100, turnUnits: 10, numeric: [row] }
//!               rows: area [4, kind, info, down, rings, n.., x, z, h ..], poly [1, kind, info, fan, n, x, z, h ..],
//!               edge [5, kind, info, n, x, z, h, ground, dx, dz ..]; x, z from the tile's corner; 2 decimals
//!   clamp.json  { v: 3, terrain: 'terrain.json', origin, size, tiles }; clamp/ix_iz.json { v: 4, numericScale: 100,
//!               numericCells: [[rings, n.., x, z, h ..]], numericEdges: [[x, z, h ..]] } (place metres)
//!   terrain.json { x0, z0, step, nx, nz, numeric: [the grid] }; walk.json { v: 1, origin, lines: [[kind, x, z ..]] }
//!   every .json beside its .json.gz
//! numbers: each row rounded to 1/100, three interleaved delta channels, zigzag varints, base64.
use crate::geom::{r2, js_round, P2};
use crate::mesh::{Info, Out, Piece};
use base64::Engine;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::Write;

pub const SIZE: f64 = 500.0;

pub fn encode_row(row: &[f64], scale: f64) -> String {
    let mut bytes: Vec<u8> = Vec::with_capacity(row.len() * 2);
    let mut prev = [0i64; 3];
    for (i, v) in row.iter().enumerate() {
        let n = js_round(v * scale) as i64;
        let delta = n - prev[i % 3];
        prev[i % 3] = n;
        let mut z: u64 = if delta < 0 { (-delta * 2 - 1) as u64 } else { (delta * 2) as u64 };
        loop {
            let b = (z % 128) as u8;
            z /= 128;
            bytes.push(b + if z != 0 { 128 } else { 0 });
            if z == 0 { break; }
        }
    }
    base64::engine::general_purpose::STANDARD.encode(bytes)
}
pub fn decode_row(s: &str, scale: f64) -> Vec<f64> {
    let bin = base64::engine::general_purpose::STANDARD.decode(s).unwrap_or_default();
    let mut out = Vec::new();
    let mut prev = [0f64; 3];
    let (mut value, mut factor) = (0f64, 1f64);
    for b in bin {
        value += (b % 128) as f64 * factor;
        if b >= 128 { factor *= 128.0; continue; }
        let ch = out.len() % 3;
        let delta = if value as u64 % 2 == 1 { -(value + 1.0) / 2.0 } else { value / 2.0 };
        prev[ch] += delta;
        out.push(prev[ch] / scale);
        value = 0.0; factor = 1.0;
    }
    out
}

pub struct Files { pub files: Vec<(String, Vec<u8>)>, pub bytes: usize, pub tiles: usize }
impl Files {
    fn json(&mut self, path: &str, v: &Value) -> usize {
        let s = serde_json::to_vec(v).unwrap();
        let n = s.len();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(&s).unwrap();
        self.files.push((format!("{path}.gz"), gz.finish().unwrap()));
        self.files.push((path.to_string(), s));
        self.bytes += n;
        n
    }
}

pub fn write(out: &Out, origin: [f64; 2], bbox: [f64; 4], attribution: &str, sources: Value, report: Value) -> Files {
    let mut f = Files { files: vec![], bytes: 0, tiles: 0 };
    let mut kinds: Vec<&'static str> = Vec::new();
    let mut kind_no = |k: &'static str| -> f64 { (match kinds.iter().position(|x| *x == k) { Some(i) => i, None => { kinds.push(k); kinds.len() - 1 } }) as f64 };
    struct T { rows: Vec<Vec<f64>>, infos: Vec<usize>, map: BTreeMap<usize, usize> }
    let mut tiles: BTreeMap<(i32, i32), T> = BTreeMap::new();
    for p in &out.pieces {
        let m = p.middle();
        let (ix, iz) = ((m[0] / SIZE).floor() as i32, (m[1] / SIZE).floor() as i32);
        let (ox, oz) = (ix as f64 * SIZE, iz as f64 * SIZE);
        let t = tiles.entry((ix, iz)).or_insert_with(|| T { rows: vec![], infos: vec![], map: BTreeMap::new() });
        let info = *t.map.entry(p.info()).or_insert_with(|| { t.infos.push(p.info()); t.infos.len() - 1 }) as f64;
        let k = kind_no(p.kind());
        let xy = |q: &[f64]| [r2(q[0] - ox), r2(q[1] - oz)];
        let row: Vec<f64> = match p {
            Piece::Area { rings, .. } => {
                let mut r = vec![4.0, k, info, 0.0, rings.len() as f64];
                r.extend(rings.iter().map(|x| x.len() as f64));
                for ring in rings { for q in ring { let [x, z] = xy(q); r.extend([x, z, r2(q[2])]); } }
                r
            }
            Piece::Poly { ring, .. } => {
                let mut r = vec![1.0, k, info, 0.0, ring.len() as f64];
                for q in ring { let [x, z] = xy(q); r.extend([x, z, r2(q[2])]); }
                r
            }
            Piece::Strip { edges, .. } => {
                let mut r = vec![0.0, k, info, edges.len() as f64, edges[0].len() as f64];
                for e in edges { for q in e { let [x, z] = xy(q); r.extend([x, z, r2(q[2])]); } }
                r
            }
            Piece::Edge { pts, .. } => {
                let mut r = vec![5.0, k, info, pts.len() as f64];
                for q in pts { let [x, z] = xy(q); r.extend([x, z, r2(q[2]), r2(q[3]), r2(q[4]), r2(q[5])]); }
                r
            }
        };
        t.rows.push(row);
    }
    let tile_list: Vec<[i32; 2]> = tiles.keys().map(|(a, b)| [*a, *b]).collect();
    for ((ix, iz), t) in &tiles {
        let infos: Vec<Value> = t.infos.iter().map(|&i| { let Info { kind, props } = &out.infos[i]; json!({ "kind": kind, "props": props }) }).collect();
        let numeric: Vec<String> = t.rows.iter().map(|r| encode_row(r, 100.0)).collect();
        f.json(&format!("{ix}_{iz}.json"), &json!({ "v": 3, "ix": ix, "iz": iz, "size": SIZE, "infos": infos, "numericScale": 100, "turnUnits": 10, "numeric": numeric }));
    }
    f.tiles = tiles.len();
    // the clamp: each piece in every tile its box (and 20 m round) touches
    let mut ct: BTreeMap<(i32, i32), (Vec<Vec<f64>>, Vec<Vec<f64>>)> = BTreeMap::new();
    let into = |pts: &[[f64; 3]], ct: &mut BTreeMap<(i32, i32), (Vec<Vec<f64>>, Vec<Vec<f64>>)>, row: &Vec<f64>, cell: bool| {
        let (mut x0, mut z0, mut x1, mut z1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for q in pts { x0 = x0.min(q[0]); x1 = x1.max(q[0]); z0 = z0.min(q[1]); z1 = z1.max(q[1]); }
        let m = 20.0;
        for ix in ((x0 - m) / SIZE).floor() as i32..=((x1 + m) / SIZE).floor() as i32 {
            for iz in ((z0 - m) / SIZE).floor() as i32..=((z1 + m) / SIZE).floor() as i32 {
                let e = ct.entry((ix, iz)).or_default();
                if cell { e.0.push(row.clone()); } else { e.1.push(row.clone()); }
            }
        }
    };
    for rs in &out.clamp_cells {
        let mut row = vec![rs.len() as f64];
        row.extend(rs.iter().map(|r| r.len() as f64));
        for r in rs { for q in r { row.extend([r2(q[0]), r2(q[1]), r2(q[2])]); } }
        into(&rs[0], &mut ct, &row, true);
    }
    for l in &out.clamp_edges {
        let mut a = 0;
        while a + 1 < l.len() {
            let mut len = 0.0;
            let mut b = a;
            while b + 1 < l.len() && len < 50.0 { len += (l[b + 1][0] - l[b][0]).hypot(l[b + 1][1] - l[b][1]); b += 1; }
            let part = &l[a..=b];
            let row: Vec<f64> = part.iter().flat_map(|q| [r2(q[0]), r2(q[1]), r2(q[2])]).collect();
            into(part, &mut ct, &row, false);
            a = b;
        }
    }
    for ((ix, iz), (cells, edges)) in &ct {
        f.json(&format!("clamp/{ix}_{iz}.json"), &json!({ "v": 4, "numericScale": 100, "numericCells": cells.iter().map(|r| encode_row(r, 100.0)).collect::<Vec<_>>(), "numericEdges": edges.iter().map(|r| encode_row(r, 100.0)).collect::<Vec<_>>() }));
    }
    f.json("clamp.json", &json!({ "v": 3, "terrain": "terrain.json", "origin": origin, "size": SIZE, "tiles": ct.keys().map(|(a, b)| [*a, *b]).collect::<Vec<_>>() }));
    let t = &out.terrain;
    let grid: Vec<f64> = t.data.iter().map(|v| r2(*v)).collect();
    f.json("terrain.json", &json!({ "x0": t.x0, "z0": t.z0, "step": t.step, "nx": t.nx, "nz": t.nz, "numeric": [encode_row(&grid, 100.0)] }));
    let lines: Vec<Value> = out.walk.iter().map(|(k, pts)| { let mut v = vec![json!(k)]; for p in pts { v.push(json!(r2(p[0]))); v.push(json!(r2(p[1]))); } Value::Array(v) }).collect();
    f.json("walk.json", &json!({ "v": 1, "origin": origin, "lines": lines }));
    f.json("index.json", &json!({ "v": 2, "size": SIZE, "origin": origin, "bbox": bbox, "kinds": kinds, "tiles": tile_list, "attribution": attribution, "sources": sources, "report": report }));
    f
}

#[allow(dead_code)]
pub fn mid(p: &[P2]) -> P2 { let n = p.len() as f64; [p.iter().map(|q| q[0]).sum::<f64>() / n, p.iter().map(|q| q[1]).sum::<f64>() / n] }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn numbers_round_trip_like_the_typescript_codec() {
        let row = vec![4.0, 1.0, 0.0, -12.34, 499.99, 31.07, 0.005, -0.005, 1e6];
        let back = decode_row(&encode_row(&row, 100.0), 100.0);
        for (a, b) in row.iter().zip(back) { assert!((js_round(a * 100.0) / 100.0 - b).abs() < 1e-9, "{a} {b}"); }
        // a known value from the TypeScript encoder: [1, 2, 3] at scale 100 -> varints 200 1, 144 3, 216 4
        assert_eq!(encode_row(&[1.0, 2.0, 3.0], 100.0), base64::engine::general_purpose::STANDARD.encode([200u8, 1, 144, 3, 216, 4]));
    }
}
