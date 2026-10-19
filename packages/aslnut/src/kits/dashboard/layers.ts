// kits › dashboard › layers: the list of a world's stacked layers, as a GIS keeps one: each layer shown or hidden,
// its opacity, its place in the stack (dragged), its legend, in groups (the twin's own parts apart from the data laid
// over them), kept in step with w.add / w.remove and with what shows at this view. Drawn for you (a panel that folds
// to a button on a phone), or described for your own UI. Every change is a uniform or the draw order: one frame,
// nothing built again (core › world › elements › props, order). A layer can be added from a map or feature service:
// its URL, its layers listed from its capabilities, one picked (a WMS layer as one picture of the view, a WFS layer
// as areas, lines or points by its geometry), into a group of the list.
//   layers(w, { groups: { Twin: ['roads', street, terrainPart], Data: ['suburbs', 'routes', 'stops'] } })
//   layers(w, { groups, add: { group: 'Data', services: ['https://…/wms', 'https://…/wfs'] } })
//   layers(w, {}).describe()        the same as data: groups, items, their state and legends
import type { Element } from '../../core/world/element.ts';
import type { ElementChange, World } from '../../core/world/world.ts';
import { isScale, type Legend, type Scale } from '../../core/encoding/scales.ts';
import { rgba } from '../../core/render/style/color.ts';
import type { Corner } from './index.ts';
import { raster } from '../../core/encoding/marks/raster.ts';
import { area } from '../../core/encoding/marks/area.ts';
import { line } from '../../core/encoding/marks/line.ts';
import { points } from '../../core/encoding/marks/points.ts';
import { wfs } from '../../core/data/sources/wfs.ts';
import { wmsCapabilities, wfsCapabilities, wfsDescribe, type ServiceOptions } from '../../core/data/sources/ogc.ts';

/** a layer picked from a service: its kind, URL, name, title, and (a WFS layer) its geometry's type */
export interface ServicePick { service: 'wms' | 'wfs'; url: string; name: string; title: string; geometry: 'area' | 'line' | 'point' | null }
export interface AddOptions extends ServiceOptions {
  /** the group the added layers join (default the first group, else 'Data') */
  group?: string;
  /** service URLs offered (a list to pick from; any other can be typed) */
  services?: string[];
  /** the layer for a pick (default: a WMS layer as one picture of the view at .7 opacity; a WFS layer as areas,
   *  lines or points by its geometry, in the next colour of a small palette) */
  make?: (p: ServicePick) => Element | Promise<Element>;
}

/** something a list switches that is not a layer of its own (the terrain's relief, a kind of thing a layer builds) */
export interface LayerPart { id: string; label: string; shown(): boolean; show(on: boolean): void; /** a colour for its swatch */ swatch?: string; /** what it costs to switch (a note under its name) */ note?: string; /** one of a choice: parts with the same name are drawn as one set of radio buttons (a base map: one of them shown) */ radio?: string }
export interface LayersOptions {
  /** the layers listed when no group names them (default: every layer with a `label`) */
  of?: (Element | string)[];
  /** named groups, each a list of layers (or ids) and parts, shown in this order */
  groups?: Record<string, (Element | string | LayerPart)[]>;
  /** the panel's title (default 'Layers') */
  title?: string;
  position?: Corner;
  /** an opacity slider for each layer that can fade (default true) */
  opacity?: boolean;
  /** drag a layer to another place in its group (default true) */
  reorder?: boolean;
  /** each layer's legend under it (default true): its colour scale's classes, or one swatch */
  legend?: boolean;
  /** where each layer sits with the twin ('ground', 'over', 'above'), tapped to change it (default false; a change
   *  builds its programs again: not one frame) */
  modes?: boolean;
  /** legends of your own, by layer id (a scale or a legend) */
  legends?: Record<string, Legend | Scale<never, unknown>>;
  format?: (v: number) => string;
  /** seconds a layer takes to show or hide (default 0: one frame) */
  fade?: number;
  /** start folded to its button (default: on a narrow screen, under 600 px) */
  folded?: boolean;
  /** where it goes (default: the canvas's parent) */
  into?: HTMLElement;
  /** a class of yours on the panel, after aslnut's (its rules win) */
  className?: string;
  /** an 'add a layer' button: a WMS or WFS URL, its layers listed, one picked (default false) */
  add?: boolean | AddOptions;
}
/** one row of the list, as data */
export interface LayerItem {
  id: string; label: string; group: string;
  /** a layer's kind ('area', 'line', …), or 'part' */
  kind: string;
  /** where it sits with the twin (null: the world's own part) */
  sits: 'ground' | 'over' | 'above' | 'free' | null;
  /** switched on (shown by hand or following its `when`) */
  on: boolean;
  /** shown now: on, and its `when` lets it at this view */
  visible: boolean;
  /** 0..1, or null: it cannot fade */
  opacity: number | null;
  legend: Legend | null;
  /** its colour for a swatch (a constant colour; null: none) */
  swatch: string | null;
  /** it can be dragged to another place in its group */
  movable: boolean;
  note?: string;
  /** one of a choice (a part's radio name) */
  radio?: string;
}
export interface LayerList { title: string; groups: { name: string; items: LayerItem[] }[] }
export interface LayersHandle {
  el: HTMLElement | null;
  describe(): LayerList;
  update(): void;
  remove(): void;
  /** switch one on or off (one frame) */
  show(id: string, on: boolean): void;
  setOpacity(id: string, v: number): void;
  /** a group's layers in this order, top first (as the list shows them) */
  restack(group: string, idsTopFirst: string[]): void;
  /** fold or open the panel */
  fold(folded?: boolean): void;
  /** a service's layers (its capabilities: WMS, WFS, or whichever answers) */
  listService(url: string, kind?: 'wms' | 'wfs' | 'auto'): Promise<ServicePick[]>;
  /** a picked layer made and added (into the add group) */
  addFrom(p: ServicePick): Promise<Element>;
}

const isPart = (x: unknown): x is LayerPart => !!x && typeof x === 'object' && typeof (x as LayerPart).show === 'function' && typeof (x as LayerPart).shown === 'function' && !('frame' in (x as object));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: unknown): string | null => {
  if (typeof c !== 'string' && !Array.isArray(c)) return null;
  try { const r = rgba(c as never); return `rgba(${Math.round(r[0] * 255)},${Math.round(r[1] * 255)},${Math.round(r[2] * 255)},${Math.max(0.35, r[3]).toFixed(2)})`; } catch { return null; }
};
const MODES = ['ground', 'over', 'above'] as const;
const PALETTE = ['#e4572e', '#17bebb', '#ffc914', '#76b041', '#9c6ade', '#2e86ab', '#f18f01', '#c73e1d'];
const geometryOf = (t: string | undefined): ServicePick['geometry'] => (!t ? null : /Point/i.test(t) ? 'point' : /Line|Curve/i.test(t) ? 'line' : /Polygon|Surface/i.test(t) ? 'area' : null);

export function layers(w: World, o: LayersOptions = {}): LayersHandle {
  const title = o.title ?? 'Layers', fade = o.fade ?? 0;
  const find = (x: Element | string): Element | null => { if (typeof x !== 'string') return w.list.includes(x) ? x : null; try { return w.element(x); } catch { return null; } };
  const idOf = (x: Element | string | LayerPart) => (typeof x === 'string' ? x : x.id);
  /** the groups now: the named ones, then the labelled layers no group names */
  const ao: AddOptions | null = o.add ? (o.add === true ? {} : o.add) : null;
  const addGroup = ao?.group ?? Object.keys(o.groups ?? {})[0] ?? 'Data';
  const added: string[] = [];
  const model = (): { name: string; entries: (Element | LayerPart)[] }[] => {
    const named = new Set<string>(), out: { name: string; entries: (Element | LayerPart)[] }[] = [];
    const groups = { ...(o.groups ?? {}) } as Record<string, (Element | string | LayerPart)[]>;
    if (added.length) groups[addGroup] = [...(groups[addGroup] ?? []), ...added];
    for (const [name, list] of Object.entries(groups)) {
      const entries: (Element | LayerPart)[] = [];
      for (const x of list) { named.add(idOf(x)); if (isPart(x)) entries.push(x); else { const l = find(x); if (l) entries.push(l); } }
      out.push({ name, entries });
    }
    const rest = (o.of ? o.of.map(find).filter((l): l is Element => !!l) : w.list.filter((l) => !!l.props.label)).filter((l) => !named.has(l.id));
    if (rest.length) out.push({ name: o.groups || added.length ? 'Other' : '', entries: rest });
    // a group's layers top first, as they are drawn (its parts where they were given)
    const at = new Map(w.list.map((l, i) => [l, i] as const));
    for (const g of out) {
      const ls = g.entries.filter((e): e is Element => !isPart(e)).sort((a, b) => (at.get(b) ?? 0) - (at.get(a) ?? 0));
      let k = 0; g.entries = g.entries.map((e) => (isPart(e) ? e : ls[k++]!));
    }
    return out;
  };
  const legendOf = (l: Element): { legend: Legend | null; swatch: string | null } => {
    const own = o.legends?.[l.id], p = l.props as unknown as Record<string, unknown>;
    const lg = own ?? (p.legend as Legend | undefined) ?? (typeof (l as { legendImage?: unknown }).legendImage === 'string' ? { kind: 'image' as const, items: [], image: (l as unknown as { legendImage: string }).legendImage } : undefined);
    if (lg) return { legend: isScale(lg) ? (lg as Scale<never, unknown>).legend({ format: o.format }) : lg as Legend, swatch: null };
    const c = p.color;
    if (isScale(c)) { try { return { legend: (c as Scale<never, unknown>).legend({ format: o.format }), swatch: null }; } catch { return { legend: null, swatch: null }; } }
    return { legend: null, swatch: typeof c === 'function' ? null : hex(c) };
  };
  const itemOf = (e: Element | LayerPart, group: string, movable: boolean): LayerItem => {
    if (isPart(e)) { const on = e.shown(); return { id: e.id, label: e.label, group, kind: 'part', sits: null, on, visible: on, opacity: null, legend: null, swatch: e.swatch ?? null, movable: false, note: e.note, ...(e.radio ? { radio: e.radio } : {}) }; }
    const l = e, on = l.forced !== false, { legend, swatch } = legendOf(l);
    return { id: l.id, label: l.props.label ?? l.id, group, kind: l.kind, sits: l.sits, on, visible: on && l.target > 0, opacity: l.fades ? l.props.opacity ?? 1 : null, legend: o.legend === false ? null : legend, swatch, movable };
  };
  const describe = (): LayerList => ({ title, groups: model().map((g) => { const movable = o.reorder !== false && g.entries.filter((e) => !isPart(e)).length > 1; return { name: g.name, items: g.entries.map((e) => itemOf(e, g.name, movable && !isPart(e) && e.sits !== null)) }; }) });

  // ── what it does (the drawn panel and your UI alike) ──
  const show = (id: string, on: boolean) => {
    for (const g of model()) for (const e of g.entries) if (e.id === id) { if (isPart(e)) e.show(on); else if (on) w.release(id, { seconds: fade }); else w.hide(id, { seconds: fade }); }
    schedule();
  };
  const setOpacity = (id: string, v: number) => w.setOpacity(id, v);
  const restack = (group: string, idsTopFirst: string[]) => {
    const g = model().find((x) => x.name === group); if (!g) return;
    const mine = g.entries.filter((e): e is Element => !isPart(e) && e.sits !== null).map((l) => l.id);
    const order = idsTopFirst.filter((id) => mine.includes(id));
    for (const id of mine) if (!order.includes(id)) order.push(id);
    w.reorder([...order].reverse());
  };

  // ── drawn ──
  let el: HTMLElement | null = null, folded = o.folded ?? (typeof innerWidth === 'number' && innerWidth < 600), dragging = false, open = new Set<string>(), queued = 0;
  const canvas = w.renderer?.canvas as HTMLCanvasElement | undefined;
  const host = o.into ?? (canvas && 'parentElement' in canvas ? canvas.parentElement : null);
  const swatchHTML = (it: LayerItem) => {
    if (it.legend?.kind === 'image') return '<span class="al-sw al-sw-pic"></span>';
    const c = it.swatch ?? (it.legend?.kind === 'continuous' ? null : it.legend?.items[Math.floor((it.legend.items.length - 1) / 2)]?.color) ?? null;
    if (it.legend?.kind === 'continuous' && it.legend.stops?.length) return `<span class="al-sw al-sw-ramp" style="background:linear-gradient(90deg,${it.legend.stops.join(',')})"></span>`;
    if (!c) return '<span class="al-sw al-sw-none"></span>';
    const shape = it.kind === 'line' ? 'line' : it.kind === 'point' ? 'dot' : it.kind === 'label' ? 'text' : 'fill';
    return shape === 'text' ? `<span class="al-sw al-sw-text" style="color:${c}">Aa</span>` : `<span class="al-sw al-sw-${shape}" style="--c:${c}"></span>`;
  };
  const legendHTML = (lg: Legend) => lg.kind === 'image' ? `<img class="al-legpic" src="${esc(lg.image ?? '')}" alt="legend" loading="lazy">` : lg.kind === 'continuous'
    ? `<div class="al-ramp" style="background:linear-gradient(90deg,${(lg.stops ?? []).join(',')})"></div><div class="al-ends">${lg.items.map((i) => `<span>${esc(i.label)}</span>`).join('')}</div>`
    : `${lg.items.map((i) => `<div class="al-class"><span class="al-sw al-sw-fill" style="--c:${i.color ?? '#888'}"></span><span>${esc(i.label)}</span></div>`).join('')}${lg.missing ? `<div class="al-class al-dim"><span class="al-sw al-sw-fill" style="--c:${lg.missing}"></span><span>no data</span></div>` : ''}`;
  const rowHTML = (it: LayerItem) => {
    const more = (o.opacity !== false && it.opacity !== null) || (o.legend !== false && it.legend);
    const isOpen = open.has(it.id);
    return `<li class="al-row${it.on ? '' : ' al-off'}${it.on && !it.visible ? ' al-out' : ''}${isOpen ? ' al-open' : ''}" data-id="${esc(it.id)}">
      <div class="al-line">${it.movable ? '<span class="al-grip" title="drag to move it up or down" aria-label="move">⋮⋮</span>' : '<span class="al-grip al-nogrip"></span>'}
        <label class="al-name"><input type="${it.radio ? 'radio' : 'checkbox'}"${it.radio ? ` name="al-${esc(it.radio)}"` : ''} ${it.on ? 'checked' : ''} aria-label="show ${esc(it.label)}">${swatchHTML(it)}<span class="al-text">${esc(it.label)}${it.note ? `<small>${esc(it.note)}</small>` : ''}<small class="al-why">not at this zoom</small></span></label>
        ${o.modes && it.sits && it.sits !== 'free' ? `<button class="al-mode" data-mode title="where it sits with the twin: tap to change">${it.sits}</button>` : ''}
        ${more ? `<button class="al-more" data-more aria-expanded="${isOpen}" title="opacity and legend">${isOpen ? '▴' : '▾'}</button>` : ''}
      </div>
      ${more && isOpen ? `<div class="al-detail">${o.opacity !== false && it.opacity !== null ? `<label class="al-op"><span>opacity</span><input type="range" min="0" max="1" step="0.05" value="${it.opacity}" data-op><output>${Math.round(it.opacity * 100)}%</output></label>` : ''}${o.legend !== false && it.legend ? `<div class="al-legend">${legendHTML(it.legend)}</div>` : ''}</div>` : ''}
    </li>`;
  };
  const render = () => {
    if (!el || dragging) return;
    const d = describe();
    const count = d.groups.reduce((n, g) => n + g.items.filter((i) => i.on).length, 0);
    el.classList.toggle('al-folded', folded);
    el.innerHTML = `<button class="al-head" aria-expanded="${!folded}"><span class="al-icon">☰</span><span>${esc(d.title)}</span><span class="al-count">${count}</span><span class="al-chev">${folded ? '▾' : '▴'}</span></button>
      <div class="al-body">${d.groups.map((g) => `<section class="al-group" data-g="${esc(g.name)}">${g.name ? `<header><label><input type="checkbox" data-all ${g.items.some((i) => i.on) ? 'checked' : ''} aria-label="show all of ${esc(g.name)}"><span>${esc(g.name)}</span></label></header>` : ''}<ol>${g.items.map(rowHTML).join('')}</ol></section>`).join('')}${ao ? addHTML() : ''}</div>`;
  };
  // ── adding a layer from a service ──
  let adding: { open: boolean; url: string; kind: 'auto' | 'wms' | 'wfs'; busy: boolean; error: string; picks: ServicePick[]; filter: string } = { open: false, url: ao?.services?.[0] ?? '', kind: 'auto', busy: false, error: '', picks: [], filter: '' };
  const addHTML = () => {
    if (!adding.open) return `<button class="al-addbtn" data-add>＋ Add a layer from a map or feature service</button>`;
    const f = adding.filter.toLowerCase(), shown = adding.picks.filter((p) => !f || p.title.toLowerCase().includes(f) || p.name.toLowerCase().includes(f)).slice(0, 60);
    return `<div class="al-add"><div class="al-addrow"><input class="al-url" data-url type="url" inputmode="url" placeholder="https://…/wms or …/wfs" value="${esc(adding.url)}" list="al-services">${ao?.services?.length ? `<datalist id="al-services">${ao.services.map((u) => `<option value="${esc(u)}">`).join('')}</datalist>` : ''}</div>
      <div class="al-addrow"><select data-kind aria-label="service kind">${(['auto', 'wms', 'wfs'] as const).map((k) => `<option value="${k}" ${adding.kind === k ? 'selected' : ''}>${k === 'auto' ? 'WMS or WFS' : k.toUpperCase()}</option>`).join('')}</select><button class="al-go" data-list ${adding.busy ? 'disabled' : ''}>${adding.busy ? 'Reading…' : 'List its layers'}</button><button class="al-x" data-close aria-label="close">✕</button></div>
      ${adding.error ? `<div class="al-err">${esc(adding.error)}</div>` : ''}
      ${adding.picks.length ? `<input class="al-filter" data-filter placeholder="filter ${adding.picks.length} layers" value="${esc(adding.filter)}"><ul class="al-picks">${shown.map((p) => `<li><button data-pick="${esc(`${p.service}|${p.name}`)}"><b>${p.service.toUpperCase()}</b> ${esc(p.title)}<small>${esc(p.name)}${p.geometry ? ` · ${p.geometry}` : ''}</small></button></li>`).join('')}</ul>` : ''}</div>`;
  };
  const so = (): ServiceOptions => ({ headers: ao?.headers, fetch: ao?.fetch, proxy: ao?.proxy });
  const listService = async (url: string, kind: 'wms' | 'wfs' | 'auto' = 'auto'): Promise<ServicePick[]> => {
    const out: ServicePick[] = [], errs: string[] = [];
    const tryWms = kind === 'wms' || (kind === 'auto' && !/wfs/i.test(url)), tryWfs = kind === 'wfs' || (kind === 'auto' && !/wms/i.test(url));
    if (tryWms) await wmsCapabilities(url, so()).then((c) => { for (const l of c.layers) out.push({ service: 'wms', url, name: l.name, title: l.title, geometry: null }); }).catch((e: Error) => errs.push(`WMS: ${e.message}`));
    if (tryWfs) await wfsCapabilities(url, so()).then((c) => { for (const l of c.layers) out.push({ service: 'wfs', url, name: l.name, title: l.title, geometry: null }); }).catch((e: Error) => errs.push(`WFS: ${e.message}`));
    if (!out.length) throw new Error(errs.join(' · ') || 'no layers');
    return out;
  };
  let colours = 0;
  const addFrom = async (p: ServicePick): Promise<Element> => {
    let l: Element;
    const plain = `${p.service}-${p.name.replace(/[^A-Za-z0-9_-]+/g, '_')}`;
    if (ao?.make) l = await ao.make(p);
    else if (p.service === 'wms') l = raster({ id: plain, label: p.title, source: raster.wms(p.url, { layers: p.name, single: true, ...so() }), opacity: 0.7 }) as unknown as Element;
    else {
      const geom = p.geometry ?? geometryOf((await wfsDescribe(p.url, p.name, so()).catch(() => null))?.geometry?.type), c = PALETTE[colours++ % PALETTE.length]!;
      // loaded once: the whole layer when it is small, else the box the view shows when it is added (a little more: a
      // pan nearby finds it there); looking never asks for more (core › data: never changed by looking)
      const v = w.state.view, kx = 111320 * Math.max(0.05, Math.cos((v.lat * Math.PI) / 180)), half = 0.75 * Math.max(v.width, v.height) * v.pixelSize * (1 + Math.min(2, v.tilt / 30));
      const extent: [number, number, number, number] = [v.lon - half / kx, Math.max(-85, v.lat - half / 110574), v.lon + half / kx, Math.min(85, v.lat + half / 110574)];
      const src = wfs(p.url, { typeName: p.name, orExtent: extent, most: 5000, ...so() }), id = plain;
      l = (geom === 'point' ? points({ id, label: p.title, data: src, color: c, size: 7, outline: { color: '#ffffff', width: 1.5 } })
        : geom === 'line' ? line({ id, label: p.title, data: src, color: c, width: 2 })
        : area({ id, label: p.title, data: src, color: `${c}66`, outline: { color: c, width: 1.5 } })) as unknown as Element;
    }
    if (w.list.some((x) => x.id === l.id)) w.remove(l.id);
    w.add(l); added.push(l.id); schedule();
    return l;
  };
  /** a change in the world: the rows' states at once (a full redraw when what is listed changed), never in a frame */
  const schedule = () => { if (queued) return; queued = setTimeout(() => { queued = 0; render(); }, 0) as unknown as number; };
  let off: (() => void) | null = null;
  if (host && typeof document !== 'undefined') {
    style();
    el = document.createElement('div');
    el.className = `aslnut-layers${o.className ? ` ${o.className}` : ''}`;
    if (!o.into) {
      const pos = o.position ?? 'top-right', [v, h] = pos.split('-') as ['top' | 'bottom', 'left' | 'right'];
      // (at the bottom it opens upwards, its button where the thumb is, clear of the credits' line)
      el.classList.add('al-float', `al-${v}`); el.style[v] = `calc(${v === 'bottom' ? 26 : 8}px + env(safe-area-inset-${v}, 0px))`; el.style[h] = '8px';
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    }
    host.appendChild(el);
    render();
    // (an opacity the panel's own slider is setting: the slider shows it already, the row is not drawn again under the
    // finger)
    off = w.on('elements', (c: ElementChange) => { if (c.what === 'opacity' && el?.contains(document.activeElement)) return; schedule(); });
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.al-head')) { folded = !folded; render(); return; }
      if (t.closest('[data-add]')) { adding.open = true; render(); el?.querySelector<HTMLInputElement>('[data-url]')?.focus(); return; }
      if (t.closest('[data-close]')) { adding = { ...adding, open: false, error: '', picks: [] }; render(); return; }
      if (t.closest('[data-list]')) {
        adding.url = el?.querySelector<HTMLInputElement>('[data-url]')?.value.trim() ?? adding.url; adding.busy = true; adding.error = ''; adding.picks = []; render();
        listService(adding.url, adding.kind).then((ps) => { adding.picks = ps; }).catch((err: Error) => { adding.error = err.message.slice(0, 300); }).finally(() => { adding.busy = false; render(); });
        return;
      }
      const pk = t.closest<HTMLElement>('[data-pick]')?.dataset.pick;
      if (pk) { const [svc, ...nm] = pk.split('|'), p = adding.picks.find((x) => x.service === svc && x.name === nm.join('|')); if (p) { adding = { ...adding, open: false, picks: [] }; addFrom(p).catch((err: Error) => { adding = { ...adding, open: true, error: err.message }; render(); }); } return; }
      const row = t.closest<HTMLElement>('.al-row'), id = row?.dataset.id;
      if (t.closest('[data-more]') && id) { if (open.has(id)) open.delete(id); else open.add(id); render(); return; }
      if (t.closest('[data-mode]') && id) {
        const l = find(id); if (!l) return;
        const now = l.sits as typeof MODES[number], next = MODES[(MODES.indexOf(now) + 1) % MODES.length]!;
        l.setProps({ drape: next } as never); render(); return;
      }
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.kind !== undefined) { adding.kind = (t as unknown as HTMLSelectElement).value as typeof adding.kind; return; }
      // (a group switched all on or off: its choices left as they are)
      if (t.dataset.all !== undefined) { const g = model().find((x) => x.name === t.closest<HTMLElement>('.al-group')?.dataset.g); for (const x of g?.entries ?? []) if (!(isPart(x) && x.radio)) show(x.id, t.checked); return; }
      const id = t.closest<HTMLElement>('.al-row')?.dataset.id;
      if (id && t.type === 'checkbox') show(id, t.checked);
      if (id && t.type === 'radio' && t.checked) show(id, true);
    });
    el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement, id = t.closest<HTMLElement>('.al-row')?.dataset.id;
      if (t.dataset.url !== undefined) { adding.url = t.value; return; }
      if (t.dataset.filter !== undefined) { adding.filter = t.value; const at = t.selectionStart; render(); const f = el?.querySelector<HTMLInputElement>('[data-filter]'); if (f) { f.focus(); f.setSelectionRange(at, at); } return; }
      if (id && t.dataset.op !== undefined) { setOpacity(id, Number(t.value)); const out = t.parentElement?.querySelector('output'); if (out) out.textContent = `${Math.round(Number(t.value) * 100)}%`; }
    });
    // drag to reorder: the grip held, the row follows the finger, the others make room; dropped, the group restacks
    el.addEventListener('pointerdown', (e) => {
      const grip = (e.target as HTMLElement).closest<HTMLElement>('.al-grip:not(.al-nogrip)'); if (!grip) return;
      const row = grip.closest<HTMLElement>('.al-row')!, list = row.parentElement as HTMLElement, group = row.closest<HTMLElement>('.al-group')!.dataset.g ?? '';
      e.preventDefault(); grip.setPointerCapture(e.pointerId); dragging = true;
      const rows = [...list.children] as HTMLElement[], from = rows.indexOf(row), r0 = row.getBoundingClientRect(), y0 = e.clientY;
      const mids = rows.map((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; });
      let to = from;
      row.classList.add('al-drag');
      const move = (ev: PointerEvent) => {
        const dy = ev.clientY - y0; row.style.transform = `translateY(${dy}px)`;
        const y = r0.top + r0.height / 2 + dy;
        // its place: after every other row whose middle is above its own middle now
        to = 0; for (let i = 0; i < mids.length; i++) if (i !== from && mids[i]! < y) to++;
        rows.forEach((r, i) => { if (r === row) return; const shift = from < to ? (i > from && i <= to ? -r0.height : 0) : (i >= to && i < from ? r0.height : 0); r.style.transform = shift ? `translateY(${shift}px)` : ''; });
      };
      const up = () => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
        rows.forEach((r) => { r.style.transform = ''; }); row.classList.remove('al-drag'); dragging = false;
        if (to !== from) { const ids = rows.map((r) => r.dataset.id!); ids.splice(to, 0, ids.splice(from, 1)[0]!); restack(group, ids); }
        render();
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
  }
  return {
    el, describe, update: render, show, setOpacity, restack, listService, addFrom,
    fold: (f?: boolean) => { folded = f ?? !folded; render(); },
    remove: () => { off?.(); clearTimeout(queued); el?.remove(); el = null; },
  };
}

/** aslnut's small default style for the panel (once per page): dark glass, phone-sized rows, a fold to one button */
function style(): void {
  if (document.getElementById('aslnut-layers-style')) return;
  const s = document.createElement('style'); s.id = 'aslnut-layers-style';
  s.textContent = `
.aslnut-layers { --al-bg: rgba(12,16,24,.88); --al-line: rgba(255,255,255,.12); --al-fg: #e6ebf0; --al-dim: #93a1af; --al-accent: #38bdf8;
  font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--al-fg); width: min(300px, calc(100vw - 16px)); z-index: 12; user-select: none; }
.aslnut-layers.al-float { position: absolute; }
.aslnut-layers .al-head { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 8px 12px; background: var(--al-bg); border: 1px solid var(--al-line); border-radius: 12px; cursor: pointer; font-weight: 600; backdrop-filter: blur(8px); }
.aslnut-layers.al-folded { width: auto; }
.aslnut-layers.al-folded .al-head { width: auto; }
.aslnut-layers:not(.al-folded) .al-head { border-radius: 12px 12px 0 0; }
.aslnut-layers.al-bottom { display: flex; flex-direction: column-reverse; align-items: flex-end; }
.aslnut-layers.al-bottom:not(.al-folded) .al-head { border-radius: 0 0 12px 12px; }
.aslnut-layers.al-bottom .al-body { border-top: 1px solid var(--al-line); border-bottom: 0; border-radius: 12px 12px 0 0; width: 100%; box-sizing: border-box; }
.aslnut-layers .al-count { margin-left: auto; min-width: 20px; padding: 1px 6px; border-radius: 10px; background: rgba(56,189,248,.18); color: var(--al-accent); font-size: 11px; text-align: center; }
.aslnut-layers .al-chev { color: var(--al-dim); font-size: 11px; }
.aslnut-layers.al-folded .al-body { display: none; }
.aslnut-layers .al-body { background: var(--al-bg); border: 1px solid var(--al-line); border-top: 0; border-radius: 0 0 12px 12px; max-height: min(64vh, calc(100vh - 120px)); overflow: auto; overscroll-behavior: contain; backdrop-filter: blur(8px); padding: 4px 0 6px; }
.aslnut-layers .al-group header { padding: 8px 12px 4px; color: var(--al-dim); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
.aslnut-layers .al-group header label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.aslnut-layers ol { list-style: none; margin: 0; padding: 0; }
.aslnut-layers .al-row { position: relative; border-top: 1px solid rgba(255,255,255,.04); background: transparent; transition: transform .12s ease; }
.aslnut-layers .al-row.al-drag { z-index: 2; background: rgba(56,189,248,.14); transition: none; box-shadow: 0 4px 14px rgba(0,0,0,.4); }
.aslnut-layers .al-line { display: flex; align-items: center; gap: 4px; min-height: 44px; padding: 0 6px 0 2px; }
.aslnut-layers .al-grip { width: 24px; flex: none; text-align: center; color: var(--al-dim); cursor: grab; touch-action: none; font-size: 12px; letter-spacing: -2px; padding: 12px 0; }
.aslnut-layers .al-nogrip { cursor: default; }
.aslnut-layers .al-name { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 0; }
.aslnut-layers input[type=checkbox], .aslnut-layers input[type=radio] { width: 18px; height: 18px; margin: 0; accent-color: var(--al-accent); flex: none; }
.aslnut-layers .al-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aslnut-layers .al-text small { display: block; color: var(--al-dim); font-size: 11px; }
.aslnut-layers .al-why { display: none !important; }
.aslnut-layers .al-out .al-why { display: block !important; }
.aslnut-layers .al-off .al-text, .aslnut-layers .al-out .al-text { color: var(--al-dim); }
.aslnut-layers .al-sw { width: 16px; height: 16px; flex: none; border-radius: 4px; display: inline-block; }
.aslnut-layers .al-sw-fill { background: var(--c); }
.aslnut-layers .al-sw-line { height: 4px; border-radius: 2px; background: var(--c); }
.aslnut-layers .al-sw-dot { width: 12px; height: 12px; margin: 2px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 2px rgba(0,0,0,.5); }
.aslnut-layers .al-sw-text { font-weight: 700; font-size: 12px; text-align: center; line-height: 16px; }
.aslnut-layers .al-sw-ramp { height: 10px; }
.aslnut-layers .al-sw-none { background: transparent; }
.aslnut-layers .al-mode, .aslnut-layers .al-more { all: unset; box-sizing: border-box; min-width: 32px; height: 32px; padding: 0 8px; border-radius: 8px; text-align: center; line-height: 32px; color: var(--al-dim); cursor: pointer; font-size: 12px; flex: none; }
.aslnut-layers .al-mode { border: 1px solid var(--al-line); height: 26px; line-height: 24px; font-size: 11px; }
.aslnut-layers .al-mode:hover, .aslnut-layers .al-more:hover { background: rgba(255,255,255,.08); color: var(--al-fg); }
.aslnut-layers .al-detail { padding: 2px 12px 10px 34px; display: grid; gap: 8px; }
.aslnut-layers .al-op { display: grid; grid-template-columns: auto 1fr 38px; align-items: center; gap: 8px; color: var(--al-dim); font-size: 12px; }
.aslnut-layers .al-op input { width: 100%; accent-color: var(--al-accent); height: 24px; }
.aslnut-layers .al-op output { text-align: right; font-variant-numeric: tabular-nums; }
.aslnut-layers .al-legend { display: grid; gap: 3px; font-size: 12px; }
.aslnut-layers .al-class { display: flex; align-items: center; gap: 8px; }
.aslnut-layers .al-class .al-sw { width: 12px; height: 12px; border-radius: 3px; }
.aslnut-layers .al-dim { color: var(--al-dim); }
.aslnut-layers .al-ramp { height: 10px; border-radius: 3px; }
.aslnut-layers .al-ends { display: flex; justify-content: space-between; color: var(--al-dim); font-size: 11px; }
.aslnut-layers .al-sw-pic { background: linear-gradient(135deg, #e4572e 0 33%, #ffc914 33% 66%, #17bebb 66%); opacity: .8; }
.aslnut-layers .al-legpic { max-width: 100%; max-height: 220px; background: #fff; border-radius: 4px; padding: 4px; justify-self: start; }
.aslnut-layers .al-addbtn { all: unset; box-sizing: border-box; display: block; width: calc(100% - 16px); margin: 8px; padding: 10px 12px; border: 1px dashed var(--al-line); border-radius: 10px; color: var(--al-accent); cursor: pointer; text-align: center; font-size: 12px; }
.aslnut-layers .al-add { margin: 8px; padding: 8px; border: 1px solid var(--al-line); border-radius: 10px; display: grid; gap: 6px; user-select: text; }
.aslnut-layers .al-addrow { display: flex; gap: 6px; }
.aslnut-layers .al-add input, .aslnut-layers .al-add select { box-sizing: border-box; min-width: 0; flex: 1; height: 34px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--al-line); background: rgba(255,255,255,.06); color: var(--al-fg); font: inherit; font-size: 16px; }
.aslnut-layers .al-add select { flex: none; width: auto; font-size: 13px; }
.aslnut-layers .al-go, .aslnut-layers .al-x { all: unset; box-sizing: border-box; height: 34px; padding: 0 10px; border-radius: 8px; background: rgba(56,189,248,.18); color: var(--al-accent); cursor: pointer; font-size: 12px; white-space: nowrap; }
.aslnut-layers .al-x { background: transparent; color: var(--al-dim); }
.aslnut-layers .al-err { color: #fca5a5; font-size: 12px; word-break: break-word; }
.aslnut-layers .al-picks { list-style: none; margin: 0; padding: 0; max-height: 40vh; overflow: auto; }
.aslnut-layers .al-picks button { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 8px 6px; border-top: 1px solid rgba(255,255,255,.05); cursor: pointer; font-size: 12px; }
.aslnut-layers .al-picks button:hover { background: rgba(255,255,255,.06); }
.aslnut-layers .al-picks b { color: var(--al-accent); font-size: 10px; margin-right: 4px; }
.aslnut-layers .al-picks small { display: block; color: var(--al-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
  document.head.appendChild(s);
}
