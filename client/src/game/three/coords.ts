// Bridge between wall-plane game coordinates (x right, y DOWN, 400×500 units —
// see shared/body.ts) and the 3D world (x right, y UP, wall centered at origin).
// All game logic stays in wall units; only rendering converts.

import { WALL_H, WALL_W } from '../../../../shared/body';

export const SCALE = 100; // wall units per world unit
export const WALL_W3 = WALL_W / SCALE; // 4
export const WALL_H3 = WALL_H / SCALE; // 5
export const WALL_DEPTH = 0.15; // wall thickness (world units)

/** Wall-plane point → world x/y (wall front face is the z=0 plane). */
export function wallToWorld(x: number, y: number): [number, number] {
  return [x / SCALE - WALL_W3 / 2, WALL_H3 / 2 - y / SCALE];
}

/** World point on the wall plane → wall-plane coords. */
export function worldToWall(wx: number, wy: number): { x: number; y: number } {
  return { x: (wx + WALL_W3 / 2) * SCALE, y: (WALL_H3 / 2 - wy) * SCALE };
}

/** Wall-plane angle (y-down) → world rotation.z for a capsule whose axis is +Y. */
export function segmentRotationZ(angle: number): number {
  return -angle - Math.PI / 2;
}
