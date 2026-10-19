// core › encoding › join: a mark's features joined to the ones it drew, by id. Each feature keeps its slot (its row on
// the graphics chip) for as long as it is in the data, whatever order a source hands the features over in; so after
// a data change only the new, changed and gone features are written again, and what stayed never fades in again,
// never blinks, never takes another feature's colour while new shapes are being built. A slot freed by a gone feature
// is taken again only after the next build (its old shape may still be drawn until then).
//   const j = new Join(); j.next(features) → { new, changed, gone, stayed }, slotOf(key)
import type { Geometry } from '../data/features.ts';

/** what one change did: features new, changed (values or shape), gone, and stayed the same */
export interface JoinCounts { new: number; changed: number; gone: number; stayed: number }
/** a feature as the join sees it: its key, its datum and shape (compared by identity, then props by value) */
export interface JoinItem { key: string; d: unknown; geometry: Geometry | null }

const propsOf = (d: unknown): Record<string, unknown> | null => (d && typeof d === 'object' && 'props' in d ? ((d as { props?: Record<string, unknown> }).props ?? null) : null);
/** the same props, value by value (a source handing over a fresh object with the same numbers: stayed) */
function sameProps(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const p = propsOf(a), q = propsOf(b);
  if (!p || !q) return false;
  const ka = Object.keys(p), kb = Object.keys(q);
  if (ka.length !== kb.length) return false;
  for (const k of ka) { const x = p[k], y = q[k]; if (x !== y && !(typeof x === 'number' && typeof y === 'number' && Number.isNaN(x) && Number.isNaN(y))) return false; }
  return true;
}

export class Join {
  private slots = new Map<string, number>();
  private items = new Map<string, JoinItem>();
  /** slots free to take, and slots freed since the last build (taken only after it) */
  private free: number[] = []; private freeing: number[] = [];
  /** the highest slot + 1 (the rows a mark keeps) */
  size = 0;
  /** the last change, counted; and the keys that changed (values or shape) and are new */
  last: JoinCounts = { new: 0, changed: 0, gone: 0, stayed: 0 };
  changedKeys = new Set<string>();
  /** slots freed by the last change (their texels written empty: an old shape there draws nothing) */
  gone: number[] = [];
  /** shapes changed in the last change (a feature new, gone, or with a new geometry) */
  shapes = false;

  slotOf(key: string): number | undefined { return this.slots.get(key); }
  /** the next list: each item's slot, and what changed */
  next(list: readonly JoinItem[]): number[] {
    const out = new Array<number>(list.length), here = new Set<string>(), c: JoinCounts = { new: 0, changed: 0, gone: 0, stayed: 0 };
    this.changedKeys = new Set(); this.gone = []; this.shapes = false;
    for (let i = 0; i < list.length; i++) {
      const it = list[i]!, was = this.items.get(it.key);
      here.add(it.key);
      let slot = this.slots.get(it.key);
      if (slot === undefined) {
        slot = this.free.length ? this.free.pop()! : this.size++;
        this.slots.set(it.key, slot); c.new++; this.changedKeys.add(it.key); this.shapes = true;
      } else if (was && was.d === it.d) c.stayed++;
      else if (was && was.geometry === it.geometry && sameProps(was.d, it.d)) c.stayed++;
      else { c.changed++; this.changedKeys.add(it.key); if (!was || was.geometry !== it.geometry) this.shapes = true; }
      this.items.set(it.key, it);
      out[i] = slot;
    }
    for (const [k, slot] of this.slots) if (!here.has(k)) { this.slots.delete(k); this.items.delete(k); this.freeing.push(slot); this.gone.push(slot); c.gone++; this.shapes = true; }
    this.last = c;
    return out;
  }
  /** a build finished: the slots freed before it may be taken again */
  built(): void { if (this.freeing.length) { this.free.push(...this.freeing); this.freeing = []; } }
  /** start over (a new source) */
  clear(): void { this.slots.clear(); this.items.clear(); this.free = []; this.freeing = []; this.size = 0; this.changedKeys.clear(); this.gone = []; }
}
