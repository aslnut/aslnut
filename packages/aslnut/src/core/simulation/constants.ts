// core › simulation › constants: citable parameter tables. Every value with its unit and where it comes from, so a
// model's numbers can be shown, checked and replaced. Tables: 'materials' (surfaces of a street: albedo, emissivity,
// evaporation, heat capacity, conductivity, water held), 'physics' (the constants the phenomena use). Your own tables
// join them (constants.add: for the whole process; a world's own: w.constants.add, or any scope: constants.scope()).
//   constants.load('materials').asphalt.albedo            → { value: 0.08, unit: '', source: '…' }
//   constants.get('physics.sigma')                       → 5.67e-8
//   heat({ …, rasters: { …, materials: constants.materials(['asphalt', 'grass']) } })
//   w.constants.add('materials', { asphalt: { … } })        this world's alone (cityHeat(tiles, { constants: w.constants }))
import { AslnutError } from '../world/errors.ts';
import { LAMBDA, MATERIALS, RHO_CP, SIGMA, WALL, Z0, K0, type Material } from './phenomena/heat/physics.ts';

export interface Constant { value: number; unit: string; source: string; label?: string }
export type Table = Record<string, Record<string, Constant>>;
const TYP = 'typical published values (Oke et al. 2017, Urban Climates; TEB / SUEWS tables), rounded';
const UNITS: Record<string, [string, string]> = {
  albedo: ['', 'the share of sunlight reflected'], emissivity: ['', 'how well it radiates heat (1: a black body)'],
  evap: ['', 'the share of its available energy that goes into evaporation'], storage: ['', 'the share stored into the ground (the quick balance)'],
  rhoC: ['J/m³K', 'volumetric heat capacity'], k: ['W/mK', 'thermal conductivity'], waterCap: ['mm', 'water it holds after rain'],
};
const fromMaterial = (m: Material): Record<string, Constant> => {
  const out: Record<string, Constant> = {};
  for (const [k, [unit, label]] of Object.entries(UNITS)) out[k] = { value: (m as unknown as Record<string, number>)[k]!, unit, label, source: m.source ?? TYP };
  return out;
};
const tables = new Map<string, Table>();
tables.set('materials', Object.fromEntries([...Object.values(MATERIALS), WALL].map((m) => [m.id, fromMaterial(m)])));
tables.set('physics', {
  sigma: { value: { value: SIGMA, unit: 'W/m²K⁴', label: 'the Stefan–Boltzmann constant', source: 'CODATA 2018' } },
  kelvin: { value: { value: K0, unit: 'K', label: '0 °C in kelvin', source: 'SI' } },
  rhoCp: { value: { value: RHO_CP, unit: 'J/m³K', label: 'air: density × specific heat near the ground', source: 'Oke et al. 2017' } },
  lambda: { value: { value: LAMBDA, unit: 'J/kg', label: 'latent heat of vaporisation at 20 °C', source: 'Oke et al. 2017' } },
  z0: { value: { value: Z0, unit: 'm', label: "a suburb's roughness length", source: 'Grimmond & Oke 1999' } },
  gravity: { value: { value: 9.80665, unit: 'm/s²', label: 'standard gravity', source: 'CGPM 1901' } },
});

/** a table with another's entries over it, value by value (an entry given in part keeps its other values) */
const merged = (a: Table, b: Table): Table => { const out: Table = { ...a }; for (const [e, v] of Object.entries(b)) out[e] = { ...(a[e] ?? {}), ...v }; return out; };
/** citable tables: the process's (`constants`), or a scope of them (`constants.scope()`, a world's `w.constants`):
 *  a scope reads its own tables over its parent's, and what is added to it stays in it */
export class Constants {
  private own = new Map<string, Table>();
  private parent: Constants | null;
  constructor(parent: Constants | null = null, seed?: Map<string, Table>) { this.parent = parent; if (seed) this.own = seed; }
  /** a table by name: entries → their values by key, each { value, unit, source } (a scope's entries over its parent's) */
  load(name: string): Table {
    const up = this.parent?.has(name) ? this.parent.load(name) : null, mine = this.own.get(name);
    const t = up && mine ? merged(up, mine) : mine ?? up;
    if (!t) throw new AslnutError('E-DATA-001', `no constants table '${name}' (there are ${this.names().join(', ')})`, { fix: "constants.load('materials')" });
    return t;
  }
  private has(name: string): boolean { return this.own.has(name) || !!this.parent?.has(name); }
  /** one number by its path: 'materials.asphalt.albedo', or 'physics.sigma' (a table whose entries have one value) */
  get(path: string): number {
    const [table, entry, key = 'value'] = path.split('.'), v = table && entry && this.has(table) ? this.load(table)[entry]?.[key] : undefined;
    if (!v) throw new AslnutError('E-DATA-001', `no constant '${path}'`, { fix: "constants.get('materials.asphalt.albedo')" });
    return v.value;
  }
  /** the tables there are */
  names(): string[] { return [...new Set([...(this.parent?.names() ?? []), ...this.own.keys()])]; }
  /** your own table (or more entries in one): every value with its unit and source. On `constants` it is the process's
   *  (every world, every scope sees it); on a scope (a world's `w.constants`) it is that scope's alone */
  add(name: string, t: Table): void {
    for (const [e, vals] of Object.entries(t)) for (const [k, c] of Object.entries(vals)) if (!(typeof c?.value === 'number' && typeof c.unit === 'string' && typeof c.source === 'string')) throw new AslnutError('E-DATA-001', `constants '${name}.${e}.${k}' needs { value, unit, source }`, { fix: "{ albedo: { value: 0.1, unit: '', source: 'my measurements' } }" });
    this.own.set(name, merged(this.own.get(name) ?? {}, t));
  }
  /** a scope over these tables: it reads them (and what is added to them later), and keeps what is added to it to itself */
  scope(): Constants { return new Constants(this); }
  /** heat model materials from the 'materials' table (their values as the table holds them now), by id */
  materials(ids: string[]): Material[] {
    const t = this.load('materials');
    return ids.map((id) => {
      const base = MATERIALS[id] ?? (id === WALL.id ? WALL : null), row = t[id];
      if (!row) throw new AslnutError('E-DATA-001', `no material '${id}' in the constants`, { fix: `one of ${Object.keys(t).join(', ')}` });
      const m: Material = { ...(base ?? { id, label: id, color: '#888888', albedo: 0, emissivity: 0, evap: 0, storage: 0, rhoC: 0, k: 0, waterCap: 0 }) };
      for (const k of Object.keys(UNITS)) if (row[k]) (m as unknown as Record<string, number>)[k] = row[k]!.value;
      m.source = row.albedo?.source ?? m.source;
      return m;
    });
  }
}
/** the process's tables: what every world and scope reads (`constants.add` here: for every one of them) */
export const constants = new Constants(null, tables);
