//! Stage 4, sections: one cross-section per street from its tags and the rules. From the centre line out, each side:
//! lanes (to the carriageway's half width), the kerb band, then the verge: nature strip, footpath, the gap to the
//! property line. Every band is an offset of the street's one faired curve. Where the data has road reserves, each
//! side's property line is measured from them (the reserve is a seed too: the median of the distances found).
use crate::clean::Link;
use crate::curve::Curve;
use crate::geom::*;
use crate::rules::Rules;
use crate::seed::Tags;

#[derive(Clone, Debug, Default)]
pub struct Side {
    /// from the kerb's back to the property line (m); 0: no verge
    pub verge: f64,
    pub strip: f64,
    pub footpath: f64,
    pub gap: f64,
    /// measured from the data's reserve
    pub from_data: bool,
}
#[derive(Clone, Debug)]
pub struct Section {
    pub lanes: f64,
    /// half the carriageway (to the kerb's face)
    pub half: f64,
    /// the outline: half plus the kerb band
    pub outer: f64,
    pub kerbed: bool,
    /// [left, right] of the street's direction
    pub sides: [Side; 2],
}

fn num(t: &Tags, k: &str) -> Option<f64> { t.get(k).and_then(|v| v.trim().trim_end_matches(" m").parse::<f64>().ok()).filter(|v| v.is_finite() && *v > 0.0) }

/// the carriageway (after the TypeScript bake's profile of tags, so widths match)
pub fn carriageway(l: &Link, rules: &Rules) -> (f64, f64) {
    let t = &l.tags;
    let cls = l.cls;
    let link = t.get("highway").map_or(false, |h| h.ends_with("_link"));
    let lw = rules.lane.at(cls);
    let lanes = num(t, "lanes").unwrap_or(if l.oneway { if link { 1.0 } else if cls <= 2 { 2.0 } else { 1.0 } } else if cls <= 2 { 4.0 } else { 2.0 });
    let mut cw = num(t, "width").unwrap_or(if l.oneway { lanes * lw + if cls == 0 { 2.5 } else if link { 1.2 } else { 0.6 } } else if cls >= 5 { if cls >= 7 { 5.0 } else { 7.3 } } else { lanes * lw + 1.0 });
    if l.roundabout { cw = num(t, "width").unwrap_or((lanes * 4.5).max(6.0)); }
    (lanes, cw)
}

/// which sides have a footpath by the tags ([left, right]); a missing tag means yes
fn footpaths(t: &Tags) -> [bool; 2] {
    let sw = t.get("sidewalk").or_else(|| t.get("sidewalk:both")).map(|s| s.as_str());
    let side = |s: &str| -> bool {
        if let Some(v) = t.get(&format!("sidewalk:{s}")) { return v != "no" && v != "none"; }
        match sw { Some("no") | Some("none") => false, Some("left") => s == "left", Some("right") => s == "right", _ => true }
    };
    [side("left"), side("right")]
}

/// the reserve's property line beside a street side, measured from the data: the median distance from the kerb's
/// back to the reserve's edge (None where the data says little)
pub struct Reserves { polys: Vec<(BBox, Vec<P2>)>, grid: Grid }
impl Reserves {
    pub fn new(rs: &[Vec<P2>]) -> Self {
        let mut grid = Grid::new(50.0);
        let polys: Vec<(BBox, Vec<P2>)> = rs.iter().filter(|r| r.len() > 2).map(|r| (BBox::of(r), r.clone())).collect();
        for (i, (b, _)) in polys.iter().enumerate() { grid.add(b, i as u32); }
        Reserves { polys, grid }
    }
    pub fn is_empty(&self) -> bool { self.polys.is_empty() }
    pub fn inside(&self, p: P2, buf: &mut Vec<u32>) -> bool {
        self.grid.near(p, 0.0, buf);
        buf.iter().any(|&i| { let (b, r) = &self.polys[i as usize]; b.has(p) && pip(p, r) })
    }
    pub fn measure(&self, c: &Curve, outer: f64, sign: f64, reach: f64) -> Option<f64> {
        let l = c.length;
        if l < 20.0 { return None; }
        let mut found = Vec::new();
        let mut tries = 0;
        let mut buf = Vec::new();
        let mut s = 12.0;
        while s < l - 12.0 {
            tries += 1;
            let (p, t) = c.frame(s);
            let n = mul(left(t), sign);
            let k = add(p, mul(n, outer + 0.3));
            if self.inside(k, &mut buf) {
                let mut d = 0.25;
                while d <= reach {
                    if !self.inside(add(k, mul(n, d)), &mut buf) { found.push(d + 0.3); break; }
                    d += 0.25;
                }
            }
            s += 10.0;
        }
        if tries == 0 || (found.len() as f64) < 0.4 * tries as f64 { return None; }
        found.sort_by(|a, b| a.partial_cmp(b).unwrap());
        Some(found[found.len() / 2])
    }
}

pub fn section(l: &Link, c: &Curve, rules: &Rules, reserves: &Reserves) -> Section {
    let (lanes, cw) = carriageway(l, rules);
    let half = cw / 2.0;
    let kerbed = rules.kerbed[l.cls.min(7)];
    let outer = half + rules.kerb_width;
    let fp = footpaths(&l.tags);
    let mut sides = [Side::default(), Side::default()];
    if rules.verge[l.cls.min(7)] {
        for (k, sign) in [(0usize, 1.0f64), (1, -1.0)] {
            let rule = rules.verge_width.at(l.cls);
            let measured = if reserves.is_empty() { None } else { reserves.measure(c, outer, sign, rule * 2.5) };
            let verge = measured.map(|d| d.clamp(1.0, rule * 2.0)).unwrap_or(rule);
            let mut gap = rules.boundary_gap.at(l.cls).min(verge * 0.2);
            let mut footpath = if fp[k] { rules.footpath_width.at(l.cls).min((verge - gap).max(0.0)) } else { 0.0 };
            let mut strip = (verge - gap - footpath).max(0.0);
            // bands narrower than the least band are not bands: the footpath (or the strip) takes them
            if footpath > 0.0 {
                if gap < rules.least_band { footpath += gap; gap = 0.0; }
                if strip < rules.least_band { footpath += strip; strip = 0.0; }
            } else { strip += gap; gap = 0.0; }
            sides[k] = Side { verge, strip, footpath, gap, from_data: measured.is_some() };
        }
    }
    Section { lanes, half, outer, kerbed, sides }
}
