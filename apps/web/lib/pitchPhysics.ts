/** Pitch bounds and simple ball/player physics for the live match client. */

import { PITCH, clampPitchXZ, inGoalMouth } from "@/lib/pitch";

export { PITCH, clampPitchXZ as clampPitch, inGoalMouth };
export { CONTROLLED_IDX as CTRL_IDX } from "@/lib/pitch";

export type Vec2 = { x: number; z: number };

export const PLAYER_RADIUS = 0.45;
export const PLAYER_SEP = 0.95;
export const POSSESS_RADIUS = 1.15;
export const FIRST_TOUCH_SPEED = 6.5;
export const SPRINT_MAX = 11.5;
export const WALK_MAX = 8.5;
export const PLAYER_ACCEL = 18;
export const STAMINA_DRAIN = 0.28;
export const STAMINA_REGEN = 0.18;

export function dist2(ax: number, az: number, bx: number, bz: number) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function moveToward(
  x: number,
  z: number,
  tx: number,
  tz: number,
  speed: number,
  dt: number
): Vec2 {
  const d = dist2(x, z, tx, tz);
  if (d < 0.05) return { x, z };
  const step = Math.min(speed * dt, d);
  return clampPitchXZ(x + ((tx - x) / d) * step, z + ((tz - z) / d) * step);
}

/**
 * Soft aim assist toward opponent goal when momentum plant is live.
 * `lob` raises loft and trims ground speed for through-balls / chips.
 */
export function kickVelocity(
  from: Vec2,
  aim: Vec2,
  power: number,
  assistTowardAwayGoal: boolean,
  lob = false
): { vx: number; vy: number; vz: number } {
  let dx = aim.x - from.x;
  let dz = aim.z - from.z;
  if (assistTowardAwayGoal) {
    dx = dx * 0.35 + (PITCH.halfX - from.x) * 0.65;
    dz = dz * 0.35 + (0 - from.z) * 0.65;
  }
  const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
  const speed = lob ? 11 + power * 10 : 14 + power * 16;
  const loft = lob ? 4.2 + power * 5.5 : 1.8 + power * 4.5;
  return {
    vx: (dx / len) * speed,
    vy: loft,
    vz: (dz / len) * speed,
  };
}

/** Contested first-touch: slow enough ball near a player → claim; else bounce. */
export function tryFirstTouch(
  playerX: number,
  playerZ: number,
  ballX: number,
  ballY: number,
  ballZ: number,
  ballSpeed: number,
  radius = POSSESS_RADIUS
): "claim" | "bounce" | "none" {
  if (ballY > 1.6) return "none";
  const d = dist2(playerX, playerZ, ballX, ballZ);
  if (d > radius) return "none";
  if (ballSpeed < FIRST_TOUCH_SPEED) return "claim";
  return "bounce";
}

/** Reflect a fast ball off a player (XZ only). */
export function bounceOffPlayer(
  ballX: number,
  ballZ: number,
  playerX: number,
  playerZ: number,
  vx: number,
  vz: number,
  restitution = 0.55
): { vx: number; vz: number; x: number; z: number } {
  let nx = ballX - playerX;
  let nz = ballZ - playerZ;
  const len = Math.max(0.001, Math.hypot(nx, nz));
  nx /= len;
  nz /= len;
  const dot = vx * nx + vz * nz;
  const rvx = (vx - 2 * dot * nx) * restitution;
  const rvz = (vz - 2 * dot * nz) * restitution;
  return {
    vx: rvx,
    vz: rvz,
    x: playerX + nx * (PLAYER_RADIUS + PITCH.ballRadius + 0.05),
    z: playerZ + nz * (PLAYER_RADIUS + PITCH.ballRadius + 0.05),
  };
}

/** Soft push so AI / players don't stack. Mutates positions in place. */
export function separatePlayers(
  positions: { x: number; z: number }[],
  minDist = PLAYER_SEP
): void {
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i];
      const b = positions[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-4 || d >= minDist) continue;
      const push = ((minDist - d) / 2) * 0.55;
      const nx = dx / d;
      const nz = dz / d;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      const ca = clampPitchXZ(a.x, a.z);
      const cb = clampPitchXZ(b.x, b.z);
      a.x = ca.x;
      a.z = ca.z;
      b.x = cb.x;
      b.z = cb.z;
    }
  }
}

/** Soft bounce off goal posts (metric posts at goal mouth corners). */
export function bounceOffPosts(
  x: number,
  z: number,
  y: number,
  vx: number,
  vz: number
): { x: number; z: number; vx: number; vz: number } | null {
  if (y > PITCH.goalHeight + 0.3) return null;
  const postR = PITCH.postRadius + PITCH.ballRadius + 0.08;
  const posts: [number, number][] = [
    [PITCH.halfX, PITCH.goalHalfZ],
    [PITCH.halfX, -PITCH.goalHalfZ],
    [-PITCH.halfX, PITCH.goalHalfZ],
    [-PITCH.halfX, -PITCH.goalHalfZ],
  ];
  for (const [px, pz] of posts) {
    const dx = x - px;
    const dz = z - pz;
    const d = Math.hypot(dx, dz);
    if (d >= postR || d < 1e-5) continue;
    const nx = dx / d;
    const nz = dz / d;
    const dot = vx * nx + vz * nz;
    return {
      x: px + nx * postR,
      z: pz + nz * postR,
      vx: (vx - 2 * dot * nx) * 0.65,
      vz: (vz - 2 * dot * nz) * 0.65,
    };
  }
  return null;
}
