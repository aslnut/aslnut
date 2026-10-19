// The recipes page: ?go=<recipe> runs one of the authoring guide's recipes (docs/authoring.md), each a complete script
// written as a person writes it (import … from 'aslnut', a canvas, a world). The links switch between them.
//   ?go=gis-view | district-twin | fleet | analysis | own-kind | own-thing      &graphics=auto | webgpu | webgl2   &dpr=1
// (trials/: scripts a model wrote from the guide, scored by tools/smoke-recipes.mjs; git-ignored)
declare const __BUILD__: number;
const BUILD = typeof __BUILD__ === 'number' ? __BUILD__ : 0;
const ORDER = ['gis-view', 'district-twin', 'fleet', 'analysis', 'own-kind', 'own-thing'];
const scripts = import.meta.glob(['./*.ts', '!./main.ts', '!./aslnut.ts', './trials/*.ts']);
const q = new URLSearchParams(location.search);
const go = q.get('go') ?? ORDER[0]!;
const key = Object.keys(scripts).find((k) => k === `./${go}.ts` || k === `./trials/${go}.ts`);
const link = (name: string) => { const u = new URLSearchParams(q); u.set('go', name); return `?${u}`; };
const nav = document.getElementById('recipes')!;
nav.innerHTML = `${ORDER.map((n) => `<a href="${link(n)}" class="${n === go ? 'on' : ''}">${n}</a>`).join('')}<span class="build">build ${BUILD}</span>`;
if (q.get('nav') === '0') nav.style.display = 'none';
if (!key) throw new Error(`no recipe '${go}': ${ORDER.join(', ')}`);
await scripts[key]!();
