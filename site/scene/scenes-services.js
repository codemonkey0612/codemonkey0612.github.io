// Hero sculptures of the eight service pages (/services/<id>/). Each has its own object and
// accent; the structure (midnight, gold ribbon, glass) stays shared. See scenes-main.js.
import * as S from "./symbols.js";

const { at, mesh } = S;

/** A gold ribbon through `pts` with dust; the first one in a scene carries the scroll glint. */
function rib(ctx, K, pts, { width = 0.3, twist = Math.PI * 2, glint = true, dust = 110, seed = 1 } = {}) {
  const geo = K.ribbon(K.curve(pts), { width, twist });
  ctx.root.add(new K.THREE.Mesh(geo, K.gold({}, glint ? ctx.u.progress : null)));
  if (dust) ctx.root.add(K.sparkles(geo.userData.points, dust, width * 1.6, { seed }));
  return geo;
}

/** Glass that holds a little light of its own, so it reads against the night sky. */
const lux = (K, tint, k = 0.16, o = {}) => K.glass({ tint, emissive: K.C(tint), emissiveIntensity: k, attenuationDistance: 6, ...o });

/** Soft white cloud (frosted, faintly lit). */
const cloudMat = (K) => new K.THREE.MeshPhysicalMaterial({ color: "#eef3ff", roughness: 0.55, sheen: 0.6, sheenColor: K.C("#ffffff"), emissive: K.C("#9fb6e6"), emissiveIntensity: 0.22, envMapIntensity: 0.9 });

/** Make drawn faces opaque (alpha-tested) so they show through transmissive glass. */
const solidFaces = (obj) =>
  obj.traverse((m) => {
    if (m.material?.map && m.material.isMeshBasicMaterial) {
      Object.assign(m.material, { transparent: false, alphaTest: 0.4, toneMapped: true });
      m.material.color.setScalar(0.86);
    }
  });

/** Soft light behind glass so it reads against the sky. */
const light = (ctx, K, r, color, opacity, x, y, z) => {
  const h = K.halo(r, color, opacity);
  h.position.set(x, y, z);
  ctx.root.add(h);
  return h;
};

/** Placeholder lines on a dark "code" card (never real code or results). */
const codeLines = (K) => (g, W, H) => {
  K.paint.bg(g, W, H, "rgba(18,32,64,.78)", "rgba(30,52,96,.6)");
  const r = K.rng(11);
  for (let i = 0; i < 11; i++) {
    const indent = [0, 1, 1, 2, 2, 1, 0, 1, 2, 1, 0][i] * 26;
    g.fillStyle = ["rgba(158,195,255,.75)", "rgba(201,162,74,.85)", "rgba(220,230,255,.5)"][i % 3];
    g.beginPath();
    g.roundRect(30 + indent, 26 + i * (H - 50) / 11, 60 + r() * (W - 160 - indent), 7, 4);
    g.fill();
  }
};

export default {
  // AI APPS — a levitating glass loom (torus knot) weaving document sheets into a gold stream.
  "svc-ai-apps": {
    mood: "midnight",
    accent: "#b9a2ff",
    accentStrength: 0.6,
    floor: -2.0,
    view: { target: [0, 0.4, 0], distance: 10, elevation: 6, size: 5.6 },
    build(ctx, K) {
      const { THREE } = K;
      const knot = mesh(new THREE.TorusKnotGeometry(1.0, 0.24, 320, 40, 2, 3), lux(K, "#cdb9ff", 0.2, { thickness: 0.9, dispersion: 6 }));
      knot.position.set(0.5, 0.5, 0);
      knot.rotation.set(0.4, 0.3, 0);
      ctx.root.add(knot);
      K.float(ctx, knot, { amp: 0.06, period: 8, spin: 0.15 });
      light(ctx, K, 2.2, "#9b86ff", 0.5, 0.5, 0.5, -1.4);
      // Sheets glide in from the left, turning as they approach the core.
      [[-3.3, 1.6, -0.6, 0.6], [-2.6, 0.7, 0.3, 0.35], [-2.0, 1.9, 0.9, 0.2], [-1.4, 0.05, 0.6, 0.1]].forEach(([x, y, z, ry], i) => {
        const d = S.documentSheet({ w: 0.62, h: 0.82, tint: "#e2d8ff" });
        d.position.set(x, y, z);
        d.rotation.set(0.1 * i - 0.1, ry, 0.25 - i * 0.12);
        ctx.root.add(d);
        K.float(ctx, d, { amp: 0.05, period: 7 + i, phase: i });
      });
      rib(ctx, K, [[-1.6, 1.2, 0.2], [-0.4, 0.9, 0.6], [0.5, 0.5, 0.3], [1.5, 0.1, 0.2], [2.6, -0.5, 0.6], [4.2, -0.8, 0], [7, -1.2, -1]], { width: 0.26, twist: Math.PI * 2.4 });
    },
  },

  // AI CHATBOT — two glass speech sculptures linked by a gold filament to a library of documents.
  "svc-ai-chatbot": {
    mood: "midnight",
    accent: "#9ec3ff",
    floor: -1.9,
    view: { target: [0, 0.5, 0], distance: 10, elevation: 7, size: 5.4 },
    build(ctx, K) {
      const { THREE } = K;
      const a = S.speech({ mat: lux(K, "#bcd6ff", 0.14, { thickness: 0.9 }) });
      a.scale.setScalar(1.7);
      a.position.set(-1.1, 1.5, 0);
      a.rotation.y = 0.35;
      const b = S.speech({ mat: lux(K, "#d7e6ff", 0.14, { thickness: 0.9 }) });
      b.scale.set(-1.3, 1.3, 1.3);
      b.position.set(1.3, 0.9, -0.4);
      b.rotation.y = -0.3;
      ctx.root.add(a, b);
      K.float(ctx, a, { amp: 0.06, period: 8 });
      K.float(ctx, b, { amp: 0.06, period: 9, phase: 2 });
      light(ctx, K, 2.6, "#7fa8ea", 0.5, 0, 1.0, -1.6);
      // The library: glass volumes standing on a pearl plinth.
      const p = K.plinth(1.3, 0.14);
      p.position.set(0.1, -1.0, 0.6);
      ctx.root.add(p);
      for (let i = 0; i < 9; i++) {
        const h = 0.55 + ((i * 37) % 5) * 0.08;
        const book = mesh(new THREE.BoxGeometry(0.16, h, 0.62), i % 3 ? K.pearl() : lux(K, "#d6e4ff", 0.1, { thickness: 0.3 }));
        book.position.set(-0.75 + i * 0.19, -1.0 + h / 2, 0.6);
        book.rotation.z = i === 8 ? -0.18 : 0;
        ctx.root.add(book);
      }
      rib(ctx, K, [[0.1, -0.35, 0.6], [-0.8, 0.3, 0.5], [-1.1, 1.1, 0.3], [0.1, 1.4, 0.1], [1.2, 0.7, -0.2], [2.6, 1.6, -0.6], [5, 2.6, -1.4]], { width: 0.08, twist: Math.PI, dust: 90 });
    },
  },

  // AI CONSULTING — a floating gold compass above a sculptural glass roadmap (amber sunrise).
  "svc-ai-consulting": {
    mood: "midnight",
    accent: "#ffbf73",
    accentStrength: 0.5,
    glows: [[0.7, 0.62, 0.42, "#ffbf73", 0.5], [0.72, 0.85, 0.3, "#ff9c5a", 0.25], [0.18, 0.18, 0.3, "#1d3b66", 0.4]],
    floor: -1.8,
    view: { target: [0, 0.6, 0], distance: 10, elevation: 9, size: 5.6 },
    build(ctx, K) {
      const { THREE } = K;
      const c = S.compass();
      c.scale.setScalar(1.7);
      c.position.set(-0.5, 1.3, 0.6);
      c.rotation.set(-0.35, 0.3, 0);
      ctx.root.add(c);
      K.float(ctx, c, { amp: 0.06, period: 8 });
      ctx.anim.push((t) => (c.userData.needle.rotation.z = Math.sin(t * 0.4) * 0.12));
      light(ctx, K, 1.8, "#ffc27a", 0.45, -0.6, 1.7, -0.6);
      // The roadmap: glass steps rising along a curve into the distance.
      const path = K.curve([[-2.4, -1.1, 0.6], [-1.0, -0.85, 0.3], [0.4, -0.5, -0.3], [1.4, -0.1, -1.3], [2.0, 0.4, -2.6], [2.2, 0.9, -4.0]]);
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const p = path.getPointAt(t);
        const step = mesh(new THREE.BoxGeometry(0.95 - t * 0.3, 0.1, 0.55 - t * 0.15), lux(K, "#ffd7a6", 0.22, { thickness: 0.3 }));
        step.position.copy(p);
        step.lookAt(path.getPointAt(Math.min(1, t + 0.05)).setY(p.y));
        ctx.root.add(step);
      }
      rib(ctx, K, path.getSpacedPoints(16).map((p) => [p.x - 0.45, p.y + 0.12, p.z + 0.25]), { width: 0.12, twist: Math.PI * 0.8, dust: 80 });
    },
  },

  // AI CLOUD — pearl server architecture on clouds, inside a glass shield, with a gold network.
  "svc-ai-infra": {
    mood: "midnight",
    accent: "#7fb2ff",
    floor: -2.1,
    view: { target: [0, 0.4, 0], distance: 10, elevation: 7, size: 5.6 },
    build(ctx, K) {
      const { THREE } = K;
      const sh = mesh(K.extrude(S.shapes.SHIELD, { size: 4.2, depth: 0.16, bevel: 0.05 }), K.glass({ tint: "#bcd3ff", thickness: 0.5, iridescence: 0.6 }));
      sh.position.set(0, 0.8, -1.3);
      ctx.root.add(sh);
      light(ctx, K, 2.8, "#6f9be0", 0.5, 0, 0.8, -1.9);
      const base = K.plinth(1.5, 0.12, { steps: 1 });
      base.position.y = -0.5;
      ctx.root.add(base);
      [-0.75, 0, 0.75].forEach((x, i) => {
        const h = [1.5, 1.9, 1.3][i];
        const rack = mesh(K.extrudeRect(0.55, h, 0.04, 0.5), K.pearl());
        rack.position.set(x, -0.5 + h / 2, 0);
        ctx.root.add(rack);
        for (let k = 0; k < Math.floor(h / 0.22); k++) {
          const slit = mesh(new THREE.PlaneGeometry(0.38, 0.03), K.glow(k % 3 ? "#9ec3ff" : "#ffd08a", 1.6));
          slit.position.set(x, -0.38 + k * 0.22, 0.29);
          ctx.root.add(slit);
        }
      });
      for (const [x, y, z, s] of [[-1.8, -0.75, 0.6, 1.4], [1.6, -0.85, 0.8, 1.6], [0.2, -1.0, 1.4, 1.2]]) {
        const c = S.cloud({ mat: cloudMat(K) });
        c.scale.setScalar(s);
        c.position.set(x, y, z);
        ctx.root.add(c);
      }
      const net = K.ring(2.2, 0.012);
      net.rotation.set(1.3, 0, 0.1);
      net.position.y = 0.3;
      ctx.root.add(net);
      rib(ctx, K, [[-6, 2.6, -2], [-3, 2.2, -0.4], [-1.2, 1.7, 0.6], [0.6, 1.9, 0.7], [2.2, 1.4, 0.2], [3.6, 0.4, -0.4], [6, -0.4, -1.5]], { width: 0.14, twist: Math.PI * 1.5 });
    },
  },

  // WORDPRESS — browser portals (desktop, tablet, phone) aligned inside a pearl arch gallery, jade light.
  "svc-wordpress": {
    mood: "midnight",
    accent: "#7fd3b4",
    accentStrength: 0.45,
    floor: -1.7,
    view: { target: [0, 0.5, 0], distance: 10, elevation: 6, size: 5.6 },
    build(ctx, K) {
      const a = S.arch({ mat: K.pearl(), depth: 0.4 });
      a.scale.setScalar(3.6);
      a.position.set(0, 0.1, -1.4);
      ctx.root.add(a);
      light(ctx, K, 2.4, "#86e0c0", 0.4, 0, 0.6, -1.8);
      const desk = S.browser({ w: 2.3, h: 1.45, tint: "#cfeee2" });
      desk.position.set(-0.15, 0.55, 0);
      const tab = S.browser({ w: 0.95, h: 1.25, tint: "#d6f1e6" });
      tab.position.set(1.45, 0.2, 0.55);
      tab.rotation.y = -0.3;
      const ph = S.browser({ w: 0.5, h: 0.92, tint: "#d6f1e6" });
      ph.position.set(-1.55, 0.0, 0.7);
      ph.rotation.y = 0.32;
      ctx.root.add(desk, tab, ph);
      [desk, tab, ph].forEach((o, i) => K.float(ctx, o, { amp: 0.05, period: 8 + i, phase: i * 1.7 }));
      const p = K.plinth(2.4, 0.12, { steps: 2 });
      p.position.y = -1.0;
      ctx.root.add(p);
      rib(ctx, K, [[-6, -1.2, 1.2], [-3, -0.9, 1.4], [-1.2, -0.6, 1.1], [0.6, -0.3, 1.0], [2.2, 0.4, 0.6], [3.4, 1.6, -0.2], [6, 2.6, -1.4]], { width: 0.22, twist: Math.PI * 2 });
    },
  },

  // SHOPIFY — a sculptural glass shopping bag and products on glass plinths, champagne-pink light.
  "svc-shopify": {
    mood: "midnight",
    accent: "#f2b8c9",
    accentStrength: 0.6,
    glows: [[0.7, 0.55, 0.45, "#f2b8c9", 0.55], [0.6, 0.85, 0.3, "#ffcf9a", 0.25], [0.18, 0.18, 0.3, "#3a2a4f", 0.45]],
    floor: -1.7,
    floorOptions: { ripple: 0 },
    view: { target: [0, 0.4, 0], distance: 10, elevation: 7, size: 5.4 },
    build(ctx, K) {
      const { THREE } = K;
      const bag = S.bag({ mat: new THREE.MeshPhysicalMaterial({ color: "#f3d3dd", roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.1, sheen: 0.5, sheenColor: K.C("#fff0f4"), emissive: K.C("#c98a9e"), emissiveIntensity: 0.12 }) });
      bag.scale.setScalar(2.1);
      bag.position.set(0.2, 0.55, 0);
      bag.rotation.y = -0.35;
      bag.add(at(mesh(new THREE.BoxGeometry(0.74, 0.025, 0.4), K.gold()), 0, 0.37, 0));
      ctx.root.add(bag);
      K.float(ctx, bag, { amp: 0.05, period: 8 });
      light(ctx, K, 2.2, "#ffb6c9", 0.45, 0.2, 0.6, -1.4);
      const exhibit = (x, z, r, h, piece) => {
        const p = mesh(new THREE.CylinderGeometry(r, r, h, 64), lux(K, "#f6dbe4", 0.12, { thickness: 0.6 }));
        p.position.set(x, -1.7 + h / 2, z);
        const rim = K.ring(r, 0.01);
        rim.position.set(x, -1.7 + h, z);
        ctx.root.add(p, rim);
        piece.position.set(x, -1.7 + h, z);
        ctx.root.add(piece);
      };
      const bottle = new THREE.Group();
      bottle.add(at(mesh(new THREE.BoxGeometry(0.42, 0.52, 0.22), K.glass({ tint: "#ffd9a8", thickness: 0.5 })), 0, 0.26, 0));
      bottle.add(at(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 32), K.gold()), 0, 0.6, 0));
      exhibit(-1.9, 0.6, 0.45, 0.9, bottle);
      exhibit(2.0, 0.5, 0.4, 0.6, at(mesh(new THREE.SphereGeometry(0.3, 48, 32), K.glass({ tint: "#f2c6d6", thickness: 0.8 })), 0, 0.3, 0));
      rib(ctx, K, [[-6, -1.0, 1.4], [-3.4, -0.6, 1.2], [-1.9, -0.3, 0.9], [-0.2, -0.9, 1.0], [2.0, -0.6, 0.9], [3.2, 0.4, 0.2], [6, 1.6, -1.2]], { width: 0.2, twist: Math.PI * 1.8 });
    },
  },

  // BUSINESS SYSTEMS — clear-glass dashboard layers and precise gears, joined by a gold ribbon (cyan).
  "svc-system": {
    mood: "midnight",
    accent: "#72d8ea",
    accentStrength: 0.5,
    floor: -1.9,
    view: { target: [0, 0.5, 0], distance: 10, elevation: 6, size: 5.6 },
    build(ctx, K) {
      const dash = (g, W, H) => {
        K.paint.bg(g, W, H, "rgba(225,245,255,.55)", "rgba(160,215,240,.3)");
        g.fillStyle = "rgba(20,60,90,.18)";
        g.fillRect(0, 0, W * 0.2, H);
        K.paint.lines(g, W * 0.03, H * 0.12, [W * 0.13, W * 0.1, W * 0.12, W * 0.09], { gap: H * 0.12, height: H * 0.035, color: "rgba(255,255,255,.7)" });
        for (let i = 0; i < 3; i++) {
          g.fillStyle = "rgba(255,255,255,.55)";
          g.beginPath();
          g.roundRect(W * (0.25 + i * 0.25), H * 0.1, W * 0.21, H * 0.26, 10);
          g.fill();
        }
        g.strokeStyle = "rgba(201,162,74,.9)";
        g.lineWidth = 4;
        g.beginPath();
        g.arc(W * 0.4, H * 0.68, H * 0.18, -Math.PI / 2, Math.PI * 0.9);
        g.stroke();
        K.paint.lines(g, W * 0.62, H * 0.5, [W * 0.3, W * 0.24, W * 0.28, W * 0.18], { gap: H * 0.1, height: H * 0.035, color: "rgba(30,70,100,.35)" });
      };
      [[0.2, 1.4, -1.0, 2.6], [-0.4, 0.6, 0.0, 2.3], [-1.0, -0.2, 1.0, 2.0]].forEach(([x, y, z, w], i) => {
        const p = K.uiPanel(dash, w, w * 0.6, { tint: "#bfeaf5" });
        solidFaces(p);
        p.position.set(x, y, z);
        p.rotation.set(-0.12, 0.42, 0.02);
        ctx.root.add(p);
        K.float(ctx, p, { amp: 0.04, period: 8 + i, phase: i });
      });
      light(ctx, K, 2.4, "#5ccbe0", 0.42, 0, 0.6, -2);
      const g = S.gears();
      g.scale.setScalar(2.1);
      g.position.set(1.9, -0.4, 0.4);
      g.rotation.y = -0.4;
      ctx.root.add(g);
      ctx.anim.push((t) => {
        g.userData.gears[0].rotation.z = t * 0.12;
        g.userData.gears[1].rotation.z = -t * 0.16;
      });
      rib(ctx, K, [[-6, -1.4, 1.2], [-3, -1.0, 1.4], [-1.4, -0.5, 1.2], [0.2, 0.2, 0.7], [1.6, 0.6, 0.5], [2.6, 1.6, 0], [4, 2.4, -0.8], [7, 2.8, -2]], { width: 0.26, twist: Math.PI * 2.2 });
    },
  },

  // QUALITY & SECURITY — a monumental optical shield around a floating code prism with a gold scan ring.
  "svc-quality": {
    mood: "midnight",
    accent: "#5f86ff",
    accentStrength: 0.6,
    floor: -2.0,
    view: { target: [0, 0.5, 0], distance: 10, elevation: 6, size: 5.2 },
    build(ctx, K) {
      const { THREE } = K;
      const sh = mesh(K.extrude(S.shapes.SHIELD, { size: 4.4, depth: 0.3, bevel: 0.08 }), K.glass({ tint: "#a9c1ff", thickness: 0.8, iridescence: 0.6 }));
      sh.position.set(0, 0.6, -1.2);
      ctx.root.add(sh);
      light(ctx, K, 2.8, "#4c74e6", 0.55, 0, 0.6, -1.8);
      const prism = mesh(new THREE.CylinderGeometry(0.66, 0.66, 2.2, 6), lux(K, "#c8d6ff", 0.1, { thickness: 0.6, dispersion: 6 }));
      prism.position.set(0, 0.55, 0.3);
      prism.rotation.y = 0.3;
      ctx.root.add(prism);
      const code = mesh(new THREE.PlaneGeometry(0.78, 1.6), new THREE.MeshBasicMaterial({ map: K.uiTexture(codeLines(K), 300, 620), alphaTest: 0.4, side: THREE.DoubleSide }));
      code.position.set(0, 0.55, 0.3);
      ctx.root.add(code);
      const scan = K.ring(1.15, 0.03);
      scan.position.set(0, 0.85, 0.3);
      scan.rotation.x = Math.PI / 2 - 0.12;
      ctx.root.add(scan);
      const band = mesh(new THREE.TorusGeometry(1.15, 0.12, 8, 128), new THREE.MeshBasicMaterial({ color: K.C("#ffd28a"), transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }));
      band.position.copy(scan.position);
      band.rotation.copy(scan.rotation);
      ctx.root.add(band);
      ctx.anim.push((t) => {
        const y = 0.55 + Math.sin(t * 0.35) * 0.8;
        scan.position.y = y;
        band.position.y = y;
      });
      K.float(ctx, prism, { amp: 0.04, period: 8 });
      rib(ctx, K, [[-6, -1.5, 1.0], [-3, -1.2, 1.3], [-1.2, -0.8, 1.2], [0.4, -0.6, 1.0], [1.8, -0.1, 0.6], [3, 1.2, -0.2], [6, 2.2, -1.4]], { width: 0.18, twist: Math.PI * 1.6 });
    },
  },
};
