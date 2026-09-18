/** Canvas-generated kit albedo maps with collar, sleeves and back number. */

import * as THREE from "three";

export type KitRole = "home" | "away" | "gk";

const KIT_COLORS: Record<KitRole, { body: string; sleeve: string; shorts: string; accent: string }> = {
  home: { body: "#c9a24a", sleeve: "#b8923a", shorts: "#1a1e24", accent: "#f4e4b0" },
  away: { body: "#d8e8f4", sleeve: "#b8d0e4", shorts: "#1a3048", accent: "#3a6a9a" },
  gk: { body: "#2a8a4a", sleeve: "#1e6a38", shorts: "#1a1e24", accent: "#f0f4f0" },
};

export function createKitTexture(role: KitRole, number: number, size = 512): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const c = KIT_COLORS[role];

  ctx.fillStyle = c.body;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = c.sleeve;
  ctx.fillRect(0, 0, size * 0.22, size);
  ctx.fillRect(size * 0.78, 0, size * 0.22, size);

  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.moveTo(size * 0.35, 0);
  ctx.lineTo(size * 0.5, size * 0.08);
  ctx.lineTo(size * 0.65, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = c.shorts;
  ctx.fillRect(0, size * 0.72, size, size * 0.28);

  ctx.fillStyle = c.accent;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(size * 0.22, size * 0.18, size * 0.56, size * 0.04);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#f8faf8";
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = size * 0.012;
  ctx.font = `bold ${Math.floor(size * 0.42)}px "Barlow Condensed", Impact, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const num = String(number);
  ctx.strokeText(num, size * 0.5, size * 0.48);
  ctx.fillText(num, size * 0.5, size * 0.48);

  return canvas;
}

export function kitHex(role: KitRole): string {
  return KIT_COLORS[role].body;
}

const textureCache = new Map<string, THREE.CanvasTexture>();

export function getKitMap(role: KitRole, number: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const key = `${role}-${number}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = createKitTexture(role, number);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  textureCache.set(key, tex);
  return tex;
}
