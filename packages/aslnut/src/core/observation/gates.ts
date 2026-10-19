// core › observation › gates: what passes a level change on, and how. The margin and the dwell are the binding's
// (core › observation › levels); here, what a level change does to what is shown:
//   ahead   as the orbit nears an edge, the next level's elements load and build quietly (hidden, a slice at a time)
//   swap    a level change swaps once: the new level's elements come in together, when every one of them is ready;
//           the old level's stay shown until then, then go in the same frame (never a hole, never a half-swap)
//   keep    what a level change hid keeps its data and built shapes while its level is among the last few looked at
//           and for a while (default 2 levels, 60 s): going back is instant. Past that, it is let go (release)
// A world with no levels has none of this (a GIS map: no level, no gate, no cost).
import type { Element, FrameContext } from '../world/element.ts';
import type { State } from '../world/state.ts';
import { shown } from './presence.ts';
import type { LevelChange, Levels } from './levels.ts';

/** a swap under way: the level it goes to, what comes in (being made ready), the targets held meanwhile */
interface Swap { to: string; entering: Set<Element>; ready: Set<Element>; held: Map<Element, number>; since: number }
/** the longest a swap waits for what comes in (ms): past it, it swaps anyway (what is still loading comes in coarse) */
const SWAP_MOST = 8000;

export class Gates {
  swap: Swap | null = null;
  /** what a level change hid: when, and the level it was shown at */
  private hidden = new Map<Element, { at: number; level: string }>();
  /** counts, for the observation panel and the measures: level changes, swaps done, elements let go, elements whose
   *  props by level were applied (one each a level change that changed one of them) */
  readonly counts = { changes: 0, swaps: 0, released: 0, waitedMs: 0, applied: 0 };
  readonly levels: Levels;
  constructor(levels: Levels) { this.levels = levels; }

  /** a level change: the elements it turns (shown before, not after, or the other way) swap once */
  begin(change: LevelChange, elements: readonly Element[], s: State, now: number): void {
    this.counts.changes++;
    const held = new Map<Element, number>(this.swap?.held ?? []), entering = new Set<Element>(), ready = new Set<Element>();
    for (const l of elements) {
      if (l.forced !== null) continue;
      let after = 0; try { after = shown(l.props.when, s, `element '${l.id}'`); } catch { after = 0; }
      const before = held.get(l) ?? l.target;
      if ((before > 0) === (after > 0)) { if (held.has(l) && after > 0 === before > 0) held.delete(l); continue; }
      if (after > 0) { entering.add(l); held.set(l, 0); this.hidden.delete(l); }
      else held.set(l, before);       // leaving: stays shown until what comes in is ready
    }
    this.swap = entering.size || held.size ? { to: change.to, entering, ready, held, since: now } : null;
  }
  /** the target an element is held at during a swap (undefined: its own) */
  hold(l: Element): number | undefined { return this.swap?.held.get(l); }
  /** a slice of the swap's work (in frames or between them): what comes in prepared, a few ms; true when it swapped */
  work(ctx: FrameContext, budgetMs: number, now: number, nowReal: () => number): boolean {
    const sw = this.swap; if (!sw) return false;
    const t0 = nowReal();
    for (const l of sw.entering) {
      if (sw.ready.has(l)) continue;
      if (nowReal() - t0 > budgetMs) break;
      // ready when its prepare is done (a mark: its data in and its shapes built). An element that loads only while
      // shown (prepare: nothing to do) comes in at once, coarse first (its own detail is render detail)
      let done = true;
      try { done = l.prepare(ctx); } catch { done = true; }
      if (done) sw.ready.add(l);
    }
    if (sw.ready.size < sw.entering.size && now - sw.since < SWAP_MOST) return false;
    // the swap: everything held lets go in the same frame (the old level's out, the new one's in)
    this.counts.swaps++; this.counts.waitedMs += now - sw.since;
    for (const [l, t] of sw.held) if (t > 0) this.hidden.set(l, { at: now, level: this.levels.recent[0] ?? '' });
    this.swap = null;
    return true;
  }
  /** let go of what was hidden past the keep (its level no longer among the last few, or too long ago) */
  keep(now: number): void {
    if (!this.hidden.size) return;
    const k = this.levels.keep, last = this.levels.recent.slice(0, k.levels);
    for (const [l, h] of this.hidden) {
      if (l.target > 0) { this.hidden.delete(l); continue; }
      if (l.shown > 0) continue;            // still fading out
      if (now - h.at < k.seconds * 1000 && last.includes(h.level)) continue;
      this.hidden.delete(l);
      try { if (l.letGo) { l.letGo(); this.counts.released++; } } catch { /* its own; nothing kept */ }
    }
  }
  /** the soonest a still view must look again (a keep running out), ms; null: none */
  get nextKeep(): number | null { let m: number | null = null; for (const h of this.hidden.values()) { const t = h.at + this.levels.keep.seconds * 1000; if (m === null || t < m) m = t; } return m; }
  forget(l: Element): void { this.hidden.delete(l); this.swap?.held.delete(l); this.swap?.entering.delete(l); }
}
