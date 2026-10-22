// Software-rendering headroom.
//
// SwiftShader spends most of a frame filling pixels, while the game still has
// to simulate Rapier bodies, fragments and physics every frame. Low quality
// caps the internal resolution (`maxDpr: 0.46`) and starts at 72 % of that;
// on a software rasteriser we also start at 72 % (0.33 DPR at 1280x800) and
// let the adaptive resolution governor walk down to 30 % (0.14 DPR) when
// frames stay slow. This changes no draw calls, geometry, materials or
// gameplay — only the number of shaded pixels — so it cannot make the
// default/auto quality heavier.
//
// Installed from main.js inside the startup quality pass; the adaptive
// resolution governor consults `softwareRenderFloor()`. DOM-free and
// side-effect free at import time.

const SOFTWARE_INITIAL_SCALE = 0.72;
const SOFTWARE_FLOOR = 0.3;
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
