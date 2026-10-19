// The street level's panels: what was tapped (its fields and where its data comes from), time and weather (the sun,
// the moon, a time-lapse), and curated layer views.
import { localTime, phaseName, skyNow, sunTimes, type Picked, type Streets, type World } from '../../src/index.ts';
import { log } from './page.ts';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const KIND = { building: 'Building', road: 'Road', tree: 'Tree', park: 'Open space', water: 'Water', waterway: 'Waterway', pole: 'Power poles' } as Record<string, string>;

/** the card of what was tapped: its title, its fields, its source */
export function entityCard(w: World): void {
  const card = $('#card');
  const show = (f: Picked | null) => {
    if (!f) { card.style.display = 'none'; return; }
    const p = f.props as Record<string, unknown>, d = f.d as { kind?: string } | undefined;
    const kind = d?.kind ?? f.element, title = String(p.name ?? p.kind ?? KIND[kind] ?? kind);
    const rows = Object.entries(p).filter(([k, v]) => k !== 'name' && k !== 'source' && v !== '' && v !== null && v !== undefined && typeof v !== 'object');
    card.innerHTML = `<button class="x" title="close">✕</button><h3>${esc(title)}</h3><div class="k">${esc(KIND[kind] ?? kind)}</div>
      <table>${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(typeof v === 'number' ? +v.toFixed(2) : v)}</td></tr>`).join('')}</table>
      ${p.source ? `<div class="src">Source: ${esc(p.source)}</div>` : ''}`;
    card.style.display = 'block';
    (card.querySelector('.x') as HTMLElement).onclick = () => { card.style.display = 'none'; w.select([]); picked = false; };
  };
  // a building, a tree, a road tapped: its card, and it is selected (the solids draw it in their selected colour)
  const solid = (l: string) => l === 'streets' || l === 'roads' || l === 'osm-roads' || l === 'open-buildings';
  let picked = false;
  w.on('tap', (f) => { if (f && (solid(f.element) || f.element.endsWith('-stat'))) { show(solid(f.element) ? f : null); if (solid(f.element)) { w.select([String(f.id)]); picked = true; log('pick', { layer: f.element, kind: (f.d as { kind?: string })?.kind }); } } else if (!f) { show(null); if (picked) { w.select([]); picked = false; } } });
}

// ── time and weather ──────────────────────────────────────────────────────────────────────────────────────────────
const fmt = (h: number | null) => (h === null ? '–' : `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`);
/** the midnight of the day of instant t on the clocks where the camera is (the world's zone) */
function dayStart(w: World, t: number): number {
  const l = localTime(new Date(t), w.camera.lon, w.timeZone);
  return t - ((l.hour * 60 + l.minute) * 60 + new Date(t).getUTCSeconds()) * 1000;
}
export interface Weather { key: string; label: string }
export function envDialog(w: World, o: { weathers?: Weather[]; setWeather?: (k: string) => void; weatherNow?: () => string } = {}): () => void {
  const pane = $('#env-pane');
  const render = () => {
    const t = w.time.getTime(), loc = w.state.time.local, n = skyNow(t, 145.12, -37.92), st = sunTimes(dayStart(w, t), -37.92, 145.12);
    const rate = w.timeRate, live = w.timeRunning;
    pane.innerHTML = `<div class="row" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${String(loc.hour).padStart(2, '0')}:${String(loc.minute).padStart(2, '0')} · ${loc.day}/${loc.month}/${loc.year}</b><span class="desc">Melbourne time${live ? ' · live' : rate ? ` · ×${rate}` : ' · held'}</span></div>
      <div class="cfg">
        <label>time</label><input id="e-hour" type="range" min="0" max="23.99" step="0.05" value="${loc.hour + loc.minute / 60}">
        <label>month</label><input id="e-month" type="range" min="1" max="12" step="1" value="${loc.month}">
        <label>speed</label><div>${[['live', 'live'], [0, 'hold'], [60, '×60'], [600, '×600'], [3600, '×3600']].map(([k, l]) => `<button data-rate="${k}" class="${(k === 'live' && live) || (!live && k === rate) ? 'on' : ''}">${l}</button>`).join(' ')}</div>
        ${o.weathers ? `<label>weather</label><div>${o.weathers.map((x) => `<button data-w="${x.key}" class="${o.weatherNow?.() === x.key ? 'on' : ''}">${esc(x.label)}</button>`).join(' ')}</div>` : ''}
      </div>
      <div class="desc">Sun ${n.sun.altitude.toFixed(0)}° high, ${n.sun.azimuth.toFixed(0)}° · sunrise ${fmt(st.rise)} · sunset ${fmt(st.set)} · noon ${fmt(st.noon)} (${st.highest.toFixed(0)}°)<br>Moon ${n.moon.altitude.toFixed(0)}° high · ${phaseName(n.moon.elongation)} (${Math.round(n.moon.illumination * 100)} % lit)</div>`;
    const hour = $<HTMLInputElement>('#e-hour'), month = $<HTMLInputElement>('#e-month');
    const setTo = (h: number, m: number) => {
      // the same day of the chosen month, at the chosen hour (Melbourne time)
      const base = dayStart(w, w.time.getTime()), d = new Date(base); const shift = (m - loc.month) * 30.44 * 86400000;
      w.setTime(new Date(dayStart(w, base + shift + 43200000) + h * 3600000), { rate: w.timeRunning ? 0 : w.timeRate }); void d;
    };
    hour.oninput = () => setTo(Number(hour.value), Number(month.value));
    month.onchange = () => setTo(Number(hour.value), Number(month.value));
    pane.querySelectorAll<HTMLButtonElement>('[data-rate]').forEach((b) => { b.onclick = () => { const k = b.dataset.rate!; if (k === 'live') w.setTime('now'); else w.setTimeRate(Number(k)); log('time', { rate: k }); render(); }; });
    pane.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => { b.onclick = () => { o.setWeather?.(b.dataset.w!); render(); }; });
  };
  return render;
}

// ── curated layer views ──────────────────────────────────────────────────────────────────────────────────────────────
export interface View { key: string; label: string; show: (kind: string) => boolean }
export const VIEWS: View[] = [
  { key: 'all', label: 'Everything', show: () => true },
  { key: 'roads', label: 'Roads only', show: (k) => k === 'road' },
  { key: 'parks', label: 'Parks & open space', show: (k) => k === 'park' || k === 'tree' || k === 'water' || k === 'waterway' },
  { key: 'trees', label: 'Trees & canopy', show: (k) => k === 'tree' },
  { key: 'buildings', label: 'Buildings', show: (k) => k === 'building' },
];
export function layersDialog(w: World, street: Streets, onView: (v: View) => void, extra: string): void {
  const pane = $('#layers-pane');
  let now = 'all';
  const render = () => {
    pane.innerHTML = `<div class="qs">${VIEWS.map((v) => `<button data-v="${v.key}" class="${v.key === now ? 'on' : ''}">${esc(v.label)}</button>`).join('')}</div>
      <div class="desc">Curated views of the street level: each a set of what is drawn and how.</div>${extra}`;
    pane.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => { b.onclick = () => { now = b.dataset.v!; onView(VIEWS.find((v) => v.key === now)!); log('view', { v: now }); render(); }; });
  };
  render();
  void street;
}
