// Global weather shading injected into every MeshStandardMaterial: wet surfaces darken and turn
// glossy, snow settles on up-facing surfaces, frost rimes everything slightly. Values are driven
// by the weather system through shared uniforms, so materials never need recompiling.
import * as THREE from 'three';

export const WX = {
  uWet: { value: 0 },
  uSnow: { value: 0 },
  uFrost: { value: 0 },
  uUpView: { value: new THREE.Vector3(0, 1, 0) },
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2() },
};

const FRAG = /* glsl */ `
  {
    float upF = clamp(dot(normal, uUpView), 0.0, 1.0);
    float w = uWet * uPorous;
    diffuseColor.rgb *= mix(1.0, 0.6, w);
    roughnessFactor = mix(roughnessFactor, 0.16, w * (0.35 + 0.65 * upF));
    float s = uSnow * uSnowMask * smoothstep(0.35, 0.8, upF);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), s);
    roughnessFactor = mix(roughnessFactor, 0.72, s);
    metalnessFactor = mix(metalnessFactor, 0.0, s);
    float f = uFrost * uSnowMask * (0.25 + 0.45 * upF);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.87, 0.93), f);
    roughnessFactor = mix(roughnessFactor, 0.6, f);
  }
`;

// porous: how much the surface soaks up rain (0 = metal/glass); snowMask: 0 = never snowed on.
export function patchMaterial(mat, { porous = 1, snowMask = 1 } = {}) {
  if (!mat || !mat.isMeshStandardMaterial || mat.userData.wxPatched) return mat;
  mat.userData.wxPatched = true;
  // A material with its own shader hook (wind, axe steel, …) is never swapped for Lambert on Low.
  if (mat.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) mat.userData.wxCustom = true;
  const uPorous = { value: porous };
  const uSnowMask = { value: snowMask };
  mat.userData.wx = { uPorous, uSnowMask };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, { uWet: WX.uWet, uSnow: WX.uSnow, uFrost: WX.uFrost, uUpView: WX.uUpView, uPorous, uSnowMask });
    shader.fragmentShader = 'uniform float uWet, uSnow, uFrost, uPorous, uSnowMask;\nuniform vec3 uUpView;\n' +
      shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG);
  };
  // The default cache key is onBeforeCompile.toString(), which is now the same wrapper for every
  // patched material, so keep the previous hook's source in the key to avoid program collisions.
  const custom = mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey;
  const baseKey = custom ? mat.customProgramCacheKey.bind(mat) : () => (prev ? prev.toString() : '');
  mat.customProgramCacheKey = () => baseKey() + '|wx';
  mat.needsUpdate = true;
  return mat;
}

export function patchScene(root) {
  root.traverse((o) => {
    if (!o.material) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (m.userData.noWeather) continue;
      const metal = m.metalness > 0.5;
      patchMaterial(m, { porous: metal ? 0.15 : m.userData.porous ?? 1, snowMask: m.userData.snowMask ?? 1 });
    }
  });
}

export function updateUpView(camera) {
  WX.uUpView.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
}

// ---------------------------------------------------------------------------------------------
// Low / Potato quality: static scenery swaps its MeshStandardMaterial for a cached Lambert copy
// (colour map only). Software rasterisers spend most of the frame in PBR fragment shading; Lambert
// is several times cheaper. Wet / snow / frost still apply (diffuse-only version of FRAG).
const FRAG_L = /* glsl */ `
  {
    float upF = clamp(dot(normal, uUpView), 0.0, 1.0);
    diffuseColor.rgb *= mix(1.0, 0.6, uWet * uPorous);
    float s = uSnow * uSnowMask * smoothstep(0.35, 0.8, upF);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), s);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.87, 0.93), uFrost * uSnowMask * (0.25 + 0.45 * upF));
  }
`;
// Whether the current preset wants Lambert shading (main.js keeps it in sync), so objects created
// later (log rounds) can start out cheap.
export const LOW = { on: false };

const lowCache = new WeakMap();
function lowMaterial(m) {
  let l = lowCache.get(m);
  if (l) return l;
  l = lambertCopy(m);
  lowCache.set(m, l);
  return l;
}

// An uncached Lambert copy of a (weather-patched) MeshStandardMaterial: colour map, alpha and
// emissive only; wet / snow / frost keep working through the shared uniforms.
export function lambertCopy(m) {
  const l = new THREE.MeshLambertMaterial({
    map: m.map, vertexColors: m.vertexColors, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest,
    // Opaque double-sided surfaces render front faces only (no back-face rasterisation on software GL).
    side: m.side === THREE.DoubleSide && !m.transparent && !(m.alphaTest > 0) && !m.userData.keepDouble ? THREE.FrontSide : m.side,
    depthWrite: m.depthWrite, fog: m.fog, polygonOffset: m.polygonOffset,
    polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits,
    emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity,
  });
  l.color.copy(m.color);
  const wx = m.userData.wx;
  const uPorous = wx?.uPorous ?? { value: 1 }, uSnowMask = wx?.uSnowMask ?? { value: 1 };
  l.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uWet: WX.uWet, uSnow: WX.uSnow, uFrost: WX.uFrost, uUpView: WX.uUpView, uPorous, uSnowMask });
    shader.fragmentShader = 'uniform float uWet, uSnow, uFrost, uPorous, uSnowMask;\nuniform vec3 uUpView;\n' +
      shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_L);
  };
  l.customProgramCacheKey = () => 'wx-lambert';
  return l;
}

// Swappable: a plain or weather-patched Standard material without its own shader hook.
function swappable(m) {
  return !!m?.isMeshStandardMaterial && !m.userData.wxCustom && !m.userData.noLow && !m.userData.noWeather &&
    (m.userData.wxPatched || m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile);
}

export function setLowShading(root, on, { skinned = false } = {}) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh || (o.isSkinnedMesh && !skinned)) return;
    if (on) {
      const m = o.material;
      if (o.userData.hiMat) return;
      if (Array.isArray(m)) {
        if (!m.some(swappable)) return;
        o.userData.hiMat = m;
        o.material = m.map((x) => (swappable(x) ? lowMaterial(x) : x));
        return;
      }
      if (!swappable(m)) return;
      o.userData.hiMat = m;
      o.material = lowMaterial(m);
    } else if (o.userData.hiMat) {
      o.material = o.userData.hiMat;
      delete o.userData.hiMat;
    }
  });
}
