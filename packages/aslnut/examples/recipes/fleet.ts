// A moving fleet from a log: half an hour of 24 buses (a CSV of samples: vehicle, time, place, battery) as one set of
// moving things on a light map. Each bus is drawn as a bus near the camera and a dot farther out, coloured by its
// battery, its wheels rolling by the distance it travelled, with a fading trail and a battery gauge over it; the log
// plays on the world's clock, looping.
import { drive, earth, entities, history, imagery, parseCSV, replay, terrain, world } from 'aslnut';
import { cars } from 'aslnut/modules/presets/vehicles';

// your log: one row per vehicle per sample (vehicle, time as ISO text, lon, lat, charge 0..1)
const LOG = 'data/trips.csv';

const canvas = document.querySelector('canvas')!;
const w = await world(canvas, {
  body: earth({ imagery: [imagery.esri({ layer: 'light' })], terrain: [terrain.mapzen()] }),
  view: { lon: 145.1215, lat: -37.9235, zoom: 16.8, tilt: 50, bearing: 0 },
});

// the log: each vehicle's samples, its battery a value carried with every sample (a byte: 0..1 in 255 steps), and the
// metres it has travelled (kept for the wheels)
const log = history.log({ values: { charge: { type: 'u8', domain: [0, 1] } }, travel: true });
const rows = parseCSV(await (await fetch(LOG)).text());
log.appendMany(rows.map((r) => ({ id: String(r.vehicle), t: String(r.time), lon: Number(r.lon), lat: Number(r.lat), values: { charge: Number(r.charge) } })));

w.add(entities({
  id: 'fleet', drive: drive.data(log),
  shape: cars.make({ type: 'bus' }),                         // near the camera; a dot farther out
  joints: { wheel: { value: 'travel' } },                     // every wheel (a joint of the shape) rolls by its bus's travel
  color: { value: 'charge', ramp: 'rdylgn', domain: [0, 1] }, // read from the samples at the world's time
  size: 8, outline: { color: '#ffffff', width: 1.5 },
  trail: { seconds: 90, width: 3 },
  // a bar over each with its per cent (by default only where the bus shape is drawn: `within` metres of the camera here)
  gauge: { value: 'charge', domain: [0, 1], label: true, within: 2000 },
  tooltip: (d) => `${d.id} · battery ${Math.round((d.state?.values.charge ?? 0) * 100)} %`,
}));

// the log's half hour on the world's clock: 10 times faster, looping
replay(w, { log, speed: 10, loop: true, play: true });
