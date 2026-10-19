// modules › presets › humans and core › entities › body on the CPU: the generated body against the reference it was
// exported with (every slider, the joints, symmetry); dual-quaternion skinning keeps a bent joint's volume where
// linear blending collapses it; people from seeds are the same every time and diverse across many; figures, clips,
// grounding and correctives; the walker keeps to its network. The tests that need the humans pack (data, not in git)
// skip without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate, MORPH_ORDER, vertexParts, parseTemplate, humanFigure, figureKey, person, restyle, paletteOf, decalOf, PEOPLE, SKIN_TONES, HAIR_STYLES, GARMENTS, packFace, express, FACE_DEFAULTS, POSES, buildGarment, type Template } from '../src/modules/presets/humans/index.ts';
import { skeleton, skinPoint, rotate, DQ_FLOATS } from '../src/core/entities/body/skeleton.ts';
import { skinMesh, rowTexels, SKIN_FLOATS } from '../src/core/entities/body/skin.ts';
import { entity, still } from '../src/core/entities/index.ts';
import { network } from '../src/core/geometry/networks/index.ts';
import { walker } from '../src/modules/presets/shared/locomotion/walker.ts';

const PACK = join(import.meta.dirname, '..', '..', '..', 'data', 'packs', 'humans');
const has = existsSync(join(PACK, 'template.json')) && existsSync(join(PACK, 'reference.json'));
const tpl: Template | null = has ? parseTemplate(JSON.parse(readFileSync(join(PACK, 'template.json'), 'utf8'))) : null;
const ref = has ? JSON.parse(readFileSync(join(PACK, 'reference.json'), 'utf8')) as { base: number[]; keys: Record<string, number[]>; bones: Record<string, number[]> } : null;
const needsPack = { skip: has ? false : 'the humans pack is not in data/packs/humans (tools/humans-pack.mjs)' };
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!)); return m; };
// the reference's names for two sliders renamed here
const RENAMED: Record<string, string> = { nose_mancung: 'nose_bridge', nose_pesek: 'nose_flat' };

test('body generator: the base, every slider and the joints match the reference within 20 µm', needsPack, () => {
  const base = generate({});
  assert.equal(base.positions.length, ref!.base.length, 'the same vertices');
  assert.ok(maxDiff(base.positions, ref!.base) < 2e-5, `base ${maxDiff(base.positions, ref!.base)}`);
  let n = 0;
  for (const [k, pos] of Object.entries(ref!.keys)) {
    const name = RENAMED[k] ?? k; assert.ok(MORPH_ORDER.includes(name), `slider ${name} exists`);
    const d = maxDiff(generate({ [name]: 1 }).positions, pos); assert.ok(d < 2e-5, `slider ${k}: ${d}`); n++;
  }
  assert.ok(n >= 20, `${n} sliders checked`);
  let jd = 0; for (const [name, h] of Object.entries(ref!.bones)) { const j = base.joints[name]; assert.ok(j, `joint ${name}`); jd = Math.max(jd, ...h.map((x, i) => Math.abs(x - j!.head[i]!))); }
  assert.ok(jd < 2e-5, `joints ${jd}`);
  assert.equal(vertexParts().length, base.positions.length / 3);
  assert.ok(Math.max(...tpl!.faces.flat()) < base.positions.length / 3, 'the template faces fit');
});

test('body generator: left and right mirror exactly; children and elders keep the topology', () => {
  const p = generate({}).positions, n = p.length / 3; let worst = 0;
  for (let i = 0; i < n; i += 3) { let best = 1e9; for (let j = 0; j < n; j++) best = Math.min(best, Math.hypot(p[i * 3]! + p[j * 3]!, p[i * 3 + 1]! - p[j * 3 + 1]!, p[i * 3 + 2]! - p[j * 3 + 2]!)); worst = Math.max(worst, best); }
  assert.ok(worst < 1e-4, `symmetry ${worst}`);
  const child = generate({ age_child: 1 }), elder = generate({ age_elder: 1 }), top = (q: Float32Array) => Math.max(...Array.from({ length: q.length / 3 }, (_, i) => q[i * 3 + 1]!));
  assert.equal(child.positions.length, p.length); assert.equal(elder.positions.length, p.length);
  assert.ok(top(child.positions) < 1.35 && top(child.positions) > 1.05, `a child stands ${top(child.positions).toFixed(2)} m`);
  assert.ok(top(p) > 1.6 && top(p) < 1.85, `an adult ${top(p).toFixed(2)} m`);
});

test('skin: dual quaternions keep a 150° fold\'s volume, linear blending collapses it; the packed vertex decodes', () => {
  // two bones: a forearm folding at y = 1, a ring of skin round the joint blended between them
  const sk = skeleton([{ name: 'upper', head: [0, 0, 0] }, { name: 'lower', parent: 'upper', head: [0, 1, 0] }]);
  const pose = sk.rest(); rotate(pose, 1, [1, 0, 0], (150 * Math.PI) / 180);
  const dq = sk.dual(pose);
  const J: number[] = [], W: number[] = [], P: number[] = [];
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; for (const y of [0.92, 1, 1.08]) { P.push(Math.cos(a) * 0.1, y, Math.sin(a) * 0.1); const t = Math.min(1, Math.max(0, (y - 0.9) / 0.2)); J.push(0, 1, 0, 0); W.push(1 - t, t, 0, 0); } }
  const radius = (linear: boolean) => { let s = 0; const o: [number, number, number] = [0, 0, 0]; for (let v = 0; v < P.length / 3; v++) { skinPoint(o, P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!, J, W, v, dq, linear); s += Math.hypot(o[0], o[1] - 1, o[2]) / Math.hypot(P[v * 3]!, P[v * 3 + 1]! - 1, P[v * 3 + 2]!); } return s / (P.length / 3); };
  const dqs = radius(false), lbs = radius(true);
  assert.ok(dqs > 0.95, `DQS keeps the radius: ${dqs.toFixed(3)}`); assert.ok(lbs < 0.85, `LBS collapses: ${lbs.toFixed(3)}`);
  // a fully weighted point turns with its bone: the tip of the lower bone folds back down
  const o: [number, number, number] = [0, 0, 0]; skinPoint(o, 0, 2, 0, [1, 0, 0, 0], [1, 0, 0, 0], 0, dq);
  assert.ok(Math.abs(o[1] - (1 + Math.cos((150 * Math.PI) / 180))) < 1e-5 && Math.abs(o[2] - Math.sin((150 * Math.PI) / 180)) < 1e-5, `tip ${o}`);
  // the packing: joints, weights, slots, texture coordinates and morph offsets survive it
  const m = skinMesh({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], joints: [3, 70, 255, 1, 0, 0, 0, 0, 2, 0, 0, 0], weights: [0.5, 0.3, 0.1, 0.1, 1, 0, 0, 0, 1, 0, 0, 0], index: [0, 1, 2], slots: [7, 0, 1], uvs: [0.25, 0.75, -1, -1, -1, -1], morphs: { a: [0.012, -0.034, 0.0005, 0, 0, 0, 0, 0, 0], b: [-0.05, 0.1, 0.2, 0, 0, 0, 0, 0, 0], pair: [1, -1, -1] } });
  const v = m.vertices, j01 = v[4]!, j23 = v[5]!;
  assert.deepEqual([j01 % 256, Math.floor(j01 / 256), j23 % 256, Math.floor(j23 / 256)], [3, 70, 255, 1]);
  assert.equal(v[6], 7); assert.equal(Math.floor(v[7]! / 4096) / 4095, Math.round(0.25 * 4095) / 4095);
  const un = (x: number) => [Math.floor(x / 4096), x - Math.floor(x / 4096) * 4096].map((q) => (q - 2048) / 10000);
  assert.deepEqual([...un(v[12]!), ...un(v[13]!), ...un(v[14]!)].map((x) => +x.toFixed(4)), [0.012, -0.034, 0.0005, -0.05, 0.1, 0.2]);
  assert.equal(v[15], 1); assert.equal(v[SKIN_FLOATS + 15], -1);
  for (const x of v) assert.ok(Math.abs(x) < 2 ** 24 && Math.fround(x) === x || Math.abs(x) < 4, 'exact in a float');
});

test('people: the same seed makes the same person; many seeds make a diverse crowd with no head coverings', () => {
  assert.deepEqual(person(42), person(42));
  assert.deepEqual(person('kiosk'), person('kiosk'));
  assert.notDeepEqual(person(42), person(43));
  const many = Array.from({ length: 400 }, (_, i) => person(i + 1));
  const ages = new Set(many.map((p) => p.age)), skins = new Set(many.map((p) => p.skin)), hair = new Set(many.map((p) => p.figure.hair)), gaits = new Set(many.map((p) => p.figure.gait));
  assert.deepEqual([...ages].sort(), ['adult', 'child', 'elder', 'teen']);
  assert.ok(new Set(many.map((p) => p.presentation)).size === 2);
  assert.equal(skins.size, SKIN_TONES.length, 'every skin tone, light to deep');
  assert.ok(hair.size >= 12, `${hair.size} hair styles`);
  assert.ok(gaits.size >= 5, `${gaits.size} gaits`);
  assert.ok(new Set(many.map((p) => p.hairColor)).size >= 12, 'hair colours');
  assert.ok(new Set(many.flatMap((p) => (p.outfit.garments ?? []).map((g) => g.type))).size >= 5, 'garments');
  const speeds = many.map((p) => p.speed); assert.ok(Math.min(...speeds) > 0.7 && Math.max(...speeds) < 1.8);
  // no head coverings ship: no garment for the head, no such hair style
  assert.ok(!Object.values(GARMENTS).some((g) => g.slot === 'head'), 'no head garment');
  assert.ok(!many.some((p) => (p.outfit.garments ?? []).some((g) => GARMENTS[g.type]?.slot === 'head')));
  assert.ok(!Object.keys(HAIR_STYLES).some((k) => /hijab|veil|scarf|cap|hat/.test(k)));
  // a restyle keeps the figure (one geometry), changes the rest
  const a = person(9), b = restyle(a, 1009);
  assert.equal(figureKey(a.figure), figureKey(b.figure)); assert.notDeepEqual(paletteOf(a), paletteOf(b));
  assert.deepEqual(restyle(a, 1009), b);
  assert.ok(Object.keys(PEOPLE).length >= 12); assert.deepEqual(new Set(Object.values(PEOPLE).map((p) => p.age)), new Set(['adult', 'teen', 'elder', 'child']));
  for (const p of Object.values(PEOPLE)) { assert.equal(paletteOf(p).length, 8); for (const x of decalOf(p)) assert.ok(Number.isInteger(x) && x >= 0 && x < 2 ** 24, 'face numbers exact in a float'); }
});

test('face: packed numbers decode as the shader reads them; emotions move them', () => {
  const nib = (v: number, at: number) => (Math.floor(v / at) - Math.floor(v / (at * 16)) * 16) / 15;
  const f = { ...FACE_DEFAULTS, eyeSize: 1, eyeOpen: 0, eyeGap: 0.4, smile: 0.8, blush: 0.2, browTilt: 1, style: 'dots' as const, iris: '#3b6ea5' };
  const [iris, a, b] = packFace(f);
  assert.equal(iris, 0x3b6ea5);
  assert.equal(nib(a, 1), 1); assert.equal(nib(a, 16), 0); assert.ok(Math.abs(nib(a, 256) - 0.4) < 0.04); assert.equal(Math.floor(a / 1048576), 1);
  assert.ok(Math.abs(nib(b, 1) - 0.8) < 0.04); assert.equal((Math.floor(b / 1048576) - Math.floor(b / 8388608) * 8 - 3) / 3, 1); assert.equal(Math.floor(b / 8388608), 1);
  const happy = express(FACE_DEFAULTS as never, 'happy'), sad = express(FACE_DEFAULTS as never, 'sad');
  assert.ok(happy.smile > FACE_DEFAULTS.smile && sad.smile < FACE_DEFAULTS.smile && sad.browTilt > 0);
});

test('figure: a person made drawable; the same spec twice is the same; walk frames stand on the floor', needsPack, () => {
  const p = PEOPLE['grandmother']!, f = humanFigure(tpl!, p.figure), g = humanFigure(tpl!, p.figure);
  assert.deepEqual(f.mesh.vertices, g.mesh.vertices); assert.deepEqual(f.mesh.index, g.mesh.index);
  const nv = f.mesh.vertices.length / SKIN_FLOATS;
  assert.ok(nv > 1600 && f.triangles > 2500 && f.triangles < 7000, `${nv} vertices, ${f.triangles} triangles`);
  assert.ok(f.clips.walk && f.clips.run && f.clips.idle && f.clips.walk.distance! > 0.6 && f.clips.run.distance! > f.clips.walk.distance!);
  // every walk frame: its lowest body point on the floor
  const c = f.clips.walk!, T = rowTexels(f.skeleton.count) * 4, V = f.mesh.vertices, J = new Uint16Array(nv * 4), W = new Float32Array(nv * 4), o: [number, number, number] = [0, 0, 0];
  for (let v = 0; v < nv; v++) { const a = V[v * SKIN_FLOATS + 4]!, b = V[v * SKIN_FLOATS + 5]!; J.set([a % 256, Math.floor(a / 256), b % 256, Math.floor(b / 256)], v * 4); W.set(V.subarray(v * SKIN_FLOATS + 8, v * SKIN_FLOATS + 12), v * 4); }
  for (let fr = 0; fr < c.frames; fr += 3) {
    const dq = c.data.subarray(fr * T, fr * T + f.skeleton.count * DQ_FLOATS); let min = Infinity;
    for (let v = 0; v < tpl!.verts; v++) { skinPoint(o, V[v * SKIN_FLOATS]!, V[v * SKIN_FLOATS + 1]!, V[v * SKIN_FLOATS + 2]!, J, W, v, dq); min = Math.min(min, o[1]); }
    assert.ok(Math.abs(min) < 2e-3, `frame ${fr}: lowest point ${min.toFixed(4)} m`);
  }
  // a squat bends the hips far: the hip correctives come on
  const rig = f.rig; POSES.squat!(rig.begin()); const fr = rig.end();
  assert.ok(fr.morphs![0]! > 0.5 && fr.morphs![2]! > 0.5, `hip flex correctives ${fr.morphs}`);
});

test('garments: a dress hides the skin under it and hangs a skirt; its weights sum to one', needsPack, () => {
  const g = generate({ gender_female: 1 }), N = new Float32Array(g.positions.length);
  for (const f of tpl!.faces) for (let k = 1; k < f.length - 1; k++) { const [a, b, c] = [f[0]!, f[k]!, f[k + 1]!].map((i) => i * 3) as [number, number, number]; const P = g.positions, ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!, vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!; for (const i of [a, b, c]) { N[i] = N[i]! + uy * vz - uz * vy; N[i + 1] = N[i + 1]! + uz * vx - ux * vz; N[i + 2] = N[i + 2]! + ux * vy - uy * vx; } }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i]!, N[i + 1]!, N[i + 2]!) || 1; N[i] = N[i]! / l; N[i + 1] = N[i + 1]! / l; N[i + 2] = N[i + 2]! / l; }
  const bone = (n: string) => tpl!.bones.findIndex((b) => b.name === n);
  const d = buildGarment({ type: 'dress', params: { length: 'ankle' } }, { P: g.positions, N, faces: tpl!.faces, j: tpl!.j, w: tpl!.w, bone })!;
  assert.ok(d.hide.size > 200, `${d.hide.size} faces hidden`); assert.equal(d.slot, 1);
  let low = Infinity; for (let i = 1; i < d.pos.length; i += 3) low = Math.min(low, d.pos[i]!); assert.ok(low < 0.2, `the hem near the ankles: ${low.toFixed(2)} m`);
  for (let v = 0; v < d.w.length / 4; v++) { const s = d.w[v * 4]! + d.w[v * 4 + 1]! + d.w[v * 4 + 2]! + d.w[v * 4 + 3]!; assert.ok(Math.abs(s - 1) < 0.02, `weights ${s}`); }
  assert.equal(buildGarment({ type: 'no-such' }, { P: g.positions, N, faces: tpl!.faces, j: tpl!.j, w: tpl!.w, bone }), null);
});

test('walker: keeps to its network, a side of the path, turns smoothly; the same seed walks the same way', () => {
  const L = 145.12, B = -37.92, kx = 111320 * Math.cos((B * Math.PI) / 180), ll = (x: number, z: number): [number, number] => [L + x / kx, B - z / 110574];
  const lines: { line: [number, number][] }[] = [];
  for (let k = -2; k <= 2; k++) for (let m = -2; m < 2; m++) { lines.push({ line: [ll(m * 30, k * 30), ll(m * 30 + 30, k * 30)] }); lines.push({ line: [ll(k * 30, m * 30), ll(k * 30, m * 30 + 30)] }); }
  const net = network({ lines, snap: 0.5 }), flat = { heightAt: () => 5, exaggeration: 1 };
  const run = (seed: number) => {
    const e = entity({ id: 'w', at: ll(0, 0), locomotion: walker({ network: net, seed, speed: 1.4, side: 0.7, pause: { chance: 0 } }) });
    const track: number[][] = []; let maxOff = 0, maxTurn = 0, h0 = e.heading;
    for (let i = 0; i < 900; i++) {
      e.locomotion.step(e, { ...still(), forward: 1 }, 1 / 30, flat, 0);
      const n = net.nearest([e.at[0], e.at[1]], { max: 50 })!; maxOff = Math.max(maxOff, n.distance);
      let dh = Math.abs(e.heading - h0) % 360; if (dh > 180) dh = 360 - dh; maxTurn = Math.max(maxTurn, dh); h0 = e.heading;
      if (i % 30 === 0) track.push([+e.at[0].toFixed(7), +e.at[1].toFixed(7)]);
    }
    return { track, maxOff, maxTurn, z: e.at[2], speed: e.speed };
  };
  const a = run(5), b = run(5), c = run(6);
  assert.deepEqual(a.track, b.track); assert.notDeepEqual(a.track, c.track);
  assert.ok(a.maxOff < 0.75, `beside its path: ${a.maxOff.toFixed(2)} m`); assert.ok(a.maxTurn < 5.5 * (180 / Math.PI) / 30 + 0.01, `turns smoothly: ${a.maxTurn.toFixed(1)}° a frame`);
  assert.equal(a.z, 5); assert.ok(Math.abs(a.speed - 1.4) < 1e-9);
  const first = a.track[0]!, last = a.track[a.track.length - 1]!; assert.ok(Math.hypot((last[0]! - first[0]!) * kx, (last[1]! - first[1]!) * 110574) > 5, 'it went somewhere');
});

test('skin draw: clips sit once in rows, a phase picks two frames and how far between; a pose of its own gets a row', async () => {
  const { SkinDraw } = await import('../src/core/entities/body/draw.ts');
  const { bakeClip, figure } = await import('../src/core/entities/body/skin.ts');
  const writes: { y: number; height: number }[] = [];
  const g = {
    caps: { maxTex: 2048 },
    buffer: () => ({ write() {}, destroy() {} }),
    texture: (d: { width: number; height: number }) => ({ desc: d, write: (_: unknown, o: { y: number; height: number }) => writes.push(o), destroy() {} }),
    program: () => ({ ready: Promise.resolve(), destroy() {} }),
  } as never;
  const sk = skeleton([{ name: 'a', head: [0, 0, 0] }, { name: 'b', parent: 'a', head: [0, 1, 0] }]);
  const walk = bakeClip(sk, 8, (t) => { const p = sk.rest(); rotate(p, 1, [1, 0, 0], t); return { pose: p }; });
  const stand = bakeClip(sk, 1, () => ({ pose: sk.rest() }), { loop: false });
  const fig = figure({ id: 'f', mesh: skinMesh({ positions: [0, 0, 0, 0, 1, 0, 0, 2, 0], joints: [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], weights: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], index: [0, 1, 2] }), skeleton: sk, clips: { walk, stand } });
  const sd = new SkinDraw(g, 'test');
  const [a, b, t] = sd.rows(fig, { clip: 'walk', at: 0.3 }, 'p1');
  assert.equal(b, a + 1); assert.ok(Math.abs(t - 0.4) < 1e-9, `between ${t}`);
  const [a2, b2] = sd.rows(fig, { clip: 'walk', at: 0.99 }, 'p1'); assert.equal(b2, a2 - 7, 'a loop wraps to its first frame');
  const [s0, s1, st] = sd.rows(fig, { clip: 'stand', at: 0 }, 'p1'); assert.equal(s0, s1); assert.equal(st, 0); assert.ok(s0 >= 8, 'a clip of its own rows');
  const mixed = sd.rows(fig, { clip: 'walk', at: 0.5, to: { clip: 'stand', at: 0, mix: 0.25 } }, 'p1'); assert.equal(mixed[1], s0); assert.equal(mixed[2], 0.25);
  const live = { pose: sk.rest() }, r1 = sd.rows(fig, { pose: live, key: 1 }, 'me'), r2 = sd.rows(fig, { pose: live, key: 1 }, 'me'), r3 = sd.rows(fig, { pose: live }, 'you');
  assert.equal(r1[0], r2[0]); assert.notEqual(r1[0], r3[0]); assert.equal(r1[0], r1[1]);
  // the rows go up at the next draw, once
  sd.draws({ frame: {} } as never, [], {} as never, []); assert.ok(writes.length >= 1);
  const n = writes.length; sd.draws({ frame: {} } as never, [], {} as never, []); assert.equal(writes.length, n, 'nothing new: nothing written');
  sd.rows(fig, { pose: live, key: 2 }, 'me'); sd.draws({ frame: {} } as never, [], {} as never, []); assert.equal(writes.length, n + 1); assert.equal(writes[n]!.y, r1[0]); assert.equal(writes[n]!.height, 1);
});
