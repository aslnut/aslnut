/** Build-time entry points, kept out of the visitor's world bundle. */
export { compile, type RoadCompileOptions } from './modules/world/earth/presets/built/roads/compile.ts';
export { BakeGateError } from './core/runtime/workers/compile/gates.ts';
export type { PatchPolicy, PatchRule, PatchOptions } from './core/runtime/workers/compile/patch-policy.ts';
export { catalog, Catalog, entryOf, packAsset, unpackAsset, safePath, kindOfFiles, typeOf, form, CODE_FILES, ASSET_KINDS } from './tools/catalog.ts';
export type { AssetKind, CatalogEntry, CatalogFile, CatalogQuery, UnpackedAsset, FormControl, FormSource, KnobSpec } from './tools/catalog.ts';
