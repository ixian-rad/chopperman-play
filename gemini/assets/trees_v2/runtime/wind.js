// Drop-in wind sway for three.js MeshStandard/Physical/Lambert materials (r150+).
// Uses the per-vertex `_wind` attribute baked into trees_v2 GLBs (glTF `_WIND`):
//   _wind.x = sway amplitude (m, grows with height), _wind.y = leaf flutter amplitude (m).
// Works with InstancedMesh (phase taken from instance translation) and plain meshes.
import * as THREE from 'three';

export const WIND = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(1, 0.35).normalize() },
  uWindStrength: { value: 1.0 },   // 0 = calm, 1 = breeze, 2.5 = storm
};

const GLSL_HEAD = /* glsl */`
attribute vec2 _wind;
uniform float uTime; uniform vec2 uWindDir; uniform float uWindStrength;
`;
const GLSL_BODY = /* glsl */`
#include <begin_vertex>
{
  vec3 wp0 = modelMatrix[3].xyz;
  #ifdef USE_INSTANCING
    wp0 += (modelMatrix * vec4(instanceMatrix[3].xyz, 0.0)).xyz;
  #endif
  float ph = dot(wp0.xz, vec2(0.37, 0.21));
  float gust = 0.55 + 0.45 * sin(uTime * 0.35 + ph * 0.3);
  float s = (sin(uTime * 1.25 + ph) * 0.6 + sin(uTime * 2.07 + ph * 1.7) * 0.25 + 0.4) * gust;
  transformed.xz += uWindDir * (_wind.x * s * uWindStrength);
  float f = sin(uTime * 6.5 + dot(position, vec3(3.1, 2.3, 1.7)) + ph);
  transformed += objectNormal * (_wind.y * f * uWindStrength * gust);
}
`;

/** Patch a material in place. Pass your own uniforms object to control one tree separately
 *  (e.g. a felled tree: { ...WIND, uWindStrength: { value: 0 } }). */
export function applyWind(material, uniforms = WIND) {
  // keep the material's own (non-wind) hook; re-applying (or applying to a clone) never stacks
  if (!material.userData.__windPrev) material.userData.__windPrev = material.onBeforeCompile.__isWind ? null : material.onBeforeCompile;
  const prev = material.userData.__windPrev;
  const hook = (shader, r) => {
    prev && prev(shader, r);
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindDir = uniforms.uWindDir;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.vertexShader = GLSL_HEAD + shader.vertexShader.replace('#include <begin_vertex>', GLSL_BODY);
  };
  hook.__isWind = true;
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = () => 'trees_v2_wind';
  material.needsUpdate = true;
  return material;
}

/** Call once per frame. */
export function updateWind(elapsedSeconds) { WIND.uTime.value = elapsedSeconds; }
