import { useMemo } from 'react';
import type { PartName, Pose } from '../../../../shared/protocol';
import { PART_DIMS } from '../../../../shared/body';
import { SCALE, WALL_DEPTH, segmentRotationZ, wallToWorld } from './coords';

const SEGMENT_PARTS: PartName[] = [
  'upperLegL',
  'lowerLegL',
  'upperLegR',
  'lowerLegR',
  'torso',
  'upperArmL',
  'lowerArmL',
  'upperArmR',
  'lowerArmR',
];

const SKIN = '#d9a679';
const SKIN_EXPOSED = '#e0876c';

interface Props {
  pose: Pose;
  exposed?: Set<PartName>;
}

/**
 * The hider's body, built from capsules + a sphere head, pressed flat against
 * the BACK of the wall. Each part keeps its own z so it hugs the wall by its
 * radius — bullets travel along z, so adjudication stays purely 2D.
 */
export function Body3D({ pose, exposed }: Props) {
  const partZ = useMemo(() => {
    const z: Partial<Record<PartName, number>> = {};
    for (const part of Object.keys(PART_DIMS) as PartName[]) {
      z[part] = -WALL_DEPTH - PART_DIMS[part].r / SCALE;
    }
    return z as Record<PartName, number>;
  }, []);

  const headR = PART_DIMS.head.r / SCALE;
  const [hx, hy] = wallToWorld(pose.head.x, pose.head.y);

  return (
    <group>
      {SEGMENT_PARTS.map((part) => {
        const t = pose[part];
        const { len, r } = PART_DIMS[part];
        const [cx, cy] = wallToWorld(t.x, t.y);
        return (
          <mesh
            key={part}
            position={[cx, cy, partZ[part]]}
            rotation={[0, 0, segmentRotationZ(t.angle)]}
          >
            <capsuleGeometry args={[r / SCALE, len / SCALE, 6, 14]} />
            <meshStandardMaterial
              color={exposed?.has(part) ? SKIN_EXPOSED : SKIN}
              roughness={0.75}
            />
          </mesh>
        );
      })}
      <mesh position={[hx, hy, partZ.head]}>
        <sphereGeometry args={[headR, 22, 18]} />
        <meshStandardMaterial color={exposed?.has('head') ? SKIN_EXPOSED : SKIN} roughness={0.7} />
      </mesh>
      {/* face on the back of the head is what the SHOOTER sees through holes;
          eyes sit toward the wall (the hider faces the wall, hugging it) */}
      <mesh position={[hx - headR * 0.35, hy + headR * 0.15, partZ.head + headR * 0.85]}>
        <sphereGeometry args={[headR * 0.13, 8, 8]} />
        <meshBasicMaterial color="#3b2c1e" />
      </mesh>
      <mesh position={[hx + headR * 0.35, hy + headR * 0.15, partZ.head + headR * 0.85]}>
        <sphereGeometry args={[headR * 0.13, 8, 8]} />
        <meshBasicMaterial color="#3b2c1e" />
      </mesh>
    </group>
  );
}
