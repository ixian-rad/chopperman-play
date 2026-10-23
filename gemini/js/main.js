import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as CANNON from 'cannon-es';

import { SoundEffects } from './audio.js';
import { buildBackyardEnvironment } from './environment.js';
import { ChoppingStation } from './chopping.js';
import { HumanoidChopper } from './humanoid.js';
import { PhysicsDebugWireframe } from './debugWireframe.js';
import { GameStateManager, LOG_TYPES, LOG_ORDER, AXE_TIERS } from './rpgState.js';
import { AtmosphereController } from './weatherAndLight.js';

/**
 * Main Application Entry Point for the 3D Backyard Lumberjack RPG & Physics Simulation.
 */
class AxeSplittingSimulation {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.slowMotion = false;
    this.timeScale = 1.0;
    this.fps = 60;
    this._frameCount = 0;
    this._fpsAccum = 0;
    this._lowFpsStreak = 0;

    // Timing / Power Meter state
    this.meterActive = false;
    this.meterPos = 0.78; // 0..1 along meter track (0.68..0.86 is Sweet Spot)
    this.meterDir = 1;
    this.baseSwingForce = 1.0;

    // Pending strike result evaluated at swing start so both synchronous and async tests see it
    this.pendingStrikeResult = null;
    this.autoSpawnTimer = 0;

    // Mouse gesture state
    this.raycaster = new THREE.Raycaster();
    this.mouseNDC = new THREE.Vector2();
    this.logTopPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.05);
    this.dragGesture = {
      active: false,
      startX: 0,
      startY: 0,
      peakUpDelta: 0,
      lastY: 0,
      lastTime: 0,
      downFlickSpeed: 0
    };

    this.sound = new SoundEffects();
    this.gameState = new GameStateManager(this.sound);

    this._initThree();
    this._initLights();
    this._initPhysics();

    // Build Suburban NJ Backyard, Chopping Station, Articulated Humanoid, Atmosphere & Debug Wireframes
    this.environment = buildBackyardEnvironment(
      this.scene,
      this.world,
      this.physMaterials
    );
    this.choppingStation = new ChoppingStation(
      this.scene,
      this.world,
      this.physMaterials,
      this.sound
    );
    this.humanoid = new HumanoidChopper(
      this.scene,
      this.world,
      this.physMaterials,
      this.choppingStation,
      this.sound
    );
    this.atmosphere = new AtmosphereController(
      this.scene,
      this.environment,
      this.lights,
      this.physContacts
    );
    this.debugWireframe = new PhysicsDebugWireframe(this.scene, this.world);

    // Sync initial log & axe visuals from saved RPG state
    this.choppingStation.spawnFreshLog(this.gameState.logType);
    this.humanoid.applyAxeVisuals(this.gameState.getEquippedAxe());

    // Wire blade impact callback from humanoid downswing to chopping station physics
    this.humanoid.onImpactCallback = (bladePos, bladeVel) => {
      this._handlePhysicalBladeImpact(bladePos, bladeVel);
    };

    this._initPostProcessingAndQuality();
    this._bindUI();
    this._bindMouseAimAndGestures();
    this._exposeGlobalAPI();
    this._refreshAllHUD();

    this._lastTickTime = performance.now();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);

    // Fallback timer ensures physics & swing animation progress at 1:1 wall-clock speed
    // even when headless browser compositors throttle requestAnimationFrame
    this._headlessTimer = setInterval(() => {
      const now = performance.now();
      if (now - this._lastTickTime >= 40) {
        this._stepFrame(false);
      }
    }, 25);
  }

  _initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdecbb8);
    this.scene.fog = new THREE.FogExp2(0xdecbb8, 0.012);

    this.camera = new THREE.PerspectiveCamera(
      46,
      window.innerWidth / window.innerHeight,
      0.1,
      160
    );
    this.camera.position.set(2.85, 1.92, 2.55);

    this.renderer = this._createResilientRenderer();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minDistance = 1.1;
    this.controls.maxDistance = 18.0;
    this.controls.target.set(0, 1.05, -0.18);
    // Reserve Left-Click on the log area for aiming & swing flick gestures; Right-Click & Middle-Click orbit/pan
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };
    this.controls.update();

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      if (this.composer) {
        this.composer.setSize(w, h);
      }
    });
  }

  _createResilientRenderer() {
    const canvas = document.createElement('canvas');
    let gl = null;
    try {
      gl =
        canvas.getContext('webgl2', { antialias: true }) ||
        canvas.getContext('webgl', { antialias: true }) ||
        canvas.getContext('webgl2', { antialias: false }) ||
        canvas.getContext('webgl', { antialias: false });
    } catch {
      gl = null;
    }

    if (gl) {
      try {
        return new THREE.WebGLRenderer({ canvas, context: gl, antialias: true });
      } catch {
        // Fall through to 2D canvas fallback
      }
    }

    const fallbackCanvas = document.createElement('canvas');
    const ctx = fallbackCanvas.getContext('2d');
    this._isFallback2D = true;

    // If Chrome's software GPU process is still warming up at page load, retry upgrading to WebGL shortly
    [200, 600, 1200].forEach((delay) => {
      setTimeout(() => this._tryUpgradeFallbackToWebGL(), delay);
    });

    return {
      domElement: fallbackCanvas,
      shadowMap: { enabled: false, type: 0 },
      toneMapping: 0,
      toneMappingExposure: 1.0,
      setSize(w, h) {
        fallbackCanvas.width = w;
        fallbackCanvas.height = h;
      },
      setPixelRatio() {},
      getContext() {
        return null;
      },
      render() {
        if (!ctx) return;
        const w = fallbackCanvas.width || 800;
        const h = fallbackCanvas.height || 600;
        ctx.fillStyle = '#6298d4';
        ctx.fillRect(0, 0, w, h * 0.55);
        ctx.fillStyle = '#3f6e2a';
        ctx.fillRect(0, h * 0.55, w, h * 0.45);
      }
    };
  }

  _tryUpgradeFallbackToWebGL() {
    if (!this._isFallback2D) return;
    const canvas = document.createElement('canvas');
    let gl = null;
    try {
      gl =
        canvas.getContext('webgl2', { antialias: true }) ||
        canvas.getContext('webgl', { antialias: true }) ||
        canvas.getContext('webgl2', { antialias: false }) ||
        canvas.getContext('webgl', { antialias: false });
    } catch {
      gl = null;
    }
    if (!gl) return;

    try {
      const glRenderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true });
      glRenderer.setSize(window.innerWidth, window.innerHeight);
      glRenderer.setPixelRatio(1.0);
      glRenderer.shadowMap.enabled = false;
      glRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      glRenderer.toneMappingExposure = 1.08;

      if (this.renderer && this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.replaceChild(
          glRenderer.domElement,
          this.renderer.domElement
        );
      }
      if (this.controls && typeof this.controls.dispose === 'function') {
        this.controls.dispose();
      }
      this.renderer = glRenderer;
      this._isFallback2D = false;
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.06;
      this.controls.maxPolarAngle = Math.PI * 0.485;
      this.controls.minDistance = 1.1;
      this.controls.maxDistance = 18.0;
      this.controls.target.set(0, 1.05, -0.18);
      this.controls.update();

      this._initPostProcessingAndQuality();
      this._bindMouseAimAndGestures();
    } catch {
      // Keep 2D fallback if WebGLRenderer still fails
    }
  }

  _initLights() {
    const hemiLight = new THREE.HemisphereLight(0xfce3c8, 0x4b5c32, 0.72);
    hemiLight.position.set(0, 20, 0);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffd296, 2.45);
    sunLight.position.set(7.5, 12.5, 6.2);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 1.0;
    sunLight.shadow.camera.far = 36.0;
    const d = 11.5;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    this.scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x9ec5eb, 0.42);
    rimLight.position.set(-6, 5, -8);
    this.scene.add(rimLight);

    // Warm house porch coach lantern
    const porchLight = new THREE.PointLight(0xffcb7d, 1.2, 8.0, 1.8);
    porchLight.position.set(-0.38, 2.45, -8.9);
    this.scene.add(porchLight);

    // Warm yard lantern right next to the chopping block
    const yardLight = new THREE.PointLight(0xffb85c, 1.6, 6.5, 1.7);
    yardLight.position.set(-1.03, 1.60, 0.15);
    this.scene.add(yardLight);

    this.lights = {
      hemiLight,
      sunLight,
      rimLight,
      porchLight,
      yardLight
    };
  }

  _initPhysics() {
    this.world = new CANNON.World();
    this.world.gravity.set(0, -9.81, 0);
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.solver.iterations = 10;

    const groundPhysMat = new CANNON.Material('groundMaterial');
    const woodPhysMat = new CANNON.Material('woodMaterial');
    const steelPhysMat = new CANNON.Material('steelMaterial');

    const woodGroundContact = new CANNON.ContactMaterial(
      woodPhysMat,
      groundPhysMat,
      {
        friction: 0.62,
        restitution: 0.24
      }
    );

    const woodWoodContact = new CANNON.ContactMaterial(
      woodPhysMat,
      woodPhysMat,
      {
        friction: 0.55,
        restitution: 0.28
      }
    );

    const steelWoodContact = new CANNON.ContactMaterial(
      steelPhysMat,
      woodPhysMat,
      {
        friction: 0.35,
        restitution: 0.15
      }
    );

    this.world.addContactMaterial(woodGroundContact);
    this.world.addContactMaterial(woodWoodContact);
    this.world.addContactMaterial(steelWoodContact);

    this.physMaterials = {
      groundPhysMat,
      woodPhysMat,
      steelPhysMat
    };
    this.physContacts = {
      woodGroundContact,
      woodWoodContact,
      steelWoodContact
    };
  }

  /**
   * Sets up EffectComposer (RenderPass, SSAOPass, UnrealBloomPass, OutputPass),
   * detects software rendering (SwiftShader / llvmpipe), and configures Quality Presets.
   */
  _initPostProcessingAndQuality() {
    if (this._isFallback2D) {
      this.useComposer = false;
      this.qualityPreset = 'low';
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    try {
      this.ssaoPass = new SSAOPass(this.scene, this.camera, w, h);
      this.ssaoPass.kernelRadius = 0.35;
      this.ssaoPass.minDistance = 0.002;
      this.ssaoPass.maxDistance = 0.08;
      this.ssaoPass.enabled = false;
      this.composer.addPass(this.ssaoPass);
    } catch {
      this.ssaoPass = null;
    }

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.24, // strength
      0.45, // radius
      0.86  // threshold
    );
    this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    // Detect software WebGL renderer (e.g. SwiftShader, llvmpipe, Mesa OffScreen)
    let isSoftwareGL = false;
    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const rendererStr = dbg
        ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      if (
        typeof rendererStr === 'string' &&
        /swiftshader|llvmpipe|software|softpipe|mesa offscreen/i.test(rendererStr)
      ) {
        isSoftwareGL = true;
      }
    } catch {
      // Ignore WebGL debug extension errors
    }

    this.qualityPreset = isSoftwareGL ? 'low' : 'high';
    this.setQualityPreset(this.qualityPreset);
  }

  setQualityPreset(preset) {
    this.qualityPreset = preset;
    const selectEl = document.getElementById('quality-select');
    const badgeEl = document.getElementById('quality-badge');
    if (selectEl && selectEl.value !== preset) {
      selectEl.value = preset;
    }

    const labels = {
      ultra: 'Ultra',
      high: 'High',
      medium: 'Medium',
      low: 'Low (Fast)'
    };
    if (badgeEl) badgeEl.textContent = labels[preset] || preset;

    if (preset === 'ultra') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      if (this.ssaoPass) this.ssaoPass.enabled = true;
      if (this.bloomPass) this.bloomPass.enabled = true;
      this.useComposer = true;
    } else if (preset === 'high') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.renderer.shadowMap.enabled = true;
      if (this.ssaoPass) this.ssaoPass.enabled = false;
      if (this.bloomPass) this.bloomPass.enabled = true;
      this.useComposer = true;
    } else if (preset === 'medium') {
      this.renderer.setPixelRatio(1.0);
      this.renderer.shadowMap.enabled = true;
      if (this.ssaoPass) this.ssaoPass.enabled = false;
      if (this.bloomPass) this.bloomPass.enabled = false;
      this.useComposer = false;
    } else {
      // 'low' (Software Renderer safe preset)
      this.renderer.setPixelRatio(1.0);
      this.renderer.shadowMap.enabled = false;
      if (this.ssaoPass) this.ssaoPass.enabled = false;
      if (this.bloomPass) this.bloomPass.enabled = false;
      this.useComposer = false;
    }
  }

  _checkPerformanceAutoDowngrade(dt) {
    if (this.qualityPreset === 'low') return;
    if (this.fps < 25) {
      this._lowFpsStreak += dt;
      if (this._lowFpsStreak >= 1.4) {
        this._lowFpsStreak = 0;
        const order = ['ultra', 'high', 'medium', 'low'];
        const idx = order.indexOf(this.qualityPreset);
        if (idx >= 0 && idx < order.length - 1) {
          this.setQualityPreset(order[idx + 1]);
        }
      }
    } else {
      this._lowFpsStreak = Math.max(0, this._lowFpsStreak - dt * 0.5);
    }
  }

  /**
   * Binds Mouse Aiming on the 3D Log + Left-Click Drag-Up & Flick-Down Swing Gesture.
   */
  _bindMouseAimAndGestures() {
    const dom = this.renderer.domElement;

    dom.addEventListener('pointermove', (e) => {
      const rect = dom.getBoundingClientRect();
      this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Project cursor onto the horizontal plane of the log's top surface
      const logTopY =
        this.choppingStation.blockHeight + this.choppingStation.logHeight;
      this.logTopPlane.constant = -logTopY;
      this.raycaster.setFromCamera(this.mouseNDC, this.camera);

      const hitPt = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.logTopPlane, hitPt)) {
        const dx = hitPt.x - this.choppingStation.blockPosition.x;
        const dz = hitPt.z - this.choppingStation.blockPosition.z;
        if (Math.abs(dx) < 0.45 && Math.abs(dz) < 0.45 && !this.dragGesture.active) {
          // Wind weather adds a subtle gust drift to cursor aim
          const windDrift =
            this.atmosphere.weather === 'wind'
              ? this.atmosphere.windVector.x * 0.015
              : 0;
          this.choppingStation.setAim(dx + windDrift, dz * 0.65);
          this._updateAimReadout();
        }
      }

      // Handle active drag-to-windup & flick-down-to-swing gesture
      if (this.dragGesture.active) {
        const now = performance.now();
        const dy = e.clientY - this.dragGesture.lastY;
        const dtMs = Math.max(4, now - this.dragGesture.lastTime);

        // Pulling mouse UP (negative clientY delta from start) coils the humanoid overhead
        const upDelta = Math.max(0, this.dragGesture.startY - e.clientY);
        if (upDelta > this.dragGesture.peakUpDelta) {
          this.dragGesture.peakUpDelta = upDelta;
        }
        const windupRatio = Math.min(1.0, this.dragGesture.peakUpDelta / 90);
        if (windupRatio > 0.08 && this.humanoid.state !== 'DOWNSWING') {
          this.humanoid.setDragWindup(windupRatio);
          // Sync timing meter needle with drag charge
          this.meterPos = Math.min(0.95, 0.25 + windupRatio * 0.56);
          this._updateTimingNeedleDOM();
        }

        // Track downward flick speed (positive dy)
        if (dy > 4) {
          this.dragGesture.downFlickSpeed = dy / dtMs;
          // Lateral flick angle sets strike angle
          const latDx = e.clientX - this.dragGesture.startX;
          this.choppingStation.setAim(
            this.choppingStation.aimOffsetX,
            Math.max(-0.45, Math.min(0.45, (latDx / 180) * 0.4))
          );
          this._updateAimReadout();

          // If player coiled up and flicked down sharply, unleash the swing immediately!
          if (this.dragGesture.peakUpDelta > 24 && this.dragGesture.downFlickSpeed > 0.65) {
            this.dragGesture.active = false;
            this.controls.enabled = true;
            const flickPower = Math.min(
              1.45,
              0.75 + this.dragGesture.downFlickSpeed * 0.32
            );
            this._commitPlayerSwing(flickPower, true);
          }
        }

        this.dragGesture.lastY = e.clientY;
        this.dragGesture.lastTime = now;
      }
    });

    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // Only Left-Click triggers aim/flick gesture

      // If timing meter is actively oscillating, clicking anywhere on canvas locks the needle & swings!
      if (this.meterActive) {
        this.triggerTimingMeterStep();
        return;
      }

      // Check if cursor is near the log/chopper in the center of the viewport
      const rect = dom.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      if (Math.abs(nx) < 0.48 && Math.abs(ny) < 0.55) {
        this.controls.enabled = false; // Temporarily pause OrbitControls during flick gesture
        this.dragGesture.active = true;
        this.dragGesture.startX = e.clientX;
        this.dragGesture.startY = e.clientY;
        this.dragGesture.peakUpDelta = 0;
        this.dragGesture.lastY = e.clientY;
        this.dragGesture.lastTime = performance.now();
        this.dragGesture.downFlickSpeed = 0;
      }
    });

    window.addEventListener('pointerup', () => {
      if (this.dragGesture.active) {
        this.dragGesture.active = false;
        this.controls.enabled = true;
        if (this.dragGesture.peakUpDelta > 18) {
          const chargePower = Math.min(
            1.35,
            0.65 + (this.dragGesture.peakUpDelta / 100) * 0.6
          );
          this._commitPlayerSwing(chargePower, true);
        } else {
          this.humanoid.cancelDragWindup();
        }
      }
    });
  }

  _bindUI() {
    this.forceSlider = document.getElementById('force-slider');
    this.forceValueEl = document.getElementById('force-value');
    this.swingBtn = document.getElementById('swing-btn');
    this.meterSwingBtn = document.getElementById('meter-swing-btn');
    this.timingTrack = document.getElementById('timing-meter-track');
    this.resetBtn = document.getElementById('reset-btn');
    this.rotLeftBtn = document.getElementById('rot-left-btn');
    this.rotRightBtn = document.getElementById('rot-right-btn');
    this.slowmoToggle = document.getElementById('slowmo-toggle');
    this.wireframeToggle = document.getElementById('wireframe-toggle');
    this.logSelect = document.getElementById('log-select');
    this.autoLogToggle = document.getElementById('auto-log-toggle');
    this.timeSlider = document.getElementById('time-slider');
    this.timeValueEl = document.getElementById('time-value');
    this.qualitySelect = document.getElementById('quality-select');

    this.statusBadge = document.getElementById('status-badge');
    this.statSpeed = document.getElementById('stat-speed');
    this.statPieces = document.getElementById('stat-pieces');
    this.statBodies = document.getElementById('stat-bodies');
    this.statFps = document.getElementById('stat-fps');

    if (this.forceSlider) {
      this.forceSlider.addEventListener('input', () => {
        const pct = Number(this.forceSlider.value);
        this.baseSwingForce = pct / 100;
        this.humanoid.swingForce = this.baseSwingForce;
        if (this.forceValueEl) {
          this.forceValueEl.textContent = `${pct}%`;
        }
      });
    }

    if (this.swingBtn) {
      this.swingBtn.addEventListener('click', () => {
        this._commitPlayerSwing(this.baseSwingForce, false);
      });
    }

    if (this.meterSwingBtn) {
      this.meterSwingBtn.addEventListener('click', () => {
        this.triggerTimingMeterStep();
      });
    }

    if (this.timingTrack) {
      this.timingTrack.addEventListener('click', () => {
        this.triggerTimingMeterStep();
      });
    }

    if (this.resetBtn) {
      this.resetBtn.addEventListener('click', () => {
        this.resetScene();
      });
    }

    if (this.rotLeftBtn) {
      this.rotLeftBtn.addEventListener('click', () => {
        this.choppingStation.rotateLog(-0.26);
        this._updateAimReadout();
      });
    }

    if (this.rotRightBtn) {
      this.rotRightBtn.addEventListener('click', () => {
        this.choppingStation.rotateLog(0.26);
        this._updateAimReadout();
      });
    }

    if (this.slowmoToggle) {
      this.slowmoToggle.addEventListener('change', () => {
        this.setSlowMotion(this.slowmoToggle.checked);
      });
    }

    if (this.wireframeToggle) {
      this.wireframeToggle.addEventListener('change', () => {
        this.debugWireframe.setEnabled(this.wireframeToggle.checked);
      });
    }

    if (this.autoLogToggle) {
      this.autoLogToggle.checked = this.gameState.autoProgressLogs;
      this.autoLogToggle.addEventListener('change', () => {
        this.gameState.autoProgressLogs = this.autoLogToggle.checked;
        this.gameState.saveToStorage();
      });
    }

    if (this.logSelect) {
      this.logSelect.addEventListener('change', () => {
        const chosen = this.logSelect.value;
        if (this.gameState.setLogType(chosen, true)) {
          this.choppingStation.reset(chosen);
          this._refreshAllHUD();
        }
      });
    }

    // Weather buttons
    document.querySelectorAll('[data-weather]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = btn.getAttribute('data-weather');
        document
          .querySelectorAll('[data-weather]')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.atmosphere.setWeather(w);
        this._updateWeatherBadge(w);
      });
    });

    // Time of Day slider & preset buttons
    if (this.timeSlider) {
      this.timeSlider.addEventListener('input', () => {
        const tod = Number(this.timeSlider.value);
        this.atmosphere.setTimeOfDay(tod);
        this._updateTimeLabel(tod);
      });
    }

    document.querySelectorAll('[data-tod]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tod = Number(btn.getAttribute('data-tod'));
        document
          .querySelectorAll('[data-tod]')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (this.timeSlider) this.timeSlider.value = String(tod);
        this.atmosphere.setTimeOfDay(tod);
        this._updateTimeLabel(tod);
      });
    });

    if (this.qualitySelect) {
      this.qualitySelect.addEventListener('change', () => {
        this.setQualityPreset(this.qualitySelect.value);
      });
    }

    // Camera preset buttons
    document.querySelectorAll('[data-cam-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-cam-preset');
        this.setCameraPreset(preset);
      });
    });

    // Upgrade Shop Modal & Reset Progress buttons
    const shopModal = document.getElementById('shop-modal');
    const openShopBtn = document.getElementById('open-shop-btn');
    const closeShopBtn = document.getElementById('close-shop-btn');
    const resetProgBtn = document.getElementById('reset-progress-btn');

    if (openShopBtn && shopModal) {
      openShopBtn.addEventListener('click', () => {
        this._refreshShopUI();
        shopModal.classList.remove('hidden');
      });
    }
    if (closeShopBtn && shopModal) {
      closeShopBtn.addEventListener('click', () => {
        shopModal.classList.add('hidden');
      });
    }
    if (resetProgBtn) {
      resetProgBtn.addEventListener('click', () => {
        this.gameState.resetProgress();
        this.humanoid.applyAxeVisuals(this.gameState.getEquippedAxe());
        this.resetScene();
        this._refreshAllHUD();
      });
    }

    // Core Stat upgrade buttons inside Shop
    const bindStatBtn = (id, statName) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', () => {
          if (this.gameState.upgradeStat(statName)) {
            this._refreshAllHUD();
            this._refreshShopUI();
          }
        });
      }
    };
    bindStatBtn('upg-sharp-btn', 'sharpness');
    bindStatBtn('upg-weight-btn', 'weight');
    bindStatBtn('upg-stam-btn', 'stamina');

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.triggerTimingMeterStep();
      } else if (e.code === 'KeyF') {
        this._commitPlayerSwing(this.baseSwingForce, false);
      } else if (e.code === 'KeyR') {
        this.resetScene();
      } else if (e.code === 'KeyQ') {
        this.choppingStation.rotateLog(-0.24);
        this._updateAimReadout();
      } else if (e.code === 'KeyE') {
        this.choppingStation.rotateLog(0.24);
        this._updateAimReadout();
      } else if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        this.choppingStation.setAim(
          this.choppingStation.aimOffsetX - 0.018,
          this.choppingStation.aimAngle
        );
        this._updateAimReadout();
      } else if (e.code === 'KeyD' && e.shiftKey) {
        const next = this.debugWireframe.toggle();
        if (this.wireframeToggle) this.wireframeToggle.checked = next;
      } else if (e.code === 'ArrowRight') {
        this.choppingStation.setAim(
          this.choppingStation.aimOffsetX + 0.018,
          this.choppingStation.aimAngle
        );
        this._updateAimReadout();
      } else if (e.code === 'KeyM') {
        this.setSlowMotion(!this.slowMotion);
      } else if (e.code === 'KeyD') {
        const next = this.debugWireframe.toggle();
        if (this.wireframeToggle) this.wireframeToggle.checked = next;
      } else if (e.code === 'KeyU') {
        if (shopModal) {
          this._refreshShopUI();
          shopModal.classList.toggle('hidden');
        }
      }
    });
  }

  /**
   * Starts or stops the oscillating Timing / Power Meter.
   */
  triggerTimingMeterStep() {
    const statusEl = document.getElementById('meter-status');
    const btnEl = document.getElementById('meter-swing-btn');

    if (!this.meterActive) {
      this.meterActive = true;
      this.meterPos = 0.08;
      this.meterDir = 1;
      if (statusEl) {
        statusEl.innerHTML = '<strong>LOCK NOW!</strong> Stop needle in Golden 135% Zone!';
      }
      if (btnEl) {
        btnEl.innerHTML = '&#9889; LOCK POWER <kbd>Space</kbd>';
      }
      return;
    }

    // Stop needle & evaluate timing zone
    this.meterActive = false;
    if (btnEl) {
      btnEl.innerHTML = '&#9654; Timing Swing <kbd>Space</kbd>';
    }

    let powerMult = 1.0;
    if (this.meterPos >= 0.68 && this.meterPos <= 0.86) {
      // Sweet spot! 135% power & tightened aim accuracy!
      powerMult = 1.35;
      this.choppingStation.setAim(
        this.choppingStation.aimOffsetX * 0.5,
        this.choppingStation.aimAngle * 0.5
      );
      if (statusEl) statusEl.textContent = 'PERFECT TIMING! (135% Cleave Power)';
    } else if (this.meterPos >= 0.35 && this.meterPos < 0.68) {
      powerMult = 1.05;
      if (statusEl) statusEl.textContent = 'Solid Timing (105% Power)';
    } else if (this.meterPos > 0.86) {
      // Wild overcharge: high power but slight aim scatter
      powerMult = 1.15;
      this.choppingStation.setAim(
        this.choppingStation.aimOffsetX + (Math.random() - 0.5) * 0.06,
        this.choppingStation.aimAngle
      );
      if (statusEl) statusEl.textContent = 'Overcharged Wild Swing!';
    } else {
      powerMult = 0.62;
      if (statusEl) statusEl.textContent = 'Weak Early Release (62% Power)';
    }

    this._commitPlayerSwing(this.baseSwingForce * powerMult, false);
  }

  /**
   * Evaluates a player or automated swing in `gameState` and initiates the 3D swing animation.
   */
  _commitPlayerSwing(
    swingPower = 1.0,
    skipWindup = false,
    isAutomatedSwing = false
  ) {
    // If previous swing was still mid-flight without having impacted yet, flush its physics first
    if (this.pendingStrikeResult && !this.humanoid.hasTriggeredSplit) {
      this._handlePhysicalBladeImpact(null, null);
    }

    // If current log on the block is already split, spawn the next log so the swing hits fresh wood
    if (this.choppingStation.isLogSplit) {
      const nextSpecies = this.gameState.advanceNextLog();
      this.choppingStation.reset(nextSpecies);
    }

    const diag = this.choppingStation.getAimDiagnostics();
    const strikeResult = this.gameState.evaluateStrike({
      aimOffsetX: isAutomatedSwing ? 0 : diag.aimOffsetX,
      grainAngleError: isAutomatedSwing ? 0 : diag.grainAngleError,
      knotDistance: isAutomatedSwing ? 1.0 : diag.knotDistance,
      swingPower,
      weather: this.atmosphere.weather,
      isAutomatedSwing
    });

    this.pendingStrikeResult = strikeResult;
    this.humanoid.swingForce = swingPower;
    this.humanoid.triggerSwing(swingPower, skipWindup);
    this._refreshAllHUD();
    this._showHitBanner(strikeResult);
    return strikeResult;
  }

  /**
   * Invoked when the humanoid's axe blade reaches the top of the log on the downswing.
   */
  _handlePhysicalBladeImpact(bladeWorldPos, bladeVelocity) {
    const result = this.pendingStrikeResult;
    this.pendingStrikeResult = null;

    this.choppingStation.executeStrikePhysics({
      strikeResult: result,
      swingForce: this.humanoid.swingForce,
      impactPoint: bladeWorldPos,
      axeVelocity: bladeVelocity,
      wedgePower: this.gameState.getEffectiveWedgePower(),
      weather: this.atmosphere.weather
    });

    // If the log split cleanly, schedule next log spawn after pieces settle (1.5s)
    if (this.choppingStation.isLogSplit) {
      this.autoSpawnTimer = 1.55;
    }

    this._refreshAllHUD();
  }

  setSlowMotion(enabled) {
    this.slowMotion = Boolean(enabled);
    this.timeScale = this.slowMotion ? 0.22 : 1.0;
    if (this.slowmoToggle) {
      this.slowmoToggle.checked = this.slowMotion;
    }
  }

  setCameraPreset(preset) {
    if (preset === 'default') {
      this.camera.position.set(2.85, 1.92, 2.55);
      this.controls.target.set(0, 1.05, -0.18);
    } else if (preset === 'side') {
      this.camera.position.set(2.65, 1.38, -0.22);
      this.controls.target.set(0, 1.12, -0.22);
    } else if (preset === 'closeup') {
      this.camera.position.set(1.25, 1.26, 1.25);
      this.controls.target.set(0, 0.85, 0.28);
    } else if (preset === 'yard') {
      this.camera.position.set(-4.8, 3.6, 5.4);
      this.controls.target.set(0, 1.2, -1.8);
    }
    this.controls.update();
  }

  /**
   * Triggers a clean, centered axe swing without user input.
   * Exposed globally as `window.swing(power?)` for automated testing.
   */
  swing(forceOverride = null) {
    let power = this.baseSwingForce;
    if (forceOverride !== null && !Number.isNaN(Number(forceOverride))) {
      const f = Number(forceOverride);
      const normalized = f > 2.5 ? f / 100 : f;
      power = Math.max(0.2, Math.min(1.5, normalized));
      this.baseSwingForce = power;
      if (this.forceSlider) {
        this.forceSlider.value = String(Math.round(power * 100));
      }
      if (this.forceValueEl) {
        this.forceValueEl.textContent = `${Math.round(power * 100)}%`;
      }
    }

    // Center aim along the grain check line for a clean automated hit
    this.choppingStation.setAim(0, 0);
    this._commitPlayerSwing(power, false, true);
    return true;
  }

  /**
   * Resets the current log, humanoid, and particles.
   * Exposed globally as `window.resetScene()`.
   */
  resetScene() {
    this.pendingStrikeResult = null;
    this.autoSpawnTimer = 0;
    this.gameState.resetCurrentLogHp();
    this.choppingStation.reset(this.gameState.logType);
    this.humanoid.reset();
    if (this.debugWireframe.enabled) {
      this.debugWireframe.update();
    }
    this._refreshAllHUD();
    return true;
  }

  /**
   * Returns current RPG and game telemetry snapshot.
   * Exposed globally as `window.getGameState()`.
   */
  getGameState() {
    return this.gameState.getGameStateSnapshot();
  }

  _exposeGlobalAPI() {
    window.swing = (power) => this.swing(power);
    window.resetScene = () => this.resetScene();
    window.getGameState = () => this.getGameState();
    window.sim = this;
  }

  _updateWeatherBadge(weather) {
    const pill = document.getElementById('weather-effect-pill');
    if (!pill) return;
    const labels = {
      sun: 'Dry Grip (1.0x)',
      rain: 'Slippery Bark (+20% XP)',
      snow: 'Frozen Brittle (+25% XP)',
      wind: 'Gust Drift (+15% XP)',
      fog: 'Dense Mist (+20% XP)'
    };
    pill.textContent = labels[weather] || weather;
  }

  _updateTimeLabel(tod) {
    if (!this.timeValueEl) return;
    const hrs = Math.floor(tod);
    const mins = Math.floor((tod - hrs) * 60);
    const hh = String(hrs).padStart(2, '0');
    const mm = String(mins).padStart(2, '0');
    const phase =
      tod < 5.6 || tod > 19.4
        ? 'Night'
        : tod < 8.0
        ? 'Dawn'
        : tod > 16.0
        ? 'Golden Hr'
        : 'Day';
    this.timeValueEl.textContent = `${hh}:${mm} (${phase})`;
  }

  _updateAimReadout() {
    const el = document.getElementById('aim-readout');
    if (!el) return;
    const diag = this.choppingStation.getAimDiagnostics();
    const cm = (diag.aimOffsetX * 100).toFixed(1);
    const deg = Math.round((diag.grainAngleError * 180) / Math.PI);
    const knotWarn = diag.knotDistance < 0.04 ? ' \u26A0 KNOT HAZARD!' : '';
    el.textContent = `Aim: ${cm} cm \u2022 Grain Offset: ${deg}\u00B0${knotWarn}`;
  }

  _updateTimingNeedleDOM() {
    const needle = document.getElementById('timing-needle');
    if (needle) {
      needle.style.left = `${(this.meterPos * 100).toFixed(1)}%`;
    }
  }

  _showHitBanner(result) {
    const banner = document.getElementById('hit-banner');
    const title = document.getElementById('hit-banner-title');
    const sub = document.getElementById('hit-banner-sub');
    if (!banner || !title || !sub || !result) return;

    title.textContent = result.rating;
    title.style.color = result.glancing
      ? '#f87171'
      : result.split
      ? '#fde047'
      : '#fb923c';

    const ptsSign = result.points >= 0 ? `+${result.points}` : `${result.points}`;
    const lvlTag = result.leveledUp ? ' \u2022 LEVEL UP!' : '';
    sub.textContent = `${ptsSign} PTS \u2022 +${result.xpGained} XP \u2022 ${this.gameState.combo}\u00D7 STREAK${lvlTag}`;

    banner.classList.remove('hidden');
    clearTimeout(this._bannerTimeout);
    this._bannerTimeout = setTimeout(() => {
      banner.classList.add('hidden');
    }, 2200);
  }

  _refreshAllHUD() {
    const gs = this.gameState;
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('hud-score', String(gs.score));
    setTxt('hud-combo', `${gs.combo}\u00D7`);
    setTxt('hud-credits', `\u2605 ${gs.credits}`);
    setTxt('hud-level', `LVL ${gs.level}`);

    const nextXp = gs.getXpForNextLevel();
    setTxt('hud-xp-text', `${gs.xp} / ${nextXp} XP`);
    const xpFill = document.getElementById('hud-xp-fill');
    if (xpFill) {
      xpFill.style.width = `${Math.min(100, (gs.xp / nextXp) * 100).toFixed(1)}%`;
    }

    setTxt(
      'hud-stamina-text',
      `${Math.round(gs.stamina)} / ${gs.maxStamina}`
    );
    const stamFill = document.getElementById('hud-stamina-fill');
    if (stamFill) {
      stamFill.style.width = `${Math.min(
        100,
        (gs.stamina / gs.maxStamina) * 100
      ).toFixed(1)}%`;
    }

    const logDef = gs.getCurrentLogDef();
    setTxt('hud-log-name', logDef.name);
    setTxt(
      'hud-log-hp-text',
      `${Math.round(gs.currentLogHp)} / ${gs.currentLogMaxHp} HP`
    );
    const logHpFill = document.getElementById('hud-log-hp-fill');
    if (logHpFill) {
      logHpFill.style.width = `${Math.min(
        100,
        (gs.currentLogHp / gs.currentLogMaxHp) * 100
      ).toFixed(1)}%`;
    }

    // Populate Log Species dropdown
    if (this.logSelect) {
      this.logSelect.innerHTML = '';
      LOG_ORDER.forEach((id) => {
        const def = LOG_TYPES[id];
        const opt = document.createElement('option');
        opt.value = id;
        const locked = def.unlockLevel > gs.level;
        opt.textContent = locked
          ? `${def.name} (Unlocks Lv ${def.unlockLevel} - Click to Preview)`
          : `${def.name} (${def.toughness} HP \u2022 ${def.basePoints} Pts)`;
        if (id === gs.logType) opt.selected = true;
        this.logSelect.appendChild(opt);
      });
    }

    const descEl = document.getElementById('log-desc');
    if (descEl) descEl.textContent = logDef.description;

    this._updateTelemetry();
    this._updateAimReadout();
  }

  _refreshShopUI() {
    const gs = this.gameState;
    const credEl = document.getElementById('shop-credits-display');
    if (credEl) credEl.textContent = `\u2605 ${gs.credits} Credits`;

    const updateStatRow = (lvlId, btnId, statName, curLvl) => {
      const lEl = document.getElementById(lvlId);
      const bEl = document.getElementById(btnId);
      if (lEl) lEl.textContent = `Lv ${curLvl}`;
      if (bEl) {
        const cost = gs.getUpgradeCost(statName);
        if (cost === null) {
          bEl.textContent = 'MAXED';
          bEl.disabled = true;
        } else {
          bEl.textContent = `Upgrade (\u2605 ${cost})`;
          bEl.disabled = gs.credits < cost;
        }
      }
    };

    updateStatRow('upg-sharp-lvl', 'upg-sharp-btn', 'sharpness', gs.sharpnessLevel);
    updateStatRow('upg-weight-lvl', 'upg-weight-btn', 'weight', gs.weightLevel);
    updateStatRow('upg-stam-lvl', 'upg-stam-btn', 'stamina', gs.staminaLevel);

    const axeList = document.getElementById('axe-shop-list');
    if (axeList) {
      axeList.innerHTML = '';
      AXE_TIERS.forEach((axe) => {
        const owned = gs.unlockedAxes.includes(axe.id);
        const equipped = gs.equippedAxeId === axe.id;

        const row = document.createElement('div');
        row.className = 'upgrade-item';
        row.innerHTML = `
          <div class="upgrade-info">
            <strong>${axe.name} <span class="lvl-tag">${axe.massKg} kg \u2022 ${Math.round(
          axe.sharpnessBonus * 100
        )}% Sharp</span></strong>
            <small>${axe.desc}</small>
          </div>
        `;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn btn-buy ${equipped ? 'btn-equipped' : ''}`;
        if (equipped) {
          btn.textContent = 'Equipped';
          btn.disabled = true;
        } else if (owned) {
          btn.textContent = 'Equip';
        } else {
          btn.textContent = `Buy (\u2605 ${axe.cost})`;
          btn.disabled = gs.credits < axe.cost;
        }

        btn.addEventListener('click', () => {
          if (gs.buyOrEquipAxe(axe.id)) {
            this.humanoid.applyAxeVisuals(gs.getEquippedAxe());
            this._refreshAllHUD();
            this._refreshShopUI();
          }
        });

        row.appendChild(btn);
        axeList.appendChild(row);
      });
    }
  }

  _updateTelemetry() {
    if (this.statusBadge) {
      let label = 'Ready';
      let cls = 'status-ready';
      if (this.humanoid.state !== 'IDLE') {
        label = `Swinging (${this.humanoid.state.replace('_', ' ')})`;
        cls = 'status-active';
      } else if (this.choppingStation.isLogSplit) {
        label = 'Log Split!';
        cls = 'status-split';
      }
      this.statusBadge.textContent = label;
      this.statusBadge.className = `status-badge ${cls}`;
    }

    if (this.statSpeed) {
      const spd = this.choppingStation.lastImpactSpeed;
      this.statSpeed.textContent = spd > 0 ? `${spd.toFixed(1)} m/s` : '\u2014';
    }

    if (this.statPieces) {
      this.statPieces.textContent = String(this.choppingStation.splitPieces.length);
    }

    if (this.statBodies) {
      this.statBodies.textContent = String(this.world.bodies.length);
    }

    if (this.statFps) {
      this.statFps.textContent = `${Math.round(this.fps)}`;
    }
  }

  _stepFrame(shouldRender = true) {
    const now = performance.now();
    const rawDt = Math.min(Math.max(0.001, (now - this._lastTickTime) / 1000), 0.12);
    this._lastTickTime = now;
    const dt = rawDt * this.timeScale;

    this._frameCount++;
    this._fpsAccum += rawDt;
    if (this._fpsAccum >= 0.35) {
      this.fps = this._frameCount / this._fpsAccum;
      this._frameCount = 0;
      this._fpsAccum = 0;
      this._checkPerformanceAutoDowngrade(0.35);
    }

    // Step oscillating Timing / Power Meter if active
    if (this.meterActive) {
      // Rain makes the timing needle oscillate slightly faster
      const meterSpeed = this.atmosphere.weather === 'rain' ? 1.55 : 1.25;
      this.meterPos += this.meterDir * meterSpeed * rawDt;
      if (this.meterPos >= 0.98) {
        this.meterPos = 0.98;
        this.meterDir = -1;
      } else if (this.meterPos <= 0.02) {
        this.meterPos = 0.02;
        this.meterDir = 1;
      }
      this._updateTimingNeedleDOM();
    }

    // Regenerate player stamina when idle
    const isIdle = this.humanoid.state === 'IDLE';
    const prevStam = Math.round(this.gameState.stamina);
    this.gameState.updateStamina(rawDt, isIdle, this.atmosphere.weather);
    if (Math.round(this.gameState.stamina) !== prevStam) {
      const stamFill = document.getElementById('hud-stamina-fill');
      const stamTxt = document.getElementById('hud-stamina-text');
      if (stamFill) {
        stamFill.style.width = `${Math.min(
          100,
          (this.gameState.stamina / this.gameState.maxStamina) * 100
        ).toFixed(1)}%`;
      }
      if (stamTxt) {
        stamTxt.textContent = `${Math.round(this.gameState.stamina)} / ${
          this.gameState.maxStamina
        }`;
      }
    }

    // Auto-spawn next log in progression after a clean split settles
    if (this.autoSpawnTimer > 0) {
      this.autoSpawnTimer -= rawDt;
      if (this.autoSpawnTimer <= 0 && this.humanoid.state === 'IDLE') {
        const nextSpecies = this.gameState.advanceNextLog();
        this.choppingStation.reset(nextSpecies);
        this._refreshAllHUD();
      }
    }

    // Sub-step humanoid kinematics, cannon-es physics, and particle collisions
    const maxStep = 1 / 60;
    const subSteps = Math.max(1, Math.min(6, Math.ceil(dt / maxStep)));
    const subDt = dt / subSteps;

    for (let i = 0; i < subSteps; i++) {
      this.humanoid.update(subDt);
      this.world.step(maxStep, subDt, 2);
      this.choppingStation.update(subDt, this.atmosphere.windVector);
    }

    this.atmosphere.update(dt);
    this.debugWireframe.update();

    this.controls.update();
    this._updateTelemetry();

    if (shouldRender) {
      if (this.useComposer && this.composer) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    }
  }

  _animate() {
    requestAnimationFrame(this._animate);
    this._stepFrame(true);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    new AxeSplittingSimulation();
  });
} else {
  new AxeSplittingSimulation();
}
