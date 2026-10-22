import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';

import { BLOCK, createEnvironment } from './environment.js';
import { Humanoid } from './humanoid.js';
import { Axe, quaternionFromHandleAndBlade } from './axe.js';
import { DebrisSystem } from './debris.js';
import { SoundEngine } from './audio.js';
import {
  AXES,
  CAMPAIGN_SPLITS,
  GameState,
  LOG_TYPES,
  RUN_MODES,
  UPGRADES,
  chapterFor,
  makeBossProfile,
  makeHazards,
  makeKnots,
  modeFor,
  upgradeCost,
} from './game.js';
import { QUALITY_PRESETS, QualityManager } from './quality.js';
import { WeatherSystem } from './weather.js';
import { PostFX } from './postfx.js';
import { clamp, easeInCubic, easeInOutCubic, easeOutCubic } from './utils.js';

const FIXED_STEP = 1 / 60;
const MAX_STEPS = 18;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const HOME_POSITION = new THREE.Vector3(3.65, 2.72, 4.9);
const HOME_TARGET = new THREE.Vector3(0, 1.02, -0.52);
const PORTRAIT_POSITION = new THREE.Vector3(5.1, 3.4, 6.9);
const PORTRAIT_TARGET = new THREE.Vector3(0, 1.0, -0.52);
const WEATHER_TEMPERATURE = { clear: 18, rain: 12, snow: -2, fog: 8, wind: 14 };
const TIME_ICONS = { dawn: '◔', noon: '●', golden: '◐', night: '☾' };

function getHomeView() {
  const portrait = window.innerWidth / Math.max(1, window.innerHeight) < 0.8;
  return {
    position: portrait ? PORTRAIT_POSITION.clone() : HOME_POSITION.clone(),
    target: portrait ? PORTRAIT_TARGET.clone() : HOME_TARGET.clone(),
  };
}

function el(id) {
  return document.getElementById(id);
}

const ui = {
  canvas: el('scene'),
  loading: el('loading'),
  loadingStatus: el('loadingStatus'),
  loadingBar: el('loadingBar'),
  errorPanel: el('errorPanel'),
  errorMessage: el('errorMessage'),
  scoreReadout: el('scoreReadout'),
  comboReadout: el('comboReadout'),
  comboStat: el('comboStat'),
  streakReadout: el('streakReadout'),
  coinReadout: el('coinReadout'),
  levelReadout: el('levelReadout'),
  xpReadout: el('xpReadout'),
  xpBar: el('xpBar'),
  fragmentReadout: el('fragmentReadout'),
  fpsReadout: el('fpsReadout'),
  qualityReadout: el('qualityReadout'),
  timeReadout: el('timeReadout'),
  weatherReadout: el('weatherReadout'),
  timeIcon: el('timeIcon'),
  logTier: el('logTier'),
  logName: el('logName'),
  logBlurb: el('logBlurb'),
  logDifficulty: el('logDifficulty'),
  logKnots: el('logKnots'),
  logNext: el('logNext'),
  logModifiers: el('logModifiers'),
  logCard: document.querySelector('.log-card'),
  roundHealth: el('roundHealth'),
  roundHealthLabel: el('roundHealthLabel'),
  roundHealthValue: el('roundHealthValue'),
  roundHealthBar: el('roundHealthBar'),
  wedgeButton: el('wedgeButton'),
  aimChip: el('aimChip'),
  aimReadout: el('aimReadout'),
  staminaText: el('staminaText'),
  staminaBar: el('staminaBar'),
  axeName: el('axeName'),
  axeStats: el('axeStats'),
  sharpnessChip: el('sharpnessChip'),
  weightChip: el('weightChip'),
  costChip: el('costChip'),
  powerLabel: el('powerLabel'),
  forceValue: el('forceValue'),
  timingReadout: el('timingReadout'),
  qualityBonus: el('qualityBonus'),
  powerFill: el('powerFill'),
  powerKnob: el('powerKnob'),
  powerMeter: el('powerMeter'),
  controlDeck: document.querySelector('.control-deck'),
  swingButton: el('swingButton'),
  nextButton: el('nextButton'),
  slowButton: el('slowButton'),
  debugButton: el('debugButton'),
  soundButton: el('soundButton'),
  shopButton: el('shopButton'),
  settingsButton: el('settingsButton'),
  popupLayer: el('popupLayer'),
  toastHost: el('toastHost'),
  hitFlash: el('hitFlash'),
  shockPulse: el('shockPulse'),
  shopModal: el('shopModal'),
  shopCoins: el('shopCoins'),
  axeList: el('axeList'),
  upgradeList: el('upgradeList'),
  honeButton: el('honeButton'),
  honeStatus: el('honeStatus'),
  resetProgressButton: el('resetProgressButton'),
  modeStrip: el('modeStrip'),
  runTimer: el('runTimer'),
  runScoreChip: el('runScoreChip'),
  runOverlay: el('runOverlay'),
  runKicker: el('runKicker'),
  runTitle: el('runTitle'),
  runSub: el('runSub'),
  runScore: el('runScore'),
  runStats: el('runStats'),
  runHistory: el('runHistory'),
  runAgain: el('runAgain'),
  runExit: el('runExit'),
  runCopy: el('runCopy'),
  runSeed: el('runSeed'),
  runRetrySeed: el('runRetrySeed'),
  settingsModal: el('settingsModal'),
  qualitySelect: el('qualitySelect'),
  qualityDescription: el('qualityDescription'),
  rendererNote: el('rendererNote'),
  performanceNote: el('performanceNote'),
  timeButtons: el('timeButtons'),
  weatherButtons: el('weatherButtons'),
  autoTimeToggle: el('autoTimeToggle'),
  timeLabel: el('timeLabel'),
  weatherLabel: el('weatherLabel'),
  weatherNote: el('weatherNote'),
};

function setLoading(progress, message) {
  if (message && ui.loadingStatus) ui.loadingStatus.textContent = message;
  if (ui.loadingBar) ui.loadingBar.style.width = `${progress}%`;
}

function showFatalError(error) {
  console.error(error);
  if (ui.loading) ui.loading.classList.add('done');
  if (ui.errorPanel) {
    ui.errorPanel.hidden = false;
    ui.errorMessage.textContent =
      error && error.message
        ? error.message
        : 'The page could not initialize WebGL or load the physics engine.';
  }
}

/* ------------------------------------------------------------------ *
 *  Swing choreography poses
 * ------------------------------------------------------------------ */

function pose(grip, handle, blade, body) {
  return {
    grip: new THREE.Vector3(...grip),
    quaternion: quaternionFromHandleAndBlade(
      new THREE.Vector3(...handle),
      new THREE.Vector3(...blade),
    ),
    body,
  };
}

const REST = pose(
  [0.24, 1.1, 0.205],
  [0.52, 0.78, 0.35],
  [0.88, 0.18, -0.28],
  { lean: 0.015, twist: -0.08, side: 0.015, crouch: 0.01, hipX: 0, hipZ: 0, headPitch: 0.03, headYaw: 0.02 },
);

const TOP = pose(
  [0.11, 1.74, 0.195],
  [-0.02, 0.79, 0.615],
  [0.92, 0.05, 0.0],
  { lean: -0.15, twist: -0.4, side: -0.06, crouch: 0.05, hipX: 0.025, hipZ: 0.02, headPitch: -0.16, headYaw: 0.16 },
);

const IMPACT = pose(
  [0.015, 1.4, -0.215],
  [0.0, -0.575, -0.818],
  [0.0, -0.818, 0.575],
  { lean: 0.5, twist: 0.17, side: 0.025, crouch: 0.12, hipX: -0.02, hipZ: -0.055, headPitch: 0.2, headYaw: -0.01 },
);

const FOLLOW = pose(
  [-0.015, 1.1, -0.30],
  [0.01, -0.91, -0.414],
  [0.02, -0.414, 0.91],
  { lean: 0.39, twist: 0.05, side: 0.02, crouch: 0.135, hipX: -0.025, hipZ: -0.045, headPitch: 0.06, headYaw: -0.02 },
);

function lerpBody(a, b, t, out = {}) {
  out.lean = THREE.MathUtils.lerp(a.lean, b.lean, t);
  out.twist = THREE.MathUtils.lerp(a.twist, b.twist, t);
  out.side = THREE.MathUtils.lerp(a.side, b.side, t);
  out.crouch = THREE.MathUtils.lerp(a.crouch, b.crouch, t);
  out.hipX = THREE.MathUtils.lerp(a.hipX, b.hipX, t);
  out.hipZ = THREE.MathUtils.lerp(a.hipZ, b.hipZ, t);
  out.headPitch = THREE.MathUtils.lerp(a.headPitch, b.headPitch, t);
  out.headYaw = THREE.MathUtils.lerp(a.headYaw, b.headYaw, t);
  return out;
}

function blendPoses(a, b, t, arc = 0) {
  const grip = a.grip.clone().lerp(b.grip, t);
  if (arc) {
    grip.x += Math.sin(t * Math.PI) * arc;
    grip.y += Math.sin(t * Math.PI) * arc * 0.22;
  }
  const quaternion = new THREE.Quaternion().slerpQuaternions(a.quaternion, b.quaternion, t);
  const body = lerpBody(a.body, b.body, t);
  return { grip, quaternion, body };
}

function triangleWave(t, period) {
  const raw = (t / period) % 2;
  return raw <= 1 ? raw : 2 - raw;
}

/** Show fractional bites ("2.4") without noisy trailing zeroes. */
function formatBites(value) {
  const n = Math.max(0, Number(value) || 0);
  if (n < 0.05) return '0';
  return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
}

/* ------------------------------------------------------------------ *
 *  App
 * ------------------------------------------------------------------ */

class AxeSimulation {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.world = null;
    this.eventQueue = null;
    this.environment = null;
    this.weather = null;
    this.postfx = null;
    this.humanoid = null;
    this.axe = null;
    this.debris = null;
    this.sound = new SoundEngine();
    this.game = new GameState({
      storage: (() => {
        try {
          return window.localStorage;
        } catch {
          return null;
        }
      })(),
    });
    this.qualityManager = new QualityManager({
      onChange: (info) => {
        this.qualityApplyPromise = this.applyQuality(info);
      },
      onNotice: (notice) => {
        this.toast(notice.message, notice.kind === 'quality' ? 'gold' : '');
      },
    });
    this.qualityPreset = QUALITY_PRESETS.low;
    this.qualityName = 'low';
    this.postfxReady = false;
    this.accumulator = 0;
    this.simTime = 0;
    this.slowMotion = false;
    this.debugPhysics = false;
    this.phase = 'idle';
    this.idleTime = 0;
    this.sim = {
      active: false,
      t: 0,
      force: 68,
      windup: 0.5,
      strike: 0.23,
      follow: 0.24,
      recover: 0.95,
      impactAt: 0.73,
      total: 1.92,
      hit: false,
    };
    this.swingState = null;
    this.swingAim = { x: 0, z: 0 };
    this.pendingImpact = false;
    this.targetPose = {
      grip: REST.grip.clone(),
      quaternion: REST.quaternion.clone(),
      body: { ...REST.body },
    };
    this.previousHead = new THREE.Vector3();
    this.currentHead = new THREE.Vector3();
    this.headSpeed = 0;
    this.shake = 0;
    this.debugLines = null;
    this.lastFrame = performance.now();
    this.fps = 60;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.uiAccumulator = 0;
    this.ready = false;
    this.replayTimer = 0;
    this.nextLogTimer = 0;
    this.modalOpen = null;
    this.charge = { active: false, t: 0, value: 0, period: 1.28 };
    this.aim = { x: 0, z: 0 };
    this.effectiveAim = { x: 0, z: 0 };
    this.lastMeterValue = 0;
    this.meterTiming = 0;
    this.meterPerfect = false;
    this.hitStop = 0;
    this.perfectSlow = 0;
    this.chargeTick = 0;
    this.lastImpact = null;
    this.lastShockCount = 0;
    this.shockJolts = 0;
    this.displaySpecies = LOG_TYPES[0];
    this.bossRound = false;
    this.bossProfile = null;
    this.weatherBiteMod = 0;
    this.logWeatherNote = '';
    this.weatherCarryArmed = false;
    this.lastWeatherKey = '';
    this.weatherCarried = false;
    this.runOverlayOpen = false;
    this.lastRunMode = 'free';
    this.lastRunSeed = '';
    this.lastSummary = null;
    this.currentKnots = [];
    this.currentHazards = [];
    this.reticle = null;
    this.reticleColor = null;
    this.precisionGuide = null;
    this.precisionParts = [];
    this.shadowFrame = 0;
    this.renderScale = 1;
    this.adaptiveLow = 0;
    this.adaptiveHigh = 0;
    this.lastAdaptiveChange = 0;
    this.adaptiveNotified = false;
    this.pointer = new THREE.Vector2(0, 0);
    this.raycaster = new THREE.Raycaster();
    this.aimPlane = new THREE.Plane(UP, -1);
    this._scratch = {
      v: new THREE.Vector3(),
      v2: new THREE.Vector3(),
      point: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      color: new THREE.Color(),
    };
    this._tick = this._tick.bind(this);
    this.game.subscribe((type, detail) => this.onGameEvent(type, detail));
    this.restoreSoundSetting();
  }

  restoreSoundSetting() {
    const enabled = this.game.settings.sound !== false;
    this.sound.setEnabled(enabled);
    if (ui.soundButton) ui.soundButton.setAttribute('aria-pressed', `${enabled}`);
  }

  /* ---------------------------------------------------------------- *
   *  Initialization
   * ---------------------------------------------------------------- */

  async init() {
    setLoading(8, 'Waking up the renderer…');
    this.renderer = new THREE.WebGLRenderer({
      canvas: ui.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.08, 120);
    const homeView = getHomeView();
    this.camera.position.copy(homeView.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(homeView.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.85;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 13;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.enablePan = false;
    this.controls.mouseButtons.LEFT = null;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.controls.touches.ONE = null;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    this.controls.update();

    // Detect the renderer before building the yard so a software rasteriser
    // never pays for 10k grass blades and a 2k shadow map on the first frame.
    const rendererInfo = this.qualityManager.detect(this.renderer);
    const requestedQuality = this.game.settings.quality || 'auto';
    const initialName =
      requestedQuality === 'auto'
        ? this.qualityManager.ceiling
        : QUALITY_PRESETS[requestedQuality]
          ? requestedQuality
          : this.qualityManager.ceiling;
    this.qualityManager.current = initialName;
    this.qualityManager.mode = requestedQuality === 'auto' ? 'auto' : initialName;
    this.qualityManager.auto = requestedQuality === 'auto';
    const initialPreset = QUALITY_PRESETS[initialName];
    this.qualityPreset = initialPreset;
    this.qualityName = initialName;

    setLoading(20, 'Building the backyard…');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.02).texture;
    this.scene.environmentIntensity = 0.4;
    room.dispose?.();
    pmrem.dispose();

    this.environment = createEnvironment(this.scene, this.renderer, initialPreset);
    this.qualityManager.detect(this.renderer);

    setLoading(38, 'Loading Rapier rigid-body physics…');
    await RAPIER.init();
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_STEP;
    this.eventQueue = new RAPIER.EventQueue(true);
    this.buildPhysicsWorld();

    setLoading(54, 'Articulating the woodcutter…');
    this.humanoid = new Humanoid(this.scene);
    this.environment.onAmbient = (color, intensity) => {
      this.humanoid?.setAmbientTint?.(color, intensity);
    };
    this.humanoid.setRenderDetail?.(initialName);
    this.humanoid.setShadowMode?.(initialName);
    this.axe = new Axe(this.scene, this.world, this.RAPIER);
    this.debris = new DebrisSystem(this.scene, this.world, this.RAPIER, initialPreset);
    this.axe.reset(REST.grip, REST.quaternion);
    this.previousHead.copy(this.axe.getHeadWorld());
    this.currentHead.copy(this.previousHead);
    this.createReticle();
    this.createPrecisionGuide();

    setLoading(68, 'Hanging the lanterns and reading the weather…');
    this.weather = new WeatherSystem({
      scene: this.scene,
      renderer: this.renderer,
      env: this.environment,
      camera: this.camera,
      qualityPreset: initialPreset,
    });
    this.weather.setQuality(initialPreset);
    this.weather.setTimePreset(this.game.settings.timeOfDay);
    this.weather.setWeather(this.game.settings.weather);
    this.weather.setAutoTime(this.game.settings.autoTime);

    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    this.createDebugLines();

    // Install the quality manager's first real application (pixel ratio, grass
    // density, shadows, post-processing). This is async only if bloom loads.
    this.qualityManager.start(requestedQuality);
    await this.qualityApplyPromise;

    setLoading(80, 'Warming shaders…');
    this.loadCurrentLog({ initial: true });
    this.attachUI();
    this.updateHudStatic();
    this.updateHudLive();
    this.updateAtmosphereUi();
    this.renderShop();

    if (ui.qualitySelect) ui.qualitySelect.value = requestedQuality;
    if (ui.autoTimeToggle) ui.autoTimeToggle.checked = Boolean(this.game.settings.autoTime);
    if (ui.rendererNote) {
      ui.rendererNote.textContent = rendererInfo.software
        ? `Software renderer detected (${rendererInfo.name.slice(0, 48)}). Auto quality is pinned low.`
        : `Renderer: ${rendererInfo.name.slice(0, 64)}`;
    }

    this.renderer.compile(this.scene, this.camera);
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    setLoading(100, 'Ready to swing.');
    this.ready = true;
    window.__sim.ready = true;
    this.updateHudStatic();
    requestAnimationFrame(() => ui.loading?.classList.add('done'));
    this.lastFrame = performance.now();
    requestAnimationFrame(this._tick);
    this.applyUrlRun();
  }

  /**
   * Share links: ?mode=daily&seed=YYYY-MM-DD (or just ?seed=...) starts the
   * matching run after boot. Unknown values are ignored.
   */
  applyUrlRun() {
    try {
      const params = new URLSearchParams(window.location.search);
      const seed = params.get('seed') || '';
      const requested = params.get('mode') || (seed ? 'daily' : '');
      if (!requested) return;
      const mode = RUN_MODES.find((item) => item.id === requested);
      if (!mode) return;
      setTimeout(() => {
        if (!this.ready || this.runOverlayOpen) return;
        this.startMode(mode.id, seed);
      }, 450);
    } catch {
      // Bad URL params should never block the game.
    }
  }

  buildPhysicsWorld() {
    const R = this.RAPIER;
    const groundBody = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.world.createCollider(
      R.ColliderDesc.cuboid(30, 0.1, 30)
        .setTranslation(0, -0.1, 0)
        .setFriction(0.96)
        .setRestitution(0.02),
      groundBody,
    );

    const blockBody = this.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(BLOCK.x, BLOCK.top / 2, BLOCK.z),
    );
    this.world.createCollider(
      R.ColliderDesc.cylinder(BLOCK.top / 2, BLOCK.radius + 0.015)
        .setFriction(0.92)
        .setRestitution(0.05),
      blockBody,
    );

    for (const [x, z, hx, hz] of [
      [0, -7.4, 12, 0.2],
      [0, 6.5, 12, 0.2],
      [-9.2, 0, 0.2, 12],
      [9.2, 0, 0.2, 12],
    ]) {
      const b = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, 0.3, z));
      this.world.createCollider(R.ColliderDesc.cuboid(hx, 0.3, hz).setFriction(0.4), b);
    }
  }

  createReticle() {
    const group = new THREE.Group();
    group.name = 'aim-reticle';
    const material = new THREE.MeshBasicMaterial({
      color: 0xf3c47f,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.reticleColor = material;
    const outer = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.087, 28), material);
    outer.rotation.x = -Math.PI / 2;
    group.add(outer);
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.028, 0.035, 20), material);
    inner.rotation.x = -Math.PI / 2;
    group.add(inner);
    for (const [x, z, w, h] of [
      [0.125, 0, 0.045, 0.006],
      [-0.125, 0, 0.045, 0.006],
      [0, 0.125, 0.006, 0.045],
      [0, -0.125, 0.006, 0.045],
    ]) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(w, 0.004, h), material);
      tick.position.set(x, 0, z);
      group.add(tick);
    }
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.009, 10), material);
    dot.rotation.x = -Math.PI / 2;
    dot.position.y = 0.002;
    group.add(dot);
    group.position.set(0, BLOCK.top + 0.47, -0.95);
    group.renderOrder = 8;
    const reticleGeometries = [];
    for (const child of [...group.children]) {
      if (!child.isMesh) continue;
      child.updateMatrix();
      let geometry = child.geometry.clone();
      geometry.applyMatrix4(child.matrix);
      if (geometry.index) geometry = geometry.toNonIndexed();
      reticleGeometries.push(geometry);
      group.remove(child);
    }
    const mergedReticle = mergeGeometries(reticleGeometries, false);
    for (const geometry of reticleGeometries) geometry.dispose();
    if (mergedReticle) {
      const merged = new THREE.Mesh(mergedReticle, material);
      merged.castShadow = false;
      merged.receiveShadow = false;
      merged.renderOrder = 8;
      group.add(merged);
    }
    this.scene.add(group);
    this.reticle = group;
  }

  /**
   * Precision-only target language: a green pith ring marks the 72% centre
   * threshold and red halos mark the knot exclusion zones. One line draw each.
   */
  createPrecisionGuide() {
    const group = new THREE.Group();
    group.name = 'precision-guide';
    group.renderOrder = 8;
    const pithMat = new THREE.LineBasicMaterial({
      color: 0xb9e38c,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      toneMapped: false,
    });
    const knotMat = new THREE.LineBasicMaterial({
      color: 0xe0785c,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      toneMapped: false,
    });
    const pithLines = new THREE.LineSegments(new THREE.BufferGeometry(), pithMat);
    const knotLines = new THREE.LineSegments(new THREE.BufferGeometry(), knotMat);
    pithLines.frustumCulled = false;
    knotLines.frustumCulled = false;
    pithLines.renderOrder = 9;
    knotLines.renderOrder = 9;
    group.add(pithLines, knotLines);
    group.visible = false;
    this.scene.add(group);
    this.precisionGuide = { group, pithLines, knotLines, pithMat, knotMat };
  }

  buildPrecisionGuide() {
    if (!this.debris) return;
    if (!this.precisionGuide) this.createPrecisionGuide();
    const guide = this.precisionGuide;
    const addCircle = (positions, cx, cz, radius, segments = 40) => {
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        positions.push(
          cx + Math.cos(a0) * radius, 0, cz + Math.sin(a0) * radius,
          cx + Math.cos(a1) * radius, 0, cz + Math.sin(a1) * radius,
        );
      }
    };
    const pithPositions = [];
    const knotPositions = [];
    // 72% centre threshold => d <= 0.2856 r.
    for (const pith of this.debris.piths) {
      addCircle(pithPositions, pith.x, pith.z, this.debris.radius * 0.2856);
      addCircle(pithPositions, pith.x, pith.z, this.debris.radius * 0.022, 12);
    }
    for (const knot of this.currentKnots || []) {
      addCircle(knotPositions, knot.x, knot.z, knot.radius * 1.65, 28);
    }
    const setLine = (object, positions) => {
      object.geometry.dispose();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.computeBoundingSphere();
      object.geometry = geo;
    };
    setLine(guide.pithLines, pithPositions);
    setLine(guide.knotLines, knotPositions);
    guide.knotLines.visible = knotPositions.length > 0;
    guide.group.position.set(0, this.debris.topY + 0.022, -0.95);
  }

  createDebugLines() {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.86,
      depthTest: false,
      toneMapped: false,
    });
    this.debugLines = new THREE.LineSegments(geometry, material);
    this.debugLines.frustumCulled = false;
    this.debugLines.renderOrder = 999;
    this.debugLines.visible = false;
    this.scene.add(this.debugLines);
  }

  /* ---------------------------------------------------------------- *
   *  Quality
   * ---------------------------------------------------------------- */

  computeDpr(preset = this.qualityPreset) {
    const base = Math.min(window.devicePixelRatio || 1, preset.maxDpr) * preset.pixelRatio;
    return Math.max(0.12, base * this.renderScale);
  }

  applyPixelRatio() {
    if (!this.renderer) return;
    const dpr = this.computeDpr();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.postfx?.resize(window.innerWidth, window.innerHeight, dpr);
  }

  async applyQuality({ name, preset, reason, previous = null }) {
    const changed = this.qualityName !== name || Boolean(previous && previous !== name);
    this.qualityName = name;
    this.qualityPreset = preset;
    if (changed || reason === 'startup' || reason === 'manual') {
      this.renderScale = preset.maxDpr <= 0.45 ? 0.65 : 1;
    }
    const dpr = this.computeDpr(preset);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    const shadowsEnabled = Boolean(preset.shadows) && preset.shadowSize > 0;
    if (this.renderer.shadowMap.enabled !== shadowsEnabled) {
      this.renderer.shadowMap.enabled = shadowsEnabled;
      this.scene.traverse((object) => {
        if (!object.material) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.needsUpdate = true;
      });
    }
    this.environment?.setQuality?.(preset);
    this.weather?.setQuality?.(preset);
    this.debris?.setQuality?.(preset);
    this.humanoid?.setRenderDetail?.(name);
    this.humanoid?.setShadowMode?.(name);
    document.body.dataset.quality = name;
    if (this.postfx) {
      try {
        await this.postfx.setQuality(preset);
        this.postfxReady = Boolean(this.postfx.enabled);
      } catch {
        this.postfxReady = false;
      }
      this.postfx.resize(window.innerWidth, window.innerHeight, dpr);
    }
    this.renderer.shadowMap.needsUpdate = true;
    if (reason === 'manual') {
      this.toast(`Quality: ${preset.name}`, 'gold');
    }
    this.updateAtmosphereUi();
    this.updateHudStatic();
  }

  /* ---------------------------------------------------------------- *
   *  UI wiring
   * ---------------------------------------------------------------- */

  attachUI() {
    ui.swingButton?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.sound.ensure();
      this.beginCharge('button');
    });
    ui.swingButton?.addEventListener('contextmenu', (event) => event.preventDefault());

    ui.nextButton?.addEventListener('click', () => {
      this.sound.ensure();
      this.resetScene(true);
    });
    ui.slowButton?.addEventListener('click', () => {
      this.sound.ensure();
      this.toggleSlowMotion();
    });
    ui.debugButton?.addEventListener('click', () => this.toggleDebug());
    ui.soundButton?.addEventListener('click', () => {
      const enabled = ui.soundButton.getAttribute('aria-pressed') !== 'true';
      this.setSound(enabled);
    });
    ui.shopButton?.addEventListener('click', () => this.openModal('shop'));
    ui.settingsButton?.addEventListener('click', () => this.openModal('settings'));

    ui.modeStrip?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-mode]');
      if (!button) return;
      this.startMode(button.getAttribute('data-mode'));
    });

    ui.wedgeButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.sound.ensure();
      this.driveWedge();
    });

    ui.honeButton?.addEventListener('click', () => {
      const result = this.game.honeEdge();
      if (result.ok) {
        this.toast(`Whetstone — edge restored for ${result.cost} coins`, 'good');
        this.sound.chime?.(0.85);
        this.updateHudStatic();
      } else {
        this.toast(result.reason, 'bad');
      }
      this.renderShop();
    });

    ui.runAgain?.addEventListener('click', () => {
      const mode = this.lastRunMode || 'free';
      this.startMode(mode, mode === 'daily' ? this.lastRunSeed : '');
    });
    ui.runExit?.addEventListener('click', () => {
      this.startMode('free');
    });
    ui.runCopy?.addEventListener('click', () => {
      this.copyShare();
    });
    ui.runSeed?.addEventListener('click', () => {
      this.copySeedLink();
    });
    ui.runRetrySeed?.addEventListener('click', () => {
      this.retrySeed();
    });

    document.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', () => this.closeModal(button.getAttribute('data-close')));
    });

    ui.qualitySelect?.addEventListener('change', () => {
      this.qualityManager.setMode(ui.qualitySelect.value);
      this.game.setQuality(ui.qualitySelect.value);
      this.updateAtmosphereUi();
    });

    ui.timeButtons?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-time]');
      if (!button) return;
      const time = button.getAttribute('data-time');
      this.weather.setTimePreset(time);
      this.game.setSetting('timeOfDay', time);
      this.updateAtmosphereUi();
      this.toast(`Time: ${time === 'golden' ? 'golden hour' : time}`, 'gold');
    });

    ui.weatherButtons?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-weather]');
      if (!button) return;
      const weather = button.getAttribute('data-weather');
      this.weather.setWeather(weather);
      this.debris.setWeather(this.weather.getModifiers());
      this.game.setSetting('weather', weather);
      this.weatherCarryArmed = false;
      this.lastWeatherKey = '';
      this.loadCurrentLog({ announce: false });
      this.updateAtmosphereUi();
      this.toast(`Weather: ${this.weather.weatherLabel}`, 'gold');
    });

    ui.autoTimeToggle?.addEventListener('change', () => {
      const auto = Boolean(ui.autoTimeToggle.checked);
      this.weather.setAutoTime(auto);
      this.game.setSetting('autoTime', auto);
      this.updateAtmosphereUi();
    });

    ui.axeList?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-axe]');
      if (!button) return;
      const axeId = button.getAttribute('data-axe');
      const mode = button.getAttribute('data-mode');
      if (mode === 'buy') {
        const result = this.game.buyAxe(axeId);
        if (result.ok) {
          this.toast(`Bought ${result.axe.name}`, 'good');
          this.sound.chime(0.8);
        } else {
          this.toast(result.reason, 'bad');
        }
      } else if (mode === 'equip') {
        if (this.game.equipAxe(axeId)) {
          this.toast(`Equipped ${this.game.axe.name}`, 'good');
          this.sound.chime(0.6);
        }
      }
      this.renderShop();
      this.updateHudStatic();
    });

    ui.upgradeList?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-upgrade]');
      if (!button) return;
      const stat = button.getAttribute('data-upgrade');
      const result = this.game.buyUpgrade(stat);
      if (result.ok) {
        this.toast(`${UPGRADES[stat].name} → ${result.level}`, 'good');
        this.sound.chime(0.8);
      } else {
        this.toast(result.reason, 'bad');
      }
      this.renderShop();
      this.updateHudStatic();
    });

    ui.resetProgressButton?.addEventListener('click', () => {
      this.game.resetProgress();
      this.resetScene(true);
      this.renderShop();
      this.updateHudStatic();
      this.toast('Progress reset. Back to white pine.', 'gold');
    });

    // Mouse aim + hold-to-charge.
    ui.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    ui.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.sound.ensure();
      this.onPointerMove(event);
      this.beginCharge('mouse');
    });
    window.addEventListener('pointerup', (event) => {
      if (event.button !== 0) return;
      this.releaseCharge();
    });
    window.addEventListener('pointercancel', () => this.cancelCharge());
    window.addEventListener('blur', () => this.cancelCharge());
    ui.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keyup', (event) => this.onKeyUp(event));
    window.addEventListener('resize', () => this.onResize());
  }

  onKeyDown(event) {
    if (event.key === 'Escape' && this.runOverlayOpen) {
      this.startMode('free');
      return;
    }
    if (event.key === 'Escape' && this.modalOpen) {
      this.closeModal(this.modalOpen);
      return;
    }
    if (this.modalOpen || this.runOverlayOpen) return;
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (event.code !== 'Space') return;
    }
    switch (event.code) {
      case 'Space':
        event.preventDefault();
        if (!event.repeat) {
          this.sound.ensure();
          this.beginCharge('space');
        }
        break;
      case 'KeyR':
        this.resetScene(true);
        break;
      case 'KeyF':
        event.preventDefault();
        this.driveWedge();
        break;
      case 'KeyT':
        this.toggleSlowMotion();
        break;
      case 'KeyD':
        this.toggleDebug();
        break;
      case 'KeyQ':
        this.rotateCamera(1);
        break;
      case 'KeyE':
        this.rotateCamera(-1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.nudgeAim(-1, 0);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.nudgeAim(1, 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.nudgeAim(0, -1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.nudgeAim(0, 1);
        break;
      default:
        break;
    }
  }

  onKeyUp(event) {
    if (event.code === 'Space' && this.charge.active) {
      event.preventDefault();
      this.releaseCharge();
    }
  }

  onPointerMove(event) {
    if (!this.ready || !this.debris) return;
    if (this.modalOpen) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    this.updateAimFromPointer();
  }

  updateAimFromPointer() {
    if (!this.debris || this.debris.active) return;
    const metrics = this.debris.getLogMetrics();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.aimPlane.constant = -(metrics.topY + 0.005);
    const point = this.raycaster.ray.intersectPlane(this.aimPlane, this._scratch.point);
    if (!point) return;
    const maxRadius = metrics.radius * 1.12;
    let dx = point.x - metrics.x;
    let dz = point.z - metrics.z;
    const dist = Math.hypot(dx, dz);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dz = (dz / dist) * maxRadius;
    }
    this.aim.x = dx;
    this.aim.z = dz;
    this.updateAimHud();
  }

  nudgeAim(dx, dz) {
    if (!this.debris || this.debris.active) return;
    const maxRadius = this.debris.radius * 1.05;
    this.aim.x = clamp(this.aim.x + dx * this.debris.radius * 0.12, -maxRadius, maxRadius);
    this.aim.z = clamp(this.aim.z + dz * this.debris.radius * 0.12, -maxRadius, maxRadius);
    this.updateAimHud();
  }

  rotateCamera(direction) {
    if (!this.controls || !this.camera) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(Y_AXIS, direction * 0.18);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  /* ---------------------------------------------------------------- *
   *  Modals, shop, toasts
   * ---------------------------------------------------------------- */

  openModal(name) {
    this.cancelCharge();
    this.modalOpen = name;
    const modal = name === 'shop' ? ui.shopModal : ui.settingsModal;
    if (!modal) return;
    modal.hidden = false;
    if (name === 'shop') this.renderShop();
    if (name === 'settings') this.updateAtmosphereUi();
    modal.querySelector('.modal-close')?.focus();
  }

  closeModal(name) {
    const modal = name === 'shop' ? ui.shopModal : ui.settingsModal;
    if (modal) modal.hidden = true;
    if (this.modalOpen === name) this.modalOpen = null;
  }

  renderShop() {
    if (!ui.axeList || !ui.upgradeList) return;
    const snapshot = this.game.snapshot();
    if (ui.shopCoins) ui.shopCoins.textContent = snapshot.coins.toLocaleString();
    const owned = this.game.ownedAxes;

    ui.axeList.innerHTML = AXES.map((axe) => {
      const equipped = this.game.state.axeId === axe.id;
      const isOwned = owned.has(axe.id);
      const locked = snapshot.level < axe.unlockLevel;
      let mode = 'locked';
      let label = `LV ${axe.unlockLevel}`;
      if (equipped) {
        mode = 'equipped';
        label = 'Equipped';
      } else if (isOwned) {
        mode = 'equip';
        label = 'Equip';
      } else if (!locked) {
        mode = 'buy';
        label = snapshot.coins >= axe.cost ? `Buy · ${axe.cost}` : `Need ${axe.cost - snapshot.coins}`;
      }
      const disabled = mode === 'equipped' || mode === 'locked' || (mode === 'buy' && snapshot.coins < axe.cost);
      return `
        <article class="axe-card ${equipped ? 'equipped' : ''} ${locked ? 'locked' : ''}">
          <div class="axe-glyph" style="color:${axe.color}">
            <svg viewBox="0 0 32 40" aria-hidden="true">
              <path class="glyph-steel" d="M19 3l10 8-6 8-10-8z"/>
              <path class="glyph-handle" d="M16 14L8 37" stroke-width="3" fill="none" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="axe-info">
            <h3>${axe.name}</h3>
            <p>${axe.desc}</p>
            <div class="axe-meta">
              <span>Sharp ${axe.sharpness.toFixed(2)}</span>
              <span>Weight ${axe.weight.toFixed(2)}</span>
              <span>Stamina ${axe.stamina.toFixed(2)}</span>
            </div>
          </div>
          <button class="buy-button ${mode}" type="button" data-axe="${axe.id}" data-mode="${mode}" ${disabled ? 'disabled' : ''}>${label}</button>
        </article>
      `;
    }).join('');

    ui.upgradeList.innerHTML = Object.values(UPGRADES).map((def) => {
      const level = snapshot.upgrades[def.id];
      const cost = upgradeCost(def.id, level);
      const maxed = level >= def.max;
      const canBuy = !maxed && snapshot.coins >= cost;
      const pips = Array.from({ length: def.max }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
      return `
        <article class="upgrade-card">
          <div class="upgrade-info">
            <h3>${def.name} <span>LV ${level} / ${def.max}</span></h3>
            <p>${def.desc}</p>
            <div class="pips">${pips}</div>
          </div>
          <div class="upgrade-action">
            <button class="buy-button" type="button" data-upgrade="${def.id}" ${maxed || !canBuy ? 'disabled' : ''}>
              ${maxed ? 'Maxed' : `Upgrade · ${cost}`}
            </button>
            <small>${maxed ? 'Bench complete' : `Balance ${snapshot.coins}`}</small>
          </div>
        </article>
      `;
    }).join('');

    if (ui.honeStatus && ui.honeButton) {
      const wearPercent = Math.round(snapshot.edgeIntegrity * 100);
      const hone = this.game.canHone();
      ui.honeStatus.textContent =
        snapshot.edgeWear <= 0.008
          ? `Edge ${wearPercent}% · no chips`
          : `Edge ${wearPercent}% · ${snapshot.edgeWear >= 0.35 ? 'badly rolled' : 'chipped'} · repair ${snapshot.honeCost}`;
      ui.honeStatus.classList.toggle('dull', snapshot.edgeWear > 0.008);
      ui.honeButton.textContent = hone.ok ? `Hone · ${hone.cost}` : snapshot.edgeWear <= 0.008 ? 'Hone · sharp' : `Need ${hone.cost - snapshot.coins}`;
      ui.honeButton.disabled = !hone.ok;
    }
  }

  toast(message, kind = '') {
    if (!message || !ui.toastHost) return;
    const node = document.createElement('div');
    node.className = `toast ${kind}`.trim();
    node.textContent = message;
    ui.toastHost.appendChild(node);
    while (ui.toastHost.children.length > 3) {
      ui.toastHost.firstElementChild.remove();
    }
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 320);
    }, 2600);
  }

  popup({ head, sub = '', points = '', className = '' }) {
    if (!ui.popupLayer) return;
    const node = document.createElement('div');
    node.className = `popup ${className}`.trim();
    node.innerHTML = `<span class="popup-head"></span>${sub ? '<span class="popup-sub"></span>' : ''}${points ? '<span class="popup-points"></span>' : ''}`;
    node.querySelector('.popup-head').textContent = head;
    if (sub) node.querySelector('.popup-sub').textContent = sub;
    if (points) node.querySelector('.popup-points').textContent = points;
    ui.popupLayer.appendChild(node);
    setTimeout(() => node.remove(), 1650);
    while (ui.popupLayer.children.length > 4) {
      ui.popupLayer.firstElementChild.remove();
    }
  }

  onGameEvent(type, detail) {
    if (type === 'level') {
      this.sound.levelUp?.();
      const unlocked = detail.unlocked?.[0];
      this.toast(
        unlocked
          ? `LEVEL ${detail.level} — ${unlocked.name} unlocked`
          : `LEVEL ${detail.level} — stamina restored`,
        'gold',
      );
      if (this.modalOpen === 'shop') this.renderShop();
    } else if (type === 'shop') {
      if (ui.shopCoins) ui.shopCoins.textContent = this.game.state.coins.toLocaleString();
      this.renderShop();
    } else if (type === 'campaign') {
      setTimeout(() => this.showCampaignVictory(detail), 650);
    } else if (type === 'split') {
      this.updateModeUi();
      if (this.game.run.active && this.game.run.mode === 'time' && detail.clean && !detail.partial) {
        this.toast('Clean split · +2.5 seconds', 'gold');
      }
    } else if (type === 'reset') {
      this.hideRunOverlay();
      this.updateModeUi();
    }
  }

  /* ---------------------------------------------------------------- *
   *  Challenge modes
   * ---------------------------------------------------------------- */

  startMode(modeId = 'free', seedDate = '') {
    if (!this.ready) return false;
    clearTimeout(this.runFinishTimer);
    this.runFinishTimer = 0;
    this.cancelCharge();
    if (this.game.run.active) this.game.endRun('switch', true);
    const def = modeFor(modeId);
    this.hideRunOverlay();
    if (def.id === 'free') {
      if (this.game.run.active) this.game.endRun('quit', true);
      this.game.startMode('free');
      this.weatherCarryArmed = false;
      this.lastWeatherKey = '';
      this.resetScene(true);
      this.toast('Free chop — chapter progress and bosses continue.', 'gold');
      this.updateModeUi();
      return true;
    }

    const result = this.game.startMode(def.id, { seedDate });
    if (!result?.ok) return false;
    // A fresh run starts from a fresh sky; only rounds inside the run carry the
    // snow and water that the last log left behind.
    this.weatherCarryArmed = false;
    this.lastWeatherKey = '';
    this.lastRunMode = def.id;
    this.lastRunSeed = def.id === 'daily' ? this.game.run.dailyDate : '';

    // Daily Seed pins log deck, time, weather, and the loaner bench from the
    // same date hash for everyone, so its score is comparable between profiles.
    if (def.id === 'daily') {
      const seed = this.game.run.dailySeed;
      if (this.weather) {
        const times = ['dawn', 'noon', 'golden', 'night'];
        const weathers = ['clear', 'rain', 'snow', 'fog', 'wind'];
        const time = times[seed % times.length];
        const weather = weathers[Math.floor(seed / 7) % weathers.length];
        this.weather.setTimePreset(time);
        this.weather.setWeather(weather);
        this.debris?.setWeather(this.weather.getModifiers());
        this.game.setSetting('timeOfDay', time);
        this.game.setSetting('weather', weather);
        this.updateAtmosphereUi();
      }
    }

    this.resetScene(true);
    this.updateModeUi();
    const targetText = def.time ? 'clock live' : def.target ? `${def.target} rounds` : 'no finish line';
    this.toast(`${def.name} — ${targetText}. ${def.desc}`, def.trial ? 'bad' : 'gold');
    if (def.stumpTrial) {
      this.toast('Loaner maul equipped. Ancient Iron Stump: undercut the amber root notches, collapse the hollow heart, dodge the stones.', 'gold');
    } else if (def.trial) {
      this.toast('Loaner maul equipped. The yard boss is level-gated no more.', 'gold');
    } else if (def.loadout) {
      this.toast(
        `${this.game.axe.name} loaner equipped · fixed bench · every profile faces the same ${def.deck?.length || 0} rounds.`,
        'gold',
      );
    }
    this.sound.chime?.(0.7);
    return true;
  }

  finishRun(reason = 'time') {
    if (!this.game.run.active) return null;
    const summary = this.game.endRun(reason, true);
    if (!summary) return null;
    this.lastRunMode = summary.mode;
    this.showRunOverlay(summary);
    return summary;
  }

  showRunOverlay(summary) {
    this.runOverlayOpen = true;
    this.lastSummary = summary;
    this.lastRunSeed = summary.mode === 'daily' ? summary.dailyDate || '' : '';
    summary.seedLink = this.seedLinkFor(summary);
    this.cancelCharge();
    if (!ui.runOverlay) return;
    const mode = modeFor(summary.mode);
    if (ui.runKicker) {
      ui.runKicker.textContent = summary.customSeed
        ? 'Shared seed run'
        : summary.newBest
          ? 'New personal best'
          : 'Run complete';
    }
    if (ui.runTitle) ui.runTitle.textContent = summary.modeName || mode.name;
    if (ui.runSub) {
      const reasonText =
        summary.reason === 'time'
          ? 'The clock ran out. Clean splits buy more time.'
          : summary.reason === 'target'
            ? `${summary.splits} rounds down. The run is in the books.`
            : 'Run closed.';
      ui.runSub.textContent =
        summary.mode === 'daily' ? `${reasonText} Seed ${summary.dailyDate || ''}.` : reasonText;
    }
    if (ui.runScore) {
      ui.runScore.innerHTML = `${summary.score.toLocaleString()} <small>run points</small>`;
    }
    if (ui.runStats) {
      const bits = [
        `<span>Rounds <b>${summary.splits}</b></span>`,
        `<span>Bosses <b>${summary.bosses}</b></span>`,
        `<span>Best combo <b>×${summary.bestCombo || 0}</b></span>`,
      ];
      if (!summary.customSeed) bits.push(`<span>Best <b>${summary.best.toLocaleString()}</b></span>`);
      if (summary.customSeed) bits.push(`<span>Shared seed <b>not a record</b></span>`);
      if (summary.wedges) bits.push(`<span>Wedges <b>${summary.wedges}</b></span>`);
      if (summary.hollows) bits.push(`<span>Hollows <b>${summary.hollows}</b></span>`);
      if (summary.phaseTwo) bits.push(`<span>Phase II <b>reached</b></span>`);
      if (summary.mode === 'time') bits.push(`<span>Clock <b>${summary.timeLeft.toFixed(1)}s</b></span>`);
      if (summary.mode === 'daily') bits.push(`<span>Seed <b>${summary.dailyDate}</b></span>`);
      if (summary.loadout) bits.push(`<span>Gear <b>Loaner</b></span>`);
      ui.runStats.innerHTML = bits.join('');
    }
    if (ui.runHistory) {
      // Keep the full five-run archive visible instead of hiding the oldest two.
      const previous = (summary.history || []).slice(1, 5);
      const lines = previous.map((entry) => {
        const bits = [
          `${entry.score.toLocaleString()} pts`,
          `${entry.splits || 0} rounds`,
          `${entry.bosses || 0} bosses`,
          `×${entry.bestCombo || 0} combo`,
        ];
        if (entry.wedges) bits.push(`${entry.wedges} wedges`);
        if (entry.hollows) bits.push(`${entry.hollows} hollows`);
        if (entry.date) bits.push(entry.date);
        return `<span class="run-history-row">${bits.join(' · ')}</span>`;
      });
      const seedLink = summary.seedLink || '';
      ui.runHistory.innerHTML = `<span class="run-share-line">${summary.share || ''}</span>${
        seedLink ? `<span class="run-share-line run-seed-line">${seedLink}</span>` : ''
      }${
        lines.length
          ? `<span class="run-history-label">Earlier runs · ${lines.length} shown</span>${lines.join('')}`
          : ''
      }`;
    }
    if (ui.runCopy) {
      ui.runCopy.hidden = false;
      ui.runCopy.textContent = 'Copy result';
      ui.runCopy.classList.remove('copied');
    }
    const seeded = Boolean(summary.mode === 'daily' && summary.dailyDate);
    if (ui.runSeed) {
      ui.runSeed.hidden = !seeded;
      ui.runSeed.textContent = 'Copy seed link';
      ui.runSeed.classList.remove('copied');
    }
    if (ui.runRetrySeed) {
      ui.runRetrySeed.hidden = !seeded;
      ui.runRetrySeed.textContent = summary.customSeed ? 'Retry this seed' : 'Retry daily seed';
    }
    if (ui.runAgain) ui.runAgain.textContent = `Run ${mode.name} again`;
    if (ui.runExit) ui.runExit.hidden = false;
    ui.runOverlay.hidden = false;
    ui.runAgain?.focus();
  }

  /** Canonical link for a daily seed, usable in a message or a bookmark. */
  seedLinkFor(summary = this.lastSummary) {
    if (!summary || summary.mode !== 'daily' || !summary.dailyDate) return '';
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('mode', 'daily');
    url.searchParams.set('seed', summary.dailyDate);
    return url.toString();
  }

  /** Copy the current run's share string, with a textarea fallback for browsers
   * that refuse clipboard access outside a secure context. */
  async copyShare() {
    const text = this.lastSummary?.share || '';
    if (!text) return false;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      try {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        copied = document.execCommand('copy');
        field.remove();
      } catch {
        copied = false;
      }
    }
    if (ui.runCopy) {
      ui.runCopy.textContent = copied ? 'Copied' : 'Select the line above';
      ui.runCopy.classList.toggle('copied', copied);
    }
    this.toast(copied ? 'Run result copied to the clipboard.' : 'Clipboard blocked — select the share line.', copied ? 'gold' : 'bad');
    return copied;
  }

  /** Copy the exact seeded run link, with the same fallback as Copy result. */
  async copySeedLink() {
    const text = this.seedLinkFor();
    if (!text) return false;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      try {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        copied = document.execCommand('copy');
        field.remove();
      } catch {
        copied = false;
      }
    }
    if (ui.runSeed) {
      ui.runSeed.textContent = copied ? 'Seed link copied' : 'Select the seed link above';
      ui.runSeed.classList.toggle('copied', copied);
    }
    this.toast(
      copied
        ? 'Seed link copied — anyone who opens it gets the same deck and weather.'
        : 'Clipboard blocked — select the seed link in the summary.',
      copied ? 'gold' : 'bad',
    );
    return copied;
  }

  /** Restart the exact daily seed shown in the summary. */
  retrySeed() {
    const date = this.lastSummary?.dailyDate;
    if (!date) return false;
    this.hideRunOverlay();
    return this.startMode('daily', date);
  }

  hideRunOverlay() {
    this.runOverlayOpen = false;
    if (ui.runOverlay) ui.runOverlay.hidden = true;
  }

  showCampaignVictory(detail) {
    this.runOverlayOpen = true;
    this.lastRunMode = 'free';
    this.lastSummary = null;
    this.cancelCharge();
    if (!ui.runOverlay) return;
    if (ui.runCopy) ui.runCopy.hidden = true;
    if (ui.runSeed) ui.runSeed.hidden = true;
    if (ui.runRetrySeed) ui.runRetrySeed.hidden = true;
    if (ui.runKicker) ui.runKicker.textContent = 'Campaign complete';
    if (ui.runTitle) ui.runTitle.textContent = 'The Last Ring';
    if (ui.runSub) {
      ui.runSub.textContent =
        'Sixty clean splits, five chapters, and every stump in the yard. The woodpile is yours.';
    }
    if (ui.runScore) ui.runScore.innerHTML = `${detail.score.toLocaleString()} <small>total score</small>`;
    if (ui.runStats) {
      ui.runStats.innerHTML = [
        `<span>Clean splits <b>${detail.cleanSplits}</b></span>`,
        `<span>Bosses <b>${detail.bossesDefeated}</b></span>`,
        `<span>Level <b>${detail.level}</b></span>`,
        `<span>Best combo <b>${detail.bestCombo}</b></span>`,
      ].join('');
    }
    if (ui.runAgain) ui.runAgain.textContent = 'Keep chopping';
    if (ui.runHistory) ui.runHistory.textContent = '';
    if (ui.runExit) ui.runExit.hidden = true;
    ui.runOverlay.hidden = false;
    ui.runAgain?.focus();
    this.sound.chime?.(1.4);
  }

  updateModeUi() {
    if (!this.game) return;
    const snapshot = this.game.snapshot();
    const run = this.game.run;
    const mode = run.active ? modeFor(run.mode) : modeFor('free');
    if (ui.modeStrip) {
      for (const button of ui.modeStrip.querySelectorAll('[data-mode]')) {
        button.classList.toggle('active', button.getAttribute('data-mode') === mode.id);
      }
    }
    if (ui.runScoreChip) {
      ui.runScoreChip.hidden = !run.active;
      if (run.active) ui.runScoreChip.textContent = `${run.score.toLocaleString()} pts`;
    }
    if (ui.runTimer) {
      const showTimer = run.active && mode.id === 'time';
      ui.runTimer.hidden = !showTimer;
      if (showTimer) {
        const t = Math.max(0, run.timeLeft);
        ui.runTimer.textContent = `${t.toFixed(1)}s`;
        ui.runTimer.classList.toggle('urgent', t <= 12);
      }
    }
    if (ui.logModifiers) {
      const parts = [];
      let kind = '';
      if (run.active) {
        if (mode.id === 'precision') {
          parts.push(`Precision ${run.splits}/${mode.target} · fixed deck · pith + grain required`);
          kind = 'precision';
        } else if (mode.id === 'time') {
          parts.push(`Time attack · +2.5s per clean split`);
          kind = 'precision';
        } else if (mode.id === 'endless') {
          parts.push(`Endless · boss every ${this.game.bossEvery} · wave ${run.splits}`);
          kind = 'precision';
        } else if (mode.id === 'daily') {
          parts.push(`Daily ${run.dailyDate} · ${run.splits}/${mode.target} · fixed deck · seed ${String(run.dailySeed).slice(0, 6)}`);
          kind = 'precision';
        } else if (mode.id === 'trial') {
          parts.push(`Colossus Trial · ${run.splits}/${mode.target} · loaner maul · wedges matter`);
          kind = 'boss';
        } else if (mode.id === 'stump') {
          parts.push(`Iron Stump Trial · ${run.splits}/${mode.target} · loaner maul · hollow heart · stone in the rings`);
          kind = 'boss';
        }
      }
      if (this.bossRound && this.displaySpecies?.bossMechanic) {
        const mechanic = this.displaySpecies.bossMechanic;
        const sealed = Boolean(this.displaySpecies.bossSeamSealed) && !this.debris?.seamOpen;
        const phaseTwo = (this.debris?.bossPhase || 1) >= 2;
        parts.push(
          sealed
            ? `Seam sealed: ${mechanic.label} · bite the rings to expose the heart`
            : phaseTwo
              ? `PHASE II · ${mechanic.label} · seam moving · shock every 3.4s · weak bites +2`
              : `Weak seam: ${mechanic.label} · strike the glowing band for +1 bite`,
        );
        kind = sealed ? 'danger' : 'boss';
      }
      if (this.debris && this.debris.rootsCut > 0) {
        parts.push(
          `Root ring ${this.debris.rootsCut}/3 cut${this.debris.rootUnstable ? ' · UNSTABLE' : ''}`,
        );
        kind = 'danger';
      }
      if (this.debris?.rivingStreak > 0) {
        parts.push(
          this.debris.rivingStreak >= 2
            ? 'GRAIN LOCK · the split is running along the golden check'
            : 'Riving · hold the golden check for a grain lock',
        );
        kind = kind || 'precision';
      }
      if (this.weatherShiftNote) {
        parts.push(this.weatherShiftNote);
        kind = this.weatherBiteMod > 0 ? 'danger' : 'precision';
      }
      const shiftActive = Boolean(this.weatherShiftNote);
      const liveWeatherNote = this.currentWeatherNote();
      if (liveWeatherNote) {
        // The shift line already gives the new bite count; do not repeat it in
        // the surface line. This keeps the modifier strip to three short clauses
        // instead of five on a thaw.
        const biteText = shiftActive
          ? ''
          : this.weatherBiteMod
            ? this.weatherBiteMod > 0
              ? ` · +${this.weatherBiteMod} bite`
              : ` · ${this.weatherBiteMod} bite`
            : '';
        parts.push(`${liveWeatherNote}${biteText}`);
        if (this.weatherBiteMod < 0) kind = 'danger';
      }
      if (this.debris?.kerfFillType && this.debris.kerfWidth > 0) {
        parts.push(
          this.debris.kerfFillType === 'frost'
            ? 'Frost-packed check · wedges drive deeper'
            : 'Water in the check · wedges seat deeper',
        );
      }
      if (this.debris?.weatherIsDrying && !shiftActive) {
        parts.push(
          this.debris.weather?.frozen
            ? `Snow knocked loose · ${Math.round((this.debris.snowLoad || 0) * 100)}% frost grip left`
            : 'Grain drying · the slick sheen is fading',
        );
        kind = 'precision';
      }
      ui.logModifiers.hidden = parts.length === 0;
      ui.logModifiers.textContent = parts.join(' · ');
      ui.logModifiers.className = `log-modifiers ${kind}`.trim();
    }
    if (this.game.state.campaignComplete && snapshot.cleanSplits >= CAMPAIGN_SPLITS) {
      // The campaign ribbon stays visible, but the victory overlay only fires once.
      if (ui.logNext && !run.active) ui.logNext.textContent = 'Campaign cleared · keep chopping';
    }
  }

  /* ---------------------------------------------------------------- *
   *  Round flow
   * ---------------------------------------------------------------- */

  loadCurrentLog({ initial = false, announce = false } = {}) {
    if (!this.debris || !this.axe || !this.humanoid) return;
    const baseSpecies = this.game.species;
    const bossIndex = this.game.bossIndex;
    this.bossRound = this.game.bossReady;
    this.displaySpecies = this.bossRound
      ? makeBossProfile(baseSpecies, bossIndex)
      : baseSpecies;

    // Endless is a run-relative difficulty ramp, not just faster boss cadence.
    if (this.game.run.active && this.game.run.mode === 'endless') {
      const wave = this.game.run.splits;
      this.displaySpecies = {
        ...this.displaySpecies,
        toughness: this.displaySpecies.toughness * (1 + wave * 0.022),
        strikes: Math.min(6, (this.displaySpecies.strikes || 1) + Math.floor(wave / 18)),
        basePoints: Math.round(this.displaySpecies.basePoints * (1 + wave * 0.014)),
        endlessWave: wave + 1,
      };
    }

    // Weather changes the work: wet grain closes around the bit (+1 bite on
    // multi-bite rounds); frozen grain is brittle and gives way a bite sooner.
    // The decision is made from the surface actually on the log, so snow carried
    // over from a previous round still counts until it has melted away.
    const weatherMods = this.weather ? this.weather.getModifiers() : null;
    const roundBaseStrikes = Math.max(1, Math.round(this.displaySpecies.strikes || 1));
    const weatherKey = this.weather?.weather || 'clear';
    // Loaner-bench runs (Daily, Precision, both Trials) keep every round on a
    // fresh surface so their scores stay comparable between profiles.
    const carryWeather =
      !initial &&
      this.weatherCarryArmed &&
      this.lastWeatherKey === weatherKey &&
      !this.game.run.loadout;
    this.debris.setWeather(weatherMods, { carry: carryWeather });
    this.weatherCarried = carryWeather;
    this.lastWeatherKey = weatherKey;
    this.weatherCarryArmed = true;
    const frostSurface = Boolean(this.debris.surfaceFrozen);
    const wetSurface = Boolean(this.debris.surfaceWet);
    this.weatherBiteMod = frostSurface ? -1 : wetSurface ? 1 : 0;
    if (this.weatherBiteMod && (this.displaySpecies.strikes || 1) > 1) {
      const strikes = Math.max(1, Math.min(6, (this.displaySpecies.strikes || 1) + this.weatherBiteMod));
      this.displaySpecies = { ...this.displaySpecies, strikes, weatherBiteMod: this.weatherBiteMod };
    } else {
      this.weatherBiteMod = 0;
    }
    // The bite count is no longer frozen at build time. If the surface thaws or
    // dries while the round is on the block, reconcileWeatherBites() adjusts it.
    this.roundBaseStrikes = roundBaseStrikes;
    this.weatherBiteShift = this.weatherBiteMod;
    this.weatherShiftCount = 0;
    this.weatherShiftNote = '';
    this.weatherShiftAge = 0;
    this.lastWeatherSurface = this.debris.surfaceState;
    this.weatherBiteTimer = 0;
    this.logWeatherNote = frostSurface
      ? carryWeather
        ? `Carried frost: ${Math.round(this.debris.snowLoad * 100)}% grip left`
        : 'Frozen grain: brittle checks, more chips'
      : wetSurface
        ? carryWeather
          ? `Carried rain: ${Math.round(this.debris.wetness * 100)}% soaked`
          : 'Wet grain: slick pieces, tighter checks'
        : weatherMods?.frozen
          ? 'Frost grip spent: the grain is thawing'
          : (weatherMods?.wetness || 0) > 0.2
            ? 'Drying grain: the slick sheen is fading'
            : '';

    const fixedRun =
      this.game.run.active && (this.game.run.deck?.length || this.game.run.loadout);
    const seedOffset =
      this.game.run.active && this.game.run.mode === 'daily'
        ? (this.game.run.dailySeed % 100000) + this.game.run.splits * 7
        : fixedRun
          ? (this.game.run.mode === 'trial' ? 9109 : this.game.run.mode === 'stump' ? 9311 : 7301) +
            this.game.run.splits * 37 +
            (this.game.run.deck?.length || 0) * 17
          : this.game.state.splits + (initial ? 0 : 3);
    this.currentKnots = makeKnots(this.displaySpecies, seedOffset);
    this.currentHazards = makeHazards(this.displaySpecies, seedOffset + 11);
    // The surface was installed above so the intact log builds its snow cap /
    // wet sheen for the round the player is about to face.
    this.debris.setLog(this.displaySpecies, this.currentKnots, {
      blockTop: BLOCK.top,
      hazards: this.currentHazards,
    });
    this.debris.setWind(this.weather ? this.weather.getWindVector() : null);
    this.debris.setQuality?.(this.qualityPreset);
    this.lastShockCount = this.debris.shockCount || 0;
    this.buildPrecisionGuide();

    this.sim.active = false;
    this.sim.t = 0;
    this.sim.hit = false;
    this.sim.impactAt = this.sim.windup + this.sim.strike;
    this.phase = 'idle';
    this.idleTime = 0;
    this.pendingImpact = false;
    this.shake = 0;
    this.hitStop = 0;
    this.perfectSlow = 0;
    this.headSpeed = 0;
    this.swingState = null;
    this.aim = { x: 0, z: 0 };
    this.lastMeterValue = 0;
    this.meterTiming = 0;
    this.meterPerfect = false;
    this.hollowCollapsed = false;
    this.cancelCharge(false);
    this.axe.reset(REST.grip, REST.quaternion);
    this.humanoid.reset();
    this.previousHead.copy(this.axe.getHeadWorld());
    this.currentHead.copy(this.previousHead);
    this.updateHumanoid(FIXED_STEP, REST.grip, REST.quaternion, REST.body);
    this.nextLogTimer = 0;
    this.aimPlane.constant = -(this.debris.topY + 0.005);
    if (this.reticle) {
      this.reticle.visible = true;
      this.reticle.position.set(0, this.debris.topY + 0.012, -0.95);
    }
    if (this.lastImpact && !initial) this.lastImpact = null;
    if (this.environment) this.environment.updateShadow();
    this.updateAimHud();
    this.updateHudStatic();
    if (this.bossRound) {
      const sealed = Boolean(this.displaySpecies.bossSeamSealed);
      this.toast(
        `BOSS ROUND — ${this.displaySpecies.name} · ${this.debris.strikesRequired} bites · ${
          sealed
            ? `${this.displaySpecies.bossMechanic?.label || 'seam'} sealed: bite the rings first`
            : `${this.displaySpecies.bossMechanic?.label || 'weak seam'}: strike the glowing band`
        }`,
        'bad',
      );
      this.sound.chime?.(0.35);
      if (ui.logCard) {
        ui.logCard.classList.remove('boss-bump');
        void ui.logCard.offsetWidth;
        ui.logCard.classList.add('boss-bump');
      }
    } else if (announce) {
      this.toast(`Fresh round: ${this.displaySpecies.name}`, 'gold');
    }
  }

  resetScene(resetCamera = true) {
    if (!this.ready) return false;
    clearTimeout(this.runFinishTimer);
    this.runFinishTimer = 0;
    this.hideRunOverlay();
    if (this.replayTimer) {
      clearTimeout(this.replayTimer);
      this.replayTimer = 0;
    }
    this.game.refillStamina();
    this.game.state.lastHit = null;
    this.game.save();
    this.loadCurrentLog({ announce: false });
    if (resetCamera) {
      const homeView = getHomeView();
      this.camera.position.copy(homeView.position);
      this.controls.target.copy(homeView.target);
      this.controls.update();
    }
    this.updateHudStatic();
    this.updateHudLive();
    return true;
  }

  beginCharge(source = 'mouse') {
    if (!this.ready || this.modalOpen || this.runOverlayOpen) return false;
    if (this.sim.active) return false;
    if (this.debris.active) {
      this.loadCurrentLog({ announce: false });
    }
    if (this.charge.active) return true;
    this.charge.active = true;
    this.charge.t = 0;
    this.charge.value = 0;
    this.chargeTick = -1;
    this.charge.source = source;
    this.updateChargeUi();
    return true;
  }

  releaseCharge() {
    if (!this.charge.active) return false;
    if (this.modalOpen) {
      this.cancelCharge();
      return false;
    }
    const value = this.charge.value;
    this.charge.active = false;
    const dist = Math.abs(value - 0.745);
    const timing = clamp(1 - dist / 0.46, 0, 1);
    const perfect = dist <= 0.042;
    this.lastMeterValue = value * 100;
    this.meterTiming = timing;
    this.meterPerfect = perfect;
    const power = 0.26 + value * 0.74;
    const aim = { x: this.aim.x, z: this.aim.z };
    this.updateChargeUi();
    return this.requestSwing({ power, timing, perfect, aim, source: this.charge.source || 'mouse' });
  }

  cancelCharge(update = true) {
    if (!this.charge.active) {
      if (update) this.updateChargeUi();
      return;
    }
    this.charge.active = false;
    this.charge.t = 0;
    if (update) this.updateChargeUi();
  }

  requestSwing({ power = 0.75, timing = 0.65, perfect = false, aim = null, source = 'api' } = {}) {
    if (!this.ready || this.runOverlayOpen) return false;
    if (this.sim.active) return false;
    if (this.debris.active) this.loadCurrentLog({ announce: false });

    const mods = this.weather ? this.weather.getModifiers() : { stamina: 1, split: 1 };
    const staminaBefore = this.game.state.stamina;
    const cost = this.game.staminaCost * (mods.stamina || 1);
    const winded = staminaBefore < cost * 0.65;
    let p = clamp(power, 0.08, 1);
    if (winded) p = Math.max(0.22, p * 0.62);
    this.game.spendStamina(cost);
    const aimValue = aim ? { ...aim } : { ...this.aim };
    this.swingAim = aimValue;
    this.swingState = {
      power: p,
      timing: clamp(timing, 0, 1),
      perfect: Boolean(perfect),
      aim: aimValue,
      source,
      winded,
      mods,
      cost,
    };
    this.sim.force = Math.round(p * 100);
    this.queueSwing(p);
    if (winded) {
      this.toast('Winded — the swing comes up short', 'bad');
    }
    this.updateHudStatic();
    return true;
  }

  /**
   * Spend stamina on a wedge instead of a full swing. The wedge opens the kerf,
   * advances the round a little, and makes the next clean blow bite deeper.
   */
  driveWedge() {
    if (!this.ready || this.modalOpen || this.runOverlayOpen) return false;
    if (this.sim.active || !this.debris || this.debris.active) return false;
    const check = this.debris.canDriveWedge();
    if (!check.ok) {
      this.toast(check.reason, 'bad');
      return false;
    }
    // A splitting maul seats a wedge with less wind and more bite; the felling
    // axe still works but is the honest, slower choice.
    const maul = this.game.axe.id === 'maul';
    const cost = Math.max(4.5, this.game.staminaCost * (maul ? 0.44 : 0.55));
    if (this.game.state.stamina < cost) {
      this.toast('Not enough wind to drive the wedge', 'bad');
      return false;
    }
    this.game.spendStamina(cost);
    const result = this.debris.driveWedge({ x: this.aim.x, z: this.aim.z }, maul ? 0.16 : 0);
    if (!result.ok) {
      this.toast(result.reason || 'The wedge will not take', 'bad');
      return false;
    }
    this.game.state.wedges = (this.game.state.wedges || 0) + 1;
    this.game.noteWedge();
    this.game.save();
    if (result.phaseChanged) this.onBossPhase();
    this.sound.wedge?.();
    this.shake = Math.max(this.shake, 0.022);
    this.hitStop = Math.max(this.hitStop, 0.035);
    const kerf = this.debris.getLogMetrics();
    this.debris.biteBurst(
      new THREE.Vector3(kerf.x + this.aim.x, kerf.topY - 0.01, kerf.z + this.aim.z),
      0.55,
    );
    this.toast(
      `Wedge set (${result.wedges}/${result.max})${maul ? ' with the maul' : ''} — ${formatBites(result.left)} bite${formatBites(result.left) === '1' ? '' : 's'} left. Aim at the steel and swing to drive it home.`,
      'gold',
    );
    this.updateHudStatic();
    this.updateHudLive();
    this.updateAimHud();
    return true;
  }

  /** Visual/audio punctuation for the second boss phase. */
  onBossPhase() {
    if (!this.debris || this.debris.bossPhase < 2) return;
    this.game.noteBossPhase(this.debris.bossPhase);
    this.toast(
      'HEARTWOOD BLOOM — the seam is moving. Weak strikes now fill 2.1 bites.',
      'bad',
    );
    this.sound.bossPhase?.();
    this.shake = Math.max(this.shake, 0.11);
    this.hitStop = Math.max(this.hitStop, 0.12);
    const weak = this.debris.weakPointPosition?.();
    if (weak) {
      this.debris.spawnSparks(
        new THREE.Vector3(weak.x, this.debris.topY + 0.01, -0.95 + weak.z),
        26,
        1.25,
      );
    }
  }

  queueSwing(power = 0.75) {
    const p = clamp(power, 0.08, 1);
    this.sim.force = Math.round(p * 100);
    this.sim.windup = THREE.MathUtils.lerp(0.62, 0.36, p);
    this.sim.strike = THREE.MathUtils.lerp(0.3, 0.155, p);
    this.sim.follow = 0.23;
    this.sim.recover = THREE.MathUtils.lerp(1.02, 0.82, p);
    this.sim.impactAt = this.sim.windup + this.sim.strike;
    this.sim.total = this.sim.impactAt + this.sim.follow + this.sim.recover;
    this.sim.t = 0;
    this.sim.hit = false;
    this.sim.active = true;
    this.pendingImpact = false;
    this.phase = 'windup';
    this.axe.setKinematic();
    this.previousHead.copy(this.axe.getHeadWorld());
    this.currentHead.copy(this.previousHead);
    this.nextLogTimer = 0;
    this.sound.whoosh(0.55 + p * 0.9);
    if (ui.swingButton) ui.swingButton.classList.add('swinging');
    this.updateHudStatic();
  }

  getPose(t) {
    const s = this.sim;
    if (!s.active) {
      const breath = Math.sin(this.idleTime * 1.55) * 0.006;
      const grip = REST.grip.clone();
      grip.y += breath;
      grip.x += Math.sin(this.idleTime * 0.63) * 0.004;
      const q = REST.quaternion.clone();
      q.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          Y_AXIS,
          Math.sin(this.idleTime * 0.52) * 0.012,
        ),
      );
      return {
        grip,
        quaternion: q,
        body: {
          ...REST.body,
          lean: REST.body.lean + breath * 0.6,
          crouch: REST.body.crouch - breath * 0.25,
        },
      };
    }

    if (t < s.windup) {
      const u = easeInOutCubic(clamp(t / s.windup, 0, 1));
      return blendPoses(REST, TOP, u, 0.1);
    }
    if (t < s.impactAt) {
      const u = clamp((t - s.windup) / s.strike, 0, 1);
      return blendPoses(TOP, IMPACT, easeInCubic(u), 0.02);
    }
    if (t < s.impactAt + s.follow) {
      const u = easeOutCubic(clamp((t - s.impactAt) / s.follow, 0, 1));
      return blendPoses(IMPACT, FOLLOW, u);
    }
    if (t < s.total) {
      const u = easeInOutCubic(clamp((t - s.impactAt - s.follow) / s.recover, 0, 1));
      return blendPoses(FOLLOW, REST, u, -0.03);
    }
    return {
      grip: REST.grip.clone(),
      quaternion: REST.quaternion.clone(),
      body: { ...REST.body },
    };
  }

  applyAimToPose(pose) {
    const s = this.sim;
    if (!s.active) return pose;
    const aim = this.swingAim || { x: 0, z: 0 };
    if (!aim.x && !aim.z) return pose;
    let weight = 0;
    if (s.t < s.windup) weight = 0;
    else if (s.t < s.impactAt) weight = easeInCubic(clamp((s.t - s.windup) / s.strike, 0, 1));
    else if (s.t < s.impactAt + s.follow) weight = 1;
    else if (s.t < s.total) {
      weight = 1 - easeInOutCubic(clamp((s.t - s.impactAt - s.follow) / s.recover, 0, 1));
    }
    pose.grip.x += aim.x * weight;
    pose.grip.z += aim.z * weight;
    pose.body.hipX = (pose.body.hipX || 0) + aim.x * weight * 0.18;
    pose.body.hipZ = (pose.body.hipZ || 0) + aim.z * weight * 0.1;
    pose.body.twist = (pose.body.twist || 0) - aim.x * weight * 0.35;
    return pose;
  }

  updateHumanoid(dt, grip, quaternion, bodyPose) {
    if (!this.humanoid) return;
    this.humanoid.update(dt, bodyPose, grip, quaternion, { lower: -0.045, upper: 0.205 });
  }

  /* ---------------------------------------------------------------- *
   *  Simulation
   * ---------------------------------------------------------------- */

  stepSimulation(dt) {
    this.simTime += dt;
    const s = this.sim;
    if (s.active) s.t += dt;
    else this.idleTime += dt;

    let nextPose = this.getPose(s.active ? s.t : 0);
    if (s.active) nextPose = this.applyAimToPose(nextPose);
    this.targetPose = nextPose;

    if (s.active) {
      if (s.t < s.windup) this.phase = 'windup';
      else if (s.t < s.impactAt) this.phase = 'strike';
      else if (s.t < s.impactAt + s.follow) this.phase = 'follow';
      else if (s.t < s.total) this.phase = 'recover';
      else {
        this.phase = 'idle';
        s.active = false;
      }
    } else {
      this.phase = 'idle';
    }

    this.previousHead.copy(this.currentHead);
    this.axe.setWorldTransform(nextPose.grip, nextPose.quaternion);
    this.axe.group.updateMatrixWorld(true);
    this.axe.getHeadWorld(this.currentHead);
    const travel = this.currentHead.distanceTo(this.previousHead);
    this.headSpeed = travel / Math.max(1e-5, dt);
    if (s.active && !s.hit && s.t > s.windup * 0.72) {
      const edge = this.axe.getEdgeWorld(this._scratch.v2);
      const metrics = this.debris.getLogMetrics();
      const horizontal = Math.hypot(edge.x - metrics.x, edge.z - metrics.z);
      const near =
        horizontal < metrics.radius + 0.09 &&
        edge.y < metrics.topY + 0.1 &&
        edge.y > metrics.baseY - 0.04;
      if (near || s.t >= s.impactAt - 0.001) {
        this.triggerImpact(near ? 'blade-contact' : 'timeline');
      }
    }

    this.world.step(this.eventQueue);
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started || s.hit) return;
      const logHandle = this.debris?.getIntactColliderHandle?.() ?? -1;
      if (logHandle < 0 || !this.axe) return;
      const axeHit =
        (h1 === logHandle && this.axe.colliderHandles.has(h2)) ||
        (h2 === logHandle && this.axe.colliderHandles.has(h1));
      if (axeHit) this.pendingImpact = true;
    });
    if (this.pendingImpact && !s.hit) {
      this.pendingImpact = false;
      this.triggerImpact('rapier-contact');
    }

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.6);

    if (s.active && s.t >= s.total) {
      s.active = false;
      this.phase = 'idle';
      this.idleTime = 0;
    }
  }

  triggerImpact(reason = 'timeline') {
    if (!this.sim.active || this.sim.hit || !this.debris || this.debris.active) return null;
    this.sim.hit = true;
    const state = this.swingState || {
      power: this.sim.force / 100,
      timing: 0.6,
      perfect: false,
      aim: { x: 0, z: 0 },
      mods: this.weather ? this.weather.getModifiers() : { split: 1 },
    };
    const metrics = this.debris.getLogMetrics();
    const mods = state.mods || (this.weather ? this.weather.getModifiers() : { split: 1 });
    const sway = this.weather ? this.weather.getAimSway(this.simTime) : { x: 0, z: 0 };
    const aim = {
      x: clamp(state.aim.x + sway.x * metrics.radius * 2.1, -metrics.radius * 1.18, metrics.radius * 1.18),
      z: clamp(state.aim.z + sway.z * metrics.radius * 2.1, -metrics.radius * 1.18, metrics.radius * 1.18),
    };
    this.effectiveAim = aim;
    const center = this.debris.centerAt(aim.x, aim.z);
    const grain = this.debris.grainAt(aim.x, aim.z);
    const knot = this.debris.knotAt(aim.x, aim.z);
    const knotHit = Boolean(knot);
    const knotPrecise = !knotHit && this.debris.isBetweenKnots(aim.x, aim.z);
    const hazard = this.debris.hazardAt(aim.x, aim.z);
    const hazardHit = Boolean(hazard);
    const hollow = this.debris.hollowAt(aim.x, aim.z);
    const hollowRim = !hollow && this.debris.hollowRimAt?.(aim.x, aim.z);
    const wedgeTarget = this.debris.wedgeAt(aim.x, aim.z);
    const wedgeAimed = Boolean(wedgeTarget) && !hazardHit;
    const weakPoint = this.bossRound ? this.debris.weakAt(aim.x, aim.z) : null;
    const measuredSpeed = clamp(Math.max(4, this.headSpeed || 10), 4, 30);
    const energy =
      clamp(state.power, 0, 1) *
      (0.72 + clamp(state.timing, 0, 1) * 0.32) *
      this.game.headWeight *
      (0.62 + this.game.sharpness * 0.38) *
      (0.72 + clamp(measuredSpeed / 15, 0.5, 1.8) * 0.28) *
      (mods.split || 1);

    const plan = this.debris.planSplit({
      energy,
      center,
      grain,
      power: state.power,
      knotHit,
      knotPrecise,
      weakHit: Boolean(weakPoint) && !hazardHit,
    });
    // Precision runs demand the pith and a grain seam; anything else glances.
    const precisionRun =
      this.game.run.active && this.game.run.mode === 'precision';
    const precisionMiss =
      precisionRun && (center < 0.72 || grain < 0.56 || knotHit);
    const seamWasSealed = this.bossRound && !this.debris.seamOpen;
    // Stone or steel in the grain always skates the bit and takes an edge with it.
    const glancing = plan.glancing || hazardHit || precisionMiss;
    // A strike aimed at a seated wedge is a controlled interaction, not a wild
    // off-pith chop. It drives the wedge instead of splitting the round.
    const glancingAtWedge = wedgeAimed ? hazardHit || precisionMiss : glancing;
    const wedgeHit = wedgeAimed && !glancingAtWedge;
    // Root notches are an optional outer-ring target on an old stump. They are
    // deliberate off-pith cuts, so they ignore the centre-quality glance rule.
    const rootTarget = this.debris.rootAt(aim.x, aim.z);
    const undercut = Boolean(rootTarget) && !hazardHit && !precisionMiss && !wedgeAimed;
    const weakHit = Boolean(weakPoint) && !glancingAtWedge && !hazardHit && !undercut;
    const hollowHit = Boolean(hollow) && !glancingAtWedge && !hazardHit && !undercut;
    const rimTear = Boolean(hollowRim) && !glancingAtWedge && !hazardHit && !undercut;
    // The golden check is a deliberate off-pith riving target. It is only live
    // for a clean, energetic strike on a normal log, so the boss seam, hollow,
    // root, wedge, knot and hazard interactions all keep priority.
    const masterCheck = this.debris.masterCheckAt?.(aim.x, aim.z) || null;
    const riving =
      Boolean(masterCheck) &&
      !glancing &&
      !hazardHit &&
      !knotHit &&
      !precisionMiss &&
      !undercut &&
      !wedgeHit &&
      !weakHit &&
      !hollowHit &&
      !rimTear &&
      energy >= 0.62;
    const rivingAngle = masterCheck?.angle ?? null;
    if (mods.frozen && (knotHit || hazardHit)) this.game.dullEdge(0.012);
    let strike;
    if (undercut) {
      strike = this.debris.undercut(rootTarget, { power: state.power });
      strike = {
        ...strike,
        split: false,
        left: this.debris.strikesLeft,
        weakBonus: 0,
        hollowHit: false,
        hollowCollapse: false,
        hollowRimTear: false,
        wedgeHit: false,
      };
    } else if (wedgeHit) {
      const maul = this.game.axe.id === 'maul';
      strike = this.debris.strikeWedge(wedgeTarget.slot, {
        power: state.power,
        bonus: maul ? 0.1 : 0,
      });
      if (!strike.ok) {
        this.toast(strike.reason || 'The wedge will not take the blow', 'bad');
      }
      strike = {
        ...strike,
        wedgeHit: true,
        split: false,
        left: this.debris.strikesLeft,
        damage: strike.gain
          ? Math.min(1, strike.gain / Math.max(1, this.debris.strikesRequired))
          : 0,
        weakBonus: 0,
        hollowHit: false,
        hollowCollapse: false,
      };
    } else {
      strike = this.debris.registerStrike({
        clean: !glancingAtWedge && energy >= 0.58,
        glancing: glancingAtWedge,
        hazardHit,
        preventSplit: precisionMiss,
        weakHit,
        hollowHit,
        rimTear,
        riving,
        rivingAngle,
      });
    }
    const partial = !strike.split;
    // Carry the chosen check into the fracture plan. A second bite on the same
    // line locks it and forces two clean half-rounds along that exact plane.
    plan.riving = Boolean(strike.riving);
    plan.rivingAngle = strike.riving ? rivingAngle : null;
    plan.grainLock = Boolean(strike.grainLock);

    this.axe.group.updateMatrixWorld(true);
    const head = this.axe.getHeadWorld(this._scratch.v);
    const direction = new THREE.Vector3().subVectors(head, this.previousHead);
    if (direction.lengthSq() < 0.00001) direction.set(0, -1, -0.35);
    direction.normalize();
    const impactPoint = new THREE.Vector3(
      metrics.x + aim.x,
      metrics.topY - 0.012,
      metrics.z + aim.z,
    );
    let result = null;
    if (partial) {
      // The bit bites and sticks. Leave a visible check, dust, and steel sparks.
      if (!wedgeHit && !undercut) this.debris.addCrack(aim.x, aim.z);
      this.debris.biteBurst(impactPoint, state.power);
      if (hazardHit) this.debris.spawnSparks(impactPoint, 18, 1.2);
      if (undercut) {
        this.debris.biteBurst(impactPoint, 1.15);
        this.shake = Math.max(this.shake, 0.06);
        this.sound.tick?.(0.55);
      }
      if (wedgeHit) {
        this.debris.spawnSparks(impactPoint, 20, 1.05);
        if (strike.homedNow) this.sound.wedgeHome?.();
        else this.sound.wedge?.();
      }
      if (weakHit) {
        this.debris.spawnSparks(impactPoint, 22, 0.85);
      }
      // The exposed seam turns after every bite, forcing a re-read of the round.
      if (this.bossRound && !wedgeHit) this.debris.advanceWeakPoint();
    } else {
      result = this.debris.fracture({
        impactPoint,
        direction,
        speed: measuredSpeed,
        plan,
        aim,
        weather: mods,
      });
    }
    if (strike.hollowCollapse) {
      this.debris.hollowBurst(impactPoint);
      this.sound.rot?.();
      this.sound.collapse?.();
      this.shake = Math.max(this.shake, 0.075);
      this.toast('HOLLOW CORE COLLAPSE — the rotten heart gave way in one blow.', 'gold');
    } else if (strike.hollowRimTear) {
      this.sound.rot?.();
      this.debris.biteBurst(impactPoint, 0.7);
      this.toast('Rim tear — the rotten edge crumbled into the check.', 'gold');
    }
    if (strike.riving) {
      this.sound.rive?.(0.55 + state.power * 0.7, Boolean(strike.grainLock));
      this.shake = Math.max(this.shake, strike.grainLock ? 0.055 : 0.028);
      if (!partial) this.debris.biteBurst(impactPoint, 0.9);
      this.toast(
        strike.grainLock
          ? 'GRAIN LOCK — the split runs true along the golden check. The round breaks into clean halves.'
          : 'Riving cut — the golden check opens. Follow the same line for a grain lock.',
        'gold',
      );
    }
    if (strike.phaseChanged) this.onBossPhase();
    const lastHit = this.game.registerSplit({
      center,
      grain,
      timing: state.timing,
      perfect: state.perfect,
      glancing: undercut ? false : wedgeHit ? false : glancing,
      knotHit,
      knotPrecise,
      energy,
      partial,
      boss: this.bossRound,
      weakHit,
      hazardHit,
      hollowHit: strike.hollowHit,
      hollowCollapse: strike.hollowCollapse,
      hollowRimTear: Boolean(strike.hollowRimTear),
      wedgeHit: Boolean(strike.wedgeHit),
      wedgeHomed: Boolean(strike.homedNow),
      wedgeBounced: Boolean(wedgeHit && !strike.ok),
      wedgeDepth: Number(strike.depth || 0),
      strikesRequired: this.debris.strikesRequired,
      strikesLeft: partial ? strike.left : 0,
      damage: strike.damage,
      mainPieces: result ? result.mainPieces : 0,
      power: state.power,
      aimX: aim.x,
      aimZ: aim.z,
      bossPhase: this.debris.bossPhase || 1,
      undercut: Boolean(strike.undercut),
      rootsCut: this.debris.rootsCut || 0,
      rootUnstable: Boolean(this.debris.rootUnstable),
      rootRingBroken: Boolean(strike.rootRingBroken),
      rootBonus: Number(strike.rootBonus || 0),
      riving: Boolean(strike.riving),
      rivingBonus: Number(strike.rivingBonus || 0),
      grainLock: Boolean(strike.grainLock),
      rivingStreak: Number(strike.rivingStreak || 0),
    });

    const weatherName = this.weather ? this.weather.weather : 'clear';
    this.sound.impact(0.35 + state.power * 0.85, measuredSpeed / 14, weatherName);
    if (seamWasSealed && this.debris.seamOpen) {
      this.toast('The sound rings crack — the heartwood seam is exposed. Strike the glowing band.', 'gold');
      this.sound.chime?.(0.85);
    }
    if (partial) this.sound.tick(glancing ? 0.8 : 0.5);
    if (state.perfect) this.sound.chime(0.45);
    this.hitStop = Math.max(
      this.hitStop,
      strike.grainLock ? 0.15 : state.perfect ? 0.13 : glancing ? 0.055 : 0.08,
    );
    this.perfectSlow = strike.grainLock ? 0.45 : state.perfect && !partial ? 0.5 : 0;
    this.shake = Math.max(
      this.shake,
      (partial ? 0.016 : 0.032) +
        state.power * 0.05 +
        (hazardHit ? 0.06 : 0) +
        (this.bossRound && !partial ? 0.03 : 0),
    );
    this.showHitFeedback(lastHit, plan);
    this.spawnImpactFlash();

    this.lastImpact = {
      reason,
      force: this.sim.force,
      power: Number(state.power.toFixed(3)),
      speed: Number(measuredSpeed.toFixed(2)),
      point: { x: impactPoint.x, y: impactPoint.y, z: impactPoint.z },
      pieces: result ? result.mainPieces + result.splinterCount : 0,
      mainPieces: result ? result.mainPieces : 0,
      splinterCount: result ? result.splinterCount : 0,
      penetration: plan.penetration,
      glancing,
      partial,
      boss: this.bossRound,
      weakHit,
      weakName: weakPoint ? weakPoint.mechanic.label : null,
      weakBonus: strike.weakBonus || 0,
      hazardHit,
      hollowHit: strike.hollowHit,
      hollowCollapse: strike.hollowCollapse,
      hollowRimTear: Boolean(strike.hollowRimTear),
      wedgeHit: Boolean(strike.wedgeHit),
      wedgeHomed: Boolean(strike.homedNow),
      wedgeBounced: Boolean(wedgeHit && !strike.ok),
      bossPhase: this.debris.bossPhase,
      phaseChanged: strike.phaseChanged,
      kerfWidth: Number((this.debris.kerfWidth || 0).toFixed(3)),
      strikesRequired: this.debris.strikesRequired,
      strikesLeft: partial ? strike.left : 0,
      cracks: this.debris.crackLines,
      center: Number(center.toFixed(3)),
      grain: Number(grain.toFixed(3)),
      timing: Number(state.timing.toFixed(3)),
      perfect: state.perfect,
      score: lastHit.points,
      quality: lastHit.quality,
      knotHit,
      knotPrecise,
      aim: { x: Number(aim.x.toFixed(3)), z: Number(aim.z.toFixed(3)) },
      mode: this.game.run.mode,
      runScore: this.game.run.score,
      precisionMiss,
      weather: weatherName,
      wedges: this.debris.wedges,
      seamOpened: seamWasSealed && this.debris.seamOpen,
      huge: Boolean(this.debris.log?.huge),
      twisted: Boolean(this.debris.log?.twisted),
      undercut: Boolean(strike.undercut),
      rootsCut: this.debris.rootsCut || 0,
      rootUnstable: Boolean(this.debris.rootUnstable),
      rootRingBroken: Boolean(strike.rootRingBroken),
      rootBonus: Number(strike.rootBonus || 0),
      riving: Boolean(strike.riving),
      rivingBonus: Number(strike.rivingBonus || 0),
      grainLock: Boolean(strike.grainLock),
      rivingStreak: Number(strike.rivingStreak || 0),
      mainPieces: result ? result.mainPieces : 0,
    };
    if (window.__sim) {
      window.__sim.hit = true;
      window.__sim.fragments = this.debris.fragmentCount;
      window.__sim.lastImpact = this.lastImpact;
    }

    this.nextLogTimer = partial ? 0 : 2.9;
    this.updateHudStatic();
    this.updateHudLive();
    this.updateAimHud();
    if (
      this.game.run.active &&
      this.game.run.target > 0 &&
      this.game.run.splits >= this.game.run.target
    ) {
      clearTimeout(this.runFinishTimer);
      const runStamp = this.game.run.startedAt;
      this.runFinishTimer = setTimeout(() => {
        if (
          this.game.run.active &&
          this.game.run.startedAt === runStamp &&
          this.game.run.splits >= this.game.run.target
        ) {
          this.finishRun('target');
        }
      }, 750);
    }
    return result;
  }

  spawnImpactFlash() {
    if (!ui.hitFlash) return;
    ui.hitFlash.classList.add('on');
    setTimeout(() => ui.hitFlash?.classList.remove('on'), 140);
  }

  showHitFeedback(lastHit, plan) {
    if (!lastHit) return;
    const glancing = lastHit.glancing || !lastHit.clean;
    let head = 'CLEAN SPLIT';
    if (lastHit.quality === 'MISS') head = 'MISSED THE ROUND';
    else if (lastHit.undercut) head = 'ROOT UNDERCUT';
    else if (lastHit.hollowCollapse) head = 'HOLLOW CORE COLLAPSE';
    else if (lastHit.hollowRimTear) head = 'ROTTEN RIM TEAR';
    else if (lastHit.wedgeHomed) head = 'WEDGE DRIVEN HOME';
    else if (lastHit.wedgeHit) head = lastHit.wedgeBounced ? 'WEDGE BOUNCE' : 'WEDGE STRIKE';
    else if (lastHit.weakHit) head = lastHit.partial ? 'HEARTWOOD BITE' : 'BOSS SPLIT';
    else if (lastHit.grainLock) head = 'GRAIN LOCK';
    else if (lastHit.riving) head = 'RIVING CUT';
    else if (lastHit.partial) head = lastHit.glancing ? 'GLANCING BITE' : 'BITE — KEEP GOING';
    else if (lastHit.boss) head = 'BOSS SPLIT';
    else if (glancing) head = 'GLANCING BLOW';
    else if (lastHit.combo >= 3) head = `STREAK ×${lastHit.combo}`;
    else if (lastHit.combo === 2) head = 'DOUBLE SPLIT';
    const details = [];
    if (lastHit.wedgeHit) {
      details.push(
        lastHit.wedgeBounced
          ? 'a weak blow rings off the steel'
          : lastHit.wedgeHomed
            ? 'steel home · the kerf is wide open'
            : 'steel sinking · the kerf is opening',
      );
    }
    if (lastHit.partial) {
      const left = lastHit.strikesLeftExact ?? lastHit.strikesLeft;
      details.push(`${formatBites(left)} more bite${formatBites(left) === '1' ? '' : 's'} to break it`);
    } else {
      details.push(`${lastHit.mainPieces} main piece${lastHit.mainPieces === 1 ? '' : 's'}`);
      if (plan.splinterCount) details.push(`${plan.splinterCount} splinters`);
    }
    if (lastHit.undercut) {
      details.push(
        lastHit.rootUnstable
          ? 'root ring cracked · the next clean bite breaks it wide'
          : `root severed · ${lastHit.rootsCut}/3 cut`,
      );
    }
    if (lastHit.rootRingBroken) details.push('ROOT-BREAK BONUS · the stump shears along the cuts');
    if (lastHit.grainLock) details.push('grain lock · the split follows the golden check');
    else if (lastHit.riving) details.push('riving · the check is running true');
    if (lastHit.hazardHit) details.push('NAIL / STONE — edge chipped');
    else if (lastHit.hollowCollapse) details.push('rotten heart punched through');
    else if (lastHit.hollowRimTear) details.push('brittle rim broke away');
    else if (lastHit.weakHit) details.push('exposed heartwood — deep bite');
    else if (lastHit.perfect) details.push('perfect meter');
    else if (lastHit.timing > 0.7) details.push('in the sweet spot');
    if (lastHit.knotPrecise) details.push('between the knots');
    if (lastHit.knotHit && !lastHit.hazardHit) details.push('knot contact');
    if (this.debris?.wedges > 0) {
      details.push(`${this.debris.wedges} wedge${this.debris.wedges === 1 ? '' : 's'} set`);
    }
    const points = lastHit.points >= 0 ? `+${lastHit.points}` : `${lastHit.points}`;
    this.popup({
      head,
      sub: details.join(' · '),
      points: `${points} pts · +${lastHit.xp} XP`,
      className: lastHit.boss
        ? 'boss'
        : lastHit.hazardHit
          ? 'hazard'
          : lastHit.grainLock || lastHit.riving
            ? 'grain'
            : glancing
              ? 'glancing'
              : lastHit.partial
                ? 'bite'
                : lastHit.combo >= 3
                  ? 'streak'
                  : 'clean',
    });
    if (lastHit.undercut) {
      this.toast(
        lastHit.rootUnstable
          ? 'Root ring cracked — one clean bite will shear the whole stump.'
          : `Root cut (${lastHit.rootsCut}/3). Cut one more to crack the ring.`,
        'gold',
      );
      this.environment?.updateShadow?.();
    } else if (lastHit.hazardHit) {
      this.toast('Steel on stone — sparks fly and the edge rolls. Aim around it.', 'bad');
      this.environment?.updateShadow?.();
    } else if (lastHit.wedgeHit) {
      this.toast(
        lastHit.wedgeBounced
          ? 'The wedge rings but does not move — put your weight into the swing.'
          : lastHit.wedgeHomed
            ? 'Wedge home — the check is open. One clean axe blow will break the round.'
            : 'The wedge bites deeper. Strike it again to seat it, then break the round.',
        lastHit.wedgeBounced ? 'bad' : 'gold',
      );
    } else if (lastHit.weakHit && lastHit.partial) {
      this.toast('Heartwood struck — the bite goes deep. The seam has turned.', 'gold');
      this.environment?.updateShadow?.();
    } else if (lastHit.grainLock || lastHit.riving) {
      // The riving toast already fired with the true split direction; keep the
      // generic "solid bite" line from talking over it.
      this.environment?.updateShadow?.();
    } else if (lastHit.partial && !glancing) {
      this.toast(`Solid bite — ${lastHit.strikesLeft} more to break the round.`, 'gold');
      this.environment?.updateShadow?.();
    } else if (glancing) {
      this.toast('Off-centre — the grain deflected the bit. Combo lost.', 'bad');
      this.environment?.updateShadow?.();
    } else if (lastHit.boss) {
      this.sound.chime?.(1.2);
      this.toast(`Boss down — bonus coins and XP. Chapter ${chapterFor(this.game.state.cleanSplits).index} waiting.`, 'gold');
    } else if (lastHit.combo >= 3) {
      this.sound.chime?.(1);
    } else if (lastHit.combo === 1 && lastHit.center > 0.75) {
      this.sound.chime?.(0.6);
    }
    if (ui.comboStat) {
      ui.comboStat.classList.remove('bump');
      void ui.comboStat.offsetWidth;
      ui.comboStat.classList.add('bump');
    }
    this.environment?.updateShadow?.();
  }

  /* ---------------------------------------------------------------- *
   *  Aim + live HUD
   * ---------------------------------------------------------------- */

  updateReticle() {
    if (!this.reticle || !this.debris) return;
    const active = !this.debris.active;
    this.reticle.visible = active;
    if (this.precisionGuide) {
      const precision = this.game.run.active && this.game.run.mode === 'precision';
      this.precisionGuide.group.visible = active && precision;
      if (active && precision) {
        this.precisionGuide.group.position.set(0, this.debris.topY + 0.022, -0.95);
      }
    }
    if (!active) return;
    const metrics = this.debris.getLogMetrics();
    const sway = this.weather ? this.weather.getAimSway(this.simTime) : { x: 0, z: 0 };
    const x = clamp(this.aim.x + sway.x * metrics.radius * 2.1, -metrics.radius * 1.18, metrics.radius * 1.18);
    const z = clamp(this.aim.z + sway.z * metrics.radius * 2.1, -metrics.radius * 1.18, metrics.radius * 1.18);
    this.effectiveAim = { x, z };
    this.reticle.position.set(metrics.x + x, metrics.topY + 0.011, metrics.z + z);
    if (this.charge.active) {
      this.reticle.scale.setScalar(1.06 + Math.sin(this.simTime * 11) * 0.08);
    } else {
      this.reticle.scale.setScalar(1);
    }
    const center = this.debris.centerAt(x, z);
    const grain = this.debris.grainAt(x, z);
    const wedge = this.debris.wedgeAt(this.aim.x, this.aim.z);
    const root = this.debris.rootAt?.(this.aim.x, this.aim.z) || null;
    const precisionRun = this.game.run.active && this.game.run.mode === 'precision';
    const check = precisionRun ? null : this.debris.masterCheckAt?.(this.aim.x, this.aim.z) || null;
    const weak = this.bossRound ? this.debris.weakAt(x, z) : null;
    const sealed = this.bossRound && !this.debris.seamOpen;
    const grade = grain * 0.55 + center * 0.45;
    const color = wedge
      ? 0xa9c6cf
      : root
        ? 0xe0a15c
        : check
          ? 0xffd27a
          : sealed
          ? 0x9faead
          : weak
            ? 0xffc15a
            : grade > 0.72
              ? 0xa8d485
              : grade > 0.45
                ? 0xf3c47f
                : 0xd97d64;
    if (this.reticleColor && this.reticleColor.color.getHex() !== color) {
      this.reticleColor.color.setHex(color);
    }
  }

  updateAimHud() {
    if (!ui.aimChip || !ui.aimReadout || !this.debris) return;
    const metrics = this.debris.getLogMetrics();
    const center = this.debris.centerAt(this.aim.x, this.aim.z);
    const centerPercent = Math.round(center * 100);
    const grain = this.debris.grainAt(this.aim.x, this.aim.z);
    const knot = this.debris.knotAt(this.aim.x, this.aim.z);
    const hollow = this.debris.hollowAt(this.aim.x, this.aim.z);
    const wedge = this.debris.wedgeAt(this.aim.x, this.aim.z);
    const root = this.debris.rootAt?.(this.aim.x, this.aim.z) || null;
    const precisionRun = this.game.run.active && this.game.run.mode === 'precision';
    const check = precisionRun ? null : this.debris.masterCheckAt?.(this.aim.x, this.aim.z) || null;
    const weak = this.bossRound ? this.debris.weakAt(this.aim.x, this.aim.z) : null;
    const seamSealed =
      this.bossRound && Boolean(this.debris.log?.bossSeamSealed) && !this.debris.seamOpen;
    let label;
    let miss = false;
    if (this.debris.active) label = 'Round split · next log on the block';
    else if (precisionRun) {
      // Precision preview is deliberately explicit: the player should know why
      // a strike will glance before committing the swing.
      if (knot) {
        label = `PRECISION MISS · knot in the line`;
        miss = true;
      } else if (center < 0.72) {
        label = `PRECISION MISS · ${centerPercent}% centre (need 72%)`;
        miss = true;
      } else if (grain < 0.56) {
        label = `PRECISION MISS · grain ${Math.round(grain * 100)}% (need 56%)`;
        miss = true;
      } else {
        label = `PRECISION PASS · ${centerPercent}% centre · grain ${Math.round(grain * 100)}%`;
      }
    } else if (wedge) {
      label = `WEDGE · strike to drive it home · ${Math.round(wedge.slot.depth * 100)}% set`;
    } else if (root) {
      label = `ROOT NOTCH · undercut to crack the root ring · ${this.debris.rootsCut || 0}/3 cut`;
    } else if (hollow) {
      label = 'Rotten heart · a centred strike collapses the core';
    } else if (weak) {
      label = `Heartwood seam · +${this.debris.bossPhase >= 2 ? '2' : '1'} bite · ${centerPercent}% centre`;
    } else if (seamSealed) {
      label = `Seam sealed · bite the rings to expose the heartwood`;
      miss = false;
    } else if (check) {
      const locked = (this.debris.rivingStreak || 0) > 0;
      label = locked
        ? 'GRAIN LOCK · same check again · +0.5 bite · clean halves'
        : 'RIVING CHECK · off-pith strike rides the grain · +0.24 bite';
    } else if (knot) label = `Knot in the line · ${centerPercent}% centre`;
    else if (this.debris.log?.twinPith && centerPercent > 80) {
      label = `Twin pith · ${centerPercent}% centre`;
    } else if (grain > 0.72 && centerPercent > 55) label = `On the grain · ${centerPercent}% centre`;
    else if (grain > 0.45) label = `Reading the grain · ${centerPercent}% centre`;
    else label = `Across the grain · ${centerPercent}% centre`;
    ui.aimReadout.textContent = label;
    ui.aimChip.classList.toggle(
      'perfect',
      !this.debris.active &&
        !seamSealed &&
        (Boolean(weak) ||
          Boolean(hollow) ||
          Boolean(check) ||
          (precisionRun ? !miss : grain > 0.72 && centerPercent > 55)),
    );
    ui.aimChip.classList.toggle(
      'off',
      !this.debris.active &&
        (miss ||
          (!weak && !wedge && !root && !check && (centerPercent < 32 || grain < 0.25))),
    );
    ui.aimChip.classList.toggle('weak', !this.debris.active && Boolean(weak));
    ui.aimChip.classList.toggle('wedge', !this.debris.active && Boolean(wedge));
    ui.aimChip.classList.toggle('root', !this.debris.active && Boolean(root));
    ui.aimChip.classList.toggle('grain', !this.debris.active && Boolean(check));
    this.updateReticle();
  }

  updateChargeUi() {
    if (!ui.powerKnob) return;
    const percent = this.charge.active
      ? this.charge.value * 100
      : Math.max(0, this.lastMeterValue || 0);
    const scale = clamp(percent, 0, 100);
    ui.powerKnob.style.left = `${scale}%`;
    ui.powerKnob.classList.toggle('perfect', this.charge.active && Math.abs(this.charge.value - 0.745) < 0.042);
    if (ui.powerFill) ui.powerFill.style.width = `${scale}%`;
    if (ui.forceValue) ui.forceValue.textContent = String(Math.round(scale));
    if (ui.controlDeck) ui.controlDeck.classList.toggle('charging', this.charge.active);
    ui.swingButton?.classList.toggle('charging', this.charge.active);
    if (ui.powerLabel) ui.powerLabel.textContent = this.charge.active ? 'Timing the swing' : 'Swing power';
    if (ui.timingReadout) {
      if (this.charge.active) {
        const dist = Math.abs(this.charge.value - 0.745);
        ui.timingReadout.textContent = dist < 0.042 ? 'PERFECT — release now' : 'Release in the green band';
      } else if (this.lastMeterValue > 0) {
        ui.timingReadout.textContent = this.meterPerfect
          ? 'Perfect timing captured'
          : this.meterTiming > 0.7
            ? 'Sweet-spot timing'
            : 'Timing off — power carried the cut';
      } else {
        ui.timingReadout.textContent = 'Hold LMB or Space';
      }
    }
    if (ui.qualityBonus) {
      if (!this.charge.active && this.lastMeterValue <= 0) {
        ui.qualityBonus.textContent = 'Timing ×—';
      } else {
        const timing = this.charge.active
          ? clamp(1 - Math.abs(this.charge.value - 0.745) / 0.46, 0, 1)
          : this.meterTiming;
        ui.qualityBonus.textContent = `Timing ×${(0.72 + timing * 0.32).toFixed(2)}`;
      }
    }
  }

  updateHudLive() {
    if (!this.game) return;
    const snapshot = this.game.snapshot();
    if (ui.staminaText) ui.staminaText.textContent = `${Math.round(snapshot.stamina)} / ${snapshot.maxStamina}`;
    if (ui.staminaBar) {
      const pct = clamp(snapshot.stamina / Math.max(1, snapshot.maxStamina), 0, 1) * 100;
      ui.staminaBar.style.width = `${pct}%`;
      ui.staminaBar.classList.toggle('low', pct < 26);
      ui.staminaBar.classList.toggle('winded', pct < 8);
    }
    if (ui.costChip) ui.costChip.textContent = `${snapshot.staminaCost.toFixed(1)} / swing`;
  }

  updateHudStatic() {
    if (!this.game) return;
    const snapshot = this.game.snapshot();
    if (ui.scoreReadout) ui.scoreReadout.textContent = snapshot.score.toLocaleString();
    if (ui.comboReadout) ui.comboReadout.textContent = `×${Math.max(1, snapshot.combo)}`;
    if (ui.streakReadout) ui.streakReadout.textContent = `${snapshot.combo} clean`;
    if (ui.comboStat) ui.comboStat.classList.toggle('hot', snapshot.combo >= 2);
    if (ui.coinReadout) ui.coinReadout.textContent = snapshot.coins.toLocaleString();
    if (ui.levelReadout) ui.levelReadout.textContent = String(snapshot.level);
    if (ui.xpReadout) ui.xpReadout.textContent = `${snapshot.xp} / ${snapshot.xpNeeded}`;
    if (ui.xpBar) ui.xpBar.style.width = `${clamp(snapshot.xp / Math.max(1, snapshot.xpNeeded), 0, 1) * 100}%`;
    if (ui.axeName) ui.axeName.textContent = snapshot.axeName;
    if (ui.axeStats) {
      ui.axeStats.textContent = `Sharp ${snapshot.sharpness.toFixed(2)} · Weight ${snapshot.headWeight.toFixed(2)}`;
    }
    if (ui.sharpnessChip) {
      ui.sharpnessChip.textContent = `Edge ${snapshot.sharpness.toFixed(2)}`;
      ui.sharpnessChip.classList.toggle('dull', snapshot.edgeIntegrity < 0.88);
      ui.sharpnessChip.title = snapshot.edgeIntegrity < 0.88
        ? `Edge integrity ${Math.round(snapshot.edgeIntegrity * 100)}% — hone it at the Axe Shed for ${snapshot.honeCost} coins`
        : 'Edge is sharp';
    }
    if (ui.weightChip) ui.weightChip.textContent = `Head ${snapshot.headWeight.toFixed(2)}`;
    if (ui.costChip) ui.costChip.textContent = `${snapshot.staminaCost.toFixed(1)} / swing`;
    this.updateLogCard();
    this.updateAtmosphereUi();
    this.updateHudLive();
    this.updateModeUi();
    if (this.debris && ui.fragmentReadout) ui.fragmentReadout.textContent = String(this.debris.fragmentCount || 0);
    if (ui.shopCoins) ui.shopCoins.textContent = snapshot.coins.toLocaleString();
  }

  updateLogCard() {
    const species = this.displaySpecies || this.game.species;
    if (!species) return;
    const boss = Boolean(this.bossRound || species.boss);
    const chapter = chapterFor(this.game.state.cleanSplits);
    const run = this.game.run;
    const mode = run.active ? modeFor(run.mode) : null;
    if (ui.logCard) ui.logCard.classList.toggle('boss', boss);
    if (ui.logName) ui.logName.textContent = boss ? `☠ ${species.name}` : species.name;
    if (ui.logBlurb) ui.logBlurb.textContent = species.blurb;
    if (ui.logTier) {
      if (mode) {
        if (mode.stumpTrial) {
          ui.logTier.textContent = `★ IRON STUMP TRIAL · round ${run.splits + 1}/${mode.target} · loaner maul`;
        } else if (mode.id === 'trial') {
          ui.logTier.textContent = `★ COLOSSUS TRIAL · round ${run.splits + 1}/${mode.target} · loaner maul`;
        } else {
          ui.logTier.textContent = boss
            ? `★ BOSS · ${mode.name} · round ${run.splits + 1}${mode.target ? `/${mode.target}` : ''}`
            : `${mode.name} · round ${run.splits + 1}${mode.target ? `/${mode.target}` : ''}`;
        }
      } else if (boss) {
        ui.logTier.textContent = `★ BOSS · Chapter ${chapter.index}`;
      } else {
        const tierLabel =
          species.tier <= 1
            ? 'Softwood'
            : species.tier === 2
              ? 'Medium density'
              : species.tier === 3
                ? 'Hardwood'
                : 'Old-growth';
        ui.logTier.textContent = `Ch. ${chapter.index} · ${chapter.name} · ${tierLabel}`;
      }
    }
    if (ui.logDifficulty) {
      const filled = clamp(Math.round(species.difficulty), 1, 5);
      ui.logDifficulty.textContent = '●'.repeat(filled) + '○'.repeat(Math.max(0, 5 - filled));
    }
    if (ui.logKnots) {
      const knotText = species.stump
        ? 'Root notches · undercut the bark ring'
        : species.hollow
          ? 'Hollow heart · aim the rot'
          : species.knots === 0
          ? 'Clean round'
          : `${species.knots} knot${species.knots > 1 ? 's' : ''} · aim between`;
      const hazardText = species.hazards
        ? ` · ${species.hazards} nail${species.hazards > 1 ? 's' : ''}/stone`
        : '';
      ui.logKnots.textContent = knotText + hazardText;
      ui.logKnots.classList.toggle('danger', Boolean(species.hazards));
      ui.logKnots.classList.toggle('hollow', Boolean(species.hollow));
    }
    if (ui.logNext) {
      if (mode && mode.target) {
        const left = Math.max(0, mode.target - run.splits);
        ui.logNext.textContent = `${left} round${left === 1 ? '' : 's'} to finish`;
      } else if (mode) {
        ui.logNext.textContent =
          mode.id === 'time'
            ? `${Math.max(0, run.timeLeft).toFixed(1)}s on the clock`
            : `Wave ${run.splits + 1} · boss every ${this.game.bossEvery}`;
      } else if (this.game.bossReady && !boss) {
        ui.logNext.textContent = 'Boss ready — swing to face it';
      } else if (this.game.state.campaignComplete) {
        ui.logNext.textContent = 'Campaign cleared · keep chopping';
      } else {
        const displayIndex = Math.max(0, LOG_TYPES.findIndex((item) => item.id === species.id));
        const next = LOG_TYPES[Math.min(LOG_TYPES.length - 1, displayIndex + 1)];
        if (next && next.id !== species.id) {
          ui.logNext.textContent = this.game.state.level >= next.unlockLevel
            ? `Next: ${next.name}`
            : `Next: ${next.name} · Lv ${next.unlockLevel}`;
        } else {
          ui.logNext.textContent = 'Final tier';
        }
      }
    }
    if (ui.roundHealth && ui.roundHealthLabel && ui.roundHealthValue && ui.roundHealthBar) {
      const required = this.debris?.strikesRequired || species.strikes || 1;
      const done = this.debris?.strikesDone || 0;
      const exactLeft = Math.max(0, required - done);
      const leftLabel = formatBites(exactLeft);
      const ratio = clamp(1 - done / required, 0, 1);
      ui.roundHealth.classList.toggle('boss', boss);
      ui.roundHealth.classList.toggle('wedged', (this.debris?.wedges || 0) > 0);
      ui.roundHealthLabel.textContent = boss ? 'Boss integrity' : 'Round integrity';
      ui.roundHealthValue.textContent =
        exactLeft < 0.05 ? 'Breaking…' : `${leftLabel} bite${leftLabel === '1' ? '' : 's'} left`;
      ui.roundHealthBar.style.width = `${ratio * 100}%`;
      ui.roundHealthBar.classList.toggle('low', ratio < 0.34);
    }
    if (ui.wedgeButton) {
      const d = this.debris;
      const show = Boolean(d && !d.active && d.strikesRequired >= 3);
      ui.wedgeButton.hidden = !show;
      if (show) {
        const check = d.canDriveWedge();
        ui.wedgeButton.disabled = !check.ok;
        const left = formatBites(d.strikesLeft);
        const maul = this.game.axe.id === 'maul';
        ui.wedgeButton.textContent = check.ok
          ? `Drive wedge${maul ? ' (maul)' : ''} · ${left} bite${left === '1' ? '' : 's'} left`
          : d.wedges >= d.maxWedges
            ? 'Kerf fully wedged · aim at a wedge to seat it'
            : check.reason;
        ui.wedgeButton.title = check.ok
          ? 'Drive a steel wedge into the open check. Costs wind, but widens the kerf for the next blow. Then aim the axe at the wedge and swing to drive it home.'
          : check.reason;
      }
    }
    if (ui.fragmentReadout) ui.fragmentReadout.textContent = String(this.debris?.fragmentCount || 0);
  }

  /** Live surface description: snow/rain can change inside a round. */
  currentWeatherNote() {
    const d = this.debris;
    if (!d) return this.logWeatherNote || '';
    const snowPct = Math.round((d.snowLoad || 0) * 100);
    if (d.surfaceFrozen) {
      return d.weatherCarried || d.snowLoad < 0.85
        ? `Snow knocked loose · ${snowPct}% frost grip left`
        : 'Frozen grain: brittle checks, more chips';
    }
    if (d.thawing) return `Thawing · ${snowPct}% snow left · frost grip gone`;
    if (d.surfaceWet) {
      return d.weatherCarried
        ? `Carried rain · ${Math.round((d.wetness || 0) * 100)}% soaked`
        : 'Wet grain: slick pieces, tighter checks';
    }
    if (this.weather?.frozen) return 'Frost grip spent: the grain is thawing';
    const mods = this.weather?.getModifiers?.();
    if ((mods?.wetness || 0) > 0.2) return 'Drying grain: the slick sheen is fading';
    return '';
  }

  updateAtmosphereUi() {
    if (!this.weather) return;
    const time = this.weather.timeLabel;
    const weather = this.weather.weatherLabel;
    if (ui.timeReadout) {
      ui.timeReadout.textContent =
        time === 'golden' ? 'Golden hour' : time.charAt(0).toUpperCase() + time.slice(1);
    }
    if (ui.timeIcon) ui.timeIcon.textContent = TIME_ICONS[time] || '◐';
    if (ui.weatherReadout) {
      const temp = WEATHER_TEMPERATURE[this.weather.weather] ?? 18;
      ui.weatherReadout.textContent = `${weather} · ${temp}°C`;
    }
    if (ui.timeLabel) ui.timeLabel.textContent = ui.timeReadout?.textContent || time;
    if (ui.weatherLabel) ui.weatherLabel.textContent = weather;
    if (ui.qualityReadout) {
      ui.qualityReadout.textContent = this.qualityManager.auto
        ? `Auto · ${QUALITY_PRESETS[this.qualityName].name} · ${Math.round(this.renderScale * 100)}%`
        : `${QUALITY_PRESETS[this.qualityName].name} · ${Math.round(this.renderScale * 100)}%`;
    }
    if (ui.qualityDescription) {
      ui.qualityDescription.textContent = `${this.qualityManager.describe()} · ${Math.round(this.renderScale * 100)}% internal`;
    }
    if (ui.performanceNote) {
      ui.performanceNote.textContent = this.qualityManager.auto
        ? `Auto mode: ${this.qualityManager.downgrades} downgrade${this.qualityManager.downgrades === 1 ? '' : 's'} this session.`
        : 'Manual quality. Auto-downgrade is off.';
    }
    if (ui.timeButtons) {
      for (const button of ui.timeButtons.querySelectorAll('[data-time]')) {
        button.classList.toggle('active', button.getAttribute('data-time') === time);
      }
    }
    if (ui.weatherButtons) {
      for (const button of ui.weatherButtons.querySelectorAll('[data-weather]')) {
        button.classList.toggle('active', button.getAttribute('data-weather') === this.weather.weather);
      }
    }
    if (ui.autoTimeToggle) ui.autoTimeToggle.checked = Boolean(this.weather.autoTime);
    if (ui.qualitySelect && document.activeElement !== ui.qualitySelect) {
      ui.qualitySelect.value = this.qualityManager.mode;
    }
    if (ui.fragmentReadout && this.debris) ui.fragmentReadout.textContent = String(this.debris.fragmentCount || 0);
    if (ui.weatherNote) {
      const mods = this.weather.getModifiers();
      const notes = {
        clear: 'Dry grain. Predictable checks and normal friction.',
        rain: 'Wet wood splits a little easier but chips slide farther and the handle is slick.',
        snow: 'Frozen grain is brittle: more splinters, more rebound, and a colder grip.',
        fog: 'Dense air makes the aim sway and the grain harder to read.',
        wind: 'Gusts push the reticle and send splinters skittering.',
      };
      const biteText = this.weatherBiteMod
        ? ` · Bites ${this.weatherBiteMod > 0 ? '+' : ''}${this.weatherBiteMod}`
        : '';
      ui.weatherNote.textContent = `${notes[this.weather.weather] || ''} Split ×${(mods.split || 1).toFixed(2)} · Friction ×${(mods.friction || 1).toFixed(2)} · Stamina ×${(mods.stamina || 1).toFixed(2)}${biteText}`;
    }
  }

  setSound(enabled) {
    this.sound.setEnabled(enabled);
    this.game.setSetting('sound', enabled);
    if (ui.soundButton) ui.soundButton.setAttribute('aria-pressed', `${enabled}`);
    if (enabled) {
      this.sound.ensure();
      if (this.weather) {
        this.sound.setAmbient({
          weather: this.weather.weather,
          night: this.weather.nightFactor,
          wind: this.weather.getWindStrength(),
        });
      }
    }
  }

  toggleSlowMotion() {
    this.slowMotion = !this.slowMotion;
    if (ui.slowButton) {
      ui.slowButton.setAttribute('aria-pressed', `${this.slowMotion}`);
      const span = ui.slowButton.querySelector('span');
      if (span) span.textContent = this.slowMotion ? 'Slow-mo on' : 'Slow-mo';
    }
    this.toast(this.slowMotion ? 'Slow motion · 0.22×' : 'Real time', 'gold');
  }

  toggleDebug() {
    this.debugPhysics = !this.debugPhysics;
    if (ui.debugButton) ui.debugButton.setAttribute('aria-pressed', `${this.debugPhysics}`);
    if (this.debugLines) this.debugLines.visible = this.debugPhysics;
    if (this.debugPhysics) this.updateDebugGeometry();
  }

  updateDebugGeometry() {
    if (!this.debugLines) return;
    try {
      const { vertices, colors } = this.world.debugRender();
      const geo = this.debugLines.geometry;
      if (!geo.getAttribute('position') || geo.getAttribute('position').array.length !== vertices.length) {
        geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      } else {
        geo.getAttribute('position').array.set(vertices);
        geo.getAttribute('position').needsUpdate = true;
        geo.getAttribute('color').array.set(colors);
        geo.getAttribute('color').needsUpdate = true;
      }
      geo.computeBoundingSphere();
    } catch {
      this.debugLines.visible = false;
    }
  }

  onResize() {
    if (!this.renderer || !this.camera) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dpr = this.computeDpr();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.postfx?.resize(w, h, dpr);
  }

  updateAdaptiveResolution() {
    if (!this.ready || !this.qualityManager.auto) return;
    const now = performance.now();
    if (now - this.lastAdaptiveChange < 1600) return;
    if (this.fps > 0 && this.fps < 18) this.adaptiveLow += 1;
    else this.adaptiveLow = Math.max(0, this.adaptiveLow - 0.5);
    if (this.fps > 44) this.adaptiveHigh += 1;
    else this.adaptiveHigh = 0;
    if (this.adaptiveLow >= 2 && this.renderScale > 0.55) {
      this.renderScale = Math.max(0.55, this.renderScale - 0.07);
      this.lastAdaptiveChange = now;
      this.adaptiveLow = 0;
      this.applyPixelRatio();
      if (!this.adaptiveNotified) {
        this.adaptiveNotified = true;
        this.toast('Adaptive resolution engaged for smoother play', 'gold');
      }
      this.updateAtmosphereUi();
    } else if (this.adaptiveHigh >= 8 && this.renderScale < 1) {
      this.renderScale = Math.min(1, this.renderScale + 0.08);
      this.lastAdaptiveChange = now;
      this.adaptiveHigh = 0;
      this.applyPixelRatio();
      this.updateAtmosphereUi();
    }
  }

  updateWeatherDerived() {
    if (!this.weather || !this.debris) return;
    this.debris.setWind(this.weather.getWindVector());
    this.environment?.setWind?.(this.weather.getWindStrength());
  }

  /**
   * Weather is live state, so the bite count has to be live too. Snow melting
   * below the frost line turns a −1-bite round into wet +1 grain; a drying check
   * tightens it again. Loaner-bench rounds still build from a fresh surface, and
   * a split round is never re-costed underneath the player.
   */
  reconcileWeatherBites() {
    if (!this.debris || this.debris.active || !this.roundBaseStrikes) return false;
    // The weather rule only changes multi-bite rounds; a one-bite pine stays
    // one swing regardless of the surface.
    if (this.roundBaseStrikes <= 1) return false;
    const surface = this.debris.surfaceState;
    if (surface === this.lastWeatherSurface) return false;
    this.lastWeatherSurface = surface;
    const mod = surface === 'snow' ? -1 : surface === 'wet' ? 1 : 0;
    if (mod === this.weatherBiteMod) return false;
    const nextStrikes = Math.max(
      1,
      Math.min(6, this.roundBaseStrikes + mod),
    );
    const before = this.debris.strikesRequired;
    if (nextStrikes === before) {
      this.weatherBiteMod = mod;
      this.weatherBiteShift = mod;
      this.updateModeUi();
      return false;
    }
    this.debris.strikesRequired = nextStrikes;
    // Keep at least a sliver of the round so a thaw cannot silently auto-split
    // it; the next swing is still the one that breaks the log.
    if (this.debris.strikesDone > nextStrikes - 0.05) {
      this.debris.strikesDone = Math.max(0, nextStrikes - 0.05);
    }
    this.weatherBiteMod = mod;
    this.weatherBiteShift = nextStrikes - this.roundBaseStrikes;
    this.weatherShiftCount = (this.weatherShiftCount || 0) + 1;
    this.displaySpecies = {
      ...this.displaySpecies,
      strikes: nextStrikes,
      weatherBiteMod: mod,
    };
    const rising = nextStrikes > before;
    const delta = nextStrikes - before;
    this.weatherShiftNote = `Grain shift · ${delta > 0 ? '+' : ''}${delta} bite${Math.abs(delta) === 1 ? '' : 's'}`;
    this.weatherShiftAge = 0;
    this.toast(
      rising
        ? surface === 'wet'
          ? `The frost grip is gone — damp grain tightens the check. +${nextStrikes - before} bite.`
          : `The snow is gone — the dry grain tightens the check. +${nextStrikes - before} bite.`
        : `The grain is drying — the check opens. ${nextStrikes - before} bite.`,
      rising ? 'bad' : 'gold',
    );
    this.sound.surfaceShift?.(rising);
    this.shake = Math.max(this.shake, 0.02);
    this.updateHudStatic();
    this.updateModeUi();
    return true;
  }

  /* ---------------------------------------------------------------- *
   *  Public hooks
   * ---------------------------------------------------------------- */

  apiSwing(powerInput) {
    if (!this.ready) return false;
    if (this.sim.active) return false;
    if (this.debris.active) this.loadCurrentLog({ announce: false });
    let raw = Number(powerInput);
    if (!Number.isFinite(raw)) raw = 80;
    if (raw > 1) raw /= 100;
    const power = clamp(raw, 0.2, 1);
    // A deterministic, centred, in-the-sweet-spot swing for automation.
    const radius = this.debris.radius;
    const pith = this.debris.piths?.[0] || { x: 0, z: 0 };
    this.aim = { x: pith.x + radius * 0.035, z: pith.z + radius * 0.01 };
    this.lastMeterValue = power * 100;
    this.meterTiming = 0.94;
    this.meterPerfect = Math.abs(power - 0.78) <= 0.12;
    this.updateAimHud();
    this.updateChargeUi();
    return this.requestSwing({
      power,
      timing: 0.94,
      perfect: this.meterPerfect,
      aim: { ...this.aim },
      source: 'window.swing',
    });
  }

  /** Test/debug helper: land a strong swing on the next seated wedge. */
  apiSwingWedge(powerInput = 0.9) {
    if (!this.debris) return false;
    const slot = this.debris.wedgeSlots?.find((item) => !item.homed);
    if (!slot) return this.apiSwing(powerInput);
    if (!this.ready || this.sim.active || this.debris.active) return false;
    let raw = Number(powerInput);
    if (!Number.isFinite(raw)) raw = 90;
    if (raw > 1) raw /= 100;
    const power = clamp(raw, 0.2, 1);
    this.aim = { x: slot.x, z: slot.z };
    this.lastMeterValue = power * 100;
    this.meterTiming = 0.9;
    this.meterPerfect = Math.abs(power - 0.78) <= 0.12;
    this.updateAimHud();
    this.updateChargeUi();
    return this.requestSwing({
      power,
      timing: 0.9,
      perfect: this.meterPerfect,
      aim: { ...this.aim },
      source: 'window.swingWedge',
    });
  }

  /** Test/debug helper: land a good swing directly on the current boss seam. */
  apiSwingWeak(powerInput = 0.88) {
    const weak = this.debris?.weakPointPosition?.();
    if (!weak) return this.apiSwing(powerInput);
    if (!this.ready || this.sim.active || this.debris.active) return false;
    let raw = Number(powerInput);
    if (!Number.isFinite(raw)) raw = 88;
    if (raw > 1) raw /= 100;
    const power = clamp(raw, 0.2, 1);
    this.aim = { x: weak.x, z: weak.z };
    this.lastMeterValue = power * 100;
    this.meterTiming = 0.94;
    this.meterPerfect = Math.abs(power - 0.78) <= 0.12;
    this.updateAimHud();
    this.updateChargeUi();
    return this.requestSwing({
      power,
      timing: 0.94,
      perfect: this.meterPerfect,
      aim: { ...this.aim },
      source: 'window.swingWeakPoint',
    });
  }

  getGameState() {
    const snapshot = this.game.snapshot();
    if (this.debris) {
      snapshot.strikesRequired = this.debris.strikesRequired;
      snapshot.strikesLeft = Math.max(0, Math.ceil(this.debris.strikesLeft - 1e-6));
      snapshot.strikesLeftExact = Number(this.debris.strikesLeft.toFixed(2));
      snapshot.cracks = this.debris.crackLines;
      snapshot.hazardCount = this.debris.hazards.length;
      snapshot.twinPith = Boolean(this.debris.log?.twinPith);
      snapshot.piths = this.debris.piths.map((pith) => ({ ...pith }));
      snapshot.weakPoint = this.debris.weakPointPosition?.() || null;
      snapshot.weakSealed = this.bossRound && !this.debris.seamOpen;
      snapshot.huge = Boolean(this.debris.log?.huge);
      snapshot.twisted = Boolean(this.debris.log?.twisted);
      snapshot.stump = Boolean(this.debris.log?.stump);
      snapshot.weatherSnow = Number((this.debris.snowLoad || 0).toFixed(3));
      snapshot.weatherWetness = Number((this.debris.wetness || 0).toFixed(3));
      snapshot.weatherDrying = Boolean(this.debris.weatherIsDrying);
      snapshot.weatherCarried = Boolean(this.debris.weatherCarried);
      snapshot.weatherSurfaceState = this.debris.surfaceState || null;
      snapshot.rootNotches = (this.debris.rootNotches || []).map((notch) => ({
        x: Number(notch.x.toFixed(3)),
        z: Number(notch.z.toFixed(3)),
        cut: Boolean(notch.cut),
      }));
      snapshot.rootsCut = this.debris.rootsCut || 0;
      snapshot.rootUnstable = Boolean(this.debris.rootUnstable);
      snapshot.rootRingBroken = Boolean(this.debris.rootRingBroken);
      snapshot.rivingStreak = this.debris.rivingStreak || 0;
      snapshot.masterCheck = this.debris.masterCheckAt?.(this.aim.x, this.aim.z) || null;
      snapshot.wedges = this.debris.wedges;
      snapshot.maxWedges = this.debris.maxWedges;
      snapshot.wedgesHome = this.debris.wedgeHomeCount;
      snapshot.wedgeStrikes = this.debris.wedgeStrikes;
      snapshot.wedgeTargets = this.debris.wedgeSlots.map((slot) => ({
        x: Number(slot.x.toFixed(3)),
        z: Number(slot.z.toFixed(3)),
        depth: Number(slot.depth.toFixed(2)),
        homed: slot.homed,
      }));
      snapshot.kerfWidth = Number((this.debris.kerfWidth || 0).toFixed(3));
      snapshot.kerfFill = this.debris.kerfFillType || null;
      snapshot.bossPhase = this.debris.bossPhase || 1;
      snapshot.hollow = Boolean(this.debris.log?.hollow);
      snapshot.hollowCollapsed = Boolean(this.debris.hollowCollapsed);
      snapshot.hollowCavity = {
        open: Boolean(this.debris.hollowCap),
        holeRadius: Number((this.debris.hollowHoleRadius || 0).toFixed(3)),
        depth: Number((this.debris.hollowDepth || 0).toFixed(3)),
        rimTorn: Boolean(this.debris.hollowRimTorn),
      };
      snapshot.bossShock = {
        active: Boolean(this.debris.shockActive),
        count: this.debris.shockCount || 0,
        jolts: this.shockJolts || 0,
      };
      snapshot.weatherSurface = this.debris.weatherSurface?.type || null;
    }
    snapshot.bossRound = this.bossRound;
    snapshot.bossName = this.bossRound ? this.displaySpecies.name : null;
    snapshot.bossMechanic = this.bossRound ? this.displaySpecies?.bossMechanic || null : null;
    snapshot.displayLog = this.displaySpecies ? this.displaySpecies.name : snapshot.logType;
    snapshot.chapter = chapterFor(this.game.state.cleanSplits);
    snapshot.weatherBiteMod = this.weatherBiteMod;
    snapshot.weatherBiteShift = this.weatherBiteShift || 0;
    snapshot.weatherShiftCount = this.weatherShiftCount || 0;
    snapshot.weatherShiftNote = this.weatherShiftNote || '';
    snapshot.weatherNote = this.currentWeatherNote();
    snapshot.weatherThawing = Boolean(this.debris?.thawing);
    snapshot.campaignGoal = CAMPAIGN_SPLITS;
    snapshot.runOverlayOpen = this.runOverlayOpen;
    return snapshot;
  }

  /* ---------------------------------------------------------------- *
   *  Main loop
   * ---------------------------------------------------------------- */

  _tick(now) {
    requestAnimationFrame(this._tick);
    const elapsed = Math.max(0.0001, (now - this.lastFrame) / 1000);
    const rawDt = Math.min(0.5, elapsed);
    this.lastFrame = now;

    // Juice: a short freeze on contact, then a longer perfect-hit slow-mo.
    let timeScale = this.slowMotion ? 0.22 : 1;
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - rawDt);
      timeScale *= 0.07;
    } else if (this.perfectSlow > 0) {
      this.perfectSlow = Math.max(0, this.perfectSlow - rawDt);
      timeScale *= 0.38;
    }
    const scaledDt = rawDt * timeScale;
    this.accumulator += scaledDt;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS) {
      this.stepSimulation(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps++;
    }
    if (steps >= MAX_STEPS) this.accumulator = 0;

    if (this.weather) {
      this.weather.update(Math.min(0.12, scaledDt), this.simTime);
      this.updateWeatherDerived();
    }
    this.environment.update(Math.min(0.12, scaledDt), this.simTime);

    if (this.charge.active && !this.slowMotion) {
      this.charge.t += rawDt;
      this.charge.value = triangleWave(this.charge.t, this.charge.period);
      const tickStep = Math.floor(this.charge.value * 10);
      if (tickStep !== this.chargeTick) {
        this.chargeTick = tickStep;
        this.sound.tick(
          Math.abs(this.charge.value - 0.745) < 0.05 ? 0.75 : 0.18 + this.charge.value * 0.18,
        );
      }
      this.updateChargeUi();
      if (this.charge.t > 2.0) {
        this.charge.value = 0.745;
        this.releaseCharge();
        this.toast('Auto-released in the sweet spot', 'good');
      }
    }

    // Challenge clock. Menus and the summary overlay pause it so reading the
    // shop never costs a Time Attack run.
    if (
      this.game.run.active &&
      this.game.run.mode === 'time' &&
      !this.modalOpen &&
      !this.runOverlayOpen
    ) {
      this.game.run.timeLeft = Math.max(0, this.game.run.timeLeft - rawDt);
      if (this.game.run.timeLeft <= 0) this.finishRun('time');
    }

    // Stamina regeneration and the slow recovery of a chipped edge.
    if (!this.sim.active && !this.charge.active) {
      const mods = this.weather ? this.weather.getModifiers() : { regen: 1 };
      this.game.regenStamina(rawDt, mods.regen || 1);
      this.game.regenEdge(rawDt, 0.022);
    }

    if (this.nextLogTimer > 0 && !this.sim.active && !this.charge.active && !this.modalOpen) {
      this.nextLogTimer -= rawDt;
      if (this.nextLogTimer <= 0) {
        this.nextLogTimer = 0;
        this.loadCurrentLog({ announce: true });
      }
    }

    if (this.debugPhysics) this.updateDebugGeometry();
    if (this.targetPose) {
      this.updateHumanoid(scaledDt, this.targetPose.grip, this.targetPose.quaternion, this.targetPose.body);
    }
    if (this.debris) this.debris.update(scaledDt);
    this.weatherBiteTimer = (this.weatherBiteTimer || 0) + rawDt;
    if (this.weatherBiteTimer > 0.4) {
      this.weatherBiteTimer = 0;
      this.reconcileWeatherBites();
    }
    if (this.weatherShiftNote) {
      this.weatherShiftAge = (this.weatherShiftAge || 0) + rawDt;
      if (this.weatherShiftAge > 10) {
        this.weatherShiftNote = '';
        this.weatherShiftAge = 0;
        this.updateModeUi();
      }
    }
    this.axe?.setWeatherLook?.(this.debris?.wetness || 0, this.debris?.snowLoad || 0);
    // Phase II heartbeat: a shock ring is a real interrupt, not decoration. If
    // the player is holding a charge when it lands, the jolt tears it away.
    const shockCount = this.debris?.shockCount || 0;
    if (shockCount !== this.lastShockCount) {
      const rising = shockCount > this.lastShockCount;
      this.lastShockCount = shockCount;
      if (rising) {
        this.sound.heartbeat?.();
        this.shake = Math.max(this.shake, 0.045);
        if (ui.shockPulse) {
          ui.shockPulse.classList.remove('on');
          // Restart the CSS animation even when pulses arrive close together.
          void ui.shockPulse.offsetWidth;
          ui.shockPulse.classList.add('on');
          clearTimeout(this.shockPulseTimer);
          this.shockPulseTimer = setTimeout(
            () => ui.shockPulse?.classList.remove('on'),
            900,
          );
        }
        if (this.charge.active) {
          this.cancelCharge();
          this.game.spendStamina(this.game.staminaCost * 0.12);
          this.shockJolts += 1;
          this.toast(
            'HEARTWOOD SHOCK — the pulse tears the swing from your grip. Release before the beat.',
            'bad',
          );
          this.updateHudStatic();
        }
      }
    }
    this.controls.update(rawDt);
    this.updateReticle();

    // FPS meter.
    this.fpsFrames++;
    this.fpsTime += elapsed;
    if (this.fpsTime > 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
      if (ui.fpsReadout) ui.fpsReadout.textContent = String(this.fps);
      this.qualityManager.update(elapsed, this.fps);
      this.updateAdaptiveResolution();
    }

    const shake = this.shake;
    let sx = 0;
    let sy = 0;
    if (shake > 0.0002) {
      const t = performance.now() * 0.001;
      sx = Math.sin(t * 87.3) * shake * 0.22;
      sy = Math.cos(t * 71.7) * shake * 0.17;
      this.camera.position.x += sx;
      this.camera.position.y += sy;
    }

    this.shadowFrame++;
    const shadowEvery = this.qualityName === 'low' ? 2 : 1;
    if (this.renderer.shadowMap.enabled && this.shadowFrame % shadowEvery === 0) {
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (this.postfx && this.postfxReady) this.postfx.render(scaledDt);
    else this.renderer.render(this.scene, this.camera);

    if (sx || sy) {
      this.camera.position.x -= sx;
      this.camera.position.y -= sy;
    }

    this.uiAccumulator += rawDt;
    if (this.uiAccumulator > 0.09) {
      this.uiAccumulator = 0;
      this.updateHudLive();
      if (ui.fragmentReadout && this.debris) ui.fragmentReadout.textContent = String(this.debris.fragmentCount || 0);
      if (this.game.run.active && this.game.run.mode === 'time' && ui.runTimer) {
        const t = Math.max(0, this.game.run.timeLeft);
        ui.runTimer.textContent = `${t.toFixed(1)}s`;
        ui.runTimer.classList.toggle('urgent', t <= 12);
      }
    }
    this.atmosphereTimer = (this.atmosphereTimer || 0) + rawDt;
    if (this.atmosphereTimer > 0.55) {
      this.atmosphereTimer = 0;
      this.updateAtmosphereUi();
      // The audio context only exists after a gesture, so this never prompts or
      // starts an autoplay context on load.
      if (this.sound.ctx && this.weather) {
        this.sound.setAmbient({
          weather: this.weather.weather,
          night: this.weather.nightFactor,
          wind: this.weather.getWindStrength(),
        });
      }
    }

    if (this.sim.active) ui.swingButton?.classList.add('swinging');
    else ui.swingButton?.classList.remove('swinging');

    if (window.__sim) {
      window.__sim.phase = this.phase;
      window.__sim.time = this.sim.t;
      window.__sim.active = this.sim.active;
      window.__sim.hit = this.sim.hit;
      window.__sim.fragments = this.debris ? this.debris.fragmentCount : 0;
      window.__sim.mainPieces = this.debris ? this.debris.mainPieces : 0;
      window.__sim.splinterCount = this.debris ? this.debris.splinterCount : 0;
      window.__sim.fps = this.fps;
      window.__sim.bodies = (() => {
        try {
          return this.world.bodies.len();
        } catch {
          return 0;
        }
      })();
      window.__sim.slowMotion = this.slowMotion;
      window.__sim.debug = this.debugPhysics;
      window.__sim.quality = this.qualityName;
      window.__sim.charging = this.charge.active;
      window.__sim.charge = this.charge.value;
      window.__sim.lastImpact = this.lastImpact;
      window.__sim.weather = this.weather ? this.weather.weather : 'clear';
      window.__sim.timeOfDay = this.weather ? this.weather.timeLabel : 'golden';
      window.__sim.hitStop = this.hitStop;
      window.__sim.perfectSlow = this.perfectSlow;
      window.__sim.bossRound = this.bossRound;
      window.__sim.strikesRequired = this.debris ? this.debris.strikesRequired : 0;
      window.__sim.strikesLeft = this.debris ? this.debris.strikesLeft : 0;
      window.__sim.cracks = this.debris ? this.debris.crackLines : 0;
      window.__sim.hazards = this.debris ? this.debris.hazards.length : 0;
      window.__sim.edgeWear = this.game ? Number(this.game.state.edgeWear.toFixed(3)) : 0;
      window.__sim.mode = this.game ? this.game.run.mode : 'free';
      window.__sim.runActive = this.game ? this.game.run.active : false;
      window.__sim.runScore = this.game ? this.game.run.score : 0;
      window.__sim.runTimeLeft = this.game ? Number(this.game.run.timeLeft.toFixed(2)) : 0;
      window.__sim.runOverlayOpen = this.runOverlayOpen;
      window.__sim.weakPoint = this.debris?.weakPointPosition?.() || null;
      window.__sim.weakHit = Boolean(this.lastImpact?.weakHit);
      window.__sim.bossMechanic = this.displaySpecies?.bossMechanic || null;
      window.__sim.twinPith = Boolean(this.debris?.log?.twinPith);
      window.__sim.weakSealed = Boolean(this.bossRound && this.debris && !this.debris.seamOpen);
      window.__sim.seamOpen = this.debris ? this.debris.seamOpen : true;
      window.__sim.wedges = this.debris ? this.debris.wedges : 0;
      window.__sim.wedgesHome = this.debris ? this.debris.wedgeHomeCount : 0;
      window.__sim.wedgeStrikes = this.debris?.wedgeStrikes || 0;
      window.__sim.kerfWidth = this.debris ? Number((this.debris.kerfWidth || 0).toFixed(3)) : 0;
      window.__sim.kerfFill = this.debris?.kerfFillType || null;
      window.__sim.bossPhase = this.debris ? this.debris.bossPhase || 1 : 1;
      window.__sim.hollow = Boolean(this.debris?.log?.hollow);
      window.__sim.hollowCollapsed = Boolean(this.debris?.hollowCollapsed);
      window.__sim.hollowHoleRadius = Number((this.debris?.hollowHoleRadius || 0).toFixed(3));
      window.__sim.hollowDepth = Number((this.debris?.hollowDepth || 0).toFixed(3));
      window.__sim.hollowRimTorn = Boolean(this.debris?.hollowRimTorn);
      window.__sim.hollowCapOpen = Boolean(this.debris?.hollowCap);
      window.__sim.shockActive = Boolean(this.debris?.shockActive);
      window.__sim.shockCount = this.debris?.shockCount || 0;
      window.__sim.shockJolts = this.shockJolts || 0;
      window.__sim.weatherSurface = this.debris?.weatherSurface?.type || null;
      window.__sim.huge = Boolean(this.debris?.log?.huge);
      window.__sim.twisted = Boolean(this.debris?.log?.twisted);
      window.__sim.stump = Boolean(this.debris?.log?.stump);
      window.__sim.weatherSnow = Number((this.debris?.snowLoad || 0).toFixed(3));
      window.__sim.weatherCarried = Boolean(this.debris?.weatherCarried);
      window.__sim.weatherSurfaceState = this.debris?.surfaceState || null;
      window.__sim.rootsCut = this.debris?.rootsCut || 0;
      window.__sim.rootUnstable = Boolean(this.debris?.rootUnstable);
      window.__sim.rootNotches = (this.debris?.rootNotches || []).filter((n) => !n.cut).length;
      window.__sim.weatherWetness = Number((this.debris?.wetness || 0).toFixed(3));
      window.__sim.weatherDrying = Boolean(this.debris?.weatherIsDrying);
      window.__sim.rivingStreak = this.debris?.rivingStreak || 0;
      window.__sim.masterCheck = this.debris?.masterCheckAt?.(this.aim.x, this.aim.z) || null;
      window.__sim.weatherBiteShift = this.weatherBiteShift || 0;
      window.__sim.weatherShiftCount = this.weatherShiftCount || 0;
      window.__sim.wedgeCheck = this.debris?.canDriveWedge?.() || null;
      window.__sim.ambientLevel = this.sound.ambientLevel;
      window.__sim.audioState = this.sound.ctx ? this.sound.ctx.state : 'locked';
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Boot + public test hooks
 * ------------------------------------------------------------------ */

const simulation = new AxeSimulation();
window.__sim = {
  ready: false,
  phase: 'idle',
  time: 0,
  active: false,
  hit: false,
  fragments: 0,
  mainPieces: 0,
  splinterCount: 0,
  lastImpact: null,
  slowMotion: false,
  debug: false,
  fps: 0,
  bodies: 0,
  quality: 'low',
  charging: false,
  charge: 0,
  weather: 'clear',
  timeOfDay: 'golden',
  hitStop: 0,
  perfectSlow: 0,
  bossRound: false,
  strikesRequired: 0,
  strikesLeft: 0,
  cracks: 0,
  hazards: 0,
  edgeWear: 0,
  mode: 'free',
  runActive: false,
  runScore: 0,
  runTimeLeft: 0,
  runOverlayOpen: false,
  weakPoint: null,
  weakHit: false,
  bossMechanic: null,
  twinPith: false,
  weakSealed: false,
  seamOpen: true,
  wedges: 0,
  wedgesHome: 0,
  wedgeStrikes: 0,
  kerfWidth: 0,
  kerfFill: null,
  bossPhase: 1,
  hollow: false,
  hollowCollapsed: false,
  hollowHoleRadius: 0,
  hollowDepth: 0,
  hollowRimTorn: false,
  hollowCapOpen: false,
  shockActive: false,
  shockCount: 0,
  shockJolts: 0,
  weatherSurface: null,
  rivingStreak: 0,
  masterCheck: null,
  weatherBiteShift: 0,
  weatherShiftCount: 0,
  huge: false,
  twisted: false,
  wedgeCheck: null,
  ambientLevel: 0,
  audioState: 'locked',
};

window.swing = function swing(power) {
  return simulation.apiSwing(power);
};

window.swingWeakPoint = function swingWeakPoint(power) {
  return simulation.apiSwingWeak(power);
};

window.swingWedge = function swingWedge(power) {
  return simulation.apiSwingWedge(power);
};

window.resetScene = function resetScene() {
  return simulation.resetScene(true);
};

window.getGameState = function getGameState() {
  return simulation.getGameState();
};

window.startMode = function startMode(mode, seed) {
  return simulation.startMode(mode, seed);
};

window.copyShare = function copyShare() {
  return simulation.copyShare();
};

window.copySeedLink = function copySeedLink() {
  return simulation.copySeedLink();
};

window.retrySeed = function retrySeed() {
  return simulation.retrySeed();
};

window.driveWedge = function driveWedge() {
  return simulation.driveWedge();
};

window.honeEdge = function honeEdge() {
  const result = simulation.game.honeEdge();
  simulation.updateHudStatic();
  simulation.renderShop();
  return result;
};

window.setQuality = function setQuality(name) {
  return simulation.qualityManager.setMode(name);
};

window.setWeather = function setWeather(name) {
  if (!simulation.weather) return false;
  simulation.weather.setWeather(name);
  simulation.debris?.setWeather(simulation.weather.getModifiers());
  simulation.game.setSetting('weather', name);
  simulation.weatherCarryArmed = false;
  simulation.lastWeatherKey = '';
  simulation.loadCurrentLog({ announce: false });
  simulation.updateAtmosphereUi();
  return true;
};

window.setTimeOfDay = function setTimeOfDay(name) {
  if (!simulation.weather) return false;
  simulation.weather.setTimePreset(name);
  simulation.game.setSetting('timeOfDay', name);
  simulation.updateAtmosphereUi();
  return true;
};

window.__sim.instance = simulation;

simulation
  .init()
  .then(() => {
    window.__sim.ready = true;
  })
  .catch((error) => {
    window.__sim.ready = false;
    window.__sim.error = String(error && error.stack ? error.stack : error);
    showFatalError(error);
  });
