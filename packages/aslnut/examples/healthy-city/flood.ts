// Storm water: where the rain goes on the street level. A field of water depth over the ground round the camera
// (aslnut's fields: shallow water, the pipe model), the ground from the terrain with the buildings standing up out of
// it (water runs round them), rain from the sky's weather; stepped on the chip where it can (WebGPU and WebGL2), on
// the CPU otherwise; drawn in blues on the ground; probes at the lowest place and over the whole area.
import { cityRasters, field, rules, type Probe, type RasterField, type Streets, type World } from '../../src/index.ts';
import { log } from './page.ts';

type LonLat = [number, number];
export interface FloodStats { time: number; rainMmH: number; low: number; mean: number; wetShare: number; runsOn: string; cells: number }
/** heavy rain in mm/h for the sky's rain level 1 (a storm: a 1-in-10-year burst for Melbourne's 10 minutes) */
const STORM_MM_H = 60;

export class FloodView {
  enabled = false; stats: FloodStats | null = null;
  /** the lowest open place round where it started (water gathers there) */
  lowAt: LonLat | null = null;
  private w: World; private street: Streets; private onChange: () => void;
  private f: RasterField | null = null; private low: Probe | null = null; private all: Probe | null = null; private timer = 0;
  constructor(w: World, street: Streets, onChange: () => void) { this.w = w; this.street = street; this.onChange = onChange; }
  /** the rain now (mm/h): the sky's, or a storm's when the sky is dry */
  rainMmH(): number { const r = (this.w.light?.rain ?? 0) as number; return (r > 0.05 ? r : 1) * STORM_MM_H; }
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) { this.stop(); this.onChange(); return; }
    const c = this.w.camera, centre: LonLat = [c.lon, c.lat], size = 600;
    // the buildings as walls on the ground (2 m cells), the terrain under everything
    const r = cityRasters(this.street.tiles().map((x) => ({ tile: x.tile, ctx: x.ctx })), { centre, size, cell: 2 });
    const building = (lon: number, lat: number) => { const [x, z] = r.xzOf(lon, lat), i = Math.floor(x / r.cell), j = Math.floor(z / r.cell); return i < 0 || j < 0 || i >= r.w || j >= r.h ? 0 : r.bH[j * r.w + i]!; };
    const ground = (lon: number, lat: number) => { const g = this.w.heightAt(lon, lat); return (Number.isFinite(g) ? g : 0) + building(lon, lat); };
    const rain = this.rainMmH() / 1000 / 3600;
    this.f = field({ id: 'storm-water', res: 3, area: { centre, size }, rule: rules.shallowWater({ friction: 0.2, rain, openEdges: true }), inputs: { ground }, init: 0, rate: 30, draw: { on: 'surface', ramp: ['#9ec5e8', '#3d7fc0', '#163a6b'], domain: [0, 0.3], min: 0.004, opacity: 0.82 } });
    this.w.add(this.f);
    // the lowest open place round the centre (water gathers there), and the whole area
    let lowAt: LonLat = centre, lowG = Infinity;
    for (let j = 0; j < this.f.h; j += 2) for (let i = 0; i < this.f.w; i += 2) { const p = this.f.lonLatOf(i, j); if (building(p[0], p[1]) > 0) continue; const g = ground(p[0], p[1]); if (g < lowG) { lowG = g; lowAt = p; } }
    this.lowAt = lowAt;
    this.low = this.f.probe({ at: lowAt, every: 10 });
    const b = this.f.box;
    this.all = this.f.probe({ over: [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], every: 10 });
    log('flood', { cells: this.f.w * this.f.h, runsOn: this.f.runsOn, rainMmH: this.rainMmH() });
    this.timer = window.setInterval(() => this.tick(), 500);
    this.tick();
  }
  private tick(): void {
    const f = this.f; if (!f) return;
    // the rain follows the sky's weather
    f.setParams({ rain: this.rainMmH() / 1000 / 3600 });
    const v = f.values(); let wet = 0; for (let k = 0; k < v.length; k++) if (v[k]! > 0.01) wet++;
    this.stats = { time: f.time, rainMmH: this.rainMmH(), low: this.low?.value ?? NaN, mean: this.all?.value ?? NaN, wetShare: wet / v.length, runsOn: f.runsOn, cells: f.w * f.h };
    this.onChange();
  }
  /** a scenario beside the rain now: a cloudburst four times as heavy, on the right of a handle you drag (aslnut's
   *  scenarios: the same field under another rule, side by side on one canvas) */
  comparing = false;
  setCompare(on: boolean): void {
    const f = this.f; if (!f) return;
    this.comparing = on;
    if (on) {
      this.w.scenario('cloudburst', { label: 'a cloudburst (×4)', rules: { [f.id]: { rule: rules.shallowWater({ friction: 0.2, rain: (this.rainMmH() * 4) / 1000 / 3600, openEdges: true }) } } });
      this.w.scenario.compare('base', 'cloudburst', { view: 'swipe' });
    } else this.w.scenario.compare(null);
    this.onChange();
  }
  /** the field (for checks) */
  get water(): RasterField | null { return this.f; }
  private stop(): void { if (this.comparing) this.setCompare(false); if (this.f) { this.w.remove(this.f.id); this.f = null; } this.low?.stop(); this.all?.stop(); this.low = this.all = null; clearInterval(this.timer); this.stats = null; }
}

const f1 = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '–');
export function floodPanel(x: FloodView): string {
  const s = x.stats;
  if (!s) return '<div class="t" data-fold="1">Storm water</div><div class="k">Starting…</div>';
  const mm = Math.floor(s.time / 60);
  return `<div class="t" data-fold="1">Storm water · ${mm} min of rain</div>
  <table><tr><td class="k">Rain</td><td class="v">${f1(s.rainMmH, 0)} mm/h</td></tr>
  <tr><td class="k">Depth at the lowest place</td><td class="v">${f1(s.low * 100)} cm</td></tr>
  <tr><td class="k">Mean depth over the area</td><td class="v">${f1(s.mean * 1000)} mm</td></tr>
  <tr><td class="k">Ground under water (&gt; 1 cm)</td><td class="v">${f1(s.wetShare * 100)} %</td></tr>
  <tr><td class="k">Cells (3 m)</td><td class="v">${s.cells.toLocaleString('en-AU')} · ${s.runsOn === 'gpu' ? 'on the graphics chip' : 'on the CPU'}</td></tr></table>
  <div class="qs" style="margin-top:6px"><button data-fc="1" class="${x.comparing ? 'on' : ''}">${x.comparing ? 'stop comparing' : 'compare: a cloudburst ×4 (swipe)'}</button></div>
  <div class="k" style="margin-top:4px">Shallow water over the terrain with the buildings standing in it; rain from the sky's weather (a storm's ${STORM_MM_H} mm/h when it is dry).</div>`;
}
