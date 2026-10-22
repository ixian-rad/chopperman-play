import * as THREE from 'three';

/**
 * Lazy post-processing pipeline.
 *
 * The modules are imported on demand so a software-rendered (SwiftShader) run
 * never pays the network/parse cost for a bloom or god-ray pass it cannot
 * afford. Low keeps the direct render path; Medium+ adds bloom and a
 * tone-mapped sRGB display pass, and High/Ultra add a 24-tap screen-space
 * crepuscular ray pass.
 */
export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.loaded = false;
    this.loading = false;
    this.enabled = false;
    this.bloom = null;
    this.ssao = null;
    this.godrays = null;
    this.outputPass = null;
    this.renderPass = null;
    this.targetPreset = null;
    this.width = 1;
    this.height = 1;
    this.failed = false;
    this._sunWorld = new THREE.Vector3();
    this._sunDir = new THREE.Vector3(0, 1, 0);
    this._sunStrength = 0;
    this._projected = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this.mood = { golden: 0, night: 0, rain: 0, snow: 0, fog: 0 };
    this._moodKey = '';
    this._bloomBaseStrength = 0.3;
    this._bloomBaseThreshold = 0.9;
  }

  async load() {
    // Compatibility mode has no GL context to build render targets on. Keep the
    // direct (no-op) render path instead of loading the post-processing stack.
    if (this.renderer?.isFallbackRenderer) {
      this.enabled = false;
      return false;
    }
    if (this.loaded || this.loading || this.failed) return this.loaded;
    this.loading = true;
    try {
      const [
        { EffectComposer },
        { RenderPass },
        { Pass, FullScreenQuad },
      ] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/Pass.js'),
      ]);
      this.EffectComposer = EffectComposer;
      this.RenderPass = RenderPass;
      this.GodRaysPass = makeGodRaysPass(Pass, FullScreenQuad, THREE);
      this.BloomPass = makeBloomPass(Pass, FullScreenQuad, THREE);
      this.FinalPass = makeFinalPass(Pass, FullScreenQuad, THREE);
      try {
        const mod = await import('three/addons/postprocessing/SSAOPass.js');
        this.SSAOPass = mod.SSAOPass;
      } catch {
        this.SSAOPass = null;
      }

      // A depth attachment is required by the god-ray pass. Low never loads
      // this module, and Medium only pays for the extra depth texture (the ray
      // pass itself stays disabled), so this does not make the default path
      // heavier under SwiftShader.
      const size = new THREE.Vector2();
      this.renderer.getDrawingBufferSize(size);
      const depthTexture = new THREE.DepthTexture(
        Math.max(1, size.x),
        Math.max(1, size.y),
      );
      const target = new THREE.WebGLRenderTarget(
        Math.max(1, size.x),
        Math.max(1, size.y),
        { type: THREE.HalfFloatType, depthTexture },
      );
      this.composer = new EffectComposer(this.renderer, target);
      // RenderTarget.clone() shares the depth texture source between the two
      // ping-pong buffers; give the second buffer its own to avoid a feedback
      // loop when the ray pass samples depth from the read buffer.
      this.composer.renderTarget2.depthTexture = new THREE.DepthTexture(
        Math.max(1, size.x),
        Math.max(1, size.y),
      );
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(this.renderPass);
      this.godrays = new this.GodRaysPass();
      this.composer.addPass(this.godrays);
      this.bloom = new this.BloomPass();
      this.composer.addPass(this.bloom);
      this.outputPass = new this.FinalPass();
      this.composer.addPass(this.outputPass);
      this.loaded = true;
      return true;
    } catch (error) {
      console.warn('Post-processing unavailable', error);
      this.failed = true;
      this.enabled = false;
      return false;
    } finally {
      this.loading = false;
    }
  }

  async setQuality(preset) {
    this.targetPreset = preset;
    if (this.renderer?.isFallbackRenderer) {
      this.enabled = false;
      return false;
    }
    const wants = Boolean(
      preset && (preset.bloom || preset.ssao || preset.godrays),
    );
    if (!wants) {
      this.enabled = false;
      return false;
    }
    if (!this.loaded) await this.load();
    if (!this.loaded) {
      this.enabled = false;
      return false;
    }
    this.bloom.enabled = Boolean(preset.bloom);
    this._bloomBaseStrength = preset.bloomStrength ?? 0.3;
    this._bloomBaseThreshold = preset.bloomThreshold ?? 0.9;
    this.bloom.strength = this._bloomBaseStrength;
    this.bloom.threshold = this._bloomBaseThreshold;
    this.bloom.radius = preset.ssao ? 0.65 : 0.5;
    if (this.godrays) this.godrays.enabled = Boolean(preset.godrays);

    if (preset.ssao && this.SSAOPass && !this.ssao) {
      try {
        this.ssao = new this.SSAOPass(this.scene, this.camera, this.width, this.height);
        this.ssao.kernelRadius = 10;
        this.ssao.minDistance = 0.003;
        this.ssao.maxDistance = 0.12;
        // Insert after RenderPass, before god rays and bloom.
        this.composer.insertPass(this.ssao, 1);
      } catch {
        this.ssao = null;
      }
    }
    if (this.ssao) {
      this.ssao.enabled = Boolean(preset.ssao);
    }
    this.enabled = true;
    this._moodKey = '';
    this._applyMood();
    this.resize(this.width, this.height);
    return true;
  }

  /**
   * Per-time-of-day grade for the bloom and final display pass. Low never
   * loads PostFX, so this costs nothing on SwiftShader; Medium+ gets a warmer,
   * slightly vignetted golden hour and a cooler, softer night without any
   * extra fullscreen draw.
   */
  setMood(mood = {}) {
    const m = this.mood;
    const next = {
      golden: THREE.MathUtils.clamp(mood.golden ?? m.golden, 0, 1),
      night: THREE.MathUtils.clamp(mood.night ?? m.night, 0, 1),
      rain: THREE.MathUtils.clamp(mood.rain ?? m.rain, 0, 1),
      snow: THREE.MathUtils.clamp(mood.snow ?? m.snow, 0, 1),
      fog: THREE.MathUtils.clamp(mood.fog ?? m.fog, 0, 1),
    };
    const key = `${next.golden.toFixed(2)}:${next.night.toFixed(2)}:${next.rain.toFixed(2)}:${next.snow.toFixed(2)}:${next.fog.toFixed(2)}`;
    if (key === this._moodKey) return;
    this._moodKey = key;
    Object.assign(m, next);
    this._applyMood();
  }

  _applyMood() {
    const m = this.mood;
    if (this.bloom) {
      // Night and golden hour bloom more (lanterns, low sun), storms less.
      this.bloom.strength =
        this._bloomBaseStrength *
        (1 + m.night * 0.55 + m.golden * 0.22) *
        (1 - m.rain * 0.28 - m.snow * 0.3 - m.fog * 0.2);
      this.bloom.threshold = THREE.MathUtils.clamp(
        this._bloomBaseThreshold * (1 - m.night * 0.3 - m.golden * 0.1) +
          m.rain * 0.02 + m.snow * 0.03,
        0.3,
        2.0,
      );
    }
    if (this.godrays) {
      const u = this.godrays.uniforms;
      u.uColor.value.setRGB(
        1.0,
        THREE.MathUtils.lerp(0.9, 0.66, m.golden),
        THREE.MathUtils.lerp(0.72, 0.4, m.golden),
      );
    }
    if (this.outputPass?.uniforms) {
      const u = this.outputPass.uniforms;
      u.uVignette.value = 0.22 + m.night * 0.06;
      u.uWarm.value = m.golden * 0.55;
      u.uNight.value = m.night * 0.7;
      u.uDesat.value = Math.min(0.5, m.rain * 0.24 + m.snow * 0.16 + m.fog * 0.12);
    }
  }

  /** Sun direction (world, toward the sun) and a 0..1 shaft strength. */
  setSun(direction, strength = 0) {
    if (direction && direction.isVector3) this._sunDir.copy(direction).normalize();
    this._sunStrength = THREE.MathUtils.clamp(strength, 0, 1);
  }

  _updateGodRays() {
    if (!this.godrays || !this.godrays.enabled) return;
    // Keep the probe inside the camera frustum. A 500-unit point sat beyond
    // the far plane (120) and its projected z was always > 1, which disabled
    // the ray pass even when the sun was dead ahead.
    this._sunWorld
      .copy(this._sunDir)
      .multiplyScalar(Math.min(90, (this.camera.far || 120) * 0.75))
      .add(this.camera.position);
    this._projected.copy(this._sunWorld).project(this.camera);
    const forward = this.camera.getWorldDirection(this._forward);
    const behind = this._sunDir.dot(forward) <= 0.02;
    const u = this.godrays.uniforms;
    u.uSun.value.set(
      this._projected.x * 0.5 + 0.5,
      this._projected.y * 0.5 + 0.5,
    );
    const off = Math.max(Math.abs(this._projected.x), Math.abs(this._projected.y));
    const edgeFade = 1 - THREE.MathUtils.smoothstep(off, 1.0, 1.9);
    u.uStrength.value = behind ? 0 : this._sunStrength * edgeFade;
    u.uAspect.value = this.camera.aspect;
  }

  resize(width, height, pixelRatio = null) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio ?? this.renderer.getPixelRatio());
      this.composer.setSize(this.width, this.height);
    }
    const ratio = pixelRatio ?? this.renderer.getPixelRatio();
    if (this.bloom) this.bloom.setSize(this.width * ratio, this.height * ratio);
    if (this.ssao) this.ssao.setSize(this.width, this.height);
  }

  render(dt) {
    if (this.enabled && this.composer) {
      this._updateGodRays();
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    this.bloom?.dispose?.();
    this.godrays?.dispose?.();
    this.outputPass?.dispose?.();
    this.ssao?.dispose?.();
    if (this.composer) {
      this.composer.dispose?.();
      this.composer = null;
    }
    this.loaded = false;
    this.enabled = false;
  }
}


/* ------------------------------------------------------------------ *
 *  Cheap bloom + final display pass
 *
 *  UnrealBloomPass renders a five-mip chain and blends additively back into
 *  the source buffer. That is expensive, and in our SwiftShader runs it
 *  produced a fully black frame. This replacement does a bright pass at half
 *  resolution, two 9-tap blurs
 *  and one plain composite into the write buffer: four fullscreen draws
 *  instead of a dozen, no additive-into-source feedback, and a much smaller
 *  working set. The final pass only encodes linear -> sRGB because the scene
 *  materials already applied ACES tone mapping when they rendered into the
 *  HDR target; OutputPass would tone-map a second time.
 * ------------------------------------------------------------------ */

const BLOOM_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BLOOM_BRIGHT_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    float mask = smoothstep(uThreshold, uThreshold + uKnee, l);
    gl_FragColor = vec4(c * mask, 1.0);
  }
`;

const BLOOM_BLUR_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uDirection;
  varying vec2 vUv;
  void main() {
    // 9-tap Gaussian folded into five bilinear fetches.
    const float w0 = 0.2270270270;
    const float w1 = 0.1945945946;
    const float w2 = 0.1216216216;
    const float w3 = 0.0540540541;
    const float w4 = 0.0162162162;
    vec3 c = texture2D(tDiffuse, vUv).rgb * w0;
    c += texture2D(tDiffuse, vUv + uDirection * 1.3846).rgb * w1;
    c += texture2D(tDiffuse, vUv - uDirection * 1.3846).rgb * w1;
    c += texture2D(tDiffuse, vUv + uDirection * 3.2308).rgb * w2 * 1.5;
    c += texture2D(tDiffuse, vUv - uDirection * 3.2308).rgb * w2 * 1.5;
    c += texture2D(tDiffuse, vUv + uDirection * 5.1765).rgb * w3 * 2.0;
    c += texture2D(tDiffuse, vUv - uDirection * 5.1765).rgb * w3 * 2.0;
    c += texture2D(tDiffuse, vUv + uDirection * 7.0).rgb * w4;
    c += texture2D(tDiffuse, vUv - uDirection * 7.0).rgb * w4;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const BLOOM_COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    vec4 base = texture2D(tDiffuse, vUv);
    vec3 bloom = texture2D(tBloom, vUv).rgb;
    gl_FragColor = vec4(base.rgb + bloom * uStrength, base.a);
  }
`;

const FINAL_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uVignette, uWarm, uNight, uDesat;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    // The scene pass already tone-mapped (including exposure); only the
    // display transfer remains.
    vec3 v = c.rgb;
    vec3 srgb = mix(
      v * 12.92,
      1.055 * pow(max(v, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
      step(vec3(0.0031308), v)
    );
    // Cheap filmic grade: all of this rides the existing final draw, so it is
    // free under a fill-rate-bound renderer relative to another pass.
    float d = length((vUv - 0.5) * vec2(1.25, 1.0));
    float vig = smoothstep(0.38, 1.02, d);
    srgb *= 1.0 - vig * uVignette;
    srgb *= mix(vec3(1.0), vec3(1.06, 1.0, 0.9), uWarm);
    srgb *= mix(vec3(1.0), vec3(0.9, 0.96, 1.08), uNight);
    float lum = dot(srgb, vec3(0.299, 0.587, 0.114));
    srgb = mix(srgb, vec3(lum), uDesat);
    srgb = (srgb - 0.5) * 1.025 + 0.5;
    gl_FragColor = vec4(clamp(srgb, 0.0, 1.0), 1.0);
  }
`;

function makeBloomPass(Pass, FullScreenQuad, three) {
  return class CheapBloomPassImpl extends Pass {
    constructor() {
      super();
      this.needsSwap = true;
      this.resolutionScale = 0.5;
      this.strength = 0.3;
      this.threshold = 0.9;
      this.radius = 0.5;
      this.width = 2;
      this.height = 2;
      const options = {
        minFilter: three.LinearFilter,
        magFilter: three.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      };
      this.brightTarget = new three.WebGLRenderTarget(2, 2, options);
      this.blurTargetA = new three.WebGLRenderTarget(2, 2, options);
      this.blurTargetB = new three.WebGLRenderTarget(2, 2, options);
      this.brightMaterial = new three.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uThreshold: { value: 0.9 },
          uKnee: { value: 0.18 },
        },
        vertexShader: BLOOM_VERTEX,
        fragmentShader: BLOOM_BRIGHT_FRAGMENT,
        depthTest: false,
        depthWrite: false,
      });
      this.blurMaterial = new three.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uDirection: { value: new three.Vector2(1, 0) },
        },
        vertexShader: BLOOM_VERTEX,
        fragmentShader: BLOOM_BLUR_FRAGMENT,
        depthTest: false,
        depthWrite: false,
      });
      this.compositeMaterial = new three.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          tBloom: { value: null },
          uStrength: { value: 0.3 },
        },
        vertexShader: BLOOM_VERTEX,
        fragmentShader: BLOOM_COMPOSITE_FRAGMENT,
        depthTest: false,
        depthWrite: false,
      });
      this.quad = new FullScreenQuad(this.brightMaterial);
    }

    setSize(width, height) {
      const scale = this.resolutionScale;
      const w = Math.max(2, Math.floor(width * scale));
      const h = Math.max(2, Math.floor(height * scale));
      if (w === this.width && h === this.height) return;
      this.width = w;
      this.height = h;
      this.brightTarget.setSize(w, h);
      this.blurTargetA.setSize(w, h);
      this.blurTargetB.setSize(w, h);
    }

    render(renderer, writeBuffer, readBuffer) {
      // 1. Bright pass at half resolution.
      this.brightMaterial.uniforms.tDiffuse.value = readBuffer.texture;
      this.brightMaterial.uniforms.uThreshold.value = this.threshold;
      this.brightMaterial.uniforms.uKnee.value = 0.08 + this.radius * 0.22;
      this.quad.material = this.brightMaterial;
      renderer.setRenderTarget(this.brightTarget);
      this.quad.render(renderer);

      // 2. Separable blur, horizontal then vertical.
      this.blurMaterial.uniforms.tDiffuse.value = this.brightTarget.texture;
      this.blurMaterial.uniforms.uDirection.value.set(1 / this.width, 0);
      this.quad.material = this.blurMaterial;
      renderer.setRenderTarget(this.blurTargetA);
      this.quad.render(renderer);

      this.blurMaterial.uniforms.tDiffuse.value = this.blurTargetA.texture;
      this.blurMaterial.uniforms.uDirection.value.set(0, 1 / this.height);
      renderer.setRenderTarget(this.blurTargetB);
      this.quad.render(renderer);

      // 3. Composite base + bloom into the write buffer (no self-sampling).
      this.compositeMaterial.uniforms.tDiffuse.value = readBuffer.texture;
      this.compositeMaterial.uniforms.tBloom.value = this.blurTargetB.texture;
      this.compositeMaterial.uniforms.uStrength.value = this.strength;
      this.quad.material = this.compositeMaterial;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this.quad.render(renderer);
    }

    dispose() {
      this.brightTarget.dispose();
      this.blurTargetA.dispose();
      this.blurTargetB.dispose();
      this.brightMaterial.dispose();
      this.blurMaterial.dispose();
      this.compositeMaterial.dispose();
      this.quad.dispose();
    }
  };
}

function makeFinalPass(Pass, FullScreenQuad, three) {
  return class FinalPassImpl extends Pass {
    constructor() {
      super();
      this.uniforms = {
        tDiffuse: { value: null },
        uVignette: { value: 0.22 },
        uWarm: { value: 0 },
        uNight: { value: 0 },
        uDesat: { value: 0 },
      };
      this.material = new three.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: BLOOM_VERTEX,
        fragmentShader: FINAL_FRAGMENT,
        depthTest: false,
        depthWrite: false,
      });
      this.quad = new FullScreenQuad(this.material);
    }

    render(renderer, writeBuffer, readBuffer) {
      this.material.uniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this.quad.render(renderer);
    }

    dispose() {
      this.material.dispose();
      this.quad.dispose();
    }
  };
}

const GOD_RAYS_FRAGMENT = /* glsl */ `
  uniform sampler2D tColor, tDepth;
  uniform vec2 uSun;
  uniform float uStrength, uAspect;
  uniform vec3 uColor;
  varying vec2 vUv;
  const int N = 24;
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
      // Only the sun disc and its bright aureole feed the rays.
      float l = dot(c, vec3(0.3, 0.5, 0.2));
      acc += sky * smoothstep(0.8, 4.0, l) * decay;
      decay *= 0.955;
    }
    vec2 sd = (vUv - uSun) * vec2(uAspect, 1.0);
    float fall = exp(-dot(sd, sd) * 1.6);
    gl_FragColor = vec4(
      base.rgb + uColor * min(acc / float(N), 1.0) * uStrength * fall * 0.9,
      base.a
    );
  }
`;

function makeGodRaysPass(Pass, FullScreenQuad, three) {
  return class GodRaysPassImpl extends Pass {
    constructor() {
      super();
      this.uniforms = {
        tColor: { value: null },
        tDepth: { value: null },
        uSun: { value: new three.Vector2(0.5, 0.5) },
        uStrength: { value: 0 },
        uColor: { value: new three.Color(1.0, 0.78, 0.5) },
        uAspect: { value: 1 },
      };
      this.material = new three.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader:
          'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: GOD_RAYS_FRAGMENT,
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
  };
}
