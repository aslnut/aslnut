// Frame statistics: what one run of one case looked like, from the display's frames (rAF intervals).
export interface FrameSummary {
  n: number; p50: number; p95: number; p99: number; max: number; mean: number; fps: number;
  over33: number; over50: number; over100: number;
  /** the worst 1 s window's mean fps */
  worst1s: number;
}
const r1 = (x: number) => Math.round(x * 10) / 10;
export function summarize(dts: number[]): FrameSummary {
  if (!dts.length) return { n: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0, fps: 0, over33: 0, over50: 0, over100: 0, worst1s: 0 };
  const a = [...dts].sort((x, y) => x - y), q = (p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))]!;
  const sum = dts.reduce((x, y) => x + y, 0);
  // the worst window: slide over 1 s of frames
  let worst = Infinity;
  for (let i = 0, j = 0, acc = 0; j < dts.length; j++) {
    acc += dts[j]!;
    while (acc - dts[i]! >= 1000 && i < j) { acc -= dts[i]!; i++; }
    if (acc >= 1000) worst = Math.min(worst, ((j - i + 1) * 1000) / acc);
  }
  if (!Number.isFinite(worst)) worst = (dts.length * 1000) / sum;
  return {
    n: dts.length, p50: r1(q(0.5)), p95: r1(q(0.95)), p99: r1(q(0.99)), max: r1(a.at(-1)!), mean: r1(sum / dts.length), fps: r1((dts.length * 1000) / sum),
    over33: dts.filter((x) => x > 33.4).length, over50: dts.filter((x) => x > 50).length, over100: dts.filter((x) => x > 100).length, worst1s: r1(worst),
  };
}
/** fps over time: frames per bucket (ms) → fps, from frame timestamps relative to the start */
export function fpsSeries(times: number[], dur: number, bucket = 250): number[] {
  const n = Math.max(1, Math.ceil(dur / bucket)), c = new Array<number>(n).fill(0);
  for (const t of times) { const i = Math.floor(t / bucket); if (i >= 0 && i < n) c[i]!++; }
  return c.map((k) => Math.round((k * 1000) / bucket));
}
export const median = (xs: number[]) => { const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? r1(a[Math.floor(a.length / 2)]!) : null; };
export const pct = (xs: number[], p: number) => { const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? r1(a[Math.min(a.length - 1, Math.floor(p * a.length))]!) : null; };
