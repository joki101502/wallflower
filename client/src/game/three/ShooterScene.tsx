import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { Hole, Pose } from '../../../../shared/protocol';
import { WALL_H, WALL_W } from '../../../../shared/body';
import { WALL_H3, WALL_W3, worldToWall } from './coords';
import { WallMesh } from './WallMesh';
import { Body3D } from './Body3D';

interface Props {
  holes: Hole[];
  oppPose: Pose | null;
  canShoot: boolean;
  fireShot: (x: number, y: number) => void;
}

/**
 * Scene contents for the shooter: standing in front of the wall. The hider is
 * fully rendered behind it but the opaque slab occludes everything except what
 * lines up with a hole. Rendered inside GameView's single persistent Canvas.
 */
export function ShooterScene({ holes, oppPose, canShoot, fireShot }: Props) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.position.set(0, 0, 5.4);
    camera.rotation.set(0, 0, 0);
  }, [camera]);

  return (
    <>
      <color attach="background" args={['#101116']} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[2.5, 3.5, 5]} intensity={1.1} />
      {/* light on the hider's side so the body reads through peepholes */}
      <pointLight position={[0, 1, -2.2]} intensity={6} distance={8} />

      {/* invisible full-wall plane at z=0 catches every aim click, even ones
          over an existing hole (where the wall mesh has no geometry) */}
      <mesh
        position={[0, 0, 0.001]}
        onClick={(e) => {
          if (!canShoot) return;
          e.stopPropagation();
          const { x, y } = worldToWall(e.point.x, e.point.y);
          if (x >= 0 && x <= WALL_W && y >= 0 && y <= WALL_H) fireShot(x, y);
        }}
      >
        <planeGeometry args={[WALL_W3, WALL_H3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <WallMesh holes={holes} rimSide={1} />
      {oppPose && <Body3D pose={oppPose} />}

      {/* floor on the shooter's side for depth */}
      <mesh position={[0, -WALL_H3 / 2, 2.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 6]} />
        <meshStandardMaterial color="#1a1b20" roughness={1} />
      </mesh>
    </>
  );
}
