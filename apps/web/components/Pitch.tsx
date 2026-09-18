"use client";

import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshReflectorMaterial } from "@react-three/drei";
import * as THREE from "three";
import { createPitchMarkingsTexture } from "@/lib/pitchTexture";
import { PITCH } from "@/lib/pitch";

function useTextureOptional(path: string): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(
      path,
      (t) => {
        if (cancelled) return;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        setTex(t);
      },
      undefined,
      () => {
        if (!cancelled) setTex(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [path]);
  return tex;
}

function useLinearTextureOptional(path: string): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(
      path,
      (t) => {
        if (cancelled) return;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.LinearSRGBColorSpace;
        t.anisotropy = 8;
        setTex(t);
      },
      undefined,
      () => {
        if (!cancelled) setTex(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [path]);
  return tex;
}

/** PBR turf with lit markings, wet reflector sheen, snow PBR mix, mow/wear. */
export function Pitch({ snowAmount = 0 }: { snowAmount?: number }) {
  const snowUniform = useMemo(() => ({ value: 0 }), []);
  const emptySnow = useMemo(() => {
    const data = new Uint8Array([220, 230, 240, 255]);
    const t = new THREE.DataTexture(data, 1, 1);
    t.needsUpdate = true;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const snowMapUniform = useMemo(
    () => ({ value: emptySnow as THREE.Texture }),
    [emptySnow]
  );
  const colorMap = useTextureOptional("/textures/grass/color.jpg");
  const normalMap = useLinearTextureOptional("/textures/grass/normal.jpg");
  const roughMap = useLinearTextureOptional("/textures/grass/roughness.jpg");
  const snowColor = useTextureOptional("/textures/snow/color.jpg");
  const snowNormal = useLinearTextureOptional("/textures/snow/normal.jpg");

  const markings = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = createPitchMarkingsTexture(2048);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }, []);

  useEffect(() => {
    const rx = 35;
    const ry = 23;
    if (colorMap) {
      colorMap.repeat.set(rx, ry);
      colorMap.needsUpdate = true;
    }
    if (normalMap) {
      normalMap.repeat.set(rx, ry);
      normalMap.needsUpdate = true;
    }
    if (roughMap) {
      roughMap.repeat.set(rx, ry);
      roughMap.needsUpdate = true;
    }
    if (snowColor) {
      snowColor.repeat.set(18, 12);
      snowColor.needsUpdate = true;
      snowMapUniform.value = snowColor;
    }
    if (snowNormal) {
      snowNormal.repeat.set(18, 12);
      snowNormal.needsUpdate = true;
    }
  }, [colorMap, normalMap, roughMap, snowColor, snowNormal, snowMapUniform]);

  useFrame(() => {
    snowUniform.value = snowAmount;
  });

  const onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uSnow = snowUniform;
    shader.uniforms.uSnowMap = snowMapUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uSnow;
         uniform sampler2D uSnowMap;
         float hash21(vec2 p){
           p = fract(p*vec2(123.34, 456.21));
           p += dot(p, p+45.32);
           return fract(p.x*p.y);
         }
         float noise(vec2 p){
           vec2 i = floor(p); vec2 f = fract(p);
           float a = hash21(i);
           float b = hash21(i+vec2(1.,0.));
           float c = hash21(i+vec2(0.,1.));
           float d = hash21(i+vec2(1.,1.));
           vec2 u = f*f*(3.-2.*f);
           return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;
         }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         #ifdef USE_MAP
         vec2 stripeUv = vMapUv;
         #elif defined( USE_UV )
         vec2 stripeUv = vUv;
         #else
         vec2 stripeUv = vec2(0.5);
         #endif
         float stripe = step(0.5, fract(stripeUv.x * 24.0));
         diffuseColor.rgb *= mix(0.86, 1.1, stripe);
         float wear = noise(stripeUv * 22.0);
         diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.72, wear * 0.28);
         float snowMask = smoothstep(0.25, 0.9, uSnow) * (0.4 + 0.4 * wear);
         vec3 snowCol = texture2D(uSnowMap, stripeUv * 0.55).rgb;
         snowCol = mix(vec3(0.86, 0.90, 0.94), snowCol, 0.85);
         diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, clamp(snowMask, 0.0, 0.62));`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         #ifdef USE_MAP
         vec2 wetUv = vMapUv;
         #elif defined( USE_UV )
         vec2 wetUv = vUv;
         #else
         vec2 wetUv = vec2(0.5);
         #endif
         float wet = 0.28 + 0.35 * noise(wetUv * 0.45) + 0.2 * noise(wetUv * 1.4);
         roughnessFactor = mix(roughnessFactor, 0.34, clamp(wet, 0.0, 0.65));
         roughnessFactor = mix(roughnessFactor, 0.82, clamp(uSnow * 0.55, 0.0, 0.5));`
      );
  };

  return (
    <group>
      {/* Cheap wet reflector under turf — flood sheen at night */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <planeGeometry args={[PITCH.length + 2, PITCH.width + 2]} />
        <MeshReflectorMaterial
          blur={[280, 80]}
          resolution={512}
          mixBlur={0.85}
          mixStrength={0.45}
          roughness={0.55}
          depthScale={0.6}
          minDepthThreshold={0.85}
          maxDepthThreshold={1.2}
          color="#1a2a28"
          metalness={0.35}
          mirror={0.15}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
        <planeGeometry args={[PITCH.length, PITCH.width]} />
        <meshStandardMaterial
          color={colorMap ? "#6a9a72" : "#3a7a4a"}
          map={colorMap || undefined}
          normalMap={normalMap || undefined}
          roughnessMap={roughMap || undefined}
          roughness={0.72}
          metalness={0.04}
          envMapIntensity={0.45}
          transparent
          opacity={0.94}
          onBeforeCompile={onBeforeCompile}
        />
      </mesh>
      {/* Lit markings — MeshStandard so floods/shadows hit the lines */}
      {markings && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
          <planeGeometry args={[PITCH.length, PITCH.width]} />
          <meshStandardMaterial
            map={markings}
            transparent
            alphaTest={0.08}
            depthWrite={false}
            roughness={0.55}
            metalness={0.08}
            emissive="#e8f0e4"
            emissiveIntensity={0.12}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      )}
    </group>
  );
}
