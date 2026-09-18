"use client";

import {
  Bloom,
  BrightnessContrast,
  ChromaticAberration,
  EffectComposer,
  HueSaturation,
  N8AO,
  Noise,
  SMAA,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import type { ReactElement } from "react";
import type { QualitySettings } from "@/lib/quality";

type MatchPostProps = {
  quality: QualitySettings;
  vignette?: number;
  riggedPulse?: boolean;
  children?: ReactElement | null;
  slim?: boolean;
};

/**
 * Tier-gated broadcast post stack.
 * low: SMAA + ACES
 * medium: + N8AO + Bloom + grade
 * high: + grain + chromatic aberration (+ optional DoF children)
 */
export function MatchPost({
  quality,
  vignette = 0.18,
  riggedPulse = false,
  children = null,
  slim = false,
}: MatchPostProps) {
  const tier = quality.tier;
  const midOrHigh = tier === "medium" || tier === "high";
  const high = tier === "high" && !slim;

  return (
    <EffectComposer enableNormalPass={midOrHigh}>
      {midOrHigh ? (
        <N8AO
          aoRadius={quality.aoRadius}
          aoSamples={quality.aoSamples}
          intensity={1.05}
          distanceFalloff={1.15}
        />
      ) : (
        <></>
      )}
      {midOrHigh ? <Bloom intensity={0.32} luminanceThreshold={0.78} mipmapBlur /> : <></>}
      {high && children ? children : <></>}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {midOrHigh ? <HueSaturation saturation={0.04} hue={-0.015} /> : <></>}
      {midOrHigh ? <BrightnessContrast brightness={-0.02} contrast={0.1} /> : <></>}
      <Vignette
        offset={0.3}
        darkness={Math.min(vignette, 0.55)}
        blendFunction={riggedPulse ? BlendFunction.COLOR_BURN : BlendFunction.NORMAL}
      />
      {high ? <Noise opacity={0.035} blendFunction={BlendFunction.OVERLAY} /> : <></>}
      {high ? (
        <ChromaticAberration
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({ offset: [0.00035, 0.00035] } as any)}
        />
      ) : (
        <></>
      )}
      <SMAA />
    </EffectComposer>
  );
}
