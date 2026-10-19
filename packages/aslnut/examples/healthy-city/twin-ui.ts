// The twin dashboard's look (?ui=twin, ?go=twin): the same example in the interface of a twin dashboard: one thin bar
// on top (home, where you are, the sky's chip with the time, season and weather, park access, statistics, layers,
// settings), big focused dialogs over a dimmed world, a legend card, the card of what was tapped on the right, the
// analysis panels in dark slate, the mode bar with icons and a camera pad. On a phone the dialogs and the tapped card
// come up from the bottom as sheets. Plain DOM; the look is twin.css (all of it under body.twin), put on the page only
// when the twin interface is asked for.
import { phaseName, skyNow, sunTimes, zonedTime, type World } from '../../src/index.ts';
import { log } from './page.ts';
// (the look comes in with the twin interface only: nothing of it on the page otherwise)
import TWIN_CSS from './twin.css?inline';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const svg = (d: string, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
/** the dashboard's icons (inline: no icon library, no emoji font needed) */
export const ICONS = {
  home: svg('<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  stats: svg('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>'),
  layers: svg('<path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="m2 13 10 5 10-5"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>'),
  tree: svg('<path d="M12 22v-6"/><path d="M12 16c-4 0-7-2.5-7-6 0-2.5 1.6-4.4 3.6-5.3C9.3 3.1 10.6 2 12 2s2.7 1.1 3.4 2.7C17.4 5.6 19 7.5 19 10c0 3.5-3 6-7 6Z"/>', 18),
  map: svg('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>', 16),
  walk: svg('<circle cx="13" cy="4" r="2"/><path d="m9 22 3-7 3 3v4"/><path d="m6 12 3-5 4 1 3 4"/><path d="m12 15-1-6"/>', 16),
  car: svg('<path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><path d="M3 12h18"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>', 16),
  turnL: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', 16),
  turnR: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', 16),
  up: svg('<path d="m6 15 6-6 6 6"/>', 16), down: svg('<path d="m6 9 6 6 6-6"/>', 16),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 16), minus: svg('<path d="M5 12h14"/>', 16),
  drone: svg('<circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="m7 7 3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/><rect x="10" y="10" width="4" height="4" rx="1"/>', 16),
};

/** the season on the clocks of a southern city (by month) */
export const seasonOf = (month: number) => (month === 12 || month <= 2 ? 'Summer' : month <= 5 ? 'Autumn' : month <= 8 ? 'Winter' : 'Spring');

/** put the twin look on the page: the body's class and the pieces only it has (before the world: the loading line) */
export function installTwin(o: { place: string }): void {
  const style = document.createElement('style'); style.textContent = TWIN_CSS; document.head.appendChild(style);
  document.body.classList.add('twin');
  const top = $('#top');
  // home, then the trail; after the sky's chip: a divider, park access, statistics, layers, settings
  $('#b-panel').insertAdjacentHTML('afterend', `<button class="icon" id="b-home" title="${esc(o.place)}">${ICONS.home}</button>`);
  $('#d-env header span').textContent = 'Time, date and weather';
  $('#env').innerHTML = `<span id="env-i">${ICONS.sun}</span><span id="env-t">--:--</span><span class="long" id="env-w"></span>`;
  $('#env').insertAdjacentHTML('afterend', `<div class="t-sep"></div><button id="b-access" title="Park access: distance from every house to its nearest park">${ICONS.tree}<span class="lbl">Park access</span></button>`);
  $('#b-stats').innerHTML = ICONS.stats; $('#b-layers').innerHTML = ICONS.layers;
  top.insertAdjacentHTML('beforeend', `<button class="icon" id="b-settings" title="Settings">${ICONS.settings}</button>`);
  // the legend's subtitle (unit · per area) and its sources
  $('#legend-title').insertAdjacentHTML('afterend', '<div id="legend-sub"></div>');
  $('#legend-box').insertAdjacentHTML('beforeend', '<div id="legend-src"></div>');
  // the mode bar: an icon before each name
  const icon: Record<string, string> = { map: ICONS.map, walk: ICONS.walk, car: ICONS.car, drone: ICONS.drone };
  document.querySelectorAll<HTMLButtonElement>('#modes [data-mode]').forEach((b) => { b.innerHTML = `${icon[b.dataset.mode!] ?? ''}<span class="lbl">${esc(b.textContent)}</span>`; });
  document.body.insertAdjacentHTML('beforeend', `<div id="t-backdrop"></div><div id="t-loading">Loading ${esc(o.place)}…</div>
    <div id="t-pad"><div class="r"><button data-n="turn-l" title="Turn left">${ICONS.turnL}</button><button data-n="tilt-up" title="Tilt up">${ICONS.up}</button><button data-n="turn-r" title="Turn right">${ICONS.turnR}</button></div>
    <div class="r"><button data-n="in" title="Zoom in">${ICONS.plus}</button><button data-n="tilt-down" title="Tilt down">${ICONS.down}</button><button data-n="out" title="Zoom out">${ICONS.minus}</button></div><button class="north" data-n="north">Face north</button></div>`);
  // the dimmed world behind an open dialog (a tap on it closes the dialogs)
  const back = $('#t-backdrop'), dialogs = [...document.querySelectorAll<HTMLElement>('.dialog')];
  const sync = () => back.classList.toggle('open', dialogs.some((d) => d.classList.contains('open')));
  const mo = new MutationObserver(sync); dialogs.forEach((d) => mo.observe(d, { attributes: true, attributeFilter: ['class'] }));
  back.onclick = () => dialogs.forEach((d) => d.classList.remove('open'));
}

/** the loading line goes once the world has drawn and the areas are in */
export function loaded(): void { const el = document.getElementById('t-loading'); if (el) { el.classList.add('gone'); setTimeout(() => el.remove(), 500); } }

/** the camera pad: turn, tilt, zoom, face north (for those without the gestures) */
export function cameraPad(w: World, shown: () => boolean): void {
  const pad = $('#t-pad');
  const nudge = (c: { heading?: number; pitch?: number; zoom?: number; north?: boolean }) => {
    const p = w.camera.pose, tilt = 90 - (p.pitch * 180) / Math.PI;
    void w.fly({ lon: p.lon, lat: p.lat, dist: p.dist * (c.zoom ?? 1), bearing: c.north ? 0 : p.bearing + (c.heading ?? 0), tilt: Math.max(0, Math.min(80, tilt + (c.pitch ?? 0))) }, { seconds: 0.35 });
  };
  const N: Record<string, Parameters<typeof nudge>[0]> = { 'turn-l': { heading: -20 }, 'turn-r': { heading: 20 }, 'tilt-up': { pitch: 8 }, 'tilt-down': { pitch: -8 }, in: { zoom: 0.7 }, out: { zoom: 1.4 }, north: { north: true } };
  pad.addEventListener('click', (e) => { const n = (e.target as HTMLElement).closest<HTMLElement>('[data-n]')?.dataset.n; if (n && N[n]) { nudge(N[n]!); log('pad', { n }); } });
  setInterval(() => pad.classList.toggle('hidden', !shown()), 300);
}

/** the sky's chip: a sun or a moon, the time, the season and the weather */
export function skyChip(w: World, weatherLabel: () => string): void {
  // (written only when it changed: a still page does no layout or paint for its chip)
  let was = '';
  const draw = () => {
    const l = w.state.time.local, n = skyNow(w.time.getTime(), w.camera.lon, w.camera.lat);
    const icon = n.sun.altitude < -4 ? ICONS.moon : ICONS.sun, t = `${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}`, wl = `${seasonOf(l.month)} · ${weatherLabel()}`;
    if (`${icon}|${t}|${wl}` === was) return; was = `${icon}|${t}|${wl}`;
    $('#env-i').innerHTML = icon; $('#env-t').textContent = t; $('#env-w').textContent = wl;
  };
  setInterval(draw, 1000); draw();
}

// ── time, date and weather: the dashboard's dialog ──────────────────────────────────────────────────────────────
const TIMES: [string, number][] = [['Dawn', 6], ['Morning', 8.5], ['Noon', 13], ['Afternoon', 15.5], ['Dusk', 19], ['Night', 21.5]];
const SPEEDS: [string, number][] = [['Pause', 0], ['1 min/s', 60], ['10 min/s', 600], ['1 h/s', 3600]];
const hm = (h: number | null) => (h === null ? '–' : `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60 + 1e-6)).padStart(2, '0')}`);
const pad2 = (n: number) => String(n).padStart(2, '0');
export interface TwinEnvOptions { zone: string; weathers: { key: string; label: string }[]; setWeather: (k: string) => void; weatherNow: () => string; close: () => void }
export function twinEnv(w: World, o: TwinEnvOptions): () => void {
  const pane = $('#env-pane');
  const render = () => {
    const t = w.time.getTime(), l = w.state.time.local, hours = l.hour + l.minute / 60, live = w.timeRunning, rate = w.timeRate;
    const lon = w.camera.lon, lat = w.camera.lat, n = skyNow(t, lon, lat);
    const midnight = zonedTime(`${l.year}-${pad2(l.month)}-${pad2(l.day)}T00:00`, o.zone).getTime(), st = sunTimes(midnight, lat, lon);
    const doy = Math.round((Date.UTC(l.year, l.month - 1, l.day) - Date.UTC(l.year, 0, 1)) / 86400000) + 1;
    pane.innerHTML = `<div class="t-env-head"><div><div class="s">${live ? 'Live local time' : 'Custom moment'} · ${seasonOf(l.month)}</div></div><div class="big">${hm(hours)}</div></div>
      <div><input id="te-hour" type="range" min="0" max="1439" value="${Math.round(hours * 60)}">
        <div class="t-chips">${TIMES.map(([lb, h]) => `<button data-h="${h}">${lb} ${hm(h)}</button>`).join('')}</div></div>
      <div><div class="t-row"><span>Date</span><input id="te-date" type="date" value="${l.year}-${pad2(l.month)}-${pad2(l.day)}"></div><input id="te-doy" type="range" min="1" max="366" value="${doy}"></div>
      <div class="t-chips"><span class="lbl">Speed</span>${SPEEDS.map(([lb, s]) => `<button data-rate="${s}" class="${!live && rate === s ? 'on' : ''}">${lb}</button>`).join('')}<button data-rate="live" class="${live ? 'on' : ''}">Now (live)</button></div>
      <div class="t-chips"><span class="lbl">Weather</span>${o.weathers.map((x) => `<button data-w="${x.key}" class="${o.weatherNow() === x.key ? 'on' : ''}">${esc(x.label)}</button>`).join('')}</div>
      <div class="t-facts"><span class="k">Sunrise / sunset</span><span>${hm(st.rise)} / ${hm(st.set)}</span>
        <span class="k">Sun</span><span>${n.sun.altitude.toFixed(1)}° high, ${Math.round(n.sun.azimuth)}° from north</span>
        <span class="k">Highest sun today</span><span>${st.highest.toFixed(1)}° at ${hm(st.noon)}</span>
        <span class="k">Moon</span><span>${phaseName(n.moon.elongation)} · ${Math.round(n.moon.illumination * 100)}% lit · ${n.moon.altitude.toFixed(0)}° high</span></div>
      <p class="t-note">Observed now: the weather read at three places round the view (Open-Meteo).</p>
      <div class="t-done"><button id="te-done">Done</button></div>`;
    // a moment on the place's clocks: that day at that time
    const at = (y: number, m: number, d: number, h: number) => { w.setTime(zonedTime(`${y}-${pad2(m)}-${pad2(d)}T${pad2(Math.floor(h))}:${pad2(Math.floor((h % 1) * 60 + 1e-6))}`, o.zone), { rate: live ? 0 : rate }); render(); };
    $<HTMLInputElement>('#te-hour').oninput = (e) => at(l.year, l.month, l.day, Number((e.target as HTMLInputElement).value) / 60);
    $<HTMLInputElement>('#te-date').onchange = (e) => { const [y, m, d] = String((e.target as HTMLInputElement).value).split('-').map(Number); if (y) at(y, m!, d!, hours); };
    $<HTMLInputElement>('#te-doy').oninput = (e) => { const d = new Date(Date.UTC(l.year, 0, Number((e.target as HTMLInputElement).value))); at(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hours); };
    pane.querySelectorAll<HTMLButtonElement>('[data-h]').forEach((b) => { b.onclick = () => at(l.year, l.month, l.day, Number(b.dataset.h)); });
    pane.querySelectorAll<HTMLButtonElement>('[data-rate]').forEach((b) => { b.onclick = () => { const k = b.dataset.rate!; if (k === 'live') w.setTime('now'); else w.setTimeRate(Number(k)); log('time', { rate: k }); render(); }; });
    pane.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => { b.onclick = () => { o.setWeather(b.dataset.w!); render(); }; });
    $('#te-done').onclick = o.close;
  };
  return render;
}

/** an area's tooltip as the dashboard drew it: its name and its council, the value, the residents */
export function areaTip(name: string, council: string | null, value: string, pop: number | null): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `<b>${esc(name)}</b>${council ? `<span class="m"> · ${esc(council)}</span>` : ''}<div class="m">${esc(value)}</div>${pop ? `<div class="m">${Math.round(pop).toLocaleString('en-AU')} residents</div>` : ''}`;
  return el;
}
