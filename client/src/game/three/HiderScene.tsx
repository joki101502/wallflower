import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import type { Hole, Pose } from '../../../../shared/protocol';
import {
  anchors,
  buildPose,
  clampControls,
  defaultControls,
  exposedParts,
  type BodyControls,
} from '../../../../shared/body';
import { SCALE, WALL_DEPTH, WALL_H3, WALL_W3, wallToWorld, worldToWall } from './coords';
import { WallMesh } from './WallMesh';
import { Body3D } from './Body3D';

type HandleId = 'torso' | 'head' | 'handL' | 'handR' | 'footL' | 'footR';

const POSE_SEND_MS = 66; // ~15 Hz
const HANDLE_Z = -WALL_DEPTH - 0.45; // handles float just in front of the body

interface Props {
  holes: Hole[];
  sendPose: (pose: Pose) => void;
  /** increments every session so controls reset to the neutral pose */
  sessionKey: number;
}

/**
 * Scene contents for the hider: behind the wall, looking at your own back as
 * you hug it. Holes glow with light from the shooter's side — those are your
 * exposed spots. Rendered inside GameView's single persistent Canvas.
 */
export function HiderScene({ holes, sendPose, sessionKey }: Props) {
  const [controls, setControls] = useState<BodyControls>(defaultControls);
  const [dragId, setDragId] = useState<HandleId | null>(null);
  const lastSent = useRef(0);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    camera.position.set(0, 0.2, -5.6);
    camera.rotation.set(0, Math.PI, 0);
  }, [camera]);

  useEffect(() => {
    gl.domElement.style.cursor = dragId ? 'grabbing' : 'auto';
    return () => {
      gl.domElement.style.cursor = 'auto';
    };
  }, [dragId, gl]);

  useEffect(() => {
    const c = defaultControls();
    setControls(c);
    sendPose(buildPose(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const pose = useMemo(() => buildPose(controls), [controls]);
  const exposed = useMemo(() => exposedParts(pose, holes), [pose, holes]);

  useEffect(() => {
    const now = Date.now();
    const due = lastSent.current + POSE_SEND_MS;
    if (now >= due) {
      lastSent.current = now;
      sendPose(pose);
    } else {
      if (sendTimer.current) clearTimeout(sendTimer.current);
      sendTimer.current = setTimeout(() => {
        lastSent.current = Date.now();
        sendPose(pose);
      }, due - now);
    }
    return () => {
      if (sendTimer.current) clearTimeout(sendTimer.current);
    };
  }, [pose, sendPose]);

  function applyDrag(e: ThreeEvent<PointerEvent>) {
    if (!dragId) return;
    const p = worldToWall(e.point.x, e.point.y);
    setControls((c) => {
      const cc = clampControls(c);
      const a = anchors(cc.torsoX);
      switch (dragId) {
        case 'torso':
          return clampControls({ ...cc, torsoX: p.x });
        case 'head':
          return clampControls({ ...cc, head: { x: p.x - a.neck.x, y: p.y - a.neck.y } });
        case 'handL':
          return clampControls({ ...cc, handL: { x: p.x - a.shoulderL.x, y: p.y - a.shoulderL.y } });
        case 'handR':
          return clampControls({ ...cc, handR: { x: p.x - a.shoulderR.x, y: p.y - a.shoulderR.y } });
        case 'footL':
          return clampControls({ ...cc, footL: { x: p.x - a.hipL.x, y: p.y - a.hipL.y } });
        case 'footR':
          return clampControls({ ...cc, footR: { x: p.x - a.hipR.x, y: p.y - a.hipR.y } });
      }
    });
  }

  const cc = clampControls(controls);
  const an = anchors(cc.torsoX);
  const handlePoints: { id: HandleId; x: number; y: number }[] = [
    { id: 'head', x: pose.head.x, y: pose.head.y },
    { id: 'torso', x: pose.torso.x, y: pose.torso.y },
    { id: 'handL', x: an.shoulderL.x + cc.handL.x, y: an.shoulderL.y + cc.handL.y },
    { id: 'handR', x: an.shoulderR.x + cc.handR.x, y: an.shoulderR.y + cc.handR.y },
    { id: 'footL', x: an.hipL.x + cc.footL.x, y: an.hipL.y + cc.footL.y },
    { id: 'footR', x: an.hipR.x + cc.footR.x, y: an.hipR.y + cc.footR.y },
  ];

  return (
    <>
      <color attach="background" args={['#17181d']} />
      <ambientLight intensity={0.5} />
      {/* soft light from the hider's side so they can see themselves */}
      <pointLight position={[0.5, 1.2, -3.5]} intensity={7} distance={9} />

      {/* bright "shooter's world" behind the holes: light leaks through.
          Exactly wall-sized and flush so it never spills past the edges. */}
      <mesh position={[0, 0, 0.02]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[WALL_W3, WALL_H3]} />
        <meshBasicMaterial color="#fff3c4" />
      </mesh>

      <WallMesh holes={holes} rimSide={-1} color="#31333c" />

      {/* light leaking through each hole onto the hider's side */}
      {holes.map((h, i) => {
        const [cx, cy] = wallToWorld(h.x, h.y);
        return (
          <pointLight
            key={i}
            position={[cx, cy, -WALL_DEPTH - 0.25]}
            intensity={1.6}
            distance={1.4}
            color="#fff3c4"
          />
        );
      })}

      <Body3D pose={pose} exposed={exposed} />

      {/* drag plane: catches pointer moves while a handle is grabbed */}
      <mesh
        position={[0, 0, HANDLE_Z]}
        rotation={[0, Math.PI, 0]}
        onPointerMove={applyDrag}
        onPointerUp={() => setDragId(null)}
      >
        <planeGeometry args={[WALL_W3 * 2, WALL_H3 * 2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* grab handles */}
      {handlePoints.map((h) => {
        const [cx, cy] = wallToWorld(h.x, h.y);
        return (
          <mesh
            key={h.id}
            position={[cx, cy, HANDLE_Z]}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDragId(h.id);
            }}
            onPointerUp={() => setDragId(null)}
          >
            <sphereGeometry args={[13 / SCALE, 14, 12]} />
            <meshBasicMaterial
              color={dragId === h.id ? '#ffffff' : '#cfd3dd'}
              transparent
              opacity={dragId === h.id ? 0.85 : 0.38}
            />
          </mesh>
        );
      })}

      {/* floor on the hider's side */}
      <mesh position={[0, -WALL_H3 / 2, -2.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 6]} />
        <meshStandardMaterial color="#131418" roughness={1} />
      </mesh>
    </>
  );
}
