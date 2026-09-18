"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
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

/** PBR turf with mow stripes, wear noise, and light late-match snow. */
export function Pitch({ snowAmount = 0 }: { snowAmount?: number }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const snowUniform = useMemo(() => ({ value: 0 }), []);
  const colorMap = useTextureOptional("/textures/grass/color.jpg");
  const normalMap = useLinearTextureOptional("/textures/grass/normal.jpg");
  const roughMap = useLinearTextureOptional("/textures/grass/roughness.jpg");

  const markings = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = createPitchMarkingsTexture(2048);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, []);

  useEffect(() => {
    // ~3 m per blade tile on a 105×68 pitch
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
  }, [colorMap, normalMap, roughMap]);

  useFrame(() => {
    snowUniform.value = snowAmount;
  });

  const onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uSnow = snowUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uSnow;
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
         // Three r152+ map UVs are vMapUv (vUv is undeclared → black turf)
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
         vec3 snowCol = vec3(0.86, 0.90, 0.94);
         float snowMask = smoothstep(0.25, 0.9, uSnow) * (0.4 + 0.4 * wear);
         diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, clamp(snowMask, 0.0, 0.55));`
      );
  };

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
        <planeGeometry args={[PITCH.length, PITCH.width]} />
        <meshStandardMaterial
          ref={matRef}
          color={colorMap ? "#6a9a72" : "#3a7a4a"}
          map={colorMap || undefined}
          normalMap={normalMap || undefined}
          roughnessMap={roughMap || undefined}
          roughness={0.85}
          metalness={0.02}
          onBeforeCompile={onBeforeCompile}
        />
      </mesh>
      {markings && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
          <planeGeometry args={[PITCH.length, PITCH.width]} />
          <meshBasicMaterial map={markings} transparent depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
