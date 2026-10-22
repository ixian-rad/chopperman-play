import * as THREE from 'three';

/**
 * Lazy post-processing pipeline.
 *
 * The modules are imported on demand so a software-rendered (SwiftShader) run
 * never pays the network/parse cost for a bloom or SSAO pass it cannot afford.
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
    this.outputPass = null;
    this.renderPass = null;
    this.targetPreset = null;
    this.width = 1;
    this.height = 1;
    this.failed = false;
  }

  async load() {
    if (this.loaded || this.loading || this.failed) return this.loaded;
    this.loading = true;
    try {
      const [
        { EffectComposer },
        { RenderPass },
        { UnrealBloomPass },
        { OutputPass },
      ] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/OutputPass.js'),
      ]);
      this.EffectComposer = EffectComposer;
      this.RenderPass = RenderPass;
      this.UnrealBloomPass = UnrealBloomPass;
      this.OutputPass = OutputPass;
      try {
        const mod = await import('three/addons/postprocessing/SSAOPass.js');
        this.SSAOPass = mod.SSAOPass;
      } catch {
        this.SSAOPass = null;
      }
      this.composer = new EffectComposer(this.renderer);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(this.renderPass);
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(this.width, this.height),
        0.3,
        0.55,
        0.86,
      );
      this.composer.addPass(this.bloom);
      this.outputPass = new OutputPass();
      this.composer.addPass(this.outputPass);
      this.loaded = true;
      return true;
    } catch {
      this.failed = true;
      this.enabled = false;
      return false;
    } finally {
      this.loading = false;
    }
  }

  async setQuality(preset) {
    this.targetPreset = preset;
    const wants = Boolean(preset && (preset.bloom || preset.ssao));
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
    this.bloom.strength = preset.bloomStrength ?? 0.3;
    this.bloom.radius = preset.ssao ? 0.6 : 0.5;
    this.bloom.threshold = 0.9;

    if (preset.ssao && this.SSAOPass && !this.ssao) {
      try {
        this.ssao = new this.SSAOPass(this.scene, this.camera, this.width, this.height);
        this.ssao.kernelRadius = 10;
        this.ssao.minDistance = 0.003;
        this.ssao.maxDistance = 0.12;
        // Insert after RenderPass, before bloom.
        this.composer.insertPass(this.ssao, 1);
      } catch {
        this.ssao = null;
      }
    }
    if (this.ssao) {
      this.ssao.enabled = Boolean(preset.ssao);
    }
    this.enabled = true;
    this.resize(this.width, this.height);
    return true;
  }

  resize(width, height, pixelRatio = null) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio ?? this.renderer.getPixelRatio());
      this.composer.setSize(this.width, this.height);
    }
    if (this.bloom) this.bloom.setSize(this.width, this.height);
    if (this.ssao) this.ssao.setSize(this.width, this.height);
  }

  render(dt) {
    if (this.enabled && this.composer) {
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    if (this.composer) {
      this.composer.dispose?.();
      this.composer = null;
    }
    this.loaded = false;
    this.enabled = false;
  }
}
