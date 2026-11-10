// Renders one scene definition onto a canvas: live (float, pointer tilt, scroll-driven glint)
// or as a still for the build. See kit.js for the parts and scenes-*.js for the scenes.
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import * as K from "./kit.js";

const { THREE } = K;
const DEG = Math.PI / 180;

/**
 * def: { mood: "midnight"|"pearl", accent?, floor?: y | false, stars?: n,
 *        view: { target: [x,y,z], distance, azimuth°, elevation°, fov°, size },
 *        build(ctx, K) }
 * opts: { layout: "wide" (sculpture on the right, text on the left) | "narrow" (centred),
 *         still: bool, progress: 0..1, assetBase: "…/assets/" }
 */
export async function mount(canvas, def, opts = {}) {
  const { layout = "wide", still = false, assetBase = "assets/" } = opts;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: still });
  const dpr = still ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const mood = def.accent ? K.moodWith(def.mood ?? "midnight", def.accent, def.accentStrength) : structuredClone(K.MOODS[def.mood ?? "midnight"]);
  if (def.sky) mood.sky = def.sky;
  if (def.glows) mood.glows = def.glows;
  K.useMood(mood);
  renderer.toneMappingExposure = def.exposure ?? mood.exposure;

  const scene = new THREE.Scene();
  scene.environment = K.makeEnv(renderer, mood);
  scene.background = K.skyTexture(mood);
  const nStars = def.stars ?? mood.stars;
  if (nStars) scene.add(K.stars(nStars));
  const root = new THREE.Group(); // the sculpture: tilts toward the pointer
  scene.add(root);
  const camera = new THREE.PerspectiveCamera(def.view?.fov ?? 34, 1, 0.1, 300);
  const loads = [];
  const ctx = {
    THREE,
    K,
    scene,
    root,
    camera,
    renderer,
    mood,
    layout,
    still,
    u: { progress: { value: opts.progress ?? def.progress ?? 0.35 }, time: { value: 0 } },
    anim: [],
    load: (p) => loads.push(p),
    asset: (p) => assetBase + p.replace(/^assets\//, ""),
  };
  def.build(ctx, K);
  if (def.floor !== false && def.floor != null) {
    const f = K.reflectiveFloor(mood, def.floorOptions);
    f.position.y = def.floor;
    scene.add(f);
  }

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const [bs, br, bt] = def.bloom ?? mood.bloom;
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), bs, br, bt);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const v = def.view ?? {};
  const target = new THREE.Vector3(...(v.target ?? [0, 0, 0]));
  function frame(w, h) {
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // Keep the sculpture (v.size wide) inside its share of the frame.
    const share = layout === "wide" ? 0.44 : 0.78;
    const hfov = 2 * Math.atan(Math.tan(((v.fov ?? 34) * DEG) / 2) * camera.aspect);
    const fit = (v.size ?? 4) / 2 / Math.tan(hfov / 2) / share;
    const dist = Math.max(v.distance ?? 12, fit);
    const az = (v.azimuth ?? 0) * DEG;
    const el = (v.elevation ?? 6) * DEG;
    camera.position.set(target.x + dist * Math.sin(az) * Math.cos(el), target.y + dist * Math.sin(el), target.z + dist * Math.cos(az) * Math.cos(el));
    camera.lookAt(target);
    // Wide: shift the view so the target sits at ~68% across, leaving the left for the headline.
    const fx = layout === "wide" ? (v.wideX ?? 0.71) : 0.5;
    const fy = layout === "wide" ? 0.5 : (v.narrowY ?? 0.5);
    camera.setViewOffset(w, h, -(fx - 0.5) * w, (fy - 0.5) * h * -1, w, h);
    camera.updateProjectionMatrix();
  }

  const size = () => [canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height];
  frame(...size());

  if (still) {
    await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 8000))]);
    for (let i = 0; i < 4; i++) composer.render();
    return { renderer, ctx, dispose: () => renderer.dispose() };
  }

  // ---- live ----
  let running = false;
  let raf = 0;
  let visible = true;
  let tiltX = 0;
  let tiltY = 0;
  let wantX = 0;
  let wantY = 0;
  const t0 = performance.now();
  const loop = (now) => {
    raf = 0;
    if (!running) return;
    const t = (now - t0) / 1000;
    ctx.u.time.value = t;
    for (const f of ctx.anim) f(t);
    tiltX += (wantX - tiltX) * 0.06;
    tiltY += (wantY - tiltY) * 0.06;
    root.rotation.x = tiltX;
    root.rotation.y = tiltY;
    composer.render();
    raf = requestAnimationFrame(loop);
  };
  const play = () => {
    if (running || !visible || document.hidden) return;
    running = true;
    raf = requestAnimationFrame(loop);
  };
  const pause = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    visible ? play() : pause();
  });
  io.observe(canvas);
  const onVis = () => (document.hidden ? pause() : play());
  document.addEventListener("visibilitychange", onVis);
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    wantY = ((e.clientX - r.left) / r.width - 0.5) * 3 * DEG * 2; // max ±3°
    wantX = ((e.clientY - r.top) / r.height - 0.5) * 3 * DEG * 2;
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  const ro = new ResizeObserver(() => frame(...size()));
  ro.observe(canvas);
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 4000))]);
  composer.render();
  play();
  return {
    ctx,
    setProgress(p) {
      ctx.u.progress.value = p;
    },
    pause,
    play,
    dispose() {
      pause();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      renderer.dispose();
    },
  };
}
