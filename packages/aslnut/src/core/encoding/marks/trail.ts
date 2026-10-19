// core › geometry › marks › trail: where things have been, drawn up to the world's time and fading behind it (vehicle
// tracks, ships, people, storms). Each feature is a line with a time per point; the world's clock (or yours) decides
// how much is drawn, `window` how long a tail stays, and a head glows where it is now. Scrub the time
// (`w.setTime(date)`) and every trail follows on the graphics, with no rebuild. It is a line: width, colour per
// feature, hover, tooltip, tap; hooks as the line mark (`along` is the time, 0..1 over the data's span).
//   trail({ id: 'tracks', data: data.geojson(trips), times: d => d.props.times, window: 900, color: '#38bdf8' })
import type { FrameContext } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import { linesOf, type Feature } from '../../data/features.ts';
import { Line, type LineProps } from './line.ts';
import type { Entry } from './features.ts';
import type { Segments, SegmentsJob } from '../../geometry/build/segments.ts';
import type { Leveled } from '../../observation/presence.ts';

export interface TrailProps<D> extends LineProps<D> {
  /** the time of each point of the feature's line: ms since 1970 or Dates (default d.props.times) */
  times?: (d: D) => readonly (number | Date)[] | null | undefined;
  /** seconds of history drawn behind the head (default 600) */
  window?: number;
  /** how much the head glows (default .6; 0 none) */
  head?: number;
  /** the time drawn up to (default the world's time) */
  clock?: (s: State) => number | Date;
}
const ms = (t: number | Date) => (typeof t === 'number' ? t : t.getTime());

export class Trail<D = Feature> extends Line<D> {
  /** its props as it runs (given by level: the values for the level now) */
  private get tp(): TrailProps<D> { return this.props; }
  private t0 = 0; private t1 = 1;
  constructor(p: TrailProps<D>) { super(p); }
  /** a feature's times as given (ms or Dates), or none */
  private timesOf(e: Entry<D>): readonly (number | Date)[] | null {
    const t = this.tp.times ? this.tp.times(e.d) : ((e.d as unknown as Feature).props?.times as (number | Date)[] | undefined);
    return t && t.length ? t : null;
  }
  /** a build's times: every feature's in one array (ms), each feature's start and count in it */
  private times = new Float64Array(0); private timeAt = new Int32Array(0); private timeN = new Int32Array(0);
  /** the times read once (counted, then filled), and their span (along is 0..1 over it), once per build */
  protected override startBuild(next: Segments): SegmentsJob {
    const es = this.entries, lists: (readonly (number | Date)[] | null)[] = new Array(es.length);
    let total = 0;
    for (let i = 0; i < es.length; i++) { const t = this.timesOf(es[i]!); lists[i] = t; total += t ? t.length : 0; }
    const T = new Float64Array(total), at = new Int32Array(this.bySlot.length), n = new Int32Array(this.bySlot.length);
    let lo = Infinity, hi = -Infinity, q = 0;
    for (let i = 0; i < es.length; i++) {
      const t = lists[i]; at[es[i]!.index] = q; n[es[i]!.index] = t ? t.length : 0; if (!t) continue;
      for (let k = 0; k < t.length; k++) { const x = ms(t[k]!); T[q++] = x; if (x < lo) lo = x; if (x > hi) hi = x; }
    }
    this.times = T; this.timeAt = at; this.timeN = n;
    this.t0 = Number.isFinite(lo) ? lo : 0; this.t1 = Number.isFinite(hi) && hi > lo ? hi : this.t0 + 1;
    return super.startBuild(next);
  }
  /** the build's times let go once its segments are made (the pieces hold each point's) */
  protected override built2(): void { this.times = new Float64Array(0); this.timeAt = new Int32Array(0); this.timeN = new Int32Array(0); }
  protected override alongOf(e: Entry<D>, k: number): ((at: number) => number) | undefined {
    const len = this.timeN[e.index] ?? 0; if (!len) return () => 0;
    // a multi-line's parts take their times in order
    let off = 0; if (k) { const parts = linesOf(e.geometry); for (let j = 0; j < k; j++) off += parts[j]?.length ?? 0; }
    const T = this.times, base = this.timeAt[e.index]!, last = base + len - 1, t0 = this.t0, span = this.t1 - this.t0;
    return (at) => { const i = Math.floor(at), f = at - i, a = T[Math.min(last, base + off + i)]!, b = T[Math.min(last, base + off + i + 1)]!; return (a + (b - a) * f - t0) / span; };
  }
  protected override uniforms(ctx: FrameContext): void {
    super.uniforms(ctx);
    const now = this.tp.clock ? ms(this.tp.clock(ctx.s)) : ctx.s.time.now.getTime(), span = this.t1 - this.t0;
    this.L.set([(now - this.t0) / span, ((this.tp.window ?? 600) * 1000) / span, 1, this.tp.head ?? 0.6], 36);
  }
  override readouts() { return { ...super.readouts(), from: () => new Date(this.t0), to: () => new Date(this.t1) }; }
  /** its clock runs: it changes every frame (never into the ground's tiles) */
  protected override selfMoving(): boolean { return !!this.tp.clock || (this.attached?.world as { timeRunning?: boolean } | undefined)?.timeRunning === true || super.selfMoving(); }
  /** drawn up to a time that runs by itself */
  override animating(s: State): boolean { return !!this.tp.clock || (this.attached?.world as { timeRunning?: boolean } | undefined)?.timeRunning === true || super.animating(s); }
  override wantsFrames(s: State): number { return !!this.tp.clock || (this.attached?.world as { timeRunning?: boolean } | undefined)?.timeRunning === true ? Infinity : super.wantsFrames(s); }
}
export const trail = <D = Feature>(p: Leveled<TrailProps<D>>) => new Trail<D>(p as TrailProps<D>);
