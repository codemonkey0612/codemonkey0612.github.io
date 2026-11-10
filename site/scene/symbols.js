// Glass-and-gold symbols shared by the scenes. Each returns a THREE.Group about 1 unit
// across, centred on the origin and facing +z. Pass material overrides via opts.
import * as K from "./kit.js";

const { THREE, glass, frost, gold, pearl, extrude, glow } = K;
const mesh = (geo, mat) => new THREE.Mesh(geo, mat);
const group = (...xs) => {
  const g = new THREE.Group();
  for (const x of xs) g.add(x);
  return g;
};
const at = (obj, x = 0, y = 0, z = 0) => (obj.position.set(x, y, z), obj);

// 匠 (Noto Serif CJK JP Bold outline, in a 100-unit box, y down).
export const TAKUMI_PATH =
  "M72 17.4C66.2 20.8 55.9 25.1 46 28.1L32.9 23.6V43.4C32.9 55.5 32.2 69.5 24.1 80.7L25 81.9C41.2 72.4 43.6 57.2 43.9 45.9H58.8V81.7H60.8C66.6 81.7 70 79.4 70 78.9V45.9H89.1C90.6 45.9 91.6 45.4 91.9 44.3C87.6 40.7 80.7 35.5 80.7 35.5L74.5 43.1H43.9V31.4C56 31.1 69 29.7 77.5 27.7C80.5 28.7 82.6 28.5 83.7 27.5ZM9.4 11.7V97.1H11.6C17.7 97.1 21.4 94.5 21.4 93.8V89.5H94.2C95.7 89.5 96.8 89 97.1 87.9C92.3 83.8 84.4 78 84.4 78L77.5 86.7H21.4V14.5H91.4C92.8 14.5 93.9 14 94.2 12.9C89.7 9 82.1 3.3 82.1 3.3L75.5 11.7H22.7L9.4 6.2Z";

/** Sculptural gold 匠. */
export const takumi = ({ size = 1, depth = 0.16, mat = gold({ roughness: 0.18 }) } = {}) => group(mesh(extrude(TAKUMI_PATH, { size, depth, bevel: 0.012, segments: 4 }), mat));

const SHIELD = "M50 4 L88 18 C88 52 76 78 50 96 C24 78 12 52 12 18 Z";
const SPEECH = "M18 10 H82 C92 10 98 16 98 26 V58 C98 68 92 74 82 74 H46 L26 92 L30 74 H18 C8 74 2 68 2 58 V26 C2 16 8 10 18 10 Z";
const ARCH = "M0 100 V40 C0 14 22 0 50 0 C78 0 100 14 100 40 V100 H86 V42 C86 24 70 14 50 14 C30 14 14 24 14 42 V100 Z";
const LEAF = "M50 2 C80 20 92 52 70 80 C62 90 54 96 50 98 C46 96 38 90 30 80 C8 52 20 20 50 2 Z";
const PETAL = "M50 0 C70 18 74 52 50 100 C26 52 30 18 50 0 Z";
const STAR4 = "M50 0 L58 42 L100 50 L58 58 L50 100 L42 58 L0 50 L42 42 Z";
const BAG = "M14 26 H86 L94 98 H6 Z";
const DOC = "M8 0 H68 L92 24 V100 H8 Z";

export const shapes = { SHIELD, SPEECH, ARCH, LEAF, PETAL, STAR4, BAG, DOC };

/** Shield with a gold check (quality, security). */
export function shield({ mat = glass({ thickness: 0.8 }), checkMat = gold() } = {}) {
  const g = group(mesh(extrude(SHIELD, { size: 1, depth: 0.22, bevel: 0.05 }), mat));
  g.add(at(check({ mat: checkMat, size: 0.45 }), 0, 0.02, 0.16));
  return g;
}

/** A check mark as a gold tube. */
export function check({ size = 0.5, mat = gold(), tube = 0.035 } = {}) {
  const pts = [K.V(-0.5, 0.02, 0), K.V(-0.15, -0.32, 0), K.V(0.55, 0.42, 0)].map((p) => p.multiplyScalar(size));
  const path = new THREE.CurvePath();
  path.add(new THREE.LineCurve3(pts[0], pts[1]));
  path.add(new THREE.LineCurve3(pts[1], pts[2]));
  return group(mesh(new THREE.TubeGeometry(path, 32, tube, 10, false), mat));
}

/** Speech bubble with three gold dots (chat). */
export function speech({ mat = glass({ thickness: 0.8, tint: "#cfe2ff" }) } = {}) {
  const g = group(mesh(extrude(SPEECH, { size: 1, depth: 0.26, bevel: 0.06 }), mat));
  for (const x of [-0.2, 0, 0.2]) g.add(at(mesh(new THREE.SphereGeometry(0.055, 24, 16), gold()), x, 0.08, 0.2));
  return g;
}

/** Compass: gold rim, glass face, four-point star needle (consulting). */
export function compass() {
  const g = new THREE.Group();
  const rim = mesh(new THREE.TorusGeometry(0.5, 0.05, 24, 128), gold());
  const face = mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.06, 96), glass({ thickness: 0.3 }));
  face.rotation.x = Math.PI / 2;
  const back = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 96), pearl());
  back.rotation.x = Math.PI / 2;
  back.position.z = -0.06;
  const star = mesh(extrude(STAR4, { size: 0.82, depth: 0.04, bevel: 0.012 }), gold({ roughness: 0.15 }));
  star.position.z = 0.05;
  star.rotation.z = Math.PI / 4;
  const needle = mesh(extrude(STAR4, { size: 0.62, depth: 0.05, bevel: 0.012 }), gold({ color: "#f3d9a0" }));
  needle.position.z = 0.08;
  needle.scale.set(0.35, 1, 1);
  g.add(rim, back, face, star, needle);
  g.userData.needle = needle;
  return g;
}

/** Soft cloud of frosted spheres (cloud, infrastructure). */
export function cloud({ mat = frost({ tint: "#dfe9ff" }) } = {}) {
  const g = new THREE.Group();
  for (const [x, y, r] of [
    [-0.32, -0.05, 0.26],
    [-0.08, 0.1, 0.34],
    [0.24, 0.04, 0.3],
    [0.45, -0.08, 0.2],
    [0.05, -0.12, 0.26],
  ])
    g.add(at(mesh(new THREE.SphereGeometry(r, 48, 32), mat), x, y, 0));
  return g;
}

/** AI chip: glass block, gold pins and an engraved "AI" (AI apps). */
export function chip() {
  const g = new THREE.Group();
  g.add(mesh(K.extrudeRect(0.82, 0.82, 0.1, 0.18), glass({ thickness: 0.5, tint: "#e3d9ff" })));
  g.add(at(mesh(K.extrudeRect(0.5, 0.5, 0.05, 0.04), gold({ roughness: 0.3 })), 0, 0, 0.1));
  const A = new THREE.Shape([K.V(-0.5, -0.5), K.V(-0.1, 0.5), K.V(0.1, 0.5), K.V(0.5, -0.5), K.V(0.3, -0.5), K.V(0.18, -0.2), K.V(-0.18, -0.2), K.V(-0.3, -0.5)].map((v) => new THREE.Vector2(v.x, v.y)));
  A.holes.push(new THREE.Path([new THREE.Vector2(-0.1, 0), new THREE.Vector2(0, 0.28), new THREE.Vector2(0.1, 0)]));
  const I = new THREE.Shape([new THREE.Vector2(0.62, -0.5), new THREE.Vector2(0.82, -0.5), new THREE.Vector2(0.82, 0.5), new THREE.Vector2(0.62, 0.5)]);
  const letters = mesh(extrude([A, I], { size: 0.3, depth: 0.03, bevel: 0.006, segments: 2 }), glow("#fff3d6", 1.4));
  letters.position.z = 0.135;
  g.add(letters);
  for (let i = 0; i < 5; i++) {
    const o = -0.3 + i * 0.15;
    for (const [x, y, rx, ry] of [
      [o, 0.48, 0.04, 0.12],
      [o, -0.48, 0.04, 0.12],
      [0.48, o, 0.12, 0.04],
      [-0.48, o, 0.12, 0.04],
    ])
      g.add(at(mesh(new THREE.BoxGeometry(rx, ry, 0.04), gold()), x, y, 0));
  }
  return g;
}

/** Browser window: glass card with window dots and an abstract page (WordPress, portals). */
export function browser({ w = 1, h = 0.68, tint } = {}) {
  return K.uiPanel(
    (g, W, H) => {
      K.paint.bg(g, W, H, "rgba(255,255,255,.75)", "rgba(225,234,252,.5)");
      g.fillStyle = "rgba(15,30,55,.08)";
      g.fillRect(0, 0, W, H * 0.13);
      ["#e7b3a6", "#ecd29a", "#b8d8b5"].forEach((c, i) => {
        g.fillStyle = c;
        g.beginPath();
        g.arc(22 + i * 22, H * 0.065, 6, 0, Math.PI * 2);
        g.fill();
      });
      const sky = g.createLinearGradient(0, H * 0.18, 0, H * 0.62);
      sky.addColorStop(0, "#9ec3ff");
      sky.addColorStop(1, "#f4e2bf");
      g.fillStyle = sky;
      g.beginPath();
      g.roundRect(W * 0.06, H * 0.2, W * 0.88, H * 0.42, 10);
      g.fill();
      g.fillStyle = "rgba(60,80,120,.45)";
      g.beginPath();
      g.moveTo(W * 0.06, H * 0.62);
      g.lineTo(W * 0.32, H * 0.36);
      g.lineTo(W * 0.5, H * 0.52);
      g.lineTo(W * 0.66, H * 0.4);
      g.lineTo(W * 0.94, H * 0.62);
      g.fill();
      K.paint.lines(g, W * 0.06, H * 0.7, [W * 0.5, W * 0.36, W * 0.42], { gap: H * 0.08, height: H * 0.035 });
    },
    w,
    h,
    { tint },
  );
}

/** Shopping bag with a gold handle (Shopify, EC). */
export function bag({ mat = frost({ tint: "#f6dbe6" }) } = {}) {
  const g = group(mesh(extrude(BAG, { size: 1, depth: 0.36, bevel: 0.04 }), mat));
  const handle = mesh(new THREE.TorusGeometry(0.2, 0.025, 16, 64, Math.PI), gold());
  handle.position.set(0, 0.36, 0);
  g.add(handle);
  return g;
}

/** Gear outline as a shape. */
export function gearShape(teeth = 10, r = 1, depthTooth = 0.18, hole = 0.38) {
  const s = new THREE.Shape();
  const steps = teeth * 4;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = i % 4 < 2 ? r : r - depthTooth;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  const h = new THREE.Path();
  h.absarc(0, 0, hole, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
}

/** Two interlocking glass gears (business systems). */
export function gears() {
  const g = new THREE.Group();
  const a = mesh(extrude(gearShape(12), { size: 0.7, depth: 0.16, bevel: 0.025 }), glass({ thickness: 0.5 }));
  const b = mesh(extrude(gearShape(9), { size: 0.5, depth: 0.16, bevel: 0.025 }), glass({ thickness: 0.5, tint: "#cdeaf2" }));
  a.position.set(-0.18, 0.1, 0);
  b.position.set(0.36, -0.2, 0.05);
  const ax1 = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 32), gold());
  ax1.rotation.x = Math.PI / 2;
  ax1.position.copy(a.position);
  const ax2 = ax1.clone();
  ax2.position.copy(b.position);
  g.add(a, b, ax1, ax2);
  g.userData.gears = [a, b];
  return g;
}

/** Padlock: glass body, gold shackle (protection). */
export function lock() {
  const g = new THREE.Group();
  g.add(at(mesh(K.extrudeRect(0.7, 0.56, 0.08, 0.26), glass({ thickness: 0.6, tint: "#d9d0ff" })), 0, -0.18, 0));
  const shackle = mesh(new THREE.TorusGeometry(0.22, 0.05, 20, 64, Math.PI), gold());
  shackle.position.set(0, 0.12, 0);
  g.add(shackle);
  for (const x of [-0.22, 0.22]) g.add(at(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 24), gold()), x, 0.06, 0));
  g.add(at(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 24).rotateX(Math.PI / 2), gold()), 0, -0.16, 0.14));
  return g;
}

/** Magnifying lens: gold rim + handle, glass lens (inspection). */
export function magnifier() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.TorusGeometry(0.4, 0.045, 24, 128), gold()));
  const lens = mesh(new THREE.SphereGeometry(0.4, 64, 32), glass({ thickness: 0.6, dispersion: 6 }));
  lens.scale.set(1, 1, 0.16);
  g.add(lens);
  const handle = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 24), gold({ roughness: 0.3 }));
  handle.position.set(0.47, -0.47, 0);
  handle.rotation.z = Math.PI / 4;
  g.add(handle);
  return g;
}

/** Glass arch with a gold inner edge (gateways, portals). */
export function arch({ mat = glass({ thickness: 0.8 }), edge = true, depth = 0.2 } = {}) {
  const g = group(mesh(extrude(ARCH, { size: 1, depth, bevel: 0.03 }), mat));
  if (edge) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const a = Math.PI * (i / 64);
      pts.push(K.V(Math.cos(a) * 0.36, 0.1 + Math.sin(a) * 0.33, depth / 2 + 0.02));
    }
    const path = new THREE.CurvePath();
    path.add(new THREE.LineCurve3(K.V(0.36, -0.5, depth / 2 + 0.02), pts[0]));
    path.add(new THREE.CatmullRomCurve3(pts));
    path.add(new THREE.LineCurve3(pts[pts.length - 1], K.V(-0.36, -0.5, depth / 2 + 0.02)));
    g.add(mesh(new THREE.TubeGeometry(path, 160, 0.012, 8, false), gold()));
  }
  return g;
}

/** Leaf (glass, tinted) for gentle/green scenes. */
export const leaf = ({ tint = "#cfe8d2", size = 1 } = {}) => group(mesh(extrude(LEAF, { size, depth: 0.06, bevel: 0.02 }), glass({ tint, thickness: 0.3 })));

/** Faceted glass flower of n petals (vector / SVG). */
export function flower({ n = 6, tint = "#cbbcff" } = {}) {
  const g = new THREE.Group();
  const geo = extrude(PETAL, { size: 0.55, depth: 0.05, bevel: 0.02 });
  geo.translate(0, 0.27, 0);
  for (let i = 0; i < n; i++) {
    const p = mesh(geo, glass({ tint, thickness: 0.4, dispersion: 6 }));
    p.rotation.z = (i / n) * Math.PI * 2;
    p.rotation.x = 0.35;
    g.add(p);
  }
  g.add(mesh(new THREE.SphereGeometry(0.08, 32, 16), gold()));
  return g;
}

/** A document sheet with placeholder lines. */
export function documentSheet({ w = 0.72, h = 0.96, tint, label = "" } = {}) {
  return K.uiPanel(
    (g, W, H) => {
      K.paint.bg(g, W, H, "rgba(255,255,255,.82)", "rgba(236,240,250,.6)");
      if (label) {
        g.fillStyle = "rgba(160,120,40,.9)";
        g.font = `600 ${Math.round(H * 0.09)}px Georgia, serif`;
        g.fillText(label, W * 0.1, H * 0.16);
      }
      K.paint.lines(g, W * 0.1, H * (label ? 0.26 : 0.12), [W * 0.8, W * 0.7, W * 0.76, W * 0.5, W * 0.72, W * 0.66, W * 0.4], { gap: H * 0.09, height: H * 0.03 });
    },
    w,
    h,
    { tint, depth: 0.04 },
  );
}

/** Smartphone: glass body with a drawn screen (pass a painter). */
export function phone(draw, { w = 0.56, h = 1.1 } = {}) {
  const g = new THREE.Group();
  const body = K.extrudeRect(w, h, 0.09, 0.07);
  g.add(mesh(body, glass({ thickness: 0.3 })));
  const tex = K.uiTexture(draw, 320, Math.round((320 * h) / w));
  g.add(at(mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.93), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })), 0, 0, body.userData.front + 0.004));
  g.add(at(K.goldFrame(w + 0.01, h + 0.01, { r: 0.09, tube: 0.008 }), 0, 0, 0));
  return g;
}

/** Glass monolith (a tall faceted block). */
export const monolith = ({ w = 0.8, h = 2, d = 0.8, tint = "#d3e2ff" } = {}) =>
  group(at(mesh(new THREE.BoxGeometry(w, h, d, 1, 1, 1), glass({ thickness: 1.6, tint, dispersion: 4 })), 0, h / 2, 0));

/** A glowing core: small icosahedron of light inside a glass sphere. */
export function orb({ r = 1, core = "#ffe2a8", tint = "#d6e4ff" } = {}) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(r, 96, 64), glass({ thickness: r * 1.6, tint, dispersion: 4, iridescence: 0.4 })));
  g.add(mesh(new THREE.IcosahedronGeometry(r * 0.22, 1), glow(core, 1.25)));
  return g;
}

export { at, group, mesh };
