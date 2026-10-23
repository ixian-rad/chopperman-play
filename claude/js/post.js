// Rendering quality: presets, post-processing (SSAO, god rays, bloom, ACES tone mapping) and an
// automatic downgrade when the frame rate stays low (software GL such as SwiftShader).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const PRESETS = {
  potato: { name: 'Potato', aniso: 1, ibl: false, shadowRange: 6, shadowEvery: 2, pixelRatio: 0.3, shadows: false, shadowSize: 512, grass: 0.0, post: false, bloom: false, godrays: false, ssao: false, chips: 90, precip: 0.25, cloudOctaves: 2, envUpdates: false, texScale: 0.5, pointLights: false, trees: 16, treeLod1: 3, treeLod2: 12, treeShadows: false, propShadows: false, propLow: true },
  low: { name: 'Low', aniso: 1, ibl: false, shadowRange: 5, shadowEvery: 3, pixelRatio: 0.34, shadows: false, shadowSize: 512, shadowType: THREE.BasicShadowMap, grass: 0, post: false, bloom: false, godrays: false, ssao: false, chips: 140, precip: 0.4, cloudOctaves: 2, envUpdates: false, texScale: 0.5, pointLights: false, trees: 22, treeLod1: 3, treeLod2: 10, treeShadows: false, propShadows: false, propLow: true },
  medium: { name: 'Medium', aniso: 4, ibl: true, shadowRange: 11, shadowEvery: 1, pixelRatio: 0.8, shadows: true, shadowSize: 1024, shadowType: THREE.PCFShadowMap, grass: 0.5, post: true, bloom: true, godrays: false, ssao: false, chips: 200, precip: 0.7, cloudOctaves: 4, envUpdates: true, texScale: 0.75, pointLights: true, trees: 36, treeLod1: 12, treeLod2: 40, treeShadows: true, propShadows: true },
  high: { name: 'High', aniso: 8, ibl: true, shadowRange: 16, shadowEvery: 1, pixelRatio: 1, shadows: true, shadowSize: 2048, shadowType: THREE.PCFSoftShadowMap, grass: 1, post: true, bloom: true, godrays: true, ssao: false, chips: 260, precip: 1, cloudOctaves: 5, envUpdates: true, texScale: 1, pointLights: true, trees: 46, treeLod1: 28, treeLod2: 70, treeShadows: true, propShadows: true },
  ultra: { name: 'Ultra', aniso: 8, ibl: true, shadowRange: 16, shadowEvery: 1, pixelRatio: 2, shadows: true, shadowSize: 4096, shadowType: THREE.PCFSoftShadowMap, grass: 1, post: true, bloom: true, godrays: true, ssao: true, chips: 360, precip: 1, cloudOctaves: 5, envUpdates: true, texScale: 1, pointLights: true, trees: 52, treeLod1: 36, treeLod2: 95, treeShadows: true, propShadows: true },
};
// aniso: anisotropic filtering cap for the procedural textures.
// trees: how many trees_v2 trees a yard shows (inside the fence first); treeLod1/2: TreeField LOD
// distances (m); tree/propShadows: whether yard trees / GLB props cast shadows.
// Low / Potato draw no shadow maps at all (SwiftShader spent ~25-200 ms per shadow-map update plus a
// shadow lookup in every lit pixel); blob shadows (blobs.js) ground Sergey, the block and the trees.
export const PRESET_ORDER = ['potato', 'low', 'medium', 'high', 'ultra'];

// Screen-space crepuscular rays: radial blur toward the sun of the sky pixels (depth == far),
// so tree crowns, the fence and the house carve shafts out of the light.
class GodRaysPass extends Pass {
  constructor() {
    super();
    this.uniforms = {
      tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uStrength: { value: 0 }, uColor: { value: new THREE.Color(1, 0.85, 0.6) }, uAspect: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tDepth;
        uniform vec2 uSun;
        uniform float uStrength, uAspect;
        uniform vec3 uColor;
        varying vec2 vUv;
        const int N = 28;
        void main() {
          vec4 base = texture2D(tColor, vUv);
          if (uStrength <= 0.001) { gl_FragColor = base; return; }
          vec2 d = (uSun - vUv) / float(N) * 0.85;
          vec2 uv = vUv;
          float decay = 1.0, acc = 0.0;
          for (int i = 0; i < N; i++) {
            uv += d;
            float sky = step(0.99999, texture2D(tDepth, uv).r);
            vec3 c = texture2D(tColor, uv).rgb;
            // Only the sun disc and its bright aureole feed the rays (HDR sky is unbounded).
            float l = dot(c, vec3(0.3, 0.5, 0.2));
            acc += sky * smoothstep(1.2, 6.0, l) * decay;
            decay *= 0.955;
          }
          vec2 sd = (vUv - uSun) * vec2(uAspect, 1.0);
          float fall = exp(-dot(sd, sd) * 1.6);
          gl_FragColor = vec4(base.rgb + uColor * min(acc / float(N), 1.0) * uStrength * fall, base.a);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tColor.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

export class RenderPipeline {
  constructor({ renderer, scene, camera }) {
    Object.assign(this, { renderer, scene, camera });
    this.composer = null;
    this.preset = null;
    this.presetId = null;
    this.auto = true;
    this.fpsHist = [];
    this.cooldown = 4;
    this.onChange = null;
    this.sunWorld = new THREE.Vector3();
    this.godStrength = 0;
  }

  // Pick a starting preset from the GPU (software rasterisers start low). Uses a throwaway
  // context so the real renderer can be created without MSAA on software GL.
  static detectStart() {
    let name = '';
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { /* ignore */ }
    const soft = /swiftshader|llvmpipe|software|basic render/i.test(name);
    return { soft, gpu: name, preset: soft ? 'low' : 'high' };
  }

  apply(id) {
    const P = PRESETS[id];
    if (!P) return;
    this.presetId = id;
    this.preset = P;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, P.pixelRatio));
    r.shadowMap.enabled = P.shadows;
    if (P.shadowType !== undefined) r.shadowMap.type = P.shadowType;
    const range = P.shadowRange;
    const sphere = new THREE.Sphere();
    this.scene.traverse((o) => {
      if (o.isDirectionalLight && o.castShadow) {
        if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
        o.shadow.mapSize.set(P.shadowSize, P.shadowSize);
        const c = o.shadow.camera;
        c.left = -range; c.right = range; c.top = range; c.bottom = -range;
        c.updateProjectionMatrix();
      }
      // On low presets only things near the chopping block cast shadows.
      if (o.isMesh) {
        if (o.userData.castOrig === undefined) o.userData.castOrig = o.castShadow;
        if (o.userData.castOrig) {
          let near = true;
          if (range < 16 && o.geometry) {
            if (o.isInstancedMesh) o.computeBoundingSphere();
            else if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
            sphere.copy(o.isInstancedMesh ? o.boundingSphere : o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
            near = Math.hypot(sphere.center.x, sphere.center.z) - sphere.radius < range * 0.6;
          }
          o.castShadow = near;
        }
      }
      if (o.material) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) m.needsUpdate = true;
      }
    });
    this.buildComposer();
    this.cooldown = 4;
    this.fpsHist = [];
    this.onChange?.(id, P);
  }

  buildComposer() {
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      for (const p of this.composer.passes) p.dispose?.();
      this.composer = null;
    }
    const P = this.preset;
    if (!P.post) return;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(size.x, size.y) });
    const composer = new EffectComposer(r, rt);
    // RenderTarget.clone() shares the depth texture's Source (and thus the GPU texture) between
    // both ping-pong buffers, which is a feedback loop when the god-ray pass samples depth.
    composer.renderTarget2.depthTexture = new THREE.DepthTexture(size.x, size.y);
    composer.setPixelRatio(r.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (P.godrays) {
      this.godrays = new GodRaysPass();
      composer.addPass(this.godrays);
    } else this.godrays = null;
    if (P.ssao) {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1 });
      composer.addPass(ao);
      this.ao = ao;
    } else this.ao = null;
    if (P.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.5, 1.6);
      composer.addPass(this.bloom);
    } else this.bloom = null;
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  setSize(w, h) {
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  // sunDir: world direction toward the sun; strength 0..1 from the weather system.
  setSun(sunDir, strength) {
    this.sunWorld.copy(sunDir).multiplyScalar(500).add(this.camera.position);
    this.godStrength = strength;
  }

  render() {
    const every = this.preset?.shadowEvery ?? 1;
    this.frameNo = (this.frameNo ?? 0) + 1;
    this.renderer.shadowMap.autoUpdate = every <= 1;
    if (every > 1 && this.frameNo % every === 0) this.renderer.shadowMap.needsUpdate = true;
    if (!this.composer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.godrays) {
      const v = this.sunWorld.clone().project(this.camera);
      const behind = v.z > 1 || v.z < -1;
      const u = this.godrays.uniforms;
      u.uSun.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
      const off = Math.max(Math.abs(v.x), Math.abs(v.y));
      u.uStrength.value = behind ? 0 : this.godStrength * (1 - THREE.MathUtils.smoothstep(off, 1.0, 1.9)) * 0.9;
      u.uAspect.value = this.camera.aspect;
    }
    this.composer.render();
  }

  // Auto quality: step down when the average frame rate stays under the target.
  monitor(dtReal) {
    if (!this.auto || dtReal <= 0) return;
    this.cooldown -= dtReal;
    this.fpsHist.push(dtReal);
    let sum = 0;
    for (const d of this.fpsHist) sum += d;
    while (sum > 3 && this.fpsHist.length > 2) sum -= this.fpsHist.shift();
    if (this.cooldown > 0 || sum < 2.5) return;
    const fps = this.fpsHist.length / sum;
    const i = PRESET_ORDER.indexOf(this.presetId);
    if (fps < 20 && i > 0) {
      const id = PRESET_ORDER[i - 1];
      this.cooldown = 4;
      this.fpsHist = [];
      return { id, msg: `Auto quality: ${fps.toFixed(0)} FPS → ${PRESETS[id].name}` };
    }
    if (fps < 12 && i === 0 && this.renderer.getPixelRatio() > 0.3) {
      this.renderer.setPixelRatio(Math.max(0.3, this.renderer.getPixelRatio() * 0.8));
      this.cooldown = 4;
      this.fpsHist = [];
    }
    return null;
  }
}
