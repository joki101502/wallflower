// Wallflower — shared body model: geometry, IK, pose building, hit testing.
// Used by the client (rendering + dragging) and the server (hit adjudication),
// so both always agree on where the body is.

import type { PartName, PartTransform, Pose } from './protocol.js';

// ---------- Wall plane (abstract units; SVG viewBox matches) ----------

export const WALL_W = 400;
export const WALL_H = 500;
export const HOLE_R = 10;

// ---------- Body dimensions ----------

export interface PartDims {
  len: number; // segment length (0 = circle)
  r: number; // radius / half-thickness
}

export const PART_DIMS: Record<PartName, PartDims> = {
  head: { len: 0, r: 20 },
  torso: { len: 110, r: 26 },
  upperArmL: { len: 52, r: 10 },
  lowerArmL: { len: 52, r: 9 },
  upperArmR: { len: 52, r: 10 },
  lowerArmR: { len: 52, r: 9 },
  upperLegL: { len: 62, r: 12 },
  lowerLegL: { len: 62, r: 11 },
  upperLegR: { len: 62, r: 12 },
  lowerLegR: { len: 62, r: 11 },
};

export const TORSO_CY = 300; // torso center is fixed vertically; slides in x
const TORSO_HALF = PART_DIMS.torso.len / 2;
const NECK_DY = -TORSO_HALF - 4; // neck anchor relative to torso center
const SHOULDER_DX = 26;
const SHOULDER_DY = -TORSO_HALF + 12;
const HIP_DX = 15;
const HIP_DY = TORSO_HALF - 7;

export const NECK_MAX = 42; // how far the head can move from the neck anchor
const ARM_REACH = PART_DIMS.upperArmL.len + PART_DIMS.lowerArmL.len - 2;
const LEG_REACH = PART_DIMS.upperLegL.len + PART_DIMS.lowerLegL.len - 2;

// ---------- Controls: what the hider actually drags ----------
// Offsets are relative (head to neck, hands to shoulders, feet to hips) so the
// whole body slides together when the torso is dragged.

export interface Vec2 {
  x: number;
  y: number;
}

export interface BodyControls {
  torsoX: number;
  head: Vec2;
  handL: Vec2;
  handR: Vec2;
  footL: Vec2;
  footR: Vec2;
}

export function defaultControls(): BodyControls {
  return {
    torsoX: WALL_W / 2,
    head: { x: 0, y: -20 },
    handL: { x: -66, y: 58 },
    handR: { x: 66, y: 58 },
    footL: { x: -42, y: 112 },
    footR: { x: 42, y: 112 },
  };
}

function clampLen(v: Vec2, maxLen: number): Vec2 {
  const d = Math.hypot(v.x, v.y);
  if (d <= maxLen || d === 0) return v;
  const s = maxLen / d;
  return { x: v.x * s, y: v.y * s };
}

export function clampControls(c: BodyControls): BodyControls {
  const margin = PART_DIMS.torso.r + 4;
  return {
    torsoX: Math.min(WALL_W - margin, Math.max(margin, c.torsoX)),
    head: clampLen(c.head, NECK_MAX),
    handL: clampLen(c.handL, ARM_REACH),
    handR: clampLen(c.handR, ARM_REACH),
    footL: clampLen(c.footL, LEG_REACH),
    footR: clampLen(c.footR, LEG_REACH),
  };
}

// ---------- Anchor points ----------

export interface Anchors {
  neck: Vec2;
  shoulderL: Vec2;
  shoulderR: Vec2;
  hipL: Vec2;
  hipR: Vec2;
}

export function anchors(torsoX: number): Anchors {
  return {
    neck: { x: torsoX, y: TORSO_CY + NECK_DY },
    shoulderL: { x: torsoX - SHOULDER_DX, y: TORSO_CY + SHOULDER_DY },
    shoulderR: { x: torsoX + SHOULDER_DX, y: TORSO_CY + SHOULDER_DY },
    hipL: { x: torsoX - HIP_DX, y: TORSO_CY + HIP_DY },
    hipR: { x: torsoX + HIP_DX, y: TORSO_CY + HIP_DY },
  };
}

// ---------- 2-bone IK (law of cosines) ----------

/** Returns the middle joint position for a 2-bone chain from `a` to target `t`. */
export function solveJoint(a: Vec2, t: Vec2, l1: number, l2: number, bend: 1 | -1): Vec2 {
  let dx = t.x - a.x;
  let dy = t.y - a.y;
  let d = Math.hypot(dx, dy);
  const min = Math.abs(l1 - l2) + 0.5;
  const max = l1 + l2 - 0.5;
  if (d < 1e-6) {
    dx = 0;
    dy = 1;
    d = 1;
  }
  const dc = Math.min(max, Math.max(min, d));
  const base = Math.atan2(dy, dx);
  const cos = (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc);
  const ang = Math.acos(Math.min(1, Math.max(-1, cos)));
  return {
    x: a.x + l1 * Math.cos(base + bend * ang),
    y: a.y + l1 * Math.sin(base + bend * ang),
  };
}

// ---------- Pose building ----------

function segTransform(p1: Vec2, p2: Vec2): PartTransform {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
    angle: Math.atan2(p2.y - p1.y, p2.x - p1.x),
  };
}

export function buildPose(raw: BodyControls): Pose {
  const c = clampControls(raw);
  const an = anchors(c.torsoX);

  const head: Vec2 = { x: an.neck.x + c.head.x, y: an.neck.y + c.head.y };
  const handL: Vec2 = { x: an.shoulderL.x + c.handL.x, y: an.shoulderL.y + c.handL.y };
  const handR: Vec2 = { x: an.shoulderR.x + c.handR.x, y: an.shoulderR.y + c.handR.y };
  const footL: Vec2 = { x: an.hipL.x + c.footL.x, y: an.hipL.y + c.footL.y };
  const footR: Vec2 = { x: an.hipR.x + c.footR.x, y: an.hipR.y + c.footR.y };

  const elbowL = solveJoint(an.shoulderL, handL, PART_DIMS.upperArmL.len, PART_DIMS.lowerArmL.len, -1);
  const elbowR = solveJoint(an.shoulderR, handR, PART_DIMS.upperArmR.len, PART_DIMS.lowerArmR.len, 1);
  const kneeL = solveJoint(an.hipL, footL, PART_DIMS.upperLegL.len, PART_DIMS.lowerLegL.len, 1);
  const kneeR = solveJoint(an.hipR, footR, PART_DIMS.upperLegR.len, PART_DIMS.lowerLegR.len, -1);

  return {
    head: { x: head.x, y: head.y, angle: 0 },
    torso: { x: c.torsoX, y: TORSO_CY, angle: Math.PI / 2 },
    upperArmL: segTransform(an.shoulderL, elbowL),
    lowerArmL: segTransform(elbowL, handL),
    upperArmR: segTransform(an.shoulderR, elbowR),
    lowerArmR: segTransform(elbowR, handR),
    upperLegL: segTransform(an.hipL, kneeL),
    lowerLegL: segTransform(kneeL, footL),
    upperLegR: segTransform(an.hipR, kneeR),
    lowerLegR: segTransform(kneeR, footR),
  };
}

export function defaultPose(): Pose {
  return buildPose(defaultControls());
}

// ---------- Geometry queries ----------

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  r: number;
}

/** Endpoints of a part's capsule (or a zero-length segment for the head). */
export function partSegment(part: PartName, t: PartTransform): Segment {
  const { len, r } = PART_DIMS[part];
  const hx = (Math.cos(t.angle) * len) / 2;
  const hy = (Math.sin(t.angle) * len) / 2;
  return { x1: t.x - hx, y1: t.y - hy, x2: t.x + hx, y2: t.y + hy, r };
}

function distToSegment(px: number, py: number, s: Segment): number {
  const vx = s.x2 - s.x1;
  const vy = s.y2 - s.y1;
  const wx = px - s.x1;
  const wy = py - s.y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - s.x1, py - s.y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - s.x2, py - s.y2);
  const t = c1 / c2;
  return Math.hypot(px - (s.x1 + t * vx), py - (s.y1 + t * vy));
}

// Extremities first: an arm held in front of the head absorbs the bullet
// (chip damage) instead of a headshot — that's the hider's shielding play.
// Head before torso: a bullet in the head circle is always a headshot (the
// chin/neck region must not read as a body hit).
const HIT_PRIORITY: PartName[] = [
  'lowerArmL',
  'lowerArmR',
  'upperArmL',
  'upperArmR',
  'lowerLegL',
  'lowerLegR',
  'upperLegL',
  'upperLegR',
  'head',
  'torso',
];

/** Which body part (if any) a bullet at (x, y) hits. */
export function hitTest(pose: Pose, x: number, y: number): PartName | null {
  for (const part of HIT_PRIORITY) {
    const seg = partSegment(part, pose[part]);
    if (distToSegment(x, y, seg) <= seg.r) return part;
  }
  return null;
}

/** Which parts are currently visible through at least one hole. */
export function exposedParts(pose: Pose, holes: { x: number; y: number }[]): Set<PartName> {
  const out = new Set<PartName>();
  for (const part of Object.keys(pose) as PartName[]) {
    const seg = partSegment(part, pose[part]);
    for (const h of holes) {
      if (distToSegment(h.x, h.y, seg) <= seg.r + HOLE_R) {
        out.add(part);
        break;
      }
    }
  }
  return out;
}
