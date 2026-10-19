//! Stage 1, seed: the place's map lines and tags, its ground and its reserves, read only. Nothing here is drawn; it
//! is what the design starts from.
use crate::geom::*;
use serde_json::Value;
use std::collections::BTreeMap;

pub type Tags = BTreeMap<String, String>;

#[derive(Clone, Debug)]
pub struct Way { pub id: i64, pub nodes: Vec<i64>, pub pts: Vec<P2>, pub tags: Tags }
#[derive(Clone, Debug)]
pub struct Point { pub id: i64, pub at: P2, pub tags: Tags }
#[derive(Clone, Debug)]
pub struct Path { pub pts: Vec<P2>, pub tags: Tags }

/// the ground: heights over the sea on a regular grid (place metres)
#[derive(Clone, Debug)]
pub struct Ground { pub x0: f64, pub z0: f64, pub step: f64, pub nx: usize, pub nz: usize, pub data: Vec<f32>, pub source: String }
impl Ground {
    /// bilinear, clamped to the grid
    pub fn at(&self, x: f64, z: f64) -> f64 {
        let fx = ((x - self.x0) / self.step).clamp(0.0, (self.nx - 1) as f64 - 1e-9);
        let fz = ((z - self.z0) / self.step).clamp(0.0, (self.nz - 1) as f64 - 1e-9);
        let i = fx.floor() as usize;
        let j = fz.floor() as usize;
        let u = fx - i as f64;
        let v = fz - j as f64;
        let q = j * self.nx + i;
        let d = &self.data;
        (d[q] as f64 * (1.0 - u) + d[q + 1] as f64 * u) * (1.0 - v) + (d[q + self.nx] as f64 * (1.0 - u) + d[q + self.nx + 1] as f64 * u) * v
    }
    pub fn bbox(&self) -> BBox { BBox { x0: self.x0, z0: self.z0, x1: self.x0 + (self.nx - 1) as f64 * self.step, z1: self.z0 + (self.nz - 1) as f64 * self.step } }
}

pub struct Seed {
    pub place: String,
    pub origin: [f64; 2],
    pub bbox: [f64; 4],
    pub attribution: String,
    pub ways: Vec<Way>,
    pub points: Vec<Point>,
    pub paths: Vec<Path>,
    pub reserves: Vec<Vec<P2>>,
    pub waters: Vec<Path>,
    pub ground: Ground,
}

/// the raw files of a place (any may be missing but the roads and the ground)
pub struct SeedFiles<'a> {
    pub place: &'a str,
    pub roads: &'a str,
    pub ground_json: &'a str,
    pub ground_f32: &'a [u8],
    pub paths: Option<&'a str>,
    pub reserve: Option<&'a str>,
    pub water: Option<&'a str>,
}

const KZ: f64 = 110574.0;
pub fn kx(lat: f64) -> f64 { 111320.0 * (lat * std::f64::consts::PI / 180.0).cos() }

fn tags_of(props: &Value, skip: &[&str]) -> Tags {
    let mut t = Tags::new();
    if let Some(o) = props.as_object() {
        for (k, v) in o {
            if skip.contains(&k.as_str()) { continue; }
            let s = match v { Value::String(s) => s.clone(), Value::Number(n) => n.to_string(), Value::Bool(b) => b.to_string(), _ => continue };
            t.insert(k.clone(), s);
        }
    }
    t
}
fn id_of(v: &Value) -> i64 { v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0) }

pub fn read(f: &SeedFiles) -> Result<Seed, String> {
    let hd: Value = serde_json::from_str(f.ground_json).map_err(|e| format!("ground json: {e}"))?;
    let origin = [hd["origin"]["lon"].as_f64().ok_or("ground: origin")?, hd["origin"]["lat"].as_f64().ok_or("ground: origin")?];
    let kxv = kx(origin[1]);
    let local = |lon: f64, lat: f64| -> P2 { [(lon - origin[0]) * kxv, -(lat - origin[1]) * KZ] };
    let nx = hd["nx"].as_u64().ok_or("ground: nx")? as usize;
    let nz = hd["nz"].as_u64().ok_or("ground: nz")? as usize;
    if f.ground_f32.len() < nx * nz * 4 { return Err("ground: short grid".into()); }
    let data: Vec<f32> = f.ground_f32.chunks_exact(4).take(nx * nz).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let ground = Ground { x0: hd["x0"].as_f64().unwrap_or(0.0), z0: hd["z0"].as_f64().unwrap_or(0.0), step: hd["step"].as_f64().unwrap_or(4.0), nx, nz, data, source: hd["source"].as_str().unwrap_or("").to_string() };

    let doc: Value = serde_json::from_str(f.roads).map_err(|e| format!("roads: {e}"))?;
    let coords = |v: &Value| -> Vec<P2> { v.as_array().map(|a| a.iter().filter_map(|c| Some(local(c[0].as_f64()?, c[1].as_f64()?))).collect()).unwrap_or_default() };
    let mut ways = Vec::new();
    let mut points = Vec::new();
    for ft in doc["features"].as_array().ok_or("roads: features")? {
        let g = &ft["geometry"];
        let props = &ft["properties"];
        match g["type"].as_str() {
            Some("LineString") => {
                let nodes: Vec<i64> = props["nodes"].as_array().map(|a| a.iter().map(id_of).collect()).unwrap_or_default();
                let pts = coords(&g["coordinates"]);
                if pts.len() < 2 || nodes.len() != pts.len() { continue; }
                ways.push(Way { id: id_of(&props["osm_id"]), nodes, pts, tags: tags_of(props, &["nodes", "osm_id"]) });
            }
            Some("Point") => {
                let c = &g["coordinates"];
                if let (Some(lon), Some(lat)) = (c[0].as_f64(), c[1].as_f64()) { points.push(Point { id: id_of(&props["osm_node"]), at: local(lon, lat), tags: tags_of(props, &["osm_node"]) }); }
            }
            _ => {}
        }
    }
    let bbox = doc["bbox"].as_array().map(|a| [a[0].as_f64().unwrap_or(0.0), a[1].as_f64().unwrap_or(0.0), a[2].as_f64().unwrap_or(0.0), a[3].as_f64().unwrap_or(0.0)]).unwrap_or([0.0; 4]);
    let lines = |text: Option<&str>| -> Result<Vec<Path>, String> {
        let Some(t) = text else { return Ok(vec![]) };
        let d: Value = serde_json::from_str(t).map_err(|e| e.to_string())?;
        Ok(d["features"].as_array().map(|a| a.iter().filter(|f| f["geometry"]["type"] == "LineString").map(|f| Path { pts: coords(&f["geometry"]["coordinates"]), tags: tags_of(&f["properties"], &[]) }).filter(|p| p.pts.len() > 1).collect()).unwrap_or_default())
    };
    let paths = lines(f.paths)?;
    let waters = lines(f.water)?;
    let mut reserves = Vec::new();
    if let Some(t) = f.reserve {
        let d: Value = serde_json::from_str(t).map_err(|e| e.to_string())?;
        for ft in d["features"].as_array().into_iter().flatten() {
            let g = &ft["geometry"];
            match g["type"].as_str() {
                Some("Polygon") => reserves.push(coords(&g["coordinates"][0])),
                Some("MultiPolygon") => for p in g["coordinates"].as_array().into_iter().flatten() { reserves.push(coords(&p[0])); },
                _ => {}
            }
        }
    }
    Ok(Seed { place: f.place.to_string(), origin, bbox, attribution: doc["attribution"].as_str().unwrap_or("").to_string(), ways, points, paths, reserves, waters, ground })
}
