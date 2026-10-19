// core › data › rights: a provider's terms as capabilities the loader enforces, not cache preferences.
//   show      it may be drawn
//   prefetch  it may be fetched before it is on screen (views ahead, ensure, a document's preparation)
//   keep      it may be written to a cache scope or a pack (memory for the page's life is always allowed)
//   export    it may go into an exported pack or a capture
// The services' own policies decide these: the public OSM tile server and Esri World Imagery are show only.

export interface Terms { show: boolean; prefetch: boolean; keep: boolean; export: boolean }
export const SHOW_ONLY: Readonly<Terms> = Object.freeze({ show: true, prefetch: false, keep: false, export: false });
export const OPEN: Readonly<Terms> = Object.freeze({ show: true, prefetch: true, keep: true, export: true });
export type Capability = keyof Terms;
export const termsOf = (t?: Partial<Terms>, base: Readonly<Terms> = OPEN): Terms => ({ ...base, ...t });
