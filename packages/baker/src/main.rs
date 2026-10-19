//! The command line: bake a place from the dataset's road inputs into a pack folder of your own.
//!   baker <roads input dir> <place> --out <dir> [--rules rules.json] [--built <old pack dir>]
//! Reads <dir>/<place>.geojson, .ground.json, .ground.f32 and (where there) .paths.geojson, .reserve.geojson,
//! .water.geojson; writes <out>/<place>/ (index.json, tiles, clamp, terrain.json, walk.json, each with its .gz).
//! --built copies an existing pack's built/ (buildings, trees, furniture) and its stage 12 to 15 records.
//! It never writes anywhere but --out.
use std::path::{Path, PathBuf};
use std::time::Instant;

fn peak_mb() -> f64 {
    std::fs::read_to_string("/proc/self/status").ok().and_then(|s| s.lines().find(|l| l.starts_with("VmHWM")).and_then(|l| l.split_whitespace().nth(1)?.parse::<f64>().ok())).map(|kb| kb / 1024.0).unwrap_or(f64::NAN)
}
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<u64> {
    std::fs::create_dir_all(to)?;
    let mut n = 0;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        let p = e.path();
        if p.is_dir() { n += copy_dir(&p, &to.join(e.file_name()))?; } else { n += std::fs::copy(&p, to.join(e.file_name()))?; }
    }
    Ok(n)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut pos = Vec::new();
    let (mut out, mut rules_file, mut built): (Option<PathBuf>, Option<PathBuf>, Option<PathBuf>) = (None, None, None);
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--out" => { out = args.get(i + 1).map(PathBuf::from); i += 1; }
            "--rules" => { rules_file = args.get(i + 1).map(PathBuf::from); i += 1; }
            "--built" => { built = args.get(i + 1).map(PathBuf::from); i += 1; }
            "--print-rules" => { println!("{}", serde_json::to_string_pretty(&baker::rules::Rules::default()).unwrap()); return; }
            a => pos.push(a.to_string()),
        }
        i += 1;
    }
    if pos.len() < 2 || out.is_none() { eprintln!("usage: baker <roads input dir> <place> --out <dir> [--rules rules.json] [--built <old pack dir>] | --print-rules"); std::process::exit(2); }
    let (dir, place, out) = (PathBuf::from(&pos[0]), pos[1].clone(), out.unwrap());
    let t0 = Instant::now();
    let read = |ext: &str| std::fs::read_to_string(dir.join(format!("{place}{ext}"))).ok();
    let roads = read(".geojson").unwrap_or_else(|| { eprintln!("no {place}.geojson in {}", dir.display()); std::process::exit(1) });
    let ground_json = read(".ground.json").expect("ground json");
    let ground_f32 = std::fs::read(dir.join(format!("{place}.ground.f32"))).expect("ground grid");
    let (paths, reserve, water) = (read(".paths.geojson"), read(".reserve.geojson"), read(".water.geojson"));
    let rules = baker::rules::Rules::from_json(rules_file.as_ref().map(|f| std::fs::read_to_string(f).expect("rules file")).as_deref()).unwrap_or_else(|e| { eprintln!("{e}"); std::process::exit(2) });
    let files = baker::seed::SeedFiles { place: &place, roads: &roads, ground_json: &ground_json, ground_f32: &ground_f32, paths: paths.as_deref(), reserve: reserve.as_deref(), water: water.as_deref() };
    let old_stages: Vec<serde_json::Value> = built.as_ref().and_then(|b| std::fs::read_to_string(b.join("index.json")).ok()).and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()).and_then(|v| v["report"]["stages"].as_array().cloned()).unwrap_or_default();
    let read_s = t0.elapsed().as_secs_f64();
    let start = Instant::now();
    let baked = match baker::bake(&files, &rules, &old_stages, &|| start.elapsed().as_secs_f64()) { Ok(b) => b, Err(e) => { eprintln!("bake failed: {e}"); std::process::exit(1) } };
    let pack = out.join(&place);
    if pack.exists() { std::fs::remove_dir_all(&pack).expect("clear the pack folder"); }
    for (p, bytes) in &baked.files.files {
        let f = pack.join(p);
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(&f, bytes).unwrap();
    }
    if let Some(b) = &built { let from = b.join("built"); if from.is_dir() { copy_dir(&from, &pack.join("built")).expect("copy built/"); } }
    let total = t0.elapsed().as_secs_f64();
    for (k, v) in &baked.timings { eprintln!("  {k:<10} {v:>7.2} s"); }
    println!("{}", serde_json::to_string(&serde_json::json!({ "summary": baked.summary, "readS": read_s, "totalS": total, "peakMB": peak_mb(), "out": pack.display().to_string(), "threads": rayon::current_num_threads() })).unwrap());
}
