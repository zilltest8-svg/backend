import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useScene } from "../three/useScene";

interface Props {
  /** Tints the drift: green while working, amber on a break. */
  tone: "idle" | "working" | "break" | "done";
}

const TONE: Record<Props["tone"], number> = {
  idle: 0x7dd3fc,
  working: 0x34d399,
  break: 0xf5a524,
  done: 0x34d399,
};

const COUNT = 900;

/**
 * The room the app sits in: a slow drift of points with two soft lights behind
 * them, tinted by what the day is doing. Deliberately dim — it is behind text,
 * so it may never compete with it.
 */
export function Backdrop3D({ tone }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ tone, pointer: { x: 0, y: 0 } });
  state.current.tone = tone;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      state.current.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      state.current.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useScene(host, {
    distance: 6,
    fov: 60,
    setup: ({ scene }) => {
      const drift = new THREE.Group();
      scene.add(drift);

      // Points on a shell rather than a cube: no visible edges as it turns.
      const positions = new Float32Array(COUNT * 3);
      const scales = new Float32Array(COUNT);
      for (let i = 0; i < COUNT; i += 1) {
        const r = 4 + Math.random() * 5;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.6;
        positions[i * 3 + 2] = r * Math.cos(phi);
        scales[i] = 0.5 + Math.random();
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));

      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: { value: new THREE.Color(TONE[tone]) },
          uTime: { value: 0 },
          uSize: { value: Math.min(window.devicePixelRatio, 2) * 26 },
        },
        vertexShader: /* glsl */ `
          attribute float aScale;
          uniform float uTime;
          uniform float uSize;
          varying float vFade;
          void main() {
            vec3 p = position;
            p.y += sin(uTime * 0.25 + p.x * 0.35) * 0.35;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = uSize * aScale / -mv.z;
            vFade = clamp(1.0 - (-mv.z - 2.0) / 12.0, 0.0, 1.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying float vFade;
          void main() {
            // Round, soft-edged points; the square sprite corners never show.
            float d = length(gl_PointCoord - 0.5);
            if (d > 0.5) discard;
            float a = smoothstep(0.5, 0.05, d) * vFade * 0.5;
            gl_FragColor = vec4(uColor, a);
          }
        `,
      });

      drift.add(new THREE.Points(geometry, material));

      // Two wide, very dim spheres standing in for the old CSS blobs.
      const glow = (color: number, x: number, y: number, z: number, r: number) => {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(r, 24, 24),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        mesh.position.set(x, y, z);
        drift.add(mesh);
        return mesh;
      };
      const blobA = glow(0x1d4ed8, -4, 2.4, -4, 3.2);
      const blobB = glow(0x0f766e, 4.4, -2, -5, 3.6);

      const colour = new THREE.Color(TONE[tone]);
      let px = 0;
      let py = 0;

      return (elapsed, delta) => {
        material.uniforms.uTime!.value = elapsed;
        colour.lerp(new THREE.Color(TONE[state.current.tone]), 1 - Math.exp(-2 * delta));
        material.uniforms.uColor!.value = colour;

        drift.rotation.y = elapsed * 0.02;
        drift.rotation.x = Math.sin(elapsed * 0.08) * 0.06;

        // Parallax, eased hard so a flick of the mouse does not throw the scene.
        px += (state.current.pointer.x * 0.35 - px) * (1 - Math.exp(-1.6 * delta));
        py += (state.current.pointer.y * 0.22 - py) * (1 - Math.exp(-1.6 * delta));
        drift.position.x = -px;
        drift.position.y = py;

        blobA.position.y = 2.4 + Math.sin(elapsed * 0.18) * 0.6;
        blobB.position.y = -2 + Math.cos(elapsed * 0.15) * 0.7;
      };
    },
  });

  return <div ref={host} className="backdrop3d" aria-hidden />;
}
