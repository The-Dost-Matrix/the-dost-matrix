"use client";

import { Float, Sparkles } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const PARTICLE_COUNT = 5200;
const CONNECTION_DISTANCE = 0.065;
const MAX_CONNECTIONS = 1100;

type BrainData = {
  positions: Float32Array;
  colors: Float32Array;
  connectionPositions: Float32Array;
};

function gyri(
  x: number,
  y: number,
  z: number,
) {
  return (
    Math.sin(x * 14.5) * 0.04 +
    Math.sin(y * 18.0) * 0.025 +
    Math.sin(z * 15.0) * 0.035 +
    Math.sin((x + y) * 11.0) * 0.018 +
    Math.sin((x - z) * 10.0) * 0.02
  );
}
function createBrainPoint(): THREE.Vector3 {

    for(;;){
  
      const theta =
        Math.random()*Math.PI;
  
      const phi =
        Math.random()*Math.PI*2;
  
      const radius =
        0.88 +
        Math.random()*0.12;
  
      let x =
        Math.sin(theta)*
        Math.cos(phi);
  
      let y =
        Math.cos(theta);
  
      let z =
        Math.sin(theta)*
        Math.sin(phi);
  
        x*=0.88*radius;
        y*=0.88*radius;
        z*=0.88*radius;
  
      
  
      const folds=
        Math.sin(y*18)*0.03+
        Math.sin(z*15)*0.025+
        Math.sin((x+y)*12)*0.018+
        Math.sin((x-z)*10)*0.02;
  
      x+=x*folds;
      y+=y*folds;
      z+=z*folds;
  
  
      return new THREE.Vector3(
        x,
        y,
        z,
      );
  
    }
  
  }

function createBrainData(): BrainData {

  const positions =
    new Float32Array(
      PARTICLE_COUNT * 3,
    );

  const colors =
    new Float32Array(
      PARTICLE_COUNT * 3,
    );

  const cyan =
    new THREE.Color("#53dcff");

  const purple =
    new THREE.Color("#925cff");

  const pink =
    new THREE.Color("#d55cff");

  const points:
    THREE.Vector3[] = [];

  for (
    let i = 0;
    i < PARTICLE_COUNT;
    i++
  ) {

    const side =
      Math.random() > 0.5
        ? 1
        : -1;

        const p = createBrainPoint();
    points.push(p);

    const o = i * 3;

    positions[o] = p.x;
    positions[o + 1] = p.y;
    positions[o + 2] = p.z;

    const vertical =
      THREE.MathUtils.clamp(
        (p.y + 1) / 2,
        0,
        1,
      );

    const depth =
      THREE.MathUtils.clamp(
        (p.z + 1) / 2,
        0,
        1,
      );

    const color =
      cyan
        .clone()
        .lerp(
          purple,
          vertical,
        )
        .lerp(
          pink,
          depth * 0.35,
        );

    colors[o] = color.r;
    colors[o + 1] = color.g;
    colors[o + 2] = color.b;

  }

  const connections:number[]=[];

  let count=0;

  for(
    let a=0;
    a<points.length &&
    count<MAX_CONNECTIONS;
    a++
  ){

    for(
      let b=a+1;
      b<points.length &&
      count<MAX_CONNECTIONS;
      b++
    ){

      const p1=points[a];
      const p2=points[b];

      if(
        Math.sign(p1.x)!==
        Math.sign(p2.x)
      ){
        continue;
      }

      if(
        p1.distanceToSquared(
          p2
        )<
        CONNECTION_DISTANCE*
        CONNECTION_DISTANCE
      ){

        connections.push(
          p1.x,p1.y,p1.z,
          p2.x,p2.y,p2.z
        );

        count++;

      }

    }

  }

  return{

    positions,

    colors,

    connectionPositions:
      new Float32Array(
        connections
      )

  };

}
export function HolographicBrainSceneV2() {

    const groupRef =
      useRef<THREE.Group>(null);
  
    const pointsRef =
      useRef<THREE.Points>(null);
  
    const linesRef =
      useRef<THREE.LineSegments>(null);
  
    const glowRef =
      useRef<THREE.Group>(null);
  
    const ringsRef =
      useRef<THREE.Group>(null);
  
    const brain =
      useMemo(
        () => createBrainData(),
        [],
      );
  
    useFrame(
      (state, delta) => {
  
        const t =
          state.clock.elapsedTime;
  
        if(groupRef.current){
  
          groupRef.current.rotation.y +=
            delta * 0.085;
  
          groupRef.current.rotation.x =
            Math.sin(t*0.35)*0.035;
  
        }
  
        if(glowRef.current){
  
          const s =
            1 +
            Math.sin(t*1.6)*0.03;
  
          glowRef.current.scale.setScalar(
            s,
          );
  
        }
  
        if(pointsRef.current){
  
          const material =
            pointsRef.current.material as
            THREE.PointsMaterial;
  
          material.opacity =
            0.72 +
            Math.sin(t*1.7)*0.12;
  
        }
  
        if(linesRef.current){
  
          const material =
            linesRef.current.material as
            THREE.LineBasicMaterial;
  
          material.opacity =
            0.08 +
            Math.sin(t*1.2)*0.04;
  
        }
  
        if(ringsRef.current){
  
          ringsRef.current.rotation.z -=
            delta*0.16;
  
        }
  
      }
    );
  
    return(
  
      <group
        position={[
          0,
          0.22,
          0,
        ]}
      >
  
        <Float
          speed={1.15}
          floatIntensity={0.28}
          rotationIntensity={0.05}
        >
  
          <group
            ref={groupRef}
          >
  
            <points
              ref={pointsRef}
            >
  
              <bufferGeometry>
  
                <bufferAttribute
                  attach="attributes-position"
                  args={[
                    brain.positions,
                    3,
                  ]}
                />
  
                <bufferAttribute
                  attach="attributes-color"
                  args={[
                    brain.colors,
                    3,
                  ]}
                />
  
              </bufferGeometry>
  
              <pointsMaterial
  
                size={0.022}
  
                vertexColors
  
                transparent
  
                opacity={0.82}
  
                depthWrite={false}
  
                blending={
                  THREE.AdditiveBlending
                }
  
                sizeAttenuation
  
              />
  
            </points>
  
            <lineSegments
              ref={linesRef}
            >
  
              <bufferGeometry>
  
                <bufferAttribute
  
                  attach="attributes-position"
  
                  args={[
                    brain.connectionPositions,
                    3,
                  ]}
  
                />
  
              </bufferGeometry>
  
              <lineBasicMaterial
  
                color="#8268ff"
  
                transparent
  
                opacity={0.12}
  
                depthWrite={false}
  
                blending={
                  THREE.AdditiveBlending
                }
  
              />
  
            </lineSegments>
            <group ref={glowRef}>

<mesh
  position={[-0.56,0,0]}
  scale={[0.74,0.96,0.82]}
>

  <sphereGeometry
    args={[1,48,48]}
  />

<meshBasicMaterial
  color="#4b25d8"
  transparent
  opacity={0.012}
  blending={THREE.AdditiveBlending}
  depthWrite={false}
/>

</mesh>

<mesh
  position={[0.56,0,0]}
  scale={[0.74,0.96,0.82]}
>

  <sphereGeometry
    args={[1,48,48]}
  />

<meshBasicMaterial
  color="#1f9dff"
  transparent
  opacity={0.01}
  blending={THREE.AdditiveBlending}
  depthWrite={false}
/>

</mesh>

</group>

</group>

</Float>

<group

ref={ringsRef}

position={[
0,
-1.28,
0,
]}

rotation={[
-Math.PI/2,
0,
0,
]}

>

<mesh>

<torusGeometry
args={[
  1.02,
  0.018,
  16,
  180,
]}
/>

<meshBasicMaterial
color="#925cff"
transparent
opacity={0.72}
blending={
  THREE.AdditiveBlending
}
/>

</mesh>

<mesh
rotation={[
0,
0,
Math.PI/4,
]}
>

<torusGeometry
args={[
  0.74,
  0.01,
  16,
  140,
]}
/>

<meshBasicMaterial
color="#53dcff"
transparent
opacity={0.45}
blending={
  THREE.AdditiveBlending
}
/>

</mesh>

</group>

<Sparkles

count={70}

scale={[
3.5,
2.8,
2.5,
]}

size={1.2}

speed={0.24}

color="#8f5cff"

/>

</group>

);

}