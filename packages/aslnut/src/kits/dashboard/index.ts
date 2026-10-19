// kits › dashboard: what a data dashboard needs on top of a world, made only from core: a legend from a layer's scale
// (drawn for you, or described for your own UI), statistics per area, and the layer list, a panel over the layers
// stacked on the world (layers.ts: shown, faded, reordered, each with its legend). Names over places are a layer's
// labels (core › encoding › layers: layer({ data, labels: { text } })), not a part of their own.
//   legend(w, { for: 'crime', title: 'Crimes per 1,000' })          a small box over the map, updated with the data
//   legend(null, { for: myScale }).describe()                       the same, as data for your UI
//   layers(w, { groups: { Data: ['crime', 'names'], Twin: ['roads', 'water'] } })   the stack's list, a panel on a phone
import { AslnutError } from '../../core/world/errors.ts';
import type { World } from '../../core/world/world.ts';
import { isScale, type Legend, type Scale } from '../../core/encoding/scales.ts';

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export interface LegendOptions {
  /** a layer id (its colour scale) or a scale */
  for: string | Scale<never, unknown>;
  title?: string;
  position?: Corner;
  format?: (v: number) => string;
  /** where it goes (default: the canvas's parent) */
  into?: HTMLElement;
  /** your class instead of aslnut's small default style */
  className?: string;
  /** the prop of the layer that holds the scale (default 'color') */
  prop?: string;
}
export interface LegendHandle { el: HTMLElement | null; describe(): Legend; update(): void; remove(): void }

export function legend(w: World | null, o: LegendOptions): LegendHandle {
  const scaleOf = (): Scale<never, unknown> => {
    if (typeof o.for !== 'string') return o.for;
    if (!w) throw new AslnutError('E-DATA-001', 'a legend for a layer id needs the world', { fix: "legend(w, { for: 'crime' })" });
    const v = (w.element(o.for).props as unknown as Record<string, unknown>)[o.prop ?? 'color'];
    if (!isScale(v)) throw new AslnutError('E-DATA-001', `layer '${o.for}' has no scale in '${o.prop ?? 'color'}'`, { where: o.for, fix: 'give it color: scale.quantile(…) (or pass the scale itself)' });
    return v as Scale<never, unknown>;
  };
  // (a field's: its ramp over its domain, its own legend())
  const own = typeof o.for === 'string' && w ? (w.element(o.for) as unknown as { legend?: unknown }) : null;
  const ownLegend = own && typeof own.legend === 'function' ? () => (own.legend as () => Legend)() : null;
  const describe = () => ({ ...(ownLegend ? ownLegend() : scaleOf().legend({ format: o.format })), ...(o.title ? { title: o.title } : {}) } as Legend & { title?: string });
  let el: HTMLElement | null = null, seen = -1, off: (() => void) | null = null;
  const canvas = w?.renderer?.canvas as HTMLCanvasElement | undefined;
  const host = o.into ?? (canvas && 'parentElement' in canvas ? canvas.parentElement : null);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const render = () => {
    if (!el) return;
    const d = describe();
    const rows = d.kind === 'continuous'
      ? `<div style="height:10px;border-radius:3px;background:linear-gradient(90deg,${(d.stops ?? []).join(',')})"></div><div style="display:flex;justify-content:space-between;gap:8px;opacity:.85">${d.items.map((i) => `<span>${esc(i.label)}</span>`).join('')}</div>`
      : d.items.map((i) => `<div style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:${i.color ?? '#888'};flex:none"></span><span>${esc(i.label)}</span></div>`).join('')
        + (d.missing ? `<div style="display:flex;align-items:center;gap:6px;opacity:.7"><span style="width:12px;height:12px;border-radius:3px;background:${d.missing};flex:none"></span><span>no data</span></div>` : '');
    el.innerHTML = `${(d as { title?: string }).title ? `<div style="font-weight:600;margin-bottom:4px">${esc((d as { title?: string }).title!)}</div>` : ''}${rows}`;
  };
  if (host && typeof document !== 'undefined') {
    el = document.createElement('div');
    if (o.className) el.className = o.className;
    else if (o.into) Object.assign(el.style, { font: '11px/1.4 system-ui, sans-serif', color: '#e6ebf0', pointerEvents: 'none' });
    else {
      const pos = o.position ?? 'bottom-left', [v, h] = pos.split('-') as ['top' | 'bottom', 'left' | 'right'];
      Object.assign(el.style, { position: 'absolute', [v]: `calc(10px + env(safe-area-inset-${v}, 0px))`, [h]: '10px', zIndex: '10', background: 'rgba(12,16,24,.82)', color: '#e6ebf0', font: '11px/1.4 system-ui, sans-serif', padding: '7px 9px', borderRadius: '8px', border: '1px solid rgba(255,255,255,.12)', minWidth: '120px', maxWidth: '220px', pointerEvents: 'none' });
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    }
    el.className ||= 'aslnut-legend';
    host.appendChild(el);
    render();
    if (w && !ownLegend) off = w.on('frame', () => { try { const v = scaleOf().version; if (v !== seen) { seen = v; render(); } } catch { /* layer removed */ } });
  }
  return { el, describe, update: render, remove: () => { off?.(); el?.remove(); el = null; } };
}

/** labels that read over anything and make room for each other: text with a halo, collisions on, data order or
 *  your priority */
export { stats, Stats, areaKm2 } from './stats.ts';
export { layers } from './layers.ts';
export { cards, Cards } from './cards.ts';
export type { CardsProps, CardRow, CardLook } from './cards.ts';
export type { LayersOptions, LayersHandle, LayerItem, LayerList, LayerPart } from './layers.ts';
export type { StatsOptions, StatRow } from './stats.ts';
