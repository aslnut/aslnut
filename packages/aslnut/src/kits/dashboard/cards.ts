// kits › dashboard › markers: a small data card on each thing or feature, still or moving. Its parts are each bound to a
// channel (core › data › history › channels: a constant, each item's own, a value a log carries, a relation's count,
// your formula): a header (an icon from the app's atlas, a text), rows (a label, a value, '3/4' with its `of`, a bar),
// a fill (the card's colour from a value through any scale) and a badge (a number at its corner while its gate holds);
// a row may show a text of its item's instead of a value (`text: d => …`).
// The values are derived when the data comes (again as it changes: only the items whose data changed, at most twice a
// second of the world's clock) and read on the chip at the world's time: playing writes nothing, a scrub is the
// clock's one write. A card on a set's thing follows it by reference (its track, on the chip); a card on features
// stands at each one's place. Its width keeps the one size rule (CSS px, or metres within a range of CSS px); `fit`:
// each card as wide as what it holds, within shares of that.
// Collision (default on, as labels): the cards shown keep their room first, then the higher priority; a shown card
// loses its room only once more than a third of it is covered for 0.6 s, and one that lost it comes back 1.5 s after
// at the soonest, faded 0.35 s; decided on the chip, each decision kept by its item's id when the items change. Under
// the governor cards step down: rows, then the header, then a dot.
//   cards({ id: 'sites', of: 'stations', log: ports, icons: pics,
//     header: { icon: 'station', text: d => d.props.name },
//     rows: [{ label: 'in use', value: { value: 'busy', key: d => portsOf(d) }, of: d => d.props.ports, bar: true },
//            { label: 'kW', value: { formula: (v, d) => v.r0 * d.props.power } }],
//     fill: { value: 'net', color: scale.linear(v => v, { domain: [-100, 100], range: 'rdbu' }) },
//     badge: { value: plugged.count, when: v => v > 0 }, size: { px: 120 } })
import { AslnutError } from '../../core/world/errors.ts';
import { Element, type AttachContext, type ElementProps, type ElementStatus, type FrameContext, type Picked } from '../../core/world/element.ts';
import type { State } from '../../core/world/state.ts';
import type { DrawCall, GBuffer, GTarget, GTexture, Graphics, Program, ProgramDesc } from '../../core/render/graphics/interface.ts';
import { Log } from '../../core/data/history.ts';
import { Deriver, isColumn, isCount, isFormula, isMembers, logsOf, type Channel } from '../../core/data/channels.ts';
import { Placement, type PlacedOn, type PlacementOptions } from '../../core/entities/placement.ts';
import { SET_TEXTURES, type SetsVariant } from '../../core/render/graphics/shaders/sets.wgsl.ts';
import { IconAtlas } from '../../core/encoding/marks/icon.ts';
import { Atlas } from '../../core/encoding/marks/text.ts';
import { rgba, type Color } from '../../core/render/style/color.ts';
import { sizeUnits, sizeValue, type SizeOf } from '../../core/render/drawing/size.ts';
import { CARD_FILTERED, CARD_FLOATS, CARD_TEXTURES, cardsWGSL } from './cards.wgsl.ts';
import { cardsGLSL } from './cards.glsl.ts';
import type { Leveled } from '../../core/observation/presence.ts';

/** a row: its label, its value (a channel), its `of` ('3/4': a channel), its decimals, a bar under it (filled to the
 *  value over its `of`, or over a domain); or a text of its item's (`text`: your function of it) in its value's place */
export interface CardRow<D> { label: string; value?: Channel<D>; text?: (d: D) => string | number | null | undefined; of?: Channel<D>; decimals?: 0 | 1 | 2; bar?: boolean | { domain: [number, number] } }
/** how cards make room: a shown card loses its room once more than `cover` of it (a share) is covered for `hold` s;
 *  one that lost it comes back once nothing covers it, `away` s after it went at the soonest; each change faded
 *  `fade` s (default 0.35, 0.6, 1.5, 0.35) */
export interface CardsCollide { cover?: number; hold?: number; away?: number; fade?: number }
/** the look (neutral by default: a white card, dark ink) */
export interface CardLook { background?: Color; ink?: Color; inkOnDark?: Color; bar?: Color; badge?: Color; radius?: number; /** a card that lost its room (or stepped down) is a dot (default true) */ dots?: boolean }
export interface CardsProps<D> extends ElementProps, Omit<PlacementOptions<D>, 'heading'> {
  /** what the cards stand on: a set (its things, by its id or itself), a layer or an instance set (its features), a
   *  group's or any source, or an array */
  of: PlacedOn<D>;
  /** the log a value named by a string reads (default the set's own when placed on a set; a group's log) */
  log?: Log;
  /** the app's pictures (the header's icon) */
  icons?: IconAtlas;
  header?: { icon?: string | ((d: D) => string | null | undefined); text?: string | ((d: D) => string | number | null | undefined) };
  /** up to six rows */
  rows?: CardRow<D>[];
  /** the card's colour from a value: your function of it or a scale made of the value itself, over its domain (default
   *  the scale's, else the value's least and most) */
  fill?: { value: Channel<D>; color: (v: number) => Color; domain?: [number, number] };
  /** a number in a disc at its corner, while `when` holds (default: above 0) */
  badge?: { value: Channel<D>; when?: (v: number, d: D) => boolean };
  /** its width: CSS px (default 120), or `{ m, min, max }` metres kept within a range of CSS px */
  size?: SizeOf<number>;
  /** each card as wide as what it holds (its header, its rows' labels and values), within shares of its size (default
   *  0.5 to 2: a short name narrower, a long one wider); default false: each card its size */
  fit?: boolean | { min?: number; max?: number };
  /** make room for each other (default true): the cards shown keep it, then the higher `priority` (then the item's
   *  id); the rest are dots. Its timing: `{ cover, hold, away, fade }` */
  collide?: boolean | CardsCollide;
  priority?: (d: D) => number;
  look?: CardLook;
  tooltip?: (d: D, s: State) => string | null | undefined;
  onTap?: (f: Picked<D>, s: State) => void;
  onHover?: (f: Picked<D> | null, s: State) => void;
  select?: 'tap' | 'toggle' | false;
  pickable?: boolean;
}
/** one room for every card set of a world (as labels make room across the stack): this frame's claims drawn into one
 *  picture set after set, each tested against the ones before (the top set nearest, then each set's own order); every
 *  set decides from the last frame's picture, complete (a frame later: well inside the hold) */
interface Room { pics: GTarget[]; size: string; cur: number; frame: number; prev: number; drawn: boolean; sets: Cards<any>[] }   // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOMS = new WeakMap<object, Room>();
const roomOf = (w: object): Room => { let r = ROOMS.get(w); if (!r) ROOMS.set(w, (r = { pics: [], size: '', cur: 0, frame: -1, prev: -1, drawn: false, sets: [] })); return r; };
/** cards a set may hold in the room's keys (2^18: its cards shown, then the rest), sets in one room (31: in 24 bits) */
const ITEMS = 262144, SETS = 31;
// the layout (CSS px at 120 wide: it scales with the width)
const PAD = 6, HEAD = 18, ROW = 15, POINTER = 6, RADIUS = 5, DOT = 7, HEAD_FONT = 12, LABEL_FONT = 10.5, GLYPHS = '0123456789.-/%+';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
/** the claims' cell, CSS px (a smaller overlap may pass) */
const CELL = 4;
/** the collision's timing (s): a share covered, for how long, the least time away, the fade */
const COVER = 0.35, HOLD = 0.6, AWAY = 1.5, FADE = 0.35;
/** ms of the world's clock between two derivations of a live log's values */
const LIVE = 500;

export class Cards<D = unknown> extends Element<CardsProps<D>> {
  // (over everything, labels too: a card is read, not placed among names)
  readonly kind = 'point' as const;
  private on: Placement<D>; private g: Graphics | null = null;
  private progs: { cards?: Program; claim?: Program; decide?: Program; carry?: Program; pick?: Program } = {}; private descs: { cards?: ProgramDesc } = {}; private progKey = ''; private built = 0; private wanted = 0;
  private ubuf: GBuffer | null = null; private u = new Float32Array(CARD_FLOATS); private quads: GBuffer | null = null; private dots: GBuffer | null = null;
  private tex: Partial<Record<(typeof CARD_TEXTURES)[number], GTexture>> = {}; private dummy: GTexture | null = null;
  /** the cards' columns (core › data › history › channels), their names, made for the items' version */
  cols: Log | null = null; private names: string[] = []; private madeFor = -1; private making = false; private logsSeen = '';
  /** what derives the columns again as the data changes (made again when the parts change) */
  private deriver: Deriver<D> | null = null;
  /** the pictures (the headers, the labels, the text rows): kept from one make to the next, their texture's height */
  private atlas: Atlas | null = null; private pics = new Map<string, { r: { x: number; y: number; w: number; h: number }; w: number; h: number }>(); private atlasH = 0; private atlasGen = -1;
  /** the items' texture as written (texels an item: 3, and 2 a text row) */
  private itemTex = new Float32Array(0); private stride = 3;
  private labels: { rect: [number, number, number, number]; w: number; h: number }[] = [];
  private glyphM: [number, number, number] = [0.6, 0.8, GLYPHS.length];
  private fillDomain: [number, number] = [0, 1]; private barDomains: [number, number][] = [];
  /** collision: its decisions (two kept in turn), which is now (the claims' pictures are the world's room's) */
  private states: { tex: GTexture; target: GTarget }[] = []; private cur = 0; private first = true; private stateRows = 0;
  /** the items its decisions are kept for (by place), a re-make's decisions to carry to their items' new places (and
   *  from a texture of another size: its rows grew or shrank) */
  private stateIds: string[] = []; private carry = false; private carryFrom: { tex: GTexture; target: GTarget }[] | null = null;
  /** the places its decisions are kept in after the next carry: its items', then those of items gone a moment (by id:
   *  until when, of the world's clock): one given again meanwhile keeps its decision (a row that comes and goes) */
  private slotIds: string[] = []; private gone = new Map<string, number>();
  /** of the places kept: how many are its items' (the rest: items gone a moment), now and after the next carry */
  private stateN = 0; private slotN = 0;
  /** decided since it was made (its cards fresh until then) */
  private decided = false;
  /** the world's room it makes room in, the room's frame it last claimed in */
  private room: Room | null = null; private claimedAt = -2;
  /** when the view last moved, when it last changed itself (its props, its pictures, its programs), when its items
   *  last changed (its new cards fade in): its decisions settle after */
  private viewAt = -1e9; private touchedAt = -1e9; private madeAt = -1e9; private viewKey = '';
  /** the governor's step now: 0 whole, 1 its header, 2 a dot */
  private step = 0;
  /** programs that could not be built (their compiler's words) */
  private broken: string[] = [];
  constructor(p: CardsProps<D>) {
    super(p.order === undefined ? { ...p, order: 6.5 } : p);
    if ((p.rows?.length ?? 0) > 6) throw new AslnutError('E-DATA-001', `cards '${this.id}': at most six rows (here ${p.rows!.length})`, { where: this.id, fix: 'six rows, or a second card set' });
    (p.rows ?? []).forEach((r, k) => { if ((r.value === undefined) === (r.text === undefined)) throw new AslnutError('E-DATA-001', `cards '${this.id}': row ${k} ('${r.label}') ${r.value === undefined ? 'shows nothing' : 'has a value and a text'}`, { where: this.id, fix: "{ label, value: 'kw' } (a value) or { label, text: d => d.props.name } (a text of its item's)" }); });
    if (p.header?.icon && !(p.icons instanceof IconAtlas)) throw new AslnutError('E-DATA-001', `cards '${this.id}': a header icon needs the app's pictures`, { where: this.id, fix: "cards({ icons: icons({ station: '/img/station.png' }), header: { icon: 'station' } })" });
    this.on = new Placement<D>(p.of, { at: p.at, lift: p.lift });
  }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    this.g = ctx.graphics;
    this.on.attach(ctx, () => { this.madeFor = -1; this.invalidate(); });
    if (this.g) {
      this.ubuf = this.g.buffer('uniform', CARD_FLOATS * 4, `${this.id} cards`);
      // a card's quad (0–3) and its dot's (4–7: drawn first, under every card)
      this.quads = this.g.buffer('index', Uint32Array.from([0, 1, 2, 2, 1, 3]), `${this.id} quad`); this.dots = this.g.buffer('index', Uint32Array.from([4, 5, 6, 6, 5, 7]), `${this.id} dot`);
      this.dummy = this.g.texture({ label: `${this.id} none`, width: 1, height: 1, format: 'rgba8', filter: 'nearest' }); this.dummy.write(new Uint8Array(4));
    }
    void this.props.icons?.load(ctx.loader).then(() => this.invalidate(true));
    // (the world's room: every card set makes room with the others)
    (this.room = roomOf(ctx.world)).sets.push(this);
  }
  /** a frame asked for; `touched`: it changed itself (its props, its pictures): its decisions settle again */
  private invalidate(touched = false): void { if (touched) this.touchedAt = this.attached?.world.now ?? 0; (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); }
  override setProps(given: Partial<Leveled<CardsProps<D>>>): this { const p = given as Partial<CardsProps<D>>;
    super.setProps(p);
    if ('rows' in p || 'fill' in p || 'badge' in p || 'header' in p || 'log' in p || 'priority' in p || 'fit' in p) { this.madeFor = -1; this.deriver = null; }
    if ('collide' in p || 'header' in p) this.progKey = '';
    this.invalidate(true);
    return this;
  }
  /** the log the named values read */
  private logOf(): Log | null {
    const src = this.on.set ? null : (this.props.of as { log?: unknown });
    return this.props.log ?? this.on.set?.log ?? (src && src.log instanceof Log ? src.log : null);
  }
  /** each part's channel, by the name the cards' columns keep it under */
  private channels(): Record<string, Channel<D>> {
    const p = this.props, out: Record<string, Channel<D>> = {};
    (p.rows ?? []).forEach((r, k) => { if (r.value === undefined) return; out[`r${k}`] = r.value; if (r.of !== undefined) out[`r${k}of`] = r.of; });
    if (p.fill) out.fill = p.fill.value;
    if (p.badge) { out.badge = p.badge.value; const when = p.badge.when ?? ((v: number) => v > 0); out.badgeOn = { formula: (v, d) => (when(v.badge ?? 0, d) ? 1 : 0) }; }
    return out;
  }
  /** the cards' columns, the items' pictures and their textures: made again when the items or the parts change
   *  (`whole`), their values only when a log or a relation they read changed (the columns derived again for the items
   *  whose data changed; the pictures, the widths and the decisions kept) */
  private make(whole = true): void {
    const g = this.g!, chs = this.channels(), log = this.logOf(), logs = logsOf(chs, log, this.on.items);
    for (const c of Object.values(chs)) if (isColumn(c) && !c.log && !log) throw new AslnutError('E-DATA-001', `cards '${this.id}': '${c.value}' is a log's value, and the cards have no log`, { where: this.id, fix: 'cards({ log: history.log({ url }) }) (or give the value its own: { value, log })' });
    // (a log still loading, started here if nothing started it: made once it is in)
    if (logs.some((l) => l.loading)) {
      if (!this.making) { this.making = true; const a = this.attached!; void Promise.all(logs.map((l) => l.start({ loader: a.loader, error: (e) => a.world.error(e) }))).then(() => { this.making = false; this.madeFor = -1; this.invalidate(); }); }
      return;
    }
    const items = this.on.items, ids = this.on.ids;
    if (!this.deriver || this.deriver.names.join() !== Object.keys(chs).join() || (this.deriverLog !== log)) { this.deriver = new Deriver<D>(chs, { log, id: (_d, i) => this.on.ids[i] ?? i }); this.deriverLog = log; whole = true; }
    const cols = this.deriver.derive(items);
    this.logsSeen = this.inputsKey();
    // (its values as they were: nothing to write)
    if (!whole && cols === this.cols) { this.madeFor = this.on.version; return; }
    this.cols = cols; this.names = cols.values.map((v) => v.name);
    // ── the columns: times (a slot a texel), values (Q texels a slot: four channels a texel) ──
    const C = Math.max(1, this.names.length), Q = Math.ceil(C / 4), S = cols.used, rowsT = Math.max(1, Math.ceil(S / 4096)), rowsV = Math.max(1, Math.ceil((S * Q) / 4096));
    const times = new Float32Array(rowsT * 4096), vals = new Float32Array(rowsV * 4096 * 4);
    for (let s = 0; s < S; s++) { times[s] = cols.secAt(s); for (let c = 0; c < this.names.length; c++) vals[s * Q * 4 + c] = (cols.cols[c] as Float32Array)[s]!; }
    this.texture('times', 4096, rowsT, 'r32f', times); this.texture('values', 4096, rowsV, 'rgba32f', vals);
    const range = (name: string): [number, number] => { const k = this.names.indexOf(name); if (k < 0) return [0, 1]; let lo = Infinity, hi = -Infinity; const c = cols.cols[k]!; for (let s = 0; s < S; s++) { const v = c[s]!; if (v < lo) lo = v; if (v > hi) hi = v; } return Number.isFinite(lo) ? [lo, hi > lo ? hi : lo + 1] : [0, 1]; };
    const rowsP = this.props.rows ?? [], N = items.length;
    if (!this.tex.glyphs) this.glyphs(g);
    if (whole) this.pictures(items, ids, range);
    else {
      // (the values only: each item's first sample and samples again, in the items' texture as it is)
      const it = this.itemTex, st = this.stride;
      for (let i = 0; i < N; i++) { const o = i * st * 4, ci = cols.indexOf(ids[i] ?? i); it[o] = ci >= 0 ? cols.first[ci]! : 0; it[o + 1] = ci >= 0 ? cols.count[ci]! : 0; }
      this.texture('items', 4096, Math.max(1, Math.ceil((st * N) / 4096)), 'rgba32f', it);
    }
    // ── the fill's ramp and domain, each bar's domain ──
    const f = this.props.fill;
    if (f) {
      const br = (f.color as { breaks?: readonly unknown[] }).breaks, sd = Array.isArray(br) && br.length === 2 && br.every((x) => typeof x === 'number') ? br as [number, number] : null;
      const dom = f.domain ?? sd ?? range('fill');
      if (whole || !this.tex.fills || dom[0] !== this.fillDomain[0] || dom[1] !== this.fillDomain[1]) {
        this.fillDomain = dom;
        const px = new Uint8Array(256 * 4), [lo, hi] = dom;
        for (let i = 0; i < 256; i++) { const q = rgba(f.color(lo + ((hi - lo) * i) / 255)); px.set([q[0], q[1], q[2], q[3]].map((x) => Math.round(x * 255)), i * 4); }
        this.texture('fills', 256, 1, 'rgba8', px);
      }
    }
    this.barDomains = rowsP.map((r, k) => (typeof r.bar === 'object' ? r.bar.domain : [0, range(`r${k}`)[1]]));
    this.madeFor = this.on.version;
    // (made again: its new cards decided from the next claims, those it had keep their decisions)
    if (whole) { this.claimedAt = -2; this.decided = false; this.madeAt = this.attached?.world.now ?? 0; }
    (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.();
  }
  private deriverLog: Log | null = null;
  /** the items' pictures (their header, their text rows), each row's label, each item's width (`fit`), and the items'
   *  texture: its first sample, samples, icon, rank · its header's picture · its size, its old place (its decision's),
   *  its width · each text row's picture and size */
  private pictures(items: readonly D[], ids: readonly string[], range: (name: string) => [number, number]): void {
    const cols = this.cols!, R = Math.max(2, Math.min(3, typeof devicePixelRatio === 'number' ? devicePixelRatio : 2));
    const rowsP = this.props.rows ?? [], texts = rowsP.map((r, k) => (r.text !== undefined ? k : -1)).filter((k) => k >= 0), N = items.length;
    const fit = this.props.fit, fo = typeof fit === 'object' ? fit : {}, wLo = fit ? 120 * (fo.min ?? 0.5) : 120, wHi = fit ? 120 * Math.max(fo.min ?? 0.5, fo.max ?? 2) : 120;
    const icon = !!this.props.header?.icon, iconW = icon ? HEAD - 2 + 4 : 0, roomW = wHi - 2 * PAD - iconW;
    // (the pictures kept from the last make: a picture made once; the atlas started over when it holds mostly old ones)
    const want = N * (1 + texts.length) + rowsP.length;
    if (!this.atlas || this.pics.size > 2 * want + 256) { this.atlas = new Atlas(); this.pics.clear(); }
    const atlas = this.atlas, pics = this.pics;
    if (this.atlasGen !== atlas.gen) { pics.clear(); this.atlasGen = atlas.gen; }
    const picture = (text: string, size: number, weight: number, maxW: number) => {
      const key = `${text}|${size}|${weight}|${maxW}`, had = pics.get(key); if (had) return had;
      const font = `${weight} ${Math.round(size * R)}px ${FONT}`, x = atlas.g; x.font = font;
      // (too long: cut, with an ellipsis)
      let t = text; if (x.measureText(t).width / R > maxW) { while (t.length > 1 && x.measureText(`${t}…`).width / R > maxW) t = t.slice(0, -1); t = `${t}…`; }
      const w = Math.ceil(x.measureText(t).width) + 2, h = Math.ceil(size * R * 1.3);
      const r = atlas.get(key, w, h, (gg, px, py) => { gg.font = font; gg.textBaseline = 'middle'; gg.fillStyle = '#ffffff'; gg.fillText(t, px + 1, py + h / 2); });
      const v = { r, w: w / R, h: h / R }; pics.set(key, v); return v;
    };
    const ht = this.props.header?.text;
    const make = () => {
      const labels = rowsP.map((r) => picture(r.label, LABEL_FONT, 500, fit ? Math.max(70, roomW * 0.6) : 70));
      const heads = items.map((d) => { const v = typeof ht === 'function' ? ht(d) : ht; return v === null || v === undefined || v === '' ? null : picture(String(v), HEAD_FONT, 650, roomW); });
      const rowTexts = texts.map((k) => { const r = rowsP[k]!, room = Math.max(12, wHi - 2 * PAD - labels[k]!.w - 6); return items.map((d) => { const v = r.text!(d); return v === null || v === undefined || v === '' ? null : picture(String(v), LABEL_FONT, 650, room); }); });
      return { labels, heads, rowTexts };
    };
    const gen = atlas.gen; let made = make();
    // (the atlas full meanwhile, started over: every picture made again in it)
    if (atlas.gen !== gen) { pics.clear(); this.atlasGen = atlas.gen; made = make(); }
    const { labels, heads, rowTexts } = made;
    // (the texture only as tall as its pictures: a few hundred names are a few megabytes, not the atlas's whole square)
    const A = atlas.size, TH = Math.max(1, Math.min(A, Math.ceil(Math.max(1, ...[...pics.values()].map((p) => p.r.y + p.r.h)))));
    if (atlas.dirty || TH !== this.atlasH || !this.tex.texts || this.tex.texts.desc.width !== A) {
      const img = atlas.g.getImageData(0, 0, A, TH); this.texture('texts', A, TH, 'rgba8', new Uint8Array(img.data.buffer), 'linear'); atlas.dirty = null; this.atlasH = TH;
    }
    const uv = (p: { r: { x: number; y: number; w: number; h: number } }): [number, number, number, number] => [p.r.x / A, p.r.y / TH, (p.r.x + p.r.w) / A, (p.r.y + p.r.h) / TH];
    this.labels = labels.map((l) => ({ rect: uv(l), w: l.w, h: l.h }));
    // (a number's width at its row's most: its digits, a sign, its decimals, its `of`; a glyph 10 px tall)
    const adv = this.glyphM[0] * 10, digits = (v: number, dec: number) => String(Math.round(Math.abs(v))).length + (dec ? dec + 1 : 0) + (v < 0 ? 1 : 0);
    const numberW = rowsP.map((r, k) => { if (r.text !== undefined) return 0; const [lo, hi] = range(`r${k}`), d = r.decimals ?? 0, of = r.of !== undefined ? range(`r${k}of`) : null; return adv * (Math.max(digits(lo, d), digits(hi, d)) + (of ? 1 + Math.max(digits(of[0], d), digits(of[1], d)) : 0)); });
    // ── the items: their first slot, samples, icon cell, rank · header picture's rect · its size, its old place + 1,
    // its width · a text row's picture's rect · its size ──
    const pr = this.props.priority, order = items.map((d, i) => ({ i, p: pr ? Number(pr(d)) || 0 : 0, id: ids[i] ?? '' })).sort((a, b) => b.p - a.p || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const rank = new Float32Array(N); order.forEach((x, k) => { rank[x.i] = k; });
    const ic = this.props.header?.icon, at = this.props.icons;
    // (its decision's old place: by its id, among the items its decisions are kept for; the items gone a moment kept
    // after the items, for a while)
    const now = this.attached?.world.now ?? 0, here = new Set(ids), keep = this.props.collide === false ? 0 : this.timing().away * 1000;
    const was = new Map<string, number>(), sn = this.stateN;
    this.stateIds.forEach((id, k) => { if (k < sn || (this.gone.get(id) ?? -Infinity) >= now) was.set(id, k); });
    for (let k = 0; k < Math.min(sn, this.stateIds.length); k++) { const id = this.stateIds[k]!; if (!here.has(id) && keep > 0) this.gone.set(id, now + keep); }
    for (const [id, until] of this.gone) if (here.has(id) || until < now || !was.has(id)) this.gone.delete(id);
    const ghosts = [...this.gone.keys()], slots = N + ghosts.length;
    this.slotIds = [...ids, ...ghosts]; this.slotN = N;
    const st = (this.stride = 3 + 2 * texts.length), rowsI = Math.max(1, Math.ceil((st * slots) / 4096)), it = (this.itemTex = new Float32Array(rowsI * 4096 * 4));
    ghosts.forEach((id, q) => { it[(N + q) * st * 4 + 10] = (was.get(id) ?? -1) + 1; });
    for (let i = 0; i < N; i++) {
      const o = i * st * 4, ci = cols.indexOf(ids[i] ?? i), name = typeof ic === 'function' ? ic(items[i]!) : ic, h = heads[i];
      it[o] = ci >= 0 ? cols.first[ci]! : 0; it[o + 1] = ci >= 0 ? cols.count[ci]! : 0; it[o + 2] = name && at ? at.index(name) : -1; it[o + 3] = rank[i]!;
      if (h) { it.set(uv(h), o + 4); it[o + 8] = h.w; it[o + 9] = h.h; }
      it[o + 10] = (was.get(ids[i] ?? '') ?? -1) + 1;
      let need = h ? 2 * PAD + iconW + h.w : 0;
      rowsP.forEach((r, k) => { need = Math.max(need, 2 * PAD + labels[k]!.w + 8 + (r.text !== undefined ? rowTexts[texts.indexOf(k)]![i]?.w ?? 0 : numberW[k]!)); });
      it[o + 11] = fit ? Math.min(wHi, Math.max(wLo, Math.ceil(need))) : 0;
      texts.forEach((_k, q) => { const p = rowTexts[q]![i]; if (p) { it.set(uv(p), o + 12 + q * 8); it[o + 16 + q * 8] = p.w; it[o + 17 + q * 8] = p.h; } });
    }
    this.texture('items', 4096, rowsI, 'rgba32f', it);
    this.carry = this.stateIds.length > 0;
  }
  /** the places its decisions are kept in: its items', and those gone a moment */
  private get slots(): number { return Math.max(this.on.items.length, this.slotIds.length); }
  private texture(name: (typeof CARD_TEXTURES)[number], w: number, h: number, format: 'rgba8' | 'rgba32f' | 'r32f', data: ArrayBufferView, filter: 'linear' | 'nearest' = 'nearest'): void {
    const t = this.tex[name];
    if (!t || t.desc.width !== w || t.desc.height !== h || t.desc.format !== format) { t?.destroy(); this.tex[name] = this.g!.texture({ label: `${this.id} ${name}`, width: w, height: h, format, filter }); }
    this.tex[name]!.write(data);
  }
  /** 0–9 . − / % + a cell each (their alpha the glyph): a digit's advance and a cell's width in glyph heights */
  private glyphs(g: Graphics): void {
    if (typeof OffscreenCanvas === 'undefined') return;
    const CH = 40, FS = 34, font = `700 ${FS}px ${FONT}`, probe = new OffscreenCanvas(8, 8).getContext('2d'); if (!probe) return;
    probe.font = font;
    const adv = Math.max(...[...'0123456789'].map((c) => probe.measureText(c).width)), cw = Math.ceil(Math.max(...[...GLYPHS].map((c) => probe.measureText(c).width)) + 4);
    const c = new OffscreenCanvas(cw * GLYPHS.length, CH), x = c.getContext('2d', { willReadFrequently: true }); if (!x) return;
    x.font = font; x.fillStyle = '#ffffff'; x.textBaseline = 'middle'; x.textAlign = 'center';
    [...GLYPHS].forEach((ch, i) => x.fillText(ch, i * cw + cw / 2, CH / 2 + 1));
    const px = new Uint8Array(x.getImageData(0, 0, c.width, CH).data.buffer);
    const t = g.texture({ label: `${this.id} glyphs`, width: c.width, height: CH, format: 'rgba8', filter: 'linear' }); t.write(px);
    this.tex.glyphs = t; this.glyphM = [adv / CH, cw / CH, GLYPHS.length];
  }
  /** the programs for what it is placed on (a set's track's variant, or still), with collision or without */
  private programs(follow: SetsVariant | null): void {
    const collide = this.props.collide !== false, key = `${JSON.stringify(follow)}|${collide}`;
    if (key === this.progKey) return;
    this.progKey = key; for (const p of Object.values(this.progs)) p?.destroy(); this.progs = {}; this.built = 0; this.wanted = 0; this.broken = [];
    const g = this.g!, set = (names: readonly string[]) => names.map((name) => ({ name, kind: '2d' as const, sample: 'unfilterable' as const }));
    const textures = [...(follow ? set(SET_TEXTURES) : set(['places'])), ...CARD_TEXTURES.map((name) => ({ name, kind: '2d' as const, sample: CARD_FILTERED.has(name) ? 'float' as const : 'unfilterable' as const }))];
    const blocks = follow ? ['Frame', 'S', 'U'] : ['Frame', 'U'];
    const make = (kind: 'cards' | 'claim' | 'decide' | 'carry', extra: Partial<ProgramDesc>) => {
      const desc: ProgramDesc = { label: `cards ${this.id} ${kind}`, wgsl: cardsWGSL(kind, follow), glsl: cardsGLSL(kind, follow), blocks, textures, ...extra };
      const p = g.program(desc); this.wanted++; p.ready.then(() => { this.built++; this.invalidate(); }, (e: unknown) => { this.broken.push(`${kind}: ${(e as Error)?.message ?? e}`); this.attached?.world.error(e); }); return { p, desc };
    };
    const c = make('cards', { blend: 'alpha', depth: { write: false, test: 'always' } }); this.progs.cards = c.p; this.descs.cards = c.desc;
    if (collide) { this.progs.claim = make('claim', { blend: 'none', depth: { write: true, test: 'less' } }).p; this.progs.decide = make('decide', { overlay: true, blend: 'none' }).p; this.progs.carry = make('carry', { overlay: true, blend: 'none' }).p; }
    this.first = true; this.decided = false;
  }
  /** decisions not made yet (a texel a card: not decided, 255 in its fourth byte) */
  private freshStates(g: Graphics, rows: number): { tex: GTexture; target: GTarget }[] {
    const px = new Uint8Array(4096 * rows * 4); for (let i = 3; i < px.length; i += 4) px[i] = 255;
    return [0, 1].map((k) => { const tex = g.texture({ label: `${this.id} decisions ${k}`, width: 4096, height: rows, format: 'rgba8', filter: 'nearest', renderable: true }); tex.write(px); return { tex, target: g.layerTarget(tex, 0) }; });
  }
  /** the collision's pictures: the room's claims (two, in turn: a cell CELL CSS px), its own decisions (a texel a card,
   *  two in turn); the room's frame turned when this is its first set drawn this frame */
  private collision(ctx: FrameContext, n: number): void {
    const g = ctx.graphics, cw = Math.ceil(ctx.camera.width / CELL), ch = Math.ceil(ctx.camera.height / CELL), room = this.room!;
    if (room.size !== `${cw}x${ch}`) { for (const t of room.pics) t.destroy(); room.pics = [0, 1].map((k) => g.target(cw, ch, { sampled: true, label: `cards room ${k}` })); room.size = `${cw}x${ch}`; room.frame = -1; room.prev = -1; }
    if (room.frame !== ctx.now) { room.prev = room.frame; room.frame = ctx.now; room.cur = 1 - room.cur; room.drawn = false; }
    const rows = Math.max(1, Math.ceil(Math.max(n, this.slots) / 4096));
    if (this.stateRows !== rows) {
      // (its decisions in textures of another size: carried from the old ones by id, then those freed)
      // (twice before a carry: the first ones kept, the decisions are theirs)
      const old = this.states, free = (xs: { tex: GTexture; target: GTarget }[]) => { for (const s of xs) { s.target.destroy(); s.tex.destroy(); } };
      if (this.carry && old.length) { if (this.carryFrom) free(old); else this.carryFrom = [old[this.cur]!, old[1 - this.cur]!]; }
      else { free(old); if (this.carryFrom) free(this.carryFrom); this.carryFrom = null; this.stateIds = []; this.stateN = 0; this.carry = false; this.gone.clear(); }
      this.states = this.freshStates(g, rows);
      this.stateRows = rows; this.cur = 0;
    }
  }
  frame(ctx: FrameContext): DrawCall[] {
    const g = ctx.graphics, p = this.props;
    if (!this.ubuf || !this.on.frame(ctx)) return [];
    if (this.madeFor !== this.on.version) this.make(true);
    else if (this.cols && this.logsChanged(ctx)) this.make(false);
    if (!this.cols || !this.tex.items || !this.tex.glyphs) return [];
    const follow = this.on.set ? this.on.track(ctx)?.variant ?? null : null;
    if (this.on.set && !follow) return [];
    this.programs(follow);
    if (this.built < this.wanted) return [];
    const n = this.on.items.length; if (!n) return [];
    const collide = p.collide !== false;
    if (collide) this.collision(ctx, n);
    // what moves the cards' decisions: the view (a still view settles in the collision's own time, then nothing; the
    // things a set moves ask their own frames), the data, the cards themselves
    const cam = ctx.camera, vk = `${cam.viewProj.slice(0, 16).join(',')}|${cam.width}x${cam.height}`;
    if (vk !== this.viewKey) { this.viewKey = vk; this.viewAt = ctx.now; }
    this.uniforms(ctx, n, collide);
    const dm = this.dummy!, tx = (state: GTexture | null, claims: GTexture | null) => [...this.on.textures(ctx), this.tex.items!, this.tex.times!, this.tex.values!, this.tex.texts!, this.tex.glyphs!, (p.icons?.texture(g)) ?? dm, this.tex.fills ?? dm, state ?? dm, claims ?? dm];
    const blocks = [...this.on.blocks(ctx), this.ubuf], room = this.room!;
    if (collide && this.progs.claim && this.progs.decide && this.progs.carry && room.pics.length) {
      // made again: each card's decision carried to its item's new place by its id (a new card's: not decided yet)
      if (this.carry) {
        const from = this.carryFrom ? this.carryFrom[0]! : this.states[this.cur]!, to = this.carryFrom ? this.states[this.cur]! : this.states[1 - this.cur]!;
        g.frame([{ program: this.progs.carry, blocks, textures: tx(from.tex, null), count: 3 }], { target: to.target, clear: [0, 0, 0, 1] });
        if (this.carryFrom) { for (const s of this.carryFrom) { s.target.destroy(); s.tex.destroy(); } this.carryFrom = null; } else this.cur = 1 - this.cur;
        this.carry = false;
      }
      if (this.slotIds.length >= this.on.ids.length) { this.stateIds = this.slotIds; this.stateN = this.slotN; } else { this.stateIds = this.on.ids.slice(); this.stateN = this.stateIds.length; }
      const prev = this.states[this.cur]!, next = this.states[1 - this.cur]!, draw = room.pics[room.cur]!, last = room.pics[1 - room.cur]!;
      // its decisions from the last frame's picture, when its claims are in it (else it keeps what it has)
      if (this.claimedAt === room.prev && last.texture) {
        g.frame([{ program: this.progs.decide, blocks, textures: tx(prev.tex, last.texture), count: 3 }], { target: next.target, clear: [0, 0, 0, 0] });
        this.cur = 1 - this.cur;
        this.decided = true;
        this.first = false;
      }
      // its claims on this frame's picture, after the sets drawn before it this frame (their depth kept), by its
      // decisions now (the cards shown claim first)
      g.frame([{ program: this.progs.claim, blocks, textures: tx(this.states[this.cur]!.tex, null), index: this.quads!, count: 6, instanceCount: n }], { target: draw, clear: [0, 0, 0, 0], keep: room.drawn, keepDepth: true });
      room.drawn = true; this.claimedAt = room.frame;
    }
    const state = collide ? this.states[this.cur]?.tex ?? null : null, desc = this.descs.cards!, pick = p.pickable === false ? undefined : () => (this.progs.pick ??= g.program({ ...desc, label: `${desc.label} pick`, blend: 'none' }));
    const out: DrawCall[] = [];
    // (the dots under the cards: a card that lost its room never covers one that kept it)
    if ((p.look?.dots !== false) && (collide || this.step > 1)) out.push({ program: this.progs.cards!, blocks, textures: tx(state, null), index: this.dots!, count: 6, instanceCount: n, pickProgram: pick });
    out.push({ program: this.progs.cards!, blocks, textures: tx(state, null), index: this.quads!, count: 6, instanceCount: n, pickProgram: pick });
    return out;
  }
  /** a log it reads grew or changed (a live one), or a relation: its columns derived again (the items whose data
   *  changed), at most twice a second of the world's clock */
  private logsAt = -1e9;
  private logsChanged(ctx: FrameContext): boolean {
    if (ctx.now - this.logsAt < LIVE && ctx.now >= this.logsAt) return false;
    this.logsAt = ctx.now;
    return this.inputsKey() !== this.logsSeen;
  }
  /** the collision's timing, as given (s) */
  private timing(): Required<CardsCollide> {
    const c = typeof this.props.collide === 'object' ? this.props.collide : {};
    // (a cover's time kept in 10 ms steps, 2.5 s at most; a card's change in ms, a minute at most)
    return { cover: Math.min(1, Math.max(0, c.cover ?? COVER)), hold: Math.min(2.5, Math.max(0, c.hold ?? HOLD)), away: Math.min(60, Math.max(0, c.away ?? AWAY)), fade: Math.max(0, c.fade ?? FADE) };
  }
  /** what its columns are derived from: the logs' versions, the relations' */
  private inputsKey(): string {
    const chs = this.channels(), all = Object.values(chs).flatMap((c) => (isFormula(c) && c.inputs ? [c, ...Object.values(c.inputs)] : [c]));
    return [...logsOf(chs, this.logOf(), this.on.items).map((l) => `${l.id}:${l.version}`), ...all.filter((c) => isCount(c) || isMembers(c)).map((c) => `r${(c as { relations: { version: number } }).relations.version}`)].join('|');
  }
  private uniforms(ctx: FrameContext, n: number, collide: boolean): void {
    const u = this.u, p = this.props, lk = p.look ?? {}, col = this.cols!, rows = p.rows ?? [], idx = (name: string) => this.names.indexOf(name);
    const smooth = this.on.set ? this.on.set.drive.smooth : 0, sec = (ctx.s.time.now.getTime() - smooth - col.epoch) / 1000;
    const d = this.detailOf(ctx.s), step = (this.step = d < 0.5 ? 2 : d < 0.75 ? 1 : 0);
    u.fill(0);
    // (its place in the room's one order: the sets over it in the stack claim first)
    const sets = this.room?.sets ?? [this], over = Math.min(SETS - 1, sets.filter((x) => x !== this && (x.order! > this.order! || (x.order === this.order && x.added > this.added))).length);
    u.set(this.on.place(ctx, typeof p.lift === 'number' ? p.lift : 0), 0);
    const su = sizeUnits(p.size, `cards '${this.id}' size`), sv = sizeValue(p.size); u.set([su[0], su[1], su[2], typeof sv === 'number' ? sv : 120], 4);
    u.set([PAD, HEAD, ROW, rows.length], 8);
    u.set([sec, step, this.pickNo, n], 12);
    u.set([(p.opacity ?? 1) * this.shown * this.on.shown, POINTER, lk.dots === false ? 0 : DOT, lk.radius ?? RADIUS], 16);
    const c4 = (c: Color | undefined, def: Color) => rgba(c ?? def);
    const tm = this.timing();
    u.set(c4(lk.background, '#ffffffeb'), 20); u.set([tm.cover, tm.hold, tm.away, tm.fade], 24); u.set([this.stride, Math.max(n, this.slots), 0, 0], 28); u.set(c4(lk.bar, '#2563eb'), 32);
    u.set(c4(lk.ink, '#1f2937'), 36); u.set(c4(lk.inkOnDark, '#ffffff'), 40); u.set(c4(lk.badge, '#dc2626'), 44);
    u.set([p.fill ? idx('fill') : -1, this.fillDomain[0], this.fillDomain[1], p.fill ? 1 : 0], 48);
    u.set([p.badge ? idx('badge') : -1, p.badge ? idx('badgeOn') : -1, p.badge ? 1 : 0, 0], 52);
    u.set([this.glyphM[0], this.glyphM[1], this.glyphM[2], 1 + over * 2 * ITEMS], 56);
    const pic = this.room?.pics[0];
    u.set([pic?.width ?? 1, pic?.height ?? 1, CELL, collide ? 1 : 0], 60);
    // (now in ms of the world's clock, 254 steps of 10 ms whole: a cover's time wraps with it)
    u.set([Math.floor(ctx.now) % 63500, Math.min(0.25, Math.max(0, ctx.dt / 1000)), 0, this.first ? 1 : 0], 64);
    const ic = p.icons;
    u.set([p.header?.icon && ic ? 1 : 0, p.header?.text !== undefined ? 1 : 0, ic?.cols ?? 1, ic?.rows ?? 1], 68);
    u.set([Math.ceil(Math.max(1, this.names.length) / 4), this.names.length, over, Math.max(1, sets.length)], 72);
    let slot = 0;
    for (let k = 0; k < 6; k++) {
      const r = rows[k];
      // (a text row: −2, its picture's slot among the text rows)
      u.set(r ? (r.text !== undefined ? [-2, slot++, 0, 0] : [idx(`r${k}`), r.of !== undefined ? idx(`r${k}of`) : -1, r.decimals ?? 0, r.bar ? 1 : 0]) : [-1, -1, 0, 0], 76 + k * 4);
      const bd = this.barDomains[k] ?? [0, 1]; u.set([bd[0], bd[1], 0, 0], 100 + k * 4);
      const l = this.labels[k]; if (l) { u.set(l.rect, 124 + k * 4); u.set([l.w, l.h, 0, 0], 148 + k * 4); }
    }
    this.ubuf!.write(u);
  }
  /** each card's decision now, read back from the chip (the tools': collision's shown 0/1 and its fade 0..1, two
   *  numbers a card; without collision every card shown, 1 and 1); null: not drawn yet */
  async decisions(): Promise<Float32Array | null> {
    const n = this.on.items.length, out = new Float32Array(n * 2);
    if (this.props.collide === false) { out.fill(1); return out; }
    const st = this.states[this.cur], g = this.g; if (!st || !g) return null;
    const px = await g.readTexture(st.tex) as Uint8Array;
    // (a texel a card: shown 128 + its fade 0..127)
    for (let i = 0; i < n; i++) { const r = px[i * 4]!; out[2 * i] = r >= 128 ? 1 : 0; out[2 * i + 1] = (r % 128) / 127; }
    return out;
  }
  /** each card's place on the main thread ([lon, lat]: a set's thing at the world's time), and its id (the tools') */
  cardPlace(i: number): [number, number] | null { return this.on.lonLat(i, (this.attached?.world as { time?: Date } | undefined)?.time?.getTime()); }
  get ids(): readonly string[] { return this.on.ids; }
  /** an item's values at a time (the world's time by default): what its card shows */
  valuesOf(i: number, t?: number): Record<string, number> {
    const c = this.cols; if (!c) return {};
    const st = c.at(this.on.ids[i] ?? i, t ?? (this.attached?.world as { time?: Date } | undefined)?.time?.getTime() ?? Date.now());
    return st ? { ...st.values } : {};
  }
  override pickInfo(index: number): Omit<Picked, 'at' | 'x' | 'y'> | null {
    const it = this.on.items[index]; if (it === undefined) return null;
    const t = (this.attached?.world as { time?: Date } | undefined)?.time?.getTime(), vals = this.valuesOf(index, t);
    if (this.on.set) { const pk = this.on.set.pickInfo(index); return pk ? { ...pk, element: this.id, props: { ...pk.props, ...vals } } : null; }
    const f = it as unknown as { id?: string | number; props?: Record<string, unknown> };
    return { element: this.id, id: f.id ?? this.on.ids[index] ?? index, props: { ...(f.props ?? {}), ...vals }, d: it, index };
  }
  override status(): ElementStatus {
    const st = super.status();
    if (this.props.icons && !this.props.icons.ready) st.pending.push(`${this.id}: its pictures loading`);
    if (this.making) st.pending.push(`${this.id}: its logs loading`);
    if (this.on.busy) st.pending.push(`${this.id}: reading the ground under its places`);
    if (this.broken.length) st.failed.push(...this.broken.map((e) => ({ what: `${this.id} program`, error: e })));
    else if (this.wanted && this.built < this.wanted) st.pending.push(`${this.id}: its programs building`);
    // (collision: its first decisions, then held and faded a while after the view moved or it changed itself; rows
    // that stream keep the decisions made)
    const w = this.attached?.world; if (this.props.collide !== false && w && this.shown > 0 && this.settling(w.now)) st.pending.push(`${this.id}: making room`);
    st.ready = !st.pending.length;
    return st;
  }
  /** its decisions may still change: not made yet (its new cards' first), or the view moved within a cover's hold,
   *  the time away and a fade (a card covered then lost, one uncovered then back), or it changed itself within a fade
   *  (rows that come and go keep the decisions made: settled once their new cards are decided) */
  private settling(now: number): boolean {
    const tm = this.timing();
    return !this.decided || now - this.viewAt < (tm.hold + tm.away + tm.fade) * 1000 + 100 || now - this.touchedAt < tm.fade * 1000 + 100;
  }
  /** frames while its decisions settle (a still view: none once settled); while the clock runs, its values move */
  override wantsFrames(s: State): number {
    if (this.on.busy) return Infinity;
    const w = this.attached?.world; if (!w) return 0;
    // (and its new cards fading in)
    if (this.props.collide !== false && this.cols && (this.settling(w.now) || w.now - this.madeAt < this.timing().fade * 1000 + 100)) return Infinity;
    const live = (w as { timeRunning?: boolean }).timeRunning === true, rate = live ? 1 : s.time.rate;
    return rate && this.cols && this.cols.samples > this.cols.size ? 15 : 0;
  }
  override readouts() { return { cards: () => this.on.items.length, samples: () => this.cols?.samples ?? 0, channels: () => this.names.length }; }
  override detach(): void {
    this.on.detach();
    for (const p of Object.values(this.progs)) p?.destroy(); this.progs = {}; this.progKey = '';
    for (const t of Object.values(this.tex)) t?.destroy(); this.tex = {};
    for (const s of [...this.states, ...(this.carryFrom ?? [])]) { s.target.destroy(); s.tex.destroy(); } this.states = []; this.stateRows = 0; this.carryFrom = null; this.stateIds = []; this.slotIds = []; this.stateN = this.slotN = 0; this.gone.clear(); this.carry = false;
    this.atlas = null; this.pics.clear(); this.atlasH = 0; this.deriver = null;
    const room = this.room; if (room) { room.sets = room.sets.filter((x) => x !== this); if (!room.sets.length) { for (const t of room.pics) t.destroy(); room.pics = []; room.size = ''; } } this.room = null; this.claimedAt = -2;
    this.ubuf?.destroy(); this.quads?.destroy(); this.dots?.destroy(); this.dummy?.destroy(); this.ubuf = this.quads = this.dots = null; this.dummy = null; this.cols = null; this.madeFor = -1;
    super.detach();
  }
}
/** a data card on each thing or feature: cards({ of, header, rows, fill, badge }) */
export function cards<D = unknown>(p: Leveled<CardsProps<D>>): Cards<D> { return new Cards<D>(p as CardsProps<D>); }
