// The suite's data: loaded (or made) once before the first case, then handed to both libraries as the same objects,
// so neither pays for parsing what the other got for free. Java's boundaries are real (BIG, simplified, in the data
// folder); the values, points and blocks are mock and seeded (the same every run).
export interface FC { type: 'FeatureCollection'; features: { type: 'Feature'; id?: string | number; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] }
const PACK = '/aslnut/data/packs/demo';

export const BREAKS = [16, 20, 24, 28];
export const COLORS = ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'];
export const colorOf = (v: number) => COLORS[BREAKS.filter((b) => v >= b).length]!;

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
function rng(seed: number) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }

/** a feature's centre (the mean of its coordinates) */
export const centreOf = (g: { coordinates: unknown }): [number, number] => { let x = 0, y = 0, n = 0; const walk = (c: unknown): void => { if (typeof (c as number[])[0] === 'number') { x += (c as number[])[0]!; y += (c as number[])[1]!; n++; } else (c as unknown[]).forEach(walk); }; walk(g.coordinates); return [x / Math.max(1, n), y / Math.max(1, n)]; };

export interface SuiteData { provinces: FC; regencies: FC; provinceCentres: FC; points: FC; blocks: FC; bytes: number; ms: number }
async function geojson(url: string): Promise<{ fc: FC; bytes: number }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const text = await r.text();
  return { fc: JSON.parse(text) as FC, bytes: text.length };
}
/** every feature gets an id (its code) and a value v (mock, seeded by the code) */
function withValues(fc: FC): FC {
  fc.features.forEach((f, i) => { const code = String(f.properties.code ?? f.id ?? i); f.id = code; f.properties.code = code; f.properties.v = Math.round((12 + 20 * hash(code)) * 10) / 10; });
  return fc;
}
export async function loadData(): Promise<SuiteData> {
  const t0 = performance.now();
  const [p, r] = await Promise.all([geojson(`${PACK}/java-provinces.geojson`), geojson(`${PACK}/java-regencies.geojson`)]);
  const provinces = withValues(p.fc), regencies = withValues(r.fc);
  const provinceCentres: FC = { type: 'FeatureCollection', features: provinces.features.map((f) => ({ type: 'Feature', id: f.id, properties: { name: f.properties.name, code: f.properties.code }, geometry: { type: 'Point', coordinates: centreOf(f.geometry) } })) };
  // 10 000 points over Java (mock), seeded
  const rp = rng(42), pts: FC['features'] = [];
  for (let i = 0; i < 10000; i++) pts.push({ type: 'Feature', id: i, properties: { v: Math.round(rp() * 100) }, geometry: { type: 'Point', coordinates: [105.3 + 9.2 * rp(), -8.6 + 2.6 * rp()] } });
  // 1500 blocks round Bandung's centre (mock), heights 2–40 levels
  const rb = rng(7), blocks: FC['features'] = [];
  for (let i = 0; i < 1500; i++) {
    const a = rb() * Math.PI * 2, d = Math.sqrt(rb()) * 0.03, cx = 107.61 + Math.cos(a) * d, cy = -6.915 + Math.sin(a) * d * 0.9, w = 0.00025 + rb() * 0.0004, h = 0.00025 + rb() * 0.0004;
    blocks.push({ type: 'Feature', id: i, properties: { h: Math.round((2 + 38 * rb() ** 2) * 3.5) }, geometry: { type: 'Polygon', coordinates: [[[cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h], [cx - w, cy - h]]] } });
  }
  return { provinces, regencies, provinceCentres, points: { type: 'FeatureCollection', features: pts }, blocks: { type: 'FeatureCollection', features: blocks }, bytes: p.bytes + r.bytes, ms: Math.round(performance.now() - t0) };
}
