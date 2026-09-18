/** Canvas-generated football pitch line markings as a transparent alpha texture. */

import { PITCH } from "@/lib/pitch";

function worldToCanvas(x: number, z: number, size: number): [number, number] {
  const u = (x / PITCH.length + 0.5) * size;
  const v = (z / PITCH.width + 0.5) * size;
  return [u, v];
}

function strokeRect(
  ctx: CanvasRenderingContext2D,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  size: number
) {
  const [ax, ay] = worldToCanvas(x0, z0, size);
  const [bx, by] = worldToCanvas(x1, z1, size);
  ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
}

function strokeCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cz: number,
  radius: number,
  size: number,
  start = 0,
  end = Math.PI * 2
) {
  const [x, y] = worldToCanvas(cx, cz, size);
  // Circles are circular in world metres — use length axis for radius mapping
  // then correct for non-square canvas mapping via ellipse if needed.
  const rx = (radius / PITCH.length) * size;
  const ry = (radius / PITCH.width) * size;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, start, end);
  ctx.stroke();
}

function fillDot(ctx: CanvasRenderingContext2D, cx: number, cz: number, size: number, r = 3) {
  const [x, y] = worldToCanvas(cx, cz, size);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function createPitchMarkingsTexture(size = 2048): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const hx = PITCH.halfX;
  const hz = PITCH.halfZ;

  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(245, 248, 242, 0.92)";
  ctx.fillStyle = "rgba(245, 248, 242, 0.92)";
  ctx.lineWidth = Math.max(2, size / 512);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Touchlines / goal lines
  strokeRect(ctx, -hx, -hz, hx, hz, size);

  // Halfway line
  {
    const [x0, y0] = worldToCanvas(0, -hz, size);
    const [, y1] = worldToCanvas(0, hz, size);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y1);
    ctx.stroke();
  }

  // Center circle + spot
  strokeCircle(ctx, 0, 0, PITCH.centreCircle, size);
  fillDot(ctx, 0, 0, size, 4);

  // Penalty boxes
  strokeRect(ctx, -hx, -PITCH.penaltyHalfZ, -hx + PITCH.penaltyDepth, PITCH.penaltyHalfZ, size);
  strokeRect(ctx, hx - PITCH.penaltyDepth, -PITCH.penaltyHalfZ, hx, PITCH.penaltyHalfZ, size);

  // Goal areas (six-yard)
  strokeRect(ctx, -hx, -PITCH.goalAreaHalfZ, -hx + PITCH.goalAreaDepth, PITCH.goalAreaHalfZ, size);
  strokeRect(ctx, hx - PITCH.goalAreaDepth, -PITCH.goalAreaHalfZ, hx, PITCH.goalAreaHalfZ, size);

  // Penalty spots
  fillDot(ctx, -hx + PITCH.penaltySpot, 0, size, 3.5);
  fillDot(ctx, hx - PITCH.penaltySpot, 0, size, 3.5);

  // Penalty arcs (outside the box)
  strokeCircle(
    ctx,
    -hx + PITCH.penaltySpot,
    0,
    PITCH.arcRadius,
    size,
    -Math.PI * 0.35,
    Math.PI * 0.35
  );
  strokeCircle(
    ctx,
    hx - PITCH.penaltySpot,
    0,
    PITCH.arcRadius,
    size,
    Math.PI * 0.65,
    Math.PI * 1.35
  );

  // Corner arcs
  const c = PITCH.cornerArc;
  strokeCircle(ctx, -hx, -hz, c, size, 0, Math.PI / 2);
  strokeCircle(ctx, -hx, hz, c, size, -Math.PI / 2, 0);
  strokeCircle(ctx, hx, -hz, c, size, Math.PI / 2, Math.PI);
  strokeCircle(ctx, hx, hz, c, size, Math.PI, Math.PI * 1.5);

  return canvas;
}
