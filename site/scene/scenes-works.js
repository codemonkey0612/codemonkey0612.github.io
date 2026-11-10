// Hero sculptures of the sixteen case studies (/works/<id>/). Real images appear only inside
// frames (live-site screenshots, Lancers covers); every drawn interface is placeholder lines.
import * as S from "./symbols.js";

const { at, mesh } = S;

function rib(ctx, K, pts, { width = 0.24, twist = Math.PI * 2, glint = true, dust = 100, seed = 1, closed = false } = {}) {
  const geo = K.ribbon(K.curve(pts, closed), { width, twist });
  ctx.root.add(new K.THREE.Mesh(geo, K.gold({}, glint ? ctx.u.progress : null)));
  if (dust) ctx.root.add(K.sparkles(geo.userData.points, dust, width * 1.6, { seed }));
  return geo;
}
const lux = (K, tint, k = 0.16, o = {}) => K.glass({ tint, emissive: K.C(tint), emissiveIntensity: k, attenuationDistance: 6, ...o });
const light = (ctx, K, r, color, opacity, x, y, z) => {
  const h = K.halo(r, color, opacity);
  h.position.set(x, y, z);
  ctx.root.add(h);
  return h;
};
const solidFaces = (obj) =>
  obj.traverse((m) => {
    if (m.material?.map && m.material.isMeshBasicMaterial) {
      Object.assign(m.material, { transparent: false, alphaTest: 0.4, toneMapped: true });
      m.material.color.setScalar(0.86);
    }
  });
const cloudMat = (K) => new K.THREE.MeshPhysicalMaterial({ color: "#f4f7ff", roughness: 0.55, sheen: 0.6, sheenColor: K.C("#ffffff"), emissive: K.C("#b9c9ea"), emissiveIntensity: 0.18, envMapIntensity: 0.9 });

/** A real image in a glass frame with a gold edge. */
function framed(ctx, K, src, aspect, w, h = w / aspect) {
  const p = K.imagePanel(ctx, ctx.asset(src), w, h, { depth: 0.12, imageAspect: aspect });
  p.add(at(K.goldFrame(w + 0.04, h + 0.04, { tube: 0.012 }), 0, 0, 0.075));
  return p;
}

/** Gold tubes along the edges of a geometry (wireframe models, lattices). */
function goldEdges(K, geo, r = 0.012, mat = K.gold()) {
  const { THREE } = K;
  const g = new THREE.Group();
  const e = new THREE.EdgesGeometry(geo).attributes.position;
  for (let i = 0; i < e.count; i += 2) {
    const a = K.V(e.getX(i), e.getY(i), e.getZ(i));
    const b = K.V(e.getX(i + 1), e.getY(i + 1), e.getZ(i + 1));
    const c = mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6), mat);
    c.position.copy(a).add(b).multiplyScalar(0.5);
    c.quaternion.setFromUnitVectors(K.V(0, 1, 0), b.clone().sub(a).normalize());
    g.add(c);
  }
  return g;
}

/** A closed polygon outline as a gold tube (radar grids). */
function outline(K, pts, r = 0.012) {
  return mesh(new K.THREE.TubeGeometry(new K.THREE.CatmullRomCurve3(pts, true, "catmullrom", 0), pts.length * 16, r, 6, true), K.gold());
}
const polygon = (K, n, radius, z = 0) => Array.from({ length: n }, (_, i) => K.V(Math.sin((i / n) * Math.PI * 2) * radius, Math.cos((i / n) * Math.PI * 2) * radius, z));

/** Placeholder form card: a header bar, empty fields, a pill button (no real data). */
const formCard = (K, { title = "", rows = 3, button = true, accent = "#c9a24a" } = {}) => (g, W, H) => {
  K.paint.bg(g, W, H, "rgba(255,255,255,.86)", "rgba(232,238,250,.7)");
  if (title) {
    g.fillStyle = "rgba(20,35,60,.85)";
    g.font = `600 ${Math.round(H * 0.085)}px "Noto Sans CJK JP", "Noto Sans JP", sans-serif`;
    g.fillText(title, W * 0.08, H * 0.15);
  }
  for (let i = 0; i < rows; i++) {
    K.paint.lines(g, W * 0.08, H * (0.24 + i * 0.17), [W * 0.22], { height: H * 0.028, color: "rgba(40,60,90,.4)" });
    K.paint.field(g, W * 0.08, H * (0.28 + i * 0.17), W * 0.84, H * 0.08, { stroke: "rgba(150,165,190,.7)" });
  }
  if (button) K.paint.pill(g, W * 0.3, H * 0.82, W * 0.4, H * 0.09, accent);
};

/** Placeholder code lines on a dark card. */
const codeLines = (K) => (g, W, H) => {
  K.paint.bg(g, W, H, "rgba(14,26,52,.86)", "rgba(28,48,92,.7)");
  const r = K.rng(5);
  for (let i = 0; i < 12; i++) {
    const indent = [0, 1, 1, 2, 2, 1, 0, 1, 2, 2, 1, 0][i] * 24;
    g.fillStyle = ["rgba(158,195,255,.75)", "rgba(201,162,74,.85)", "rgba(220,230,255,.5)"][i % 3];
    g.beginPath();
    g.roundRect(26 + indent, 24 + (i * (H - 44)) / 12, 50 + r() * (W - 140 - indent), 7, 4);
    g.fill();
  }
};

/** Pearl server stack with lit slits. */
function server(K, n = 4, w = 0.7) {
  const g = new K.THREE.Group();
  for (let i = 0; i < n; i++) {
    g.add(at(mesh(K.extrudeRect(w, 0.2, 0.03, 0.5), K.pearl()), 0, i * 0.24, 0));
    g.add(at(mesh(new K.THREE.PlaneGeometry(w * 0.6, 0.025), K.glow(i % 2 ? "#9ec3ff" : "#ffd08a", 1.6)), 0, i * 0.24, 0.29));
  }
  return g;
}

export default {
  // 01 Go-to-Market Strategy — the real site inside a giant gold-edged glass arch, amber and forest.
  "work-go-to-market": {
    mood: "midnight",
    glows: [[0.68, 0.5, 0.42, "#d99a4e", 0.45], [0.78, 0.86, 0.3, "#3f6b4a", 0.4], [0.18, 0.18, 0.3, "#1d3b66", 0.35]],
    floor: -1.66,
    view: { target: [0, 0.2, 0], distance: 10, elevation: 5, size: 5.8 },
    build(ctx, K) {
      const a = S.arch({ mat: lux(K, "#fff0d8", 0.05, { thickness: 0.6 }), depth: 0.3 });
      a.scale.setScalar(3.3);
      ctx.root.add(a);
      light(ctx, K, 2.2, "#ffbf70", 0.5, 0, 0, -1.2);
      const site = framed(ctx, K, "media/works/go-to-market-top.webp", 1.6, 2.3);
      site.position.set(0, -0.3, 0.15);
      ctx.root.add(site);
      K.float(ctx, site, { amp: 0.04, period: 8 });
      [[-2.1, 1.2, 0.6, 0.6], [-2.2, -0.7, 1.0, -0.4], [2.1, 1.5, 0.2, 2.2], [2.3, -0.5, 0.9, 1.0], [1.4, 2.1, -0.6, 0.3]].forEach(([x, y, z, rz], i) => {
        const l = new K.THREE.Group();
        l.add(mesh(K.extrude(S.shapes.LEAF, { size: 0.55, depth: 0.05, bevel: 0.02 }), lux(K, i % 2 ? "#f3c070" : "#e09a48", 0.35, { thickness: 0.2 })));
        l.position.set(x, y, z);
        l.rotation.set(0.4, 0.3 * i, rz);
        ctx.root.add(l);
        K.float(ctx, l, { amp: 0.06, period: 7 + i, phase: i, spin: 0.2 });
      });
      rib(ctx, K, [[-6, -1.4, 1.2], [-3, -1.1, 1.4], [-1.8, -0.4, 0.6], [-1.85, 0.6, 0.25], [-1.2, 1.55, 0.25], [0, 1.95, 0.25], [1.2, 1.55, 0.25], [2.6, 0.8, 0.8], [6, 0.2, -1]], { width: 0.12, twist: Math.PI });
    },
  },

  // 02 A-worker — the real site on layered porcelain slabs, with a wire architectural model.
  "work-a-worker": {
    mood: "midnight",
    accent: "#e8dcc4",
    accentStrength: 0.35,
    floor: -1.6,
    view: { target: [0, 0.3, 0], distance: 10, elevation: 9, size: 5.2 },
    build(ctx, K) {
      const { THREE } = K;
      [[0, -1.3, 0.2, 4.0, 1.9], [0.7, -0.6, -0.4, 3.0, 1.4], [0.6, 1.45, -0.45, 3.4, 1.7]].forEach(([x, y, z, w, d]) => {
        const slab = mesh(new THREE.BoxGeometry(w, 0.14, d), K.pearl({ color: "#e8e4dc" }));
        slab.position.set(x, y, z);
        ctx.root.add(slab);
        const edge = mesh(new THREE.BoxGeometry(w, 0.012, 0.012), K.gold());
        edge.position.set(x, y + 0.075, z + d / 2);
        ctx.root.add(edge);
      });
      const site = framed(ctx, K, "media/works/a-worker-top.webp", 1.6, 2.4);
      site.position.set(0.45, 0.42, -0.2);
      site.rotation.y = -0.18;
      ctx.root.add(site);
      light(ctx, K, 2.2, "#c9d6f0", 0.32, 0.4, 0.4, -1.4);
      const model = goldEdges(K, new THREE.BoxGeometry(0.9, 0.5, 0.7), 0.01);
      const roof = goldEdges(K, new THREE.BoxGeometry(1.3, 0.04, 0.9), 0.008);
      roof.position.set(0.2, 0.27, 0);
      model.add(roof);
      model.position.set(-1.35, -0.95, 0.75);
      model.rotation.y = 0.5;
      ctx.root.add(model);
      K.float(ctx, model, { amp: 0.04, period: 9, spin: 0.25 });
      rib(ctx, K, [[-6, -2.0, 1.4], [-3, -1.7, 1.6], [-0.4, -1.45, 1.4], [1.8, -0.9, 0.9], [2.6, 0.3, 0.2], [3.4, 1.6, -0.6], [6, 2.4, -1.6]], { width: 0.16, twist: Math.PI * 1.4 });
    },
  },

  // 03 業種別AIアドバイス — a mint glass radar sculpture (regular grid only) beside the framed cover.
  "work-stress-ai": {
    mood: "midnight",
    accent: "#8fe0c0",
    floor: -1.7,
    view: { target: [0, 0.3, 0], distance: 10, elevation: 7, size: 5 },
    build(ctx, K) {
      const { THREE } = K;
      const radar = new THREE.Group();
      const penta = new THREE.Shape(polygon(K, 5, 1).map((v) => new THREE.Vector2(v.x, v.y)));
      radar.add(mesh(K.extrude(penta, { size: 2.6, depth: 0.16, bevel: 0.04 }), lux(K, "#a8ecd0", 0.18, { thickness: 0.4 })));
      for (const r of [0.42, 0.84, 1.26]) radar.add(outline(K, polygon(K, 5, r, 0.13), r === 1.26 ? 0.016 : 0.009));
      for (const v of polygon(K, 5, 1.26, 0.13)) {
        const spoke = mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.26, 6), K.gold());
        spoke.position.copy(v).multiplyScalar(0.5).setZ(0.13);
        spoke.quaternion.setFromUnitVectors(K.V(0, 1, 0), v.clone().setZ(0).normalize());
        radar.add(spoke);
      }
      radar.position.set(-0.9, 0.2, 0.4);
      radar.rotation.set(-0.25, 0.42, 0);
      ctx.root.add(radar);
      K.float(ctx, radar, { amp: 0.05, period: 8 });
      light(ctx, K, 2.2, "#6fd6b0", 0.42, -0.6, 0.3, -1.2);
      const cover = framed(ctx, K, "media/portfolio/stress-ai.webp", 1.278, 2.0);
      cover.position.set(1.5, 0.55, -0.6);
      cover.rotation.y = -0.32;
      ctx.root.add(cover);
      const p = K.plinth(1.4, 0.12, { steps: 1 });
      p.position.set(-0.9, -1.25, 0.4);
      ctx.root.add(p);
      rib(ctx, K, [[-6, -1.2, 1.0], [-3.2, -1.0, 1.5], [-1.0, -0.7, 1.4], [0.8, -0.6, 0.9], [2.2, -0.2, 0.4], [3.2, 1.0, -0.4], [6, 2.0, -1.6]], { width: 0.16, twist: Math.PI * 1.5 });
    },
  },

  // 04 AI連携・グラフ・CSV — one data ribbon: glass radar → document prism → table tiles and a CSV sheet.
  "work-stress-features": {
    mood: "midnight",
    accent: "#a9c9ff",
    floor: -1.8,
    view: { target: [0, 0.4, 0], distance: 10, elevation: 6, size: 7.4 },
    build(ctx, K) {
      const { THREE } = K;
      const penta = new THREE.Shape(polygon(K, 5, 1).map((v) => new THREE.Vector2(v.x, v.y)));
      const radar = mesh(K.extrude(penta, { size: 1.3, depth: 0.1, bevel: 0.03 }), lux(K, "#bcd6ff", 0.16, { thickness: 0.3 }));
      radar.add(outline(K, polygon(K, 5, 0.62, 0.09), 0.008));
      radar.position.set(-2.2, 1.0, 0.2);
      radar.rotation.y = 0.5;
      const prism = mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.5, 3), lux(K, "#d6e4ff", 0.12, { thickness: 0.8, dispersion: 7 }));
      prism.rotation.set(Math.PI / 2, 0, 0.2);
      prism.position.set(-0.3, 0.5, 0);
      const tiles = new THREE.Group();
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 3; c++) tiles.add(at(mesh(K.extrudeRect(0.42, 0.24, 0.04, 0.05), lux(K, r === 0 ? "#f1dcae" : "#cfe0ff", 0.3, { thickness: 0.1 })), c * 0.47, -r * 0.29, 0));
      tiles.position.set(1.0, 0.75, 0.1);
      tiles.rotation.y = -0.35;
      const csv = S.documentSheet({ w: 0.8, h: 1.04, label: "CSV", tint: "#e9dfc6" });
      solidFaces(csv);
      csv.position.set(2.3, -0.2, 0.5);
      csv.rotation.y = -0.45;
      ctx.root.add(radar, prism, tiles, csv);
      [radar, prism, tiles, csv].forEach((o, i) => K.float(ctx, o, { amp: 0.04, period: 8 + i, phase: i }));
      light(ctx, K, 2.6, "#7fa8ea", 0.45, 0, 0.5, -1.6);
      rib(ctx, K, [[-6, 1.6, -1], [-3.4, 1.3, 0.2], [-2.2, 1.0, 0.4], [-1.0, 0.6, 0.3], [0.3, 0.4, 0.2], [1.3, 0.2, 0.6], [2.3, -0.4, 0.9], [3.4, -0.9, 0.8], [6, -1.4, -0.6]], { width: 0.28, twist: Math.PI * 2.4 });
      ctx.root.scale.setScalar(1.3);
    },
  },

  // 05 マルチテナント基盤 — glass company islands, each isolated in its own gold ring, around one shared core.
  "work-stress-multitenant": {
    mood: "midnight",
    accent: "#4f7bd6",
    accentStrength: 0.6,
    floor: -1.7,
    view: { target: [0, 0.2, 0], distance: 10, elevation: 14, size: 5.8 },
    build(ctx, K) {
      const { THREE } = K;
      const core = S.orb({ r: 0.62, tint: "#bcd0ff", core: "#ffd894" });
      core.position.y = 0.45;
      ctx.root.add(core);
      light(ctx, K, 1.6, "#7fa8ff", 0.55, 0, 0.45, -0.8);
      const base = K.plinth(0.8, 0.12, { steps: 1 });
      base.position.y = -0.3;
      ctx.root.add(base);
      [[-2.2, 0.1, 0.3], [-0.9, 0.9, -1.8], [1.1, 0.7, -1.6], [2.3, -0.1, 0.4]].forEach(([x, y, z], i) => {
        const isle = new THREE.Group();
        isle.add(at(mesh(new THREE.CylinderGeometry(0.6, 0.56, 0.1, 64), K.pearl()), 0, -0.05, 0));
        const r = K.rng(i + 3);
        for (let k = 0; k < 5; k++) {
          const h = 0.18 + r() * 0.4;
          isle.add(at(mesh(new THREE.BoxGeometry(0.11, h, 0.11), K.glow(k % 2 ? "#9ec3ff" : "#cfe0ff", 1.2)), (r() - 0.5) * 0.5, h / 2, (r() - 0.5) * 0.5));
        }
        isle.add(mesh(new THREE.SphereGeometry(0.55, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2), lux(K, "#cfe0ff", 0.08, { thickness: 0.3 })));
        const ring = K.ring(0.78, 0.014);
        isle.add(ring);
        isle.position.set(x, y, z);
        ctx.root.add(isle);
        K.float(ctx, isle, { amp: 0.05, period: 8 + i, phase: i * 1.3 });
      });
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        pts.push([Math.cos(a) * 2.6, -0.45 + Math.sin(a * 2) * 0.12, Math.sin(a) * 1.4 - 0.5]);
      }
      rib(ctx, K, pts.slice(0, 60), { width: 0.1, twist: Math.PI * 2, closed: true, dust: 120 });
    },
  },

  // 06 不登校支援サイト — a gentle glass leaf canopy in sunlight over the framed site cover (pearl, sage).
  "work-futoko-wordpress": {
    mood: "pearl",
    accent: "#cfe3bf",
    glows: [[0.66, 0.3, 0.42, "#fff0c8", 0.65], [0.85, 0.6, 0.3, "#cfe3bf", 0.55], [0.22, 0.25, 0.4, "#e8f0dc", 0.5]],
    floor: -1.6,
    floorOptions: { strength: 0.3, ripple: 0 },
    view: { target: [0, 0.5, 0], distance: 10, elevation: 6, size: 5 },
    build(ctx, K) {
      const cover = framed(ctx, K, "media/portfolio/futoko-wordpress.webp", 1.278, 2.5);
      cover.position.set(0, 0.0, 0);
      ctx.root.add(cover);
      K.float(ctx, cover, { amp: 0.04, period: 8 });
      const sun = K.halo(2.2, "#ffe4a8", 0.6);
      sun.position.set(1.4, 2.4, -2);
      ctx.root.add(sun);
      [[-1.9, 1.7, 0.3, 2.2], [-1.0, 2.15, -0.2, 2.7], [0.0, 2.3, 0.4, 3.0], [1.0, 2.1, -0.1, 3.5], [1.9, 1.75, 0.3, 3.9], [-1.6, 2.5, -0.9, 2.5], [1.4, 2.6, -0.8, 3.6], [2.4, 1.1, 0.6, 4.2]].forEach(([x, y, z, rz], i) => {
        const l = S.leaf({ tint: i % 3 ? "#9cc98c" : "#c3dc96", size: 0.95 });
        l.position.set(x, y, z);
        l.rotation.set(0.35, 0.3 * ((i % 3) - 1), rz);
        ctx.root.add(l);
        K.float(ctx, l, { amp: 0.04, period: 9 + i * 0.5, phase: i, spin: 0.1 });
      });
      rib(ctx, K, [[-6, -1.2, 1.0], [-3, -1.0, 1.3], [-1.2, -1.15, 1.2], [0.8, -0.9, 0.9], [2.2, -0.2, 0.6], [3, 1.0, 0], [5.5, 2.0, -1.4]], { width: 0.14, twist: Math.PI * 1.4, dust: 70 });
    },
  },

  // 07 コーポレートサイト — fourteen architectural glass panels (one per page) and an amber energy line.
  "work-elementor-corporate": {
    mood: "midnight",
    glows: [[0.7, 0.62, 0.45, "#ffb04f", 0.45], [0.8, 0.82, 0.3, "#ff8a3d", 0.25], [0.2, 0.2, 0.3, "#1d3b66", 0.4]],
    floor: -1.6,
    view: { target: [0, 0.5, 0], distance: 10, elevation: 6, azimuth: -14, size: 5.6 },
    build(ctx, K) {
      const { THREE } = K;
      const pts = [];
      for (let i = 0; i < 14; i++) {
        const t = i / 13;
        const h = 3.4 - t * 1.8;
        const panel = mesh(new THREE.BoxGeometry(0.24, h, 0.04), lux(K, "#fff1dc", 0.03, { thickness: 0.15 }));
        const x = -2.4 + t * 4.6;
        const z = 0.8 - t * 2.4;
        panel.position.set(x, -1.6 + h / 2, z);
        panel.rotation.y = -0.5;
        ctx.root.add(panel);
        const cap = mesh(new THREE.BoxGeometry(0.25, 0.012, 0.05), K.gold());
        cap.position.set(x, -1.6 + h + 0.006, z);
        cap.rotation.y = -0.5;
        ctx.root.add(cap);
        pts.push([x + 0.05, -0.9 + Math.sin(t * Math.PI) * 1.2 + t * 0.4, z + 0.12]);
      }
      const filament = K.curve([[-6, -1.2, 2], [-3.4, -1.0, 1.4], ...pts, [3.8, 1.2, -2.2], [6, 1.8, -3]]);
      ctx.root.add(mesh(new THREE.TubeGeometry(filament, 400, 0.014, 8, false), K.glow("#ffb347", 1.7)));
      light(ctx, K, 2.4, "#ffa24a", 0.38, 0, 0.6, -2);
      rib(ctx, K, [[-6, -1.5, 2.2], [-3, -1.4, 1.9], [-0.6, -1.35, 1.3], [1.6, -1.2, 0.4], [3.4, -0.6, -0.6], [6, 0.4, -2]], { width: 0.2, twist: Math.PI * 1.6 });
    },
  },

  // 08 Firebase再構築 — a crystal pavilion on clouds; the framed site inside, a gold handover key.
  "work-firebase-medical": {
    mood: "pearl",
    accent: "#a8d8e8",
    glows: [[0.68, 0.4, 0.42, "#cfe9ff", 0.7], [0.82, 0.75, 0.3, "#c6efe2", 0.5], [0.22, 0.25, 0.4, "#e2ecff", 0.5]],
    floor: -1.8,
    floorOptions: { strength: 0.3, ripple: 0 },
    view: { target: [0, 0.4, 0], distance: 10, elevation: 9, size: 5.2 },
    build(ctx, K) {
      const { THREE } = K;
      const pav = new THREE.Group();
      pav.add(at(mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.1, 96), lux(K, "#cfe9f2", 0.08, { thickness: 0.2 })), 0, -0.9, 0));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        pav.add(at(mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 24), K.glass({ tint: "#b9e3ee", thickness: 0.2 })), Math.cos(a) * 1.55, 0.2, Math.sin(a) * 1.55));
      }
      const roof = mesh(new THREE.CylinderGeometry(1.85, 1.85, 0.08, 96), lux(K, "#d8f0f6", 0.06, { thickness: 0.2 }));
      roof.position.y = 1.32;
      const rim = K.ring(1.85, 0.016);
      rim.position.y = 1.36;
      pav.add(roof, rim);
      const site = framed(ctx, K, "media/portfolio/firebase-medical.webp", 1.278, 1.7);
      site.position.set(0, 0.2, 0.3);
      pav.add(site);
      ctx.root.add(pav);
      for (const [x, y, z, s] of [[-2.0, -1.2, 0.8, 1.6], [1.9, -1.25, 0.9, 1.8], [0.2, -1.35, 1.7, 1.4], [-1.4, -1.3, -1.2, 1.5]]) {
        const c = S.cloud({ mat: cloudMat(K) });
        c.scale.setScalar(s);
        c.position.set(x, y, z);
        ctx.root.add(c);
      }
      const key = new THREE.Group();
      key.add(mesh(new THREE.TorusGeometry(0.16, 0.04, 16, 48), K.gold()));
      key.add(at(mesh(new THREE.BoxGeometry(0.62, 0.06, 0.06), K.gold()), 0.46, 0, 0));
      key.add(at(mesh(new THREE.BoxGeometry(0.06, 0.14, 0.06), K.gold()), 0.68, -0.08, 0));
      key.add(at(mesh(new THREE.BoxGeometry(0.06, 0.1, 0.06), K.gold()), 0.56, -0.06, 0));
      key.position.set(1.9, 0.9, 0.9);
      key.rotation.set(0.3, -0.5, 0.5);
      ctx.root.add(key);
      K.float(ctx, key, { amp: 0.06, period: 7, spin: 0.3 });
      rib(ctx, K, [[-6, 1.8, -2], [-3, 1.6, -0.4], [-1.9, 1.0, 0.8], [-1.2, -0.2, 1.8], [0.6, -0.6, 2.0], [2.0, 0.2, 1.4], [2.8, 1.4, 0.4], [5.5, 2.6, -1.4]], { width: 0.14, twist: Math.PI * 1.6, dust: 70 });
    },
  },

  // 09 保険会社LP・フォーム — input, confirm and complete sheets aligned along a gold path.
  "work-insurance-lp": {
    mood: "midnight",
    accent: "#9ec3ff",
    accentStrength: 0.45,
    floor: -1.7,
    view: { target: [0, 0.4, 0], distance: 10, elevation: 6, size: 5.6 },
    build(ctx, K) {
      const sheets = [
        ["入力", 3, true, [-1.9, 0.0, 0.6]],
        ["確認", 3, true, [0, 0.45, 0]],
        ["完了", 0, false, [1.9, 0.9, -0.6]],
      ].map(([title, rows, button, pos], i) => {
        const p = K.uiPanel(formCard(K, { title, rows, button }), 1.45, 1.9, { tint: "#d7e4ff" });
        solidFaces(p);
        p.position.set(...pos);
        p.rotation.set(-0.06, -0.38, 0.02);
        ctx.root.add(p);
        K.float(ctx, p, { amp: 0.05, period: 8 + i, phase: i * 1.2 });
        return p;
      });
      const ok = S.check({ size: 0.8, tube: 0.05 });
      ok.position.set(0, -0.05, 0.12);
      sheets[2].add(ok);
      light(ctx, K, 2.6, "#7fa8ea", 0.42, 0, 0.5, -1.8);
      rib(ctx, K, [[-6, -1.4, 1.4], [-3.2, -1.2, 1.4], [-1.9, -1.0, 0.9], [-0.9, -0.6, 0.6], [0, -0.55, 0.4], [1.0, -0.2, 0], [1.9, -0.1, -0.3], [3.2, 0.8, -0.8], [6, 1.8, -2]], { width: 0.2, twist: Math.PI * 1.8 });
    },
  },

  // 10 SVG暗号化・復号 — a faceted glass vector flower held in gold lock rings; a local loop around its base.
  "work-inkscape-svg": {
    mood: "midnight",
    accent: "#8a7bff",
    accentStrength: 0.65,
    floor: -1.8,
    view: { target: [0, 0.5, 0], distance: 10, elevation: 7, size: 5 },
    build(ctx, K) {
      const f = S.flower({ n: 7, tint: "#c2b4ff" });
      f.scale.setScalar(2.6);
      f.position.set(0, 0.7, 0);
      f.rotation.x = -0.25;
      ctx.root.add(f);
      K.float(ctx, f, { amp: 0.05, period: 9 });
      light(ctx, K, 2.2, "#8f7bff", 0.6, 0, 0.7, -1.2);
      for (const [rx, ry] of [[0.3, 0.5], [-0.25, -0.6]]) {
        const r = K.ring(1.75, 0.022);
        r.rotation.set(Math.PI / 2 + rx, ry, 0);
        r.position.y = 0.7;
        ctx.root.add(r);
      }
      const l = S.lock();
      l.scale.setScalar(0.9);
      l.position.set(1.55, -0.35, 0.9);
      l.rotation.y = -0.35;
      ctx.root.add(l);
      const p = K.plinth(1.3, 0.12, { steps: 1 });
      p.position.y = -1.0;
      ctx.root.add(p);
      const pts = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push([Math.cos(a) * 1.75, -0.86 + Math.sin(a * 3) * 0.06, Math.sin(a) * 1.0]);
      }
      rib(ctx, K, pts, { width: 0.12, twist: Math.PI * 2, closed: true, dust: 100 });
    },
  },

  // 11 Web脆弱性診断 — a lens over abstract code, in front of a crystal shield (no results shown).
  "work-vulnerability-assessment": {
    mood: "midnight",
    accent: "#8fb8ff",
    floor: -1.9,
    view: { target: [0, 0.5, 0], distance: 10, elevation: 6, size: 5 },
    build(ctx, K) {
      const { THREE } = K;
      const sh = mesh(K.extrude(S.shapes.SHIELD, { size: 4.0, depth: 0.24, bevel: 0.07 }), lux(K, "#b4c9ff", 0.08, { thickness: 0.6 }));
      sh.position.set(0.3, 0.6, -1.4);
      ctx.root.add(sh);
      light(ctx, K, 2.6, "#5f86e6", 0.5, 0.3, 0.6, -2);
      const code = mesh(new THREE.PlaneGeometry(2.6, 1.7), new THREE.MeshBasicMaterial({ map: K.uiTexture(codeLines(K), 620, 400), alphaTest: 0.4 }));
      code.position.set(0, 0.5, -0.6);
      code.rotation.y = -0.15;
      ctx.root.add(code);
      const lens = S.magnifier();
      lens.scale.setScalar(2.0);
      lens.position.set(-0.2, 0.75, 0.6);
      lens.rotation.set(0.05, -0.25, 0);
      ctx.root.add(lens);
      K.float(ctx, lens, { amp: 0.06, period: 8 });
      rib(ctx, K, [[-6, -1.6, 1.2], [-3, -1.3, 1.4], [-1.2, -1.0, 1.2], [0.6, -0.9, 0.9], [2.0, -0.3, 0.4], [3, 1.0, -0.4], [6, 2.0, -1.6]], { width: 0.16, twist: Math.PI * 1.5 });
    },
  },

  // 12 受発注システム・連携 — menu cards joined to a system core by a gold orbit; request, agreement and
  // recurring service as three abstract glass nodes (no text, no brand).
  "work-order-system": {
    mood: "midnight",
    accent: "#8fe3b8",
    floor: -1.8,
    view: { target: [0, 0.4, 0], distance: 10, elevation: 8, size: 5.6 },
    build(ctx, K) {
      const { THREE } = K;
      const card = (hue) => (g, W, H) => {
        K.paint.bg(g, W, H, "rgba(255,255,255,.85)", "rgba(225,245,235,.7)");
        g.fillStyle = hue;
        g.beginPath();
        g.arc(W * 0.2, H * 0.5, H * 0.24, 0, Math.PI * 2);
        g.fill();
        K.paint.lines(g, W * 0.4, H * 0.32, [W * 0.46, W * 0.32], { gap: H * 0.24, height: H * 0.1, color: "rgba(30,70,60,.4)" });
      };
      ["#7fcfa8", "#c9a24a", "#8fb8e6"].forEach((hue, i) => {
        const p = K.uiPanel(card(hue), 1.5, 0.62, { tint: "#d4f2e4" });
        solidFaces(p);
        p.position.set(-1.8, 1.25 - i * 0.82, 0.3 + i * 0.15);
        p.rotation.y = 0.3;
        ctx.root.add(p);
        K.float(ctx, p, { amp: 0.04, period: 8 + i, phase: i });
      });
      const core = S.orb({ r: 0.55, tint: "#c6f0dc", core: "#ffe0a0" });
      core.position.set(1.4, 0.4, -0.2);
      ctx.root.add(core);
      light(ctx, K, 1.8, "#6fd6a8", 0.45, 1.4, 0.4, -1);
      const orbit = K.ring(1.25, 0.014);
      orbit.rotation.set(1.25, 0, 0.2);
      orbit.position.copy(core.position);
      ctx.root.add(orbit);
      // request (sheet), agreement (two linked rings), recurring (open loop with an arrowhead)
      const req = S.documentSheet({ w: 0.36, h: 0.46, tint: "#d4f2e4" });
      solidFaces(req);
      const agree = new THREE.Group();
      agree.add(at(K.ring(0.16, 0.02), -0.09, 0, 0), at(K.ring(0.16, 0.02), 0.09, 0, 0));
      agree.children.forEach((r) => (r.rotation.x = 0));
      const recur = new THREE.Group();
      recur.add(mesh(new THREE.TorusGeometry(0.18, 0.025, 12, 48, Math.PI * 1.6), K.gold()));
      recur.add(at(mesh(new THREE.ConeGeometry(0.06, 0.12, 16), K.gold()), 0.18, -0.02, 0));
      [req, agree, recur].forEach((n, i) => {
        const a = -0.6 + i * 1.6;
        n.scale.setScalar(1.6);
        n.position.set(1.4 + Math.cos(a) * 1.25, 0.4 + Math.sin(a) * 0.5, -0.2 + Math.sin(a) * 0.35);
        ctx.root.add(n);
        K.float(ctx, n, { amp: 0.05, period: 7 + i, phase: i * 2 });
      });
      rib(ctx, K, [[-6, -1.3, 1], [-3.2, -1.0, 1.2], [-1.0, -0.55, 0.9], [0.2, -0.2, 0.6], [1.0, 0.1, 0.4], [1.9, 0.6, 0.5], [3.2, 1.6, -0.4], [6, 2.4, -1.8]], { width: 0.2, twist: Math.PI * 1.8 });
    },
  },

  // 13 WordPress UIデザイン — UI canvases aligned along a flowing ribbon, one of them the real cover (ivory, pink).
  "work-wordpress-ui-design": {
    mood: "pearl",
    accent: "#f4c9d6",
    glows: [[0.68, 0.45, 0.42, "#f8d6e0", 0.6], [0.85, 0.75, 0.3, "#ffe7c4", 0.45], [0.22, 0.25, 0.4, "#ece4f6", 0.5]],
    floor: -1.7,
    floorOptions: { strength: 0.3, ripple: 0 },
    view: { target: [0, 0.5, 0], distance: 10, elevation: 6, size: 5.6 },
    build(ctx, K) {
      const path = K.curve([[-3.0, -1.3, 1.0], [-1.7, -0.6, 1.1], [-0.5, 0.1, 0.3], [0.6, 0.3, -0.5], [1.8, 0.9, -0.2], [2.9, 1.7, -0.9]]);
      for (let i = 0; i < 7; i++) {
        const t = 0.04 + (i / 6) * 0.92;
        const p = path.getPointAt(t);
        const tan = path.getTangentAt(t);
        const ui = i === 3 ? framed(ctx, K, "media/portfolio/wordpress-ui-design.webp", 1.278, 2.1) : S.browser({ w: 1.5 - Math.abs(i - 3) * 0.12, h: 0.98 - Math.abs(i - 3) * 0.08, tint: "#f6d8e2" });
        if (i !== 3) solidFaces(ui);
        ui.position.copy(p).add(K.V(0, 0.75, i === 3 ? 0.3 : 0));
        ui.rotation.y = -Math.atan2(tan.z, tan.x) * 0.5;
        ctx.root.add(ui);
        K.float(ctx, ui, { amp: 0.04, period: 8 + i * 0.4, phase: i });
      }
      rib(ctx, K, path.getSpacedPoints(20).map((p) => [p.x, p.y - 0.15, p.z + 0.2]), { width: 0.3, twist: Math.PI * 2.2, dust: 70 });
    },
  },

  // 14 情報登録フォーム — three separate glass layers: revised fields, an independent collection form, a browsing list.
  "work-portal-form": {
    mood: "midnight",
    accent: "#7fd1ae",
    floor: -1.8,
    view: { target: [0, 0.4, 0], distance: 10, elevation: 7, size: 5.4 },
    build(ctx, K) {
      const list = (g, W, H) => {
        K.paint.bg(g, W, H, "rgba(255,255,255,.85)", "rgba(222,244,234,.7)");
        for (let i = 0; i < 6; i++) {
          g.fillStyle = i % 2 ? "rgba(127,209,174,.18)" : "rgba(255,255,255,.6)";
          g.fillRect(W * 0.06, H * (0.1 + i * 0.13), W * 0.88, H * 0.11);
          K.paint.lines(g, W * 0.1, H * (0.14 + i * 0.13), [W * 0.3, W * 0.2], { gap: 0, height: H * 0.03, color: "rgba(30,70,60,.4)" });
        }
      };
      const layers = [
        [formCard(K, { rows: 4, button: false, accent: "#7fd1ae" }), [-1.6, 0.2, 0.7]],
        [formCard(K, { rows: 3, button: true, accent: "#7fd1ae" }), [0, 0.55, 0]],
        [list, [1.6, 0.9, -0.7]],
      ];
      layers.forEach(([draw, pos], i) => {
        const p = K.uiPanel(draw, 1.5, 1.95, { tint: "#cdeee0" });
        solidFaces(p);
        p.position.set(...pos);
        p.rotation.set(-0.05, -0.35, 0);
        ctx.root.add(p);
        K.float(ctx, p, { amp: 0.05, period: 8 + i, phase: i * 1.4 });
      });
      light(ctx, K, 2.5, "#5fc89a", 0.4, 0, 0.5, -1.8);
      rib(ctx, K, [[-6, -1.5, 1.4], [-3, -1.3, 1.6], [-1.4, -1.0, 1.3], [0.2, -0.7, 0.8], [1.6, -0.2, 0.3], [2.6, 1.0, -0.4], [6, 2.2, -1.8]], { width: 0.2, twist: Math.PI * 1.8 });
    },
  },

  // 15 Webシステム開発 — a complex gold lattice resolving around one polished glass core with gold seams.
  "work-web-system": {
    mood: "midnight",
    accent: "#f0d9a8",
    accentStrength: 0.4,
    floor: -2.0,
    view: { target: [0, 0.4, 0], distance: 10, elevation: 6, size: 4.8 },
    build(ctx, K) {
      const { THREE } = K;
      const lattice = new THREE.Group();
      const ico = new THREE.IcosahedronGeometry(1.9, 1);
      lattice.add(goldEdges(K, ico, 0.01));
      const v = ico.attributes.position;
      const seen = new Set();
      for (let i = 0; i < v.count; i++) {
        const key = [v.getX(i), v.getY(i), v.getZ(i)].map((n) => n.toFixed(2)).join();
        if (seen.has(key)) continue;
        seen.add(key);
        lattice.add(at(mesh(new THREE.SphereGeometry(0.06, 16, 12), K.glow("#ffe3a8", 1.6)), v.getX(i), v.getY(i), v.getZ(i)));
      }
      lattice.position.y = 0.4;
      lattice.rotation.set(0.3, 0.4, 0);
      ctx.root.add(lattice);
      ctx.anim.push((t) => (lattice.rotation.y = 0.4 + t * 0.03));
      const core = mesh(new THREE.SphereGeometry(0.95, 96, 64), lux(K, "#e8dcc0", 0.14, { thickness: 1.6, dispersion: 5 }));
      core.position.y = 0.4;
      ctx.root.add(core);
      for (const [rx, rz] of [[Math.PI / 2, 0], [0.2, 0.3], [1.1, -0.9]]) {
        const seam = K.ring(0.96, 0.012);
        seam.rotation.set(rx, 0, rz);
        seam.position.y = 0.4;
        ctx.root.add(seam);
      }
      light(ctx, K, 2.2, "#e6c483", 0.4, 0, 0.4, -1.4);
      rib(ctx, K, [[-6, -1.6, 1.2], [-3, -1.4, 1.5], [-1.2, -1.2, 1.4], [0.8, -1.0, 1.0], [2.2, -0.4, 0.4], [3.2, 1.0, -0.4], [6, 2.0, -1.6]], { width: 0.18, twist: Math.PI * 1.5 });
    },
  },

  // 16 継続開発・改修 — four linked gold orbit rings, each threading a different glass object (four jobs, one client).
  "work-repeat-client": {
    mood: "midnight",
    accent: "#3f6fd8",
    accentStrength: 0.6,
    floor: -1.8,
    view: { target: [0, 0.5, 0], distance: 10, elevation: 7, size: 5.8 },
    build(ctx, K) {
      const { THREE } = K;
      const panel = (draw, w, h, tint) => {
        const p = K.uiPanel(draw, w, h, { tint });
        solidFaces(p);
        return p;
      };
      const admin = (g, W, H) => {
        K.paint.bg(g, W, H, "rgba(255,255,255,.85)", "rgba(220,232,252,.7)");
        g.fillStyle = "rgba(63,111,216,.25)";
        g.fillRect(0, 0, W * 0.24, H);
        K.paint.lines(g, W * 0.32, H * 0.15, [W * 0.5, W * 0.4, W * 0.56, W * 0.3, W * 0.46], { gap: H * 0.15, height: H * 0.05 });
      };
      const objects = [panel(admin, 1.2, 0.84, "#d6e2ff"), S.browser({ w: 1.2, h: 0.8, tint: "#d6e2ff" }), server(K, 4, 0.8), panel(codeLines(K), 1.15, 0.82, "#c4d4ff")];
      solidFaces(objects[1]);
      objects.forEach((o, i) => {
        const x = -2.1 + i * 1.4;
        const y = -0.5 + i * 0.55;
        const z = 0.4 - i * 0.45;
        if (i === 2) o.position.set(x, y - 0.36, z);
        else o.position.set(x, y, z);
        ctx.root.add(o);
        const r = K.ring(0.98, 0.02);
        r.rotation.set(Math.PI / 2 + (i % 2 ? 0.6 : -0.6), 0, i % 2 ? 0.3 : -0.3);
        r.position.set(x, y, z);
        ctx.root.add(r);
        K.float(ctx, o, { amp: 0.04, period: 8 + i, phase: i * 1.5 });
      });
      light(ctx, K, 2.8, "#4f7fe6", 0.45, 0, 0.6, -2);
      rib(ctx, K, [[-6, -1.6, 1.4], [-3.4, -1.2, 1.2], [-2.1, -0.5, 0.4], [-0.7, 0.05, -0.05], [0.7, 0.6, -0.5], [2.1, 1.15, -0.95], [3.4, 1.9, -1.4], [6, 2.6, -2.4]], { width: 0.1, twist: Math.PI * 1.2 });
    },
  },
};
