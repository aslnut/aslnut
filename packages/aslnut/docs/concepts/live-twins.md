# Live twins: streams, history, scenarios, partners

> Draft under discussion. Interface and structure only.

**In one line:** a live twin takes **streams** of changes (add, update, remove), keeps a **chronicle** so you can see the state at any time and replay it, lets you branch **scenarios** (base vs variant) and compare them, and can run beside an **external engine** (a simulation server, an FMI model) that it trades values with each step.

## Why

- **Twins mirror something real that keeps changing:** vehicles, chargers, sensors, grid loads.
- **"What happened at 08:15?"** needs history, not only the latest value.
- **"What if we add 40 chargers?"** needs a variant beside the base, compared.
- **Big models already exist elsewhere** (a fleet simulation's own engine, plant models in FMI); aslnut should draw and steer them, not rewrite them.

## The rules

1. **Streams** deliver changes by id: `upsert` (add or replace), `patch` (change some props), `remove`. They come from WebSocket, SSE, polling, or your function.
2. **Every change has a time.** The **chronicle** logs them, keeps checkpoints, and answers `stateAt(t)`.
3. **Replay** moves the world's clock back; every element shows the state at that time.
4. **Scenarios:** `base` is reality; a `variant` overrides data, params or rules. `diff` lists what differs; `compare` shows two side by side or as a difference layer.
5. **Partners** are external engines. Each step aslnut sends inputs and receives outputs, on a fixed exchange: in lock-step, or loosely with interpolation.
6. Everything is visible to `when` and styles via `s.time` and `s.world.scenario`.

```tree
live/
├── streams/
│   ├── upsert
│   ├── patch
│   └── remove
├── transports/
│   ├── websocket
│   ├── sse
│   ├── poll
│   └── custom
├── chronicle/
│   ├── log
│   ├── checkpoints
│   ├── state-at
│   └── replay
├── scenarios/
│   ├── base
│   ├── variant
│   ├── diff
│   └── compare
└── partners/
    ├── external-engine
    ├── fmi
    ├── exchange
    └── sync/
        ├── lockstep
        └── loose
```

Plain meanings: **co-simulation** = two programs simulate together, trading values each step; **FMI** = a standard file format (FMU) for packaged simulation models from engineering tools; **checkpoint** = a saved full state, so replay doesn't start from zero.

## Examples

```ts
// 1 · a stream of vehicles: upsert / patch / remove by id; each change a sample of the set's log (drive.data)
const fleet = data.stream('wss://…/fleet', { id: d => d.vin });
const moving = drive.data(fleet, { log: { values: { soc: 'u8' } } });
w.add(entities({ id: 'fleet', drive: moving, shape: cars.pickup.make(), color: { value: 'soc', ramp: 'rdylgn' }, gauge: { value: 'soc', label: true } }));
fleet.upsert({ vin: 'B1234', lon: 107.61, lat: -6.9, soc: .62 });
fleet.patch('B1234', { soc: .58 });

// 2 · history: the state at a time, and replay on the world's clock
const at815 = moving.log.stateAt('2026-10-11T08:15:00+07:00');
replay(w, { from: '2026-10-11T08:00:00+07:00', to: '2026-10-11T09:00:00+07:00', speed: 30, play: true });

// 3 · scenarios: 40 more chargers, compared with today
const more = w.scenario('more-chargers', { base: 'today', set: { chargers: chargers.concat(new40) } });
const d = await w.scenario.diff('today', 'more-chargers');   // what changed
w.scenario.compare('today', 'more-chargers', { view: 'split' }); // or 'difference'

// 4 · a partner: an external engine runs the traffic, aslnut draws it
w.partner('fleet', {
  url: 'wss://sim.example/step',             // an external engine (e.g. a fleet simulation's own engine)
  send:    s => ({ t: s.time.t, closures: s.world.closures }),
  receive: out => fleet.upsertMany(out.vehicles),
  sync: 'lockstep', step: 1,                  // one second per exchange
});
w.partner('chiller', fmi('/models/chiller.fmu', { inputs: { load: 'building.load' } }));
```

## How it relates

- **[Data](data.md):** streams are data sources; recording and replay come from the loader.
- **[Physics](physics.md):** sensors compare fields with live feeds.
- **[Entities](entities.md):** streams drive entities.
- **[Lanes](../reference/core/runtime.md):** partners run in their own lane, off the frame.

## Common mistakes

- **Replacing the whole dataset on each message.** Send `patch` by id.
- **Keeping history in your own arrays.** The chronicle makes replay and `stateAt` work everywhere.

## Open questions

- How long does the chronicle keep data in the browser, and where does older history live?
- For lock-step partners: what happens when the external engine is slower than the frame?

## Status

| part | status |
|---|---|
| live mode, record and replay in the loader | [built] (the loader's modes; live data streams are planned) |
| streams with upsert / patch / remove | [planned] |
| the log, `stateAt`, replay | [built] (core › data › history; a set moved by it: core › entities › sets) |
| checkpoints, epochs | [planned] |
| scenarios, diff, compare | [planned] |
| partners, FMI | [planned] |
