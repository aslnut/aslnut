// modules › presets › humans › body › fit: a body fitted to a base mesh's silhouette. Per vertex, the offset that takes
// the base body (generate({})) onto the mesh's surface, and per bone the offsets of its head and tail, made offline by
// tools/humans-fit.mjs. The offsets go on top of the sliders' own moves, so every slider still works on the fitted
// body (female, heavy, muscular, elder, tall…); the template's topology, skeleton, weights, correctives, hair and
// garments are kept. A fit is data (fit.json), never bundled.
//   const fit = await loadFit('/data/packs/humans/fit.json')
//   humanFigure(tpl, { body: { gender_female: 1 }, fit })        · fitBody(generate({ muscular: 0.5 }), fit)
import { AslnutError } from '../../../../core/world/errors.ts';
import type { Joint } from './generator.ts';

export interface BodyFit {
  v: 1;
  /** what it was made from (the mesh's name) */
  name: string;
  /** the vertices it fits (the template's) */
  verts: number;
  /** an offset per vertex (3 a vertex, metres, the figure's axes) */
  d: Float32Array;
  /** the joints' offsets, by bone */
  joints: Record<string, Joint>;
  /** what tells one fit from another (a figure's key) */
  key: string;
}
const bad = (what: string) => new AslnutError('E-LOAD-005', `humans fit: ${what}`, { fix: 'make the fit again with tools/humans-fit.mjs <mesh.glb>' });
/** check and type a fit's JSON (fit.json); `verts`: the vertices it must fit (a template's) */
export function parseFit(j: unknown, verts?: number): BodyFit {
  const f = j as { v?: number; name?: string; verts?: number; d?: ArrayLike<number>; joints?: Record<string, Joint> };
  if (!f || f.v !== 1) throw bad('not a version 1 fit');
  if (!f.verts || !f.d || f.d.length !== f.verts * 3) throw bad(`${f.d?.length ?? 0} offsets for ${f.verts ?? 0} vertices (3 a vertex)`);
  if (verts !== undefined && f.verts !== verts) throw bad(`it fits ${f.verts} vertices, the body has ${verts}`);
  const d = Float32Array.from(f.d);
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i]!)) throw bad(`offset ${i} is not a number`);
  // its key: its name and a hash of its numbers
  let h = 2166136261; const u = new Uint32Array(d.buffer); for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i]!, 16777619);
  return { v: 1, name: f.name ?? 'fit', verts: f.verts, d, joints: f.joints ?? {}, key: `${f.name ?? 'fit'}:${(h >>> 0).toString(36)}` };
}
/** load a fit (fit.json); `fetcher` for your own loading */
export async function loadFit(url: string, fetcher: (u: string) => Promise<Response> = (u) => fetch(u), verts?: number): Promise<BodyFit> {
  const r = await fetcher(url);
  if (!r.ok) throw new AslnutError('E-DATA-002', `humans fit: ${url} answered ${r.status}`, { fix: 'serve the fit (tools/humans-fit.mjs writes it)' });
  return parseFit(await r.json(), verts);
}
/** a generated body with a fit on top (its positions and joints moved; the sliders' moves kept); no fit: as it is */
export function fitBody<G extends { positions: Float32Array; joints: Record<string, Joint> }>(g: G, fit?: BodyFit | null): G {
  if (!fit) return g;
  const n = g.positions.length / 3;
  if (fit.verts !== n) throw bad(`it fits ${fit.verts} vertices, the body has ${n}`);
  const positions = new Float32Array(g.positions.length);
  for (let i = 0; i < positions.length; i++) positions[i] = g.positions[i]! + fit.d[i]!;
  const joints: Record<string, Joint> = {};
  for (const [name, j] of Object.entries(g.joints)) {
    const o = fit.joints[name];
    joints[name] = o ? { head: [j.head[0] + o.head[0], j.head[1] + o.head[1], j.head[2] + o.head[2]], tail: [j.tail[0] + o.tail[0], j.tail[1] + o.tail[1], j.tail[2] + o.tail[2]] } : j;
  }
  return { ...g, positions, joints };
}
