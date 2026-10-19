// core › runtime › frame: the frame itself, drawn on demand. A still view draws nothing: a frame is drawn when the view
// moves, something changed (w.invalidate(), a param, a toggle, data in), something loads, or something on screen
// animates. What animates says so itself, at its own rate (the layer contract `wantsFrames(s)`: 0 none, Infinity every
// display frame, n a second where a lower rate looks the same), and only while it is shown and in range; your own
// per-frame work asks the same way (w.everyFrame(fn, { fps })). With nothing wanted for a while the loop rests: it stops
// asking the display for frames (a phone's main thread sleeps too) and is woken by a touch, an invalidate, a resize.
//   world(canvas, { frames: { max: 30, rate: (l, wants) => (l.kind === 'sky' ? Math.min(wants, 10) : wants) } })
//   const off = w.everyFrame((s, dt) => hud.update(s), { fps: 10 });
//   w.telemetry().frames   // { fps, wanted: [['people', 30]], resting, rested }
import type { Element } from '../world/element.ts';
import type { State } from '../world/state.ts';

/** how a world draws on demand (every option has a default; unset: as described) */
export interface FramesOptions {
  /** the most frames a second any one thing's own animation gets (default: every display frame) */
  max?: number;
  /** your rule for a layer's own frames: the rate it wants in (0, n a second, Infinity), the rate out (lower it, or 0
   *  to freeze it; a higher one than it wants draws frames nothing needs) */
  rate?: (layer: Element, wants: number, s: State) => number;
  /** ms of stillness before the loop rests (it stops asking the display for frames; default 500; false: never) */
  rest?: number | false;
  /** with the world's time 'now' and a sky that lights it: ms between looks at the light (one frame each; default
   *  60000: the sun moves a quarter of a degree a minute) */
  light?: number;
}
/** what draws by itself now: the highest rate wanted and by whom */
export interface FrameWant { rate: number; who: string }

/** frames a second for motion of `pxPerSecond` on screen to step at most `stepPx` a frame (≥ `min`; past 60:
 *  Infinity, every display frame) */
export function motionFrames(pxPerSecond: number, o: { stepPx?: number; min?: number } = {}): number {
  if (!(pxPerSecond > 0)) return 0;
  const f = Math.max(o.min ?? 4, pxPerSecond / Math.max(0.05, o.stepPx ?? 1));
  return f >= 60 ? Infinity : f;
}
/** frames a second for the light of a clock running `rate` × real time: the sun moves at most 0.02° a frame (a
 *  time-lapse of a minute a second: 13 a second; of five minutes a second or more: every display frame) */
export function sunFrames(rate: number): number {
  const degPerS = (Math.abs(rate) * 360) / 86400;
  if (degPerS <= 0) return 0;
  const f = Math.max(1, degPerS / 0.02);
  return f >= 60 ? Infinity : f;
}
/** a rate made a step of the display's (60, 30, 20, 15, 12, 10…): frames come on a steady beat */
export const msPer = (rate: number): number => (rate === Infinity || rate >= 60 ? 0 : 1000 / rate);

// ── a frame being made: from its first draw gathered until it is drawn ──────────────────────────────────────────
// What your data says changed meanwhile (a source's rows changed in your everyFrame work) is told to the layers once
// the frame is drawn: its draws hold what they were made of (their buffers, their items in order), the change is the
// next frame's. (What is freed meanwhile waits for it too: the graphics' hold.)
const making = { open: 0, told: new Map<object, () => void>() };
/** a frame's draws are being gathered (the world, before its layers' frames) */
export function frameOpen(): void { making.open++; }
/** the frame is drawn (or not drawn after all): what was told meanwhile is told now, each once, in order */
export function frameDrawn(): void {
  if (!making.open || --making.open) return;
  while (making.told.size) { const fs = [...making.told.values()]; making.told.clear(); for (const f of fs) { try { f(); } catch (e) { console.error(e); } } }
}
/** tell now, or once the frame being made is drawn (`key`: told once however often it changed meanwhile) */
export function whenDrawn(key: object, f: () => void): void { if (making.open) { making.told.delete(key); making.told.set(key, f); } else f(); }
