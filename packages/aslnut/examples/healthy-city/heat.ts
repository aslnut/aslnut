// Heat on the real streets (a heat lab on the twin): round the camera, 360 m a side in 2 m cells, the street level's
// open data become the model's rasters (aslnut's cityRasters); the day's hourly weather from Open-Meteo; aslnut's heat
// model works out the sun's shadows, surfaces through the day, the street air and what a person walking feels (UTCI,
// apparent temperature, radiant temperature); drawn on the ground. A scenario (street trees, cool roads, watered
// strips) against the place as it is, the difference drawn; each factor's impact; a person's breakdown where tapped.
import { zonedTime, DEFAULT_HEAT_OPTIONS, HEAT_OPTION_INFO, HOT_HOUR, cityHeat, cityRasters, heatModel, openMeteo, sunAt, type CityRasters, type DayWeather, type Heat, type HeatChanges, type HeatField, type HeatOptions, type HeatPoint, type HeatSummary, type Streets, type World } from '../../src/index.ts';
import { log } from './page.ts';
import { MELBOURNE_TREES } from './trees.ts';

export type Metric = 'utci' | 'feels' | 'tmrt' | 'air' | 'surface';
export const METRICS: { id: Metric; label: string; unit: string; range: [number, number]; help: string }[] = [
  { id: 'utci', label: 'UTCI heat stress', unit: '°C', range: [26, 52], help: 'Universal Thermal Climate Index: air, radiation, wind and humidity for a person walking. 32+ moderate, 38+ strong, 46+ very strong heat stress.' },
  { id: 'feels', label: 'Feels like', unit: '°C', range: [26, 52], help: 'Apparent temperature with sun (Bureau of Meteorology / Steadman).' },
  { id: 'tmrt', label: 'Radiant temperature', unit: '°C', range: [20, 80], help: 'Mean radiant temperature: all the sunlight and heat radiation reaching a standing person.' },
  { id: 'air', label: 'Air temperature', unit: '°C', range: [30, 46], help: 'Shade air temperature in the street, warmer just above hot ground.' },
  { id: 'surface', label: 'Ground surface', unit: '°C', range: [20, 75], help: 'The temperature of the ground (road, footpath, grass).' },
];
const ZONE = 'Australia/Melbourne', PLACE = { lat: -37.91, lon: 145.13 };
export const HOTTEST = '2026-01-27';
const pause = () => new Promise<void>((ok) => setTimeout(ok, 0));
/** an instant from a Melbourne date and hour */
const melbourneAt = (date: string, hour: number): Date => zonedTime(`${date}T${String(Math.floor(hour)).padStart(2, '0')}:00`, ZONE);
type Summary = HeatSummary;

export class HeatView {
  enabled = false; metric: Metric = 'utci'; date = HOTTEST; hour = 15; day: DayWeather | null = null; source = '';
  options: HeatOptions = { ...DEFAULT_HEAT_OPTIONS }; changes: HeatChanges = {}; compare = false;
  base: Summary | null = null; variant: Summary | null = null; impacts: { label: string; d: number }[] | null = null; busy = '';
  /** the heat element on the map (aslnut's heat: a raster field drawn on the ground, probed, compared) */
  layer: Heat | null = null;
  private w: World; private street: Streets; private onChange: () => void;
  private runId = 0; private centre: [number, number] = [0, 0];
  private keepView: ((k: string) => boolean) | null = null;
  constructor(w: World, street: Streets, onChange: () => void) { this.w = w; this.street = street; this.onChange = onChange; }
  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    // the ground's own solids give way to the field; buildings and trees stay (their shadows are the point); off: the
    // street level's view as it was
    if (on) { this.keepView ??= this.street.showKind; this.street.setView((k) => k === 'building' || k === 'tree'); } else if (this.keepView) { this.street.setView(this.keepView); this.keepView = null; }
    if (on) { this.w.setTime(melbourneAt(this.date, this.hour), { rate: 0 }); await this.loadDay(); await this.run(); }
    else if (this.layer) { this.w.remove(this.layer.id); this.layer = null; }
    this.w.invalidate(); this.onChange();
  }
  async setDate(date: string): Promise<void> { this.date = date; this.day = null; await this.loadDay(); this.w.setTime(melbourneAt(date, this.hour), { rate: 0 }); await this.run(false); }
  async setHour(h: number): Promise<void> { this.hour = h; this.w.setTime(melbourneAt(this.date, h), { rate: 0 }); await this.run(false); }
  async setMetric(m: Metric): Promise<void> { this.metric = m; await this.run(false); }
  async setChanges(c: HeatChanges, compare: boolean): Promise<void> { this.changes = c; this.compare = compare; await this.run(false); }
  async setOption<K extends keyof HeatOptions>(k: K, v: HeatOptions[K]): Promise<void> { this.options = { ...this.options, [k]: v }; await this.run(false); }
  private async loadDay(): Promise<void> {
    if (this.day) return;
    try { this.day = await openMeteo.day({ ...PLACE, date: this.date, zone: ZONE, loader: this.w.loader }); this.source = this.day.source; }
    catch (e) { this.day = null; this.source = `weather service unreachable: the measured 27 Jan 2026 3 pm (${String((e as Error).message).slice(0, 60)})`; }
    log('heat-weather', { date: this.date, ok: !!this.day });
  }
  private input(key: string) {
    const date = this.date, hour = this.hour, weather = this.day?.hours.find((x) => x.hour === hour) ?? { ...HOT_HOUR, hour };
    return { hour, weather, day: this.day, key: `${date}|${key}`, sunAt: (h: number) => { const s = sunAt(melbourneAt(date, h), PLACE.lat, PLACE.lon); return { elevation: s.altitude, azimuth: s.azimuth }; } };
  }
  private tiles() { return this.street.tiles().map((x) => ({ tile: x.tile, ctx: x.ctx })); }
  /** the heat element round the camera (a new place, or the same one again), run; the scenario compared */
  async run(newPlace = true): Promise<void> {
    if (!this.enabled) return;
    const id = ++this.runId, t0 = performance.now();
    if (!this.street.tiles().length) { this.busy = 'fly to the street level (Clayton): the heat runs on what is loaded'; this.onChange(); return; }
    const c = this.w.camera;
    if (newPlace || !this.layer) {
      this.centre = [c.lon, c.lat];
      this.busy = 'reading the place…'; this.onChange(); await pause();
      if (this.layer) this.w.remove(this.layer.id);
      this.layer = cityHeat(this.tiles(), { id: 'heat-field', centre: this.centre, size: 360, cell: 2, trees: MELBOURNE_TREES, input: this.input(`${this.centre}`), options: this.options, metric: this.metric, when: () => this.enabled });
      this.w.add(this.layer);
    }
    const h = this.layer!, watch = setInterval(() => { if (h.busy) { this.busy = h.busy; this.onChange(); } }, 200);
    try {
      this.base = await h.run({ input: this.input(`${this.centre}`), options: this.options, metric: this.metric });
      if (id !== this.runId) return;
      this.variant = null;
      if (this.compare && (this.changes.streetTrees || this.changes.coolRoads || this.changes.wateredGrass)) {
        this.variant = await h.compare(cityRasters(this.tiles(), { centre: this.centre, size: 360, cell: 2, changes: this.changes, trees: MELBOURNE_TREES }));
        if (id !== this.runId) return;
      }
    } finally { clearInterval(watch); }
    this.busy = ''; this.onChange(); this.w.invalidate();
    log('heat', { ms: Math.round(performance.now() - t0), cells: h.w * h.h, streets: h.rasters.regions.length, compare: !!this.variant });
  }
  /** what a person feels where tapped, and as if in shade */
  probe(lon: number, lat: number): { p: HeatPoint; shade: HeatPoint | null } | null { return this.layer?.point([lon, lat]) ?? null; }
  /** each piece of physics and each change: on − off, the street mean UTCI at 1.1 m */
  async measureImpacts(): Promise<void> {
    const h = this.layer, f0 = h?.modelField; if (!h || !f0) return;
    const r = h.rasters, input = this.input(`${this.centre}`);
    const out: { label: string; d: number }[] = [], mean = async (f: HeatField, rr: CityRasters) => { let s = 0, n = 0; for (let j = 0; j < rr.h; j += 2) { for (let i = 0; i < rr.w; i += 2) { const k = j * rr.w + i; if (!rr.walk[k]) continue; const p = f.point((i + 0.5) * rr.cell, (j + 0.5) * rr.cell, 1.1); if (p) { s += p.utci; n++; } } if (j % 20 === 0) await pause(); } return n ? s / n : NaN; };
    const base = await mean(f0, r as CityRasters), model = heatModel(r);
    for (const o of HEAT_OPTION_INFO) {
      this.busy = `impact: ${o.label}…`; this.onChange();
      const flipped = { ...this.options, [o.key]: !this.options[o.key] }, m = await mean(await model.field({ ...input, key: `${input.key}|${o.key}` }, flipped, { yield: pause }), r as CityRasters);
      out.push({ label: o.label, d: this.options[o.key] ? base - m : m - base });
    }
    for (const [label, ch] of [['Street trees on the strips', { streetTrees: true }], ['Cool (light) road surfaces', { coolRoads: true }], ['Watered nature strips and lawns', { wateredGrass: true }]] as [string, HeatChanges][]) {
      this.busy = `impact: ${label}…`; this.onChange();
      const rr = cityRasters(this.tiles(), { centre: this.centre, size: 360, cell: 2, changes: ch, trees: MELBOURNE_TREES });
      out.push({ label, d: (await mean(await heatModel(rr).field({ ...input, key: `${input.key}|${label}` }, this.options, { yield: pause }), rr)) - base });
    }
    this.impacts = out; this.busy = ''; this.onChange();
  }
}

const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '–');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export function heatPanel(h: HeatView): string {
  const m = METRICS.find((x) => x.id === h.metric)!, b = h.base, v = h.variant;
  const row = (k: string, a: number | undefined, c?: number) => `<tr><td class="k">${k}</td><td class="v">${a === undefined ? '–' : f1(a)}</td>${v ? `<td class="v">${c === undefined ? '–' : f1(c)}</td><td class="v" style="color:${(c ?? 0) - (a ?? 0) > 0 ? '#fca5a5' : '#86efac'}">${c === undefined || a === undefined ? '' : `${c - a > 0 ? '+' : ''}${(c - a).toFixed(1)}`}</td>` : ''}</tr>`;
  return `<div class="t" data-fold="1">Heat on the street ▾${b ? ` · ${m.id === 'utci' ? 'UTCI' : m.label} ${f1(m.id === 'utci' ? b.utci : m.id === 'feels' ? b.feels : m.id === 'tmrt' ? b.tmrt : m.id === 'air' ? b.air : b.road)} °C` : ''}</div>
    <div class="qs">${[[HOTTEST, 'Hottest day (27 Jan)'], [new Date().toISOString().slice(0, 10), 'Today']].map(([d, l]) => `<button data-hd="${d}" class="${h.date === d ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="row" style="display:flex;gap:8px;align-items:center"><span class="k">${String(h.hour).padStart(2, '0')}:00</span><input id="h-hour" type="range" min="0" max="23" step="1" value="${h.hour}" style="flex:1"></div>
    <div class="qs">${METRICS.map((x) => `<button data-hm="${x.id}" class="${x.id === h.metric ? 'on' : ''}">${x.label}</button>`).join('')}</div>
    <div class="desc">${esc(m.help)}</div>
    <div class="qs"><button data-hc="streetTrees" class="${h.changes.streetTrees ? 'on' : ''}">+ street trees</button><button data-hc="coolRoads" class="${h.changes.coolRoads ? 'on' : ''}">cool roads</button><button data-hc="wateredGrass" class="${h.changes.wateredGrass ? 'on' : ''}">watered strips</button></div>
    ${h.busy ? `<div class="desc">${esc(h.busy)}</div>` : ''}
    ${b ? `<table><tr><td class="k">where people walk (1.1 m)</td><td class="v">${v ? 'now' : ''}</td>${v ? '<td class="v">with</td><td class="v">Δ</td>' : ''}</tr>${row('UTCI °C', b.utci, v?.utci)}${row('Feels like °C', b.feels, v?.feels)}${row('Radiant °C', b.tmrt, v?.tmrt)}${row('Air °C', b.air, v?.air)}${row('In shade %', b.shaded * 100, v ? v.shaded * 100 : undefined)}${row('Road surface °C', b.road, v?.road)}</table>
    <div style="height:8px;border-radius:4px;margin-top:6px;background:${v ? 'linear-gradient(90deg,#2166ac,#67a9cf,#d1e5f0,#f7f7f7,#fddbc7,#ef8a62,#b2182b)' : 'linear-gradient(90deg,#2c7bb6,#00a6ca,#90eb9d,#f9d057,#f29e2e,#e76818,#d7191c,#7a0177)'}"></div>
    <div class="row" style="display:flex;justify-content:space-between;font-size:11px;color:#9aa7b4"><span>${v ? '−6' : m.range[0]}</span><span>${v ? 'with − now, °C' : `${m.label}, ${m.unit}`}</span><span>${v ? '+6' : m.range[1]}</span></div>` : ''}
    <div class="qs" style="margin-top:6px"><button id="h-impact">Measure each factor's impact</button></div>
    ${h.impacts ? `<table>${h.impacts.map((x) => `<tr><td class="k">${esc(x.label)}</td><td class="v" style="color:${x.d > 0 ? '#fca5a5' : '#86efac'}">${x.d > 0 ? '+' : ''}${x.d.toFixed(2)} °C</td></tr>`).join('')}</table><div class="desc">UTCI where people walk, on − off; + hotter.</div>` : ''}
    <details><summary class="k">physics</summary>${HEAT_OPTION_INFO.map((o) => `<label style="display:block"><input type="checkbox" data-ho="${o.key}" ${h.options[o.key] ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}</details>
    <div class="desc">Weather: ${esc(h.source || 'Open-Meteo')}. Model: SOLWEIG-style radiant temperature, force–restore surfaces, a canyon air budget, UTCI (pythermalcomfort, MIT). 360 m round the centre, 2 m cells. Tap a place for a person's breakdown.</div>`;
}
export function probeCard(x: { p: HeatPoint; shade: HeatPoint | null }): string {
  const p = x.p, s = x.shade;
  const rows: [string, string][] = [['UTCI', `${f1(p.utci)} °C · ${p.stress}`], ['Feels like', `${f1(p.feels)} °C`], ['Radiant temperature', `${f1(p.tmrt)} °C`], ['Air', `${f1(p.air)} °C (station ${f1(p.airBackground)}, street ${p.streetAir >= 0 ? '+' : ''}${f1(p.streetAir)})`], ['Ground', `${f1(p.surface)} °C · ${p.material.label}${p.wet ? ', wet' : ''}`], ['Sun', p.sunVisible > 0.5 ? 'in the sun' : p.sunVisible > 0 ? 'under a crown' : 'in shade'], ['Sky view', `${Math.round(p.svf * 100)} %`], ['Wind (10 m, sheltered)', `${f1(p.ws10)} m/s`]];
  return `<h3>A person here, 1.1 m</h3><table>${rows.map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`).join('')}</table>${s ? `<div class="src">If shaded: UTCI ${f1(s.utci)} °C (${(s.utci - p.utci).toFixed(1)}), radiant ${f1(s.tmrt)} °C</div>` : ''}<div class="src">Sunlight in ${Math.round(p.Kdown)} W/m² · from the ground ${Math.round(p.Kup)} · sky heat ${Math.round(p.Lsky)} · ground heat ${Math.round(p.groundL)}</div>`;
}
