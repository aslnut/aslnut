// A GIS view: Esri's light grey map on the terrain, a WMS picture (planning zones) and WFS features of every geometry
// type (polygons, multipolygons, lines, multilines, multipoints, points) from a public map and feature service, each
// loaded once over the area and each with a tooltip; the suburbs and their names as one layer; the layer list (show,
// fade, drag to reorder, each layer's legend) and a legend box. No levels and no gates: the camera only moves the picture.
import { area, data, earth, imagery, layer, layers, legend, line, points, raster, scale, terrain, world } from 'aslnut';

// a public GeoServer (WMS and WFS; it lets any site read it, so no proxy is needed)
const OWS = 'https://opendata.maps.vic.gov.au/geoserver';
const NS = 'open-data-platform';
const credit = '© State of Victoria (DEECA), CC BY 4.0';
// the area every WFS layer is loaded over, once: [west, south, east, north] in degrees
const AREA: [number, number, number, number] = [145.07, -37.96, 145.18, -37.89];
const wfs = (name: string) => data.wfs(`${OWS}/wfs`, { typeName: `${NS}:${name}`, extent: AREA, attribution: credit });

const canvas = document.querySelector('canvas')!;
const w = await world(canvas, {
  body: earth({ imagery: [imagery.esri({ layer: 'light' })], terrain: [terrain.mapzen()] }),
  view: { lon: 145.1215, lat: -37.9235, zoom: 15.6, tilt: 30, bearing: 0 },
});

const KINDS = ['education centre', 'hospital', 'community venue', 'emergency facility', 'recreational resource'];
w.add(
  // a WMS layer as one picture of the view, stacked with the vectors
  raster({ id: 'zones', label: 'Planning zones (WMS)', source: raster.wms(`${OWS}/wms`, { layers: `${NS}:plan_zone`, single: true, attribution: credit }), opacity: 0.45 }),
  // one statement: the suburbs (polygons) with their names inside the same layer (one switch, one place in the stack)
  layer({ id: 'suburbs', label: 'Suburbs (polygons)', data: wfs('vmlite_locality_polygon'),
    area: { color: '#93c5fd', opacity: 0.25, outline: { color: '#ffffff', width: 1 } },
    labels: { text: (d) => String(d.props.locality_name), size: 13, color: '#1f2937', halo: { width: 3, color: '#ffffff' } },
    tooltip: (d) => String(d.props.locality_name), hover: { color: '#ffffff', mix: 0.3 } }),
  // a mark alone is a layer of one sign
  area({ id: 'sites', label: 'Sites (multipolygons)', data: wfs('foi_polygon'), color: scale.category((d) => String(d.props.feature_type), { range: 'set2' }),
    opacity: 0.6, outline: { color: '#334155', width: 0.8 }, tooltip: (d) => `${d.props.name}\n${d.props.feature_type}` }),
  line({ id: 'creeks', label: 'Creeks (lines)', data: wfs('hy_watercourse'), width: 2.2, color: '#2563eb', tooltip: (d) => String(d.props.name ?? 'creek') }),
  line({ id: 'pipelines', label: 'Pipelines (multilines)', data: wfs('foi_line'), width: 2.4, color: '#ea580c', dashes: [10, 6], tooltip: (d) => String(d.props.name) }),
  points({ id: 'places', label: 'Places (multipoints)', data: wfs('foi_point'), size: 9, outline: { color: '#ffffff', width: 1.5 },
    color: scale.category((d) => String(d.props.feature_type), { domain: KINDS, range: ['#f97316', '#ef4444', '#8b5cf6', '#dc2626', '#16a34a'] }), tooltip: (d) => String(d.props.name) }),
  points({ id: 'dams', label: 'Dams (points)', data: wfs('hy_water_point'), size: 11, color: '#0284c7', outline: { color: '#ffffff', width: 2 }, tooltip: (d) => String(d.props.name) }),
);

// the layer list: every layer with a label (show, fade, drag to reorder; a WMS layer's own legend picture)
layers(w, { title: 'Layers' });
// a legend box for one layer's colour scale
legend(w, { for: 'places', title: 'Places by kind' });
