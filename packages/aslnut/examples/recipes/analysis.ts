// An analysis view: the world muted to a dark blue-grey, districts coloured by a rate from one colour scale (quantile
// classes from the whole data) with their names inside the same layer, a legend that follows the data, a tooltip; the
// rows come from a query that runs again when the year changes, so the slider recolours the map (the shapes stay, only
// the changed colours ease).
import { data, earth, imagery, layer, legend, scale, terrain, theme, world } from 'aslnut';

// your data: the districts' shapes, and an API giving a row per district for a year ({ code, rate })
const DISTRICTS = 'data/districts.geojson';
const statsFor = async (year: number) => (await fetch(`data/stats-${year}.json`)).json();

const canvas = document.querySelector('canvas')!;
const w = await world(canvas, {
  body: earth({ imagery: [imagery.esri({ layer: 'light' })], terrain: [terrain.mapzen()] }),
  view: { lon: 145.1215, lat: -37.9235, zoom: 13.2, tilt: 25, bearing: 0 },
  theme: theme.dark(), // the world muted; elements marked `subject: true` keep their colours
});

// a knob of your own: the year (a slider, a timeline or an assistant sets it with w.set('stats.year', 2021))
w.param('stats.year', { type: 'number', range: [2019, 2025], default: 2025 }, () => {});

// the rows for the year: asked again whenever the year changes; joined to the shapes by their code
const districts = data.geojson(DISTRICTS, { id: 'code' });
const stats = data.query((s) => statsFor(Number(s.world.params['stats.year'])), { deps: (s) => s.world.params['stats.year'], id: 'code' });

// one statement: the districts coloured by their rate, with their names (the classes read from every district, again
// only when the rows change: never by the view)
w.add(layer({
  id: 'rate', label: 'Rate per 1,000', subject: true, data: districts.join(stats, { on: 'code' }),
  area: { color: scale.quantile((d) => Number(d.props.rate), { n: 5, range: 'viridis' }), opacity: 0.85, outline: { color: '#ffffff88', width: 1 }, restyle: 0.4 },
  labels: { text: (d) => String(d.props.name), size: 11, color: '#f1f5f9' },
  hover: { color: '#ffffff', mix: 0.3 }, tooltip: (d) => `${d.props.name}\n${d.props.rate} per 1,000`,
}));
legend(w, { for: 'rate', title: 'Rate per 1,000' });

// the year slider: setting the param runs the query again, and the map recolours
const slider = Object.assign(document.createElement('input'), { type: 'range', min: '2019', max: '2025', step: '1', value: '2025' });
Object.assign(slider.style, { position: 'fixed', right: '12px', bottom: '28px', zIndex: '10', width: '160px' });
slider.oninput = () => w.set('stats.year', Number(slider.value));
document.body.append(slider);
