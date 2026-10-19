// Map and feature services (core › data › sources › services › wfs; tiles › wms): what a service says about itself
// read the same everywhere (no DOM), a WFS layer asked for by the view's tiles (paged, kept, whole features once,
// version and coordinate system found), a WMS as one picture of the view, its legend and what it says is at a place;
// every kind of shape a service sends drawn as its kind (core › data › features); the layer list's 'add a layer'.
// No network: a fake service answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, raster, layers, world, normalize, polygonsOf, linesOf, pointsOf, readXML, readWFSCapabilities, readWFSDescribe, readWMSCapabilities, exceptionOf, epsgOf, WFS, AslnutError, type Feature } from '../src/index.ts';
import { polygonMesh, Origin } from '../src/core/geometry/build/mesh.ts';
import { tileBBox } from '../src/core/space/geo.ts';

const ring = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const WFS_CAPS = `<?xml version="1.0"?><wfs:WFS_Capabilities version="2.0.0" xmlns="http://www.opengis.net/wfs/2.0" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:ows="http://www.opengis.net/ows/1.1">
<ows:ServiceIdentification><ows:Title>Test &amp; features</ows:Title></ows:ServiceIdentification>
<ows:OperationsMetadata><ows:Operation name="GetFeature"><ows:Parameter name="outputFormat"><ows:AllowedValues><ows:Value>application/json</ows:Value><ows:Value>GML2</ows:Value></ows:AllowedValues></ows:Parameter></ows:Operation>
<ows:Constraint name="ImplementsResultPaging"><ows:NoValues/><ows:DefaultValue>TRUE</ows:DefaultValue></ows:Constraint><ows:Constraint name="CountDefault"><ows:NoValues/><ows:DefaultValue>500</ows:DefaultValue></ows:Constraint></ows:OperationsMetadata>
<FeatureTypeList><FeatureType><Name>ns:suburbs</Name><Title>Suburbs</Title><DefaultCRS>urn:ogc:def:crs:EPSG::7844</DefaultCRS><OtherCRS>urn:ogc:def:crs:EPSG::4326</OtherCRS><ows:WGS84BoundingBox><ows:LowerCorner>144.5 -38.5</ows:LowerCorner><ows:UpperCorner>145.5 -37.5</ows:UpperCorner></ows:WGS84BoundingBox></FeatureType>
<FeatureType><Name>ns:merc</Name><Title>Only in web Mercator</Title><DefaultCRS>urn:ogc:def:crs:EPSG::3857</DefaultCRS></FeatureType>
<FeatureType><Name>ns:mga</Name><Title>Only in MGA</Title><DefaultCRS>urn:ogc:def:crs:EPSG::28355</DefaultCRS></FeatureType></FeatureTypeList></wfs:WFS_Capabilities>`;

/** a fake WFS: features in a box, paged; it can refuse a version or a coordinate system, or answer latitude first */
function fakeWFS(all: Feature[], o: { refuse20?: boolean; only3857?: boolean; latFirst?: boolean } = {}) {
  const asked: URLSearchParams[] = [];
  const ex = (t: string) => new Response(`<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1"><ows:Exception><ows:ExceptionText>${t}</ows:ExceptionText></ows:Exception></ows:ExceptionReport>`, { status: 400 });
  const fetch = async (url: string | URL | Request) => {
    const u = new URL(String(url)), q = new URLSearchParams([...u.searchParams].map(([k, v]) => [k.toLowerCase(), v])); asked.push(q);
    const req = q.get('request');
    if (req === 'GetCapabilities') return new Response(WFS_CAPS);
    if (req === 'DescribeFeatureType') return new Response('<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"><xsd:complexType name="t"><xsd:sequence><xsd:element name="the_shape" type="gml:MultiSurfacePropertyType"/><xsd:element name="name" type="xsd:string"/></xsd:sequence></xsd:complexType></xsd:schema>');
    if (o.refuse20 && q.get('version') === '2.0.0') return ex('version 2.0.0 is not supported');
    const srs = q.get('srsname') ?? '';
    if (o.only3857 && !/3857/.test(srs)) return ex(`cannot reproject to ${srs}`);
    let box: number[] | null = null;
    const b = q.get('bbox');
    if (b) { const p = b.split(','), v = p.slice(0, 4).map(Number); box = /::4326$/.test(p[4] ?? '') ? [v[1]!, v[0]!, v[3]!, v[2]!] : /3857/.test(p[4] ?? '') ? [(v[0]! / 6378137) * (180 / Math.PI), -90, (v[2]! / 6378137) * (180 / Math.PI), 90] : v; }
    const inBox = (f: Feature) => { const pts = JSON.stringify(f.geometry); const xs = [...pts.matchAll(/\[(-?[\d.]+),(-?[\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]); return !box || xs.some(([x, y]) => x! >= box![0]! && x! <= box![2]! && y! >= box![1]! && y! <= box![3]!); };
    const hit = all.filter(inBox), count = Number(q.get('count') ?? q.get('maxfeatures') ?? 1e9), start = Number(q.get('startindex') ?? 0);
    const page = hit.slice(start, start + count).map((f) => ({ type: 'Feature', id: f.id, properties: f.props, geometry: f.geometry }));
    const R = 6378137, merc = (p: number[]) => [p[0]! * (Math.PI / 180) * R, Math.log(Math.tan(Math.PI / 4 + (p[1]! * Math.PI) / 360)) * R];
    const out = JSON.parse(JSON.stringify(page), (_k, v) => (Array.isArray(v) && typeof v[0] === 'number' ? (/3857/.test(srs) ? merc(v) : o.latFirst ? [v[1], v[0]] : v) : v));
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: out, numberMatched: hit.length, numberReturned: page.length }));
  };
  return { fetch: fetch as typeof globalThis.fetch, asked };
}
const pts = (n: number, lon0 = 145.12, lat0 = -37.92): Feature[] => Array.from({ length: n }, (_, i) => ({ id: `p.${i}`, props: { name: `p${i}` }, geometry: { type: 'Point', coordinates: [lon0 + (i % 5) * 0.001, lat0 + Math.floor(i / 5) * 0.001] } }));
const tileOf = (lon: number, lat: number, z: number) => { const n = 2 ** z, l = (lat * Math.PI) / 180; return [z, Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2) * n)] as const; };
const ctx = { loader: null as never, error: () => {} };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tile = (s: WFS, z: number, x: number, y: number): Promise<Feature[]> => (s as any).tile(z, x, y, ctx);

test('what a service says about itself: capabilities, a layer\'s fields, an exception, coordinate systems', () => {
  const x = readXML('<a:root xmlns:a="u" v="1"><b k=\'2\'>x &amp; y</b><b/><![CDATA[<raw>]]><!-- no --></a:root>');
  assert.equal(x.name, 'root'); assert.equal(x.attrs.v, '1'); assert.equal(x.kids.length, 2); assert.equal(x.kids[0]!.text, 'x & y'); assert.match(x.text, /<raw>/);
  const c = readWFSCapabilities(WFS_CAPS, 'https://x/wfs');
  assert.equal(c.version, '2.0.0'); assert.equal(c.title, 'Test & features'); assert.equal(c.paging, true); assert.equal(c.countDefault, 500);
  assert.deepEqual(c.formats, ['application/json', 'GML2']);
  assert.deepEqual(c.layers.map((l) => l.name), ['ns:suburbs', 'ns:merc', 'ns:mga']);
  assert.deepEqual(c.layers[0]!.bbox, [144.5, -38.5, 145.5, -37.5]); assert.deepEqual(c.layers[0]!.crs, ['urn:ogc:def:crs:EPSG::7844', 'urn:ogc:def:crs:EPSG::4326']);
  // 1.1.0: DefaultSRS and the same box
  const c11 = readWFSCapabilities('<WFS_Capabilities version="1.1.0"><FeatureTypeList><FeatureType><Name>a:b</Name><Title>B</Title><DefaultSRS>EPSG:4326</DefaultSRS><ows:WGS84BoundingBox><ows:LowerCorner>1 2</ows:LowerCorner><ows:UpperCorner>3 4</ows:UpperCorner></ows:WGS84BoundingBox></FeatureType></FeatureTypeList></WFS_Capabilities>');
  assert.equal(c11.version, '1.1.0'); assert.deepEqual(c11.layers[0], { name: 'a:b', title: 'B', abstract: '', crs: ['EPSG:4326'], bbox: [1, 2, 3, 4] });
  const d = readWFSDescribe('<xsd:schema><xsd:complexType name="t"><xsd:sequence><xsd:element name="geom" type="gml:MultiSurfacePropertyType"/><xsd:element name="name" type="xsd:string"/><xsd:element name="pop" type="xsd:int"/></xsd:sequence></xsd:complexType></xsd:schema>');
  assert.deepEqual(d, { fields: [{ name: 'name', type: 'string' }, { name: 'pop', type: 'int' }], geometry: { name: 'geom', type: 'gml:MultiSurfacePropertyType' } });
  assert.equal(exceptionOf('<ows:ExceptionReport><ows:Exception><ows:ExceptionText>bad layer</ows:ExceptionText></ows:Exception></ows:ExceptionReport>'), 'bad layer');
  assert.equal(exceptionOf('{"type":"FeatureCollection"}'), null);
  assert.deepEqual(['EPSG:4326', 'urn:ogc:def:crs:EPSG::7844', 'http://www.opengis.net/def/crs/EPSG/0/3857', 'CRS:84', 'x'].map(epsgOf), [4326, 7844, 3857, 4326, null]);
  assert.throws(() => readWFSCapabilities('<html/>'), (e: unknown) => e instanceof AslnutError && e.code === 'E-DATA-002');
  // a WMS: named layers flat, a group's coordinate systems passed down, a legend, queryable
  const m = readWMSCapabilities(`<WMS_Capabilities version="1.3.0"><Service><Title>Maps</Title></Service><Capability><Request><GetMap><Format>image/png</Format></GetMap><GetFeatureInfo><Format>application/json</Format></GetFeatureInfo></Request>
    <Layer><Title>all</Title><CRS>CRS:84</CRS><CRS>EPSG:3857</CRS><Layer queryable="1"><Name>ns:zones</Name><Title>Zones</Title><EX_GeographicBoundingBox><westBoundLongitude>1</westBoundLongitude><eastBoundLongitude>2</eastBoundLongitude><southBoundLatitude>3</southBoundLatitude><northBoundLatitude>4</northBoundLatitude></EX_GeographicBoundingBox>
    <Style><Name>default</Name><Title>d</Title><LegendURL><OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://x/legend.png"/></LegendURL></Style></Layer><Layer><Name>ns:base</Name><Title>Base</Title></Layer></Layer></Capability></WMS_Capabilities>`);
  assert.equal(m.title, 'Maps'); assert.deepEqual(m.formats, ['image/png']); assert.deepEqual(m.infoFormats, ['application/json']);
  assert.deepEqual(m.layers.map((l) => [l.name, l.queryable, l.legend, l.crs.join(' ')]), [['ns:zones', true, 'https://x/legend.png', 'CRS:84 EPSG:3857'], ['ns:base', false, null, 'CRS:84 EPSG:3857']]);
  assert.deepEqual(m.layers[0]!.bbox, [1, 3, 2, 4]);
});

test('a WFS layer by the view\'s tiles: paged, latitude first in the box, whole features once, a coarser tile answering for its parts', async () => {
  const svc = fakeWFS(pts(25));
  const s = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', tiles: true, pageSize: 10, fetch: svc.fetch }) as WFS;
  await s.start(ctx);
  const [z, x, y] = tileOf(145.122, -37.919, 13), got = await tile(s, z, x, y);
  assert.equal(got.length, 25, 'every page'); assert.equal(new Set(got.map((f) => f.id)).size, 25);
  const gets = svc.asked.filter((q) => q.get('request') === 'GetFeature');
  assert.deepEqual(gets.map((q) => [q.get('version'), q.get('typenames'), q.get('count'), q.get('startindex')]), [['2.0.0', 'ns:suburbs', '10', '0'], ['2.0.0', 'ns:suburbs', '10', '10'], ['2.0.0', 'ns:suburbs', '10', '20']]);
  const b = tileBBox(z, x, y), bb = gets[0]!.get('bbox')!.split(',');
  assert.deepEqual(bb.slice(0, 4).map(Number), [b[1], b[0], b[3], b[2]], 'latitude first'); assert.equal(bb[4], 'urn:ogc:def:crs:EPSG::4326');
  assert.equal(gets[0]!.get('srsname'), 'EPSG:4326'); assert.equal(gets[0]!.get('outputformat'), 'application/json');
  assert.deepEqual(s.info, { version: '2.0.0', crs: 'EPSG:4326', requests: 3, bytes: s.info.bytes, tiles: 0, truncated: 0, features: 0, ms: s.info.ms });
  // a coarser tile in (not cut short) answers for its parts; one cut short does not
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = s as any;
  t.tiles.set(`${z}/${x}/${y}`, got);
  assert.equal(t.answerOf(`${z + 2}/${x * 4 + 1}/${y * 4 + 3}`), `${z}/${x}/${y}`);
  t.truncated.add(`${z}/${x}/${y}`);
  assert.equal(t.answerOf(`${z + 2}/${x * 4 + 1}/${y * 4 + 3}`), `${z + 2}/${x * 4 + 1}/${y * 4 + 3}`);
  // the most a tile holds: cut short, said so
  const s2 = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', tiles: true, pageSize: 10, maxFeatures: 15, fetch: fakeWFS(pts(25)).fetch }) as WFS;
  await s2.start(ctx); const cut = await tile(s2, z, x, y);
  assert.equal(cut.length, 20, 'whole pages up to the most'); assert.equal(s2.info.truncated, 1);
  // a service that does not page (the first page again): the end, not a loop
  const same = async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: pts(10).map((f) => ({ type: 'Feature', id: f.id, properties: f.props, geometry: f.geometry })) }));
  const s3 = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', tiles: true, pageSize: 10, fetch: same as never }) as WFS; await s3.start(ctx);
  assert.equal((await tile(s3, z, x, y)).length, 10); assert.equal(s3.info.requests, 2);
});

test('a WFS layer: 1.1.0 when 2.0.0 is refused; web Mercator when longitude / latitude is; an answer latitude first turned round; a layer only in MGA said plainly', async () => {
  const [z, x, y] = tileOf(145.122, -37.919, 13);
  const a = fakeWFS(pts(3), { refuse20: true }), s = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', tiles: true, fetch: a.fetch }) as WFS;
  await s.start(ctx); assert.equal((await tile(s, z, x, y)).length, 3); assert.equal(s.info.version, '1.1.0');
  const last = a.asked.at(-1)!; assert.equal(last.get('typename'), 'ns:suburbs'); assert.ok(last.has('maxfeatures'));
  const m = fakeWFS(pts(3), { only3857: true }), s2 = data.wfs('https://x/wfs', { typeName: 'ns:merc', tiles: true, fetch: m.fetch }) as WFS;
  await s2.start(ctx); const fs = await tile(s2, z, x, y);
  assert.equal(s2.info.crs, 'EPSG:3857'); assert.equal(fs.length, 3);
  const p = (fs[0]!.geometry as { coordinates: number[] }).coordinates;
  assert.ok(Math.abs(p[0]! - 145.12) < 1e-9 && Math.abs(p[1]! + 37.92) < 1e-9, `back in degrees (${p})`);
  const l = fakeWFS(pts(3), { latFirst: true }), s3 = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', tiles: true, fetch: l.fetch }) as WFS;
  await s3.start(ctx); const q = ((await tile(s3, z, x, y))[0]!.geometry as { coordinates: number[] }).coordinates;
  assert.deepEqual(q, [145.12, -37.92], 'longitude first again');
  const g = fakeWFS(pts(3), { only3857: true }), s4 = data.wfs('https://x/wfs', { typeName: 'ns:mga', tiles: true, fetch: g.fetch }) as WFS; await s4.start(ctx);
  await assert.rejects(tile(s4, z, x, y), (e: unknown) => e instanceof AslnutError && /offered only in .*28355/.test(e.message));
  assert.throws(() => data.wfs('https://x/wfs', {} as never), /typeName/);
});

test('a WFS layer loads once: over its extent, or the whole layer when small; paged, handed on together; looking asks for nothing; too big without an extent said plainly', async () => {
  // over an extent: every page, then the features handed on once
  const svc = fakeWFS([...pts(25), ...pts(5, 146, -37)]);
  const s = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', pageSize: 10, extent: [145.1, -37.95, 145.2, -37.9], fetch: svc.fetch }) as WFS;
  let handed = 0; s.watch(() => handed++);
  await s.start(ctx);
  assert.equal(s.size, 25, 'the extent only'); assert.equal(handed, 1, 'handed on once, every page in');
  const gets = svc.asked.filter((q) => q.get('request') === 'GetFeature');
  assert.equal(gets.length, 3); assert.ok(gets.every((q) => q.get('bbox')?.startsWith('-37.95,145.1,-37.9,145.2')), 'the extent, latitude first');
  assert.equal(s.byView, false, 'it does not follow the view');
  // the view moving (a zoom, a pan, a tilt): nothing asked, nothing handed
  for (const [lon, zoom] of [[145.12, 12], [145.5, 16], [145.12, 9]] as const) s.frame({ view: { lon, lat: -37.92, zoom, width: 390, height: 844, pixelSize: 5, tilt: 60, bearing: 30 } } as never, ctx);
  await new Promise((k) => setTimeout(k, 0));
  assert.equal(svc.asked.filter((q) => q.get('request') === 'GetFeature').length, 3, 'looking asks for nothing'); assert.equal(handed, 1);
  // no extent: the whole layer when small (no box asked)
  const w2 = fakeWFS(pts(12)), s2 = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', pageSize: 5, fetch: w2.fetch }) as WFS;
  await s2.start(ctx); assert.equal(s2.size, 12); assert.ok(w2.asked.every((q) => !q.get('bbox')), 'the whole layer');
  // too big for once without an extent: an error that says to give one
  const big = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', pageSize: 5, most: 8, fetch: fakeWFS(pts(12)).fetch }) as WFS;
  const errs: unknown[] = []; await big.start({ ...ctx, error: (e) => errs.push(e) });
  assert.ok(errs[0] instanceof AslnutError && (errs[0] as AslnutError).code === 'E-DATA-003' && /give an extent|extent: \[west/.test((errs[0] as AslnutError).message), String(errs[0]));
  // tiles on request: features only added by id, a tile asked once ever
  const t = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', tiles: true, fetch: fakeWFS(pts(25)).fetch }) as WFS;
  assert.equal(t.byView, true);
});

test('a WFS layer with a filter: CQL with the box in it; FES (2.0.0 and as 1.1.0 reads it); the geometry\'s field from the service', async () => {
  const svc = fakeWFS(pts(3));
  const s = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', filter: "kind = 'school'", fetch: svc.fetch }) as WFS;
  const box: [number, number, number, number] = [145, -38, 145.1, -37.9];
  const u = new URL(await s.urlFor(box, 0, 100));
  assert.equal(u.searchParams.get('CQL_FILTER'), "BBOX(the_shape,145,-38,145.1,-37.9,'EPSG:4326') AND (kind = 'school')", 'the field DescribeFeatureType names');
  assert.equal(u.searchParams.get('bbox'), null, 'the box is in the filter');
  const f = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', geometryName: 'geom', filter: { fes: '<fes:PropertyIsEqualTo><fes:ValueReference>kind</fes:ValueReference><fes:Literal>school</fes:Literal></fes:PropertyIsEqualTo>' }, fetch: svc.fetch }) as WFS;
  const fe = new URL(await f.urlFor(box, 0, 100)).searchParams.get('FILTER')!;
  assert.match(fe, /^<fes:Filter[^>]*><fes:And><fes:BBOX><fes:ValueReference>geom<\/fes:ValueReference><gml:Envelope srsName="urn:ogc:def:crs:EPSG::4326"><gml:lowerCorner>-38 145<\/gml:lowerCorner>/);
  assert.match(fe, /<fes:PropertyIsEqualTo>.*<\/fes:And><\/fes:Filter>$/);
  const f11 = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', version: '1.1.0', geometryName: 'geom', filter: { fes: '<fes:PropertyIsEqualTo><fes:ValueReference>kind</fes:ValueReference><fes:Literal>school</fes:Literal></fes:PropertyIsEqualTo>' }, fetch: svc.fetch }) as WFS;
  const fe11 = new URL(await f11.urlFor(box, 0, 100)).searchParams.get('FILTER')!;
  assert.match(fe11, /^<ogc:Filter[^>]*><ogc:And><ogc:BBOX><ogc:PropertyName>geom<\/ogc:PropertyName>.*<ogc:PropertyIsEqualTo><ogc:PropertyName>kind<\/ogc:PropertyName>/);
  // a proxy: the URL asked through it
  const seen: string[] = [];
  const p = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', proxy: 'https://proxy/?url=', fetch: (async (url: string) => { seen.push(url); return new Response('{"type":"FeatureCollection","features":[]}'); }) as never }) as WFS;
  await p.start(ctx); await tile(p, 13, 7400, 5050);
  assert.ok(seen[0]!.startsWith('https://proxy/?url=https%3A%2F%2Fx%2Fwfs%3F'), String(seen[0]));
  // capabilities and describe, as functions of their own
  const caps = await data.wfs.capabilities('https://x/wfs', { fetch: svc.fetch });
  assert.equal(caps.layers.length, 3);
  const d = await data.wfs.describe('https://x/wfs', 'ns:suburbs', { fetch: svc.fetch });
  assert.equal(d.geometry?.name, 'the_shape');
});

// every kind of shape a service sends, through the service and drawn as its kind (one test each)
const [TZ, TX, TY] = tileOf(145.105, -37.905, 13);
async function viaWFS(geometry: unknown): Promise<Feature> {
  const svc = fakeWFS([{ id: 'f.1', props: { name: 'one' }, geometry: geometry as never }]), s = data.wfs('https://x/wfs', { typeName: 'ns:suburbs', fetch: svc.fetch }) as WFS;
  await s.start(ctx); const [f] = await tile(s, TZ, TX, TY); assert.ok(f, 'the feature came'); return f!;
}
const meshArea = (rings: number[][][]) => { const o = new Origin(145.105, -37.905), m = polygonMesh(o, rings as never, 1e9); let a = 0; for (let i = 0; i < m.tris.length; i += 3) { const [p, q, r] = [m.tris[i]!, m.tris[i + 1]!, m.tris[i + 2]!].map((k) => [m.xy[k * 2]!, m.xy[k * 2 + 1]!]); a += Math.abs((q![0]! - p![0]!) * (r![1]! - p![1]!) - (r![0]! - p![0]!) * (q![1]! - p![1]!)) / 2; } return a; };
test('a Point: one place', async () => {
  const f = await viaWFS({ type: 'Point', coordinates: [145.105, -37.905] });
  assert.equal(f.geometry!.type, 'Point'); assert.deepEqual(pointsOf(f.geometry), [[145.105, -37.905]]);
});
test('a MultiPoint: one place per point', async () => {
  const f = await viaWFS({ type: 'MultiPoint', coordinates: [[145.105, -37.905], [145.106, -37.905], [145.107, -37.905]] });
  assert.equal(f.geometry!.type, 'MultiPoint'); assert.equal(pointsOf(f.geometry).length, 3);
});
test('a LineString: one line', async () => {
  const f = await viaWFS({ type: 'LineString', coordinates: [[145.105, -37.905], [145.11, -37.91]] });
  assert.equal(linesOf(f.geometry).length, 1); assert.equal(linesOf(f.geometry)[0]!.length, 2);
});
test('a MultiLineString: one line per piece (no line across the gap)', async () => {
  const f = await viaWFS({ type: 'MultiLineString', coordinates: [[[145.105, -37.905], [145.106, -37.905]], [[145.108, -37.905], [145.109, -37.905]]] });
  const ls = linesOf(f.geometry); assert.equal(ls.length, 2); assert.deepEqual(ls[1]![0], [145.108, -37.905]);
});
test('a Polygon with a hole: its triangles cover the outer ring less the hole', async () => {
  const f = await viaWFS({ type: 'Polygon', coordinates: [ring(145.1, -37.91, 145.11, -37.9), ring(145.103, -37.907, 145.107, -37.903).reverse()] });
  const [poly] = polygonsOf(f.geometry); assert.equal(poly!.length, 2, 'outer ring and its hole');
  const whole = meshArea([poly![0]!] as never), less = meshArea(poly! as never), hole = meshArea([poly![1]!] as never);
  assert.ok(Math.abs(less - (whole - hole)) / whole < 1e-6, `hole cut out (${less.toFixed(0)} vs ${(whole - hole).toFixed(0)} m²)`);
  assert.ok(hole > 0.1 * whole);
});
test('a MultiPolygon: each piece a polygon of its own (holes kept)', async () => {
  const f = await viaWFS({ type: 'MultiPolygon', coordinates: [[ring(145.1, -37.91, 145.104, -37.906)], [ring(145.106, -37.91, 145.11, -37.906), ring(145.107, -37.909, 145.108, -37.908).reverse()]] });
  const ps = polygonsOf(f.geometry); assert.equal(ps.length, 2); assert.deepEqual(ps.map((p) => p.length), [1, 2]);
  assert.ok(meshArea(ps[1] as never) < meshArea([ps[1]![0]!] as never));
});
test('a GeometryCollection: its polygons as areas, else its lines, else its points', async () => {
  const a = await viaWFS({ type: 'GeometryCollection', geometries: [{ type: 'Polygon', coordinates: [ring(145.1, -37.91, 145.101, -37.909)] }, { type: 'Polygon', coordinates: [ring(145.103, -37.91, 145.104, -37.909)] }, { type: 'LineString', coordinates: [[145.1, -37.9], [145.2, -37.9]] }] });
  assert.equal(a.geometry!.type, 'MultiPolygon'); assert.equal(polygonsOf(a.geometry).length, 2);
  const b = normalize({ type: 'GeometryCollection', geometries: [{ type: 'LineString', coordinates: [[145.1, -37.9], [145.2, -37.9]] }, { type: 'Point', coordinates: [145.1, -37.9] }] })[0]!;
  assert.equal(b.geometry!.type, 'MultiLineString');
  const c = normalize({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [145.1, -37.9] }, { type: 'MultiPoint', coordinates: [[145.2, -37.9], [145.3, -37.9]] }] })[0]!;
  assert.equal(c.geometry!.type, 'MultiPoint'); assert.equal(pointsOf(c.geometry).length, 3);
});

test('a WMS as one picture of the view (longitude first, CRS:84), its legend, what it says is at a place', async () => {
  const v = raster.wms('https://x/wms', { layers: 'ns:zones', single: true });
  assert.equal(v.kind, 'view');
  const u = new URL(v.url([145, -38, 145.1, -37.9], 800, 600)), q = u.searchParams;
  assert.deepEqual([q.get('REQUEST'), q.get('CRS'), q.get('BBOX'), q.get('WIDTH'), q.get('HEIGHT'), q.get('LAYERS')], ['GetMap', 'CRS:84', '145,-38,145.1,-37.9', '800', '600', 'ns:zones']);
  assert.deepEqual(v.wms, { url: 'https://x/wms', layers: 'ns:zones', version: '1.3.0' });
  const v11 = raster.wms('https://x/wms', { layers: 'a', single: true, version: '1.1.1' });
  assert.equal(new URL(v11.url([1, 2, 3, 4], 10, 10)).searchParams.get('SRS'), 'EPSG:4326');
  assert.equal(new URL(v.legend!).searchParams.get('REQUEST'), 'GetLegendGraphic');
  assert.equal(raster.wms.legend('https://x/wms?map=a', 'ns:zones'), 'https://x/wms?map=a&SERVICE=WMS&REQUEST=GetLegendGraphic&VERSION=1.3.0&FORMAT=image%2Fpng&LAYER=ns%3Azones');
  // tiles (painted into the ground), as before
  const t = raster.wms('https://x/wms', { layers: 'ns:zones' });
  assert.equal(t.kind, 'imagery'); assert.match(t.urlFor!({ z: 2, x: 1, y: 1 })!, /CRS=EPSG%3A3857/);
  let asked = '';
  const fetch = (async (url: string) => { asked = url; return new Response(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'zones.12', properties: { zone: 'GRZ1' }, geometry: null }] })); }) as never;
  const got = await raster.wms.info('https://x/wms', { layers: 'ns:zones', lon: 145.12, lat: -37.92, zoom: 16 }, { fetch });
  assert.deepEqual(got.map((f) => [f.layer, f.props.zone]), [['zones', 'GRZ1']]);
  const iq = new URL(asked).searchParams; assert.deepEqual([iq.get('REQUEST'), iq.get('I'), iq.get('J'), iq.get('INFO_FORMAT')], ['GetFeatureInfo', '50', '50', 'application/json']);
  const b = iq.get('BBOX')!.split(',').map(Number); assert.ok(b[0]! < 145.12 && b[2]! > 145.12 && b[1]! < -37.92 && b[3]! > -37.92, 'a box round the place');
  // the layer: an image raster (on the chip), following the view
  const l = raster({ id: 'zones', source: v, opacity: 0.5 });
  assert.equal(l.kind, 'area'); assert.equal(l.sits, 'over'); assert.equal(l.legendImage, v.legend);
});

test('the layer list adds a layer from a service: its layers listed, one picked, made by its kind', async () => {
  const w = await world(null), svc = fakeWFS(pts(3));
  const list = layers(w, { groups: { Data: [] }, add: { fetch: svc.fetch } });
  const picks = await list.listService('https://x/wfs', 'wfs');
  assert.deepEqual(picks.map((p) => [p.service, p.name, p.title]), [['wfs', 'ns:suburbs', 'Suburbs'], ['wfs', 'ns:merc', 'Only in web Mercator'], ['wfs', 'ns:mga', 'Only in MGA']]);
  // its geometry from DescribeFeatureType (a MultiSurface: areas), its id a plain name
  const a = await list.addFrom(picks[0]!);
  assert.equal(a.kind, 'area'); assert.equal(a.id, 'wfs-ns_suburbs'); assert.equal(a.props.label, 'Suburbs');
  const p = await list.addFrom({ service: 'wfs', url: 'https://x/wfs', name: 'ns:stops', title: 'Stops', geometry: 'point' });
  assert.equal(p.kind, 'point');
  const r = await list.addFrom({ service: 'wms', url: 'https://x/wms', name: 'ns:zones', title: 'Zones', geometry: null });
  assert.equal(r.kind, 'area'); assert.equal((r.props as { source: { kind: string } }).source.kind, 'view');
  assert.deepEqual(list.describe().groups[0]!.items.map((i) => i.id).sort(), ['wfs-ns_stops', 'wfs-ns_suburbs', 'wms-ns_zones']);
  assert.equal(list.describe().groups[0]!.items.find((i) => i.id === 'wms-ns_zones')!.legend?.kind, 'image', 'a WMS layer: its legend picture');
  list.remove(); w.dispose();
});
