// A small OGC web map and feature service for the tools (no network, the same answers on every run), at
// /aslnut/mock/ows/wfs and /aslnut/mock/ows/wms on the tools' server: the layers example's checks (&parity=1) ask it
// what they would ask a real service. Its features stand round Clayton, Melbourne, one of each kind of shape:
//   vmlite_locality_polygon   suburbs: a grid of polygons, the one under the views' middle with a hole in it
//   vmlite_lga         two councils: polygons      foi_polygon   sites: multipolygons (two pieces each) round the middle
//   hy_watercourse     creeks: lines            foi_line   pipelines: multilines (two pieces each)
//   foi_point          places: multipoints (one to three points), five kinds      hy_water_point   points
// WFS: GetCapabilities (2.0.0 / 1.1.0), DescribeFeatureType, GetFeature as GeoJSON by box (latitude first in the URN
// form; EPSG:4326 short as longitude first; EPSG:3857 metres), paged (count / startIndex; maxFeatures), numberMatched.
// WMS: GetCapabilities, GetMap (CRS:84 / EPSG:4326 / EPSG:3857: zones as coloured cells, a hazard as a band),
// GetLegendGraphic, GetFeatureInfo (the zone at the place).
import { png } from './png.mjs';

const NS = 'open-data-platform';
/** the views' middle (examples/layers ?go=top) */
export const MIDDLE = [145.1215, -37.9235];
const ring = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const KINDS = ['education centre', 'hospital', 'community venue', 'emergency facility', 'recreational resource'];

function features() {
  const out = {};
  // suburbs: 4 × 3 cells of 0.02°, the one under the middle with a hole of 0.0012° round it
  const sub = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const w = 145.08 + i * 0.02, s = -37.95 + j * 0.02, e = w + 0.02, n = s + 0.02, rings = [ring(w, s, e, n)];
    if (MIDDLE[0] > w && MIDDLE[0] < e && MIDDLE[1] > s && MIDDLE[1] < n) rings.push(ring(MIDDLE[0] - 0.0006, MIDDLE[1] - 0.0006, MIDDLE[0] + 0.0006, MIDDLE[1] + 0.0006).reverse());
    sub.push({ type: 'Feature', id: `vmlite_locality_polygon.${i * 3 + j + 1}`, geometry: { type: 'Polygon', coordinates: rings }, properties: { locality_name: `SUBURB ${String.fromCharCode(65 + i)}${j + 1}`, label_use_code: 5, area_note: rings.length > 1 ? 'with a hole' : 'whole' } });
  }
  out.vmlite_locality_polygon = sub;
  // councils: west and east
  out.vmlite_lga = [
    { type: 'Feature', id: 'vmlite_lga.1', geometry: { type: 'Polygon', coordinates: [ring(145.08, -37.95, 145.1225, -37.89)] }, properties: { lga_name: 'WEST COUNCIL', lga_code: '901' } },
    { type: 'Feature', id: 'vmlite_lga.2', geometry: { type: 'Polygon', coordinates: [ring(145.1225, -37.95, 145.16, -37.89)] }, properties: { lga_name: 'EAST COUNCIL', lga_code: '902' } },
  ];
  // sites: four multipolygons round the middle, each two blocks of 0.0007° with a gap of 0.0004° between them
  out.foi_polygon = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy], k) => {
    const x = MIDDLE[0] + sx * 0.0024, y = MIDDLE[1] + sy * 0.0024;
    return { type: 'Feature', id: `foi_polygon.${k + 1}`, geometry: { type: 'MultiPolygon', coordinates: [[ring(x - 0.0009, y - 0.00035, x - 0.0002, y + 0.00035)], [ring(x + 0.0002, y - 0.00035, x + 0.0009, y + 0.00035)]] }, properties: { feature_type: ['reserve', 'education centre', 'hospital', 'sport facility'][k], feature_subtype: 'mock site', name: `SITE ${k + 1}` } };
  });
  // creeks: wavy lines west to east, one through the middle
  out.hy_watercourse = [0, 1, 2].map((k) => {
    const lat0 = MIDDLE[1] - 0.0008 + (k - 1) * 0.012, pts = [];
    for (let x = 0; x <= 40; x++) { const lon = 145.08 + x * 0.002; pts.push([+lon.toFixed(6), +(lat0 + 0.0004 * Math.sin(x * 0.9)).toFixed(6)]); }
    return { type: 'Feature', id: `hy_watercourse.${k + 1}`, geometry: { type: 'LineString', coordinates: pts }, properties: { name: `CREEK ${k + 1}`, hierarchy: 'L' } };
  });
  // pipelines: two pieces each, north to south, one near the middle
  out.foi_line = [0, 1].map((k) => {
    const lon = MIDDLE[0] + 0.0009 + k * 0.015;
    return { type: 'Feature', id: `foi_line.${k + 1}`, geometry: { type: 'MultiLineString', coordinates: [[[lon, -37.95], [lon, MIDDLE[1] - 0.0015]], [[lon, MIDDLE[1] + 0.0015], [lon + 0.004, -37.89]]] }, properties: { feature_type: 'pipeline', feature_subtype: k ? 'oil pipeline' : 'gas pipeline', name: `PIPELINE ${k + 1}` } };
  });
  // places: a 7 × 7 lattice of 0.0022°, each a multipoint of one to three points
  const pl = [];
  let id = 1;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const lon = MIDDLE[0] + i * 0.0022 + 0.0011, lat = MIDDLE[1] + j * 0.0022 + 0.0011, n = 1 + ((i + j + 9) % 3), pts = [];
    for (let k = 0; k < n; k++) pts.push([+(lon + k * 0.00025).toFixed(6), +(lat + k * 0.00018).toFixed(6)]);
    pl.push({ type: 'Feature', id: `foi_point.${id}`, geometry: { type: 'MultiPoint', coordinates: pts }, properties: { feature_type: KINDS[(i + 3 + (j + 3) * 2) % 5], name: `PLACE ${id}`, name_label: `Place ${id}` } });
    id++;
  }
  out.foi_point = pl;
  // water points: dams
  out.hy_water_point = [[-0.0016, 0.0012], [0.0021, -0.0019], [0.006, 0.004]].map(([dx, dy], k) => ({ type: 'Feature', id: `hy_water_point.${k + 1}`, geometry: { type: 'Point', coordinates: [+(MIDDLE[0] + dx).toFixed(6), +(MIDDLE[1] + dy).toFixed(6)] }, properties: { feature_type_code: 'wb_dam', name: `DAM ${k + 1}` } }));
  return out;
}
const FEATURES = features();
const boxOf = (g) => { let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity; const add = (p) => { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }; JSON.stringify(g.coordinates, (k, v) => { if (Array.isArray(v) && typeof v[0] === 'number') add(v); return v; }); return [w, s, e, n]; };
const R = 6378137, lonOf = (x) => (x / R) * (180 / Math.PI), latOf = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
const xOf = (lon) => lon * (Math.PI / 180) * R, yOf = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R;
/** a bbox parameter → [w, s, e, n] in degrees */
function parseBox(v) {
  const p = v.split(','), crs = p[4] ?? 'EPSG:4326', a = p.slice(0, 4).map(Number);
  if (/3857|900913/.test(crs)) return [lonOf(a[0]), latOf(a[1]), lonOf(a[2]), latOf(a[3])];
  if (/::4326|\/4326$/.test(crs)) return [a[1], a[0], a[3], a[2]];
  return a;
}
const meets = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
/** the requests answered (the tools read them: what a view asked for) */
export const asked = [];

function wfsCaps(v) {
  const types = Object.keys(FEATURES).map((k) => `<FeatureType><Name>${NS}:${k}</Name><Title>${k}</Title><DefaultCRS>urn:ogc:def:crs:EPSG::7844</DefaultCRS><OtherCRS>urn:ogc:def:crs:EPSG::4326</OtherCRS><OtherCRS>urn:ogc:def:crs:EPSG::3857</OtherCRS><ows:WGS84BoundingBox><ows:LowerCorner>145.07 -37.97</ows:LowerCorner><ows:UpperCorner>145.17 -37.88</ows:UpperCorner></ows:WGS84BoundingBox></FeatureType>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><wfs:WFS_Capabilities version="${v}" xmlns="http://www.opengis.net/wfs/2.0" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:ows="http://www.opengis.net/ows/1.1"><ows:ServiceIdentification><ows:Title>mock features</ows:Title></ows:ServiceIdentification><ows:OperationsMetadata><ows:Operation name="GetFeature"><ows:Parameter name="outputFormat"><ows:AllowedValues><ows:Value>application/json</ows:Value><ows:Value>GML2</ows:Value></ows:AllowedValues></ows:Parameter></ows:Operation><ows:Constraint name="ImplementsResultPaging"><ows:NoValues/><ows:DefaultValue>TRUE</ows:DefaultValue></ows:Constraint><ows:Constraint name="CountDefault"><ows:NoValues/><ows:DefaultValue>5000</ows:DefaultValue></ows:Constraint></ows:OperationsMetadata><FeatureTypeList>${types}</FeatureTypeList></wfs:WFS_Capabilities>`;
}
function describe(type) {
  const f = FEATURES[type.replace(`${NS}:`, '')]?.[0]; if (!f) return null;
  const gt = { Polygon: 'SurfacePropertyType', MultiPolygon: 'MultiSurfacePropertyType', LineString: 'CurvePropertyType', MultiLineString: 'MultiCurvePropertyType', Point: 'PointPropertyType', MultiPoint: 'MultiPointPropertyType' }[f.geometry.type];
  const els = Object.keys(f.properties).map((k) => `<xsd:element maxOccurs="1" minOccurs="0" name="${k}" nillable="true" type="xsd:string"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:gml="http://www.opengis.net/gml/3.2"><xsd:complexType name="t"><xsd:complexContent><xsd:extension base="gml:AbstractFeatureType"><xsd:sequence><xsd:element maxOccurs="1" minOccurs="0" name="geom" nillable="true" type="gml:${gt}"/>${els}</xsd:sequence></xsd:extension></xsd:complexContent></xsd:complexType></xsd:schema>`;
}
function getFeature(q) {
  const type = (q.get('typeNames') ?? q.get('typeName') ?? '').replace(`${NS}:`, ''), list = FEATURES[type];
  if (!list) return { status: 400, type: 'application/xml', body: `<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1"><ows:Exception><ows:ExceptionText>Unknown feature type ${type}</ows:ExceptionText></ows:Exception></ows:ExceptionReport>` };
  let box = q.get('bbox') ? parseBox(q.get('bbox')) : null;
  const cql = q.get('CQL_FILTER'); let eq = null;
  if (cql) { const m = /BBOX\(\w+,([^,]+),([^,]+),([^,]+),([^,]+),'([^']+)'\)/.exec(cql); if (m) box = parseBox(`${m[1]},${m[2]},${m[3]},${m[4]},${/3857/.test(m[5]) ? 'EPSG:3857' : 'EPSG:4326'}`); const e = /(\w+)\s*=\s*'([^']*)'/.exec(cql.replace(/BBOX\([^)]*\)/, '')); if (e) eq = [e[1], e[2]]; }
  const merc = /3857/.test(q.get('srsName') ?? '');
  const all = list.filter((f) => (!box || meets(boxOf(f.geometry), box)) && (!eq || String(f.properties[eq[0]]) === eq[1]));
  const count = Number(q.get('count') ?? q.get('maxFeatures') ?? 5000), start = Number(q.get('startIndex') ?? 0), page = all.slice(start, start + count);
  const out = merc ? page.map((f) => JSON.parse(JSON.stringify(f), (k, v) => (Array.isArray(v) && typeof v[0] === 'number' ? [xOf(v[0]), yOf(v[1])] : v))) : page;
  return { status: 200, type: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: out, totalFeatures: all.length, numberMatched: all.length, numberReturned: page.length, crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4326' } } }) };
}

// ── WMS ──
const ZONE = [[244, 165, 96], [130, 180, 220], [160, 210, 120], [230, 120, 160]];
const zoneAt = (lon, lat) => { const i = Math.floor((lon - 145) / 0.004), j = Math.floor((lat + 38) / 0.004); return ((i * 7 + j * 3) % 4 + 4) % 4; };
function getMap(q) {
  const layers = (q.get('LAYERS') ?? '').split(','), W = Math.min(4096, Number(q.get('WIDTH') ?? 256)), H = Math.min(4096, Number(q.get('HEIGHT') ?? 256));
  const crs = q.get('CRS') ?? q.get('SRS') ?? 'EPSG:4326', b = (q.get('BBOX') ?? '').split(',').map(Number), merc = /3857/.test(crs);
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) / H, lat = merc ? latOf(b[3] - fy * (b[3] - b[1])) : b[3] - fy * (b[3] - b[1]);
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / W, lon = merc ? lonOf(b[0] + fx * (b[2] - b[0])) : b[0] + fx * (b[2] - b[0]), o = (y * W + x) * 4;
      for (const l of layers) {
        if (/plan_zone/.test(l)) { const c = ZONE[zoneAt(lon, lat)]; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 200; }
        else if (/bushfire/.test(l)) { const d = (lon - MIDDLE[0]) + (lat - MIDDLE[1]); if (Math.abs(d - 0.003) < 0.0015) { rgba[o] = 220; rgba[o + 1] = 60; rgba[o + 2] = 30; rgba[o + 3] = 170; } }
      }
    }
  }
  return { status: 200, type: 'image/png', body: png(W, H, rgba) };
}
function legend() {
  const W = 20, H = 60, rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = ZONE[Math.floor(y / 15)], o = (y * W + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255; }
  return { status: 200, type: 'image/png', body: png(W, H, rgba) };
}
function wmsCaps(v) {
  const l = (n) => `<Layer queryable="1"><Name>${NS}:${n}</Name><Title>${n}</Title><CRS>CRS:84</CRS><CRS>EPSG:4326</CRS><CRS>EPSG:3857</CRS><EX_GeographicBoundingBox><westBoundLongitude>145.07</westBoundLongitude><eastBoundLongitude>145.17</eastBoundLongitude><southBoundLatitude>-37.97</southBoundLatitude><northBoundLatitude>-37.88</northBoundLatitude></EX_GeographicBoundingBox><Style><Name>default</Name><Title>default</Title><LegendURL width="20" height="60"><Format>image/png</Format><OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="/aslnut/mock/ows/wms?SERVICE=WMS&amp;REQUEST=GetLegendGraphic&amp;LAYER=${NS}:${n}"/></LegendURL></Style></Layer>`;
  return `<?xml version="1.0" encoding="UTF-8"?><WMS_Capabilities version="${v}" xmlns="http://www.opengis.net/wms"><Service><Name>WMS</Name><Title>mock maps</Title></Service><Capability><Request><GetMap><Format>image/png</Format></GetMap><GetFeatureInfo><Format>application/json</Format></GetFeatureInfo></Request><Layer><Title>mock</Title><CRS>CRS:84</CRS>${l('plan_zone')}${l('bushfire_prone_area')}</Layer></Capability></WMS_Capabilities>`;
}
function featureInfo(q) {
  const b = (q.get('BBOX') ?? '').split(',').map(Number), lon = (b[0] + b[2]) / 2, lat = (b[1] + b[3]) / 2, z = zoneAt(lon, lat);
  const f = /plan_zone/.test(q.get('QUERY_LAYERS') ?? '') ? [{ type: 'Feature', id: `plan_zone.${z + 1}`, geometry: null, properties: { zone_code: ['GRZ1', 'NRZ1', 'PPRZ', 'C1Z'][z], zone_description: ['General residential', 'Neighbourhood residential', 'Public park and recreation', 'Commercial 1'][z] } }] : [];
  return { status: 200, type: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: f }) };
}

/** answers one request (null: not the mock's); { status, type, body } */
export function answer(url) {
  const u = new URL(url, 'http://x');
  if (!u.pathname.startsWith('/aslnut/mock/ows/')) return null;
  // (parameters read without regard to case, as services do)
  const q = new Map([...u.searchParams].map(([k, v]) => [k.toLowerCase(), v])), get = (k) => q.get(k.toLowerCase()) ?? null, qq = { get };
  const req = (get('request') ?? '').toLowerCase(), svc = u.pathname.endsWith('/wms') ? 'wms' : 'wfs';
  asked.push({ svc, req, url: u.pathname + u.search });
  if (svc === 'wfs') {
    if (req === 'getcapabilities') return { status: 200, type: 'application/xml', body: wfsCaps(get('version') ?? '2.0.0') };
    if (req === 'describefeaturetype') { const d = describe(get('typeNames') ?? get('typeName') ?? ''); return d ? { status: 200, type: 'application/xml', body: d } : { status: 400, type: 'text/plain', body: 'unknown type' }; }
    if (req === 'getfeature') return getFeature(qq);
  } else {
    if (req === 'getcapabilities') return { status: 200, type: 'application/xml', body: wmsCaps(get('version') ?? '1.3.0') };
    if (req === 'getmap') return getMap(qq);
    if (req === 'getlegendgraphic') return legend();
    if (req === 'getfeatureinfo') return featureInfo(qq);
  }
  return { status: 400, type: 'text/plain', body: `unknown request ${req}` };
}
