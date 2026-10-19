// core › data › sources › services: what OGC web services say about themselves, read alike in a browser and in Node
// (no DOM needed): a small XML reader; a WFS's GetCapabilities (its layers: names, titles, coordinate systems, boxes;
// its output formats; whether it pages) and DescribeFeatureType (a layer's fields and its geometry); a WMS's
// GetCapabilities (its named layers: titles, coordinate systems, boxes, legends, whether one answers GetFeatureInfo);
// an exception report read as a plain message. Every request can carry your headers, go through your fetch, or
// through a proxy (services that do not allow other sites to read them).
//   await data.wfs.capabilities('https://…/wfs')                    → { version, layers: [{ name, title, crs, bbox }], … }
//   await data.wfs.describe('https://…/wfs', 'ns:suburbs')         → { fields: [{ name, type }], geometry: { name, type } }
//   await raster.wms.capabilities('https://…/wms')                   → { version, layers: [{ name, title, legend, … }], … }
import { AslnutError } from '../../world/errors.ts';
import type { BBox } from '../../space/geo.ts';

/** how a service is reached: your headers (a key), your fetch (one that signs, a test's answers), a proxy */
export interface ServiceOptions {
  /** sent with every request */
  headers?: Record<string, string>;
  /** your fetch (default the page's) */
  fetch?: typeof fetch;
  /** for a service that does not let other sites read it: a prefix put before the URL (encoded when it ends in '='),
   *  or your function of the URL */
  proxy?: string | ((url: string) => string);
}
/** the URL as asked (through the proxy when there is one) */
export function proxied(url: string, p?: ServiceOptions['proxy']): string {
  if (!p) return url;
  if (typeof p === 'function') return p(url);
  return p.endsWith('=') ? p + encodeURIComponent(url) : p + url;
}
/** a URL with these parameters added (a service URL may carry its own already) */
export function withParams(url: string, q: Record<string, string | number | undefined>): string {
  const u = Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  return `${url}${url.includes('?') ? (/[?&]$/.test(url) ? '' : '&') : '?'}${u}`;
}
/** a service's answer as text (an HTTP failure, or an OGC exception report, is an error saying what it said) */
export async function serviceText(url: string, o: ServiceOptions = {}, where = 'service'): Promise<string> {
  const f = o.fetch ?? (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new AslnutError('E-DATA-002', 'no fetch here to reach the service', { where, fix: 'pass { fetch } (Node 18+ has one)' });
  let r: Response;
  try { r = await f(proxied(url, o.proxy), { headers: o.headers, mode: 'cors' }); }
  catch (e) { throw new AslnutError('E-DATA-002', `the service did not answer (${(e as Error).message}): ${url}`, { where, fix: 'check the URL; a service that does not allow other sites to read it needs a proxy (proxy option)' }); }
  const t = await r.text();
  if (!r.ok) throw new AslnutError('E-DATA-002', `the service answered ${r.status}${exceptionOf(t) ? `: ${exceptionOf(t)}` : ''}: ${url}`, { where, fix: 'check the URL and its parameters' });
  const ex = exceptionOf(t); if (ex) throw new AslnutError('E-DATA-002', `the service said: ${ex}`, { where, fix: 'check the layer name and the parameters it was asked with' });
  return t;
}

// ── a small XML reader ───────────────────────────────────────────────────────────────────────────────────────────
/** an element: its local name (no prefix), its attributes (local names too), its children and its own text */
export interface XNode { name: string; attrs: Record<string, string>; kids: XNode[]; text: string }
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? _));
const local = (n: string) => n.slice(n.indexOf(':') + 1);
/** XML text → its root element (tolerant: an unclosed element ends with its parent) */
export function readXML(src: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, kids: [], text: '' };
  const stack: XNode[] = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([^\s>/]+)((?:\s+[^\s=>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1]!;
    if (m.index > at) top.text += unescape(src.slice(at, m.index));
    at = re.lastIndex;
    if (m[1] !== undefined) { top.text += m[1]; continue; }
    if (!m[3]) continue;
    const name = local(m[3]);
    if (m[2] === '/') { for (let i = stack.length - 1; i > 0; i--) if (stack[i]!.name === name) { stack.length = i; break; } continue; }
    const attrs: Record<string, string> = {};
    for (const a of (m[4] ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1]!)] = unescape(a[2] ?? a[3] ?? '');
    const n: XNode = { name, attrs, kids: [], text: '' };
    top.kids.push(n);
    if (m[5] !== '/') stack.push(n);
  }
  return root.kids.find((k) => k.name) ?? root;
}
/** the first child of this name (local) */
export const kid = (n: XNode | undefined, name: string): XNode | undefined => n?.kids.find((k) => k.name === name);
/** every child of this name */
export const kidsOf = (n: XNode | undefined, name: string): XNode[] => n?.kids.filter((k) => k.name === name) ?? [];
/** every descendant of this name (depth first) */
export function under(n: XNode | undefined, name: string, out: XNode[] = []): XNode[] { for (const k of n?.kids ?? []) { if (k.name === name) out.push(k); under(k, name, out); } return out; }
/** the trimmed text of the first child of this name ('' when none) */
export const textOf = (n: XNode | undefined, name: string): string => kid(n, name)?.text.trim() ?? '';
/** an OGC exception report's message (null: the text is not one) */
export function exceptionOf(t: string): string | null {
  if (!/ExceptionReport|ServiceExceptionReport|<ServiceException/.test(t.slice(0, 2000))) return null;
  try {
    const x = readXML(t), msgs = [...under(x, 'ExceptionText'), ...under(x, 'ServiceException')].map((e) => e.text.trim()).filter(Boolean);
    return msgs.join(' · ').replace(/\s+/g, ' ').slice(0, 400) || 'an exception report';
  } catch { return 'an exception report'; }
}

// ── coordinate systems ───────────────────────────────────────────────────────────────────────────────────────────
/** a CRS's EPSG code from any of its spellings (EPSG:4326, urn:ogc:def:crs:EPSG::4326, http://www.opengis.net/def/crs/EPSG/0/4326,
 *  CRS:84 → 4326); null: not EPSG */
export function epsgOf(crs: string): number | null {
  if (/CRS:?84$/i.test(crs.trim())) return 4326;
  const m = /EPSG(?::+|\/0\/|\/)(\d+)\s*$/i.exec(crs.trim()); return m ? Number(m[1]) : null;
}
/** coordinate systems read as longitude / latitude in degrees: WGS 84, and the Australian datums GDA94 and GDA2020
 *  (within a couple of metres of it: a web map's error) */
export const GEOGRAPHIC = new Set([4326, 4283, 7844, 4269, 4258]);
/** web Mercator (metres) */
export const MERCATOR = new Set([3857, 900913, 3785, 102100]);

// ── WFS ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface WFSLayer {
  name: string; title: string; abstract: string;
  /** its coordinate systems, the default first (as the service spells them) */
  crs: string[];
  /** its box in longitude / latitude [w, s, e, n] (null: not said) */
  bbox: BBox | null;
}
export interface WFSCapabilities {
  url: string; version: string; title: string; layers: WFSLayer[];
  /** GetFeature's output formats */
  formats: string[];
  /** it answers count / startIndex */
  paging: boolean;
  /** the most features one answer holds unless asked (null: not said) */
  countDefault: number | null;
}
/** a WFS's capabilities (2.0.0; 1.1.0 when the service does not answer it) */
export async function wfsCapabilities(url: string, o: ServiceOptions & { version?: '2.0.0' | '1.1.0' } = {}): Promise<WFSCapabilities> {
  const tryV = async (v: string) => readWFSCapabilities(await serviceText(withParams(url, { service: 'WFS', version: v, request: 'GetCapabilities' }), o, 'wfs'), url);
  if (o.version) return tryV(o.version);
  try { return await tryV('2.0.0'); } catch (e) { try { return await tryV('1.1.0'); } catch { throw e; } }
}
/** a WFS GetCapabilities document read */
export function readWFSCapabilities(xml: string, url = ''): WFSCapabilities {
  const x = readXML(xml);
  if (!/Capabilities$/.test(x.name)) throw new AslnutError('E-DATA-002', `not a WFS capabilities document (got <${x.name}>)`, { where: url || 'wfs', fix: 'check the URL: it should answer request=GetCapabilities&service=WFS' });
  const version = x.attrs.version ?? '';
  const ops = under(x, 'Operation'), gf = ops.find((op) => op.attrs.name === 'GetFeature');
  const valuesOf = (p: XNode | undefined) => under(p, 'Value').map((v) => v.text.trim());
  const formats = [...valuesOf(kidsOf(gf, 'Parameter').find((p) => p.attrs.name === 'outputFormat')), ...under(kid(x, 'Capability'), 'ResultFormat').flatMap((r) => r.kids.map((k) => k.name))];
  const cons = under(x, 'Constraint'), con = (n: string) => cons.find((c) => c.attrs.name === n);
  const paging = /true/i.test(textOf(con('ImplementsResultPaging'), 'DefaultValue')) || version.startsWith('1.1');
  const cd = Number(textOf(con('CountDefault'), 'DefaultValue'));
  const layers = under(x, 'FeatureType').map((ft): WFSLayer => {
    const lo = kid(ft, 'WGS84BoundingBox'), ll = kid(ft, 'LatLongBoundingBox');
    let bbox: BBox | null = null;
    if (lo) { const a = textOf(lo, 'LowerCorner').split(/\s+/).map(Number), b = textOf(lo, 'UpperCorner').split(/\s+/).map(Number); if (a.length === 2 && b.length === 2) bbox = [a[0]!, a[1]!, b[0]!, b[1]!]; }
    else if (ll) bbox = [Number(ll.attrs.minx), Number(ll.attrs.miny), Number(ll.attrs.maxx), Number(ll.attrs.maxy)];
    if (bbox && !bbox.every(Number.isFinite)) bbox = null;
    const crs = [...kidsOf(ft, 'DefaultCRS'), ...kidsOf(ft, 'DefaultSRS'), ...kidsOf(ft, 'SRS'), ...kidsOf(ft, 'OtherCRS'), ...kidsOf(ft, 'OtherSRS')].map((n) => n.text.trim()).filter(Boolean);
    return { name: textOf(ft, 'Name'), title: textOf(ft, 'Title') || textOf(ft, 'Name'), abstract: textOf(ft, 'Abstract'), crs, bbox };
  }).filter((l) => l.name);
  const title = textOf(kid(x, 'ServiceIdentification'), 'Title') || textOf(kid(x, 'Service'), 'Title');
  return { url, version, title, layers, formats: [...new Set(formats)], paging, countDefault: Number.isFinite(cd) && cd > 0 ? cd : null };
}
export interface WFSFields {
  /** the layer's fields (not its geometry) */
  fields: { name: string; type: string }[];
  /** its geometry's field and type (gml:MultiSurfacePropertyType …; null: none said) */
  geometry: { name: string; type: string } | null;
}
/** a WFS layer's fields (DescribeFeatureType) */
export async function wfsDescribe(url: string, typeName: string, o: ServiceOptions & { version?: '2.0.0' | '1.1.0' } = {}): Promise<WFSFields> {
  const v = o.version ?? '2.0.0';
  const q = v === '2.0.0' ? { service: 'WFS', version: v, request: 'DescribeFeatureType', typeNames: typeName } : { service: 'WFS', version: v, request: 'DescribeFeatureType', typeName };
  return readWFSDescribe(await serviceText(withParams(url, q), o, 'wfs'));
}
/** a DescribeFeatureType schema read */
export function readWFSDescribe(xsd: string): WFSFields {
  const x = readXML(xsd), fields: WFSFields['fields'] = [];
  let geometry: WFSFields['geometry'] = null;
  for (const ct of under(x, 'complexType')) for (const el of under(ct, 'element')) {
    const name = el.attrs.name, type = el.attrs.type ?? '';
    if (!name) continue;
    if (/^gml:|PropertyType$/.test(type) && /(Point|Line|Curve|Surface|Polygon|Geometry)/i.test(type)) { geometry ??= { name, type }; continue; }
    fields.push({ name, type: type.replace(/^\w+:/, '') });
  }
  return { fields, geometry };
}

// ── WMS ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface WMSLayer {
  name: string; title: string; abstract: string;
  /** its coordinate systems (inherited from the layers above it too) */
  crs: string[];
  bbox: BBox | null;
  /** it answers GetFeatureInfo (a tap can ask what is there) */
  queryable: boolean;
  /** its default style's legend picture (null: none said; raster.wms.legend asks GetLegendGraphic) */
  legend: string | null;
  styles: { name: string; title: string; legend: string | null }[];
}
export interface WMSCapabilities {
  url: string; version: string; title: string; layers: WMSLayer[];
  /** GetMap's picture formats */
  formats: string[];
  /** GetFeatureInfo's answer formats */
  infoFormats: string[];
}
/** a WMS's capabilities (1.3.0; 1.1.1 when the service does not answer it) */
export async function wmsCapabilities(url: string, o: ServiceOptions & { version?: '1.3.0' | '1.1.1' } = {}): Promise<WMSCapabilities> {
  const tryV = async (v: string) => readWMSCapabilities(await serviceText(withParams(url, { service: 'WMS', version: v, request: 'GetCapabilities' }), o, 'wms'), url);
  if (o.version) return tryV(o.version);
  try { return await tryV('1.3.0'); } catch (e) { try { return await tryV('1.1.1'); } catch { throw e; } }
}
/** a WMS GetCapabilities document read: its named layers, flat (a group's coordinate systems and box passed down) */
export function readWMSCapabilities(xml: string, url = ''): WMSCapabilities {
  const x = readXML(xml);
  if (!/Capabilities$/.test(x.name)) throw new AslnutError('E-DATA-002', `not a WMS capabilities document (got <${x.name}>)`, { where: url || 'wms', fix: 'check the URL: it should answer request=GetCapabilities&service=WMS' });
  const cap = kid(x, 'Capability'), req = kid(cap, 'Request');
  const fmts = (n: string) => kidsOf(kid(req, n), 'Format').map((f) => f.text.trim());
  const layers: WMSLayer[] = [];
  const walk = (n: XNode, crs0: string[], bbox0: BBox | null) => {
    const crs = [...new Set([...crs0, ...[...kidsOf(n, 'CRS'), ...kidsOf(n, 'SRS')].flatMap((c) => c.text.trim().split(/\s+/)).filter(Boolean)])];
    const ex = kid(n, 'EX_GeographicBoundingBox'), ll = kid(n, 'LatLonBoundingBox');
    let bbox = bbox0;
    if (ex) bbox = [Number(textOf(ex, 'westBoundLongitude')), Number(textOf(ex, 'southBoundLatitude')), Number(textOf(ex, 'eastBoundLongitude')), Number(textOf(ex, 'northBoundLatitude'))];
    else if (ll) bbox = [Number(ll.attrs.minx), Number(ll.attrs.miny), Number(ll.attrs.maxx), Number(ll.attrs.maxy)];
    if (bbox && !bbox.every(Number.isFinite)) bbox = bbox0;
    const name = textOf(n, 'Name');
    if (name) {
      const styles = kidsOf(n, 'Style').map((s) => ({ name: textOf(s, 'Name'), title: textOf(s, 'Title'), legend: kid(kid(s, 'LegendURL'), 'OnlineResource')?.attrs.href ?? null }));
      layers.push({ name, title: textOf(n, 'Title') || name, abstract: textOf(n, 'Abstract'), crs, bbox, queryable: n.attrs.queryable === '1' || n.attrs.queryable === 'true', legend: styles[0]?.legend ?? null, styles });
    }
    for (const k of kidsOf(n, 'Layer')) walk(k, crs, bbox);
  };
  for (const l of kidsOf(cap, 'Layer')) walk(l, [], null);
  return { url, version: x.attrs.version ?? '', title: textOf(kid(x, 'Service'), 'Title'), layers, formats: fmts('GetMap'), infoFormats: fmts('GetFeatureInfo') };
}
