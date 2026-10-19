// Shared metric graph contracts. Source adapters construct these; core does not interpret tags.
export type P2 = [number, number];
/** a road way: its node ids, points [lon, lat] and tags */
export interface RoadWay { id: string | number; nodes: number[]; pts: [number, number][]; tags: Record<string, string> }
export interface RoadEdge {
  id: string; way: string | number; tags: Record<string, string>;
  /** its two end nodes */
  a: number; b: number;
  /** its points in metres, and each point's node id */
  pts: P2[]; nodes: number[];
  /** the road's level: 0 on the ground, above with bridges and positive layers, below with tunnels */
  layer: number; bridge: boolean; tunnel: boolean; oneway: boolean;
}
export interface RoadNode { id: number; at: P2; edges: string[] }
export interface RoadGraph { origin: [number, number]; nodes: Map<number, RoadNode>; edges: Map<string, RoadEdge>; toLocal(lon: number, lat: number): P2; toLonLat(x: number, z: number): [number, number] }
