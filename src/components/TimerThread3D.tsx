import { useRef } from "react";
import * as THREE from "three";
import type { RingTone } from "./TimerRing3D";
import { approach, useScene } from "../three/useScene";

const COLOR: Record<RingTone, number> = {
  idle: 0x6b6b76,
  working: 0x34d399,
  break: 0xf5a524,
  done: 0x34d399,
};

/** How fast the beads travel, by what the day is doing. */
const SPEED: Record<RingTone, number> = {
  idle: 0.05,
  working: 1,
  break: 0.14,
  done: 0.4,
};

interface Props {
  tone: RingTone;
  /** A stored day is dimmer and slower: nothing about it is still moving. */
  live: boolean;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * One hairline thread with three small beads travelling along it, in the empty
 * half of the card. It is deliberately almost nothing: the counter is what the
 * card is for, and this only has to suggest that time is moving.
 */
const FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAspect;
  uniform float uIntensity;
  uniform vec3 uColor;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;

    // Barely a wave — one percent of the height, so it reads as a straight line
    // that happens to breathe.
    float y = 0.5 + sin(uv.x * 3.0 + uTime * 0.25) * 0.010;
    float thread = smoothstep(0.0035, 0.0, abs(uv.y - y));

    float beads = 0.0;
    for (int i = 0; i < 3; i += 1) {
      float at = fract(uTime * 0.05 + float(i) * 0.34);
      float d = length(vec2((uv.x - at) * uAspect, uv.y - y));
      beads += smoothstep(0.013, 0.0, d) + smoothstep(0.05, 0.0, d) * 0.16;
    }

    // Nothing on the left: that half of the card belongs to the counter.
    float mask = smoothstep(0.34, 0.54, uv.x) * smoothstep(1.0, 0.9, uv.x);

    gl_FragColor = vec4(uColor, (thread * 0.7 + beads) * mask * uIntensity * 0.38);
  }
`;

export function TimerThread3D({ tone, live }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ tone, live });
  state.current = { tone, live };

  useScene(host, {
    distance: 4,
    fov: 45,
    setup: ({ scene, camera }) => {
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uAspect: { value: 1 },
          uIntensity: { value: 1 },
          uColor: { value: new THREE.Color(COLOR[state.current.tone]) },
        },
      });

      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      scene.add(plane);

      const colour = new THREE.Color(COLOR[state.current.tone]);
      let aspect = 0;
      let intensity = 1;
      let flow = 0;

      return (_elapsed, delta) => {
        const { tone: t, live: running } = state.current;

        if (camera.aspect !== aspect) {
          aspect = camera.aspect;
          const h = 2 * Math.tan(((camera.fov * Math.PI) / 180) / 2) * camera.position.z;
          plane.scale.set(h * aspect, h, 1);
          material.uniforms.uAspect!.value = aspect; // keeps the beads round
        }

        // Its own clock, so changing pace eases rather than jumps.
        flow += delta * SPEED[t] * (running ? 1 : 0.3);
        material.uniforms.uTime!.value = flow;

        intensity = approach(intensity, running ? 1 : 0.45, delta, 2.5);
        material.uniforms.uIntensity!.value = intensity;

        colour.lerp(new THREE.Color(COLOR[t]), 1 - Math.exp(-3 * delta));
        material.uniforms.uColor!.value = colour;
      };
    },
  });

  return <div ref={host} className="thread3d" aria-hidden />;
}
