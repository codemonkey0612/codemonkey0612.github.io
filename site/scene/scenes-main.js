// Hero sculptures of the seven main pages, plus the two shared backdrops
// (the Expertise constellation and the gold portal behind every inquiry band).
import * as S from "./symbols.js";

const { at, mesh } = S;

/** A long gold ribbon through `pts`, with dust; the main one carries the scroll glint. */
function goldRibbon(ctx, K, pts, { width = 0.4, twist = Math.PI * 2.4, glint = true, dust = 150, roughness } = {}) {
  const geo = K.ribbon(K.curve(pts), { width, twist });
  ctx.root.add(new K.THREE.Mesh(geo, K.gold(roughness ? { roughness } : {}, glint ? ctx.u.progress : null)));
  if (dust) ctx.root.add(K.sparkles(geo.userData.points, dust, width * 1.4, { seed: pts.length * 7 + dust }));
  return geo;
}

export default {
  // 01 Home — a glass torus threaded by the gold ribbon.
  home: {
    mood: "midnight",
    floor: -2.1,
    view: { target: [0, 0.2, 0], distance: 11.5, elevation: 7, size: 6.2 },
    build(ctx, K) {
      const { THREE } = K;
      const torus = mesh(new THREE.TorusGeometry(1.45, 0.58, 128, 256), K.glass({ thickness: 2.2, attenuationDistance: 2.4, tint: "#b9cdf5" }));
      torus.position.set(0, 0.45, 0);
      torus.rotation.set(0.25, -0.62, 0.32);
      ctx.root.add(torus);
      const h = K.halo(2.4, "#7fa8ea", 0.55);
      h.position.set(0.2, 0.4, -1.6);
      ctx.root.add(h);
      K.float(ctx, torus, { amp: 0.07, period: 8 });
      goldRibbon(ctx, K, [[-11, -1.4, -2.5], [-7, -1.9, -0.8], [-3.5, -1.0, 0.3], [-1.4, 0.0, 0.5], [0, 0.45, 0], [1.4, 0.85, -0.7], [2.8, 1.85, -0.3], [3.6, 3.2, 0.6], [6, 4.6, -0.6]], { width: 0.46, twist: Math.PI * 2.6, dust: 180 });
      goldRibbon(ctx, K, [[-11, 1.2, -6], [-6, -0.3, -3.2], [-2.5, -1.25, -0.8], [0.2, -0.6, 1.0], [2.6, 0.8, 0.2], [6, 1.5, -3]], { width: 0.17, twist: Math.PI * 1.4, glint: false, dust: 60, roughness: 0.3 });
    },
  },

  // Home "Expertise": a glass orb with a light core inside gold orbits, on a plinth.
  expertise: {
    mood: "midnight",
    floor: -1.62,
    view: { target: [0, 0.3, 0], distance: 9, elevation: 8, size: 4.4, wideX: 0.5 },
    build(ctx, K) {
      const orb = S.orb({ r: 1.15, tint: "#c8d9ff", core: "#d9b46a" });
      orb.position.y = 0.5;
      ctx.root.add(orb);
      K.float(ctx, orb, { amp: 0.05, period: 8 });
      for (const [r, rx, rz] of [[1.6, 1.25, 0.25], [1.85, 1.45, -0.45], [2.1, 1.7, 0.12]]) {
        const ring = K.ring(r, 0.014);
        ring.rotation.set(rx, 0, rz);
        ring.position.y = 0.5;
        ctx.root.add(ring);
      }
      const p = K.plinth(1.25, 0.18);
      p.position.y = -1.1;
      ctx.root.add(p);
      const pts = [];
      for (let i = 0; i < 80; i++) pts.push(K.V(Math.cos(i) * 1.9, 0.5 + Math.sin(i * 1.7) * 0.9, Math.sin(i) * 1.9));
      ctx.root.add(K.sparkles(pts, 140, 0.6, { seed: 21 }));
    },
  },

  // The inquiry band: a glass arch filled with warm light, on steps over water.
  portal: {
    mood: "midnight",
    floor: -1.5,
    glows: [[0.7, 0.56, 0.3, "#ffd28c", 0.45], [0.2, 0.2, 0.3, "#1d3b66", 0.4]],
    view: { target: [0, 0.4, 0], distance: 10, elevation: 4, size: 4.2, wideX: 0.72 },
    build(ctx, K) {
      const { THREE } = K;
      const a = S.arch({ depth: 0.3 });
      a.scale.setScalar(2.6);
      a.position.y = 0.8;
      ctx.root.add(a);
      const light = mesh(new THREE.PlaneGeometry(1.8, 2.1), K.glow("#ffe2b0", 2.6));
      light.position.set(0, 0.62, -0.25);
      ctx.root.add(light);
      for (let i = 0; i < 3; i++) {
        const step = mesh(new THREE.BoxGeometry(3.4 + i * 0.8, 0.16, 1.2 + i * 0.5), K.pearl());
        step.position.set(0, -0.6 - i * 0.16, 0.2 + i * 0.25);
        ctx.root.add(step);
      }
      goldRibbon(ctx, K, [[-8, -1.2, 1.5], [-4, -1.0, 1.2], [-1.6, -0.2, 0.9], [0, 0.4, 0.6], [1.8, 1.6, 0.2], [3.5, 2.6, -0.8], [7, 3.4, -2]], { width: 0.24, twist: Math.PI * 1.8, dust: 120 });
    },
  },

  // 02 Works — floating glass frames holding real project images, inside a gold orbit.
  works: {
    mood: "midnight",
    floor: -2.2,
    view: { target: [0, 0.6, 0], distance: 10, elevation: 6, size: 6.2 },
    build(ctx, K) {
      const frames = [
        ["media/works/go-to-market-top.webp", 1.6, [0, 0.7, 0.4], 2.9, -0.08],
        ["media/portfolio/stress-ai.webp", 1.278, [-3.0, 0.2, -1.2], 1.9, 0.42],
        ["media/works/a-worker-top.webp", 1.6, [2.9, 0.1, -1.0], 2.1, -0.46],
        ["media/portfolio/insurance-lp.webp", 1.278, [-1.6, 2.2, -2.6], 1.4, 0.22],
        ["media/portfolio/web-system.webp", 1.278, [1.9, 2.3, -2.8], 1.4, -0.3],
      ];
      for (const [src, aspect, pos, w, ry] of frames) {
        const h = w / 1.45;
        const p = K.imagePanel(ctx, ctx.asset(src), w, h, { depth: 0.14, imageAspect: aspect });
        p.position.set(...pos);
        p.rotation.y = ry;
        p.add(at(K.goldFrame(w + 0.04, h + 0.04, { tube: 0.012 }), 0, 0, 0.09));
        ctx.root.add(p);
        K.float(ctx, p, { amp: 0.05, period: 8, phase: pos[0] });
      }
      const orbit = K.ring(4.3, 0.016);
      orbit.rotation.set(1.32, 0, -0.16);
      orbit.position.y = 0.9;
      ctx.root.add(orbit);
      const pts = [];
      for (let i = 0; i < 120; i++) pts.push(K.V(Math.cos(i / 19) * 4.3, 0.9 + Math.sin(i / 19) * 0.6, Math.sin(i / 19) * 1.0));
      ctx.root.add(K.sparkles(pts, 120, 0.4, { seed: 5 }));
    },
  },

  // 03 Services — eight glass symbols along an S-shaped gold ribbon (pearl).
  services: {
    mood: "pearl",
    floor: -1.9,
    floorOptions: { strength: 0.35, ripple: 0 },
    view: { target: [0, 0.9, 0], distance: 11, elevation: 9, size: 6.8 },
    build(ctx, K) {
      const path = K.curve([[-6, -1.4, 1.2], [-3.6, -0.9, 1.6], [-1.2, -0.6, 0.6], [0.6, -0.2, -0.6], [2.6, 0.4, -0.2], [3.8, 1.2, 0.8], [2.2, 1.9, 1.2], [-0.4, 2.0, 0.2], [-2.2, 2.4, -0.8], [0.6, 3.0, -1.4], [4, 3.2, -1.2]]);
      const geo = K.ribbon(path, { width: 0.42, twist: Math.PI * 3 });
      ctx.root.add(new K.THREE.Mesh(geo, K.gold({ roughness: 0.2 }, ctx.u.progress)));
      ctx.root.add(K.sparkles(geo.userData.points, 120, 0.6, { seed: 8, boost: 1.4 }));
      const symbols = [S.shield(), S.bag(), S.browser(), S.gears(), S.cloud(), S.compass(), S.speech(), S.chip()];
      symbols.forEach((sym, i) => {
        const t = 0.07 + (i / (symbols.length - 1)) * 0.82;
        const p = path.getPointAt(t);
        sym.scale.setScalar(1.05);
        sym.position.set(p.x, p.y + 0.62, p.z);
        sym.rotation.y = -p.x * 0.06;
        ctx.root.add(sym);
        K.float(ctx, sym, { amp: 0.06, period: 7 + i * 0.4, phase: i });
      });
    },
  },

  // 04 Pricing — three glass monoliths rising, a gold spiral through them.
  pricing: {
    mood: "midnight",
    floor: -1.6,
    view: { target: [0, 0.6, 0], distance: 10.5, elevation: 9, size: 5.2 },
    build(ctx, K) {
      const p = K.plinth(2.2, 0.16);
      p.position.y = -1.2;
      ctx.root.add(p);
      [[-1.5, 1.2, 0.5], [0, 2.0, -0.2], [1.5, 3.0, -0.6]].forEach(([x, h, z], i) => {
        const m = S.monolith({ w: 0.9, h, d: 0.9, tint: ["#e4eeff", "#dbe6ff", "#d2deff"][i] });
        m.position.set(x, -1.2, z);
        ctx.root.add(m);
        const cap = mesh(new K.THREE.BoxGeometry(0.92, 0.02, 0.92), K.gold());
        cap.position.set(x, -1.2 + h + 0.01, z);
        ctx.root.add(cap);
        const glowIn = K.halo(0.9 + i * 0.25, "#8fb4ff", 0.42);
        glowIn.position.set(x, -1.2 + h * 0.55, z - 0.9);
        ctx.root.add(glowIn);
      });
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const a = -2.3 + t * Math.PI * 2.1;
        pts.push([Math.cos(a) * 2.5 * (1 - t * 0.25), -1.0 + t * 3.6, Math.sin(a) * 1.4]);
      }
      goldRibbon(ctx, K, pts, { width: 0.1, twist: Math.PI, dust: 100 });
      for (const [x, y, z] of [[-1.5, 0.05, 0.5], [0, 0.85, -0.2], [1.5, 1.85, -0.6]]) {
        const n = mesh(new K.THREE.SphereGeometry(0.07, 24, 16), K.glow("#ffe0a0", 3));
        n.position.set(x, y, z + 0.5);
        ctx.root.add(n);
      }
    },
  },

  // 05 About — a sculptural gold 匠 on a pearl plinth, glass instruments floating around it.
  about: {
    mood: "pearl",
    floor: -1.55,
    floorOptions: { strength: 0.3, ripple: 0 },
    view: { target: [0, 0.5, 0], distance: 9.5, elevation: 8, size: 5 },
    build(ctx, K) {
      const { THREE } = K;
      const t = S.takumi({ size: 2.6, depth: 0.42, mat: K.gold({ roughness: 0.16, side: THREE.FrontSide }) });
      t.position.y = 0.55;
      t.rotation.y = -0.22;
      ctx.root.add(t);
      K.float(ctx, t, { amp: 0.04, period: 8 });
      const p = K.plinth(1.9, 0.22);
      p.position.y = -1.0;
      ctx.root.add(p);
      const ring = K.ring(2.4, 0.012);
      ring.rotation.set(1.42, 0, 0.1);
      ring.position.y = -0.7;
      ctx.root.add(ring);
      const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(0, 0.7)]);
      tri.holes.push(new THREE.Path([new THREE.Vector2(0.14, 0.12), new THREE.Vector2(0.62, 0.12), new THREE.Vector2(0.14, 0.45)]));
      const triangle = mesh(K.extrude(tri, { size: 1.1, depth: 0.06, bevel: 0.015 }), K.glass({ tint: "#cfe1ff", thickness: 0.3 }));
      triangle.position.set(-2.3, 1.5, -0.4);
      triangle.rotation.set(0.2, 0.5, 0.5);
      const cube = mesh(new THREE.OctahedronGeometry(0.42, 0), K.glass({ tint: "#bfe0ff", thickness: 0.8, dispersion: 7 }));
      cube.position.set(2.3, 1.2, 0.2);
      const lens = S.magnifier();
      lens.scale.setScalar(0.75);
      lens.position.set(2.0, 2.4, -1.0);
      lens.rotation.set(0.1, -0.4, 0.2);
      ctx.root.add(triangle, cube, lens);
      K.float(ctx, triangle, { amp: 0.08, period: 9 });
      K.float(ctx, cube, { amp: 0.06, period: 7, phase: 1, spin: 0.3 });
      K.float(ctx, lens, { amp: 0.06, period: 10, phase: 2 });
    },
  },

  // 06 Reviews — a slow glass soundwave over water inside a gold ellipse.
  reviews: {
    mood: "midnight",
    floor: -1.7,
    view: { target: [0, 0.5, 0], distance: 10, elevation: 5, size: 7.4 },
    build(ctx, K) {
      const { THREE } = K;
      const prof = [];
      for (let i = 0; i <= 200; i++) {
        const x = -3.2 + (i / 200) * 6.4;
        const env = Math.exp(-(x * x) / 4.2);
        prof.push(new THREE.Vector2(0.03 + env * Math.abs(Math.sin(x * 2.4 + 0.6)) * 0.95 + env * 0.06, x));
      }
      const wave = mesh(new THREE.LatheGeometry(prof, 96), K.glass({ thickness: 1.4, tint: "#c9d8ff", dispersion: 6 }));
      wave.rotation.z = Math.PI / 2;
      wave.position.y = 0.55;
      wave.scale.setScalar(1.35);
      const back = K.halo(3.2, "#6f9be0", 0.45);
      back.position.set(0, 0.6, -2);
      ctx.root.add(back);
      ctx.root.add(wave);
      ctx.anim.push((t) => wave.scale.set(1.35, 1.35 * (1 + Math.sin(t * 0.6) * 0.04), 1.35 * (1 + Math.sin(t * 0.6) * 0.04)));
      const ellipse = K.ring(3.4, 0.014);
      ellipse.scale.set(1, 0.42, 1);
      ellipse.rotation.set(1.42, 0, 0.12);
      ellipse.position.y = 0.4;
      ctx.root.add(ellipse);
      for (const x of [-2, -1.1, -0.3, 0.6, 1.4, 2.2]) {
        const thread = mesh(new THREE.CylinderGeometry(0.004, 0.004, 3, 6), K.gold());
        thread.position.set(x, 2.8, 0);
        ctx.root.add(thread);
      }
      const pts = prof.map((p) => K.V(p.y * 1.35, 0.55 + p.x, 0));
      ctx.root.add(K.sparkles(pts, 140, 1.2, { seed: 4 }));
    },
  },

  // 07 Contact — a glass envelope with gold light leaving it (pearl).
  contact: {
    mood: "pearl",
    floor: -1.5,
    floorOptions: { strength: 0.3, ripple: 0 },
    view: { target: [0, 0.3, 0], distance: 9, elevation: 10, size: 4.6 },
    build(ctx, K) {
      const { THREE } = K;
      const env = new THREE.Group();
      const body = K.extrudeRect(2.6, 1.7, 0.08, 0.2);
      env.add(mesh(body, K.glass({ thickness: 0.5, tint: "#c3d3ff" })));
      const z = body.userData.front + 0.01;
      // Flap and fold lines in gold, so it reads as an envelope.
      const line = (pts, tube = 0.016) => env.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => K.V(p[0], p[1], z)), false, "catmullrom", 0), 64, tube, 8, false), K.gold()));
      line([[-1.26, 0.82], [0, -0.12], [1.26, 0.82]]);
      line([[-1.26, -0.82], [-0.38, 0.12]], 0.01);
      line([[1.26, -0.82], [0.38, 0.12]], 0.01);
      env.add(at(K.goldFrame(2.62, 1.72, { r: 0.08, tube: 0.014 }), 0, 0, 0));
      const light = K.halo(1.6, "#ffd59a", 0.75);
      light.position.set(0, 0.2, -0.4);
      env.add(light);
      env.position.set(0, 0.5, 0);
      env.rotation.set(-0.12, -0.45, 0.12);
      ctx.root.add(env);
      K.float(ctx, env, { amp: 0.06, period: 8 });
      goldRibbon(ctx, K, [[-0.2, 0.6, 0.2], [1.2, 1.2, 0.6], [2.6, 1.0, -0.4], [4.0, 1.9, -1.0], [6.5, 2.4, -2]], { width: 0.34, twist: Math.PI * 1.6, dust: 120 });
      goldRibbon(ctx, K, [[-7, -0.8, -2], [-3.5, -0.9, -0.6], [-1.2, 0.0, 0.4], [-0.2, 0.55, 0.2]], { width: 0.2, twist: Math.PI, glint: false, dust: 40 });
    },
  },
};
