// The street place's parks as one file for park access (examples › healthy-city › access-place.ts): the VEAC
// metropolitan open space polygons over the place's box, whole (the street tiles hold them cut at the tile edges), with
// their group and name. From the download the tiles tool caches (data/raw-city/), fetched again when it is not there.
//   node tools/street-parks.mjs [w s e n]   → data/packs/roads/street.parks.geojson (+ .gz)
// Source: VEAC metropolitan open space © VEAC / State of Victoria, CC BY 4.0 (WFS)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DATA = join(import.meta.dirname, '..', '..', '..', 'data'), RAW = join(DATA, 'raw-city'), OUT = join(DATA, 'packs', 'roads', 'street.parks.geojson');
const [W, S, E, N] = process.argv.length >= 6 ? process.argv.slice(2, 6).map(Number) : [145.09, -37.95, 145.16, -37.9];
const layer = 'veac_metro_open_space', cached = join(RAW, `wfs-${layer}-${W}_${S}_${E}_${N}.json`);
let features;
if (existsSync(cached)) features = JSON.parse(readFileSync(cached, 'utf8'));
else {
  features = [];
  for (let start = 0; ; start += 5000) {
    const url = `https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform:${layer}&outputFormat=application/json&count=5000&startIndex=${start}&bbox=${S},${W},${N},${E},urn:ogc:def:crs:EPSG::4326`;
    const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`);
    const j = await r.json(); features.push(...j.features); if (j.features.length < 5000) break;
  }
  writeFileSync(cached, JSON.stringify(features));
}
const round = (c) => (typeof c[0] === 'number' ? [+c[0].toFixed(6), +c[1].toFixed(6)] : c.map(round));
const out = {
  type: 'FeatureCollection', attribution: 'Open space © VEAC / State of Victoria, CC BY 4.0',
  features: features.filter((f) => f.geometry).map((f, i) => ({ type: 'Feature', id: i, properties: { name: f.properties?.name && f.properties.name !== 'NO DATA' ? f.properties.name : '', group: f.properties?.os_group ?? '', ha: f.properties?.ha ?? f.properties?.area_ha ?? null }, geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } })),
};
const text = JSON.stringify(out);
writeFileSync(OUT, text); writeFileSync(`${OUT}.gz`, gzipSync(text));
const groups = {}; for (const f of out.features) groups[f.properties.group] = (groups[f.properties.group] ?? 0) + 1;
console.log(`${out.features.length} open spaces → ${OUT} (${(text.length / 1024).toFixed(0)} KB) · ${Object.entries(groups).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
