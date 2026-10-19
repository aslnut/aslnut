import { defineConfig } from 'vite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as llms } from './docs/_tree/llms.mjs';

// The examples: every build bumps BUILD, shown on every example page. Built into dist-examples/, with relative paths
// (any static host serves them). Two build-time switches, both off when empty:
//   ASLNUT_EXAMPLES_LOG=<url>      each page posts its log there (JSON lines, batched): a phone checked from afar
//   ASLNUT_EXAMPLES_RESULTS=<url>  the performance suite posts its results there (the whole run as JSON)
const root = import.meta.dirname;
const building = process.argv.includes('build') && process.env.EXAMPLES_KEEP_BUILD !== '1';
const BUILD = Number(readFileSync(resolve(root, 'BUILD'), 'utf8')) + (building ? 1 : 0);
if (building) writeFileSync(resolve(root, 'BUILD'), `${BUILD}\n`);
// `import … from 'aslnut'` (the recipes, written as a person writes them): the package's own source, its subpaths too
// ('aslnut/modules/presets/vehicles'); the bare name through the recipes page's harness (examples/recipes/aslnut.ts:
// the package, each world it makes noted for the checks). tsc reads the same names through tsconfig's paths. A recipe
// is a script (it runs for what it does, it exports nothing): kept whole, though the package says it has no side effects.
const self = {
  name: 'aslnut-self',
  enforce: 'pre' as const,
  transform(code: string, id: string) { return /\/examples\/recipes\/(trials\/)?[\w-]+\.ts$/.test(id) ? { code, map: null, moduleSideEffects: true } : null; },
  // llms.txt at the site's root (the authoring guide, the recipes, the imports, the API index: made now from its sources)
  async generateBundle() { (this as unknown as { emitFile(f: object): void }).emitFile({ type: 'asset', fileName: 'llms.txt', source: await llms() }); },
  resolveId(id: string) {
    if (id === 'aslnut') return resolve(root, 'examples/recipes/aslnut.ts');
    const m = /^aslnut\/(.+)$/.exec(id);
    if (m) for (const f of [`src/${m[1]}/index.ts`, `src/${m[1]}.ts`]) if (existsSync(resolve(root, f))) return resolve(root, f);
    return null;
  },
};
export default defineConfig({
  root,
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD), __LOG__: JSON.stringify(process.env.ASLNUT_EXAMPLES_LOG ?? ''), __RESULTS__: JSON.stringify(process.env.ASLNUT_EXAMPLES_RESULTS ?? '') },
  plugins: [self],
  build: {
    outDir: process.env.EXAMPLES_OUT ?? 'dist-examples', emptyOutDir: true, target: 'es2022', sourcemap: true, minify: false,
    rollupOptions: { input: { 'hello-earth': resolve(root, 'examples/hello-earth/index.html'), suite: resolve(root, 'examples/suite/index.html'), 'healthy-city': resolve(root, 'examples/healthy-city/index.html'), primitives: resolve(root, 'examples/primitives/index.html'), roads: resolve(root, 'examples/roads/index.html'), fleet: resolve(root, 'examples/fleet/index.html'), layers: resolve(root, 'examples/layers/index.html'), lego: resolve(root, 'examples/lego/index.html'), recipes: resolve(root, 'examples/recipes/index.html'), journey: resolve(root, 'examples/journey/index.html'), react: resolve(root, 'examples/react/index.html') } },
  },
  server: { port: 5190, host: true },
});
