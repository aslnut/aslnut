// tools › arc-bench: arcs alone on a plain ground (no buildings, roads or trees), drawn as the twin dashboard's park
// access draws them (width 0.8 px, over the world, from the roof's top to the park, the rise a fifth of the length,
// the ramp's colours, brightest at the top). The driver (tools/arc-bench.mjs) sets the arcs and measures; the arc
// layer's own steps (read: the points along each arc; build: the segments and their upload; ground: every point's
// height again and the upload; upload) are timed here, from outside the library (it is not changed for this).
//   ?graphics=webgl2|webgpu &dpr=2 &ground=flat|terrain (the twin's: mapzen and the street level's grid) &quality=realistic
//   &points=n (the arc's points; default: by length)
import { arc, clampTerrain, data, earth, imagery, terrain, theme, world } from '../../src/index.ts';

/** an arc as the twin makes it: from lon, lat, to lon, lat, the roof's top (m), the distance (m), t (0 near … 1 far) */
export type Row = [number, number, number, number, number, number, number];
type Props = { from: [number, number]; to: [number, number]; top: number; dist: number; t: number };
const q = new URLSearchParams(location.search);
const VIEW = { lon: 145.1205, lat: -37.9245, zoom: 17.2, tilt: 50, bearing: 330 };
const ROADS = '/aslnut/data/packs/roads/street';
const RAMP: [number, string][] = [[0, '#22c55e'], [0.5, '#facc15'], [1, '#ef4444']];

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  const ground = q.get('ground') ?? 'flat';
  const plain = imagery.custom({ id: 'plain', attribution: '', draw: (g) => { g.fillStyle = '#232b37'; g.fillRect(0, 0, 256, 256); return true; } });
  const w = await world(canvas, {
    body: earth({ imagery: [plain], terrain: ground === 'terrain' ? [terrain.mapzen(), clampTerrain(terrain.grid({ url: `${ROADS}.ground`, blend: 60 }), `${ROADS}/clamp.json`)] : [], base: null, sky: false }),
    view: VIEW, graphics: (q.get('graphics') as 'webgpu' | 'webgl2' | null) ?? 'auto',
    quality: (q.get('quality') as 'realistic' | 'lite' | 'auto' | null) ?? 'realistic', pixelRatio: Number(q.get('dpr') ?? 2),
  });
  const hex = theme.dark({ ramp: RAMP }).ramp;
  const rows = data.rows([], { id: 'id' });
  const P = (d: unknown) => (d as { props: Props }).props;
  const pts = q.get('points');
  const layer = arc({
    id: 'arcs', data: rows as never, from: (d) => P(d).from, to: (d) => P(d).to, height: (d) => Math.max(8, P(d).dist * 0.22), width: 0.8,
    fromHeight: (d) => P(d).top + 0.3, over: true, color: (d) => hex(P(d).t), pickable: false, opacity: 0.95,
    shader: { color: 'color = vec4f(color.rgb * (0.55 + 0.45 * sin(3.14159265 * along)), color.a);' },
    ...(pts ? { points: Number(pts) } : {}),
  });
  // the arc layer's steps, timed from outside (ms per call), and what it hands the graphics (each write to a buffer of
  // its own: ms and bytes)
  const times: Record<string, number[]> = { read: [], build: [], ground: [], upload: [], uploadBytes: [] };
  const G = w.graphics as unknown as { buffer: (...a: unknown[]) => { write: (d: ArrayBufferView, o?: number) => void } };
  const make = G.buffer.bind(G);
  G.buffer = (...a: unknown[]) => {
    const b = make(...a); if (!String(a[2] ?? '').startsWith('arcs ')) return b;
    const wr = b.write.bind(b);
    b.write = (d: ArrayBufferView, o?: number) => { const t0 = performance.now(); wr(d, o); times.upload!.push(performance.now() - t0); times.uploadBytes!.push(d.byteLength); };
    if (typeof a[1] === 'object') times.uploadBytes!.push((a[1] as ArrayBufferView).byteLength);
    return b;
  };
  const L = layer as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const m of ['read', 'build', 'ground']) {
    const f = L[m]!.bind(layer);
    L[m] = (...a: unknown[]) => { const t0 = performance.now(), r = f(...a); times[m]!.push(performance.now() - t0); return r; };
  }
  w.add(layer);
  /** set the arcs as the twin does (a feature collection of rows: geometry none, the ends in the props) */
  const set = (list: Row[]) => {
    rows.set({ type: 'FeatureCollection', features: list.map((r, i) => ({ type: 'Feature', id: `h${i}`, properties: { from: [r[0], r[1]], to: [r[2], r[3]], top: r[4], dist: r[5], t: r[6] }, geometry: null })) } as never);
    w.invalidate();
  };
  document.querySelector('#note')!.textContent = `arc bench · ${w.graphicsApi} · ground ${ground}`;
  (window as unknown as { aslnutDemo: unknown }).aslnutDemo = { w, layer, rows, set, times, VIEW };
}
void main();
