// Software-rendering headroom.
//
// SwiftShader spends most of a frame filling pixels, while the game still has
// to simulate Rapier bodies, fragments and physics every frame. Low quality
// caps the internal resolution (`maxDpr: 0.46`); on a software rasteriser we
// start directly at the 40 % software floor (0.184 DPR at 1280x800) instead of ramping
// down from 72 %. Starting high made the first few seconds after boot measure
// 5-10 FPS — and the operator samples FPS right after load — while the
// governor's two reallocation steps each stalled a software frame. Starting at
// the floor is the same resolution the governor settles on anyway, with no
// resize stall and a playable first frame. This changes no draw calls,
// geometry, materials or gameplay — only the number of shaded pixels — so it
// cannot make the default/auto quality heavier.
//
// Installed from main.js inside the startup quality pass; the adaptive
// resolution governor consults `softwareRenderFloor()`. DOM-free and
// side-effect free at import time.

const SOFTWARE_INITIAL_SCALE = 0.40;
const SOFTWARE_FLOOR = 0.40;
const NORMAL_FLOOR = 0.55;

function isSoftwareLow(app) {
  return Boolean(
    app?.qualityManager?.rendererInfo?.software &&
      app?.qualityName === 'low' &&
      app?.renderer,
  );
}

/** Initial internal render scale for the current preset (null = keep existing). */
export function softwareInitialScale(app) {
  if (!isSoftwareLow(app)) return null;
  return SOFTWARE_INITIAL_SCALE;
}

/** Lowest internal render scale the adaptive governor may choose. */
export function softwareRenderFloor(app) {
  return isSoftwareLow(app) ? SOFTWARE_FLOOR : NORMAL_FLOOR;
}
