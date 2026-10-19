/** Quantized numeric rows. Three interleaved delta channels, zigzag varints, base64.
 * Polygons stay polygons; no normals, colours or flat triangle meshes are stored. */
export function encodeNumbers(rows: readonly (readonly number[])[], scale = 1000): string[] {
  return rows.map(row => {
    const bytes: number[] = [], previous = [0, 0, 0];
    row.forEach((value, i) => {
      const n = Math.round(value * scale), delta = n - previous[i % 3]!;
      previous[i % 3] = n;
      let v = delta < 0 ? -delta * 2 - 1 : delta * 2;
      if (!Number.isSafeInteger(v)) throw new Error('Numeric row exceeds quantization range');
      do { const b = v % 128; v = Math.floor(v / 128); bytes.push(b + (v ? 128 : 0)); } while (v);
    });
    let bin = ''; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.slice(i, i + 8192));
    return btoa(bin);
  });
}
export function decodeNumbers(rows: readonly string[], scale = 1000): number[][] {
  return rows.map(row => {
    const bin = atob(row), result: number[] = [], previous = [0, 0, 0];
    let value = 0, factor = 1;
    for (let i = 0; i < bin.length; i++) {
      const b = bin.charCodeAt(i); value += (b % 128) * factor;
      if (b >= 128) { factor *= 128; if (factor > 2 ** 49) throw new Error('Invalid numeric varint'); continue; }
      const channel = result.length % 3, delta = value % 2 ? -(value + 1) / 2 : value / 2;
      previous[channel] = previous[channel]! + delta; result.push(previous[channel]! / scale); value = 0; factor = 1;
    }
    if (factor !== 1) throw new Error('Truncated numeric varint');
    return result;
  });
}
export function decodeTile<T extends { pieces?: number[][]; numeric?: string[]; numericScale?:number; turnUnits?:number }>(tile: T): T & { pieces: number[][] } {
  if (tile.numeric) { tile.pieces = decodeNumbers(tile.numeric,tile.numericScale??1000);
    if(tile.turnUnits)for(const row of tile.pieces)if(row[0]===3)row[9]=row[9]!/tile.turnUnits;
    delete tile.numeric; }
  return tile as T & { pieces: number[][] };
}
