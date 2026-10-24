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
import {
  GameStateManager,
  LOG_TYPES,
  LOG_ORDER,
  AXE_TIERS,
  HANDLE_WRAPS,
  normalizeAxeId
} from './rpgState.js';
import { AtmosphereController } from './weatherAndLight.js';
import { WoodchipsSpriteBurst } from './assetsLoader.js';

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

    // Impact Juice state: Hit-Stop freeze, Perfect-Hit Slow-Mo pulse, and Camera Shake trauma
    this.hitStopTimer = 0;
    this.juiceSlowMoTimer = 0;
    this.cameraShakeTrauma = 0;
    this.shakeOffset = new THREE.Vector3();

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
    this._lastActionTime = 0;
    this._assetsReady = false;
    this._elapsedClock = 0;

    // Interaction mode ('stump' | 'yard') & free-roam locomotion state
    this.interactionMode = 'stump';
    this.playerYaw = 0;
    this.playerPitch = 0.18;
    this.moveKeys = {};
    this._pickedTreeHit = null;
    this._targetedTree = null;
    this._treeSwingInProgress = false;

    this._initThree();
    this._initLights();
    this._initPhysics();

    // Build Backyard Environment (NJ / Tiraspol), Chopping Station, Sergey Humanoid, Atmosphere, Woodchips & Debug Wireframes
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
    this.woodchipsBurst = new WoodchipsSpriteBurst(this.scene);
    this.debugWireframe = new PhysicsDebugWireframe(this.scene, this.world);

    // Sync initial log, block collar, cordwood rack, roadside stand, handle wrap & axe visuals from saved RPG state
    this.choppingStation.spawnFreshLog(this.gameState.logType);
    this.choppingStation.setBlockCollarVisible(this.gameState.collarActive);
    this.humanoid.applyAxeVisuals(this.gameState.getEquippedAxe());
    this.humanoid.applyHandleWrapVisuals(this.gameState.getHandleWrap());
    if (this.environment && typeof this.environment.updateCordwoodStack === 'function') {
      this.environment.updateCordwoodStack(
        this.gameState.logsSplitCount,
        this.gameState.ordersCompletedCount,
        this.gameState.currentOrder ? this.gameState.currentOrder.progress : 0
      );
    }

    // Wire thunderstorm lightning callback for thunderclap audio, critter scatter & subtle camera rumble
    this.atmosphere.onLightningStrike = () => {
      if (this.sound && typeof this.sound.playThunderclap === 'function') {
        this.sound.playThunderclap(1.0);
      }
      this.scatterBackyardCritters(3.8);
      this.cameraShakeTrauma = Math.min(1.0, this.cameraShakeTrauma + 0.32);
      this._updateWeatherBadge(this.atmosphere.weather);
      this._updateAimReadout();
    };

    // Wire blade impact callback from humanoid downswing to chopping station physics
    this.humanoid.onImpactCallback = (bladePos, bladeVel) => {
      this._handlePhysicalBladeImpact(bladePos, bladeVel);
    };

    this._initPostProcessingAndQuality();
    this._bindUI();
    this._bindMouseAimAndGestures();
    this._exposeGlobalAPI();
    this._refreshAllHUD();

    // Kick off parallel GLB loading for Sergey, equipped axe, setting props, and trees_v2
    this._initAssetsV2();

    this._lastTickTime = performance.now();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);

    // Fallback timer ensures physics & swing animation progress at 1:1 wall-clock speed
    // only when headless browser compositors completely pause requestAnimationFrame (> 250ms)
    this._headlessTimer = setInterval(() => {
      const now = performance.now();
      if (now - this._lastTickTime >= 250) {
        this._stepFrame(false);
      }
    }, 100);
  }

  async _initAssetsV2() {
    const overlay = document.getElementById('loading-overlay');
    const fill = document.getElementById('loading-progress-fill');
    const statusTxt = document.getElementById('loading-status-text');
    const setProgress = (pct, msg) => {
      if (fill) fill.style.width = `${pct}%`;
      if (statusTxt && msg) statusTxt.textContent = msg;
    };

    try {
      setProgress(25, 'Loading Sergey PBR rig, axes, and backyard trees_v2 in parallel...');
      const initialSetting = this.gameState.setting || 'nj';
      const initialCostume = this.gameState.costume || 'tee';
      const initialAxe = this.gameState.equippedAxeId || 'sergey';

      await Promise.all([
        this.humanoid.initAssets(initialCostume, initialAxe).then(() => {
          setProgress(62, 'Sergey PBR character & axe loaded. Populating backyard setting...');
        }),
        this.environment
          .loadSetting(
            initialSetting,
            this.qualityPreset,
            this.choppingStation,
            this.atmosphere.timeOfDay
          )
          .then(() => {
            setProgress(92, 'Backyard props & trees_v2 ready...');
          })
      ]);

      // Perform an initial TreeField LOD update so instanced meshes are populated immediately
      this.environment.updateTreesAndWind(
        this.camera,
        0.016,
        this._elapsedClock,
        this.atmosphere.windStrength
      );
      this._syncSettingAndCostumeUI();
      this._refreshAllHUD();
      setProgress(100, 'Ready!');
      this._assetsReady = true;
    } catch (err) {
      console.warn('Error during assets-v2 initialization:', err);
      this._assetsReady = true;
    } finally {
      if (overlay) {
        overlay.classList.add('hidden');
      }
    }
  }

  _initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdecbb8);
    this.scene.fog = new THREE.FogExp2(0xdecbb8, 0.0045);

    this.camera = new THREE.PerspectiveCamera(
      46,
      window.innerWidth / window.innerHeight,
      0.1,
      400
    );
    this.camera.position.set(2.85, 1.92, 2.55);

    this.renderer = this._createResilientRenderer();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(
      this._isSoftwareGL ? 0.5 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.renderer.shadowMap.enabled = !this._isSoftwareGL;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = this._isSoftwareGL
      ? THREE.NoToneMapping
      : THREE.ACESFilmicToneMapping;
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
    let isSoftwareGL = false;
    try {
      const probe = document.createElement('canvas');
      const pgl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (pgl) {
        const dbg = pgl.getExtension('WEBGL_debug_renderer_info');
        const rStr = dbg
          ? pgl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
          : pgl.getParameter(pgl.RENDERER);
        if (
          typeof rStr === 'string' &&
          /swiftshader|llvmpipe|software|softpipe|mesa offscreen/i.test(rStr)
        ) {
          isSoftwareGL = true;
        }
      }
    } catch {
      // Ignore probe error
    }
    this._isSoftwareGL = isSoftwareGL;

    const canvas = document.createElement('canvas');
    let gl = null;
    const useAA = !isSoftwareGL;
    try {
      gl =
        canvas.getContext('webgl2', {
          antialias: useAA,
          powerPreference: 'high-performance',
          stencil: false
        }) ||
        canvas.getContext('webgl', {
          antialias: useAA,
          powerPreference: 'high-performance',
          stencil: false
        }) ||
        canvas.getContext('webgl2', { antialias: false }) ||
        canvas.getContext('webgl', { antialias: false });
    } catch {
      gl = null;
    }

    if (gl) {
      try {
        return new THREE.WebGLRenderer({
          canvas,
          context: gl,
          antialias: useAA,
          powerPreference: 'high-performance'
        });
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
    const hemiLight = new THREE.HemisphereLight(
      0xfce3c8,
      0x4b5c32,
      this._isSoftwareGL ? 0.95 : 0.72
    );
    hemiLight.position.set(0, 20, 0);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffd296, 2.45);
    sunLight.position.set(7.5, 12.5, 6.2);
    sunLight.castShadow = !this._isSoftwareGL;
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
    rimLight.visible = !this._isSoftwareGL;
    this.scene.add(rimLight);

    // Warm house porch coach lantern
    const porchLight = new THREE.PointLight(0xffcb7d, 1.2, 8.0, 1.8);
    porchLight.position.set(-0.38, 2.45, -8.9);
    porchLight.visible = !this._isSoftwareGL;
    this.scene.add(porchLight);

    // Warm yard lantern right next to the chopping block
    const yardLight = new THREE.PointLight(0xffb85c, 1.6, 6.5, 1.7);
    yardLight.position.set(-1.03, 1.60, 0.15);
    yardLight.visible = !this._isSoftwareGL;
    this.scene.add(yardLight);

    // Warm flickering patio firepit point light
    const firepitLight = new THREE.PointLight(0xff7b29, 1.4, 7.5, 1.7);
    firepitLight.position.set(1.85, 0.55, 0.95);
    firepitLight.visible = !this._isSoftwareGL;
    this.scene.add(firepitLight);

    this.lights = {
      hemiLight,
      sunLight,
      rimLight,
      porchLight,
      yardLight,
      firepitLight
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

    if (!this._isSoftwareGL) {
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
    }

    this.qualityPreset = this._isSoftwareGL ? 'low' : 'high';
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

    if (this._isSoftwareGL) {
      const pr = preset === 'low' ? 0.5 : preset === 'medium' ? 0.62 : 0.72;
      this.renderer.setPixelRatio(pr);
      this.renderer.shadowMap.enabled = false;
      this.useComposer = false;
    } else if (preset === 'ultra') {
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
      this.renderer.setPixelRatio(0.75);
      this.renderer.shadowMap.enabled = false;
      if (this.ssaoPass) this.ssaoPass.enabled = false;
      if (this.bloomPass) this.bloomPass.enabled = false;
      this.useComposer = false;
    }

    if (this.environment && typeof this.environment.applyQualityToEnvironment === 'function') {
      this.environment.applyQualityToEnvironment(preset);
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

      if (this.interactionMode === 'yard') {
        if ((e.buttons & 1) || (e.buttons & 2) || document.pointerLockElement === dom) {
          this.playerYaw -= (e.movementX || 0) * 0.0045;
          this.playerPitch = THREE.MathUtils.clamp(
            this.playerPitch + (e.movementY || 0) * 0.003,
            -0.15,
            0.65
          );
          this.humanoid.root.rotation.y = this.playerYaw;
        }
        return;
      }

      // If blade is wedged in a tough kerf (`WEDGED_PRY`), wiggling the mouse horizontally pries it free!
      if (this.humanoid.state === 'WEDGED_PRY' && Math.abs(e.movementX || 0) > 14) {
        this.pryWedgedAxe(e.movementX > 0 ? 1 : -1);
        return;
      }

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

      if (this.interactionMode === 'yard') {
        const dStump = Math.hypot(
          this.humanoid.root.position.x - this.choppingStation.blockPosition.x,
          this.humanoid.root.position.z - this.choppingStation.blockPosition.z
        );
        if (this._pickedTreeHit && this._pickedTreeHit.tree) {
          this._swingAtTreeOnce(this._pickedTreeHit.tree);
        } else if (dStump < 2.2) {
          this.enterStumpMode();
        }
        return;
      }

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
    this.wedgeBtn = document.getElementById('wedge-btn');
    this.flipBtn = document.getElementById('flip-btn');
    this.peaveyBtn = document.getElementById('peavey-btn');
    this.honeBtn = document.getElementById('hone-btn');
    this.bonfireBtn = document.getElementById('bonfire-btn');
    this.bundleBtn = document.getElementById('bundle-btn');
    this.rotLeftBtn = document.getElementById('rot-left-btn');
    this.rotRightBtn = document.getElementById('rot-right-btn');
    this.slowmoToggle = document.getElementById('slowmo-toggle');
    this.wireframeToggle = document.getElementById('wireframe-toggle');
    this.modeSelect = document.getElementById('mode-select');
    this.logSelect = document.getElementById('log-select');
    this.autoLogToggle = document.getElementById('auto-log-toggle');
    this.timeSlider = document.getElementById('time-slider');
    this.timeValueEl = document.getElementById('time-value');
    this.qualitySelect = document.getElementById('quality-select');
    this.settingSelect = document.getElementById('setting-select');
    this.costumeSelect = document.getElementById('costume-select');
    this.toggleRoamBtn = document.getElementById('toggle-roam-btn');

    this.statusBadge = document.getElementById('status-badge');
    this.statSpeed = document.getElementById('stat-speed');
    this.statPieces = document.getElementById('stat-pieces');
    this.statBodies = document.getElementById('stat-bodies');
    this.statFps = document.getElementById('stat-fps');

    if (this.settingSelect) {
      this.settingSelect.value = this.gameState.setting || 'nj';
      this.settingSelect.addEventListener('change', () => {
        this.switchBackyardSetting(this.settingSelect.value);
      });
    }

    if (this.costumeSelect) {
      this.costumeSelect.value = this.gameState.costume || 'tee';
      this.costumeSelect.addEventListener('change', () => {
        this.switchSergeyCostume(this.costumeSelect.value);
      });
    }

    if (this.toggleRoamBtn) {
      this.toggleRoamBtn.addEventListener('click', () => {
        if (this.interactionMode === 'yard') {
          this.enterStumpMode();
        } else {
          this.enterYardMode();
        }
      });
    }

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

    if (this.honeBtn) {
      this.honeBtn.addEventListener('click', () => {
        this.honeAxeBlade();
      });
    }

    if (this.bonfireBtn) {
      this.bonfireBtn.addEventListener('click', () => {
        this.stokeBackyardBonfire();
      });
    }

    if (this.bundleBtn) {
      this.bundleBtn.addEventListener('click', () => {
        this.bundleFirewoodContract();
      });
    }

    if (this.wedgeBtn) {
      this.wedgeBtn.addEventListener('click', () => {
        this.plantSplittingWedge();
      });
    }

    if (this.flipBtn) {
      this.flipBtn.addEventListener('click', () => {
        this.flipActiveLog();
      });
    }

    if (this.peaveyBtn) {
      this.peaveyBtn.addEventListener('click', () => {
        this.heaveLogWithPeavey();
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

    if (this.modeSelect) {
      this.modeSelect.value = this.gameState.gameMode;
      this.modeSelect.addEventListener('change', () => {
        const mode = this.modeSelect.value;
        this.gameState.setGameMode(mode);
        if (mode === 'daily_seed') {
          const weathers = ['sun', 'rain', 'snow', 'wind', 'fog'];
          const dailyW = weathers[this.gameState.getDailySeedHash() % weathers.length];
          this.atmosphere.setWeather(dailyW);
          this._updateWeatherBadge(dailyW);
        }
        this.choppingStation.reset(this.gameState.logType);
        this._refreshAllHUD();
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
        if (this.sound && typeof this.sound.setWeatherAmbience === 'function') {
          this.sound.setWeatherAmbience(w, this.atmosphere.timeOfDay);
        }
        this._updateWeatherBadge(w);
      });
    });

    // Time of Day slider & preset buttons
    if (this.timeSlider) {
      this.timeSlider.addEventListener('input', () => {
        const tod = Number(this.timeSlider.value);
        this.atmosphere.setTimeOfDay(tod);
        if (this.sound && typeof this.sound.setWeatherAmbience === 'function') {
          this.sound.setWeatherAmbience(this.atmosphere.weather, tod);
        }
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
        if (this.sound && typeof this.sound.setWeatherAmbience === 'function') {
          this.sound.setWeatherAmbience(this.atmosphere.weather, tod);
        }
        this._updateTimeLabel(tod);
      });
    });

    if (this.qualitySelect) {
      this.qualitySelect.addEventListener('change', () => {
        this.setQualityPreset(this.qualitySelect.value);
      });
    }

    // Audio & Soundtrack Volume Sliders and Mute Toggles
    this.musicVolSlider = document.getElementById('music-volume-slider');
    this.musicVolValue = document.getElementById('music-volume-value');
    this.musicMuteBtn = document.getElementById('music-mute-btn');
    this.sfxVolSlider = document.getElementById('sfx-volume-slider');
    this.sfxVolValue = document.getElementById('sfx-volume-value');
    this.sfxMuteBtn = document.getElementById('sfx-mute-btn');

    if (this.musicVolSlider) {
      this.musicVolSlider.addEventListener('input', () => {
        const pct = Number(this.musicVolSlider.value);
        if (this.sound) {
          this.sound.setMusicVolume(pct / 100);
        }
        this._syncAudioSettingsUI();
      });
    }

    if (this.musicMuteBtn) {
      this.musicMuteBtn.addEventListener('click', () => {
        this.toggleMusicMuteUI();
      });
    }

    if (this.sfxVolSlider) {
      this.sfxVolSlider.addEventListener('input', () => {
        const pct = Number(this.sfxVolSlider.value);
        if (this.sound) {
          this.sound.setSfxVolume(pct / 100);
        }
        this._syncAudioSettingsUI();
      });
    }

    if (this.sfxMuteBtn) {
      this.sfxMuteBtn.addEventListener('click', () => {
        if (this.sound) {
          this.sound.toggleSfxMute();
        }
        this._syncAudioSettingsUI();
      });
    }

    this._syncAudioSettingsUI();

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
        this.humanoid.applyHandleWrapVisuals(this.gameState.getHandleWrap());
        this.choppingStation.setBlockCollarVisible(this.gameState.collarActive);
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

    // Tire & Chain Collar buy/toggle button inside Shop
    const collarBtn = document.getElementById('upg-collar-btn');
    if (collarBtn) {
      collarBtn.addEventListener('click', () => {
        if (this.gameState.buyOrToggleCollar()) {
          this.choppingStation.setBlockCollarVisible(this.gameState.collarActive);
          this._refreshAllHUD();
          this._refreshShopUI();
        }
      });
    }

    // Custom Handle Grip Wrap & Shock-Mount upgrade button inside Shop
    const wrapBtn = document.getElementById('upg-wrap-btn');
    if (wrapBtn) {
      wrapBtn.addEventListener('click', () => {
        if (this.gameState.upgradeHandleWrap()) {
          this.humanoid.applyHandleWrapVisuals(this.gameState.getHandleWrap());
          this._refreshAllHUD();
          this._refreshShopUI();
        }
      });
    }

    // Bind UI hover & click SFX across interactive controls
    document
      .querySelectorAll('.btn, select.ui-select, .toggle-row')
      .forEach((el) => {
        el.addEventListener('pointerenter', () => {
          if (this.sound && typeof this.sound.playUIHover === 'function') {
            this.sound.playUIHover();
          }
        });
        el.addEventListener('click', () => {
          if (this.sound && typeof this.sound.playUIClick === 'function') {
            this.sound.playUIClick();
          }
        });
      });

    // Keyboard shortcuts & Free-Roam Locomotion (WASD + Shift in Yard Mode, Stump Controls in Stump Mode)
    const onKeyDown = (e) => {
      if (e.code) {
        this.moveKeys[e.code] = true;
      }

      if (this.interactionMode === 'yard') {
        if (
          ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
            e.code
          )
        ) {
          return;
        }
        if (e.code === 'KeyE' || e.code === 'Escape') {
          e.preventDefault();
          this.enterStumpMode();
          return;
        }
        if (e.code === 'Space' || e.code === 'KeyF') {
          e.preventDefault();
          if (this._pickedTreeHit && this._pickedTreeHit.tree) {
            this._swingAtTreeOnce(this._pickedTreeHit.tree);
          }
          return;
        }
      }

      if (e.code === 'Escape' && this.interactionMode === 'stump') {
        e.preventDefault();
        this.enterYardMode();
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (this.humanoid.state === 'WEDGED_PRY') {
          this.pryWedgedAxe(1);
        } else {
          this.triggerTimingMeterStep();
        }
      } else if (e.code === 'KeyF') {
        if (this.humanoid.state === 'WEDGED_PRY') {
          this.pryWedgedAxe(-1);
        } else {
          this._commitPlayerSwing(this.baseSwingForce, false);
        }
      } else if (e.code === 'KeyW') {
        this.plantSplittingWedge();
      } else if (e.code === 'KeyV') {
        this.flipActiveLog();
      } else if (e.code === 'KeyP') {
        this.heaveLogWithPeavey();
      } else if (e.code === 'KeyC') {
        if (this.gameState.collarUnlocked && this.gameState.buyOrToggleCollar()) {
          this.choppingStation.setBlockCollarVisible(this.gameState.collarActive);
          this._refreshAllHUD();
          this._refreshShopUI();
        }
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
      } else if (e.code === 'KeyM' && !e.shiftKey) {
        this.toggleMusicMuteUI();
      } else if (e.code === 'KeyZ' || (e.code === 'KeyM' && e.shiftKey)) {
        this.setSlowMotion(!this.slowMotion);
      } else if (e.code === 'KeyD') {
        const next = this.debugWireframe.toggle();
        if (this.wireframeToggle) this.wireframeToggle.checked = next;
      } else if (e.code === 'KeyU') {
        if (shopModal) {
          this._refreshShopUI();
          shopModal.classList.toggle('hidden');
        }
      } else if (e.code === 'KeyH') {
        this.honeAxeBlade();
      } else if (e.code === 'KeyB') {
        this.stokeBackyardBonfire();
      } else if (e.code === 'KeyO') {
        this.bundleFirewoodContract();
      }
    };

    const onKeyUp = (e) => {
      if (e.code) {
        this.moveKeys[e.code] = false;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  }

  toggleMusicMuteUI() {
    if (!this.sound) return false;
    const muted = this.sound.toggleMusicMute();
    this._syncAudioSettingsUI();
    return muted;
  }

  _syncAudioSettingsUI() {
    if (!this.sound) return;
    const mPct = Math.round(this.sound.musicVolume * 100);
    const sPct = Math.round(this.sound.sfxVolume * 100);
    if (this.musicVolSlider) {
      this.musicVolSlider.value = String(mPct);
    }
    if (this.musicVolValue) {
      this.musicVolValue.textContent = this.sound.musicMuted ? 'Muted' : `${mPct}%`;
    }
    if (this.musicMuteBtn) {
      this.musicMuteBtn.classList.toggle('muted-active', Boolean(this.sound.musicMuted));
      this.musicMuteBtn.innerHTML = this.sound.musicMuted
        ? 'Unmute <kbd>M</kbd>'
        : 'Mute <kbd>M</kbd>';
    }
    if (this.sfxVolSlider) {
      this.sfxVolSlider.value = String(sPct);
    }
    if (this.sfxVolValue) {
      this.sfxVolValue.textContent = this.sound.sfxMuted ? 'Muted' : `${sPct}%`;
    }
    if (this.sfxMuteBtn) {
      this.sfxMuteBtn.classList.toggle('muted-active', Boolean(this.sound.sfxMuted));
      this.sfxMuteBtn.textContent = this.sound.sfxMuted ? 'Unmute' : 'Mute';
    }
  }

  /**
   * Sharpens/hones the axe blade back to 100% razor edge using the whetstone & wipes off sticky pine pitch sap.
   */
  honeAxeBlade() {
    const hadSap = (this.gameState.axeSapBuildup || 0) >= 10;
    this.gameState.honeBlade();
    const bladePos = new THREE.Vector3();
    if (this.humanoid && this.humanoid.bladeTipNode) {
      this.humanoid.bladeTipNode.getWorldPosition(bladePos);
      this.choppingStation._spawnSparkBurst(bladePos, 0.55);
    }
    this._refreshAllHUD();
    this._showHitBanner({
      rating: hadSap
        ? 'BLADE HONED & STICKY PINE PITCH WIPED CLEAN!'
        : 'BLADE HONED TO 100% RAZOR EDGE!',
      points: 0,
      xpGained: 0,
      split: true,
      glancing: false,
      leveledUp: false
    });
    return true;
  }

  /**
   * Stokes the Backyard Fieldstone Patio Firepit (`B` key / Bonfire button / `window.stokeBonfire()`):
   * Searing the axe head over the flames burns off sticky pine pitch sap (`axeSapBuildup = 0`),
   * boosts `bonfireLevel` up to 5 (igniting the Level-5 Ember-Tempered Blade!), and warms the woodchopper (+25 Stamina).
   */
  stokeBackyardBonfire() {
    const res = this.gameState.stokeBonfire();
    if (this.environment && typeof this.environment.setBonfireLevel === 'function') {
      this.environment.setBonfireLevel(res.bonfireLevel);
    }
    const fireOrigin = new THREE.Vector3(1.85, 0.35, 0.95);
    this.choppingStation._spawnSparkBurst(fireOrigin, res.emberTempered ? 1.35 : 0.85);
    this._refreshAllHUD();
    this._showHitBanner({
      rating: res.emberTempered
        ? 'BONFIRE LV 5! EMBER-TEMPERED BLADE IGNITED (+20% CLEAVE & SAP IMMUNITY)!'
        : `BACKYARD BONFIRE STOKED (LV ${res.bonfireLevel})! SAP SEARED & +25 STAMINA`,
      points: 0,
      xpGained: 0,
      split: true,
      glancing: false,
      leveledUp: false
    });
    return res;
  }

  /**
   * Ties & stacks a twine-wrapped firewood bundle onto the Suburban NJ Roadside Stand (`O` key / Bundle button / `window.claimFirewoodOrder()`):
   * Awards +45 immediate Bundle Tying Credits and advances active Roadside Stand Contract Order progress by +1.
   */
  bundleFirewoodContract() {
    const res = this.gameState.bundleFirewoodOrder();
    if (this.environment && typeof this.environment.updateFirewoodStand === 'function') {
      this.environment.updateFirewoodStand(
        this.gameState.ordersCompletedCount,
        this.gameState.currentOrder ? this.gameState.currentOrder.progress : 0
      );
    }
    this._refreshAllHUD();
    this._showHitBanner({
      rating: res.completed
        ? `ROADSIDE CONTRACT COMPLETE: ${res.completedTitle}! (+${res.rewardCredits + res.bundleBonus} CREDITS)`
        : `CORDWOOD BUNDLE STACKED ON ROADSIDE STAND! (${res.progress}/${res.target} \u2022 +${res.bundleBonus} CREDITS)`,
      points: res.completed ? res.rewardCredits + res.bundleBonus : res.bundleBonus,
      xpGained: res.completed ? res.rewardXp : 0,
      split: true,
      glancing: false,
      leveledUp: false
    });
    return res;
  }

  /**
   * Scatters the 3D backyard bluejays & gray squirrel perched on the cedar fence (`window.scatterCritters()`).
   */
  scatterBackyardCritters(duration = 3.8) {
    if (this.environment && typeof this.environment.scatterCritters === 'function') {
      this.environment.scatterCritters(duration);
    }
    if (this.sound && typeof this.sound.playCritterScatter === 'function') {
      this.sound.playCritterScatter();
    }
    return true;
  }

  /**
   * Plants up to 2 forged-steel splitting wedges into the log's top kerf (`W` key).
   * Alternating strikes between Dual Tandem Wedges triggers Tandem Crack-Walking!
   */
  plantSplittingWedge() {
    if (this.choppingStation.isLogSplit || !this.choppingStation.intactLog) {
      return false;
    }
    const offsetX = this.choppingStation.aimOffsetX;
    this.gameState.plantWedge(offsetX);
    this.choppingStation.plantSteelWedge(offsetX);
    const count = this.gameState.plantedWedgeCount;
    this._refreshAllHUD();
    this._showHitBanner({
      rating:
        count >= 2
          ? 'DUAL TANDEM WEDGES SET! (ALTERNATE STRIKES TO WALK CRACK)'
          : 'STEEL SPLITTING WEDGE SET! (PRESS [W] ELSEWHERE FOR TANDEM)',
      points: 0,
      xpGained: 0,
      split: true,
      glancing: false,
      leveledUp: false
    });
    return true;
  }

  /**
   * Flips the active intact log 180 degrees upside-down on the chopping block (`V` key).
   * Exposes straight basal trunk grain on Forked/Stump rounds (+22% cleavage) and shifts top hazards downward.
   */
  flipActiveLog() {
    if (this.choppingStation.isLogSplit || !this.choppingStation.intactLog) {
      return false;
    }
    const isFlipped = this.gameState.flipLog();
    this.choppingStation.flipLogOnBlock(isFlipped);
    this._refreshAllHUD();
    this._showHitBanner({
      rating: isFlipped
        ? 'LOG INVERTED UPSIDE-DOWN! (BASAL GRAIN EXPOSED)'
        : 'LOG FLIPPED RIGHT-SIDE UP!',
      points: 0,
      xpGained: 0,
      split: true,
      glancing: false,
      leveledUp: false
    });
    return isFlipped;
  }

  /**
   * Hooks and seats the active log on the chopping block using the Forged-Steel Cant-Hook Peavey (`P` key).
   * Aligns the check line, restores +8 Stamina, and primes a +18% (+25% against Bosses) next-strike cleavage bonus!
   */
  heaveLogWithPeavey() {
    if (this.choppingStation.isLogSplit || !this.choppingStation.intactLog) {
      return false;
    }
    const res = this.gameState.heaveWithPeavey();
    this.choppingStation.heaveLogWithPeavey();
    const isBoss = Boolean(this.gameState.getCurrentLogDef()?.isBoss);
    this._refreshAllHUD();
    this._showHitBanner({
      rating: isBoss
        ? 'PEAVEY CANT-HOOK BOSS HEAVE! (+25% NEXT-STRIKE CLEAVE & +8 STAMINA)'
        : 'PEAVEY CANT-HOOK LOG SEATED! (+18% NEXT-STRIKE CLEAVE & +8 STAMINA)',
      points: 0,
      xpGained: 0,
      split: true,
      glancing: false,
      leveledUp: false
    });
    return res;
  }

  /**
   * Triggers a 3D forked thunderstorm lightning bolt in the backyard sky (`window.triggerLightning()`).
   */
  triggerThunderstormBolt() {
    this.atmosphere.triggerLightningStrike();
    this._refreshAllHUD();
    return true;
  }

  /**
   * Levers a wedged axe blade sideways out of the kerf, dealing bonus internal cleavage damage
   * and popping low-HP cracked logs wide open!
   */
  pryWedgedAxe(dir = 1) {
    if (this.humanoid.state !== 'WEDGED_PRY') return false;
    this.humanoid.rockWedgedBlade(dir);
    const pryRes = this.gameState.pryWedgedBlade();
    if (pryRes.split) {
      this.choppingStation.fractureLog(1.1, null, null, this.atmosphere.weather);
      if (this.environment && typeof this.environment.updateCordwoodStack === 'function') {
        this.environment.updateCordwoodStack(this.gameState.logsSplitCount);
      }
      this.autoSpawnTimer = this.gameState.gameMode === 'time_attack' ? 0.65 : 1.55;
      this.cameraShakeTrauma = Math.min(1.0, this.cameraShakeTrauma + 0.38);
      if (pryRes.result) {
        this._showHitBanner(pryRes.result);
      }
    } else {
      this._showHitBanner({
        rating: `BLADE LEVERED FREE! (${pryRes.remainingHp} HP LEFT)`,
        points: 0,
        xpGained: 0,
        split: false,
        glancing: false,
        leveledUp: false
      });
    }
    this._refreshAllHUD();
    return true;
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
      if (this.sound && typeof this.sound.playMeterStart === 'function') {
        this.sound.playMeterStart();
      }
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
    let meterZone = 'weak';
    if (this.meterPos >= 0.68 && this.meterPos <= 0.86) {
      // Sweet spot! 135% power & tightened aim accuracy!
      powerMult = 1.35;
      meterZone = 'sweet';
      this.choppingStation.setAim(
        this.choppingStation.aimOffsetX * 0.5,
        this.choppingStation.aimAngle * 0.5
      );
      if (statusEl) statusEl.textContent = 'PERFECT TIMING! (135% Cleave Power)';
    } else if (this.meterPos >= 0.35 && this.meterPos < 0.68) {
      powerMult = 1.05;
      meterZone = 'solid';
      if (statusEl) statusEl.textContent = 'Solid Timing (105% Power)';
    } else if (this.meterPos > 0.86) {
      // Wild overcharge: high power but slight aim scatter
      powerMult = 1.15;
      meterZone = 'wild';
      this.choppingStation.setAim(
        this.choppingStation.aimOffsetX + (Math.random() - 0.5) * 0.06,
        this.choppingStation.aimAngle
      );
      if (statusEl) statusEl.textContent = 'Overcharged Wild Swing!';
    } else {
      powerMult = 0.62;
      meterZone = 'weak';
      if (statusEl) statusEl.textContent = 'Weak Early Release (62% Power)';
    }

    if (this.sound && typeof this.sound.playMeterLock === 'function') {
      this.sound.playMeterLock(meterZone);
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
    this._lastActionTime = performance.now();
    if (this.sound) {
      this.sound.unlockAndStart();
    }
    // If previous swing was still mid-flight without having impacted yet, flush its physics first
    if (this.pendingStrikeResult && !this.humanoid.hasTriggeredSplit) {
      if (this.pendingStrikeResult.logType === this.gameState.logType) {
        this._handlePhysicalBladeImpact(null, null);
      } else {
        this.pendingStrikeResult = null;
      }
    }

    // If Tire & Chain Collar is holding split halves upright on the block, a rapid manual follow-up swing
    // quarters them into 8 flying kindling sticks for a +45 Pts / +20 XP / +18 Credits Kindling Bonus!
    if (
      !isAutomatedSwing &&
      this.choppingStation.isLogSplit &&
      this.gameState.collarActive &&
      !this.choppingStation.hasShatteredKindling
    ) {
      this.pendingStrikeResult = null;
      this.humanoid.swingForce = swingPower;
      this.humanoid.triggerSwing(swingPower, skipWindup, true);
      this.choppingStation.shatterSplitPiecesIntoKindling(this.atmosphere.weather);
      const kindlingRes = this.gameState.awardKindlingBonus();
      this.cameraShakeTrauma = Math.min(1.0, this.cameraShakeTrauma + 0.45);
      this.hitStopTimer = 0.035;
      this.autoSpawnTimer = 1.25;
      this._refreshAllHUD();
      this._showHitBanner(kindlingRes);
      return kindlingRes;
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
      nailDistance: isAutomatedSwing ? 1.0 : diag.nailDistance,
      rockDistance: isAutomatedSwing ? 1.0 : diag.rockDistance,
      hitPlantedWedge: isAutomatedSwing ? false : diag.hitPlantedWedge,
      swingPower,
      weather: this.atmosphere.weather,
      stormCharged: this.atmosphere.isStormCharged(),
      isAutomatedSwing
    });

    this._lastSwingWasAutomated = isAutomatedSwing;
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
    if (this.humanoid) {
      this.humanoid.hasTriggeredSplit = true;
    }

    this.choppingStation.executeStrikePhysics({
      strikeResult: result,
      swingForce: this.humanoid.swingForce,
      impactPoint: bladeWorldPos,
      axeVelocity: bladeVelocity,
      wedgePower: this.gameState.getEffectiveWedgePower(),
      weather: this.atmosphere.weather
    });

    // Trigger Impact Juice: Hit-Stop freeze, Camera Shake trauma, Critter Scatter, and Perfect/Boss Slow-Mo pulse!
    if (result) {
      if (this.woodchipsBurst && bladeWorldPos) {
        this.woodchipsBurst.spawn(bladeWorldPos, null, result.split ? 14 : 8);
      }
      if ((result.isBoss && result.split) || result.leveledUp) {
        this.humanoid.playVictoryCheer(2.2);
      }
      if (result.isBoss && result.split) {
        this.cameraShakeTrauma = Math.min(1.0, this.cameraShakeTrauma + 0.78);
        this.hitStopTimer = 0.048;
        this.juiceSlowMoTimer = 0.34;
        this.scatterBackyardCritters(4.2);
      } else if (result.hitNail || result.glancing) {
        this.cameraShakeTrauma = Math.min(1.0, this.cameraShakeTrauma + 0.62);
        this.hitStopTimer = 0.038;
      } else if (result.split) {
        this.cameraShakeTrauma = Math.min(1.0, this.cameraShakeTrauma + 0.42);
        this.hitStopTimer = 0.036;
        if (result.geodeCrystalShatter || result.lightningFissureShatter) {
          this.scatterBackyardCritters(3.2);
        }
        if (result.rating === 'PERFECT GRAIN CLEAVE!') {
          this.juiceSlowMoTimer = 0.25;
        }
      } else {
        this.cameraShakeTrauma = Math.min(1.0, this.cameraShakeTrauma + 0.28);
        this.hitStopTimer = 0.028;
        if (!this._lastSwingWasAutomated && !result.struckWedge) {
          this.humanoid.enterWedgedPry();
        }
      }
    }

    // Update stacked cordwood in the backyard firewood rack & roadside stand
    if (this.environment && typeof this.environment.updateCordwoodStack === 'function') {
      this.environment.updateCordwoodStack(
        this.gameState.logsSplitCount,
        this.gameState.ordersCompletedCount,
        this.gameState.currentOrder ? this.gameState.currentOrder.progress : 0
      );
    }

    // If the log split cleanly, schedule next log spawn after pieces settle (faster in Time Attack,
    // or slightly longer when Tire Collar is active so player can land a Kindling Quarter-Chop!)
    if (this.choppingStation.isLogSplit) {
      this.autoSpawnTimer =
        this.gameState.gameMode === 'time_attack'
          ? 0.65
          : this.gameState.collarActive
          ? 2.15
          : 1.55;
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

  /**
   * Returns current Web Audio synthesizer & procedural soundtrack state snapshot.
   * Exposed globally as `window.getAudioState()`.
   */
  getAudioState() {
    if (!this.sound || typeof this.sound.getAudioState !== 'function') {
      return {
        ctxState: 'suspended',
        musicOn: false,
        musicPlaying: false,
        musicSection: 'menu',
        intensity: 0,
        activeVoices: 0,
        sfxVolume: 0,
        musicVolume: 0,
        eventsPlayed: {}
      };
    }
    return this.sound.getAudioState();
  }

  /**
   * Runs an automated audio & woodchopping showcase (`window.audioDemo(seconds)`)
   * driving the procedural soundtrack, weather beds, and full SFX palette.
   */
  audioDemo(seconds = 60) {
    this._lastActionTime = performance.now();
    if (!this.sound || typeof this.sound.runAudioDemo !== 'function') {
      return this.getAudioState();
    }
    const res = this.sound.runAudioDemo(seconds, this);
    this._syncAudioSettingsUI();
    return res;
  }

  _syncSettingAndCostumeUI() {
    const setting = this.environment ? this.environment.getSetting() : this.gameState.setting || 'nj';
    const costume = this.humanoid ? this.humanoid.costume : this.gameState.costume || 'tee';
    if (this.settingSelect && this.settingSelect.value !== setting) {
      this.settingSelect.value = setting;
    }
    if (this.costumeSelect && this.costumeSelect.value !== costume) {
      this.costumeSelect.value = costume;
    }
    const subEl = document.getElementById('setting-subtitle');
    if (subEl) {
      subEl.textContent =
        setting === 'tiraspol'
          ? 'Sergey \u2022 Tiraspol Backyard (Transnistria) \u2022 RPG'
          : 'Sergey \u2022 Suburban NJ Backyard \u2022 RPG';
    }
    const treesPill = document.getElementById('trees-count-pill');
    const tf = this.environment ? this.environment.getTreeField() : null;
    if (treesPill && tf) {
      const st = tf.stats();
      treesPill.textContent = `Trees: ${st.standing}`;
    }
  }

  async switchBackyardSetting(settingName = 'nj') {
    const target = settingName === 'tiraspol' ? 'tiraspol' : 'nj';
    this.gameState.setSettingState(target);
    await this.environment.loadSetting(
      target,
      this.qualityPreset,
      this.choppingStation,
      this.atmosphere.timeOfDay
    );
    this._pickedTreeHit = null;
    this._targetedTree = null;
    if (this.interactionMode === 'stump') {
      this.setCameraPreset('default');
    } else {
      this.humanoid.root.position.set(0, 0, 1.35);
      this.playerYaw = 0;
      this.humanoid.root.rotation.y = 0;
      this._updateFollowCamera(1.0);
    }
    this.environment.updateTreesAndWind(
      this.camera,
      0.016,
      this._elapsedClock,
      this.atmosphere.windStrength
    );
    this._syncSettingAndCostumeUI();
    this._refreshAllHUD();
    this._stepFrame(true);
    return target;
  }

  async switchSergeyCostume(costumeName = 'tee') {
    const target = costumeName === 'jacket' ? 'jacket' : 'tee';
    this.gameState.setCostumeState(target);
    await this.humanoid.setCostume(target);
    if (this.interactionMode === 'yard') {
      await this.enterStumpMode();
    }
    this._syncSettingAndCostumeUI();
    this._refreshAllHUD();
    this._stepFrame(true);
    return target;
  }

  async setEquippedAxeById(axeId = 'sergey') {
    const normId = normalizeAxeId(axeId);
    this.gameState.forceEquipAxe(normId);
    const axeDef = this.gameState.getEquippedAxe();
    if (axeDef) {
      this.humanoid.hickoryMat.color.setHex(axeDef.handleColor);
      this.humanoid.forgedSteelMat.color.setHex(axeDef.headColor);
      this.humanoid.polishedBitMat.color.setHex(axeDef.bitColor);
      if (axeDef.headScale) {
        this.humanoid.axeHeadGroup.scale.set(
          axeDef.headScale[0],
          axeDef.headScale[1],
          axeDef.headScale[2]
        );
      }
    }
    await this.humanoid.setAxeModel(normId);
    this._refreshAllHUD();
    this._refreshShopUI();
    this._stepFrame(true);
    return normId;
  }

  getPlayerForward() {
    return new THREE.Vector3(Math.sin(this.playerYaw), 0, Math.cos(this.playerYaw)).normalize();
  }

  async enterYardMode() {
    this.interactionMode = 'yard';
    this.humanoid.setInteractionMode('yard');
    this.controls.enabled = false;

    // Place Sergey on the clear central yard corridor just in front of the chopping stump
    // so holding W walks him smoothly across the open yard without hitting the stump.
    if (
      Math.hypot(this.humanoid.root.position.x, this.humanoid.root.position.z - -0.8) < 1.1 ||
      Math.hypot(this.humanoid.root.position.x, this.humanoid.root.position.z - 0.28) < 1.1
    ) {
      this.humanoid.root.position.set(0, 0, 1.35);
      this.playerYaw = 0;
      this.humanoid.root.rotation.y = 0;
    }

    if (this.toggleRoamBtn) {
      this.toggleRoamBtn.classList.add('active');
      this.toggleRoamBtn.innerHTML = 'At Stump <kbd>E</kbd>';
    }
    const banner = document.getElementById('yard-prompt-banner');
    if (banner) {
      banner.classList.remove('hidden');
    }

    this._updateFollowCamera(1.0);
    this._updateYardTargetPrompt();
    this._stepFrame(true);
    return true;
  }

  async enterStumpMode() {
    this.interactionMode = 'stump';
    this.moveKeys = {};
    this._pickedTreeHit = null;
    this._targetedTree = null;
    this.humanoid.setInteractionMode('stump');
    this.controls.enabled = true;
    this.setCameraPreset('default');

    if (this.toggleRoamBtn) {
      this.toggleRoamBtn.classList.remove('active');
      this.toggleRoamBtn.innerHTML = 'Roam Yard <kbd>E</kbd>';
    }
    const banner = document.getElementById('yard-prompt-banner');
    if (banner) {
      banner.classList.add('hidden');
    }

    this._stepFrame(true);
    return true;
  }

  _updateFollowCamera(lerpAlpha = 0.18) {
    const pos = this.humanoid.root.position;
    const fwd = this.getPlayerForward();
    const camDist = 3.15;
    const camHeight = 1.75 + this.playerPitch * 1.35;

    const idealPos = new THREE.Vector3(
      pos.x - fwd.x * camDist,
      Math.max(0.75, camHeight),
      pos.z - fwd.z * camDist
    );
    if (this.environment && typeof this.environment.collidePlayer === 'function') {
      this.environment.collidePlayer(idealPos, 0.25);
    }

    const lookTarget = new THREE.Vector3(
      pos.x + fwd.x * 1.25,
      1.25,
      pos.z + fwd.z * 1.25
    );

    if (lerpAlpha >= 0.99) {
      this.camera.position.copy(idealPos);
      this.controls.target.copy(lookTarget);
    } else {
      this.camera.position.lerp(idealPos, lerpAlpha);
      this.controls.target.lerp(lookTarget, lerpAlpha);
    }
    this.camera.lookAt(this.controls.target);
  }

  _stepYardLocomotion(dt) {
    if (this.interactionMode !== 'yard') return;

    const fwd = this.getPlayerForward();
    // Right-hand side vector for strafing (KeyD = right, KeyA = left)
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const moveVec = new THREE.Vector3();

    if (this.moveKeys.KeyW || this.moveKeys.ArrowUp) moveVec.add(fwd);
    if (this.moveKeys.KeyS || this.moveKeys.ArrowDown) moveVec.sub(fwd);
    if (this.moveKeys.KeyD || this.moveKeys.ArrowRight) moveVec.add(right);
    if (this.moveKeys.KeyA || this.moveKeys.ArrowLeft) moveVec.sub(right);

    const isMoving = moveVec.lengthSq() > 1e-4;
    const isRunning = Boolean(this.moveKeys.ShiftLeft || this.moveKeys.ShiftRight);
    const speed = isRunning ? 6.8 : 3.9;

    if (isMoving) {
      moveVec.normalize();
      this.humanoid.root.position.addScaledVector(moveVec, speed * dt);
      this.environment.collidePlayer(this.humanoid.root.position, 0.38);
      this.humanoid.root.rotation.y = this.playerYaw;
    }

    const surf = this.environment.getSurfaceAt(
      this.humanoid.root.position.x,
      this.humanoid.root.position.z
    );
    this.humanoid.setLocomotionState(isMoving, isRunning, dt, surf);
    this._updateFollowCamera(Math.min(1.0, dt * 10.0));
    this._updateYardTargetPrompt();
  }

  _updateYardTargetPrompt() {
    const banner = document.getElementById('yard-prompt-banner');
    const txt = document.getElementById('yard-prompt-text');
    if (!banner || !txt) return;
    if (this.interactionMode !== 'yard') {
      banner.classList.add('hidden');
      return;
    }
    banner.classList.remove('hidden');

    const tf = this.environment ? this.environment.getTreeField() : null;
    const hit = tf ? tf.pick(this.humanoid.root.position, this.getPlayerForward(), 2.1, 0.45) : null;
    this._pickedTreeHit = hit;

    const dStump = Math.hypot(
      this.humanoid.root.position.x - this.choppingStation.blockPosition.x,
      this.humanoid.root.position.z - this.choppingStation.blockPosition.z
    );

    if (hit && hit.tree) {
      const spName = hit.tree.species.charAt(0).toUpperCase() + hit.tree.species.slice(1);
      const hitsDone = Math.min(hit.tree.hits, hit.tree.meta.hitsToFell);
      banner.classList.add('target-active');
      txt.textContent = `\uD83E\uDE93 Target: ${spName} Tree (${hitsDone} / ${hit.tree.meta.hitsToFell} Hits) \u2022 Press Space / F / Click to Chop \u2022 E for Stump`;
    } else if (dStump < 2.2) {
      banner.classList.add('target-active');
      txt.textContent =
        '\uD83E\uDEB5 Near Chopping Stump \u2022 Press E or Click Stump to Enter Log-Splitting Mode';
    } else {
      banner.classList.remove('target-active');
      txt.textContent =
        'Free-Roam Yard Mode \u2022 Walk with WASD (Shift = Run) \u2022 Face a Tree to Chop \u2022 Press E for Stump';
    }
  }

  teleportNearTree() {
    if (this.interactionMode !== 'yard') {
      this.enterYardMode();
    }
    const tf = this.environment ? this.environment.getTreeField() : null;
    if (!tf || !tf.trees || tf.trees.length === 0) return null;

    // Prefer standing trees inside the fenced yard with clear approach space
    const px = this.humanoid.root.position.x;
    const pz = this.humanoid.root.position.z;
    let best = null;
    let bestScore = Infinity;

    for (const t of tf.trees) {
      if (t.state !== 'standing') continue;
      const inFence = Math.abs(t.position.x) < 17.5 && Math.abs(t.position.z) < 17.5;
      const d = Math.hypot(t.position.x - px, t.position.z - pz) + (inFence ? 0 : 50);
      if (d < bestScore) {
        bestScore = d;
        best = t;
      }
    }

    if (!best) return null;

    // Place Sergey at the tree's approachPoint on the yard-center side, facing directly toward the trunk
    const awayDir = new THREE.Vector3(-best.position.x, 0, -best.position.z);
    if (awayDir.lengthSq() < 1e-4) {
      awayDir.set(0, 0, 1);
    }
    awayDir.normalize();

    const approachDist = Math.max(
      (best.meta?.approachDistance || 0.95) * best.scale,
      best.radius + 0.68
    );
    const ax = best.position.x + awayDir.x * approachDist;
    const az = best.position.z + awayDir.z * approachDist;

    this.humanoid.root.position.set(ax, 0, az);
    const toTreeX = best.position.x - ax;
    const toTreeZ = best.position.z - az;
    this.playerYaw = Math.atan2(toTreeX, toTreeZ);
    this.humanoid.root.rotation.y = this.playerYaw;
    this._targetedTree = best;

    this._updateFollowCamera(1.0);
    this._updateYardTargetPrompt();
    this._stepFrame(true);
    return best.id;
  }

  async _swingAtTreeOnce(targetTree = null) {
    const tf = this.environment ? this.environment.getTreeField() : null;
    if (!tf) return { felled: false, hits: 0 };

    const pickHit = tf.pick(this.humanoid.root.position, this.getPlayerForward(), 2.4, 0.3);
    const tree = targetTree || (pickHit ? pickHit.tree : this._targetedTree);
    if (!tree || (tree.state !== 'standing' && tree.state !== 'chopping')) {
      return { felled: false, hits: tree ? tree.hits : 0 };
    }

    this._lastActionTime = performance.now();
    this.humanoid.triggerSwing(1.15, false, true);

    await new Promise((r) => setTimeout(r, 145));

    const fromDir = new THREE.Vector3(
      tree.position.x - this.humanoid.root.position.x,
      0,
      tree.position.z - this.humanoid.root.position.z
    );
    if (fromDir.lengthSq() < 1e-5) {
      fromDir.copy(this.getPlayerForward());
    } else {
      fromDir.normalize();
    }

    const hitPoint = tree.position
      .clone()
      .addScaledVector(fromDir, -tree.radius)
      .setY(tree.position.y + (tree.meta?.chopHeight || 0.45) * tree.scale);

    // Angle the fall direction ~72 deg to the right of the camera sightline so the felled trunk
    // tips sideways across the grass in full profile (keeping the stump & Sergey unobstructed)
    const fallDir = fromDir
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -1.25)
      .normalize();

    const res = tf.hit(tree, fallDir, 1);
    if (this.woodchipsBurst) {
      this.woodchipsBurst.spawn(hitPoint, fromDir, 14);
    }

    const ratio = res.hitsToFell ? res.hits / res.hitsToFell : 0.5;
    if (this.sound && typeof this.sound.playTreeHitThunk === 'function') {
      this.sound.playTreeHitThunk(1.15, ratio);
    }
    this.cameraShakeTrauma = Math.min(1.0, this.cameraShakeTrauma + 0.24);

    if (res.felled) {
      if (this.sound && typeof this.sound.playTreeFallCreak === 'function') {
        this.sound.playTreeFallCreak();
      }
      if (tree.anim) {
        tree.anim.onLand = () => {
          if (this.sound && typeof this.sound.playTreeFallCrash === 'function') {
            this.sound.playTreeFallCrash();
          }
          this.cameraShakeTrauma = Math.min(1.0, this.cameraShakeTrauma + 0.65);
          if (this.woodchipsBurst) {
            this.woodchipsBurst.spawn(hitPoint, fromDir, 18);
          }
        };
      }
      this.humanoid.playVictoryCheer(2.4);
      const award = this.gameState.awardTreeFelled(tree.species, res.hitsToFell);
      this._syncSettingAndCostumeUI();
      this._refreshAllHUD();
      this._showHitBanner(award);
    }

    this._updateYardTargetPrompt();
    return res;
  }

  async chopTreeUntilFelled() {
    if (this.interactionMode !== 'yard') {
      await this.enterYardMode();
    }
    const tf = this.environment ? this.environment.getTreeField() : null;
    if (!tf) return { felled: false, hits: 0 };

    let pickHit = tf.pick(this.humanoid.root.position, this.getPlayerForward(), 2.4, 0.25);
    let tree = pickHit ? pickHit.tree : this._targetedTree;

    if (!tree || (tree.state !== 'standing' && tree.state !== 'chopping')) {
      const id = this.teleportNearTree();
      if (id != null) {
        tree = tf.trees[id];
      }
    }
    if (!tree) return { felled: false, hits: 0 };

    let swings = 0;
    let felled = false;
    while (
      swings < 30 &&
      (tree.state === 'standing' || tree.state === 'chopping')
    ) {
      swings++;
      const res = await this._swingAtTreeOnce(tree);
      if (res.felled || tree.state === 'falling' || tree.state === 'fallen' || tree.state === 'stump') {
        felled = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 140));
    }

    // Wait for the falling tree animation to land and transition to 'fallen' / 'stump'
    // so TreeField.stats().felled is incremented before resolving.
    if (felled || tree.state === 'falling') {
      const tStart = performance.now();
      while (
        tree.state === 'falling' &&
        performance.now() - tStart < 3800
      ) {
        tf.update(this.camera, 0.032);
        this._stepFrame(true);
        await new Promise((r) => setTimeout(r, 40));
      }
      if (tree.state === 'falling') {
        for (let i = 0; i < 60 && tree.state === 'falling'; i++) {
          tf.update(this.camera, 0.033);
        }
      }
      felled = tree.state === 'fallen' || tree.state === 'stump';
      if (felled) {
        this.humanoid.playVictoryCheer(5.5);
        this.humanoid.root.rotation.y = this.playerYaw + 2.35;
      }
    }

    this._syncSettingAndCostumeUI();
    this._refreshAllHUD();
    this._stepFrame(true);
    return { felled, hits: tree.hits || swings };
  }

  _getChopperTestState() {
    const tf = this.environment ? this.environment.getTreeField() : null;
    const px = this.humanoid.root.position.x;
    const py = this.humanoid.root.position.y;
    const pz = this.humanoid.root.position.z;

    let nearest = null;
    if (tf && tf.trees) {
      let bestDist = Infinity;
      for (const t of tf.trees) {
        if (t.state === 'gone') continue;
        const d = Math.hypot(px - t.position.x, pz - t.position.z);
        if (d < bestDist) {
          bestDist = d;
          nearest = {
            id: t.id,
            x: +t.position.x.toFixed(3),
            z: +t.position.z.toFixed(3),
            radius: +t.radius.toFixed(3),
            distance: +d.toFixed(3)
          };
        }
      }
    }

    return {
      setting: this.environment ? this.environment.getSetting() : 'nj',
      costume: this.humanoid ? this.humanoid.costume : 'tee',
      axe: this.humanoid ? this.humanoid.equippedAxeId : 'sergey',
      quality: this.qualityPreset === 'ultra' ? 'high' : this.qualityPreset,
      mode: this.interactionMode,
      player: {
        x: +px.toFixed(3),
        y: +py.toFixed(3),
        z: +pz.toFixed(3)
      },
      anim: this.humanoid ? this.humanoid.currentAnimName : 'Idle',
      characterLoaded: Boolean(this.humanoid && this.humanoid.characterLoaded),
      axeAttachedTo: this.humanoid ? this.humanoid.axeAttachedTo : 'RightHand',
      trees: tf ? tf.stats() : { standing: 0, chopping: 0, falling: 0, felled: 0 },
      nearestTree: nearest
    };
  }

  _exposeGlobalAPI() {
    window.swing = (power) => this.swing(power);
    window.plantWedge = () => this.plantSplittingWedge();
    window.flipLog = () => this.flipActiveLog();
    window.heaveWithPeavey = () => this.heaveLogWithPeavey();
    window.stokeBonfire = () => this.stokeBackyardBonfire();
    window.claimFirewoodOrder = () => this.bundleFirewoodContract();
    window.scatterCritters = () => this.scatterBackyardCritters();
    window.triggerLightning = () => this.triggerThunderstormBolt();
    window.resetScene = () => this.resetScene();
    window.getGameState = () => this.getGameState();
    window.getAudioState = () => this.getAudioState();
    window.audioDemo = (seconds) => this.audioDemo(seconds);
    window.sim = this;

    window.chopperTest = {
      ready: () => {
        const tf = this.environment ? this.environment.getTreeField() : null;
        return Boolean(
          this._assetsReady &&
            this.humanoid &&
            this.humanoid.characterLoaded &&
            tf &&
            tf.trees &&
            tf.trees.length > 0
        );
      },
      setSetting: (setting) => this.switchBackyardSetting(setting),
      setCostume: (costume) => this.switchSergeyCostume(costume),
      setAxe: (axe) => this.setEquippedAxeById(axe),
      setQuality: (q) => {
        const normQ = ['low', 'medium', 'high', 'ultra'].includes(q) ? q : 'low';
        this.setQualityPreset(normQ);
        this._stepFrame(true);
        return normQ;
      },
      enterYard: () => this.enterYardMode(),
      enterStump: () => this.enterStumpMode(),
      teleportNearTree: () => this.teleportNearTree(),
      chopTree: () => this.chopTreeUntilFelled(),
      state: () => this._getChopperTestState()
    };
  }

  _updateWeatherBadge(weather) {
    const pill = document.getElementById('weather-effect-pill');
    if (!pill) return;
    const labels = {
      sun: 'Dry Grip (1.0x)',
      rain: this.atmosphere.isStormCharged()
        ? '\u26A1 Storm Surge (+15% Cleave)'
        : 'Thunderstorm (+20% XP)',
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
    const logDef = this.gameState.getCurrentLogDef();
    const cm = (diag.aimOffsetX * 100).toFixed(1);
    const deg = Math.round((diag.grainAngleError * 180) / Math.PI);
    const normOff = Math.abs(diag.aimOffsetX) / logDef.radius;

    let warn = '';
    if (diag.hitPlantedWedge) {
      warn =
        diag.plantedWedgeCount >= 2
          ? ' \u2022 \uD83C\uDFAF TANDEM WEDGES (2) LOCKED!'
          : ' \u2022 \uD83C\uDFAF STEEL WEDGE LOCKED!';
    } else if (diag.rockDistance < 0.042) {
      warn = ' \u2022 \u26A0 GRANITE ROCK HAZARD!';
    } else if (diag.nailDistance < 0.038) {
      warn = ' \u2022 \u26A0 NAIL HAZARD!';
    } else if (diag.knotDistance < 0.04) {
      warn = ' \u2022 \u26A0 KNOT HAZARD!';
    } else if (logDef.hasCrystalGeode && normOff < 0.38) {
      warn = ' \u2022 \uD83D\uDC8E CRYSTAL GEODE SEAM!';
    } else if (logDef.hasPinchedKerf && normOff < 0.32 && diag.grainAngleError < 0.38) {
      warn = ' \u2022 \uD83E\uDE9A PINCHED SAWMILL KERF!';
    } else if (logDef.isHollow && normOff < 0.21) {
      warn = ' \u2022 \u26A0 HOLLOW ROT CORE!';
    } else if (logDef.isLightningStruck && normOff < 0.34 && diag.grainAngleError < 0.38) {
      warn = ' \u2022 \u26A1 LIGHTNING FISSURE!';
    }
    if (this.gameState.isLogFlipped) {
      warn += ' \u2022 \u2195 INVERTED BASE';
    }
    if (this.gameState.isPeaveySeated) {
      warn += ' \u2022 \u2693 PEAVEY SEATED';
    }
    if (this.gameState.isEmberTempered()) {
      warn += ' \u2022 \uD83D\uDD25 EMBER BLADE';
    }
    if (this.atmosphere.isStormCharged()) {
      warn += ' \u2022 \u26C8 STORM SURGE';
    }
    el.textContent = `Aim: ${cm} cm \u2022 Grain Offset: ${deg}\u00B0${warn}`;
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
    title.style.color =
      result.glancing || result.hitNail || result.hitRock
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

  _updateChallengeStatusPill() {
    const pill = document.getElementById('challenge-status-pill');
    if (!pill) return;
    const gs = this.gameState;
    if (gs.gameMode === 'time_attack') {
      pill.textContent = `${gs.challengeTimer.toFixed(1)}s \u2022 ${gs.challengeSplits} Splits`;
    } else if (gs.gameMode === 'precision') {
      const avg =
        gs.precisionStrikes > 0
          ? (gs.precisionErrorSumCm / gs.precisionStrikes).toFixed(1)
          : '0.0';
      pill.textContent = `Avg Err: ${avg} cm`;
    } else if (gs.gameMode === 'endless') {
      const mult = Math.round((1 + Math.min(1.6, gs.challengeSplits * 0.08)) * 100);
      pill.textContent = `Run: ${gs.challengeSplits} \u2022 ${mult}% HP`;
    } else if (gs.gameMode === 'daily_seed') {
      pill.textContent = `Seed: ${gs.dailySeedStr}`;
    } else {
      const rem = 6 - (gs.logsSplitCount % 6);
      pill.textContent = LOG_TYPES[gs.logType]?.isBoss
        ? 'BOSS ACTIVE!'
        : `Boss in ${rem}`;
    }
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

    // Update Blade Edge Sharpness Condition, Sticky Pine Pitch Sap Buildup & Level-5 Ember-Tempered Blade bar
    const cond = Math.round(gs.axeCondition);
    const sap = Math.round(gs.axeSapBuildup || 0);
    const emberOn = gs.isEmberTempered();
    if (this.humanoid && typeof this.humanoid.updateBladeConditionVisuals === 'function') {
      this.humanoid.updateBladeConditionVisuals(cond, sap, emberOn);
    }
    if (this.environment && typeof this.environment.setBonfireLevel === 'function') {
      this.environment.setBonfireLevel(gs.bonfireLevel || 1);
    }
    if (this.environment && typeof this.environment.updateFirewoodStand === 'function') {
      this.environment.updateFirewoodStand(
        gs.ordersCompletedCount,
        gs.currentOrder ? gs.currentOrder.progress : 0
      );
    }
    setTxt(
      'hud-edge-text',
      emberOn
        ? `${cond}% \u2022 \uD83D\uDD25 Ember (${Math.ceil(gs.emberEdgeTimer)}s)`
        : sap >= 25
        ? `${cond}% \u2022 ${sap}% Sap [H/B]`
        : cond < 65
        ? `${cond}% (Hone [H])`
        : `${cond}% Sharp`
    );
    const edgeFill = document.getElementById('hud-edge-fill');
    if (edgeFill) {
      edgeFill.style.width = `${Math.min(100, cond)}%`;
      edgeFill.style.background =
        emberOn
          ? 'linear-gradient(90deg, #f97316, #fde047)'
          : sap >= 40
          ? 'linear-gradient(90deg, #d97706, #fbbf24)'
          : cond < 50
          ? 'linear-gradient(90deg, #ef4444, #f97316)'
          : cond < 78
          ? 'linear-gradient(90deg, #f59e0b, #fde047)'
          : 'linear-gradient(90deg, #38bdf8, #818cf8)';
    }

    // Update Roadside Stand Contract Order status in Left Panel
    if (gs.currentOrder) {
      setTxt(
        'order-status-pill',
        `${gs.currentOrder.progress} / ${gs.currentOrder.target} (#${gs.ordersCompletedCount + 1})`
      );
      const orderDescEl = document.getElementById('order-desc');
      if (orderDescEl) {
        orderDescEl.textContent = `${gs.currentOrder.title} (\u2605 ${gs.currentOrder.rewardCredits} Payout) \u2022 Press [O] to Bundle`;
      }
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

    this._updateChallengeStatusPill();
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

    // Update Tire & Chain Collar status row
    const collarLvlEl = document.getElementById('upg-collar-lvl');
    const collarBtnEl = document.getElementById('upg-collar-btn');
    if (collarLvlEl) {
      collarLvlEl.textContent = !gs.collarUnlocked
        ? 'Locked'
        : gs.collarActive
        ? 'Active [C]'
        : 'Stowed [C]';
    }
    if (collarBtnEl) {
      if (!gs.collarUnlocked) {
        collarBtnEl.textContent = 'Buy (\u2605 350)';
        collarBtnEl.disabled = gs.credits < 350;
        collarBtnEl.className = 'btn btn-buy';
      } else if (gs.collarActive) {
        collarBtnEl.textContent = 'Active (Stow)';
        collarBtnEl.disabled = false;
        collarBtnEl.className = 'btn btn-buy btn-equipped';
      } else {
        collarBtnEl.textContent = 'Equip Collar';
        collarBtnEl.disabled = false;
        collarBtnEl.className = 'btn btn-buy';
      }
    }

    // Update Custom Handle Grip Wrap & Shock-Mount status row
    const wrapLvlEl = document.getElementById('upg-wrap-lvl');
    const wrapDescEl = document.getElementById('upg-wrap-desc');
    const wrapBtnEl = document.getElementById('upg-wrap-btn');
    const curWrap = gs.getHandleWrap();
    const nextWrapCost = gs.getHandleWrapUpgradeCost();
    const nextWrapDef = HANDLE_WRAPS[(gs.handleWrapLevel || 0) + 1] || curWrap;
    if (wrapLvlEl && curWrap) {
      wrapLvlEl.textContent = `Lv ${gs.handleWrapLevel || 0} \u2022 ${curWrap.name}`;
    }
    if (wrapDescEl && nextWrapDef) {
      wrapDescEl.textContent =
        nextWrapCost === null
          ? `MAXED: ${curWrap.desc}`
          : `Next (${nextWrapDef.name}): ${nextWrapDef.desc}`;
    }
    if (wrapBtnEl) {
      if (nextWrapCost === null) {
        wrapBtnEl.textContent = 'MAXED';
        wrapBtnEl.disabled = true;
      } else {
        wrapBtnEl.textContent = `Upgrade (\u2605 ${nextWrapCost})`;
        wrapBtnEl.disabled = gs.credits < nextWrapCost;
      }
    }

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

    // Handle Hit-Stop freeze & Perfect-Hit / Boss Slow-Mo pulse
    let effectiveScale = this.timeScale;
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - rawDt);
      effectiveScale = 0.04;
    } else if (this.juiceSlowMoTimer > 0) {
      this.juiceSlowMoTimer = Math.max(0, this.juiceSlowMoTimer - rawDt);
      if (!this.slowMotion) {
        effectiveScale = 0.28;
      }
    }
    const dt = rawDt * effectiveScale;

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
      if (this.sound && typeof this.sound.playMeterTick === 'function') {
        this.sound.playMeterTick(this.meterPos);
      }
      this._updateTimingNeedleDOM();
    }

    // Regenerate player stamina when idle & tick challenge timer
    const isIdle = this.humanoid.state === 'IDLE';
    const prevStam = Math.round(this.gameState.stamina);
    this.gameState.updateStamina(rawDt, isIdle, this.atmosphere.weather);
    if (this.gameState.gameMode === 'time_attack') {
      this._updateChallengeStatusPill();
    }
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

    this._elapsedClock += dt;
    this._stepYardLocomotion(rawDt);
    if (this.woodchipsBurst) {
      this.woodchipsBurst.update(dt);
    }
    if (this.environment && typeof this.environment.updateTreesAndWind === 'function') {
      this.environment.updateTreesAndWind(
        this.camera,
        dt,
        this._elapsedClock,
        this.atmosphere.windStrength
      );
    }

    this.atmosphere.update(dt, this.gameState.logsSplitCount);
    if (this.sound) {
      if (typeof this.sound.updateMusicState === 'function') {
        const shopModalEl = document.getElementById('shop-modal');
        const shopOpen = Boolean(shopModalEl && !shopModalEl.classList.contains('hidden'));
        const isBoss = Boolean(this.gameState.getCurrentLogDef()?.isBoss);
        const isSwinging = this.humanoid.state !== 'IDLE';
        const isActiveGameplay =
          this._lastActionTime > 0 &&
          (now - this._lastActionTime < 14000 || isSwinging || this.gameState.combo > 0);
        this.sound.updateMusicState({
          isBoss,
          combo: this.gameState.combo,
          isSwinging,
          shopOpen,
          gameMode: this.gameState.gameMode,
          isActiveGameplay
        });
      }
      if (typeof this.sound.tickAmbientSoundscape === 'function') {
        this.sound.tickAmbientSoundscape(
          rawDt,
          this.atmosphere.weather,
          this.atmosphere.timeOfDay,
          this.gameState.bonfireLevel,
          this.atmosphere.windVector ? this.atmosphere.windVector.length() : 0.2
        );
      }
    }
    this.debugWireframe.update();

    if (this.interactionMode === 'stump') {
      this.controls.update();
    }
    this._updateTelemetry();

    // Apply decaying trauma camera shake around OrbitControls camera position
    let appliedShake = false;
    if (this.cameraShakeTrauma > 0.005) {
      const shakeMag = this.cameraShakeTrauma * this.cameraShakeTrauma * 0.065;
      this.shakeOffset.set(
        (Math.random() - 0.5) * 2 * shakeMag,
        (Math.random() - 0.5) * 2 * shakeMag,
        (Math.random() - 0.5) * 2 * shakeMag
      );
      this.camera.position.add(this.shakeOffset);
      appliedShake = true;
      this.cameraShakeTrauma = Math.max(0, this.cameraShakeTrauma - rawDt * 2.8);
    }

    if (shouldRender) {
      if (this.useComposer && this.composer) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    }

    if (appliedShake) {
      this.camera.position.sub(this.shakeOffset);
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
