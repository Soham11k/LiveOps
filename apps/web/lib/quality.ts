export type QualityTier = "high" | "medium" | "low";

export type QualitySettings = {
  tier: QualityTier;
  particlesNear: number;
  particlesFar: number;
  crowdCount: number;
  shadowMapSize: number;
  aoSamples: number;
  aoRadius: number;
  lodNear: number;
  lodFar: number;
  dprMax: number;
};

const TIERS: Record<QualityTier, QualitySettings> = {
  high: {
    tier: "high",
    particlesNear: 2200,
    particlesFar: 1800,
    crowdCount: 2800,
    shadowMapSize: 4096,
    aoSamples: 12,
    aoRadius: 1.4,
    // Broadcast cam sits ~64–100 m away; keep Mixamo GLBs until far sideline
    lodNear: 110,
    lodFar: 160,
    dprMax: 1.75,
  },
  medium: {
    tier: "medium",
    particlesNear: 1200,
    particlesFar: 900,
    crowdCount: 1800,
    shadowMapSize: 2048,
    aoSamples: 8,
    aoRadius: 1.2,
    lodNear: 90,
    lodFar: 140,
    dprMax: 1.35,
  },
  low: {
    tier: "low",
    particlesNear: 500,
    particlesFar: 400,
    crowdCount: 900,
    shadowMapSize: 1024,
    aoSamples: 4,
    aoRadius: 1.0,
    lodNear: 70,
    lodFar: 120,
    dprMax: 1,
  },
};

export function getQuality(tier: QualityTier = "high"): QualitySettings {
  return TIERS[tier];
}

export function stepDown(tier: QualityTier): QualityTier {
  if (tier === "high") return "medium";
  if (tier === "medium") return "low";
  return "low";
}

export function stepUp(tier: QualityTier): QualityTier {
  if (tier === "low") return "medium";
  if (tier === "medium") return "high";
  return "high";
}
