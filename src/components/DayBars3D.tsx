import { useRef } from "react";
import * as THREE from "three";
import type { DayEntry } from "../history";
import { MIN, dayMonth, hm } from "../time";
import { approach, useScene } from "../three/useScene";

interface Props {
  /** Newest first, as `buildHistory` returns them. */
  days: DayEntry[];
  /** Minutes of work owed, drawn as the line across the chart. */
  target: number;
  /** How many days to show, oldest on the left. */
  limit?: number;
}

const WORK = 0x34d399;
const BREAK = 0xf5a524;

/**
 * Worked and break hours per stored day, as columns you can read at a glance.
 * The scene is built once and the bar heights are pushed in through a ref, so a
 * ticking clock never rebuilds geometry.
 */
export function DayBars3D({ days, target, limit = 14 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const shown = [...days].slice(0, limit).reverse();

  // Height in "hours", which is what the grid lines count.
  const bars = useRef<{ work: number[]; brk: number[] }>({ work: [], brk: [] });
  bars.current = {
    work: shown.map((d) => d.result.worked / (60 * MIN)),
    brk: shown.map((d) => d.result.breakMs / (60 * MIN)),
  };

  const count = Math.max(1, shown.length);
  const goal = target / 60;

  const { ok } = useScene(host, {
    distance: 9,
    fov: 40,
    setup: ({ scene, camera }) => {
      // A long lens, well back: a wide short chart on a short lens shears the
      // outer columns until they look like they are falling over.
      camera.fov = 16;
      camera.position.set(0, 6, 24);
      camera.lookAt(0, 1.8, 0);
      camera.updateProjectionMatrix();

      scene.add(new THREE.AmbientLight(0xffffff, 1.5));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(3, 6, 5);
      scene.add(key);

      const stage = new THREE.Group();
      scene.add(stage);

      // The card is wide and short, so the span has to come from what the camera
      // can actually see — otherwise the columns huddle in the middle instead of
      // standing over their date labels.
      const viewDist = Math.hypot(6 - 1.8, 24);
      const spanFor = (aspect: number) =>
        Math.min(60, 2 * Math.tan(((camera.fov * Math.PI) / 180) / 2) * viewDist * aspect * 0.97);

      let span = spanFor(camera.aspect);
      const scale = 0.42; // world units per hour
      const x = (i: number, s: number) => -s / 2 + (s / count) * (i + 0.5);

      // One line an hour, so a bar's height is countable.
      const lines: THREE.Mesh[] = [];
      for (let h = 2; h <= 10; h += 2) {
        const line = new THREE.Mesh(
          new THREE.BoxGeometry(1, 0.006, 0.006),
          new THREE.MeshBasicMaterial({ color: 0x2a2a31 }),
        );
        line.position.set(0, h * scale, -0.35);
        stage.add(line);
        lines.push(line);
      }

      const goalLine = new THREE.Mesh(
        new THREE.BoxGeometry(1, 0.022, 0.022),
        new THREE.MeshBasicMaterial({ color: 0xaab6f5, transparent: true, opacity: 0.75 }),
      );
      goalLine.position.set(0, goal * scale, -0.3);
      stage.add(goalLine);

      const make = (color: number, offset: number) => {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1, emissive: color, emissiveIntensity: 0.12 }),
        );
        mesh.position.z = offset;
        stage.add(mesh);
        return mesh;
      };

      // Break in front of work: it is a much shorter bar, so behind it would be lost.
      const workBars = shown.map(() => make(WORK, -0.35));
      const breakBars = shown.map(() => make(BREAK, 0.55));
      const heights = shown.map(() => ({ work: 0, brk: 0 }));

      /** Re-lays the row whenever the card changes width. */
      const place = () => {
        span = spanFor(camera.aspect);
        const width = Math.min(1.4, Math.max(0.22, (span / count) * 0.3));
        lines.forEach((l) => l.scale.set(span + 0.6, 1, 1));
        goalLine.scale.set(span + 0.6, 1, 1);
        workBars.forEach((m, i) => {
          m.position.x = x(i, span);
          m.scale.x = width;
          m.scale.z = width;
        });
        breakBars.forEach((m, i) => {
          m.position.x = x(i, span);
          m.scale.x = width * 0.8;
          m.scale.z = width * 0.8;
        });
      };

      let aspect = 0;

      return (elapsed, delta) => {
        if (camera.aspect !== aspect) {
          aspect = camera.aspect;
          place();
        }

        heights.forEach((h, i) => {
          h.work = approach(h.work, (bars.current.work[i] ?? 0) * scale, delta, 4);
          h.brk = approach(h.brk, (bars.current.brk[i] ?? 0) * scale, delta, 4);

          const w = workBars[i];
          if (w) {
            w.scale.y = Math.max(0.001, h.work);
            w.position.y = w.scale.y / 2;
          }
          const b = breakBars[i];
          if (b) {
            b.scale.y = Math.max(0.001, h.brk);
            b.position.y = b.scale.y / 2;
          }
        });

        // A shallow sway, enough to read as 3D without becoming a carousel.
        stage.rotation.y = Math.sin(elapsed * 0.22) * 0.1;
      };
    },
  });

  if (shown.length === 0) {
    return (
      <div className="card">
        <h2>Stored days</h2>
        <div className="empty-row">Nothing stored yet — load a day to see it here.</div>
      </div>
    );
  }

  return (
    <div className="card bars3d-card">
      <div className="card-head" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Last {shown.length} stored {shown.length === 1 ? "day" : "days"}</h2>
        <span className="bars3d-key">
          <i style={{ background: "#34d399" }} /> work
          <i style={{ background: "#f5a524", marginLeft: 12 }} /> break
          <i style={{ background: "#aab6f5", marginLeft: 12 }} /> {hm(target * MIN)} goal
        </span>
      </div>

      <div ref={host} className={`bars3d${ok ? "" : " off"}`} aria-hidden />

      <div className="bars3d-axis" style={{ gridTemplateColumns: `repeat(${shown.length}, 1fr)` }}>
        {shown.map((d) => (
          <span key={d.key} title={`${hm(d.result.worked)} worked, ${hm(d.result.breakMs)} break`}>
            {dayMonth(d.at)}
          </span>
        ))}
      </div>

      {!ok && (
        <p className="hint">
          This browser has no WebGL, so the chart is not drawn — the numbers are all in History.
        </p>
      )}
    </div>
  );
}
