// Street furniture of this twin, authored here with aslnut's shapes and placed by rules on what the street level has
// built: a wheelie bin at the kerb in front of every house on bin night (Sunday evening to Monday noon: the
// collection is on Monday), benches along the edges of parks facing in, bollards where a park meets a street.
import { color, entities, entity, EntityElement, flag, num, Rows, shape, type CityExtra, type Entity, type Feature, type World } from '../../src/index.ts';

type V2 = [number, number];
/** a 240 l wheelie bin: a tapered body, a hinged lid in the council's colour, two wheels, the handle at the back */
export const bin = shape({
  id: 'bin',
  params: { lid: color('#c43c2c'), body: color('#2f4f3a'), height: num(0.95, 1.1, 1.06) },
  budget: { whole: 400, simple: 60 },
  simple: true, far: 'box',
  build: (b, p) => {
    const h = p.height - 0.07;
    b.sweep([[-0.29, -0.36], [0.29, -0.36], [0.29, 0.36], [-0.29, 0.36]], { up: h }, { color: p.body, scale: [0.88, 1], material: 'painted', detail: 2 });
    b.solid('box', { size: [0.62, 0.06, 0.78], at: [0, p.height - 0.03, 0.02], color: p.lid, material: 'painted', round: 0.02 });
    b.solid('cylinder', { radius: 0.03, size: 0.5, axis: 'x', at: [0, p.height - 0.08, -0.38], color: p.body, detail: 0 });
    b.copy((b) => b.solid('cylinder', { radius: 0.1, size: 0.05, axis: 'x', at: [0.27, 0.1, -0.33], color: '#151515', sides: 10, detail: 1 }), { mirror: 'x' });
    b.anchor('handle', [0, p.height - 0.08, -0.4], { kind: 'grip' });
  },
});
/** a park bench: slats on two cast frames, a back rest */
export const bench = shape({
  id: 'bench',
  params: { length: num(1.2, 2.4, 1.8), back: flag(true), wood: color('#8a5a36') },
  budget: { whole: 500, simple: 80 },
  simple: true, far: 'box',
  build: (b, p) => {
    b.copy((b, i) => b.solid('box', { size: [p.length, 0.04, 0.09], at: [0, 0.45, -0.2 + i * 0.11], color: p.wood, detail: 1 }), { repeat: 4 });
    if (p.back) b.copy((b, i) => b.solid('box', { size: [p.length, 0.09, 0.035], at: [0, 0.62 + i * 0.12, -0.28], color: p.wood, turn: 0, detail: 1 }), { repeat: 3 });
    b.copy((b) => {
      b.solid('box', { size: [0.06, 0.45, 0.5], at: [p.length / 2 - 0.15, 0.225, 0], color: '#2b2e30', material: 'metal', detail: 2 });
      if (p.back) b.solid('box', { size: [0.06, 0.45, 0.06], at: [p.length / 2 - 0.15, 0.7, -0.3], color: '#2b2e30', material: 'metal', detail: 1 });
    }, { mirror: 'x' });
    b.anchor('seat', [0, 0.47, 0], { kind: 'sit' });
  },
});
/** a timber bollard with a sloped top */
export const bollard = shape({
  id: 'bollard',
  params: { height: num(0.6, 1.1, 0.9) },
  build: (b, p) => {
    b.solid('box', { size: [0.15, p.height, 0.15], at: [0, p.height / 2, 0], color: '#6d5a44', detail: 2 });
    b.solid('cone', { radius: 0.11, top: 0.02, size: 0.08, at: [0, p.height + 0.04, 0], color: '#5c4b39', sides: 4, detail: 0 });
  },
});

/** places from the street level: a bin at the kerb before each house, benches round parks, bollards where parks meet
 *  streets; rows of points (lon / lat) with their heading */
export function placeFurniture(built: { key: string; extra: CityExtra | undefined; ctx: { lonLat(x: number, z: number): [number, number] } }[]) {
  const bins: Feature[] = [], benches: Feature[] = [], bollards: Feature[] = [], parks: { id: string; name: string; ring: [number, number][] }[] = [];
  const pt = (id: string, ll: [number, number], heading: number, props: Record<string, unknown> = {}): Feature => ({ id, geometry: { type: 'Point', coordinates: ll }, props: { heading, ...props } }) as unknown as Feature;
  for (const t of built) {
    const e = t.extra; if (!e) continue;
    const segs: { a: V2; b: V2; w: number }[] = [];
    for (const r of e.roads) if (r.cls >= 3 && r.cls <= 5) for (let i = 0; i + 1 < r.pts.length; i++) segs.push({ a: r.pts[i]!, b: r.pts[i + 1]!, w: r.width });
    const near = (x: number, z: number) => { let best: { px: number; pz: number; d: number; w: number } | null = null; for (const s of segs) { const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L = dx * dx + dz * dz || 1, k = Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / L)), px = s.a[0] + dx * k, pz = s.a[1] + dz * k, d = Math.hypot(x - px, z - pz); if (!best || d < best.d) best = { px, pz, d, w: s.w }; } return best; };
    e.houses.forEach((h, i) => {
      const n = near(h.x, h.z); if (!n || n.d > 45) return;
      // at the kerb: the road's edge and 0.7 m in, facing the road
      const ux = (h.x - n.px) / n.d, uz = (h.z - n.pz) / n.d, off = n.w / 2 + 0.7;
      bins.push(pt(`${t.key}:bin:${i}`, t.ctx.lonLat(n.px + ux * off, n.pz + uz * off), (Math.atan2(-ux, uz) * 180) / Math.PI + 180, { what: 'wheelie bin', kind: i % 2 ? 'recycling' : 'rubbish' }));
    });
    e.parks.forEach((p, j) => {
      const ring = p.ring;
      parks.push({ id: `${t.key}:park:${j}`, name: p.name || 'a park', ring: ring.map(([x, z]) => t.ctx.lonLat(x, z)) }); let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x; cz += z; } cx /= ring.length; cz /= ring.length;
      let run = 0;
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i]!, b2 = ring[i + 1]!, len = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
        for (let s = (35 - run) % 35; s < len; s += 35) {
          const x = a[0] + ((b2[0] - a[0]) * s) / len, z = a[1] + ((b2[1] - a[1]) * s) / len, ix = cx - x, iz = cz - z, l = Math.hypot(ix, iz) || 1;
          // 3 m in from the edge, facing the park's middle
          benches.push(pt(`${t.key}:bench:${j}:${i}:${Math.round(s)}`, t.ctx.lonLat(x + (ix / l) * 3, z + (iz / l) * 3), (Math.atan2(ix, -iz) * 180) / Math.PI, { what: 'bench', park: p.name }));
          const n = near(x, z);
          if (n && n.d < n.w / 2 + 9) for (let k = -2; k <= 2; k++) { const bx = x + ((b2[0] - a[0]) / len) * k * 1.6, bz = z + ((b2[1] - a[1]) / len) * k * 1.6; bollards.push(pt(`${t.key}:bollard:${j}:${i}:${Math.round(s)}:${k}`, t.ctx.lonLat(bx, bz), 0, { what: 'bollard', park: p.name })); }
        }
        run = (run + len) % 35;
      }
    });
  }
  return { bins, benches, bollards, parks };
}

/** the furniture layers, kept to what the street level has built */
export function furniture(w: World) {
  const binRows = new Rows<Record<string, unknown>>([], { id: 'id' }), benchRows = new Rows<Record<string, unknown>>([], { id: 'id' }), bollardRows = new Rows<Record<string, unknown>>([], { id: 'id' });
  // bin night: from Sunday 5 pm to Monday noon (the world's local time)
  const binNight = (s: { time: { local?: { weekday?: number; hour: number } } }) => { const l = s.time.local; if (!l || l.weekday === undefined) return false; return (l.weekday === 0 && l.hour >= 17) || (l.weekday === 1 && l.hour < 12); };
  // the parks as places and the benches as things in them (core › entities: placement): a bench knows its park
  const places = new EntityElement({ id: 'furniture-places' }), things = new Map<string, Entity>();
  const parkOf = (id: string | number) => things.get(String(id))?.in?.data.name as string | undefined;
  const layers = [
    entities({ id: 'bins', shape: bin, data: binRows, heading: (d) => Number(d.props.heading), params: (d) => ({ lid: d.props.kind === 'recycling' ? '#e8c22c' : '#c43c2c' }), variation: { scale: 0.03 }, when: (s) => binNight(s as never) && s.observation.index >= 5 }),
    entities({ id: 'benches', shape: bench, data: benchRows, heading: (d) => Number(d.props.heading), variation: { builds: 2 }, when: { level: { from: 'street' } }, tooltip: (d) => `a bench · in ${parkOf(d.id) ?? 'no park'}` }),
    entities({ id: 'bollards', shape: bollard, data: bollardRows, variation: { scale: 0.05 }, when: { level: { from: 'street' } } }),
  ];
  const update = (built: Parameters<typeof placeFurniture>[0]) => {
    const f = placeFurniture(built);
    const rows = (fs: Feature[]) => ({ type: 'FeatureCollection', features: fs.map((x) => ({ type: 'Feature', id: x.id, geometry: x.geometry, properties: x.props })) });
    binRows.set(rows(f.bins) as never); benchRows.set(rows(f.benches) as never); bollardRows.set(rows(f.bollards) as never);
    for (const e of places.list()) places.remove(e.id);
    things.clear();
    for (const p of f.parks) places.add(entity({ id: p.id, kind: 'park', placement: 'place', at: p.ring[0]!, footprint: p.ring, data: { name: p.name } }));
    for (const b of f.benches) { const e = entity({ id: String(b.id), kind: 'bench', placement: 'thing', in: 'auto', at: (b.geometry as unknown as { coordinates: [number, number] }).coordinates }); places.add(e); things.set(String(b.id), e); }
  };
  void w;
  return { layers, update, places, parkOf };
}
