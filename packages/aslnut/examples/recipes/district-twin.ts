// A district twin: satellite imagery on the terrain, the streets built from their centre lines and tags, buildings
// raised from their footprints (houses with pitched roofs, offices with windows), street trees grown from their
// species, all lit by the real sun for the place and time, with shadows. A twin is looked at through levels: the
// buildings and trees are present from the district level in (a level changes past a margin and after a dwell, never
// with each move of the camera). Your data: three GeoJSON files.
import { buildings, data, earth, imagery, roads, sky, terrain, vegetation, world, zonedTime } from 'aslnut';

// your district's data (an OpenStreetMap or Overture extract works as it is)
const ROADS = 'data/roads.geojson';         // centre lines with OSM tags: highway, lanes, width, sidewalk…
const BUILDINGS = 'data/buildings.geojson'; // footprints with height or building:levels, roof:shape
const TREES = 'data/trees.geojson';         // points with a height (m) and a species

const canvas = document.querySelector('canvas')!;
const w = await world(canvas, {
  // sky(): the real sun and moon for the place and time; they light the world and cast its shadows
  body: earth({ imagery: [imagery.esri()], terrain: [terrain.mapzen()], sky: sky({ clouds: false }) }),
  view: { lon: 145.1215, lat: -37.9235, zoom: 17.8, tilt: 58, bearing: 30 },
  time: zonedTime('2026-01-15T16:00', 'Australia/Melbourne'),
  timeZone: 'Australia/Melbourne',
  render: { shadows: true },
  // the levels it is looked at: world › country › region › city › district › street › building › room
  observation: { levels: 'default' },
});

const near = { level: { from: 'district' } } as const;   // present from the district level in
w.add(
  roads({ id: 'roads', data: data.geojson(ROADS, { attribution: '© OpenStreetMap contributors' }), tooltip: (d) => String(d.props.name ?? 'road') }),
  buildings({ id: 'buildings', data: data.geojson(BUILDINGS), roofs: true, windows: { lit: 0.4 }, when: near,
    tooltip: (d) => `${d.props.building ?? 'building'} · ${d.props['height (m)']} m` }),
  vegetation({ id: 'trees', data: data.geojson(TREES), height: (d) => Number(d.props.height), species: (d) => String(d.props.species), when: near }),
);
// each change of the level (by the orbit, or by the app: w.setLevel('street'))
w.on('level', (e) => console.log(`level ${e.from} → ${e.to}`));
