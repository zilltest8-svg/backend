import { useEffect, useState, type RefObject } from "react";
import * as THREE from "three";

export interface SceneParts {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
}

/** Called once per animation frame. `elapsed` is frozen when motion is reduced. */
export type Frame = (elapsed: number, delta: number) => void;

export interface SceneOptions {
  /** Builds the contents. Runs once; return the per-frame callback. */
  setup: (parts: SceneParts) => Frame | void;
  /** Camera distance along Z. */
  distance?: number;
  fov?: number;
}

const MAX_DPR = 2;

/** Free everything a scene allocated — geometries, materials, textures. */
function dispose(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh> & Partial<THREE.Points>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

/**
 * The boilerplate around every canvas in the app: a renderer sized to its host,
 * a frame loop that stops when the tab is hidden, and a teardown that actually
 * frees the GPU objects. WebGL is optional — if the context cannot be created
 * the hook reports it and the caller falls back to plain markup, so the app
 * never depends on it.
 */
export function useScene(
  host: RefObject<HTMLDivElement | null>,
  { setup, distance = 4, fov = 45 }: SceneOptions,
): { ok: boolean } {
  const [ok, setOk] = useState(true);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    } catch {
      setOk(false);
      return;
    }

    const width = Math.max(1, el.clientWidth);
    const height = Math.max(1, el.clientHeight);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 100);
    camera.position.z = distance;

    const frame = setup({ scene, camera, renderer }) ?? (() => undefined);

    const resize = new ResizeObserver(() => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(el);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = new THREE.Timer();
    // Deliberately not connected to page visibility: that pins the delta to zero
    // whenever document.hidden is true, which stops the easing in any window the
    // OS considers hidden. Clamping the delta gives the same no-jump guarantee.
    let raf = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      timer.update();
      // Idle motion stops when the reader asked for less of it; values still ease.
      frame(reduced ? 0 : timer.getElapsed(), Math.min(timer.getDelta(), 0.1));
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      dispose(scene);
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
    // Built once: the per-frame callback reads live values through the caller's refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ok };
}

/** Frame-rate independent easing towards a target. */
export const approach = (current: number, target: number, delta: number, speed = 6): number =>
  current + (target - current) * (1 - Math.exp(-speed * delta));
