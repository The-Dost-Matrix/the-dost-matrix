"use client";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

import { HolographicBrainSceneV2 } from "@/components/brain/scenes/holographic-brain-scene-v2";

export function MatrixBrainWebGL() {
  return (
    <div
      className="matrix-brain-webgl"
      style={{
        width: "100%",
        height: "220px",
        background:
          "radial-gradient(circle at center, rgba(92, 42, 180, 0.18), transparent 68%)",
      }}
    >
      <Canvas
        camera={{
          position: [0, 0.1, 3.7],
          fov: 38,
        }}
        dpr={[1, 1.5]}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        }}
        style={{
          background: "transparent",
        }}
      >
        <ambientLight intensity={0.45} />

        <pointLight
          position={[3, 2, 3]}
          intensity={14}
          color="#55dcff"
        />

        <pointLight
          position={[-3, -2, 2]}
          intensity={12}
          color="#9a5cff"
        />

        <pointLight
          position={[0, 1, -2]}
          intensity={8}
          color="#d05cff"
        />

<HolographicBrainSceneV2 />
<EffectComposer>
  <Bloom
    intensity={1.6}
    luminanceThreshold={0.15}
    luminanceSmoothing={0.9}
    mipmapBlur
  />
</EffectComposer>
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          enableDamping
          dampingFactor={0.06}
          autoRotate
          autoRotateSpeed={0.3}
        />
      </Canvas>
    </div>
  );
}