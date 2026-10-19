// modules › presets › humans › body › template: what every generated body shares, loaded once from a pack. The faces
// over the body's fixed vertex order, the skin weights (4 bones a vertex), the bones (names and rest places on the
// base body), the helper bones and correctives, the face decal, the hair styles (made on the base body, re-fitted to
// each head). A template is data, never bundled: a pack of a few hundred kilobytes (gzip ~60 KB).
//   const tpl = await loadTemplate('/data/packs/humans/template.json')
import { AslnutError } from '../../../../core/world/errors.ts';
import type { BoneSpec } from '../../../../core/entities/body/skeleton.ts';

/** a mesh skinned like the body: positions on the base body (3 a vertex), triangles, 4 bones and 4 weights (0…255) a
 *  vertex */
export interface SkinPiece { pos: ArrayLike<number>; tris: ArrayLike<number>; j: ArrayLike<number>; w: ArrayLike<number> }
/** a corrective: a shape the body takes on top of the pose, by how far a joint bends (its weight: smoothstep(from, to,
 *  the measure)) */
export interface CorrectiveRule { key: string; bone: string; measure: 'flex' | 'abduct' | 'twist' | 'abduct_flex'; from: number; to: number }
export interface Template {
  v: 1;
  /** vertices of every body */
  verts: number;
  /** faces (quads and triangles) over the vertices */
  faces: number[][];
  /** the bones, parents first, at rest on the base body */
  bones: BoneSpec[];
  /** 4 bones and 4 weights (0…255) a vertex */
  j: Uint8Array; w: Uint8Array;
  /** helper bones: each follows its source by a share of its rotation (a hip, a shoulder half way) */
  helpers: { bone: string; source: string; factor: number }[];
  /** correctives: the shapes (vertex ids and their offsets) and the rules that weigh them */
  correctives: Record<string, { idx: number[]; d: number[] }>;
  rules: CorrectiveRule[];
  /** the face decal: body vertices pushed out along the normal, with their own texture coordinates over the face */
  decal: { vids: number[]; uv: [number, number][]; tris: number[]; offset: number };
  /** hair styles, by name */
  hair: Record<string, SkinPiece>;
}

/** check and type a template's JSON (a pack's template.json) */
export function parseTemplate(j: unknown): Template {
  const t = j as Template & { j: number[] | Uint8Array; w: number[] | Uint8Array };
  const bad = (what: string) => new AslnutError('E-LOAD-005', `humans template: ${what}`, { fix: 'build the pack with tools/humans-pack.mjs' });
  if (!t || t.v !== 1) throw bad('not a version 1 template');
  if (!Array.isArray(t.faces) || !Array.isArray(t.bones) || !t.verts) throw bad('faces, bones or verts missing');
  if (t.j.length !== t.verts * 4 || t.w.length !== t.verts * 4) throw bad('4 joints and 4 weights a vertex');
  return { ...t, j: Uint8Array.from(t.j), w: Uint8Array.from(t.w), helpers: t.helpers ?? [], correctives: t.correctives ?? {}, rules: t.rules ?? [], hair: t.hair ?? {} };
}
/** load a template (a pack's template.json); `fetcher` for your own loading (a cache, a worker) */
export async function loadTemplate(url: string, fetcher: (u: string) => Promise<Response> = (u) => fetch(u)): Promise<Template> {
  const r = await fetcher(url);
  if (!r.ok) throw new AslnutError('E-DATA-002', `humans template: ${url} answered ${r.status}`, { fix: 'serve the humans pack (tools/humans-pack.mjs writes it)' });
  return parseTemplate(await r.json());
}
