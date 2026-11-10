// Celestial kit: the shared materials, shapes and lighting every hero sculpture is built from.
// Scenes (scenes-*.js) describe what to put on stage; mount.js renders them — live on capable
// desktops, or once at build time into the still images every visitor sees first.
import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";

export { THREE };
export const C = (c) => new THREE.Color(c);
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Deterministic random numbers, so stills are identical on every build. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------- moods: sky, reflections, floor ----------
// `sky`: vertical gradient stops; `glows`: [x, y, radius, colour, alpha] soft lights painted on the sky.
export const MOODS = {
  midnight: {
    dark: true,
    env: { top: "#3a5583", mid: "#132741", bot: "#05101c", boxes: 1 },
    sky: [[0, "#040b16"], [0.55, "#0a1b31"], [0.8, "#13304f"], [1, "#081521"]],
    glows: [[0.72, 0.6, 0.42, "#3d6fb3", 0.5], [0.66, 0.8, 0.22, "#ffcf8a", 0.18], [0.18, 0.18, 0.3, "#1d3b66", 0.4]],
    stars: 900,
    floor: "#0a1828",
    exposure: 1.05,
    bloom: [0.36, 0.5, 0.88],
  },
  pearl: {
    dark: false,
    env: { top: "#ffffff", mid: "#aeb7c9", bot: "#5d6880", boxes: 0.55 },
    sky: [[0, "#dfe3ee"], [0.45, "#eef0f6"], [0.7, "#f5f3ef"], [1, "#e8ebf3"]],
    glows: [[0.7, 0.45, 0.38, "#ffe3b3", 0.5], [0.22, 0.25, 0.4, "#cfdcff", 0.55], [0.88, 0.7, 0.3, "#e0d6ff", 0.4]],
    stars: 0,
    floor: "#eceef4",
    exposure: 0.9,
    bloom: [0.16, 0.4, 0.97],
  },
};

/** A mood with a service/project accent colour mixed into the sky glows. */
export function moodWith(base, accent, strength = 0.55) {
  const m = structuredClone(MOODS[base]);
  if (accent) {
    m.glows = [[0.7, 0.55, 0.45, accent, strength], ...m.glows.slice(1)];
    m.accent = accent;
  }
  return m;
}

export function makeEnv(renderer, mood) {
  const s = new THREE.Scene();
  const { top, mid, bot, boxes } = mood.env;
  s.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(60, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { top: { value: C(top) }, mid: { value: C(mid) }, bot: { value: C(bot) } },
        vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
        fragmentShader:
          "uniform vec3 top, mid, bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0. ? mix(mid, top, smoothstep(0., .8, h)) : mix(mid, bot, smoothstep(0., .6, -h)); gl_FragColor = vec4(c, 1.); }",
      }),
    ),
  );
  const box = (w, h, color, k, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: C(color).multiplyScalar(k * boxes), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  box(26, 8, "#ffffff", 3.2, [0, 22, 12]);
  box(8, 26, "#ffdcaa", 3, [-24, 4, 8]);
  box(8, 26, "#b9d3ff", 3, [24, 2, -2]);
  box(34, 3, "#ffcf8a", 2.6, [0, -6, -26]);
  box(5, 5, "#ffffff", 6, [10, 10, 20]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(s, 0.03).texture;
  pmrem.dispose();
  return tex;
}

export function skyTexture(mood, w = 1024, h = 640) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d");
  const lin = g.createLinearGradient(0, 0, 0, h);
  for (const [stop, col] of mood.sky) lin.addColorStop(stop, col);
  g.fillStyle = lin;
  g.fillRect(0, 0, w, h);
  for (const [x, y, r, col, a] of mood.glows) {
    const rg = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * w);
    rg.addColorStop(0, col);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = a;
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let sprite;
export function spriteTexture() {
  if (sprite) return sprite;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const g = cv.getContext("2d");
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(0.25, "rgba(255,240,210,.55)");
  rg.addColorStop(1, "rgba(255,220,160,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  sprite = new THREE.CanvasTexture(cv);
  sprite.colorSpace = THREE.SRGBColorSpace;
  return sprite;
}

export function stars(n, seed = 7) {
  const r = rng(seed);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const th = r() * Math.PI * 2;
    const ph = Math.acos(r() * 0.9 + 0.05);
    const R = 40 + r() * 10;
    pos.set([R * Math.sin(ph) * Math.cos(th), R * Math.cos(ph) * 0.9 + 4, -Math.abs(R * Math.sin(ph) * Math.sin(th))], i * 3);
    const k = 0.5 + r() * 0.5;
    col.set([k, k * (0.92 + r() * 0.08), k * (0.85 + r() * 0.15)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
}

/** Glowing dust scattered around a list of points (e.g. a ribbon's centre line). */
export function sparkles(points, n, spread = 0.5, { seed = 3, size = 0.08, color = "#ffe7b8", boost = 2.2 } = {}) {
  const r = rng(seed);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = points[Math.floor(r() * points.length)];
    pos.set([p.x + (r() - 0.5) * spread, p.y + (r() - 0.5) * spread, p.z + (r() - 0.5) * spread], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size, map: spriteTexture(), color: C(color).multiplyScalar(boost), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
}

// ---------- materials ----------
let current = MOODS.midnight;
/** mount() calls this before building, so materials can suit a light or dark stage. */
export function useMood(m) {
  current = m;
}

/** Optical glass: clear, with a faint spectral edge. `tint` colours it (e.g. an accent). */
export const glass = ({ tint = "#d6e4ff", ...o } = {}) =>
  new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    roughness: 0.04,
    transmission: 1,
    thickness: 1.2,
    ior: 1.5,
    dispersion: 5,
    iridescence: 0.5,
    iridescenceIOR: 1.33,
    iridescenceThicknessRange: [180, 620],
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.6,
    attenuationColor: C(tint).offsetHSL(0, current.dark ? 0 : 0.12, current.dark ? 0 : -0.1),
    attenuationDistance: current.dark ? 3 : 1.1,
    ...o,
  });

/** Frosted glass (soft, milky). */
export const frost = ({ tint = "#e8eefc", ...o } = {}) => glass({ roughness: 0.32, dispersion: 1, iridescence: 0.2, tint, attenuationDistance: 1.6, ...o });

/** Polished porcelain / pearl stone for plinths and architecture. */
export const pearl = (o = {}) =>
  new THREE.MeshPhysicalMaterial({
    color: current.dark ? "#9aa3b3" : "#f3f1ec",
    roughness: current.dark ? 0.22 : 0.3,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
    sheen: 0.4,
    sheenColor: C(current.dark ? "#c8d4ea" : "#ffffff"),
    envMapIntensity: current.dark ? 0.75 : 1.1,
    ...o,
  });

/** Champagne gold. Pass `highlight` (a uniform {value: 0..1}) to send a travelling glint along a ribbon (needs the aT attribute). */
export function gold(o = {}, highlight = null) {
  const m = new THREE.MeshPhysicalMaterial({
    color: "#e0b866",
    metalness: 1,
    roughness: 0.22,
    clearcoat: 0.5,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.35,
    side: THREE.DoubleSide,
    ...o,
  });
  if (highlight) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uProgress = highlight;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aT;\nvarying float vT;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvT = aT;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vT;\nuniform float uProgress;")
        .replace(
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\nfloat band = exp(-pow((vT - uProgress) * 14.0, 2.0));\ntotalEmissiveRadiance += vec3(1.0, 0.8, 0.48) * band * 0.9;",
        );
    };
    m.customProgramCacheKey = () => "gold-highlight";
  }
  return m;
}

/** Self-lit colour (light lines, screens, energy). */
export const glow = (color = "#ffd79a", k = 2) => new THREE.MeshBasicMaterial({ color: C(color).multiplyScalar(k), toneMapped: true });

// ---------- shapes ----------
export const curve = (pts, closed = false) => new THREE.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : V(...p))), closed, "centripetal");

/** A flat twisting ribbon along a curve. geometry.userData.points = its centre line. */
export function ribbon(path, { segments = 500, width = 0.34, twist = Math.PI * 2.2, taper = 0.08, wobble = 0.15 } = {}) {
  const frames = path.computeFrenetFrames(segments, path.closed);
  const pos = [];
  const tt = [];
  const idx = [];
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = path.getPointAt(t);
    pts.push(p);
    const a = twist * t;
    const dir = frames.normals[i].clone().multiplyScalar(Math.cos(a)).add(frames.binormals[i].clone().multiplyScalar(Math.sin(a)));
    const edge = path.closed ? 1 : Math.min(1, t / taper, (1 - t) / taper);
    const w = (width / 2) * (0.15 + 0.85 * Math.sin((edge * Math.PI) / 2)) * (1 - wobble + 2 * wobble * (0.5 + 0.5 * Math.sin(t * 9.0)));
    pos.push(p.x + dir.x * w, p.y + dir.y * w, p.z + dir.z * w, p.x - dir.x * w, p.y - dir.y * w, p.z - dir.z * w);
    tt.push(t, t);
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aT", new THREE.Float32BufferAttribute(tt, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.userData.points = pts;
  return geo;
}

/** A thin gold orbit ring (lies in the XZ plane; rotate it). */
export const ring = (radius = 2, tube = 0.018, mat = gold()) => {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, 256), mat);
  m.rotation.x = Math.PI / 2;
  return m;
};

/** Pearl plinth with a gold rim; its top sits at y = 0 of the returned group. */
export function plinth(radius = 1.6, height = 0.32, { steps = 2, rim = true } = {}) {
  const g = new THREE.Group();
  for (let i = 0; i < steps; i++) {
    const r = radius * (1 + i * 0.16);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.02, height, 96), pearl());
    m.position.y = -height / 2 - i * height;
    g.add(m);
    if (rim) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(r * 1.005, 0.012, 8, 160), gold({ side: THREE.FrontSide }));
      t.rotation.x = Math.PI / 2;
      t.position.y = -i * height - 0.004;
      g.add(t);
    }
  }
  return g;
}

/** Rounded rectangle shape (for panels, screens, cards). */
export function roundRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Extrude 2D shapes (THREE.Shape, or an SVG path `d` string drawn in a ~100-unit box, y down)
 * into a bevelled solid, centred on the origin and scaled to `size` (its larger side). */
export function extrude(shapes, { size = 2, depth = 0.25, bevel = 0.05, segments = 6, curveSegments = 24 } = {}) {
  let list = shapes;
  if (typeof shapes === "string") {
    const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${shapes}"/></svg>`);
    list = data.paths.flatMap((p) => SVGLoader.createShapes(p));
  }
  if (!Array.isArray(list)) list = [list];
  const geo = new THREE.ExtrudeGeometry(list, { depth: 1, bevelEnabled: false, curveSegments });
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const span = Math.max(b.max.x - b.min.x, b.max.y - b.min.y);
  const k = size / span;
  geo.dispose();
  const out = new THREE.ExtrudeGeometry(list, {
    depth: depth / k,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel / k,
    bevelSize: (bevel * 0.8) / k,
    bevelSegments: segments,
    curveSegments,
  });
  out.center();
  if (typeof shapes === "string") {
    out.scale(k, -k, k); // SVG y points down: mirror, then restore the triangle winding
    flipWinding(out);
    out.computeVertexNormals();
  } else out.scale(k, k, k);
  return out;
}

/** Reverse every triangle of a non-indexed geometry (after a mirroring scale). */
export function flipWinding(geo) {
  for (const attr of Object.values(geo.attributes)) {
    const n = attr.itemSize;
    const a = attr.array;
    for (let t = 0; t < attr.count; t += 3) {
      for (let c = 0; c < n; c++) {
        const i1 = (t + 1) * n + c;
        const i2 = (t + 2) * n + c;
        const tmp = a[i1];
        a[i1] = a[i2];
        a[i2] = tmp;
      }
    }
    attr.needsUpdate = true;
  }
}

const loader = new THREE.TextureLoader();
/** Load an image as a texture; `ctx.load()` makes stills wait for it. */
export function texture(ctx, url) {
  const t = loader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  ctx.load(
    new Promise((res) => {
      const check = () => (t.image && t.image.complete && t.image.naturalWidth ? res() : setTimeout(check, 50));
      check();
    }),
  );
  return t;
}

/** A glass slab with a picture set inside it (a real cover or screenshot). w×h in scene units. */
export function imagePanel(ctx, url, w = 3.2, h = 1.8, { depth = 0.12, radius = 0.08, frame = "glass", fit = "cover", imageAspect = null } = {}) {
  const g = new THREE.Group();
  const slabGeo = extrudeRect(w, h, radius, depth);
  const slab = new THREE.Mesh(slabGeo, frame === "glass" ? glass({ thickness: depth * 2, dispersion: 2, iridescence: 0.3 }) : pearl());
  g.add(slab);
  const tex = texture(ctx, url);
  if (fit === "cover" && imageAspect) coverFit(tex, imageAspect, w / h);
  const pic = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(w * 0.94, h * 0.92, radius * 0.6), 8), new THREE.MeshBasicMaterial({ map: tex, color: C("#d9d9d9") }));
  normalizeUV(pic.geometry);
  pic.position.z = slabGeo.userData.front + 0.004;
  g.add(pic);
  g.userData.picture = pic;
  return g;
}

/** A thin gold outline around a w×h rectangle (for frames and arches). */
export function goldFrame(w, h, { r = 0.06, tube = 0.016 } = {}) {
  const s = roundRect(w, h, r);
  const pts = s.getSpacedPoints(240).map((p) => V(p.x, p.y, 0));
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 240, tube, 6, true), gold({ side: THREE.FrontSide }));
}

export function extrudeRect(w, h, r, depth) {
  const bevel = Math.min(0.03, depth / 3);
  const geo = new THREE.ExtrudeGeometry(roundRect(w, h, r), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: Math.min(0.03, r / 2), bevelSegments: 4, curveSegments: 12 });
  geo.translate(0, 0, -depth / 2);
  geo.userData.front = depth / 2 + bevel; // anything shown "on" the slab goes just in front of this
  return geo;
}

/** Map ShapeGeometry UVs (which are in shape units) to 0..1. */
export function normalizeUV(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const uv = geo.attributes.uv;
  const p = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) - b.min.x) / (b.max.x - b.min.x), (p.getY(i) - b.min.y) / (b.max.y - b.min.y));
  uv.needsUpdate = true;
}

/** Crop a texture like CSS object-fit: cover (imageAspect = width / height of the picture). */
export function coverFit(tex, imageAspect, boxAspect, focusY = 0.5) {
  if (imageAspect > boxAspect) {
    tex.repeat.set(boxAspect / imageAspect, 1);
    tex.offset.set((1 - tex.repeat.x) / 2, 0);
  } else {
    tex.repeat.set(1, imageAspect / boxAspect);
    tex.offset.set(0, (1 - tex.repeat.y) * (1 - focusY));
  }
}

/** Abstract interface art drawn on a canvas (placeholder lines, never real-looking data). */
export function uiTexture(draw, w = 512, h = 320) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A glass card with an abstract UI drawing on it. */
export function uiPanel(draw, w = 2, h = 1.3, { depth = 0.08, tint, texW = 512 } = {}) {
  const g = new THREE.Group();
  const slabGeo = extrudeRect(w, h, 0.07, depth);
  g.add(new THREE.Mesh(slabGeo, glass({ thickness: 0.2, dispersion: 2, iridescence: 0.35, ...(tint && { tint }) })));
  const tex = uiTexture(draw, texW, Math.round((texW * h) / w));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, h * 0.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  face.position.z = slabGeo.userData.front + 0.004;
  g.add(face);
  return g;
}

/** Placeholder UI painter helpers for uiTexture / uiPanel. */
export const paint = {
  bg(g, w, h, a = "rgba(255,255,255,.55)", b = "rgba(230,238,255,.35)") {
    const lin = g.createLinearGradient(0, 0, w, h);
    lin.addColorStop(0, a);
    lin.addColorStop(1, b);
    g.fillStyle = lin;
    g.beginPath();
    g.roundRect(0, 0, w, h, 18);
    g.fill();
  },
  lines(g, x, y, widths, { gap = 18, height = 7, color = "rgba(40,60,90,.35)" } = {}) {
    g.fillStyle = color;
    widths.forEach((lw, i) => {
      g.beginPath();
      g.roundRect(x, y + i * gap, lw, height, height / 2);
      g.fill();
    });
  },
  field(g, x, y, w, h = 30, { stroke = "rgba(201,162,74,.8)", fill = "rgba(255,255,255,.7)" } = {}) {
    g.fillStyle = fill;
    g.strokeStyle = stroke;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(x, y, w, h, 8);
    g.fill();
    g.stroke();
  },
  pill(g, x, y, w, h, color = "#c9a24a") {
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(x, y, w, h, h / 2);
    g.fill();
  },
  bars(g, x, y, w, h, values, color = "rgba(80,130,220,.75)") {
    const bw = w / (values.length * 1.6);
    values.forEach((v, i) => {
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x + i * bw * 1.6, y + h * (1 - v), bw, h * v, 4);
      g.fill();
    });
  },
};

/** A soft contact shadow under an object on a pale floor. */
export function contactShadow(radius = 1.5, opacity = 0.35) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, `rgba(20,30,50,${opacity})`);
  rg.addColorStop(1, "rgba(20,30,50,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

/** A mirror floor that fades into the mood's floor colour (water on midnight, polished stone on pearl). */
export function reflectiveFloor(mood, { size = 60, strength = 0.55, ripple = 0.004 } = {}) {
  const shader = {
    name: "FadeReflector",
    uniforms: {
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      tint: { value: C(mood.floor) },
      strength: { value: strength },
      ripple: { value: ripple },
    },
    vertexShader:
      "uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vXY; void main(){ vUv = textureMatrix*vec4(position,1.); vXY = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader:
      "uniform sampler2D tDiffuse; uniform vec3 tint; uniform float strength; uniform float ripple; varying vec4 vUv; varying vec2 vXY; void main(){ vec4 uv = vUv; uv.x += sin(vXY.y*9.0 + vXY.x*1.3)*ripple*uv.w; vec4 b = texture2DProj(tDiffuse, uv); float f = smoothstep(16.0, 1.0, length(vXY*vec2(0.55,1.0))); gl_FragColor = vec4(mix(tint, b.rgb, strength * f), smoothstep(22.0, 6.0, length(vXY*vec2(0.5,1.0))));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}",
  };
  const r = new Reflector(new THREE.PlaneGeometry(size, size), { textureWidth: 1024, textureHeight: 1024, shader, clipBias: 0.003 });
  r.material.transparent = true;
  r.material.depthWrite = false;
  r.rotation.x = -Math.PI / 2;
  r.renderOrder = -1;
  return r;
}

/** A soft additive light behind glass, so it glows from within. */
export function halo(radius = 2, color = "#9ec3ff", opacity = 0.5) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteTexture(), color: C(color), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(radius * 2, radius * 2, 1);
  return s;
}

/** Make an object bob gently (4–8 px on screen): registered in ctx.anim, skipped in stills. */
export function float(ctx, obj, { amp = 0.06, period = 8, phase = 0, spin = 0 } = {}) {
  const y0 = obj.position.y;
  const r0 = obj.rotation.y;
  ctx.anim.push((t) => {
    obj.position.y = y0 + Math.sin((t / period) * Math.PI * 2 + phase) * amp;
    if (spin) obj.rotation.y = r0 + Math.sin((t / (period * 1.7)) * Math.PI * 2 + phase) * spin;
  });
}
