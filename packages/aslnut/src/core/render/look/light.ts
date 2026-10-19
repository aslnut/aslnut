// core › render › look › light: the light a world is lit by (the sun by day, the moon by night, from a sky module) and the
// sun's shadow map: a picture of the casters' depth seen from the sun, over the part of the world near the camera,
// drawn before each frame on WebGPU and WebGL2 alike (an 8-bit colour target holding packed depth), read by every lit
// program (shaders/light.*). Without a light, every mark keeps its own fixed shading.
//   world(canvas, { body: earth({ sky: sky() }), render: { shadows: { distance: 1500 } } })
import { mat4, vec3 } from 'wgpu-matrix';
import type { Camera } from '../../observation/observers/orbit/camera.ts';

export interface Light {
  /** towards the light, in the world's axes (x east, y up, z south), unit length */
  dir: [number, number, number];
  /** its colour × intensity (all 0: nothing lights directly) */
  color: [number, number, number];
  /** the sky's light (rgb), and how much the ground bounces back up (0..1) */
  ambient: [number, number, number]; bounce: number;
  /** 0 night … 1 day */
  daylight: number;
  /** may it cast shadows now (the sun or a bright moon up, the sky not overcast) */
  shadows: boolean;
  /** the air's colour far away (the ground fades into it): the sky's horizon */
  haze?: [number, number, number];
  /** how far one sees through the air (m): fog and rain bring it close; none: only the views' own distance fade */
  visibility?: number;
  /** the weather on the ground: wet 0..1 (rain darkens and gleams), a lightning flash 0..1, cloud cover 0..1, wind m/s,
   *  rain falling 0..1 */
  wet?: number; flash?: number; cover?: number; wind?: number; rain?: number;
  /** the cloud deck that shades the ground (with cover): its base above sea level (m) and where its pattern is (x, z:
   *  metres, the view's centre plus the drift, wrapped); none: no cloud shadows */
  clouds?: { base: number; x: number; z: number };
}
export interface ShadowOptions {
  /** the farthest from the camera's ground point shadows reach, metres (default 1500; 700 at quality lite); farther
   *  views have none */
  distance?: number;
  /** the shadow map's side, px (default 2048, 1024 at quality lite) */
  size?: number;
  /** 0..1 how dark (default 1: a shadow takes the sun away entirely) */
  strength?: number;
}

/** the sun's view of the ground near the camera: a box round the part of the view that is close (the camera's ground
 *  point towards its centre), snapped to whole texels (shadows never crawl as the camera moves); null: too far */
export function shadowBox(c: Camera, dir: readonly number[], size: number, distance: number, origin: readonly [number, number, number] = [0, 0, 0]): { viewProj: Float32Array; eye: [number, number, number]; texel: number; depthPerMetre: number } | null {
  const h = c.dist * Math.cos(c.pitch), below: [number, number, number] = [c.eye[0]!, c.groundY, c.eye[2]!];
  // round the view's centre (it stays put while the view turns round it: the map is kept), reaching most of the way
  // to the camera's ground point
  const r = Math.min(distance, Math.max(60, 0.85 * h + 0.6 * c.dist));
  if (0.55 * h + 0.6 * c.dist > distance * 2.2) return null;
  const centre = [0, c.groundY, 0]; void below;
  const far = 2 * r + 600, d = vec3.normalize(vec3.fromValues(dir[0]!, Math.max(0.02, dir[1]!), dir[2]!));
  const up = Math.abs(d[1]!) > 0.99 ? [0, 0, -1] : [0, 1, 0];
  const at = vec3.fromValues(centre[0]!, centre[1]!, centre[2]!), from = vec3.add(at, vec3.mulScalar(d, far));
  const view = mat4.lookAt(from, at, up);
  // snapped: the box moves by whole texels of the ground (the world's origin is the view's centre, which moves with
  // the camera: `origin` is where that centre is in metres of a frame fixed to the ground, in double precision)
  const texel = (2 * r) / size, cv = vec3.transformMat4(at, view);
  const fx = -d[0]!, fy = -d[1]!, fz = -d[2]!;
  let rx = fy * up[2]! - fz * up[1]!, ry = fz * up[0]! - fx * up[2]!, rz = fx * up[1]! - fy * up[0]!; const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  const ax = origin[0] * rx + origin[1] * ry + origin[2] * rz, ay = origin[0] * ux + origin[1] * uy + origin[2] * uz;
  const sx = Math.round((cv[0]! + ax) / texel) * texel - ax - cv[0]!, sy = Math.round((cv[1]! + ay) / texel) * texel - ay - cv[1]!;
  const proj = mat4.ortho(-r + cv[0]! + sx, r + cv[0]! + sx, -r + cv[1]! + sy, r + cv[1]! + sy, 1, 2 * far);
  const viewProj = mat4.multiply(proj, view) as Float32Array;
  return { viewProj, eye: [from[0]!, from[1]!, from[2]!], texel, depthPerMetre: 1 / (2 * far - 1) };
}

/** a box (world metres) is in the view of a view-projection: not wholly outside one of its planes */
export function inView(vp: ArrayLike<number>, b: readonly number[]): boolean {
  let out = 0b111111;
  for (let k = 0; k < 8; k++) {
    const x = k & 1 ? b[3]! : b[0]!, y = k & 2 ? b[4]! : b[1]!, z = k & 4 ? b[5]! : b[2]!;
    const cx = vp[0]! * x + vp[4]! * y + vp[8]! * z + vp[12]!, cy = vp[1]! * x + vp[5]! * y + vp[9]! * z + vp[13]!, cz = vp[2]! * x + vp[6]! * y + vp[10]! * z + vp[14]!, cw = vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!;
    let o = 0; if (cx < -cw) o |= 1; if (cx > cw) o |= 2; if (cy < -cw) o |= 4; if (cy > cw) o |= 8; if (cz < 0) o |= 16; if (cz > cw) o |= 32;
    out &= o; if (!out) return true;
  }
  return out === 0;
}
