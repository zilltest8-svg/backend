import { useRef } from "react";
import * as THREE from "three";
import { ClockIcon } from "./Icons";
import { approach, useScene } from "../three/useScene";

export type RingTone = "idle" | "working" | "break" | "done";

const COLOR: Record<RingTone, number> = {
  idle: 0x6b6b76,
  working: 0xf2f2f4,
  break: 0xf5a524,
  done: 0x34d399,
};

interface Props {
  /** 0..1 around the ring. */
  value: number;
  tone: RingTone;
  /** True while the day is still running — drives the pulse and the travelling head. */
  live: boolean;
  size?: number;
}

/**
 * The arc is one full torus with the fragments beyond the progress angle
 * discarded, so filling it costs a uniform rather than a new geometry every
 * frame. Angle runs clockwise from twelve o'clock, matching a clock face.
 */
const ARC_VERT = /* glsl */ `
  varying float vAngle;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // A torus surface point is ((R + r cos v) cos u, (R + r cos v) sin u, r sin v),
    // so the angle of position.xy is exactly the ring angle whatever the tube is
    // doing — which makes the cut edge come out straight through the tube.
    float a = atan(position.x, position.y);      // 0 at top, growing clockwise
    vAngle = (a < 0.0 ? a + 6.2831853 : a) / 6.2831853;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const ARC_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uProgress;
  uniform float uGlow;
  varying float vAngle;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    if (vAngle > uProgress) discard;
    // Rim light: the tube reads as a solid object instead of a flat band.
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.6);
    float lead = smoothstep(uProgress - 0.06, uProgress, vAngle); // brighter at the head
    vec3 col = uColor * (0.55 + 0.75 * rim) + uColor * lead * uGlow;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function TimerRing3D({ value, tone, live, size = 132 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  // The loop reads these every frame; React never re-renders because of them.
  const state = useRef({ value, tone, live });
  state.current = { value, tone, live };

  const { ok } = useScene(host, {
    distance: 3.4,
    fov: 42,
    setup: ({ scene }) => {
      const group = new THREE.Group();
      scene.add(group);

      const R = 1;
      const tube = 0.115;

      const track = new THREE.Mesh(
        new THREE.TorusGeometry(R, tube, 18, 180),
        new THREE.MeshBasicMaterial({ color: 0x26262b }),
      );
      group.add(track);

      const arcMaterial = new THREE.ShaderMaterial({
        vertexShader: ARC_VERT,
        fragmentShader: ARC_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(COLOR[state.current.tone]) },
          uProgress: { value: 0 },
          uGlow: { value: 0.6 },
        },
        side: THREE.DoubleSide,
      });
      const arc = new THREE.Mesh(new THREE.TorusGeometry(R, tube * 1.06, 20, 260), arcMaterial);
      arc.position.z = 0.001;
      group.add(arc);

      // The head rides the end of the arc, so progress is readable at a glance.
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(tube * 1.5, 20, 20),
        new THREE.MeshBasicMaterial({ color: COLOR[state.current.tone] }),
      );
      group.add(head);

      // A slow inner halo, brighter while the clock is running.
      const halo = new THREE.Mesh(
        new THREE.CircleGeometry(R - tube * 2.1, 48),
        new THREE.MeshBasicMaterial({ color: COLOR[state.current.tone], transparent: true, opacity: 0.05 }),
      );
      halo.position.z = -0.05;
      group.add(halo);

      const headMaterial = head.material as THREE.MeshBasicMaterial;
      const haloMaterial = halo.material as THREE.MeshBasicMaterial;
      const colour = new THREE.Color(COLOR[state.current.tone]);
      let shown = 0;

      return (elapsed, delta) => {
        const { value: target, tone: t, live: running } = state.current;

        shown = approach(shown, Math.min(1, Math.max(0, target)), delta, 3.5);
        arcMaterial.uniforms.uProgress!.value = shown;

        colour.lerp(new THREE.Color(COLOR[t]), 1 - Math.exp(-4 * delta));
        arcMaterial.uniforms.uColor!.value = colour;
        headMaterial.color = colour;
        haloMaterial.color = colour;

        const pulse = running ? 0.5 + 0.5 * Math.sin(elapsed * 2.2) : 0;
        arcMaterial.uniforms.uGlow!.value = 0.45 + pulse * 0.9;
        haloMaterial.opacity = 0.04 + pulse * 0.05;

        // The head sits at the arc angle, hidden while the day has not started.
        const a = shown * Math.PI * 2;
        head.position.set(Math.sin(a) * R, Math.cos(a) * R, 0.02);
        head.visible = shown > 0.004;
        head.scale.setScalar(running ? 1 + pulse * 0.25 : 1);

        // A lazy tilt gives the ring depth without ever facing away from the reader.
        group.rotation.x = Math.sin(elapsed * 0.35) * 0.18;
        group.rotation.y = Math.cos(elapsed * 0.28) * 0.22;
      };
    },
  });

  return (
    <div className="ring3d" style={{ width: size, height: size }}>
      {/* Without WebGL the same element becomes a plain conic ring, so the
          value is still readable rather than the card showing a hole. */}
      <div
        ref={host}
        className={`ring3d-canvas${ok ? "" : " off"}`}
        style={ok ? undefined : ({ "--pct": `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` } as React.CSSProperties)}
        aria-hidden
      />
      <span className="ring3d-core">
        <ClockIcon width={20} height={20} />
      </span>
    </div>
  );
}
