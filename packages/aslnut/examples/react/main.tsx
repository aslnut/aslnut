// react: aslnut in a React app, written as an app writes it. <World> (aslnut/react) makes the world when it mounts and
// disposes it when it unmounts; its elements are aslnut's own (layer, line, extrusion, entities) made in render and kept
// in step by id. A town on a flat floor: its blocks a GIS layer coloured by kind or by rate (a React state: the button
// restyles the layer in the world, setProps, nothing built again), its streets, its buildings in the twin's view (in
// the list only there: added, removed), and a fleet of vans driving rounds from a log. A tap opens a React panel
// (useWorldEvent('tap')); the status line reads the world (useWorld).
//   ?go=map | twin   &graphics=auto | webgpu | webgl2   &dpr=2
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { drive, entities, extrusion, layer, line, plane, replay, scale, type Feature, type Picked, type View, type World as AslnutWorld, type WorldOptions } from 'aslnut';
import { World, useWorld, useWorldEvent } from 'aslnut/react';
import { cars } from 'aslnut/modules/presets/vehicles';
import { BLOCKS, BUILDINGS, KINDS, STREETS, TOWN, VIEWS, fleetLog } from './town.ts';

declare const __BUILD__: number;
const BUILD = typeof __BUILD__ === 'number' ? __BUILD__ : 0;
const q = new URLSearchParams(location.search);
const GRAPHICS = (q.get('graphics') ?? 'auto') as WorldOptions['graphics'];
const DPR = q.get('dpr') ? Number(q.get('dpr')) : undefined;
type ViewName = keyof typeof VIEWS;

// made once, outside the component: the ground, the fleet's log and its drive, the scales and functions the elements
// use (made again in render they would be new props each time: a restyle each render)
const BODY = plane({ size: 6000, grid: false, color: '#eef0f2', beyond: [0.933, 0.941, 0.949] });
const LOG = fleetLog();
const DRIVE = drive.data(LOG);
const VAN = cars.make({ type: 'van' });
// (a van is drawn as a van at every distance, never under 10 px long: a small town on a phone)
const NEAR = { pixels: 0, size: { min: 10 }, shadow: true };
const BY_KIND = scale.category((d: Feature) => String(d.props.kind), { domain: [...KINDS], range: ['#f59e0b', '#ef4444', '#6366f1', '#22c55e', '#06b6d4'] });
const BY_RATE = scale.quantile((d: Feature) => Number(d.props.rate), { n: 5, range: ['#bfd7ee', '#7fb2dc', '#4a8cc8', '#2563a8', '#173f75'] });
const NAME = (d: Feature) => String(d.props.name);
const HEIGHT = (d: Feature) => 3.4 * Number(d.props.levels);
const VAN_TIP = (d: { id: string | number; state?: { values: Record<string, number> } | null }) => `${d.id} · charge ${Math.round((d.state?.values.charge ?? 0) * 100)} %`;

declare global { interface Window { aslnutDemo?: { w: AslnutWorld; worlds: number } } }
let worlds = 0;

function App() {
  const [colour, setColour] = useState<'kind' | 'rate'>('kind');
  const [view, setView] = useState<ViewName>(q.get('go') === 'twin' ? 'twin' : 'map');
  const [error, setError] = useState<string | null>(null);
  // the map's view: the town fitted to this screen, once the world knows its size
  const [fitted, setFitted] = useState<View | null>(null);
  return (
    <World
      className="world" style={{ position: 'absolute', inset: 0 }}
      options={{ body: BODY, view: view === 'map' ? fitted ?? VIEWS.map : VIEWS.twin, graphics: GRAPHICS, pixelRatio: DPR, onError: (e) => setError(String((e as Error)?.message ?? e)) }}
      viewChange={{ seconds: 1.6 }}
      elements={[
        layer({ id: 'blocks', label: 'Blocks', data: BLOCKS, tooltip: NAME, hover: { color: '#ffffff', mix: 0.3 }, drape: 'ground',
          area: { color: colour === 'kind' ? BY_KIND : BY_RATE, opacity: 0.85, outline: { color: '#ffffff', width: 1.5 } },
          labels: { text: NAME, size: 11 } }),
        line({ id: 'streets', data: STREETS, color: '#c3c8cf', width: 1.5 }),
        ...(view === 'twin' ? [extrusion({ id: 'buildings', data: BUILDINGS, height: HEIGHT, color: '#e7e7e4' })] : []),
        entities({ id: 'fleet', drive: DRIVE, shape: VAN, near: NEAR, color: { value: 'charge', ramp: 'rdylgn', domain: [0, 1] }, size: 7,
          outline: { color: '#ffffff', width: 1.5 }, trail: { seconds: 40, width: 3 }, tooltip: VAN_TIP }),
      ]}
      onReady={(w) => {
        worlds++; window.aslnutDemo = { w, worlds };
        const fit = w.viewToFit(TOWN, { padding: 0.03 });
        if (view === 'map') w.go(fit);
        setFitted(fit);
        replay(w, { log: LOG, speed: 4, loop: true, play: true });
      }}
    >
      <header className="bar">
        <b>aslnut · React</b>
        <div className="seg" role="group" aria-label="view">
          {(['map', 'twin'] as const).map((v) => <button key={v} data-view={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v}</button>)}
        </div>
        <div className="seg" role="group" aria-label="colour by">
          {(['kind', 'rate'] as const).map((c) => <button key={c} data-colour={c} className={colour === c ? 'on' : ''} onClick={() => setColour(c)}>{c}</button>)}
        </div>
        <Status />
      </header>
      <Panel />
      {error && <div className="err" role="alert">{error}</div>}
    </World>
  );
}

/** the graphics drawing it and the build (the world from context) */
function Status() {
  const w = useWorld();
  return <span className="status">{w ? <span className={w.api}>{w.api === 'webgpu' ? 'WebGPU' : w.api === 'webgl2' ? 'WebGL2' : w.api}</span> : 'starting…'} · build {BUILD}</span>;
}

/** what a tap found: a block's name and numbers, or a van and its charge */
function Panel() {
  const [picked, setPicked] = useState<Picked | null>(null);
  useWorldEvent('tap', (p) => setPicked(p));
  if (!picked) return null;
  const van = picked.element === 'fleet', d = picked.d as { id?: string | number; state?: { values: Record<string, number> } | null };
  const rows: [string, string][] = van
    ? [['charge', `${Math.round((d.state?.values.charge ?? 0) * 100)} %`]]
    : Object.entries(picked.props).filter(([k]) => k !== 'name').map(([k, v]) => [k, String(v)]);
  return (
    <aside className="panel" aria-label="what is here">
      <header><b>{van ? String(d.id ?? picked.id) : String(picked.props.name ?? picked.id)}</b><button onClick={() => setPicked(null)} aria-label="close">×</button></header>
      <table><tbody>{rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
    </aside>
  );
}

createRoot(document.getElementById('app')!).render(<StrictMode><App /></StrictMode>);
