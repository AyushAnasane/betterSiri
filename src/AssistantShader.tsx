
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

type AssistantShaderProps = {
  audioLevelRef: React.MutableRefObject<{ value: number }>;
};

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform float uAudio;

  varying vec2 vUv;

  float hash(float n) {
    return fract(sin(n) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    float x = (uv.x - 0.5) * 2.0;
    float y = (uv.y - 0.5) * 2.0;

    float audio = smoothstep(0.015, 0.45, uAudio);
    float energy = 0.12 + audio * 0.9;

    float envelope = exp(-x * x * 3.2);
    float glow = 0.0;
    float filaments = 0.0;

    for (int i = 0; i < 150; i++) {
      float fi = float(i);
      float id = fi / 150.0;
      float seed = hash(fi + 1.0);

      float spread = (id - 0.5) * 0.95;

      float phase =
        uTime * (0.35 + seed * 0.45) +
        seed * 6.2831;

      float movement =
        sin(x * (5.0 + seed * 5.0) + phase) * 0.035 +
        sin(x * 12.0 - uTime * 0.7 + seed * 8.0) * 0.012;

      float amplitude = energy * envelope;

      float curve =
        spread * envelope * (0.45 + seed * 0.35) +
        movement * envelope * (0.5 + audio) +
        sin(x * 3.0 + phase) * amplitude * 0.09;

      float distanceToLine = abs(y - curve);

      float thickness =
        mix(0.0015, 0.00045, audio) +
        seed * mix(0.0005, 0.00015, audio);

      float line = exp(
        -distanceToLine * distanceToLine /
        (thickness * thickness)
      );

      float brightness = 0.25 + seed * 0.7;
      float audioBoost = 1.0 + audio * 3.0;

      filaments += line * brightness * audioBoost;

      glow += exp(
        -distanceToLine * distanceToLine * 180.0
      ) * 0.004;
    }

    float centerWave =
      sin(x * 5.0 - uTime * 0.9) * 0.035 +
      sin(x * 11.0 + uTime * 0.55) * 0.012;

    centerWave *= envelope * energy;

    float mainLine = exp(-abs(y - centerWave) * 75.0);
    float centralGlow = exp(-abs(y - centerWave) * 13.0) * envelope;

    vec3 color = vec3(0.008, 0.018, 0.045);

    color += vec3(0.08, 0.25, 0.65) * filaments * 0.28;
    color += vec3(0.18, 0.48, 0.95) * glow;
    color += vec3(0.28, 0.58, 1.0) * centralGlow * 0.18;
    color += vec3(0.65, 0.82, 1.0) * mainLine * 0.55;

    float fade = smoothstep(1.0, 0.15, abs(x));
    color *= fade;

    float alpha = clamp(
      filaments * 0.16 +
      centralGlow * 0.25 +
      mainLine * 0.5,
      0.0,
      0.95
    );

    gl_FragColor = vec4(color, alpha);
  }
`;

export default function AssistantShader({
  audioLevelRef,
}: AssistantShaderProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAudio: { value: 0 },
    }),
    []
  );

  useFrame((_, delta) => {
    if (!materialRef.current) return;

    const material = materialRef.current;

    material.uniforms.uTime.value += Math.min(delta, 0.05);

    const target = audioLevelRef.current.value;

    material.uniforms.uAudio.value = THREE.MathUtils.lerp(
      material.uniforms.uAudio.value,
      target,
      0.12
    );
  });

  return (
    <mesh>
      <planeGeometry args={[4.8, 2.4]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
