/** FIFA-regulation pitch — 1 Three.js unit = 1 metre. Single source of truth. */

export const PITCH = {
  length: 105,
  width: 68,
  halfX: 52.5,
  halfZ: 34,
  goalWidth: 7.32,
  goalHeight: 2.44,
  goalHalfZ: 3.66,
  postRadius: 0.06,
  penaltyDepth: 16.5,
  penaltyHalfZ: 20.16,
  goalAreaDepth: 5.5,
  goalAreaHalfZ: 9.16,
  penaltySpot: 11,
  arcRadius: 9.15,
  centreCircle: 9.15,
  cornerArc: 1,
  ballRadius: 0.11,
  playerHeight: 1.8,
  /** Legacy toy pitch was 42×28; multiply stored coords by this to recover metres. */
  legacyScale: 105 / 42,
} as const;

export type PitchConsts = typeof PITCH;

/** Clamp xz onto the playable pitch (touchlines inset by margin). Leaves y alone. */
export function clampPitchXZ(x: number, z: number, margin = 0.8): { x: number; z: number } {
  return {
    x: Math.max(-PITCH.halfX + margin, Math.min(PITCH.halfX - margin, x)),
    z: Math.max(-PITCH.halfZ + margin, Math.min(PITCH.halfZ - margin, z)),
  };
}

export function inGoalMouth(x: number, y: number, z: number): "home" | "away" | null {
  if (y > PITCH.goalHeight) return null;
  if (Math.abs(z) > PITCH.goalHalfZ) return null;
  if (x >= PITCH.halfX - 0.5) return "home";
  if (x <= -PITCH.halfX + 0.5) return "away";
  return null;
}

/**
 * 4-4-2 spots for the home side attacking +X.
 * Indices: 0 GK, 1–4 DEF, 5–8 MID, 9–10 STK. Controlled striker = 9.
 */
export const HOME_SPOTS: [number, number, number][] = [
  [-48, 0, 0], // GK
  [-34, 0, -18], // LB
  [-36, 0, -6], // LCB
  [-36, 0, 6], // RCB
  [-34, 0, 18], // RB
  [-12, 0, -20], // LM
  [-14, 0, -7], // LCM
  [-14, 0, 7], // RCM
  [-12, 0, 20], // RM
  [8, 0, -8], // LST (controlled)
  [8, 0, 8], // RST
];

export const AWAY_SPOTS: [number, number, number][] = HOME_SPOTS.map(([x, y, z]) => [-x, y, -z]);

export const CONTROLLED_IDX = 9;

/** Squad numbers shown on kits / HUD (index → jersey). */
export const HOME_NUMBERS = [1, 3, 4, 5, 2, 11, 8, 6, 7, 9, 10];
export const AWAY_NUMBERS = [1, 2, 5, 4, 3, 7, 6, 8, 11, 9, 10];
