/**
 * WebGL acquisition + a headless-compatible renderer fallback.
 *
 * Some automated runs start Chrome with a stale DISPLAY (or a GPU process that
 * cannot initialise ANGLE). `new THREE.WebGLRenderer()` then logs two console
 * errors and throws before the game can boot. Probe for a context first on the
 * real canvas and pass it in, so a supported browser still takes the normal
 * WebGL path with no extra context. When no context exists, the simulation can
 * still run to completion with this small no-op renderer: gameplay, physics,
 * Rapier, telemetry and every automation hook stay live, while the HUD becomes
 * the visible layer (the canvas gets a CSS backdrop in fallback mode).
 *
 * The fallback deliberately implements only the renderer surface used by the
 * game. It never pretends to have a live GL context, so quality detection can
 * pin low quality and skip post-processing instead of trying to compile.
 */

const CONTEXT_ATTRIBUTES = Object.freeze({
  alpha: false,
  antialias: false,
  depth: true,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  failIfMajorPerformanceCaveat: false,
});

/**
 * Try to create a WebGL 2 context on the actual game canvas. Different drivers
 * disagree about power preference, so walk from the requested setting down to
 * the safest one. A failed getContext() is silent; Three never gets a chance to
 * log its context-creation errors.
 */
export function acquireWebGLContext(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  for (const powerPreference of ['high-performance', 'default', 'low-power']) {
    try {
      const context = canvas.getContext('webgl2', {
        ...CONTEXT_ATTRIBUTES,
        powerPreference,
      });
      if (context) return context;
    } catch {
      // Try the next power preference; the final null selects the fallback.
    }
  }
  return null;
}

export class FallbackRenderer {
  constructor(canvas = null) {
    this.domElement = canvas || (typeof document !== 'undefined'
      ? document.createElement('canvas')
      : null);
    this.isWebGLRenderer = false;
    this.isFallbackRenderer = true;
    this.shadowMap = {
      enabled: false,
      autoUpdate: false,
      needsUpdate: false,
      type: 0,
    };
    this.info = {
      render: { calls: 0, triangles: 0, points: 0, lines: 0, frame: 0 },
      memory: { geometries: 0, textures: 0 },
      programs: [],
    };
    this.capabilities = { isWebGL2: false, maxTextureSize: 0 };
    this.outputColorSpace = 'srgb';
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this.debug = { checkShaderErrors: false };
    this._pixelRatio = 1;
    this._width = 1;
    this._height = 1;
  }

  /** Intentionally null: there is no GL context in compatibility mode. */
  getContext() {
    return null;
  }

  getPixelRatio() {
    return this._pixelRatio;
  }

  setPixelRatio(value) {
    const ratio = Number(value);
    if (Number.isFinite(ratio) && ratio > 0) this._pixelRatio = ratio;
  }

  setSize(width, height, updateStyle = false) {
    this._width = Math.max(1, Math.floor(Number(width) || 1));
    this._height = Math.max(1, Math.floor(Number(height) || 1));
    if (updateStyle && this.domElement?.style) {
      this.domElement.style.width = `${width}px`;
      this.domElement.style.height = `${height}px`;
    }
  }

  getSize(target = null) {
    if (target && typeof target.set === 'function') {
      target.set(this._width, this._height);
      return target;
    }
    return { width: this._width, height: this._height };
  }

  getDrawingBufferSize(target = null) {
    const width = Math.max(1, Math.floor(this._width * this._pixelRatio));
    const height = Math.max(1, Math.floor(this._height * this._pixelRatio));
    if (target && typeof target.set === 'function') {
      target.set(width, height);
      return target;
    }
    return { width, height };
  }

  setRenderTarget() {}
  getRenderTarget() { return null; }
  setClearColor() {}
  setClearAlpha() {}
  setViewport() {}
  setScissor() {}
  setScissorTest() {}
  compile() {}
  render() {}
  clear() {}
  dispose() {}
  setAnimationLoop() {}
}
