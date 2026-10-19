// core › interaction › picking › hover (and signals › selection): a 3D form on the hovered thing and on each selected
// one. A layer says which (`hover: { shape }`, `selected: { shape }`): your shape for the thing's datum (a wire
// sphere the size of a tree's crown, a ghost box round a building), standing where the thing stands (its foot on the
// ground, turned as it is), in the shape's own material or one given; `follow`: it moves with a thing that moves.
// The forms are a layer of their own (made on first need: none set, nothing made), never picked themselves.
//   streets({ …, hover: { color: '#ffe066', shape: (d) => crownNet(d.props), material: 'wire' } })
import { Solids } from '../../geometry/shapes/solids.ts';
import type { FrameContext, FormVisual, Picked, ThingPlace } from '../../world/element.ts';
import { codeOf } from '../../render/look/materials.ts';
import { INSTANCE_FLOATS, SHAPE_FLOATS } from '../../geometry/shapes/mesh.ts';

type Levels = readonly unknown[];
export class FormMarks extends Solids {
  private forms = new Map<string, { f: Picked; vis: FormVisual; levels: Levels; place: ThingPlace; placeOf: (f: Picked) => ThingPlace | null }>();
  private recoloured = new WeakMap<object, Map<number, Levels>>();
  constructor() { super({ id: 'forms', hover: false, shadows: false, fade: 0 }); }
  /** show (or with null take away) the form under a key ('hover', 'sel:<id>') */
  set(key: string, f: Picked | null, vis: FormVisual | false | undefined, placeOf: (f: Picked) => ThingPlace | null): void {
    if (!f || !vis || !vis.shape) { if (this.forms.delete(key)) this.drop(key); return; }
    const place = placeOf(f); if (!place) { if (this.forms.delete(key)) this.drop(key); return; }
    const made = vis.shape(f.d, place); if (!made) { if (this.forms.delete(key)) this.drop(key); return; }
    const levels = vis.material !== undefined ? this.inMaterial(made.levels, codeOf(vis.material)) : made.levels;
    this.forms.set(key, { f, vis, levels, place, placeOf });
    this.put(key, { origin: [place.at[0], place.at[1]], at: [0, 0], free: true, instances: [{ shape: levels as never, data: this.data(place) }], info: () => null });
  }
  has(key: string): boolean { return this.forms.has(key); }
  keysShown(): string[] { return [...this.forms.keys()]; }
  private data(p: ThingPlace): Float32Array { const d = new Float32Array(INSTANCE_FLOATS); d.set([0, 0, p.at[2], 0, 1, 1, 1, p.turn, 0xffffff, 0]); return d; }
  /** the shape's levels with every vertex in one material (made once per shape and material) */
  private inMaterial(levels: Levels, code: number): Levels {
    let by = this.recoloured.get(levels); if (!by) this.recoloured.set(levels, (by = new Map()));
    let out = by.get(code);
    if (!out) {
      out = levels.map((l) => { if (!(l instanceof Float32Array)) return l; const c = Float32Array.from(l); for (let i = 5; i < c.length; i += SHAPE_FLOATS) if (c[i]! < 65536) c[i] = code; return c; });
      by.set(code, out);
    }
    return out;
  }
  override frame(ctx: FrameContext) {
    // forms that follow their thing: placed again each frame
    for (const [key, x] of this.forms) {
      if (!x.vis.follow) continue;
      const p = x.placeOf(x.f); if (!p) continue;
      if (p.at[0] !== x.place.at[0] || p.at[1] !== x.place.at[1] || p.at[2] !== x.place.at[2] || p.turn !== x.place.turn) {
        x.place = p; this.put(key, { origin: [p.at[0], p.at[1]], at: [0, 0], free: true, instances: [{ shape: x.levels as never, data: this.data(p) }], info: () => null });
      }
    }
    // never picked themselves (the thing under them is)
    return super.frame(ctx).map((d) => ({ ...d, pickProgram: undefined }));
  }
  /** a form that follows its thing asks for no frames itself: the thing's own layer does while it moves (on screen),
   *  and the form is placed again on each of them (a selected thing standing still costs nothing) */
  override animating(): boolean { return super.animating(); }
}
