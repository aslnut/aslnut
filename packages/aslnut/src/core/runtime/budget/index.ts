// core › runtime › budget: what a frame may cost, and the governor that holds it there. A budget is set, or there is
// none (pay only for what you set: no budget, no governor, nothing measured for it). With one, every drawn frame that
// follows a drawn frame is a sample: its gap (the display's real frame time), its draws and triangles, the graphics'
// memory. Too many frames over the budget step detail down, one rung of a ladder at a time; a long run of frames with
// room steps it back up (waiting twice as long each time a step up was soon undone: no see-saw).
//   budget     world(canvas, { budget: { frameMs: 33, memoryMB: 400 } }) · w.setBudget(b | null)
//   governor   automatic with a budget; world(canvas, { governor: { stepDownAfter, stepUpAfter, ladder } }) ·
//              w.on('governor', e => e.step, e.dropped) · w.governor (what is dropped now)
//   memory     world(canvas, { memory: { limitMB, evict } }): the loader's decoded values within limitMB, the
//              least seen out first, or by your own score (the lowest out first)

/** what a frame may cost; each unset one is not measured */
export interface Budget {
  /** ms between frames (16: 60 per second; 33: 30). A frame counts as over at 1.5 × this */
  frameMs?: number;
  /** MB of graphics memory (textures and buffers) */
  memoryMB?: number;
  /** triangles drawn a frame */
  triangles?: number;
  /** draw calls a frame */
  drawCalls?: number;
}
/** a rung of the governor's ladder: `down` drops a little (its label, or null: nothing left to drop here), `up`
 *  gives back the last drop it made */
export interface GovernorRung { name: string; down(): string | null; up(): void }
export interface GovernorOptions {
  /** frames over the budget (within a short while) before a step down (default 10) */
  stepDownAfter?: number;
  /** frames in a row with room before a step up (default 120) */
  stepUpAfter?: number;
  /** the rungs, in order (default: the world's: detail, shadows, quality, resolution) */
  ladder?: GovernorRung[];
}
/** what the governor drops first and what never (core › runtime › detail › priorities): each a rung of the world's
 *  ('detail', 'shadows', 'quality', 'resolution') or an element by its id. A dropped element steps its own detail (¾,
 *  ½, ¼: coarser levels sooner, fewer copies over time; never hidden: that is the app's call, on the governor's event);
 *  a kept one is never stepped (the world's detail does not reach it; a kept rung of the world's is never taken). The
 *  rest follow in the world's order */
export interface Priorities { drop?: string[]; keep?: string[] }
export interface GovernorEvent { step: 'down' | 'up'; /** what is dropped now, the first first */ dropped: string[]; /** why: the sample that tipped it */ why: string }
/** one drawn frame's numbers */
export interface FrameSample { gapMs: number; cpuMs: number; gpuMs: number | null; draws: number; triangles: number; gpuMB: number }

export class Governor {
  budget: Budget;
  private o: GovernorOptions; private ladder: GovernorRung[];
  private dropped: { rung: GovernorRung; label: string }[] = [];
  private over = 0; private room = 0; private wait: number; private lastUp = -1e9; private n = 0;
  constructor(budget: Budget, o: GovernorOptions, ladder: GovernorRung[]) { this.budget = budget; this.o = o; this.ladder = o.ladder ?? ladder; this.wait = o.stepUpAfter ?? 120; }
  /** what is dropped now, the first first */
  get drops(): string[] { return this.dropped.map((d) => d.label); }
  /** a drawn frame: maybe a step (the event), else null */
  frame(f: FrameSample): GovernorEvent | null {
    const b = this.budget; this.n++;
    const why = b.frameMs !== undefined && f.gapMs > b.frameMs * 1.5 ? `frame ${f.gapMs.toFixed(0)} ms`
      : b.drawCalls !== undefined && f.draws > b.drawCalls ? `${f.draws} draws`
      : b.triangles !== undefined && f.triangles > b.triangles ? `${Math.round(f.triangles)} triangles`
      : b.memoryMB !== undefined && f.gpuMB > b.memoryMB ? `${f.gpuMB.toFixed(0)} MB` : '';
    if (why) {
      this.room = 0; this.over++;
      if (this.over >= (this.o.stepDownAfter ?? 10)) {
        this.over = 0;
        // a step up undone soon after: wait twice as long before the next one
        if (this.n - this.lastUp < 300) this.wait = Math.min(this.wait * 2, (this.o.stepUpAfter ?? 120) * 8);
        for (const rung of this.ladder) { const label = rung.down(); if (label) { this.dropped.push({ rung, label }); return { step: 'down', dropped: this.drops, why }; } }
      }
      return null;
    }
    // room: the frame well inside every set budget (a display's frame comes on time whatever the work, so the work
    // itself is measured: the main thread's and, where known, the chip's)
    const t = b.frameMs;
    const roomy = (t === undefined || (f.gapMs < t * 1.2 && f.cpuMs < t * 0.5 && (f.gpuMs === null || f.gpuMs < t * 0.6)))
      && (b.drawCalls === undefined || f.draws < b.drawCalls * 0.8) && (b.triangles === undefined || f.triangles < b.triangles * 0.8) && (b.memoryMB === undefined || f.gpuMB < b.memoryMB * 0.85);
    this.over = Math.max(0, this.over - 0.25);
    if (!roomy) { this.room = 0; return null; }
    if (++this.room < this.wait || !this.dropped.length) return null;
    this.room = 0; this.lastUp = this.n;
    const d = this.dropped.pop()!; d.rung.up();
    return { step: 'up', dropped: this.drops, why: 'room' };
  }
  /** a new ladder (the app's priorities changed): everything dropped given back first */
  setLadder(l: GovernorRung[]): void { this.reset(); this.ladder = this.o.ladder ?? l; }
  /** give back everything dropped (the budget taken away) */
  reset(): void { while (this.dropped.length) this.dropped.pop()!.rung.up(); this.over = 0; this.room = 0; this.wait = this.o.stepUpAfter ?? 120; }
}

/** the loader's memory, set on the world */
export interface MemoryOptions {
  /** MB of decoded values (tiles, data) kept in memory (default: from the device's memory, 192 at most) */
  limitMB?: number;
  /** what goes first when over: the least seen (default), or your score per item (the lowest out first) */
  evict?: 'least-seen' | ((item: { key: string; bytes: number; seenMsAgo: number }) => number);
}
