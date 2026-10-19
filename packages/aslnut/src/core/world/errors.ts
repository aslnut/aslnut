// core › world › errors: every error aslnut throws says what happened, where, and the fix.
//   catch (e) { if (e instanceof AslnutError && e.code === 'E-GPU-001') showUnsupported(e.fix) }

export type ErrorCode =
  | 'E-GPU-001'      // neither WebGPU nor WebGL2 here
  | 'E-GPU-002'      // the graphics asked for is not here (webgpu forced on a browser without it)
  | 'E-GPU-003'      // a shader failed to compile (the core's own: a bug; yours: your line)
  | 'E-GPU-004'      // the graphics device was lost
  | 'E-GPU-005'      // a copy on the chip did not land (WebGL2 refused it under a busy GPU process): the tile loads again
  | 'E-SHADER-001'   // your shader code: not in the WGSL subset, or a type error (line and column given)
  | 'E-WORLD-001'    // an element without an id / two elements with one id
  | 'E-WORLD-002'    // unknown element id (move, above, below, get)
  | 'E-WORLD-003'    // the world was disposed
  | 'E-WORLD-004'    // a param: unknown key, or a value of the wrong type
  | 'E-WORLD-005'    // w.control of an entity in no entity element
  | 'E-WORLD-006'    // a recording that is not one (its fps, frames, seconds or size), or one asked while another is under way
  | 'E-LEVEL-001'    // observation levels: a ladder that is not one, an unknown level, a binding that failed
  | 'E-WHEN-001'     // a `when` returned something that is not a boolean or a number in 0..1
  | 'E-VIEW-001'     // a view or camera move that is not one: no lon / lat, a dist and a zoom that disagree, a number not finite (NaN, Infinity), an unknown ease or path
  | 'E-SETTLE-001'   // strict settled: not settled in time (what is still pending is listed)
  | 'E-SETTLE-002'   // strict settled: a tile or layer failed (what failed is listed)
  | 'E-LOAD-001'     // the loader's mode forbids the network and no tier has it
  | 'E-LOAD-002'     // a source's terms forbid this (prefetch, keep, export)
  | 'E-LOAD-003'     // a byte range came back wrong
  | 'E-LOAD-004'     // an unsafe scope name
  | 'E-LOAD-005'     // a pack is malformed
  | 'E-DATA-001'     // a source's options are wrong (a missing url, a bad bbox)
  | 'E-DATA-002'     // data could not be read (not GeoJSON, a bad CSV row, a broken tile)
  | 'E-DATA-003'     // data that would change by looking: a scale's 'auto' domain over a tiled source; a service layer too big to load once without an extent
  | 'E-DATA-004'     // an unsupported saved data format version
  | 'E-LOAD-006'     // an image decode worker failed
  | 'E-STATE-001'    // a saved state does not fit the state schema (its path and the fix given)
  | 'E-LANE-001'     // a worker lane cannot run (no workers, the module failed to load) and has no fallback
  | 'E-LANE-002';    // a call in a worker failed (its error given)

export class AslnutError extends Error {
  readonly code: ErrorCode;
  /** what to do about it, in one sentence */
  readonly fix: string;
  /** where it happened: an element id, a source id, a shader line */
  readonly where: string;
  readonly details: unknown;
  constructor(code: ErrorCode, message: string, o: { fix?: string; where?: string; details?: unknown; cause?: unknown } = {}) {
    super(`aslnut ${code}: ${message}${o.where ? ` (at ${o.where})` : ''}${o.fix ? `. Fix: ${o.fix}` : ''}`, o.cause !== undefined ? { cause: o.cause } : undefined);
    this.name = 'AslnutError';
    this.code = code; this.fix = o.fix ?? ''; this.where = o.where ?? ''; this.details = o.details;
  }
}

/** neither (or not the asked) graphics: carries what the device has, so a page can explain it plainly */
export class GraphicsUnavailable extends AslnutError {
  readonly asked: string; readonly found: { webgpu: boolean; webgl2: boolean; reason: string };
  constructor(asked: string, found: { webgpu: boolean; webgl2: boolean; reason: string }) {
    const none = !found.webgpu && !found.webgl2;
    super(none ? 'E-GPU-001' : 'E-GPU-002',
      none ? `this browser has neither WebGPU nor WebGL2 (${found.reason})` : `graphics '${asked}' was asked for, but this browser has only ${found.webgpu ? 'WebGPU' : 'WebGL2'} (${found.reason})`,
      { fix: none ? 'update the browser, or turn on hardware acceleration in its settings' : `use graphics: 'auto' (it picks ${found.webgpu ? 'WebGPU' : 'WebGL2'} here)`, details: found });
    this.name = 'GraphicsUnavailable';
    this.asked = asked; this.found = found;
  }
}
