// modules › presets › humans › hair › generate: a hair style made from a few numbers, as a shell over the scalp of
// the base body (found by casting rays at its head and neck), so it always covers the whole head it should, down to
// the nape; re-fitted to every head like any other style (hair › fit). Pure: no graphics.
//   style params (all optional, see HAIR_PARAMS):
//     hairline  front / temple / side / nape heights, as a share of the head from chin (0) to crown (1)
//     thickness the shell's offset over the scalp (m); volume: extra on top (m), tapering to the sides
//     length    hair hanging below the hairline at the back and sides (m, 0 = cropped)
//     fringe    hair falling over the forehead (m) · sideburn: down in front of the ears (m)
//     tufts / tuftFreq: spiky or curly relief (m, lumps round the head) · undercut: thinner sides (0…1)
//     part      a side parting: −1 left · 0 none · 1 right (a shallow groove off-centre)
//   const piece = generateHair({ length: 0.2, fringe: 0.04 }, scalpOf(template, basePositions))
import type { SkinPiece, Template } from '../body/template.ts';

/** every number a style takes: [min, max, step, default] */
export const HAIR_PARAMS = {
  front:     [0.4, 1.0, 0.01, 0.80],
  temple:    [0.4, 1.0, 0.01, 0.70],
  side:      [0.3, 0.9, 0.01, 0.58],
  nape:      [0.0, 0.8, 0.01, 0.22],
  thickness: [0.002, 0.04, 0.001, 0.010],
  volume:    [0, 0.06, 0.001, 0.012],
  length:    [0, 0.5, 0.005, 0],
  fringe:    [0, 0.12, 0.005, 0],
  sideburn:  [0, 0.06, 0.005, 0.015],
  tufts:     [0, 0.03, 0.001, 0],
  tuftFreq:  [2, 16, 1, 7],
  undercut:  [0, 1, 0.05, 0],
  part:      [-1, 1, 1, 0],
} as const;
export type HairParams = Partial<Record<keyof typeof HAIR_PARAMS, number>>;
export const hairDefaults = (): Record<keyof typeof HAIR_PARAMS, number> => Object.fromEntries(Object.entries(HAIR_PARAMS).map(([k, v]) => [k, v[3]])) as never;

const COLS = 36, ROWS = 11;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
type P3 = [number, number, number];

/** where hair grows: the base body's head and neck surface, sampled by rays from the head's middle (made once per
 *  template: a few hundred milliseconds) */
export interface Scalp { C: P3; crown: number; chin: number; prof: P3[][]; head: number; neck: number }
const COLS_S = 48, ELEV = 72, E0 = -75, E1 = 90;
const scalps = new WeakMap<object, Scalp>();
/** the scalp of a template's base body (positions in the template's vertex order) */
export function scalpOf(tpl: Template, B0: Float32Array, headSet: readonly number[]): Scalp {
  let S = scalps.get(tpl); if (S) return S;
  const inSet = new Set(headSet), T: number[] = [];
  for (const f of tpl.faces) if (f.every((v) => inSet.has(v))) for (let k = 1; k < f.length - 1; k++) T.push(f[0]!, f[k]!, f[k + 1]!);
  // the head's frame from its vertices: the centre a little above the middle; the chin: the lowest front point
  let x0 = 1e9, x1 = -1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const v of headSet) { x0 = Math.min(x0, B0[v * 3]!); x1 = Math.max(x1, B0[v * 3]!); y1 = Math.max(y1, B0[v * 3 + 1]!); z0 = Math.min(z0, B0[v * 3 + 2]!); z1 = Math.max(z1, B0[v * 3 + 2]!); }
  const crown = y1, C: P3 = [(x0 + x1) / 2, crown - 0.11, (z0 + z1) / 2];
  // the nearest hit along d from C (Möller–Trumbore), or null
  const ray = (d: P3): P3 | null => {
    let best = Infinity;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t]! * 3, b = T[t + 1]! * 3, c = T[t + 2]! * 3;
      const e1x = B0[b]! - B0[a]!, e1y = B0[b + 1]! - B0[a + 1]!, e1z = B0[b + 2]! - B0[a + 2]!, e2x = B0[c]! - B0[a]!, e2y = B0[c + 1]! - B0[a + 1]!, e2z = B0[c + 2]! - B0[a + 2]!;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const iv = 1 / det, tx = C[0] - B0[a]!, ty = C[1] - B0[a + 1]!, tz = C[2] - B0[a + 2]!, u = (tx * px + ty * py + tz * pz) * iv; if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, w = (d[0] * qx + d[1] * qy + d[2] * qz) * iv; if (w < 0 || u + w > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * iv; if (tt > 1e-4 && tt < best) best = tt;
    }
    return best < Infinity ? [C[0] + d[0] * best, C[1] + d[1] * best, C[2] + d[2] * best] : null;
  };
  // per column (0 = front, +z), surface points from a low elevation up to the crown, kept rising
  const prof: P3[][] = [];
  for (let c = 0; c < COLS_S; c++) {
    const th = (c / COLS_S) * Math.PI * 2, col: P3[] = [];
    for (let e = 0; e < ELEV; e++) {
      const ph = ((E0 + (E1 - E0) * (e / (ELEV - 1))) * Math.PI) / 180, d: P3 = [Math.cos(ph) * Math.sin(th), Math.sin(ph), Math.cos(ph) * Math.cos(th)];
      const h = ray(d); if (h && (!col.length || h[1] > col[col.length - 1]![1])) col.push(h);
    }
    prof.push(col);
  }
  const front = prof[0]!; let chin = front[0]![1]; for (const q of front) if (q[2] > C[2]) chin = Math.min(chin, q[1]);
  const head = tpl.bones.findIndex((b) => b.name === 'Head'), neck = tpl.bones.findIndex((b) => b.name === 'Neck');
  S = { C, crown, chin: Math.max(chin, crown - 0.26), prof, head, neck }; scalps.set(tpl, S);
  return S;
}

/** a hair style from its numbers over a scalp: a skinned piece (Head and Neck), on the base body */
export function generateHair(params: HairParams, S: Scalp): SkinPiece {
  const p = { ...hairDefaults(), ...params };
  const { C, crown, chin, head, neck } = S, H = crown - chin, N = COLS_S;
  // a scalp point at (column u ∈ [0, N), height share h, chin 0 → crown 1): along the column's surface profile
  const onCol = (c: number, h: number): P3 => {
    const pr = S.prof[((c % N) + N) % N]!, y = chin + h * H;
    if (y <= pr[0]![1]) return pr[0]!;
    let k = 0; while (k < pr.length - 2 && pr[k + 1]![1] < y) k++;
    const a = pr[k]!, b = pr[k + 1]!, t = Math.min(1, Math.max(0, (y - a[1]) / (b[1] - a[1] || 1e-4)));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  const scalp = (u: number, h: number): P3 => { const c0 = Math.floor(u), f = u - c0, a = onCol(c0, h), b = onCol(c0 + 1, h); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
  // the hairline's height by the angle from the front (0) to the back (π): front → temple (50°) → above the ear (95°)
  // → nape (135°+)
  const hairline = (ang: number) => {
    const d = (Math.abs(ang) * 180) / Math.PI;
    if (d < 50) return p.front + (p.temple - p.front) * smooth(0, 50, d);
    if (d < 95) return p.temple + (p.side - p.temple) * smooth(50, 95, d);
    return p.side + (p.nape - p.side) * smooth(100, 135, d);              // behind the ear it drops to the nape quickly
  };
  const pos: number[] = [], tris: number[] = [], J: number[] = [], W: number[] = [];
  const vert = (q: P3, wHead = 255) => { pos.push(q[0], q[1], q[2]); J.push(head, neck, 0, 0); W.push(wHead, 255 - wHead, 0, 0); return pos.length / 3 - 1; };
  // the shell: rows from the hairline (v = 0) to the crown (v = 1), pushed out from the head's centre
  const grid: { col: number[]; cur: number[] }[] = [];
  for (let c = 0; c <= COLS; c++) {
    const u = (c / COLS) * N, ang = (c / COLS) * Math.PI * 2, a = ang > Math.PI ? ang - Math.PI * 2 : ang;   // signed: + left
    const hl = hairline(a), side = Math.abs(Math.sin(a)), back = smooth(90, 180, (Math.abs(a) * 180) / Math.PI), deg = (Math.abs(a) * 180) / Math.PI;
    const col: number[] = [];
    // below the hairline: a fringe (front), sideburns (before the ears), length (sides and back): a curtain
    const drop = p.fringe * (1 - smooth(25, 55, deg)) + p.sideburn * smooth(55, 75, deg) * (1 - smooth(85, 100, deg)) + p.length * smooth(60, 120, deg);
    for (let rI = 0; rI <= ROWS; rI++) {
      const v = rI / ROWS, h = hl + (1 - hl) * Math.pow(v, 0.85);
      const s = scalp(u, Math.min(1, h)), n: P3 = [s[0] - C[0], (s[1] - C[1]) * 0.9, s[2] - C[2]], l = Math.hypot(...n) || 1;
      // the edge keeps a real thickness (≥ 5 mm): fitted to another body, a skin-hugging edge would sink under the skin
      let off = Math.max(0.005, p.thickness * (0.55 + 0.45 * smooth(0, 0.15, v))) + p.volume * v * v * (1 - 0.5 * side);
      off *= 1 - p.undercut * side * (1 - smooth(0.25, 0.6, v)) * (1 - back * 0.3);
      if (p.tufts) off += p.tufts * smooth(0.1, 0.5, v) * (0.5 + 0.5 * Math.sin(ang * p.tuftFreq + 7 * hash(c % COLS, rI)) * Math.sin(v * p.tuftFreq * 1.7 + hash(rI, c % COLS) * 6));
      if (p.part) { const pa = Math.abs(a - p.part * 0.45); if (pa < 0.12 && v > 0.45 && v < 0.95 && Math.abs(a) < 1.2) off *= 0.35 + (pa / 0.12) * 0.65; }
      col.push(vert([s[0] + (n[0] / l) * off, s[1] + (n[1] / l) * off, s[2] + (n[2] / l) * off], v < 0.25 ? 200 : 255));
    }
    // the curtain below the hairline (only where the drop is more than 1 cm): straight down, keeping the edge's offset
    const cur: number[] = [];
    if (drop > 0.01) {
      const e = scalp(u, hl), n: P3 = [e[0] - C[0], 0, e[2] - C[2]], l = Math.hypot(...n) || 1, o = p.thickness + 0.003;
      for (let k = 1; k <= 3; k++) { const t = k / 3; cur.push(vert([e[0] + (n[0] / l) * o * (1 + t * 0.4), e[1] - drop * t, e[2] + (n[2] / l) * o * (1 + t * 0.4)], 130)); }
    }
    grid.push({ col, cur });
  }
  // faces: the shell's rows, curtains between neighbouring columns that both have one
  for (let c = 0; c < COLS; c++) {
    const A = grid[c]!.col, B = grid[c + 1]!.col;
    for (let rI = 0; rI < ROWS; rI++) tris.push(A[rI]!, A[rI + 1]!, B[rI]!, B[rI]!, A[rI + 1]!, B[rI + 1]!);
    const ca = grid[c]!.cur, cb = grid[c + 1]!.cur;
    if (ca.length && cb.length) { const a = [A[0]!, ...ca], b = [B[0]!, ...cb]; for (let k = 0; k < 3; k++) tris.push(a[k]!, b[k]!, a[k + 1]!, b[k]!, b[k + 1]!, a[k + 1]!); }
  }
  // every triangle faces away from the head's centre
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t]!, tris[t + 1]!, tris[t + 2]!].map((i) => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!]) as [P3, P3, P3];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], nn = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const m = [(a[0] + b[0] + c[0]) / 3 - C[0], (a[1] + b[1] + c[1]) / 3 - C[1], (a[2] + b[2] + c[2]) / 3 - C[2]];
    if (nn[0]! * m[0]! + nn[1]! * m[1]! + nn[2]! * m[2]! < 0) { const x = tris[t + 1]!; tris[t + 1] = tris[t + 2]!; tris[t + 2] = x; }
  }
  return { pos, tris, j: J, w: W };
}
/** two pieces → one (a cap under a sculpted style fills its bare scalp) */
export function mergePieces(a: SkinPiece, b: SkinPiece): SkinPiece {
  const n = a.pos.length / 3;
  return { pos: [...Array.from(a.pos), ...Array.from(b.pos)], tris: [...Array.from(a.tris), ...Array.from(b.tris, (i) => i + n)], j: [...Array.from(a.j), ...Array.from(b.j)], w: [...Array.from(a.w), ...Array.from(b.w)] };
}
