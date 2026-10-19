// core › geometry › shapes › recipes › package: a shape made to be shared. A package is its build (a Shape), what it is
// (id, name, version, licence, author), its params' named presets, the joints its parts turn on and the poses they
// take (kinematics and states: data that core › entities › kinematics drives), and pictures of it (thumbs). On disk
// it is a folder:
//   shape.ts      the build (its module's default export is the package: shapePackage({ … }))
//   shape.json    what it is: { id, name, version, licence, author?, about?, tags? } (read without loading the code)
//   presets.json  { name: params }
//   kinematics.ts { joint: { part, kind, axis, limits? } } · states.ts { state: { joint: value } } (optional)
//   thumbs/       a picture per preset (optional) · test.ts (pkg.check()) · LICENCE
// A world keeps the packages it uses: w.shapes.use(pkg); a catalogue (JSON listing each package's module, served
// next to it) loads them: await w.shapes.load('/shapes/catalogue.json').
//   const pkg = shapePackage({ info, shape: car, presets, kinematics, states }); pkg.make('pickup'); pkg.check().ok
import { AslnutError } from '../../world/errors.ts';
import type { Made, ParamSpec, ParamsOf, Shape, ShapeCheck } from './shape.ts';
import { preset } from './recipes.ts';
import type { V3 } from './parts.ts';

/** what a package is (shape.json) */
export interface PackageInfo {
  id: string; name: string; version: string;
  /** an SPDX id ('Apache-2.0', 'CC-BY-4.0') */
  licence: string;
  author?: string; about?: string; tags?: string[];
  /** a picture per preset (urls, relative to the package) */
  thumbs?: Record<string, string>;
}
/** a joint a part turns or slides on (core › entities › kinematics drives it): a wheel spins (and steers), a hinge
 *  turns within its limits (degrees), a slider moves along its axis (m) */
export interface JointSpec { part: string; kind: 'wheel' | 'hinge' | 'slider'; axis: 'x' | 'y' | 'z' | V3; limits?: [number, number]; /** a wheel's: metres, or the param that gives it */ radius?: number | string; steer?: boolean }
/** a pose of its joints by name: { doorL: 70 } (degrees, metres) */
export type StateSpec = Record<string, number>;
export interface PackageSpec<D extends Record<string, ParamSpec>, X = object> {
  info: PackageInfo;
  shape: Shape<D, X>;
  presets?: Record<string, Partial<ParamsOf<D>>>;
  kinematics?: Record<string, JointSpec>;
  states?: Record<string, StateSpec>;
}
export interface PackageCheck { ok: boolean; problems: string[]; shape: ShapeCheck; presets: Record<string, { triangles: number[] }> }
export class ShapePackage<D extends Record<string, ParamSpec> = Record<string, ParamSpec>, X = object> {
  readonly info: PackageInfo; readonly shape: Shape<D, X>;
  readonly presets: Readonly<Record<string, Partial<ParamsOf<D>>>>;
  readonly kinematics: Readonly<Record<string, JointSpec>>; readonly states: Readonly<Record<string, StateSpec>>;
  private named = new Map<string, Shape<D, X>>();
  constructor(o: PackageSpec<D, X>) {
    const i = o?.info;
    if (!i || typeof i.id !== 'string' || !i.id || typeof i.name !== 'string' || typeof i.version !== 'string' || typeof i.licence !== 'string') throw new AslnutError('E-DATA-001', `a shape package needs info { id, name, version, licence } (got ${JSON.stringify(i ?? null)})`, { fix: "shapePackage({ info: { id: 'bin', name: 'Wheelie bin', version: '1.0.0', licence: 'Apache-2.0' }, shape: bin })" });
    if (!o.shape || typeof o.shape.make !== 'function') throw new AslnutError('E-DATA-001', `shape package '${i.id}' needs a shape`, { where: i.id, fix: 'shapePackage({ info, shape: shape({ params, build }) })' });
    this.info = i; this.shape = o.shape; this.presets = o.presets ?? {}; this.kinematics = o.kinematics ?? {}; this.states = o.states ?? {};
  }
  get id(): string { return this.info.id; }
  /** a preset as a shape of its own (its params the defaults: preset(shape, name, params)) */
  preset(name: string): Shape<D, X> {
    const p = this.presets[name];
    if (!p) throw new AslnutError('E-DATA-001', `shape package '${this.id}' has no preset '${name}'`, { where: this.id, fix: `one of: ${Object.keys(this.presets).join(', ') || 'none'}` });
    let s = this.named.get(name); if (!s) this.named.set(name, (s = preset(this.shape, name, p)));
    return s;
  }
  /** built: a preset by name, or params over the defaults */
  make(p: string | Partial<ParamsOf<D> & X> = {}, seed = 1): Made {
    return typeof p === 'string' ? this.preset(p).make({}, seed) : this.shape.make(p, seed);
  }
  /** the package checked: its shape (shape.check()), every preset built, every joint on a part the shape has (and a
   *  pivot), every state's joints known and within their limits, its licence named */
  check(withExtra: Partial<X> = {}): PackageCheck {
    const problems: string[] = [], sh = this.shape.check(withExtra), presets: PackageCheck['presets'] = {};
    problems.push(...sh.problems);
    if (!/^[A-Za-z0-9.+-]+( (OR|AND) [A-Za-z0-9.+-]+)*$/.test(this.info.licence)) problems.push(`licence '${this.info.licence}' is not an SPDX id`);
    const parts = new Set(this.shape.make(withExtra as never).parts.map((x) => x.name));
    for (const [name] of Object.entries(this.presets)) {
      try { const m = this.preset(name).make(withExtra as never); presets[name] = { triangles: m.triangles }; for (const x of m.parts) parts.add(x.name); } catch (e) { problems.push(`preset '${name}': ${(e as Error).message}`); }
    }
    for (const [j, k] of Object.entries(this.kinematics)) {
      if (!parts.has(k.part)) problems.push(`joint '${j}' turns part '${k.part}', which the shape has not (${[...parts].join(', ') || 'no parts'})`);
      if (k.limits && !(k.limits[0] <= k.limits[1])) problems.push(`joint '${j}': limits ${k.limits} are not [least, most]`);
      if (k.kind === 'wheel' && !(typeof k.radius === 'string' ? k.radius in (this.shape.spec.params ?? {}) : Number(k.radius) > 0)) problems.push(`wheel '${j}' needs a radius (metres, or a param's name)`);
    }
    for (const [s, pose] of Object.entries(this.states)) for (const [j, v] of Object.entries(pose)) {
      const k = this.kinematics[j];
      if (!k) problems.push(`state '${s}' poses joint '${j}', which the package has not`);
      else if (k.limits && (v < k.limits[0] || v > k.limits[1])) problems.push(`state '${s}': ${j} = ${v} is outside its limits ${k.limits}`);
    }
    return { ok: !problems.length, problems, shape: sh, presets };
  }
}
/** a shape package: its info, shape, presets, kinematics and states */
export const shapePackage = <D extends Record<string, ParamSpec>, X = object>(o: PackageSpec<D, X>) => new ShapePackage<D, X>(o);
const isPackage = (x: unknown): x is ShapePackage => x instanceof ShapePackage || (!!x && typeof (x as ShapePackage).make === 'function' && !!(x as ShapePackage).info?.id && typeof (x as ShapePackage).check === 'function');

/** a catalogue: the packages it lists, each its module (an ES module whose default export is the package) and,
 *  optionally, its info (shape.json) to list without loading it */
export interface ShapeCatalogue { packages: { id: string; module: string; info?: string | PackageInfo }[] }
/** the packages a world uses (w.shapes): by id, made by preset or params; a catalogue loads more */
export class ShapeShelf {
  private by = new Map<string, ShapePackage>();
  /** keep packages here (one of the same id is replaced) */
  use(...pkgs: ShapePackage<never, never>[]): this {
    for (const p of pkgs) {
      if (!isPackage(p)) throw new AslnutError('E-DATA-001', 'w.shapes.use takes shape packages (shapePackage({ info, shape }))', { fix: 'w.shapes.use(cars.package)' });
      // one definition: a package of the same id again (an edit) updates the shape every layer holds (one rebuild each)
      const old = this.by.get(p.id); if (old && old.shape !== (p as unknown as ShapePackage).shape) old.shape.update((p as unknown as ShapePackage).shape.spec);
      this.by.set(p.id, old ? Object.assign(Object.create(Object.getPrototypeOf(p)), p, { shape: old.shape }) : (p as unknown as ShapePackage));
    }
    return this;
  }
  has(id: string): boolean { return this.by.has(id); }
  get(id: string): ShapePackage {
    const p = this.by.get(id);
    if (!p) throw new AslnutError('E-DATA-001', `no shape package '${id}' here`, { where: id, fix: `w.shapes.use(pkg) or w.shapes.load(catalogue) first; here: ${[...this.by.keys()].join(', ') || 'none'}` });
    return p;
  }
  /** a package's shape built: a preset by name, or params */
  make(id: string, p: string | Record<string, unknown> = {}, seed = 1): Made { return this.get(id).make(p as never, seed); }
  /** what is here */
  list(): PackageInfo[] { return [...this.by.values()].map((p) => p.info); }
  /** load a catalogue's packages (each module imported, its package kept); `only` some of them. Its modules come
   *  from your server: load only catalogues you trust */
  async load(url: string, o: { only?: string[]; import?: (url: string) => Promise<Record<string, unknown>>; fetch?: (url: string) => Promise<ShapeCatalogue> } = {}): Promise<PackageInfo[]> {
    const base = new URL(url, typeof location !== 'undefined' ? location.href : 'file:///');
    const cat = o.fetch ? await o.fetch(base.href) : await (async () => { const r = await fetch(base.href); if (!r.ok) throw new AslnutError('E-DATA-002', `catalogue ${url}: ${r.status}`, { where: url, fix: 'check the url' }); return r.json() as Promise<ShapeCatalogue>; })();
    if (!cat || !Array.isArray(cat.packages)) throw new AslnutError('E-DATA-001', `catalogue ${url} has no packages list`, { where: url, fix: '{ "packages": [{ "id": "car", "module": "./car/shape.js" }] }' });
    const imp = o.import ?? ((u: string) => import(/* @vite-ignore */ u) as Promise<Record<string, unknown>>), got: PackageInfo[] = [];
    for (const e of cat.packages) {
      if (o.only && !o.only.includes(e.id)) continue;
      const mod = await imp(new URL(e.module, base).href), pkg = (mod.default ?? mod.package) as unknown;
      if (!isPackage(pkg)) throw new AslnutError('E-DATA-001', `catalogue ${url}: '${e.module}' exports no shape package`, { where: e.id, fix: 'export default shapePackage({ info, shape })' });
      if (pkg.id !== e.id) throw new AslnutError('E-DATA-001', `catalogue ${url}: '${e.module}' is package '${pkg.id}', listed as '${e.id}'`, { where: e.id, fix: 'the same id in the catalogue and shape.json' });
      this.by.set(pkg.id, pkg); got.push(pkg.info);
    }
    return got;
  }
}
