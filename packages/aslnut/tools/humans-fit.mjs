// The humans fit: a body fit made from a base mesh (a skinned human from a 3D generator: one mesh, a Mixamo-named
// skeleton, any height). The template keeps its topology, skeleton, skin weights, correctives, hair and garments; the
// mesh gives the silhouette. Steps:
//   1. align: the mesh scaled to the base body's height; its joints matched to the template's bones by name. The
//      trunk's joints are placed between landmarks measured on both surfaces (the crotch, the shoulder joints, the
//      head's joint, the crown), so a generator's rig that puts the hip joints at the crotch does not shorten the
//      thighs; the limbs take the mesh's lengths along the template's own rest directions (its A-pose kept), the
//      hands the template's shape scaled to the mesh's hand length.
//   2. pull: each template vertex, carried into the mesh's pose by its own skin weights, meets the mesh's surface
//      along its normal (or at the closest point) within a limit, among the mesh's triangles of its own body part and
//      its neighbours' (an arm never snaps to the torso); the move is carried back into the rest pose.
//   3. smooth: a few Laplacian passes over the template's faces; the face (the decal's vertices) and the hands capped.
//   4. write fit.json (v: 1, the vertex count, offsets in metres to 0.1 mm, the joints' offsets) and report the
//      numbers and the defects found (spikes, flipped faces, the face decal's roughness, hands).
//   node tools/humans-fit.mjs <mesh.glb> [--out <dir, default ../../data/packs/humans>] [--template <template.json>] [--name <id>]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { generate, vertexParts, PART_NAMES } from '../src/modules/presets/humans/body/generator.ts';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const src = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!src) { console.log('node tools/humans-fit.mjs <mesh.glb> [--out <dir>] [--template <template.json>] [--name <id>]'); process.exit(1); }
const PACK = join(import.meta.dirname, '..', '..', '..', 'data', 'packs', 'humans');
const OUT = resolve(opt('--out', PACK)), TPL = resolve(opt('--template', join(PACK, 'template.json')));
const t0 = performance.now();

// ── vectors ────────────────────────────────────────────────────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]), norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const at = (B, i) => [B[i * 3], B[i * 3 + 1], B[i * 3 + 2]];
/** the smallest rotation taking unit a onto unit b (3 × 3, row-major) */
function rotTo(a, b) {
  const v = cross(a, b), c = dot(a, b);
  if (c < -0.9999) return [-1, 0, 0, 0, 1, 0, 0, 0, -1];
  const k = 1 / (1 + c), [x, y, z] = v;
  return [1 - k * (y * y + z * z), -z + k * x * y, y + k * x * z, z + k * x * y, 1 - k * (x * x + z * z), -x + k * y * z, -y + k * x * z, x + k * y * z, 1 - k * (x * x + y * y)];
}
const app = (R, p) => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]];
const tr = (R) => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// ── the mesh (glb: its first primitive; joints at rest from the skin's inverse bind matrices) ──────────────────
function readGlb(path) {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a binary glTF`);
  const jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl).toString()), bin = b.subarray(20 + jl + 8);
  const acc = (i) => {
    const a = j.accessors[i], bv = j.bufferViews[a.bufferView], n = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type] * a.count, off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    return new T(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + n * T.BYTES_PER_ELEMENT));
  };
  const pr = j.meshes?.[0]?.primitives?.[0]; if (pr?.attributes?.POSITION === undefined) throw new Error(`${path}: no mesh`);
  const pos = Float64Array.from(acc(pr.attributes.POSITION)), tris = pr.indices !== undefined ? Uint32Array.from(acc(pr.indices)) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
  const joints = {}, skin = j.skins?.[0];
  if (skin?.inverseBindMatrices === undefined) throw new Error(`${path}: no skin (the fit places the template by the mesh's joints)`);
  const ibm = acc(skin.inverseBindMatrices);
  skin.joints.forEach((ni, k) => { joints[String(j.nodes[ni].name).replace(/^mixamorig\d*:?/, '')] = originOf(ibm.subarray(k * 16, k * 16 + 16)); });
  return { pos, tris, joints };
}
/** the origin of a joint whose inverse bind matrix is m (column-major): the translation of m's inverse */
function originOf(a) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return [(a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det];
}

// ── the template ───────────────────────────────────────────────────────────────────────────────────────────────
const tpl = JSON.parse(readFileSync(TPL, 'utf8')), base = generate({}), B = base.positions, NV = tpl.verts, TJ = base.joints;
if (B.length / 3 !== NV) throw new Error(`the template has ${NV} vertices, the generator makes ${B.length / 3}`);
const parts = vertexParts(), partOf = (v) => PART_NAMES[parts[v]];
const boneNames = tpl.bones.map((b) => b.name), W = Float64Array.from(tpl.w, (x) => x / 255);
const ttris = []; for (const f of tpl.faces) for (let k = 1; k < f.length - 1; k++) ttris.push(f[0], f[k], f[k + 1]);
const nbrs = Array.from({ length: NV }, () => new Set());
for (const f of tpl.faces) for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length]; nbrs[a].add(b); nbrs[b].add(a); }
const H_T = Math.max(...Array.from({ length: NV }, (_, v) => B[v * 3 + 1]));

// ── 1. align ───────────────────────────────────────────────────────────────────────────────────────────────────
const mesh = readGlb(resolve(src));
// the mesh's axes: its skeleton may be turned against its vertices (a generator's export): the frame where its
// left arm's joints lie on +x and its toes point +z, the template's
const mj = mesh.joints, need = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightArm', 'RightUpLeg'];
for (const n of need) if (!mj[n]) throw new Error(`the mesh's skeleton has no '${n}' (Mixamo names expected)`);
const side = norm(sub(mj.LeftArm, mj.RightArm)), fwd0 = sub(mj.LeftToeBase, mj.LeftFoot), up0 = norm(sub(mj.Neck, mj.Hips));
const fwd = norm(sub(fwd0, mul(up0, dot(fwd0, up0))));
// the joints' frame → the template's (x left, y up, z forward); the vertices are checked to agree
const toT = [side[0], side[1], side[2], up0[0], up0[1], up0[2], fwd[0], fwd[1], fwd[2]];
const snap = (R) => R.map((x) => (Math.abs(x) > 0.7 ? Math.sign(x) : 0));
const Rj = snap(toT);
for (const n of Object.keys(mj)) mj[n] = app(Rj, mj[n]);
// the vertices: in the template's axes already when they spread wider across x (the arms) than along z
const ext = (c) => { let a = Infinity, b = -Infinity; for (let v = 0; v < mesh.pos.length / 3; v++) { a = Math.min(a, mesh.pos[v * 3 + c]); b = Math.max(b, mesh.pos[v * 3 + c]); } return b - a; };
const vertsTurned = ext(0) < ext(2) && Rj.some((x, i) => x !== I3[i]);
if (vertsTurned) for (let v = 0; v < mesh.pos.length / 3; v++) { const p = app(Rj, at(mesh.pos, v)); mesh.pos.set(p, v * 3); }
// height: the mesh's floor to its crown, scaled to the base body's
let lo = Infinity, hi = -Infinity; for (let v = 0; v < mesh.pos.length / 3; v++) { lo = Math.min(lo, mesh.pos[v * 3 + 1]); hi = Math.max(hi, mesh.pos[v * 3 + 1]); }
const S = H_T / (hi - lo);
let cx = 0; for (let v = 0; v < mesh.pos.length / 3; v++) cx += mesh.pos[v * 3]; cx /= mesh.pos.length / 3;
const place = (p) => [(p[0] - cx) * S, (p[1] - lo) * S, p[2] * S];
for (let v = 0; v < mesh.pos.length / 3; v++) mesh.pos.set(place(at(mesh.pos, v)), v * 3);
for (const n of Object.keys(mj)) mj[n] = place(mj[n]);
const MP = mesh.pos, MT = mesh.tris, MV = MP.length / 3, MF = MT.length / 3;

// landmarks on both: the crotch (the lowest point between the legs), the shoulder joints, the head's joint, the crown
function crotchOf(P, n, knee) {
  let best = Infinity, w = 0; for (let v = 0; v < n; v++) w = Math.max(w, Math.abs(P[v * 3]));
  for (let v = 0; v < n; v++) if (Math.abs(P[v * 3]) < 0.012 * H_T && P[v * 3 + 1] > knee) best = Math.min(best, P[v * 3 + 1]);
  return best;
}
const L_T = { crotch: crotchOf(B, NV, TJ.LeftLeg.head[1]), arm: TJ.LeftArm.head[1], head: TJ.Head.head[1], crown: H_T };
const L_M = { crotch: crotchOf(MP, MV, mj.LeftLeg[1]), arm: (mj.LeftArm[1] + mj.RightArm[1]) / 2, head: mj.Head[1], crown: H_T };
const ymap = (y) => {
  const K = [[0, 0], [L_T.crotch, L_M.crotch], [L_T.arm, L_M.arm], [L_T.head, L_M.head], [L_T.crown, L_M.crown]];
  for (let k = 0; k < K.length - 1; k++) if (y <= K[k + 1][0] || k === K.length - 2) { const [a, A] = K[k], [b, Bb] = K[k + 1]; return A + ((y - a) / (b - a)) * (Bb - A); }
  return y;
};

// the fitted rest skeleton (F) and the mesh's pose of it (M): heads and tails of every template bone
const F = {}, M = {}, T = {};
for (const [n, j] of Object.entries(TJ)) T[n] = { head: [...j.head], tail: [...j.tail] };
const sideOf = (n) => (n.includes('Left') ? 'Left' : n.includes('Right') ? 'Right' : '');
const mjOf = (n) => mj[n] ?? null;
// the trunk: between the landmarks; x on the middle (the shoulders' and hips' x from the mesh)
for (const n of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End']) F[n] = { head: [0, ymap(T[n].head[1]), T[n].head[2]] };
for (const s of ['Left', 'Right']) {
  const m = s === 'Left' ? 1 : -1, sh = mjOf(s + 'Shoulder');
  F[s + 'Shoulder'] = { head: [sh ? Math.abs(sh[0]) * m : T[s + 'Shoulder'].head[0], ymap(T[s + 'Shoulder'].head[1]), T[s + 'Shoulder'].head[2]] };
  // the arm: the mesh's lengths along the template's rest directions
  const A = mj[s + 'Arm'], E = mj[s + 'ForeArm'], Wr = mj[s + 'Hand'];
  F[s + 'Arm'] = { head: [...A] };
  F[s + 'ForeArm'] = { head: add(A, mul(norm(sub(T[s + 'Arm'].tail, T[s + 'Arm'].head)), len(sub(E, A)))) };
  F[s + 'Hand'] = { head: add(F[s + 'ForeArm'].head, mul(norm(sub(T[s + 'ForeArm'].tail, T[s + 'ForeArm'].head)), len(sub(Wr, E)))) };
  // the leg: the hip joint between the landmarks (its x and z the mesh's); the knee, ankle and toes the mesh's
  const hip = mj[s + 'UpLeg'];
  F[s + 'UpLeg'] = { head: [hip[0], ymap(T[s + 'UpLeg'].head[1]), hip[2]] };
  for (const n of ['Leg', 'Foot', 'ToeBase', 'Toe_End']) F[s + n] = { head: [...(mj[s + n] ?? add(mj[s + 'ToeBase'], sub(T[s + 'Toe_End'].head, T[s + 'ToeBase'].head)))] };
}
// the hands: the template's, scaled to the mesh's hand (wrist → middle knuckle), clamped to a believable range
const handLen = (s) => (mj[s + 'HandMiddle1'] ? len(sub(mj[s + 'HandMiddle1'], mj[s + 'Hand'])) : NaN) / len(sub(T[s + 'Hand'].tail, T[s + 'Hand'].head));
const handRaw = (handLen('Left') + handLen('Right')) / 2, hand = Number.isFinite(handRaw) ? Math.min(1.25, Math.max(0.8, handRaw)) : 1;
for (const n of Object.keys(T)) if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(n)) { const s = sideOf(n); F[n] = { head: add(F[s + 'Hand'].head, mul(sub(T[n].head, T[s + 'Hand'].head), hand)) }; }
// the helpers: their source's place
for (const s of ['Left', 'Right']) { F['helper_' + s + 'Shoulder'] = { head: [...F[s + 'Arm'].head] }; F['helper_' + s + 'Hip'] = { head: [...F[s + 'UpLeg'].head] }; }
// tails: the head of the bone the template's tail meets; else the template's own end, scaled with its chain
const heads = Object.keys(T).filter((n) => !n.startsWith('helper_'));
const scaleOf = (n) => (/Hand/.test(n) ? hand : n === 'HeadTop_End' ? (L_M.crown - L_M.head) / (L_T.crown - L_T.head) : 1);
for (const n of Object.keys(T)) {
  const src = n.startsWith('helper_') ? n.replace(/^helper_(Left|Right)Shoulder$/, '$1Arm').replace(/^helper_(Left|Right)Hip$/, '$1UpLeg') : n;
  const child = heads.find((c) => c !== src && len(sub(T[c].head, T[src].tail)) < 1e-6);
  F[n].tail = child ? [...F[child].head] : add(F[src].head, mul(sub(T[src].tail, T[src].head), scaleOf(src)));
}
// the mesh's pose: the fitted skeleton with each arm turned at the shoulder, then at the elbow, onto the mesh's
const rotF2M = {};
for (const n of Object.keys(T)) rotF2M[n] = I3;
for (const s of ['Left', 'Right']) {
  const A = mj[s + 'Arm'], E = mj[s + 'ForeArm'], Wr = mj[s + 'Hand'];
  const rU = rotTo(norm(sub(F[s + 'ForeArm'].head, F[s + 'Arm'].head)), norm(sub(E, A))), rL = rotTo(norm(sub(F[s + 'Hand'].head, F[s + 'ForeArm'].head)), norm(sub(Wr, E)));
  for (const n of Object.keys(T)) {
    if (sideOf(n) !== s) continue;
    if (n === s + 'Arm' || n === 'helper_' + s + 'Shoulder') rotF2M[n] = rU;
    else if (n === s + 'ForeArm' || n.startsWith(s + 'Hand')) rotF2M[n] = rL;
  }
}
const pivotM = (n) => { const s = sideOf(n); return n === s + 'ForeArm' || n.startsWith(s + 'Hand') ? { f: F[s + 'ForeArm'].head, m: mj[s + 'ForeArm'] } : { f: F[s + 'Arm']?.head ?? [0, 0, 0], m: mj[s + 'Arm'] ?? [0, 0, 0] }; };
for (const n of Object.keys(T)) {
  const R = rotF2M[n]; if (R === I3) { M[n] = F[n]; continue; }
  const p = pivotM(n), f = (q) => add(p.m, app(R, sub(q, p.f)));
  // the forearm's chain turns about the mesh's elbow: its pivot is the fitted elbow carried by the upper arm
  M[n] = { head: f(F[n].head), tail: f(F[n].tail) };
}
// each bone's map from the template's rest (T) to the fitted rest (F): turn onto F's direction, scale along it
// (the hands and the head scale whole), then from F to the mesh's pose (M)
const bmap = Object.fromEntries(Object.keys(T).map((n) => {
  const dt = sub(T[n].tail, T[n].head), df = sub(F[n].tail, F[n].head), lt = len(dt), lf = len(df);
  const R = rotTo(norm(dt), norm(df)), s = lt > 1e-9 ? lf / lt : 1, whole = /Hand|^Head/.test(n), axis = norm(dt);
  const toF = (p) => { const q = sub(p, T[n].head), a = dot(q, axis), r = whole ? mul(q, s) : add(q, mul(axis, a * (s - 1))); return add(F[n].head, app(R, r)); };
  const Rm = rotF2M[n], toM = (q) => (Rm === I3 ? q : add(M[n].head, app(Rm, sub(q, F[n].head))));
  return [n, { toF, toM, Rm }];
}));
const blend = (v, fn) => { let o = [0, 0, 0]; for (let s = 0; s < 4; s++) { const w = W[v * 4 + s]; if (!w) continue; o = add(o, mul(fn(boneNames[tpl.j[v * 4 + s]]), w)); } return o; };
const XF = Array.from({ length: NV }, (_, v) => blend(v, (n) => bmap[n].toF(at(B, v))));
const XM = Array.from({ length: NV }, (_, v) => blend(v, (n) => bmap[n].toM(bmap[n].toF(at(B, v)))));

// ── the mesh's parts: each triangle by its nearest bone of the mesh's pose (M), as groups that may meet ──────────
const groupOf = (n) => {
  const s = sideOf(n), b = n.replace(/^helper_/, '').replace(/^(Left|Right)/, '');
  if (/^(Hips|Spine|Spine1|Spine2)$/.test(b)) return 'spine';
  if (b === 'Shoulder') return 'shoulder' + s;
  if (/^(Neck)$/.test(b)) return 'neck';
  if (/^(Head|HeadTop_End)$/.test(b)) return 'head';
  if (/^(Arm|ForeArm)$/.test(b)) return 'arm' + s;
  if (/^Hand/.test(b)) return 'hand' + s;
  if (/^(UpLeg|Leg|Hip)$/.test(b)) return 'leg' + s;
  return 'foot' + s;
};
const MEETS = { spine: ['legLeft', 'legRight', 'shoulderLeft', 'shoulderRight', 'neck'], neck: ['head', 'spine', 'shoulderLeft', 'shoulderRight'], head: ['neck'] };
for (const s of ['Left', 'Right']) { MEETS['shoulder' + s] = ['spine', 'neck', 'arm' + s]; MEETS['arm' + s] = ['shoulder' + s, 'hand' + s]; MEETS['hand' + s] = ['arm' + s]; MEETS['leg' + s] = ['spine', 'foot' + s]; MEETS['foot' + s] = ['leg' + s]; }
const segs = Object.keys(T).filter((n) => !n.startsWith('helper_')).map((n) => ({ n, g: groupOf(n), a: M[n].head, b: M[n].tail }));
const segDist = (p, a, b) => { const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1))); return len(sub(p, add(a, mul(ab, t)))); };
const triGroup = new Array(MF), triN = new Array(MF);
for (let f = 0; f < MF; f++) {
  const a = at(MP, MT[f * 3]), b = at(MP, MT[f * 3 + 1]), c = at(MP, MT[f * 3 + 2]), m = mul(add(add(a, b), c), 1 / 3);
  let best = Infinity, g = 'spine'; for (const s of segs) { const d = segDist(m, s.a, s.b); if (d < best) { best = d; g = s.g; } }
  triGroup[f] = g; triN[f] = norm(cross(sub(b, a), sub(c, a)));
}
const byGroup = {}; for (let f = 0; f < MF; f++) (byGroup[triGroup[f]] ??= []).push(f);

// ── 2. pull ────────────────────────────────────────────────────────────────────────────────────────────────────
const normalsOf = (P) => { const N = Array.from({ length: NV }, () => [0, 0, 0]); for (let t = 0; t < ttris.length; t += 3) { const [a, b, c] = [ttris[t], ttris[t + 1], ttris[t + 2]], n = cross(sub(P[b], P[a]), sub(P[c], P[a])); for (const v of [a, b, c]) N[v] = add(N[v], n); } return N.map(norm); };
const NM = normalsOf(XM);
function rayTri(o, d, f) {
  const a = at(MP, MT[f * 3]), b = at(MP, MT[f * 3 + 1]), c = at(MP, MT[f * 3 + 2]), e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det, s = sub(o, a), u = dot(s, p) * inv; if (u < 0 || u > 1) return null;
  const q = cross(s, e1), w = dot(d, q) * inv; if (w < 0 || u + w > 1) return null;
  return dot(e2, q) * inv;
}
function closestOnTri(p, f) {
  const a = at(MP, MT[f * 3]), b = at(MP, MT[f * 3 + 1]), c = at(MP, MT[f * 3 + 2]), ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, mul(ab, d1 / (d1 - d3)));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, mul(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, mul(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const dn = 1 / (va + vb + vc); return add(a, add(mul(ab, vb * dn), mul(ac, vc * dn)));
}
const LIMIT = 0.06 * (H_T / 1.73);
const handShare = (v) => { let h = 0; for (let s = 0; s < 4; s++) if (/Hand/.test(boneNames[tpl.j[v * 4 + s]])) h += W[v * 4 + s]; return h; };
const dominant = (v) => { let best = 0, bw = -1; for (let s = 0; s < 4; s++) if (W[v * 4 + s] > bw) { bw = W[v * 4 + s]; best = tpl.j[v * 4 + s]; } return boneNames[best]; };
const how = { ray: 0, closest: 0, missed: 0, hand: 0 };
const DM = Array.from({ length: NV }, (_, v) => {
  if (handShare(v) > 0.99 || ['finger', 'thumb'].includes(partOf(v))) { how.hand++; return null; }
  const g = groupOf(dominant(v)), allowed = new Set([g, ...(MEETS[g] ?? [])]);
  // its own bones' groups too (a vertex shared by the hip and the thigh may meet either)
  for (let s = 0; s < 4; s++) if (W[v * 4 + s] > 0.2) allowed.add(groupOf(boneNames[tpl.j[v * 4 + s]]));
  const o = XM[v], n = NM[v]; let best = null;
  for (const gg of allowed) for (const f of byGroup[gg] ?? []) {
    const t = rayTri(o, n, f); if (t === null || Math.abs(t) > LIMIT || dot(triN[f], n) < 0.2) continue;
    if (!best || Math.abs(t) < Math.abs(best)) best = t;
  }
  if (best !== null) { how.ray++; return mul(n, best); }
  let cb = null, cd = LIMIT;
  for (const gg of allowed) for (const f of byGroup[gg] ?? []) { const q = closestOnTri(o, f), d = len(sub(q, o)); if (d < cd) { cd = d; cb = sub(q, o); } }
  if (cb) { how.closest++; return cb; }
  how.missed++; return null;
});
// back into the rest pose: the move turned back by the vertex's bones (blended), then onto the fitted rest place
let off = Array.from({ length: NV }, (_, v) => {
  const d = DM[v], hs = Math.min(1, handShare(v));
  const back = d ? blend(v, (n) => app(tr(bmap[n].Rm), d)) : [0, 0, 0];
  return add(sub(XF[v], at(B, v)), mul(back, 1 - hs));
});

// ── 3. smooth ──────────────────────────────────────────────────────────────────────────────────────────────────
const decal = new Set(tpl.decal?.vids ?? []);
const skel = (v) => sub(XF[v], at(B, v));                      // what the skeleton alone moves (no surface pull)
const lap = (O, passes, k, only) => { for (let p = 0; p < passes; p++) { const nx = O.map((o) => [...o]); for (let v = 0; v < NV; v++) { if (only && !only(v)) continue; let m = [0, 0, 0], c = 0; for (const u of nbrs[v]) { m = add(m, O[u]); c++; } if (c) nx[v] = add(mul(O[v], 1 - k), mul(m, k / c)); } O = nx; } return O; };
// measure before smoothing: spikes (a vertex's move far from its neighbours'), the face decal's roughness
const roughness = (O, set) => { const r = []; for (const v of set) { let m = [0, 0, 0], c = 0; for (const u of nbrs[v]) { m = add(m, O[u]); c++; } r.push(len(sub(O[v], mul(m, 1 / c)))); } return r; };
const all = [...Array(NV).keys()], SPIKE = 0.012;
const spikes0 = roughness(off, all).map((r, v) => [r, v]).filter(([r]) => r > SPIKE);
const spikeParts = {}; for (const [, v] of spikes0) spikeParts[partOf(v)] = (spikeParts[partOf(v)] ?? 0) + 1;
const faceRough0 = Math.max(0, ...roughness(off, decal));
off = lap(off, 4, 0.5);
// the face: only the head's broad shape (the decal is painted on a smooth face): its pull smoothed hard
const headish = (v) => ['head', 'neck'].includes(partOf(v));
let pull = off.map((o, v) => sub(o, skel(v)));
const pullSmooth = lap(pull, 30, 0.6, headish);
for (const v of decal) pull[v] = pullSmooth[v];
// the decal's rim blends into the rest of the head
for (const v of all) if (!decal.has(v) && headish(v) && [...nbrs[v]].some((u) => decal.has(u))) pull[v] = mul(add(pull[v], pullSmooth[v]), 0.5);
off = off.map((_, v) => add(skel(v), pull[v]));
const CAP = { decal: 0.012, hand: 0.004 };
for (const v of all) {
  const cap = decal.has(v) ? CAP.decal : ['finger', 'thumb'].includes(partOf(v)) || handShare(v) > 0.5 ? CAP.hand : Infinity, p = sub(off[v], skel(v)), l = len(p);
  if (l > cap) off[v] = add(skel(v), mul(p, cap / l));
}

// the soles stay on the floor (a thin toe pulled to the mesh's top surface turns its faces over): the height's
// move fades to none at the floor
for (const v of all) if (partOf(v) === 'foot') { const y = B[v * 3 + 1], k = Math.min(1, Math.max(0, y / 0.04)); off[v][1] *= k * k * (3 - 2 * k); }

// ── 4. measure and write ───────────────────────────────────────────────────────────────────────────────────────
const fitted = all.map((v) => add(at(B, v), off[v]));
const spikes1 = roughness(off, all).filter((r) => r > SPIKE).length, faceRough1 = Math.max(0, ...roughness(off, decal));
let flipped = 0; const flips = {}; for (let t = 0; t < ttris.length; t += 3) { const [a, b, c] = [ttris[t], ttris[t + 1], ttris[t + 2]]; const n0 = cross(sub(at(B, b), at(B, a)), sub(at(B, c), at(B, a))), n1 = cross(sub(fitted[b], fitted[a]), sub(fitted[c], fitted[a])); if (dot(n0, n1) <= 0) { flipped++; flips[partOf(a)] = (flips[partOf(a)] ?? 0) + 1; } }
// how near the fitted surface, carried into the mesh's pose, lies to the mesh (the body's own vertices, not the hands)
const resid = []; for (const v of all) { if (handShare(v) > 0.5 || ['finger', 'thumb'].includes(partOf(v))) continue; const p = blend(v, (n) => bmap[n].toM(fitted[v])); let d = Infinity; for (let f = 0; f < MF; f++) d = Math.min(d, len(sub(closestOnTri(p, f), p))); resid.push(d); }
resid.sort((a, b) => a - b); const pct = (q) => resid[Math.min(resid.length - 1, Math.floor(q * resid.length))];
// the hands: no finger collapsed (each finger's bone lengths kept to within 30 %)
let handBad = 0; for (const n of Object.keys(T)) if (/Hand(Thumb|Index|Middle|Ring|Pinky)[1-3]$/.test(n)) { const r = len(sub(F[n].tail, F[n].head)) / len(sub(T[n].tail, T[n].head)); if (r < 0.7 || r > 1.3) handBad++; }
// how near the fitted surface (in the mesh's pose) comes to the mesh: the moves' leftovers
const mags = off.map(len), moved = mags.filter((m) => m > 0.001).length, mean = mags.reduce((a, b) => a + b, 0) / NV, max = Math.max(...mags);
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const name = opt('--name', basename(src).replace(/\.[^.]+$/, ''));
const jointsOut = Object.fromEntries(Object.keys(T).map((n) => [n, { head: sub(F[n].head, T[n].head).map(r4), tail: sub(F[n].tail, T[n].tail).map(r4) }]));
const fit = { v: 1, name, verts: NV, d: off.flatMap((o) => o.map(r4)), joints: jointsOut };
mkdirSync(OUT, { recursive: true });
const file = join(OUT, 'fit.json'), json = JSON.stringify(fit);
writeFileSync(file, json);
const cm = (x) => `${(x * 100).toFixed(1)} cm`;
console.log(`humans fit '${name}' → ${file} (${(json.length / 1024).toFixed(0)} KB)
  mesh: ${MV} vertices, ${MF} triangles, ${Object.keys(mj).length} joints${vertsTurned ? ' (its vertices turned to its skeleton\'s frame)' : ''}; scaled ×${S.toFixed(3)} to ${H_T.toFixed(3)} m
  landmarks (template → mesh): crotch ${L_T.crotch.toFixed(3)} → ${L_M.crotch.toFixed(3)} · shoulder joints ${L_T.arm.toFixed(3)} → ${L_M.arm.toFixed(3)} · head joint ${L_T.head.toFixed(3)} → ${L_M.head.toFixed(3)} m
  the mesh's own hip joints at ${mj.LeftUpLeg[1].toFixed(3)} m, placed at ${F.LeftUpLeg.head[1].toFixed(3)} m; hands ×${hand.toFixed(2)} (measured ×${handRaw.toFixed(2)})
  lengths (template → fitted): thigh ${cm(len(sub(T.LeftLeg.head, T.LeftUpLeg.head)))} → ${cm(len(sub(F.LeftLeg.head, F.LeftUpLeg.head)))} · shin ${cm(len(sub(T.LeftFoot.head, T.LeftLeg.head)))} → ${cm(len(sub(F.LeftFoot.head, F.LeftLeg.head)))} · upper arm ${cm(len(sub(T.LeftForeArm.head, T.LeftArm.head)))} → ${cm(len(sub(F.LeftForeArm.head, F.LeftArm.head)))} · forearm ${cm(len(sub(T.LeftHand.head, T.LeftForeArm.head)))} → ${cm(len(sub(F.LeftHand.head, F.LeftForeArm.head)))}
  pulled: ${how.ray} along the normal, ${how.closest} to the closest point, ${how.missed} missed (kept on the skeleton), ${how.hand} hand vertices kept
  moved: ${moved} of ${NV} vertices; offset mean ${cm(mean)}, max ${cm(max)}
  defects before smoothing: ${spikes0.length} spikes (> ${cm(SPIKE)} off their neighbours: ${Object.entries(spikeParts).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}); face decal roughness ${cm(faceRough0)}
  after: ${spikes1} spikes, face decal roughness ${cm(faceRough1)}, ${flipped} faces flipped${flipped ? ` (${Object.entries(flips).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}, ${handBad} finger bones off their length
  the fitted surface to the mesh: median ${cm(pct(0.5))}, 95 % within ${cm(pct(0.95))}, max ${cm(resid[resid.length - 1])}
  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
