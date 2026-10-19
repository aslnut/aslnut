// core › geometry › build › earcut: polygons (with holes) → triangles, by ear clipping on a linked ring with holes
// bridged in (the method of Mapbox's earcut, ISC licence: see NOTICE). Flat coordinates in, triangle indices out.
//   earcut([0,0, 10,0, 10,10, 0,10], [], 2) → [1, 0, 3, 3, 2, 1]

interface Node { i: number; x: number; y: number; prev: Node; next: Node; steiner: boolean }

export function earcut(data: ArrayLike<number>, holes: number[] = [], dim = 2): number[] {
  const hasHoles = holes.length > 0, outerLen = hasHoles ? holes[0]! * dim : data.length;
  let outer = linkedList(data, 0, outerLen, dim, true);
  const tris: number[] = [];
  if (!outer || outer.next === outer.prev) return tris;
  if (hasHoles) outer = eliminateHoles(data, holes, outer, dim);
  earcutLinked(outer, tris, 0);
  return tris;
}

function linkedList(data: ArrayLike<number>, start: number, end: number, dim: number, clockwise: boolean): Node | null {
  let last: Node | null = null;
  if (clockwise === signedArea(data, start, end, dim) > 0) for (let i = start; i < end; i += dim) last = insert(i / dim, data[i]!, data[i + 1]!, last);
  else for (let i = end - dim; i >= start; i -= dim) last = insert(i / dim, data[i]!, data[i + 1]!, last);
  if (last && equals(last, last.next)) { remove(last); last = last.next; }
  return last;
}
function filterPoints(start: Node, end?: Node): Node {
  let p = start, again: boolean;
  end ??= start;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      remove(p); p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else p = p.next;
  } while (again || p !== end);
  return end;
}
function earcutLinked(ear: Node | null, tris: number[], pass: number): void {
  if (!ear) return;
  let stop = ear;
  while (ear.prev !== ear.next) {
    const prev: Node = ear.prev, next: Node = ear.next;
    if (isEar(ear)) {
      tris.push(prev.i, ear.i, next.i);
      remove(ear);
      ear = next.next; stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      if (!pass) earcutLinked(filterPoints(ear), tris, 1);
      else if (pass === 1) { ear = cureLocalIntersections(filterPoints(ear), tris); earcutLinked(ear, tris, 2); }
      else if (pass === 2) splitEarcut(ear, tris);
      break;
    }
  }
}
function isEar(ear: Node): boolean {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;
  const x0 = Math.min(a.x, b.x, c.x), y0 = Math.min(a.y, b.y, c.y), x1 = Math.max(a.x, b.x, c.x), y1 = Math.max(a.y, b.y, c.y);
  let p = c.next;
  while (p !== a) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}
function cureLocalIntersections(start: Node, tris: number[]): Node {
  let p = start;
  do {
    const a = p.prev, b = p.next.next;
    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      tris.push(a.i, p.i, b.i);
      remove(p); remove(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p);
}
function splitEarcut(start: Node, tris: number[]): void {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c = splitPolygon(a, b);
        a = filterPoints(a, a.next); c = filterPoints(c, c.next);
        earcutLinked(a, tris, 0); earcutLinked(c, tris, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}
function eliminateHoles(data: ArrayLike<number>, holes: number[], outer: Node, dim: number): Node {
  const queue: Node[] = [];
  for (let i = 0; i < holes.length; i++) {
    const start = holes[i]! * dim, end = i < holes.length - 1 ? holes[i + 1]! * dim : data.length;
    const list = linkedList(data, start, end, dim, false);
    if (!list) continue;
    if (list === list.next) list.steiner = true;
    queue.push(leftmost(list));
  }
  queue.sort((a, b) => a.x - b.x);
  for (const h of queue) outer = eliminateHole(h, outer);
  return outer;
}
function eliminateHole(hole: Node, outer: Node): Node {
  const bridge = findHoleBridge(hole, outer);
  if (!bridge) return outer;
  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next);
}
function findHoleBridge(hole: Node, outer: Node): Node | null {
  let p = outer, qx = -Infinity, m: Node | null = null;
  const hx = hole.x, hy = hole.y;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
      if (x <= hx && x > qx) { qx = x; m = p.x < p.next.x ? p : p.next; if (x === hx) return m; }
    }
    p = p.next;
  } while (p !== outer);
  if (!m) return null;
  const stop = m, mx = m.x, my = m.y;
  let tanMin = Infinity;
  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) { m = p; tanMin = tan; }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}
const sectorContainsSector = (m: Node, p: Node) => area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
function leftmost(start: Node): Node { let p = start, l = start; do { if (p.x < l.x || (p.x === l.x && p.y < l.y)) l = p; p = p.next; } while (p !== start); return l; }
function pointInTriangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
}
function isValidDiagonal(a: Node, b: Node): boolean {
  return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
    ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (area(a.prev, a, b.prev) !== 0 || area(a, b.prev, b) !== 0)) ||
     (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0));
}
const area = (p: Node, q: Node, r: Node) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
const equals = (a: Node, b: Node) => a.x === b.x && a.y === b.y;
function intersects(p1: Node, q1: Node, p2: Node, q2: Node): boolean {
  const o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2)), o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}
const onSegment = (p: Node, q: Node, r: Node) => q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
function intersectsPolygon(a: Node, b: Node): boolean {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);
  return false;
}
const locallyInside = (a: Node, b: Node) => (area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0);
function middleInside(a: Node, b: Node): boolean {
  let p = a, inside = false;
  const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
  do {
    if (p.y > py !== p.next.y > py && p.next.y !== p.y && px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x) inside = !inside;
    p = p.next;
  } while (p !== a);
  return inside;
}
function splitPolygon(a: Node, b: Node): Node {
  const a2 = node(a.i, a.x, a.y), b2 = node(b.i, b.x, b.y), an = a.next, bp = b.prev;
  a.next = b; b.prev = a;
  a2.next = an; an.prev = a2;
  b2.next = a2; a2.prev = b2;
  bp.next = b2; b2.prev = bp;
  return b2;
}
function insert(i: number, x: number, y: number, last: Node | null): Node {
  const p = node(i, x, y);
  if (!last) { p.prev = p; p.next = p; }
  else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
  return p;
}
function remove(p: Node): void { p.next.prev = p.prev; p.prev.next = p.next; }
function node(i: number, x: number, y: number): Node { const n = { i, x, y, steiner: false } as Node; n.prev = n; n.next = n; return n; }
function signedArea(data: ArrayLike<number>, start: number, end: number, dim: number): number {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; i += dim) { sum += (data[j]! - data[i]!) * (data[i + 1]! + data[j + 1]!); j = i; }
  return sum;
}
