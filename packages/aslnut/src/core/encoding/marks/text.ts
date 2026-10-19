// core › encoding › marks › text: labels over places (a point, a line's middle, a place well inside an area), facing
// the screen, sized in CSS px, with a halo so they read over any imagery. Decided once, never by the view: each
// feature's anchor, text and priority are worked out when its data comes (not as the view moves), and labels make
// room for each other in one fixed order (higher `priority` first, then the feature's id), decided from scratch each
// frame (what shows is a function of the screen alone: the same on every device). Collision has hysteresis in time: a
// change shows at once, and a label that just changed keeps its new state for 0.25 s before it may change again, so
// two names never trade places frame after frame, and nothing is left to change once the orbit stops. A label
// that stayed never fades in again (one that left the screen and comes back is still shown); one that does not fit
// fades out rather than overlapping. Modes: type (letter by letter), count (numbers count up), mask (a soft wipe) and
// fade. Hover, tooltip, tap as every mark.
//   text({ id: 'names', data: suburbs, text: d => d.props.name, size: 12, priority: d => d.props.pop })
//   text({ id: 'totals', data: rows, text: d => d.props.count.toLocaleString(), reveal: 'count' })
import { anchorOf, pointsOf, type Feature } from '../../data/features.ts';
import { AslnutError } from '../../world/errors.ts';
import type { AttachContext, FrameContext } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import type { DrawCall, GBuffer, GTexture } from '../../render/graphics/interface.ts';
import { HOOK_POINTS, assemble, type ShaderCode } from '../../render/graphics/shaders/hooks.ts';
import { TEXT_GLSL } from '../../render/graphics/shaders/text.glsl.ts';
import { TEXT_WGSL } from '../../render/graphics/shaders/text.wgsl.ts';
import { lonLatOf, worldOf, type LonLatH } from '../../space/geo.ts';
import { hex, rgba, type Color } from '../../render/style/color.ts';
import { FeatureMark, Prog, type Entry, type FeatureMarkProps, type PerFeature, type Styled } from './features.ts';
import { sizePxAt, sizeUnits, sizeValue, type SizeOf, type SizeUnits } from '../../render/drawing/size.ts';

export type Anchor = 'center' | 'top' | 'bottom' | 'left' | 'right';
export interface TextProps<D> extends FeatureMarkProps<D> {
  text: (d: D, s: State) => string | number | null | undefined;
  /** hidden by buildings (extrusions) and hills in front of it; false: always on top. The same as drape 'ground' /
   *  'above' (an older name; `drape` wins when both are set; unset, labels float: DRAPE_DEFAULTS) */
  occlude?: boolean;
  /** CSS px (default 12); or `{ m, min, max }`: metres where it is seen, kept within a range of CSS px (core › render ›
   *  drawing › size). Each label's picture is drawn at the size it is shown: in steps of an eighth of an octave, changed
   *  only past the step's edge by a margin (a slow zoom draws a label again a few times, never one frame after another) */
  size?: SizeOf<PerFeature<number, D>>;
  color?: PerFeature<Color, D>;
  /** the outline that keeps it readable: px and colour (default 2, '#000000b0'); 0 = none */
  halo?: number | { width?: number; color?: Color };
  /** a CSS font family and weight (default system-ui, 600) */
  font?: { family?: string; weight?: string | number };
  /** where the label sits from its place, and a nudge in px */
  anchor?: Anchor; offset?: [number, number];
  /** higher first when labels compete for room (default: all equal; equals keep the room they have, then by key) */
  priority?: (d: D) => number;
  /** make room: true (default) with every label mark's labels (one labelling for the stack, the top layer's first),
   *  'own' with its own labels only (markers drawn as text over names), false never */
  collide?: boolean | 'own';
  /** where (default the feature's point or middle) */
  at?: (d: D) => LonLatH;
}
const STRIDE = 16, PAD = 2;
/** a label in metres keeps its step until the size it wants is this share of a step past the step's edge */
const STEP_MARGIN = 0.2;
const val = <T, D>(v: PerFeature<T, D> | undefined, d: D, s: State, def: T): T => (v === undefined ? def : typeof v === 'function' ? (v as (d: D, s: State) => T)(d, s) : v);

/** labels drawn once into one texture, packed in shelves; when full it grows (to 4096), its pictures kept where they
 *  are; only past that does it start over (pictures not used for a while gone first is not done: a start over). Other
 *  marks draw their text pictures into one too (kits › dashboard › markers: a card's header and labels) */
export class Atlas {
  size = 1024; canvas: OffscreenCanvas; g: OffscreenCanvasRenderingContext2D;
  /** bumped when it grows (the texture made again, written whole) */
  grown = 0;
  private map = new Map<string, { x: number; y: number; w: number; h: number; used: number }>();
  private shelves: { y: number; h: number; x: number }[] = []; private top = 0;
  dirty: [number, number] | null = null; clock = 0; full = false;
  /** bumped when the atlas starts over (pictures kept elsewhere are gone) */
  gen = 0;
  constructor() { this.canvas = new OffscreenCanvas(this.size, this.size); this.g = this.canvas.getContext('2d', { willReadFrequently: true })!; }
  get(key: string, w: number, h: number, draw: (g: OffscreenCanvasRenderingContext2D, x: number, y: number) => void) {
    const hit = this.map.get(key); if (hit) { hit.used = this.clock; return hit; }
    w = Math.min(this.size, Math.ceil(w)); h = Math.min(this.size, Math.ceil(h));
    let sh = this.shelves.find((s) => s.h >= h && s.h <= h * 1.4 && s.x + w <= this.size);
    if (!sh) {
      if (this.top + h > this.size) { if (this.size < 4096) this.grow(); else { this.reset(); this.full = true; } }
      sh = { y: this.top, h, x: 0 }; this.shelves.push(sh); this.top += h;
    }
    const r = { x: sh.x, y: sh.y, w, h, used: this.clock }; sh.x += w;
    this.g.clearRect(r.x, r.y, w, h); draw(this.g, r.x, r.y);
    this.map.set(key, r);
    this.dirty = this.dirty ? [Math.min(this.dirty[0], r.y), Math.max(this.dirty[1], r.y + h)] : [r.y, r.y + h];
    return r;
  }
  reset(): void { this.gen++; this.map.clear(); this.shelves = []; this.top = 0; this.g.clearRect(0, 0, this.size, this.size); this.dirty = [0, this.size]; }
  /** twice as big, the pictures kept where they are (their places in pixels; the texture is made again) */
  private grow(): void {
    const old = this.canvas, n = this.size * 2, c = new OffscreenCanvas(n, n), g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(old, 0, 0);
    this.canvas = c; this.g = g; this.size = n; this.grown++; this.dirty = [0, n];
  }
}

export class Text<D = Feature> extends FeatureMark<D, TextProps<D>> {
  readonly kind = 'label' as const;
  protected readonly mark = 'text';
  protected override drapeMark(): 'label' { return 'label'; }
  protected override legacySits(): 'above' | 'ground' | undefined { return this.props.occlude === undefined ? undefined : this.props.occlude ? 'ground' : 'above'; }
  /** labels read their features on the CPU: no features texture on the chip */
  protected override featureTexture = false;
  private inst: GBuffer | null = null; private tbuf: GBuffer | null = null; private tex: GTexture | null = null; private atlas: Atlas | null = null;
  private data = new Float32Array(0); private cap = 0; private count = 0; private T = new Float32Array(8);
  /** each label decided once (when its data comes): its anchor [lon, lat, h?], its slot, key, priority and text, in
   *  the one order labels make room in (priority, then id) */
  private places: { lon: number; lat: number; h: number | undefined; i: number; key: string; prio: number; text: string }[] = [];
  /** seconds a label keeps a new decision (shown or not) before it may change again (world time) */
  static hold = 0.25;
  /** each label's fade, by its feature's key (a source handing its features over in a new order keeps them) */
  private fade = new Map<string, number>();
  private last = 0;
  constructor(p: TextProps<D>) {
    super(p);
    if (typeof p.text !== 'function') throw new AslnutError('E-DATA-001', `text '${this.id}' needs text: d => string`, { where: this.id, fix: 'text({ data, text: d => d.props.name })' });
  }
  protected programs(code: ShaderCode): Prog[] {
    const src = assemble({ wgsl: TEXT_WGSL, glsl: TEXT_GLSL }, HOOK_POINTS.text, code, this.paramBlock!, `layer '${this.id}'`);
    return [new Prog(this.g!, {
      label: `text ${this.id}`, wgsl: src.wgsl, glsl: src.glsl, blocks: ['Frame', 'T', 'Params'], textures: [{ name: 'atlas', kind: '2d', sample: 'float' }],
      instance: { stride: STRIDE, attributes: [{ name: 'at', location: 0, size: 4, offset: 0 }, { name: 'box', location: 1, size: 4, offset: 4 }, { name: 'uvr', location: 2, size: 4, offset: 8 }, { name: 'extra', location: 3, size: 4, offset: 12 }] },
      // a label is tested against the depth of what stands in front of it (extrusions, hills), pulled towards the eye
      // by the depth bias so the ground it stands on never hides it; occlude: false keeps it on top of everything
      blend: 'alpha', depth: { write: false, test: this.sits === 'above' ? 'always' : 'less' },
    })];
  }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    if (!ctx.graphics) return;
    this.tbuf = ctx.graphics.buffer('uniform', 8 * 4, `${this.id} text`);
    // (its atlas, 4 MB on the chip, is made the first time a label is drawn: names never shown cost nothing)
  }
  protected styleProps(): unknown[] { return [this.props.color, sizeValue(this.props.size)]; }
  protected style(e: Entry<D>, s: State): Styled { return { color: rgba(val(this.props.color, e.d, s, '#ffffff' as Color)), number: val(sizeValue(this.props.size), e.d, s, 12), value: 0 }; }
  /** a label in metres: the step it is drawn at now (its size 2^(step / 8) CSS px) */
  private steps = new Map<string, number>();
  /** pictures drawn again for a new step (the measures read it) */
  restepped = 0;
  /** the CSS px a label is drawn at: as styled, or (metres) its step, kept until the size it wants is past the step's
   *  edge by a fifth of a step (the gates' margin: core › observation › gates) */
  private shownPx(key: string, v: number, u: SizeUnits, dist: number, mpp: number): number {
    if (u[0] < 0.5) return Math.min(u[2], Math.max(u[1], v));
    const want = 8 * Math.log2(Math.max(0.5, sizePxAt(v, u, dist, mpp))), was = this.steps.get(key);
    let k = was ?? Math.round(want);
    if (was !== undefined && Math.abs(want - was) > 0.5 + STEP_MARGIN) { k = Math.round(want); this.restepped++; }
    this.steps.set(key, k);
    return Math.min(u[2], Math.max(u[1], 2 ** (k / 8)));
  }
  /** new values (a join's rows came): the texts and priorities decided again, the anchors kept */
  protected override valuesChanged(): void { if (this.places.length || this.entries.length) this.build(); }
  /** each shape's anchor, worked out once */
  private anchors = new WeakMap<object, [number, number, number | undefined] | null>();
  protected build(): void {
    this.places = []; this.colors.clear(); this.hidden.clear(); this.steps.clear();
    const at = this.props.at, pr = this.props.priority, s0 = this.attached ? (this.attached.world as unknown as { state?: State }).state : undefined;
    for (const e of this.entries) {
      let lon: number, lat: number, h: number | undefined;
      if (at) { const p = at(e.d); lon = p[0]; lat = p[1]; h = p[2]; }
      else {
        const g = e.geometry; let a = g ? this.anchors.get(g) : undefined;
        if (a === undefined) { const pts = pointsOf(g), c = pts[0] ?? anchorOf(g); a = c ? [c[0], c[1], c[2]] : null; if (g) this.anchors.set(g, a); }
        if (!a) continue; lon = a[0]; lat = a[1]; h = a[2];
      }
      const v = s0 ? this.props.text(e.d, s0) : this.props.text(e.d, undefined as never);
      this.places.push({ lon, lat, h, i: e.index, key: e.key, prio: pr ? Number(pr(e.d)) || 0 : 0, text: v === null || v === undefined ? '' : String(v) });
    }
    // one order, decided once: priority, then the feature's id (never the order a source handed them in)
    this.places.sort((a, b) => b.prio - a.prio || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    this.boxes();
  }
  protected ground(): void {}
  /** a label's picture, remembered (no font set, no text measured again per frame); at most a dozen new ones drawn
   *  into the atlas a frame (a hundred names shown at once never make a long frame: the rest come next frames) */
  private pics = new Map<string, { r: { x: number; y: number; w: number; h: number }; w: number; h: number; tw: number; gen: number }>(); private picsNew = 0; private picsFrame = -1;
  private pictureOf(text: string, color: string, size: number, dpr: number, now: number) {
    if (this.picsFrame !== now) { this.picsFrame = now; this.picsNew = 0; }
    const key = `${text}|${color}|${size.toFixed(2)}|${dpr}`, hit = this.pics.get(key);
    if (hit && hit.gen === this.atlas!.gen) return hit;
    if (this.picsNew >= 12) return null;
    this.picsNew++;
    const p = this.picture(text, color, size, dpr), v = { ...p, gen: this.atlas!.gen };
    if (this.pics.size > 4000) this.pics.clear();
    this.pics.set(key, v); return v;
  }
  /** a label's picture in the atlas (text, colour, size, halo, at the device's pixel ratio) */
  private picture(text: string, color: string, size: number, dpr: number) {
    const p = this.props, halo = typeof p.halo === 'number' ? { width: p.halo } : p.halo ?? {}, hw = halo.width ?? 2, hc = hex(rgba(halo.color ?? '#000000b0'));
    const font = `${p.font?.weight ?? 600} ${Math.round(size * dpr)}px ${p.font?.family ?? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'}`;
    const a = this.atlas!, g = a.g;
    g.font = font;
    const lines = text.split('\n'), lh = Math.round(size * dpr * 1.25);
    const tw = Math.max(...lines.map((l) => g.measureText(l).width));
    const w = tw + 2 * (hw * dpr + PAD), h = lh * lines.length + 2 * (hw * dpr + PAD);
    const r = a.get(`${font}|${color}|${hw}|${hc}|${text}`, w, h, (gg, x, y) => {
      gg.font = font; gg.textBaseline = 'middle'; gg.textAlign = 'center'; gg.lineJoin = 'round';
      lines.forEach((l, k) => {
        const cx = x + w / 2, cy = y + hw * dpr + PAD + lh * (k + 0.5);
        if (hw > 0) { gg.strokeStyle = hc; gg.lineWidth = hw * 2 * dpr; gg.strokeText(l, cx, cy); }
        gg.fillStyle = color; gg.fillText(l, cx, cy);
      });
    });
    return { r, w: r.w / dpr, h: r.h / dpr, tw: tw / dpr };
  }
  protected draws(ctx: FrameContext): DrawCall[] {
    const g = ctx.graphics, cam = ctx.camera, ex = ctx.world.exaggeration, p = this.props, s = ctx.s;
    if (!this.tbuf || !this.places.length) return [];
    this.atlas ??= new Atlas();
    if (!this.tex || this.texSize !== this.atlas.size) { this.tex?.destroy(); this.texSize = this.atlas.size; this.tex = g.texture({ label: `${this.id} atlas`, width: this.atlas.size, height: this.atlas.size, format: 'rgba8', filter: 'linear' }); this.atlas.dirty = [0, this.atlas.size]; }
    const n = this.places.length, dpr = g.width / Math.max(1, cam.width), F = this.featData, mode = this.plan?.mode ?? 0;
    if (!this.inst || this.cap < n) { this.inst?.destroy(); this.cap = Math.max(64, n * 2); this.inst = g.buffer('instance', this.cap * STRIDE * 4, `${this.id} labels`); this.data = new Float32Array(this.cap * STRIDE); }
    const dt = Math.min(0.25, (ctx.now - this.last) / 1000); this.last = ctx.now;
    this.atlas.clock++;
    // the labels in their one order (decided when the data came): each placed where it fits now; a change shows at
    // once, then holds (hysteresis in time); a label off the screen keeps how shown it was (back on screen, it never
    // fades in again)
    const placed: [number, number, number, number][] = p.collide === 'own' ? [] : ctx.labelRoom ?? [], collide = p.collide !== false, anchor = p.anchor ?? 'center', off = p.offset ?? [0, 0];
    let k = 0; this.placedNow.clear(); this.waiting = 0; this.held = 0;
    // its size's rule (metres: each label's px where it is seen, in steps)
    const U = sizeUnits(p.size, `text '${this.id}' size`), E = cam.eye, mpp1 = (2 * Math.tan(cam.fov / 2)) / Math.max(1, cam.height);
    const f = this.data, fontOf = (size: number) => `${p.font?.weight ?? 600} ${Math.round(size * dpr)}px ${p.font?.family ?? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'}`;
    for (const c of this.places) {
      const i = c.i, st = this.at(i, 2), fw = F[st + 3]!, pr = F[st + 2]!;
      if (fw <= 0 || pr <= 0) { this.fade.delete(c.key); this.state.delete(c.key); this.changedAt.delete(c.key); continue; }      // its own gate (feature.when, filter) or not revealed
      if (!cam.facing(c.lon, c.lat)) { this.settleFade(c.key); continue; }
      const gnd = c.h !== undefined ? c.h : (p.on ?? 'ground') === 'ground' ? ctx.world.heightAt(c.lon, c.lat) : 0, h = (Number.isNaN(gnd) ? 0 : gnd) * ex + (p.lift ?? 0);
      const P = worldOf(cam, c.lon, c.lat, h), xy = cam.projectWorld(P[0], P[1], P[2]);
      if (!xy || xy[0] < -200 || xy[1] < -100 || xy[0] > cam.width + 200 || xy[1] > cam.height + 100) { this.settleFade(c.key); continue; }
      // hidden by a hill (a true occlusion: room-making only; the depth test hides it on screen anyway)
      if (ex > 0 && this.sits !== 'above' && this.occluded(ctx, i, P)) { this.fadeTo(c.key, false, dt); continue; }
      // the text: decided once (counting numbers aside: the count reveal)
      let tx = c.text;
      if (tx === '') continue;
      if (mode === 12 && pr < 1) { const m = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/.exec(tx); if (m) { const num = Number(m[2]!.replace(/,/g, '')), dec = (m[2]!.split('.')[1] ?? '').length; tx = `${m[1]}${(num * pr).toLocaleString('en', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${m[3]}`; } }
      // its colour and size as styled (the colour it ends at: a picture per colour, never one per frame of an ease)
      if (this.colorsGen !== this.lookGen) { this.colors.clear(); this.colorsGen = this.lookGen; }
      const c0 = this.at(i, 0), nn = this.at(i, 3);
      let color = this.colors.get(i);
      if (color === undefined) { const q4 = this.q4; for (let q = 0; q < 4; q++) q4[q] = F[c0 + q]!; color = hex(q4); this.colors.set(i, color); }
      const size = this.shownPx(c.key, F[nn]!, U, Math.hypot(P[0] - E[0]!, P[1] - E[1]!, P[2] - E[2]!), mpp1);
      // its box, measured once from the font (the same box whether its picture is drawn yet or not: its room never
      // changes with the atlas); its picture asked for only once it is placed
      const mk = `${tx}|${size.toFixed(2)}|${dpr}`;
      let box = this.measured.get(mk);
      if (!box) { const a = this.atlas.g; a.font = fontOf(size); const hw = (typeof p.halo === 'number' ? p.halo : p.halo?.width ?? 2) + PAD; box = { w: Math.max(...tx.split('\n').map((l) => a.measureText(l).width)) / dpr + 2 * hw, h: size * 1.25 * tx.split('\n').length + 2 * hw }; if (this.measured.size > 8000) this.measured.clear(); this.measured.set(mk, box); }
      const w = box.w, hh = box.h;
      const ox = off[0] + (anchor === 'left' ? w / 2 : anchor === 'right' ? -w / 2 : 0), oy = off[1] + (anchor === 'top' ? hh / 2 : anchor === 'bottom' ? -hh / 2 : 0);
      // where it would go now, decided from scratch in the one order (a pure function of what is on the screen: the
      // same on every device, whatever came first); a change shows at once and then holds for 0.25 s (hysteresis in
      // time: two names never trade places frame after frame; when the orbit stops, nothing is left waiting to change)
      const cx = xy[0] + ox, cy = xy[1] + oy, bw = (w - 6) / 2, bh = (hh - 4) / 2;
      const x0 = cx - bw, y0 = cy - bh, x1 = cx + bw, y1 = cy + bh;
      const want = !collide || !placed.some((b) => x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]);
      if (want) placed.push([x0, y0, x1, y1]);
      const on = this.decide(c.key, want, ctx.now);
      const now = this.fadeTo(c.key, on, dt);
      if (now <= 0) continue;
      const pic = this.pictureOf(tx, color, size, dpr, ctx.now);
      if (!pic) { this.waiting++; continue; }   // drawn next frame (a dozen new pictures a frame); its room is held meanwhile
      const a = this.atlas, r = pic.r, S = a.size;
      let rv = pr;
      if (mode === 11 && pr < 1) { const chars = [...tx].length, nShown = Math.floor(pr * chars); a.g.font = fontOf(size); const part = a.g.measureText([...tx].slice(0, nShown).join('')).width / dpr; rv = (pic.w - pic.tw) / 2 / pic.w + part / pic.w; if (nShown === 0) rv = 0; }
      const o = k * STRIDE;
      f[o] = P[0]; f[o + 1] = P[1]; f[o + 2] = P[2]; f[o + 3] = 0; f[o + 4] = pic.w; f[o + 5] = pic.h; f[o + 6] = ox; f[o + 7] = oy;
      f[o + 8] = r.x / S; f[o + 9] = r.y / S; f[o + 10] = (r.x + r.w) / S; f[o + 11] = (r.y + r.h) / S; f[o + 12] = now * fw * (p.opacity ?? 1); f[o + 13] = rv; f[o + 14] = i; f[o + 15] = F[st]! + 2 * F[st + 1]!;
      k++;
    }
    this.count = k;
    // (a hold over: forgotten)
    for (const [key, t] of this.changedAt) if (ctx.now - t >= Text.hold * 1000) this.changedAt.delete(key);
    if (this.atlas.dirty) {
      const [y0, y1] = this.atlas.dirty, img = this.atlas.g.getImageData(0, y0, this.atlas.size, y1 - y0);
      this.tex!.write(img.data, { y: y0, height: y1 - y0 }); this.atlas.dirty = null;
    }
    if (!k) return [];
    this.inst.write(f.subarray(0, k * STRIDE));
    const hv = p.hover === false ? null : p.hover ?? (p.tooltip || p.onHover ? { color: '#ffd166' } : null), hc = rgba(hv?.color ?? '#ffd166');
    this.T.set([p.depthBias !== undefined ? p.depthBias * 1e-5 : 0.0004, this.pickNo, mode, 0, hc[0], hc[1], hc[2], hv ? hv.mix ?? 0.6 : 0]);
    this.tbuf.write(this.T);
    const prog = this.progs[0]!;
    return [{ program: prog.main, blocks: [ctx.frame, this.tbuf, this.pbuf!], textures: [this.tex!], instances: this.inst, count: 6, instanceCount: k, pickProgram: p.pickable === false ? undefined : () => prog.pick() }];
  }
  /** a label off the screen mid-fade ends its fade where it was going (shown or not): it waits there, settled, and
   *  back on the screen it never fades in again */
  private settleFade(key: string): void {
    const v = this.fade.get(key); if (v === undefined || v <= 0 || v >= 1) return;
    if (this.rising.get(key)) this.fade.set(key, 1); else { this.fade.set(key, 0); this.turns++; }
  }
  private rising = new Map<string, boolean>(); private placedNow = new Set<string>();
  /** each label's decision (shown or not), and when it last changed (ms; for its hold) */
  private state = new Map<string, boolean>(); private changedAt = new Map<string, number>();
  /** labels this frame whose change waits for its hold to end */
  private held = 0;
  /** shown or not: the first decision and a change at once; a label that changed less than its hold ago keeps it */
  private decide(key: string, want: boolean, now: number): boolean {
    const was = this.state.get(key);
    if (was === undefined) { this.state.set(key, want); return want; }
    if (want === was) return was;
    const t = this.changedAt.get(key);
    if (t !== undefined && now - t < Text.hold * 1000) { this.held++; return was; }
    this.state.set(key, want); this.changedAt.set(key, now); return want;
  }
  /** labels placed whose pictures are not drawn yet (a capture waits for them) */
  private waiting = 0;
  /** a label's fade towards shown or hidden (0.2 s); a change in how it is shown counted (the measures read it) */
  private fadeTo(key: string, on: boolean, dt: number): number {
    this.rising.set(key, on); this.placedNow.add(key);
    const was = this.fade.get(key) ?? 0, now = Math.max(0, Math.min(1, was + ((on ? 1 : -1) * dt) / 0.2));
    if ((was > 0) !== (now > 0)) this.turns++;
    // (a label faded out keeps its 0: it was decided, and lost its room; one its gate hides is forgotten)
    this.fade.set(key, now);
    return now;
  }
  /** labels shown or hidden since the start (a label changing places frame after frame shows here) */
  turns = 0;
  /** each text's box (CSS px) measured once */
  private measured = new Map<string, { w: number; h: number }>();
  private colorsGen = -1;
  /** its text, priority or anchor changed: decided again, once */
  override setProps(p: Partial<TextProps<D>>): this { super.setProps(p); if (('text' in p || 'priority' in p || 'at' in p) && this.entries.length) { this.build(); this.attached?.world && (this.attached.world as { invalidate?: () => void }).invalidate?.(); } return this; }
  private texSize = 0;
  private colors = new Map<number, string>(); private q4: [number, number, number, number] = [0, 0, 0, 0];
  private hidden = new Map<number, boolean>(); private occlusionTurn = 0; private occlusionFrame = -1;
  /** behind a hill: cached per label, a few asked again per frame while the camera moves (a ray march each) */
  private occluded(ctx: FrameContext, i: number, P: [number, number, number]): boolean {
    if (this.occlusionFrame !== ctx.now) { this.occlusionFrame = ctx.now; this.occlusionTurn = 0; }
    const was = this.hidden.get(i);
    // a label not asked yet waits for its turn too (hidden meanwhile: it fades in once known)
    if (was === undefined && this.occlusionTurn >= 24) return true;
    if (was === undefined || (this.occlusionTurn < 24 && (ctx.camera.moving || (i + Math.floor(ctx.now / 100)) % 8 === 0))) {
      this.occlusionTurn++;
      const b = this.behindGround(ctx, P); this.hidden.set(i, b); return b;
    }
    return was;
  }
  /** the ground rises between this place and the eye (a few samples along the line) */
  private behindGround(ctx: FrameContext, P: [number, number, number]): boolean {
    const cam = ctx.camera, E = cam.eye, ex = ctx.world.exaggeration;
    if (cam.morph < 0.5) return false;
    for (let k = 1; k < 12; k++) {
      const t = k / 12, x = P[0] + (E[0]! - P[0]) * t, y = P[1] + (E[1]! - P[1]) * t, z = P[2] + (E[2]! - P[2]) * t;
      const ll = lonLatOf(cam, x, y, z), g = ctx.world.heightAt(ll[0], ll[1]);
      if (!Number.isNaN(g) && g * ex > y + 5) return true;
    }
    return false;
  }
  override status() {
    const st = super.status();
    if ([...this.fade.values()].some((v) => v > 0 && v < 1)) { st.pending.push('labels making room'); st.ready = false; }
    if (this.waiting > 0) { st.pending.push(`${this.waiting} labels' pictures being drawn`); st.ready = false; }
    if (this.held > 0) { st.pending.push(`${this.held} labels holding a change (0.25 s)`); st.ready = false; }
    return st;
  }
  protected freeGeometry(): void { for (const r of [this.inst, this.tbuf, this.tex]) r?.destroy(); this.inst = this.tbuf = null; this.tex = null; this.atlas = null; this.cap = 0; }
  override readouts() { return { count: () => this.size, shown: () => this.count, turns: () => this.turns, restepped: () => this.restepped }; }
}
export const text = <D = Feature>(p: TextProps<D>) => new Text<D>(p);
