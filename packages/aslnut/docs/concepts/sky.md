# Sky: sun, moon, stars, atmosphere, weather

> Draft under discussion. Interface and structure only.

**In one line:** for any place and time, aslnut puts the sun, moon and stars where they really are, lights the scene from them, colours the sky through the atmosphere, adds weather from a preset or a feed, and can **lock** the picture (a fixed time or light) for a shot.

## Why

- **Shadows and light are data:** solar panels, street heat, a building's shade at 15:00 in June.
- **Night matters:** city lights, moon, stars.
- **Weather changes the picture:** haze, rain and fog are part of what people see.

## The rules

1. **The sky follows the world clock and the camera's place:** `sun`, `moon` and `stars` positions are computed, not set.
2. **Lighting comes from the sky:** the sun's direction and colour, sky light, moonlight at night.
3. **The atmosphere** scatters light (blue day, red sunset), adds haze with distance, and clouds.
4. **Weather** is a preset (`clear`, `haze`, `rain`, `storm`, `fog`) or a feed (wind, rain, cloud cover) per place and time.
5. **Picture locks** fix part of it for a shot: `lock: { time: '15:00' }`, `lock: { light: 'golden-hour' }`, `lock: { weather: 'clear' }`, while the rest keeps running.
6. **Constellation lines** come per culture.
7. Lite quality: a fixed sun and a gradient; realistic: scattering and shadows (see [quality](quality.md)).

```tree
sky/
├── sun
├── moon/
│   ├── position
│   └── phase
├── stars
├── cultures
├── atmosphere/
│   ├── scattering
│   ├── haze
│   └── clouds
├── weather/
│   ├── presets/
│   │   ├── clear
│   │   ├── haze
│   │   ├── rain
│   │   ├── storm
│   │   └── fog
│   ├── wind
│   ├── rain
│   └── fog
└── locks/
    ├── time
    ├── light
    └── weather
```

Plain meanings: **scattering** = how air bends light (why the sky is blue and sunsets are red); **haze** = the fading of far things into the sky's colour.

## Examples

```ts
// 1 · the true sky for Bandung, now
const w = await world(canvas, { body: earth({ sky: sky({ atmosphere: true, stars: true }) }), time: 'now' });

// 2 · weather from a preset, then from a feed
w.sky.weather('haze', { level: .6 });
w.sky.weather(data.stream('wss://…/weather'), { wind: 'wind_ms', rain: 'rain_mm' });

// 3 · a picture lock for a capture, while the clock keeps going
w.sky.lock({ light: 'golden-hour', weather: 'clear' });
await w.capture({ size: [1920, 1080] });
w.sky.unlock();

// 4 · Sundanese constellations at night
w.sky.stars({ culture: 'sundanese', lines: true, when: { hour: [19, 5] } });
```

## How it relates

- **[Space](space.md):** the same sun, moon and stars, seen from the ground.
- **[Quality](quality.md):** lite vs realistic sky.
- **[Physics](physics.md):** sun and weather drive heat and water fields.

## Common mistakes

- **A fixed light direction in a twin with time.** Use the sky's sun.
- **Changing the clock to get a nice light for a capture.** Use a lock; data stays at its real time.

## Status

| part | status |
|---|---|
| sun position, haze, a star field | [partly] (stars and the glow round the globe; sun and haze planned) |
| moon, cultures, scattering, clouds | [planned] |
| weather presets and feeds | [planned] (a reference implementation has basin haze and weather) |
| picture locks | [planned] |
