// core › simulation › fields › surface: values at every point of a 3D surface (walls and roofs, not only from above),
// drawn on the surface itself: the solids it is on draw it in their own draws (one more texture: a value per vertex
// through a ramp over their own colours), on WebGPU and WebGL2 alike. aslnut shows the values; your model makes them:
// a value per vertex, or your function of the thing, its facet, its normal and its place, asked once when a mesh is
// made (never per frame). Epochs of values play through time (core › data › history › epochs): stepped, or the two
// around the time mixed on the chip.
//   w.add(field({ kind: 'surface', on: 'buildings', values: (b, facet, n) => facet === 'roof' ? 6.1 : 3 + 2 * n[1],
//     draw: { ramp: 'inferno', domain: [0, 7] } }))                    a value by facet orientation (north walls warmer)
//   surf.set((b) => sensors.get(b.id) ?? NaN)  ·  surf.at([lon, lat, 12])  ·  surf.probe({ of: 'b-12' }).value
import { AslnutError } from '../../world/errors.ts';
import { Element, type AttachContext, type ElementProps, type FrameContext } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import type { DrawCall } from '../../render/graphics/interface.ts';
import { Solids, type SolidInfo, type SurfaceChannel, type SurfaceChunk, type SurfaceLook, type SurfaceValues } from '../../geometry/shapes/solids.ts';
import { MESH_FLOATS, unpackNormal } from '../../geometry/shapes/mesh.ts';
import { Epochs } from '../../data/epochs.ts';
import { rgbOf } from '../../geometry/shapes/mesh.ts';
import { ramp as rampOf } from '../../render/style/ramp.ts';
import type { Legend } from '../../encoding/scales.ts';
import { fieldLegend, type FieldDraw, type Probe } from './raster.ts';

const D = Math.PI / 180, KZ = 110574;
/** a face of a thing: 'roof' (it looks up), 'wall' (sideways or down), or with `walls: 'numbered'` its wall's number */
export type SurfaceFacet = 'roof' | 'wall' | number;
/** your value for a place on a thing: the thing (its id and props, as picking gives it), its facet, the face's normal
 *  ([east, north, up]) and the place ([lon, lat, metres above its ground]); NaN: none (its own colour there) */
export type SurfaceFn = (thing: SolidInfo, facet: SurfaceFacet, normal: [number, number, number], at: [number, number, number]) => number;
/** a value per vertex (one mesh: in its own order), per vertex by chunk ({ '3_4': values }), or your function */
export type SurfaceInput = Float32Array | Record<string, Float32Array> | SurfaceFn;
export interface SurfaceDraw extends Pick<FieldDraw, 'ramp' | 'domain' | 'min'> {
  /** how much the ramp's colour covers the solids' own (default 1) */
  opacity?: number;
}
export interface SurfaceFieldProps extends ElementProps {
  kind: 'surface';
  /** the solids it is on: a layer (buildings, solids, entities: the shapes they place) or its id */
  on: string | Solids;
  /** its values (or `data`) */
  values?: SurfaceInput;
  /** its values through time: data.epochs([{ at, source: values }], { blend }) */
  data?: Epochs<SurfaceInput>;
  draw?: SurfaceDraw;
  /** 'numbered': each wall's facet is its number (0, 1, …: its thing's walls by direction, in the order built: what a
   *  model of walls by number reads); default 'wall' for all of them */
  walls?: 'numbered';
}
/** a facet of a chunk's things: its thing, its facet, its middle (m of the chunk, height), its value and the next */
interface Facet { id: number; thing: string | number; facet: SurfaceFacet; x: number; h: number; z: number; a: number; b: number }
interface ProbeState { at?: [number, number, number?]; over?: [number, number][]; of?: string | number; series: [number, number][]; value: number; every: number | 'step'; last: number; on: boolean }

export class SurfaceField extends Element<SurfaceFieldProps> implements SurfaceChannel {
  readonly kind = 'custom' as const;
  /** moved when its values change (the solids ask each chunk again: only those that differ are written) */
  version = 0;
  /** seconds of the world's clock since its first values (or its first epoch) */
  time = 0;
  private solids: Solids | null;
  private input: SurfaceInput | null;
  private epochs: Epochs<SurfaceInput> | null;
  /** the epochs its values are of now (−1: none yet) and the next one's share */
  private pair: [number, number] = [-1, -1]; private share = 0;
  /** each chunk's values as last asked, by chunk, which and epoch (only the two shown are kept) */
  private cache = new Map<string, Float32Array>();
  /** each chunk's facets (their middles and values: at, probes) and its corner */
  private facets = new Map<string, { corner: [number, number]; kx: number; list: Facet[]; v: number; near: boolean }>(); private facetsV = 0; private measuredV = -1; private measuredF = -1;
  private probes = new Set<ProbeState>();
  private lookV = 0; private lookKey = ''; private rampLut = new Float32Array(256);
  private lastS: State | null = null; private t0 = NaN;
  /** the epochs whose values were checked */
  private checked = new Set<number>();
  private offArrive: (() => void) | null = null;
  constructor(p: SurfaceFieldProps) {
    super(p);
    if (p.on instanceof Solids) this.solids = p.on;
    else if (typeof p.on === 'string' && p.on) this.solids = null;
    else throw new AslnutError('E-DATA-001', `surface field '${this.id}': on must be a solids layer (buildings, solids, entities) or its id`, { where: this.id, fix: "field({ kind: 'surface', on: 'buildings', values })" });
    if (p.data !== undefined && !(p.data instanceof Epochs)) throw new AslnutError('E-DATA-001', `surface field '${this.id}': data must be epochs of values`, { where: this.id, fix: 'data: data.epochs([{ at, source: values }, …], { blend: \'morph\' })' });
    if (p.values === undefined && !p.data) throw new AslnutError('E-DATA-001', `surface field '${this.id}' needs values (or data: epochs of them)`, { where: this.id, fix: "values: (thing, facet, normal) => facet === 'roof' ? 1 : 0" });
    this.epochs = p.data ?? null;
    this.input = p.values ?? null;
    if (this.input) this.check(this.input);
    this.lut();
  }
  /** the solids it is on (null: not found yet) */
  get on(): Solids | null { return this.solids; }
  /** new values: only the chunks whose values changed are written again */
  set(values: SurfaceInput): this {
    this.check(values);
    this.input = values; this.epochs = null; this.offArrive?.(); this.offArrive = null; this.cache.clear(); this.pair = [-1, -1];
    this.version++; this.invalidate();
    return this;
  }
  /** each chunk's vertices (its whole mesh, in its own order; null: made when it comes near) */
  vertices(): Record<string, number | null> { return this.solids?.meshVertices() ?? {}; }
  /** a value at a place: the facet nearest it ([lon, lat]: the nearest in plan, the higher of two as near; [lon, lat, h]:
   *  in space, h metres above the ground); NaN: no values there */
  at(p: [number, number] | [number, number, number]): number { const f = this.nearest(p); return f ? this.facetValue(f) : NaN; }
  /** watch the value at a place, the mean over an area (a ring), or a thing's mean (its id), as the values change */
  probe(o: { at?: [number, number] | [number, number, number]; over?: [number, number][]; of?: string | number; every?: 'step' | number }): Probe {
    if (!o.at && !o.over && o.of === undefined) throw new AslnutError('E-DATA-001', `surface field '${this.id}': a probe needs at, over or of`, { where: this.id, fix: "surf.probe({ of: 'b-12' }) · surf.probe({ at: [lon, lat, h] })" });
    const st: ProbeState = { at: o.at, over: o.over, of: o.of, series: [], value: NaN, every: o.every ?? 'step', last: -Infinity, on: true };
    this.probes.add(st); this.measure(st, true);
    const self = this;
    return { get value() { return st.value; }, get series() { return st.series; }, stop() { st.on = false; self.probes.delete(st); } };
  }
  /** its legend: its ramp over its domain (the raster field's own) */
  legend(): Legend { return fieldLegend(this.props.draw ?? {}); }

  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    if (!this.solids) {
      const id = this.props.on as string, found = ctx.world.elementsOfKind('shape').find((e) => e.id === id);
      if (!(found instanceof Solids)) {
        const ids = ctx.world.elementsOfKind('shape').map((e) => e.id);
        throw new AslnutError('E-WORLD-002', `surface field '${this.id}': no solids layer '${id}' in the world`, { where: this.id, fix: `on: one of ${ids.length ? ids.map((x) => `'${x}'`).join(', ') : '(none: add the buildings or solids first, or in the same w.add)'}` });
      }
      this.solids = found;
      if (this.input) this.check(this.input);
    }
    if (this.solids.surfaceOn && this.solids.surfaceOn !== this) throw new AslnutError('E-DATA-001', `surface field '${this.id}': '${this.solids.id}' shows '${this.solids.surfaceOn.id}' already`, { where: this.id, fix: 'one surface field a solids layer: remove the other first' });
    if (this.epochs) this.offArrive = this.epochs.onArrive(() => this.invalidate());
    this.solids.surface(this);
  }
  override detach(): void {
    if (this.solids?.surfaceOn === this) this.solids.surface(null);
    if (typeof this.props.on === 'string') this.solids = null;
    this.offArrive?.(); this.offArrive = null;
    super.detach();
  }
  frame(ctx: FrameContext): DrawCall[] { this.follow(ctx.s); this.touchProbes(); return []; }
  override readouts(): Record<string, () => unknown> { return { version: () => this.version, epochs: () => this.epochs?.epochStats() ?? null }; }
  /** what its epochs hold and cost (telemetry) */
  epochStats() { return this.epochs ? [{ ...this.epochs.epochStats(), of: this.id }] : []; }
  override status() {
    const st = super.status();
    if (this.epochs) { const p = this.epochs.now; if (this.epochs.value(p.i) === undefined || (this.epochs.blend === 'morph' && this.epochs.value(p.j) === undefined)) st.pending.push(`surface field '${this.id}': epoch ${p.i} loading`); }
    return st;
  }

  // ── what the solids ask (SurfaceChannel) ──────────────────────────────────────────────────────────────────────
  look(s: State): SurfaceLook {
    this.follow(s);
    const d = this.props.draw ?? {}, [lo, hi] = d.domain ?? [0, 1];
    const key = JSON.stringify([d.ramp ?? 'viridis', lo, hi]); if (key !== this.lookKey) { this.lookKey = key; this.lut(); this.lookV++; }
    return { version: this.lookV, ramp: this.rampLut, lo, hi, min: d.min ?? -1e30, mix: Math.max(0, Math.min(1, (d.opacity ?? 1) * this.shown)), f: this.share, subject: true };
  }
  values(c: SurfaceChunk, which: 'near' | 'far' | 'clones'): SurfaceValues | null {
    const [i, j] = this.pair, two = j >= 0 && j !== i;
    const a = this.valuesOf(c, which, i); if (!a) return null;
    const b = two ? this.valuesOf(c, which, j) : null;
    const had = this.facets.get(c.key);
    if (which !== 'clones' && c.mesh && (!had || had.v !== this.version || (which === 'near' && !had.near))) this.facetsOf(c, c.mesh, a, b, which === 'near');
    return { a, b };
  }

  // ── its values ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** the epochs for the state's time: another pair, its values asked again (once each epoch is held) */
  private follow(s: State): void {
    if (s === this.lastS) return;
    this.lastS = s;
    const ep = this.epochs;
    if (!ep) { if (Number.isNaN(this.t0)) this.t0 = s.time.now.getTime(); this.time = (s.time.now.getTime() - this.t0) / 1000; if (this.pair[0] !== 0) { this.pair = [0, 0]; this.version++; } return; }
    ep.update(s);
    const { a, b, f, i, j } = ep.shown();
    this.time = (ep.timeOf(s) - ep.times[0]!) / (ep.by === 'time' ? 1000 : 1);
    // (an epoch not held yet: the values shown stay until it is)
    if (a === undefined) return;
    const jj = b === undefined || i === j ? i : j;
    if (i !== this.pair[0] || jj !== this.pair[1]) {
      this.pair = [i, jj]; this.version++;
      for (const k of [...this.cache.keys()]) { const e = Number(k.slice(k.lastIndexOf('|') + 1)); if (e !== i && e !== jj) this.cache.delete(k); }
    }
    this.share = jj !== i ? f : 0;
  }
  /** a chunk's values of an epoch (−1: its values): asked once, kept while that epoch is shown */
  private valuesOf(c: SurfaceChunk, which: 'near' | 'far' | 'clones', e: number): Float32Array | null {
    const key = `${c.key}|${which}|${e}`, hit = this.cache.get(key); if (hit) return hit;
    const input = this.epochs ? (this.epochs.value(e) as SurfaceInput | undefined) : this.input;
    if (input === undefined || input === null) return null;
    if (this.epochs && !this.checked.has(e)) { this.check(input, `epoch ${e}: `); this.checked.add(e); }
    let out: Float32Array | null = null;
    if (typeof input === 'function') {
      if (which === 'clones') out = this.clonesOf(input, c);
      else if (c.mesh) out = this.byFacet(input, c, c.mesh);
    } else {
      const given = input instanceof Float32Array ? this.onlyChunk(c.key, input) : input[c.key] ?? null;
      if (given && which === 'near') out = given;
      else if (given && which === 'far' && c.mesh) { const near = c.near(); out = near ? this.meanByThing(near, given, c.mesh) : null; }
    }
    if (out) this.cache.set(key, out);
    return out;
  }
  /** one array of values: the target's one chunk's */
  private onlyChunk(key: string, a: Float32Array): Float32Array | null {
    const keys = Object.keys(this.solids?.meshVertices() ?? {});
    return keys.length === 1 && keys[0] === key ? a : null;
  }
  /** your function at every vertex of a mesh (once, when it is made) */
  private byFacet(fn: SurfaceFn, c: SurfaceChunk, m: Float32Array): Float32Array {
    const n = Math.floor(m.length / MESH_FLOATS), out = new Float32Array(n), sp = c.spec, kx = 111320 * Math.cos(sp.origin[1] * D);
    const lon0 = sp.origin[0] + sp.at[0] / kx, lat0 = sp.origin[1] - sp.at[1] / KZ, infos = new Map<number, SolidInfo | null>(), walls = this.props.walls === 'numbered' ? new Map<number, number[]>() : null;
    for (let v = 0; v < n; v++) {
      const b = v * MESH_FLOATS, idf = m[b + 7]!, id = idf - Math.floor(idf / 65536) * 65536;
      let info = infos.get(id); if (info === undefined) { info = sp.info?.(id) ?? null; infos.set(id, info); }
      if (!info) { out[v] = NaN; continue; }
      const [nx, ny, nz] = unpackNormal(m[b + 6]!);
      const facet = facetOf(nx, ny, nz, id, walls);
      out[v] = fn(info, facet, [nx, -nz, ny], [lon0 + m[b]! / kx, lat0 - m[b + 2]! / KZ, m[b + 1]!]);
    }
    return out;
  }
  /** a clone's one value: your function at its place, from above */
  private clonesOf(fn: SurfaceFn, c: SurfaceChunk): Float32Array | null {
    if (!c.clones?.length) return null;
    const sp = c.spec, kx = 111320 * Math.cos(sp.origin[1] * D), lon0 = sp.origin[0] + sp.at[0] / kx, lat0 = sp.origin[1] - sp.at[1] / KZ;
    let top = 0; for (const x of c.clones) top = Math.max(top, x.id + 1);
    const out = new Float32Array(top).fill(NaN);
    for (const x of c.clones) { const info = sp.info?.(x.id); if (info) out[x.id] = fn(info, 'roof', [0, 0, 1], [lon0 + x.x / kx, lat0 - x.z / KZ, x.h]); }
    return out;
  }
  /** the far mesh's values from the whole one's: each thing's mean */
  private meanByThing(near: Float32Array, vals: Float32Array, far: Float32Array): Float32Array {
    const sum = new Map<number, [number, number]>(), idOf = (m: Float32Array, v: number) => { const x = m[v * MESH_FLOATS + 7]!; return x - Math.floor(x / 65536) * 65536; };
    for (let v = 0; v < vals.length; v++) { const x = vals[v]!; if (!Number.isFinite(x)) continue; const id = idOf(near, v), s = sum.get(id); if (s) { s[0] += x; s[1]++; } else sum.set(id, [x, 1]); }
    const n = Math.floor(far.length / MESH_FLOATS), out = new Float32Array(n);
    for (let v = 0; v < n; v++) { const s = sum.get(idOf(far, v)); out[v] = s ? s[0] / s[1] : NaN; }
    return out;
  }
  /** a chunk's facets: each thing's roof and walls, their middles and mean values */
  private facetsOf(c: SurfaceChunk, m: Float32Array, a: Float32Array, b: Float32Array | null, near: boolean): void {
    const n = Math.min(a.length, Math.floor(m.length / MESH_FLOATS)), by = new Map<string, Facet & { n: number; nb: number }>(), walls = new Map<number, number[]>(), sp = c.spec;
    for (let v = 0; v < n; v++) {
      const x = a[v]!; if (!Number.isFinite(x)) continue;
      const o = v * MESH_FLOATS, idf = m[o + 7]!, id = idf - Math.floor(idf / 65536) * 65536, [nx, ny, nz] = unpackNormal(m[o + 6]!);
      const facet = facetOf(nx, ny, nz, id, walls), k = `${id}|${facet}`, y = b ? b[v]! : x;
      let f = by.get(k); if (!f) by.set(k, (f = { id, thing: sp.info?.(id)?.id ?? id, facet: ny > 0.5 ? 'roof' : this.props.walls === 'numbered' ? facet : 'wall', x: 0, h: 0, z: 0, a: 0, b: 0, n: 0, nb: 0 }));
      f.x += m[o]!; f.h += m[o + 1]!; f.z += m[o + 2]!; f.a += x; f.n++; if (Number.isFinite(y)) { f.b += y; f.nb++; }
    }
    const kx = 111320 * Math.cos(sp.origin[1] * D), list: Facet[] = [];
    for (const f of by.values()) list.push({ id: f.id, thing: f.thing, facet: f.facet, x: f.x / f.n, h: f.h / f.n, z: f.z / f.n, a: f.a / f.n, b: f.nb ? f.b / f.nb : f.a / f.n });
    this.facets.set(c.key, { corner: [sp.origin[0] + sp.at[0] / kx, sp.origin[1] - sp.at[1] / KZ], kx, list, v: this.version, near });
    this.facetsV++;
  }
  private facetValue(f: Facet): number { return f.a + (f.b - f.a) * this.share; }
  /** the facet nearest a place */
  private nearest(p: [number, number] | [number, number, number]): Facet | null {
    let best: Facet | null = null, bd = Infinity;
    for (const ch of this.facets.values()) {
      const x = (p[0] - ch.corner[0]) * ch.kx, z = (ch.corner[1] - p[1]) * KZ;
      for (const f of ch.list) {
        const d = p.length > 2 ? Math.hypot(f.x - x, f.h - (p[2] ?? 0), f.z - z) : Math.hypot(f.x - x, f.z - z) - f.h * 1e-3;
        if (d < bd) { bd = d; best = f; }
      }
    }
    return best;
  }
  private measure(st: ProbeState, force: boolean): void {
    if (!st.on) return;
    let v = NaN;
    if (st.at) v = this.at(st.at as [number, number]);
    else {
      let s = 0, n = 0;
      for (const ch of this.facets.values()) for (const f of ch.list) {
        if (st.of !== undefined && String(f.thing) !== String(st.of)) continue;
        if (st.over) { const lon = ch.corner[0] + f.x / ch.kx, lat = ch.corner[1] - f.z / KZ; if (!inRing(lon, lat, st.over)) continue; }
        s += this.facetValue(f); n++;
      }
      v = n ? s / n : NaN;
    }
    st.value = v;
    if (force || st.every === 'step' || this.time - st.last >= st.every) { st.series.push([this.time, v]); st.last = this.time; if (st.series.length > 10000) st.series.splice(0, st.series.length - 10000); }
  }
  private touchProbes(): void {
    if (this.facetsV === this.measuredV && this.share === this.measuredF) return;
    this.measuredV = this.facetsV; this.measuredF = this.share;
    for (const p of this.probes) this.measure(p, false);
  }
  /** values given as arrays: one a vertex of each chunk known (a wrong length is said at once) */
  private check(v: SurfaceInput, what = ''): void {
    if (typeof v === 'function') return;
    const counts = this.solids?.meshVertices();
    if (v instanceof Float32Array) {
      if (!counts) return;
      const keys = Object.keys(counts);
      if (keys.length !== 1) throw new AslnutError('E-DATA-001', `surface field '${this.id}': one array of values for ${keys.length} chunks of '${this.solids!.id}'`, { where: this.id, fix: `values by chunk: { ${keys.slice(0, 3).map((k) => `'${k}': values`).join(', ')} } (field.vertices() gives each one's count), or a function of the thing and its facet` });
      const n = counts[keys[0]!]; if (n !== null && n !== undefined && n !== v.length) throw lengthError(this.id, keys[0]!, n, v.length);
      return;
    }
    if (!v || typeof v !== 'object') throw new AslnutError('E-DATA-001', `surface field '${this.id}': ${what}values are a Float32Array, { chunk: Float32Array } or a function (got ${typeof v})`, { where: this.id, fix: "values: (thing, facet) => facet === 'roof' ? 1 : 0" });
    for (const [k, a] of Object.entries(v)) {
      if (!(a instanceof Float32Array)) throw new AslnutError('E-DATA-001', `surface field '${this.id}': chunk '${k}': values are a Float32Array`, { where: this.id, fix: `{ '${k}': new Float32Array(field.vertices()['${k}']) }` });
      if (!counts) continue;
      if (!(k in counts)) throw new AslnutError('E-DATA-001', `surface field '${this.id}': '${this.solids!.id}' has no chunk '${k}'`, { where: this.id, fix: `its chunks: ${Object.keys(counts).slice(0, 8).join(', ')}` });
      const n = counts[k]; if (n !== null && n !== undefined && n !== a.length) throw lengthError(this.id, k, n, a.length);
    }
  }
  private lut(): void {
    const f = rampOf(this.props.draw?.ramp ?? 'viridis');
    for (let i = 0; i < 256; i++) this.rampLut[i] = rgbOf(f(i / 255));
  }
  private invalidate(): void { (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); }
}
const lengthError = (id: string, key: string, n: number, got: number) => new AslnutError('E-DATA-001', `surface field '${id}': chunk '${key}' has ${n} vertices, the values ${got}`, { where: id, fix: "one value a vertex, in the mesh's own order (field.vertices() gives each chunk's count), or a function of the thing and its facet" });
/** a vertex's facet: up (a roof), else a wall (numbered by direction per thing when asked: `walls` holds each thing's
 *  wall directions as found) */
function facetOf(nx: number, ny: number, nz: number, id: number, walls: Map<number, number[]> | null): SurfaceFacet {
  if (ny > 0.5) return 'roof';
  if (!walls) return 'wall';
  const l = Math.hypot(nx, nz); if (l < 1e-6) return 'wall';
  const ux = nx / l, uz = nz / l; let list = walls.get(id); if (!list) walls.set(id, (list = []));
  for (let k = 0; k < list.length; k += 2) if (list[k]! * ux + list[k + 1]! * uz > 0.985) return k / 2;
  list.push(ux, uz); return list.length / 2 - 1;
}
function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xa, ya] = ring[a]!, [xb, yb] = ring[b]!; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside; }
  return inside;
}
