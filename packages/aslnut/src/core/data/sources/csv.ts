// core › data › sources › csv: a table as text → rows (objects by header). Quoted fields ("a, b", "" for a quote),
// any delimiter, numbers read as numbers when the whole field is one.
//   parseCSV('name,lon,lat\nLembang,107.62,-6.81') → [{ name: 'Lembang', lon: 107.62, lat: -6.81 }]
import { AslnutError } from '../../world/errors.ts';

export interface CSVOptions { delimiter?: string; /** read numeric fields as numbers (default true) */ numbers?: boolean }
const NUM = /^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;

export function parseCSV(text: string, o: CSVOptions = {}, where = 'csv'): Record<string, unknown>[] {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const d = o.delimiter ?? (t.slice(0, t.indexOf('\n') >>> 0).split('\t').length > t.slice(0, t.indexOf('\n') >>> 0).split(',').length ? '\t' : ',');
  const rows: string[][] = [];
  let row: string[] = [], f = '', q = false, i = 0, line = 1;
  for (; i < t.length; i++) {
    const c = t[i]!;
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else { if (c === '\n') line++; f += c; }
    } else if (c === '"' && f === '') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; line++; }
    else f += c;
  }
  if (q) throw new AslnutError('E-DATA-002', `a quoted field is not closed (line ${line})`, { where, fix: 'close the quote; write "" for a quote inside a field' });
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0]!.map((h) => h.trim()), nums = o.numbers !== false;
  return rows.slice(1).map((r) => {
    const out: Record<string, unknown> = {};
    head.forEach((h, k) => { const v = r[k] ?? ''; out[h] = nums && NUM.test(v) ? Number(v) : v; });
    return out;
  });
}
