#!/usr/bin/env bash
# Fetch CC0 textures / HDRI used by the Snowpitch night stadium.
# Sources: Poly Haven (HDRI), ambientCG (grass + snow PBR).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC="$ROOT/apps/web/public"
HDRI_DIR="$PUBLIC/hdri"
TEX_DIR="$PUBLIC/textures"
TMP="$ROOT/.asset-cache"

mkdir -p "$HDRI_DIR" "$TEX_DIR/grass" "$TEX_DIR/snow" "$TMP"

echo "==> Night HDRI (Poly Haven dikhololo_night, CC0)"
HDRI_URL="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/dikhololo_night_1k.hdr"
if [[ ! -f "$HDRI_DIR/night.hdr" ]]; then
  curl -fsSL -o "$HDRI_DIR/night.hdr" "$HDRI_URL"
else
  echo "    already present"
fi

echo "==> Grass PBR (ambientCG Grass004 1K, CC0)"
GRASS_ZIP="$TMP/Grass004_1K-JPG.zip"
if [[ ! -f "$TEX_DIR/grass/color.jpg" ]]; then
  curl -fsSL -o "$GRASS_ZIP" "https://ambientcg.com/get?file=Grass004_1K-JPG.zip"
  unzip -qo "$GRASS_ZIP" -d "$TMP/grass"
  # ambientCG naming: Grass004_1K-JPG_Color.jpg etc.
  cp "$TMP"/grass/*Color*.jpg "$TEX_DIR/grass/color.jpg" 2>/dev/null \
    || cp "$TMP"/grass/*color*.jpg "$TEX_DIR/grass/color.jpg"
  cp "$TMP"/grass/*NormalGL*.jpg "$TEX_DIR/grass/normal.jpg" 2>/dev/null \
    || cp "$TMP"/grass/*NormalDX*.jpg "$TEX_DIR/grass/normal.jpg" 2>/dev/null \
    || cp "$TMP"/grass/*normal*.jpg "$TEX_DIR/grass/normal.jpg"
  cp "$TMP"/grass/*Roughness*.jpg "$TEX_DIR/grass/roughness.jpg" 2>/dev/null \
    || cp "$TMP"/grass/*roughness*.jpg "$TEX_DIR/grass/roughness.jpg"
else
  echo "    already present"
fi

echo "==> Snow PBR (ambientCG Snow005 1K, CC0)"
SNOW_ZIP="$TMP/Snow005_1K-JPG.zip"
if [[ ! -f "$TEX_DIR/snow/color.jpg" ]]; then
  curl -fsSL -o "$SNOW_ZIP" "https://ambientcg.com/get?file=Snow005_1K-JPG.zip" \
    || curl -fsSL -o "$SNOW_ZIP" "https://ambientcg.com/get?file=Snow001_1K-JPG.zip"
  unzip -qo "$SNOW_ZIP" -d "$TMP/snow"
  cp "$TMP"/snow/*Color*.jpg "$TEX_DIR/snow/color.jpg" 2>/dev/null \
    || cp "$TMP"/snow/*color*.jpg "$TEX_DIR/snow/color.jpg"
  cp "$TMP"/snow/*NormalGL*.jpg "$TEX_DIR/snow/normal.jpg" 2>/dev/null \
    || cp "$TMP"/snow/*NormalDX*.jpg "$TEX_DIR/snow/normal.jpg" 2>/dev/null \
    || true
  cp "$TMP"/snow/*Roughness*.jpg "$TEX_DIR/snow/roughness.jpg" 2>/dev/null \
    || true
else
  echo "    already present"
fi

echo "==> Football GLB"
MODELS_DIR="$PUBLIC/models"
mkdir -p "$MODELS_DIR"
if [[ -f "$MODELS_DIR/ball.glb" ]]; then
  echo "    already present"
else
  echo "    generating procedural ball.glb"
  (cd "$ROOT/apps/web" && node "$ROOT/scripts/generate_ball_glb.js") || \
    echo "    warn: could not generate ball.glb — PrimitiveBall fallback will be used"
fi

echo "==> Stadium / goal GLB (optional drop-in)"
for name in stadium.glb goal.glb; do
  if [[ -f "$MODELS_DIR/$name" ]]; then
    echo "    $name present"
  else
    echo "    no $name — procedural Stadium.tsx geometry will be used"
  fi
done

echo "==> Player GLB"
if [[ -f "$MODELS_DIR/player.glb" ]]; then
  echo "    player.glb already present (Mixamo merge)"
else
  echo "    missing — run: make player-glb  (or drop a CC0 rigged .glb at apps/web/public/models/player.glb)"
fi

echo "==> Done. Assets under apps/web/public/{hdri,textures,models}"
ls -lh "$HDRI_DIR" "$TEX_DIR/grass" "$TEX_DIR/snow" "$MODELS_DIR" 2>/dev/null || true
