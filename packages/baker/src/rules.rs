//! Road-type rules as data. Every number the design uses lives here with a default (Victorian street standards and
//! the same defaults the TypeScript bake uses); a JSON file overrides any of them (`--rules my.json`), field by field.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// a value per road class (0 freeway, 1 highway, 2 arterial, 3 sub-arterial, 4 collector, 5 local, 6 track, 7 service)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ByClass(pub [f64; 8]);
impl ByClass { pub fn at(&self, cls: usize) -> f64 { self.0[cls.min(7)] } }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Rules {
    /// OSM highway value (without `_link`) to road class
    pub classes: BTreeMap<String, usize>,
    /// a lane's width (m)
    pub lane: ByClass,
    /// the kerb band (m, measured in from the carriageway's outline) and its height (m)
    pub kerb_width: f64,
    pub kerb_height: f64,
    /// the kerb ramp's opening (m) and its lip over the road (m)
    pub ramp_width: f64,
    pub ramp_lip: f64,
    /// each side of a ramp, where the kerb comes down to its lip (m)
    pub ramp_flare: f64,
    /// classes that have a kerb (a plain edge otherwise)
    pub kerbed: [bool; 8],
    /// classes with a verge (nature strip and footpath) beside them
    pub verge: [bool; 8],
    /// the verge from the kerb's back to the property line (m), where the data has no reserve
    pub verge_width: ByClass,
    pub footpath_width: ByClass,
    /// the footpath's distance from the property line (m)
    pub boundary_gap: ByClass,
    /// a band narrower than this (m) is no band of its own (the footpath takes it)
    pub least_band: f64,
    /// the kerb return's radius at a corner, by the smaller road's class (m)
    pub corner_radius: ByClass,
    /// a median's or island's nose (m)
    pub nose_radius: f64,
    /// corners sharper than this (degrees) are noses
    pub nose_angle: f64,
    /// a block no deeper than this (m) from its kerb is an island or a median: one surface at the kerb's top
    pub island_depth: f64,
    /// ... or smaller than this (m²)
    pub island_area: f64,
    /// a face smaller than this (m²) or shallower than this (m) is road (no kerb round it)
    pub least_island_area: f64,
    pub least_island_depth: f64,
    /// a face between one-way carriageways no wider than this on average (m) is a median (no footpath in it)
    pub median_width: f64,
    /// crossfall from the crown to the gutter
    pub crossfall: f64,
    /// how far an arm blends into its junction's plane (m)
    pub junction_blend: f64,
    /// the verge's crossfall: from the kerb's top it rises this much per metre to the property line (the ground
    /// beyond follows it); a range lets the property line meet the ground's own height within it instead
    pub verge_slope_min: f64,
    pub verge_slope_max: f64,
    /// fairing: how far an arc may leave the mapped vertex (m), the largest radius (m)
    pub fair_tolerance: f64,
    pub fair_radius_max: f64,
    /// drawing curves: chord tolerance (m) and the longest piece (m)
    pub chord_tolerance: f64,
    pub max_segment: f64,
    /// a street's surface between two stations straight within this (m): the stations its heights need
    pub vertical_tolerance: f64,
    /// stations no nearer than this (m) but the ones a street must have (its cuts, its ramps' edges)
    pub least_station: f64,
    /// the cells the surfaces are cut in (m, a divisor of the 500 m tile)
    pub cell: f64,
    /// the profile: smoothing (m, a Gaussian's sigma by class) and the steepest grade by class
    pub profile_sigma: ByClass,
    pub max_grade: ByClass,
    /// faces smaller than this (m²) are merged into their longest neighbour (never left as a hole)
    pub scrap_area: f64,
    /// markings: lift over the road (m), dash and gap (m), line width (m)
    pub marking_lift: f64,
    pub dash: f64,
    pub dash_gap: f64,
    pub line_width: f64,
    /// classes painted with lane lines (local streets are not)
    pub painted: [bool; 8],
    /// duplicate points closer than this are merged (m); a dead end this close to another road is joined to it (m)
    pub merge_distance: f64,
    pub snap_distance: f64,
    /// a vertex turning back sharper than this (degrees) on a short leg is a zigzag, dropped
    pub zigzag_angle: f64,
    pub zigzag_leg: f64,
    /// how far the design stays inside the ground grid (m)
    pub frame_margin: f64,
    /// how far beyond the property line the ground blends back to its own (m, at least), after a shoulder level
    /// with the property line (m)
    pub batter_reach: f64,
    pub boundary_shoulder: f64,
}

impl Default for Rules {
    fn default() -> Self {
        let mut classes = BTreeMap::new();
        for (k, v) in [("motorway", 0), ("trunk", 1), ("primary", 2), ("secondary", 3), ("tertiary", 4), ("unclassified", 5), ("residential", 5), ("living_street", 5), ("road", 5), ("service", 7)] { classes.insert(k.to_string(), v); }
        Rules {
            classes,
            lane: ByClass([3.5, 3.5, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3]),
            kerb_width: 0.45,
            kerb_height: 0.15,
            ramp_width: 1.8,
            ramp_lip: 0.02,
            ramp_flare: 1.3,
            kerbed: [false, true, true, true, true, true, true, true],
            verge: [false, true, true, true, true, true, true, false],
            verge_width: ByClass([0.0, 6.0, 6.0, 6.0, 5.5, 4.3, 3.5, 0.0]),
            footpath_width: ByClass([0.0, 3.0, 3.0, 2.5, 2.5, 1.5, 1.5, 1.5]),
            boundary_gap: ByClass([0.5, 0.5, 0.5, 0.5, 0.5, 0.05, 0.05, 0.05]),
            least_band: 0.3,
            corner_radius: ByClass([15.0, 15.0, 15.0, 15.0, 12.5, 7.5, 7.5, 4.0]),
            nose_radius: 1.0,
            nose_angle: 25.0,
            island_depth: 4.0,
            island_area: 300.0,
            median_width: 30.0,
            least_island_area: 15.0,
            least_island_depth: 0.8,
            crossfall: 0.025,
            junction_blend: 10.0,
            verge_slope_min: 0.025,
            verge_slope_max: 0.025,
            fair_tolerance: 0.6,
            fair_radius_max: 3000.0,
            chord_tolerance: 0.05,
            max_segment: 40.0,
            vertical_tolerance: 0.025,
            least_station: 1.0,
            cell: 50.0,
            profile_sigma: ByClass([30.0, 25.0, 20.0, 15.0, 12.0, 8.0, 6.0, 5.0]),
            max_grade: ByClass([0.06, 0.08, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20]),
            scrap_area: 0.25,
            marking_lift: 0.035,
            dash: 3.0,
            dash_gap: 9.0,
            line_width: 0.12,
            painted: [true, true, true, true, true, false, false, false],
            merge_distance: 0.05,
            snap_distance: 1.0,
            zigzag_angle: 150.0,
            zigzag_leg: 2.0,
            frame_margin: 30.0,
            batter_reach: 6.0,
            boundary_shoulder: 2.0,
        }
    }
}

impl Rules {
    /// the defaults, overridden by a JSON object (any subset of the fields)
    pub fn from_json(text: Option<&str>) -> Result<Rules, String> {
        match text {
            None => Ok(Rules::default()),
            Some(t) => {
                let mut base = serde_json::to_value(Rules::default()).map_err(|e| e.to_string())?;
                let over: serde_json::Value = serde_json::from_str(t).map_err(|e| format!("rules: {e}"))?;
                merge(&mut base, over);
                serde_json::from_value(base).map_err(|e| format!("rules: {e}"))
            }
        }
    }
    pub fn class_of(&self, highway: &str) -> usize {
        let h = highway.strip_suffix("_link").unwrap_or(highway);
        *self.classes.get(h).unwrap_or(&6)
    }
}
fn merge(base: &mut serde_json::Value, over: serde_json::Value) {
    match (base, over) {
        (serde_json::Value::Object(b), serde_json::Value::Object(o)) => { for (k, v) in o { merge(b.entry(k).or_insert(serde_json::Value::Null), v); } }
        (b, o) => *b = o,
    }
}
