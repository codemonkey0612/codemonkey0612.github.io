// Bundled by `npm run site:scenes` into site/assets/celestial.js (three.js included, MIT).
// app.js imports it only on capable desktops; everyone else sees the pre-rendered stills.
import { mount } from "./mount.js";
import main from "./scenes-main.js";
import services from "./scenes-services.js";
import works from "./scenes-works.js";

export const SCENES = { ...main, ...services, ...works };
export const names = () => Object.keys(SCENES);

/** Live: put a canvas on a .stage[data-scene] and fade it in over the still. */
export async function start(stage, assetBase) {
  const def = SCENES[stage.dataset.scene];
  if (!def) return null;
  const canvas = document.createElement("canvas");
  canvas.className = "stage-canvas";
  canvas.setAttribute("aria-hidden", "true");
  stage.querySelector(".stage-art")?.after(canvas) ?? stage.prepend(canvas);
  const live = await mount(canvas, def, { layout: stage.dataset.layout || "wide", assetBase });
  stage.classList.add("is-live");
  // The ribbon's glint travels from entrance to exit as the stage scrolls past.
  const onScroll = () => {
    const r = stage.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)));
    live.setProgress(0.18 + p * 0.74);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  return {
    stop() {
      window.removeEventListener("scroll", onScroll);
      live.dispose();
      canvas.remove();
      stage.classList.remove("is-live");
    },
  };
}

/** Build time: render one still (see scripts/site-scenes.mjs and site/scene/harness.html). */
export function still(canvas, name, layout, assetBase) {
  const def = SCENES[name];
  if (!def) throw new Error(`unknown scene "${name}"`);
  return mount(canvas, def, { still: true, layout, assetBase });
}
