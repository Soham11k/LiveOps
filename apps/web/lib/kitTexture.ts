/** Canvas-generated kit albedo maps with fabric weave, crest, socks, back number. */

import * as THREE from "three";

export type KitRole = "home" | "away" | "gk";

const KIT_COLORS: Record<
  KitRole,
  { body: string; sleeve: string; shorts: string; socks: string; accent: string; skin: string }
> = {
  home: {
    body: "#c9a24a",
    sleeve: "#b8923a",
    shorts: "#1a1e24",
    socks: "#c9a24a",
    accent: "#f4e4b0",
    skin: "#c4a882",
  },
  away: {
    body: "#5a9fd4",
    sleeve: "#3a7fb4",
    shorts: "#1a3048",
    socks: "#1a3048",
    accent: "#d8e8f4",
    skin: "#c4a882",
  },
  gk: {
    body: "#2a8a4a",
    sleeve: "#1e6a38",
    shorts: "#1a1e24",
    socks: "#2a8a4a",
    accent: "#f0f4f0",
    skin: "#c4a882",
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function createKitTexture(role: KitRole, number: number, size = 512): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const c = KIT_COLORS[role];
  const [br, bg, bb] = hexToRgb(c.body);

  // Fabric base with subtle weave noise
  ctx.fillStyle = c.body;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const weave = ((x * 3 + y * 5) % 7) / 7;
      const n = (Math.sin(x * 0.35) * Math.cos(y * 0.28) + 1) * 0.5;
      const d = (weave * 0.06 + n * 0.08 - 0.05) * 255;
      data[i] = Math.min(255, Math.max(0, br + d));
      data[i + 1] = Math.min(255, Math.max(0, bg + d * 0.9));
      data[i + 2] = Math.min(255, Math.max(0, bb + d * 0.85));
    }
  }
  ctx.putImageData(img, 0, 0);

  // Sleeves
  ctx.fillStyle = c.sleeve;
  ctx.fillRect(0, 0, size * 0.2, size * 0.7);
  ctx.fillRect(size * 0.8, 0, size * 0.2, size * 0.7);

  // Collar
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.moveTo(size * 0.35, 0);
  ctx.lineTo(size * 0.5, size * 0.07);
  ctx.lineTo(size * 0.65, 0);
  ctx.closePath();
  ctx.fill();

  // Chest stripe
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = c.accent;
  ctx.fillRect(size * 0.22, size * 0.16, size * 0.56, size * 0.035);
  ctx.globalAlpha = 1;

  // Crest stub (left chest)
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.ellipse(size * 0.32, size * 0.28, size * 0.045, size * 0.055, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.font = `bold ${Math.floor(size * 0.04)}px "Barlow Condensed", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("SP", size * 0.32, size * 0.28);

  // Shorts band
  ctx.fillStyle = c.shorts;
  ctx.fillRect(0, size * 0.68, size, size * 0.18);

  // Socks
  ctx.fillStyle = c.socks;
  ctx.fillRect(0, size * 0.86, size, size * 0.14);
  ctx.fillStyle = c.accent;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, size * 0.86, size, size * 0.02);
  ctx.globalAlpha = 1;

  // Back number
  ctx.fillStyle = "#f8faf8";
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = size * 0.014;
  ctx.font = `bold ${Math.floor(size * 0.4)}px "Barlow Condensed", Impact, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const num = String(number);
  ctx.strokeText(num, size * 0.5, size * 0.46);
  ctx.fillText(num, size * 0.5, size * 0.46);

  return canvas;
}

/** Small canvas with just the jersey number for jointed LOD backs. */
export function createNumberTexture(number: number, size = 128): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#f8faf8";
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 6;
  ctx.font = `bold ${Math.floor(size * 0.72)}px "Barlow Condensed", Impact, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const num = String(number);
  ctx.strokeText(num, size / 2, size / 2);
  ctx.fillText(num, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function kitHex(role: KitRole): string {
  return KIT_COLORS[role].body;
}

export function kitSkinHex(role: KitRole): string {
  return KIT_COLORS[role].skin;
}

const textureCache = new Map<string, THREE.CanvasTexture>();
const numberCache = new Map<number, THREE.CanvasTexture>();

export function getKitMap(role: KitRole, number: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const key = `${role}-${number}-v2`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = createKitTexture(role, number);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  textureCache.set(key, tex);
  return tex;
}

export function getNumberMap(number: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const cached = numberCache.get(number);
  if (cached) return cached;
  const tex = createNumberTexture(number);
  if (!tex) return null;
  numberCache.set(number, tex);
  return tex;
}
