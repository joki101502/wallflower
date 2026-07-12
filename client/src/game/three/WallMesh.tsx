import { useMemo } from 'react';
import * as THREE from 'three';
import type { Hole } from '../../../../shared/protocol';
import { HOLE_R } from '../../../../shared/body';
import { SCALE, WALL_DEPTH, WALL_H3, WALL_W3, wallToWorld } from './coords';

const HOLE_R3 = HOLE_R / SCALE;

interface Props {
  holes: Hole[];
  /** Which face gets the hit/miss rim rings: +1 = shooter side (z=0), -1 = hider side. */
  rimSide: 1 | -1;
  color?: string;
}

/**
 * The wall: an extruded slab with real circular holes cut out, so the hider
 * behind it is only visible through the openings (true occlusion, PRD §4.3).
 * Front face sits at z=0, back face at z=-WALL_DEPTH.
 */
export function WallMesh({ holes, rimSide, color = '#585c66' }: Props) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-WALL_W3 / 2, -WALL_H3 / 2);
    shape.lineTo(WALL_W3 / 2, -WALL_H3 / 2);
    shape.lineTo(WALL_W3 / 2, WALL_H3 / 2);
    shape.lineTo(-WALL_W3 / 2, WALL_H3 / 2);
    shape.closePath();
    for (const h of holes) {
      const [cx, cy] = wallToWorld(h.x, h.y);
      const path = new THREE.Path();
      path.absarc(cx, cy, HOLE_R3, 0, Math.PI * 2, true);
      shape.holes.push(path);
    }
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: WALL_DEPTH,
      bevelEnabled: false,
      curveSegments: 24,
    });
    geo.translate(0, 0, -WALL_DEPTH);
    return geo;
  }, [holes]);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={color} roughness={0.92} metalness={0.05} />
      </mesh>
      {/* rim rings marking each shot: red = it connected */}
      {holes.map((h, i) => {
        const [cx, cy] = wallToWorld(h.x, h.y);
        const z = rimSide === 1 ? 0.005 : -WALL_DEPTH - 0.005;
        return (
          <mesh key={i} position={[cx, cy, z]} rotation={rimSide === 1 ? [0, 0, 0] : [0, Math.PI, 0]}>
            <ringGeometry args={[HOLE_R3, HOLE_R3 * 1.35, 24]} />
            <meshBasicMaterial color={h.hit ? '#c94b37' : '#26282e'} />
          </mesh>
        );
      })}
    </group>
  );
}
