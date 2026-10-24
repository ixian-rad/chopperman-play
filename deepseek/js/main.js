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
import { MusicDirector } from './music.js';
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
import { createDisplayRenderer } from './canvasrenderer.js';
import { ContractRun, medalLabel, precisionGrade } from './contracts.js';
import { campaignChapter, campaignStartRound } from './campaign.js';
import { CrownSections } from './crown.js';
import { GrainReader } from './grainReader.js';
import { clamp, easeInCubic, easeInOutCubic, easeOutCubic } from './utils.js';
import {
  chargeFromMeter,
  decayShake,
  deliveredEnergy,
  formatBites,
  juiceFor,
  triangleWave,
} from './mechanics.js';
import { FractureState, baseRequiredEnergy } from './fracture.js';
import { simulateSwing, headMassFor, handleMassFor } from './swingmodel.js';
import { softwareInitialScale, softwareRenderFloor } from './perftune.js';
import { YardMode } from './yard.js';
import {
  CHARACTER_DEFS,
  CHARACTER_COSTUMES,
  normaliseCharacter,
  normaliseCostume,
  costumeName,
  characterName,
} from './character.js';
import { createCoop } from '../coop/index.js';

// Kick off Rapier's WASM compile before the synchronous yard build.
// `@dimforge/rapier3d-compat` embeds its wasm as base64 and initialises with an
// async `WebAssembly.instantiate`; starting it here overlaps that work with the
// yard build, and by the time init() reaches the physics section the promise
// is usually settled so init continues without yielding a new task. That
// reduces the chance a multi-second boot task lands in the operator's
// `load + 6 s` FPS sample and reads as a regression even though the running
// game is fine.
let rapierReady;
try {
  rapierReady = RAPIER.init();
} catch (error) {
  // Keep a synchronous bootstrap failure in the normal init() error path.
  rapierReady = Promise.reject(error);
}
rapierReady.catch(() => {}); // the await in init() still rejects; mark handled

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
  pullWedgeButton: el('pullWedgeButton'),
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
  powerTrack: el('powerTrack'),
  meterCore: el('meterCore'),
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
  contractStrip: el('contractStrip'),
  contractStatus: el('contractStatus'),
  telemetry: el('telemetry'),
  telemetrySpeed: el('telemetrySpeed'),
  telemetryEnergy: el('telemetryEnergy'),
  telemetryGrain: el('telemetryGrain'),
  telemetryFracture: el('telemetryFracture'),
  telemetryBlade: el('telemetryBlade'),
  grainReader: el('grainReader'),
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
  musicVolume: el('musicVolume'),
  musicVolumeValue: el('musicVolumeValue'),
  musicToggle: el('musicToggle'),
  sfxVolume: el('sfxVolume'),
  sfxVolumeValue: el('sfxVolumeValue'),
  sfxToggle: el('sfxToggle'),
  audioStatus: el('audioStatus'),
  audioNote: el('audioNote'),
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
  settingButtons: el('settingButtons'),
  characterButtons: el('characterButtons'),
  costumeButtons: el('costumeButtons'),
  characterLabel: el('characterLabel'),
  costumeLabel: el('costumeLabel'),
  playerNameSettings: el('playerNameSettings'),
  characterOverlay: el('characterOverlay'),
  characterTabs: el('characterTabs'),
  characterPreview: el('characterPreview'),
  startCostumeButtons: el('startCostumeButtons'),
  startCostumeLabel: el('startCostumeLabel'),
  playerNameInput: el('playerNameInput'),
  characterPlay: el('characterPlay'),
  coopToast: el('coopToast'),
  yardSettingLabel: el('yardSettingLabel'),
  axeSkinNote: el('axeSkinNote'),
  yardHud: el('yardHud'),
  yardLocation: el('yardLocation'),
  yardModeLabel: el('yardModeLabel'),
  yardFelled: el('yardFelled'),
  yardNearest: el('yardNearest'),
  yardPrompt: el('yardPrompt'),
  yardPromptTitle: el('yardPromptTitle'),
  yardPromptText: el('yardPromptText'),
  yardPromptAction: el('yardPromptAction'),
  yardBlockPrompt: el('yardBlockPrompt'),
  yardCrosshair: el('yardCrosshair'),
  yardHint: el('yardHint'),
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

/* ------------------------------------------------------------------ *
 *  App
 * ------------------------------------------------------------------ */

class AxeSimulation {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.usesWebGL = true;
    this.controls = null;
    this.world = null;
    this.eventQueue = null;
    this.environment = null;
    this.weather = null;
    this.postfx = null;
    this.humanoid = null;
    this.axe = null;
    this.debris = null;
    this.yard = null;
    this.coop = null;
    this.coopToastTimer = 0;
    this.showStartPicker = true;
    this.v2Active = false;
    this.sound = new SoundEngine();
    this.music = new MusicDirector(this.sound);
    this.audioUnlocked = false;
    this._lastHoverTarget = null;
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
    this.reducedMotion = Boolean(
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
    );
    try {
      window
        .matchMedia?.('(prefers-reduced-motion: reduce)')
        ?.addEventListener?.('change', (event) => {
          this.reducedMotion = Boolean(event.matches);
        });
    } catch {
      // matchMedia is best-effort; a missing listener must not block boot.
    }
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
    this.readyAt = 0;
    // The first rendered frame after init includes shader compilation and the
    // first texture upload. Counting it as a 0.5-2 s "frame" made the live FPS
    // meter (and the operator's boot check) read 0-3 FPS for several seconds
    // even though the steady state was healthy. Exclude it from the average.
    this.warmupFrames = 0;
    this.warmupUntil = 0;
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
    this.swingCount = 0;
    this.lastImpact = null;
    this.physics = new FractureState();
    this.lastPhysics = null;
    this.lastSwingModel = null;
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
    // Content layer: contracts overlay an existing run mode; the campaign has
    // its own 18-round plan from campaign.js.
    this.contract = null;
    this.lastContract = null;
    this.lastRunSeed = '';
    this.lastSummary = null;
    this.bladeOffset = 0;
    this.grainGuide = null;
    this.telemetry = null;
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
    // Resizing a WebGL backbuffer is the most expensive thing the quality
    // governor can do under SwiftShader, so never do it without a real change.
    this.lastPixelRatio = 0;
    this.lastRenderWidth = 0;
    this.lastRenderHeight = 0;
    // Backbuffer reallocations are the most expensive thing the adaptive
    // governor can do under SwiftShader; count them for the perf diagnostics.
    this.renderResizes = 0;
    // Rolling frame-time window for window.getPerfStats() / the operator test.
    this.frameSamples = new Float32Array(90);
    this.frameSampleCount = 0;
    this.frameSampleIndex = 0;
    this.frameMsAvg = 0;
    this.frameMsP95 = 0;
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
    const settings = this.game.settings;
    this.sound.setEnabled(settings.sound !== false);
    this.sound.setSfxVolume(settings.sfxVolume);
    this.sound.setMusicVolume(settings.musicVolume);
    this.music.setEnabled(settings.music !== false);
    this.updateAudioSettingsUi();
  }

  /* ---------------------------------------------------------------- *
   *  Audio settings + soundtrack director
   * ---------------------------------------------------------------- */

  updateAudioSettingsUi(preserveInputs = false) {
    const settings = this.game.settings;
    const musicOn = settings.music !== false;
    const sfxOn = settings.sound !== false;
    const musicPct = Math.round(
      (preserveInputs ? this.sound.musicVolume : Number(settings.musicVolume) || 0) * 100,
    );
    const sfxPct = Math.round(
      (preserveInputs ? this.sound.sfxVolume : Number(settings.sfxVolume) || 0) * 100,
    );
    if (ui.musicVolume && !preserveInputs && document.activeElement !== ui.musicVolume) {
      ui.musicVolume.value = String(musicPct);
    }
    if (ui.sfxVolume && !preserveInputs && document.activeElement !== ui.sfxVolume) {
      ui.sfxVolume.value = String(sfxPct);
    }
    if (ui.musicVolumeValue) ui.musicVolumeValue.textContent = `${musicPct}%`;
    if (ui.sfxVolumeValue) ui.sfxVolumeValue.textContent = `${sfxPct}%`;
    if (ui.musicToggle) {
      ui.musicToggle.setAttribute('aria-pressed', `${musicOn}`);
      ui.musicToggle.textContent = musicOn ? 'On' : 'Muted';
    }
    if (ui.sfxToggle) {
      ui.sfxToggle.setAttribute('aria-pressed', `${sfxOn}`);
      ui.sfxToggle.textContent = sfxOn ? 'On' : 'Muted';
    }
    if (ui.soundButton) ui.soundButton.setAttribute('aria-pressed', `${sfxOn}`);
    if (ui.audioStatus) {
      ui.audioStatus.textContent = `Music ${musicOn ? 'on' : 'muted'} · Effects ${sfxOn ? 'on' : 'muted'}`;
    }
    if (ui.audioNote) {
      ui.audioNote.textContent = this.sound.ctx
        ? 'Original procedural folk soundtrack and foley — no samples, no downloads.'
        : 'Music starts on your first tap or keypress. Original procedural folk soundtrack — no samples, no downloads.';
    }
  }

  /** Called from the first pointer/key gesture. Creates the context once. */
  unlockAudio() {
    if (!this.sound.ensure()) return false;
    this.audioUnlocked = true;
    this.updateAudioSettingsUi();
    if (this.game.settings.music !== false) {
      const scene = this.swingCount > 0 && !this.runOverlayOpen ? 'gameplay' : 'menu';
      this.startMusic(scene);
    }
    return true;
  }

  startMusic(scene = null) {
    if (!this.sound.ctx || this.game.settings.music === false) return false;
    this.music.setEnabled(true);
    this.music.setBossPhase(this.debris?.bossPhase || 1);
    this.music.setBoss(Boolean(this.bossRound));
    this.music.setIntensity(this.musicIntensity());
    if (!this.music.start()) return false;
    if (scene) this.music.setScene(scene);
    return true;
  }

  musicIntensity() {
    const combo = Number(this.game?.state?.combo) || 0;
    const boss = this.bossRound ? 0.28 : 0;
    const phaseTwo = (this.debris?.bossPhase || 1) >= 2 ? 0.3 : 0;
    const run = this.game?.run?.active ? 0.12 : 0;
    // The last 20 seconds of a clocked run tighten the groove, so the music
    // itself tells the player the clock is running out.
    const timeLeft = Number(this.game?.run?.timeLeft) || 0;
    const urgency = this.game?.run?.active && timeLeft > 0
      ? (1 - clamp(timeLeft / 20, 0, 1)) * 0.22
      : 0;
    return clamp(combo / 11 + boss + phaseTwo + run + urgency, 0, 1);
  }

  syncMusicState() {
    if (!this.sound.ctx || this.game.settings.music === false) return;
    this.music.setIntensity(this.musicIntensity());
    this.music.setBossPhase(this.debris?.bossPhase || 1);
    this.music.setBoss(Boolean(this.bossRound));
  }

  setMusicEnabled(enabled) {
    const on = Boolean(enabled);
    this.game.setSetting('music', on);
    this.music.setEnabled(on);
    if (on) {
      this.unlockAudio();
      this.startMusic(this.runOverlayOpen || this.swingCount === 0 ? 'menu' : 'gameplay');
    }
    this.updateAudioSettingsUi();
  }

  setMusicVolume(volume, persist = true) {
    const value = clamp(Number(volume) || 0, 0, 1);
    this.sound.setMusicVolume(value);
    if (persist) this.game.setSetting('musicVolume', Number(value.toFixed(2)));
    this.updateAudioSettingsUi(!persist);
  }

  setSfxVolume(volume, persist = true) {
    const value = clamp(Number(volume) || 0, 0, 1);
    this.sound.setSfxVolume(value);
    if (persist) this.game.setSetting('sfxVolume', Number(value.toFixed(2)));
    this.updateAudioSettingsUi(!persist);
  }

  getAudioStats() {
    const soundVoices = this.sound.activeVoices || 0;
    const musicVoices = this.music.activeVoices || 0;
    return {
      contextState: this.sound.ctx ? this.sound.ctx.state : 'locked',
      activeVoices: soundVoices + musicVoices,
      musicPlaying: Boolean(this.music.playing),
      musicVolume: Number(this.sound.musicVolume.toFixed(2)),
      sfxVolume: Number(this.sound.sfxVolume.toFixed(2)),
      // Additive diagnostics for automation; the five required fields above
      // keep their exact shape.
      musicScene: this.music.sceneName || 'menu',
      musicBpm: Number(this.music.bpm.toFixed(1)),
      musicIntensity: Number((this.music.intensity || 0).toFixed(2)),
      musicBoss: Boolean(this.music.bossMode),
      musicDucked: Boolean(this.music.clockDucked),
      ambientLevel: this.sound.ambientLevel || 0,
    };
  }

  /* ---------------------------------------------------------------- *
   *  Initialization
   * ---------------------------------------------------------------- */

  async init() {
    setLoading(8, 'Waking up the renderer…');
    // Create the WebGL2 context before asking Three to build a renderer. When
    // the browser cannot create one (SwiftShader/ANGLE failures are common in
    // headless verification), Three would console.error twice and throw. The
    // Canvas2D presentation keeps the simulation, hooks and HUD alive.
    const display = await createDisplayRenderer(ui.canvas);
    this.renderer = display.renderer;
    this.webgl = display.webgl;
    // Alias retained for older code paths that still branch on usesWebGL.
    this.usesWebGL = display.webgl;
    this.rendererReason = display.reason;
    if (display.canvas && display.canvas !== ui.canvas) ui.canvas = display.canvas;
    if (!this.webgl) {
      // Compatibility mode keeps the whole simulation running while the
      // Canvas2D presentation paints the yard. Preserve the existing fallback
      // styling and an accessible label for the canvas.
      document.body?.classList.add('webgl-fallback');
      if (ui.canvas) {
        ui.canvas.setAttribute(
          'aria-label',
          'American Split compatibility mode: full simulation and controls without WebGL',
        );
      }
      setLoading(12, 'WebGL unavailable — starting compatibility mode…');
    }
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.08, 320);
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
    const savedQuality = this.game.settings.quality || 'auto';
    if (!this.webgl) {
      // A Canvas2D fallback is CPU presented: keep the same low-quality game
      // budget (and the flat perf-lite HUD) it would get on any software GPU.
      this.qualityManager.rendererInfo = {
        name: 'Canvas 2D fallback (WebGL unavailable)',
        software: true,
      };
      this.qualityManager.ceiling = 'low';
    }
    // Compatibility mode has no GPU to spend on high/ultra content, and there
    // is nothing to gain from building 10k grass blades it will never draw.
    const requestedQuality = this.webgl ? savedQuality : 'low';
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
    this.applyPerformanceMode(initialName);

    setLoading(20, 'Building the backyard…');
    if (this.webgl) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.scene.environment = pmrem.fromScene(room, 0.02).texture;
      this.scene.environmentIntensity = 0.4;
      room.dispose?.();
      pmrem.dispose();
    } else {
      this.scene.environment = null;
      this.scene.environmentIntensity = 0.4;
    }

    this.environment = createEnvironment(this.scene, this.renderer, initialPreset);
    if (this.webgl) this.qualityManager.detect(this.renderer);

    setLoading(38, 'Loading Rapier rigid-body physics…');
    await rapierReady;
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
    this.crown = new CrownSections(this.scene, {
      world: this.world,
      RAPIER: this.RAPIER,
      onRelease: (payload) => this.onCrownRelease(payload),
    });
    this.debris.onFragmentLand = (item) => this.sound.fragment?.(item);
    this.axe.reset(REST.grip, REST.quaternion);
    this.previousHead.copy(this.axe.getHeadWorld());
    this.currentHead.copy(this.previousHead);
    this.createReticle();
    this.createPrecisionGuide();
    this.createGrainGuide();
    this.grainReader = new GrainReader(ui.grainReader);

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

    this.postfx = this.webgl ? new PostFX(this.renderer, this.scene, this.camera) : null;
    this.createDebugLines();

    // Install the quality manager's first real application (pixel ratio, grass
    // density, shadows, post-processing). This is async only if bloom loads.
    this.qualityManager.start(requestedQuality);
    await this.qualityApplyPromise;

    setLoading(80, 'Loading the lumberjack and the Assets v2 yards…');
    this.yard = new YardMode({
      scene: this.scene,
      renderer: this.renderer,
      camera: this.camera,
      controls: this.controls,
      game: this.game,
      sound: this.sound,
      weather: this.weather,
      qualityName: this.qualityName,
      onToast: (message, kind) => this.toast(message, kind),
      onHud: () => this.updateHudStatic(),
      onStumpEnter: () => this.onStumpEntered(),
      onYardEnter: () => this.onYardEntered(),
      isInputBlocked: () => Boolean(this.modalOpen || this.runOverlayOpen),
    });
    await this.yard.init((progress, message) => {
      setLoading(80 + progress * 18, message);
    });
    this.hideV1Yard();
    this.yard.applyQuality(this.qualityName, { silent: true });
    this.syncV2Ui();
    setLoading(98, 'Warming shaders…');
    this.loadCurrentLog({ initial: true });
    this.attachUI();
    this.updateHudStatic();
    this.updateHudLive();
    this.updateAtmosphereUi();
    this.renderShop();
    await this.setupCoop();

    if (ui.qualitySelect) ui.qualitySelect.value = requestedQuality;
    if (ui.autoTimeToggle) ui.autoTimeToggle.checked = Boolean(this.game.settings.autoTime);
    if (ui.rendererNote) {
      if (!this.webgl) {
        ui.rendererNote.textContent =
          'WebGL2 is unavailable here — running the Canvas 2D compatibility presentation. The full simulation, every mode, the shop and all test hooks still work.';
      } else {
        ui.rendererNote.textContent = rendererInfo.software
          ? `Software renderer detected (${rendererInfo.name.slice(0, 48)}). Auto quality is pinned low.`
          : `Renderer: ${rendererInfo.name.slice(0, 64)}`;
      }
    }

    if (this.webgl) {
      // Build the tree LOD pools and run one yard update before the warm-up
      // draw. Otherwise the first rAF after `ready` is where the instanced
      // tree materials first reach the GPU, and on SwiftShader that can stall
      // the exact FPS sample window.
      this.yard?.update?.(0.016, 0.016);
      this.renderer.compile(this.scene, this.camera);
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(this.scene, this.camera);
    } else {
      this.renderer.draw(this, 0.016);
    }
    setLoading(100, 'Ready to swing.');
    this.ready = true;
    this.warmupUntil = performance.now() + 1500;
    window.__sim.ready = true;
    this.updateHudStatic();
    this.readyAt = performance.now();
    requestAnimationFrame(() => ui.loading?.classList.add('done'));
    this.showStartPickerCard();
    this.lastFrame = performance.now();
    requestAnimationFrame(this._tick);
    this.applyUrlRun();
  }

  /**
   * Co-op v1 wiring. createCoop() only registers hooks here; PeerJS is not
   * downloaded until the player actually Hosts or Joins. The module owns the
   * transport/session/avatar/nameplate/menu; this game owns the world and the
   * real hit/award/log paths.
   */
  async setupCoop() {
    if (this.coop || !this.yard) return this.coop;
    const yard = this.yard;
    const coop = createCoop({
      THREE,
      scene: this.scene,
      getCamera: () => this.camera,
      getViewportHeight: () => this.renderer?.domElement?.clientHeight || window.innerHeight,
      hooks: {
        getProfile: () => ({
          name: this.effectiveName(),
          character: yard.characterId,
          costume: yard.costume,
          axe: yard.axeSkin,
        }),
        getWorld: () => ({
          // Host only: keep the historical fixed yard seeds when the player has
          // not hosted before, so a solo world looks exactly as it always did.
          seed: yard.worldSeed ?? (yard.setting === 'nj' ? 517 : 991),
          setting: yard.setting,
        }),
        onWorldInit: (opts) => {
          this.hideStartPicker();
          return yard.onCoopWorld(opts);
        },
        getTrees: async () => yard.coopTrees(),
        getLocalState: () => yard.localNetState(),
        // The yard uses forward = (-sin yaw, -cos yaw) (the model faces +Z and
        // setWorldTransform adds PI). The voice module's pan helper expects
        // forward = (sin yaw, cos yaw), so hand it the opposite direction.
        // Distance/gain are unaffected; this only matters if pan is enabled.
        getListenerYaw: () => (yard.playerYaw ?? 0) + Math.PI,
        spawnAvatar: (info) => yard.spawnCoopAvatar(info),
        onTreeHit: (ev, mine) => yard.onCoopTreeHit(ev, mine),
        onTreeFell: (ev, mine) => yard.onCoopTreeFell(ev, mine),
        onLogSpawned: (ev, mine) => yard.onCoopLogSpawned(ev, mine),
        onLogSplit: (ev, mine) => yard.onCoopLogSplit(ev, mine),
        onDenied: (ev) => yard.onCoopDenied(ev),
        onAward: (ev, mine) => yard.onCoopAward(ev, mine),
        onPlayerJoined: (p) => {
          if (!p || p.id === this.coop?.session?.localId) return;
          this.coopNotice(
            `${p.name} is here — ${characterName(p.character)} · ${costumeName(p.character, p.costume)}.`,
            'good',
          );
        },
        onPlayerLeft: (p) => {
          this.coopNotice(`${p?.name || 'Your partner'} left. Back to single player.`);
        },
        onPlayerDisconnected: (p) => {
          this.coopNotice(`${p?.name || 'Your partner'} disconnected — holding their spot…`, 'warn');
        },
        onEnded: (reason) => {
          if (reason === 'left') return;
          this.coopNotice(
            reason === 'host-left'
              ? 'Host left. Back to single player.'
              : reason === 'lost'
                ? 'Connection lost. Back to single player.'
                : 'Disconnected. Back to single player.',
          );
        },
      },
    });
    this.coop = coop;
    yard.coop = coop;
    coop.mountUI();
    this.placeCoopVoiceHud();
    window.chopperTest.coop = coop.testHook({
      fellTree: () => window.chopperTest.chopTree(),
    });
    return coop;
  }

  /**
   * The module docks #coop-voice-hud bottom-left, which is exactly where this
   * game keeps the yard panel (and, at the stump, the stamina panel). Lift the
   * voice HUD just above whichever of those is visible instead of covering it;
   * in stump mode the right-hand column under the atmosphere panel is free, so
   * the HUD moves there. CSS hides it while the narrow-layout Co-op panel is
   * open. Everything re-places on resize, panel show/hide and mode changes.
   */
  placeCoopVoiceHud() {
    const hud = document.querySelector('#coop-voice-hud');
    if (!hud) return;
    const anchors = [document.querySelector('.yard-hud'), document.querySelector('.stamina-card')];
    const place = () => {
      if (
        document.body.classList.contains('mode-stump') &&
        typeof matchMedia === 'function' &&
        matchMedia('(min-width: 1100px) and (min-height: 800px)').matches
      ) {
        // CSS parks the HUD in the free right-hand column between the grain dial
        // and the log card on large screens; clear the yard-mode inline offset.
        Object.assign(hud.style, { left: '', right: '', top: '', bottom: '' });
        return;
      }
      // Yard and small-screen stump: lift the HUD above the lowest visible
      // left-side panel (yard HUD in free roam, stamina card at the block).
      let top = Infinity;
      for (const el of anchors) {
        if (!el || getComputedStyle(el).display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.left < innerWidth / 2) top = Math.min(top, r.top);
      }
      Object.assign(hud.style, { left: '', right: '', top: '', bottom: top < Infinity ? `${Math.max(12, Math.round(innerHeight - top + 10))}px` : '' });
    };
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(place);
      for (const el of anchors) if (el) ro.observe(el);
    }
    window.addEventListener('resize', place);
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(place).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    place();
  }

  /**
   * Hide the original procedural yard furniture once the v2 layer is loaded.
   * The old chopping block's physics and the old axe's colliders stay live: the
   * log-splitting simulation still uses them every round.
   */
  hideV1Yard() {
    if (this.v2Active) return;
    this.v2Active = true;
    const characterReady = Boolean(this.yard?.character?.isLoaded);
    if (characterReady) {
      if (this.humanoid) this.humanoid.root.visible = false;
      if (this.axe) this.axe.group.visible = false;
    } else {
      this.toast(
        `${this.yard?.characterLabel || 'The lumberjack'} could not load — using the old procedural woodcutter fallback.`,
        'bad',
      );
    }
    const env = this.environment;
    if (env) {
      env.hideLegacyYard?.();
      if (env.trees?.forest) env.trees.forest.visible = false;
      if (env.trees?.shrubs) env.trees.shrubs.visible = false;
      if (env.fence?.group) env.fence.group.visible = false;
      if (env.house?.group) env.house.group.visible = false;
      if (env.block?.group) env.block.group.visible = false;
      if (env.ground?.moss) env.ground.moss.visible = false;
    }
    const hiddenNames = new Set([
      'v1-distant',
      'v1-woodpile',
      'v1-bucket',
      'v1-path',
      'v1-garden',
      'v1-wheelbarrow',
      'v1-dirt-patch',
      'snow-caps',
    ]);
    this.scene.traverse((object) => {
      if (hiddenNames.has(object.name)) object.visible = false;
    });
  }

  onStumpEntered() {
    const homeView = getHomeView();
    if (this.camera) this.camera.position.copy(homeView.position);
    if (this.controls) {
      this.controls.enabled = true;
      this.controls.target.copy(homeView.target);
      this.controls.update();
    }
    this.cancelCharge();
    if (this.reticle) this.reticle.visible = true;
    if (this.precisionGuide) this.precisionGuide.visible = true;
    if (this.grainGuide) this.grainGuide.visible = true;
    this.updateHudStatic();
    this.updateHudLive();
    this.updateAtmosphereUi();
  }

  onYardEntered() {
    if (this.showStartPicker) this.hideStartPicker();
    if (this.controls) this.controls.enabled = false;
    this.cancelCharge();
    if (this.reticle) this.reticle.visible = false;
    if (this.precisionGuide) this.precisionGuide.visible = false;
    if (this.grainGuide) this.grainGuide.visible = false;
    this.syncV2Ui();
  }

  /** Effective player name: explicit save value, else the character's name. */
  effectiveName() {
    const explicit = String(this.game?.settings?.playerName || '').trim().slice(0, 16);
    if (explicit) return explicit;
    const id = this.yard?.characterId || this.game?.settings?.character || 'sergey';
    return characterName(id);
  }

  setPlayerName(value, { syncInputs = true } = {}) {
    const clean = String(value || '')
      .replace(/[^\p{L}\p{N} _.'-]/gu, '')
      .trim()
      .slice(0, 16);
    this.game.setSetting('playerName', clean);
    const effective = this.effectiveName();
    if (syncInputs) {
      for (const input of [ui.playerNameInput, ui.playerNameSettings]) {
        if (input && document.activeElement !== input) input.value = effective;
      }
    }
    this.coop?.setLocalProfile?.({ name: effective });
    if (this.coop?.ui?.render) this.coop.ui.render();
    return effective;
  }

  /** Change the playable character from the start card, settings or tests. */
  setCharacter(character) {
    const next = normaliseCharacter(character);
    const previousId = this.yard?.characterId || this.game.settings.character || 'sergey';
    const previousDefault = characterName(previousId);
    const storedName = String(this.game.settings.playerName || '').trim();
    const wasAuto = !storedName || storedName === previousDefault;
    this.game.setSetting('character', next);
    const result = this.yard?.setCharacter(next) || Promise.resolve(next);
    return Promise.resolve(result).then(() => {
      const yardCostume = this.yard?.costume || CHARACTER_DEFS[next].defaultCostume;
      this.game.setSetting('costume', yardCostume);
      if (wasAuto) this.game.setSetting('playerName', '');
      this.syncV2Ui();
      this.updateHudStatic();
      this.coop?.setLocalProfile?.({
        character: next,
        costume: yardCostume,
        name: this.effectiveName(),
      });
      return this.yard?.characterId || next;
    });
  }

  setCostume(costume) {
    const character = this.yard?.characterId || this.game.settings.character || 'sergey';
    const next = normaliseCostume(character, costume);
    if (next !== costume) return Promise.resolve(this.yard?.costume || next);
    const result = this.yard?.setCostume(next) || Promise.resolve(next);
    return Promise.resolve(result).then(() => {
      this.game.setSetting('costume', next);
      this.syncV2Ui();
      this.coop?.setLocalProfile?.({ costume: next });
      return this.yard?.costume || next;
    });
  }

  syncV2Ui() {
    const setting = this.yard?.setting || this.game.settings.setting || 'nj';
    const character = this.yard?.characterId || this.game.settings.character || 'sergey';
    const costume = this.yard?.costume || normaliseCostume(character, this.game.settings.costume);
    const costumes = CHARACTER_COSTUMES[character] || CHARACTER_COSTUMES.sergey;
    for (const button of ui.settingButtons?.querySelectorAll('[data-setting]') || []) {
      button.classList.toggle('active', button.getAttribute('data-setting') === setting);
    }
    for (const button of ui.characterButtons?.querySelectorAll('[data-character]') || []) {
      button.classList.toggle('active', button.getAttribute('data-character') === character);
    }
    for (const button of ui.characterTabs?.querySelectorAll('[data-character]') || []) {
      button.classList.toggle('active', button.getAttribute('data-character') === character);
    }
    // Re-label the two costume buttons for the active character.
    for (const container of [ui.costumeButtons, ui.startCostumeButtons]) {
      const buttons = container?.querySelectorAll('[data-costume]') || [];
      buttons.forEach((button, index) => {
        const id = costumes[index] || costumes[0];
        button.setAttribute('data-costume', id);
        button.textContent = costumeName(character, id);
        button.classList.toggle('active', id === costume);
      });
    }
    const preview = {
      sergey: {
        tee: './assets/art/nj/nj_keyart.webp',
        jacket: './assets/art/nj/nj_keyart_jacket.webp',
      },
      alex: {
        camo: './assets/art/nj/alex_nj_keyart.webp',
        bomber: './assets/art/nj/alex_nj_keyart_jacket.webp',
      },
    };
    if (ui.characterPreview) {
      ui.characterPreview.src = preview[character]?.[costume] || preview.sergey.tee;
      ui.characterPreview.alt = `${characterName(character)} in ${costumeName(character, costume)} with an axe`;
    }
    if (ui.yardSettingLabel) {
      ui.yardSettingLabel.textContent = `${setting === 'tiraspol' ? 'Tiraspol' : 'NJ'} · ${characterName(character)} · ${costumeName(character, costume)}`;
    }
    if (ui.characterLabel) ui.characterLabel.textContent = characterName(character);
    if (ui.costumeLabel) ui.costumeLabel.textContent = costumeName(character, costume);
    if (ui.startCostumeLabel) ui.startCostumeLabel.textContent = costumeName(character, costume);
    if (ui.characterPlay) ui.characterPlay.textContent = `Play as ${characterName(character)}`;
    for (const input of [ui.playerNameInput, ui.playerNameSettings]) {
      if (input && document.activeElement !== input) input.value = this.effectiveName();
    }
    if (ui.yardHud) ui.yardHud.hidden = this.yard?.mode !== 'yard';
    if (ui.yardCrosshair) ui.yardCrosshair.hidden = this.yard?.mode !== 'yard';
    document.body.classList.toggle('mode-yard', this.yard?.mode === 'yard');
    document.body.classList.toggle('mode-stump', this.yard?.mode === 'stump');
    if (ui.axeSkinNote) {
      ui.axeSkinNote.textContent = 'Axe skin follows the axe equipped in the Axe Shed. The golden axe is the Tempered Master unlock.';
    }
  }

  hideStartPicker() {
    this.showStartPicker = false;
    if (!ui.characterOverlay) return;
    ui.characterOverlay.classList.add('hidden');
    ui.characterOverlay.setAttribute('aria-hidden', 'true');
  }

  showStartPickerCard() {
    if (!ui.characterOverlay) return;
    this.showStartPicker = true;
    ui.characterOverlay.classList.remove('hidden');
    ui.characterOverlay.setAttribute('aria-hidden', 'false');
    this.syncV2Ui();
  }

  /** Big, high-contrast co-op status toast (>= 20 px per the legibility rule). */
  coopNotice(message, kind = '') {
    if (!message || !ui.coopToast) return;
    ui.coopToast.textContent = message;
    ui.coopToast.dataset.kind = kind;
    ui.coopToast.hidden = false;
    clearTimeout(this.coopToastTimer);
    this.coopToastTimer = setTimeout(() => {
      if (ui.coopToast) ui.coopToast.hidden = true;
    }, 5200);
  }

  syncYardAxeFromGame() {
    if (!this.yard) return;
    this.yard.syncAxeFromGame?.();
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
    // Precision Six paints the requested contact point and its 9 cm grade
    // radius on the end grain, so the player can see the shot before charging.
    const contractTarget =
      this.contract?.kind === 'precision6' ? this.contract.targetFor(this.game.run.splits) : null;
    if (contractTarget) {
      addCircle(pithPositions, contractTarget.x, contractTarget.z, 0.025, 22);
      addCircle(knotPositions, contractTarget.x, contractTarget.z, 0.09, 30);
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

  /**
   * Local grain + blade guide on the end grain. The gold line is the nearest
   * natural check; the cream line is where the bit is actually pointing. Rotate
   * the blade with Q/Z (Shift+Q still orbits the camera; E leaves the stump).
   */
  createGrainGuide() {
    const group = new THREE.Group();
    group.name = 'grain-guide';
    group.renderOrder = 10;
    const makeLine = (color, opacity) => {
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        toneMapped: false,
      });
      // Two vertices are enough for both guides. Allocate them once and mutate
      // the buffer in place: the guide is rebuilt on every reticle update, and
      // creating/disposing two BufferGeometries per frame was pure GC churn.
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const object = new THREE.LineSegments(geometry, material);
      object.frustumCulled = false;
      object.renderOrder = 11;
      group.add(object);
      return object;
    };
    const grain = makeLine(0xffcf78, 0.78);
    const blade = makeLine(0xf4ecd3, 0.92);
    group.visible = false;
    this.scene.add(group);
    this.grainGuide = {
      group,
      grain,
      blade,
      grainPositions: grain.geometry.getAttribute('position').array,
      bladePositions: blade.geometry.getAttribute('position').array,
      key: '',
    };
  }

  buildGrainGuide() {
    if (!this.grainGuide || !this.debris || this.debris.active) {
      if (this.grainGuide) {
        this.grainGuide.group.visible = false;
        this.grainGuide.key = '';
      }
      return;
    }
    const guide = this.grainGuide;
    const radius = this.debris.radius;
    const grainAngle = this.debris.nearestSeamAngle(this.aim.x, this.aim.z);
    const radial = Math.atan2(this.aim.z, this.aim.x);
    const bladeAngle = radial + this.bladeOffset;
    // The guide only depends on aim, blade angle, log radius/top and the
    // nearest seam. Skip the buffer upload when none of them moved.
    const key = `${this.aim.x.toFixed(4)}|${this.aim.z.toFixed(4)}|${this.bladeOffset.toFixed(
      4,
    )}|${radius.toFixed(4)}|${this.debris.topY.toFixed(4)}|${grainAngle.toFixed(4)}`;
    if (guide.key === key) return;
    guide.key = key;
    const inner = radius * 0.16;
    const grainPositions = guide.grainPositions;
    grainPositions[0] = Math.cos(grainAngle) * inner;
    grainPositions[1] = 0;
    grainPositions[2] = Math.sin(grainAngle) * inner;
    grainPositions[3] = Math.cos(grainAngle) * radius * 0.96;
    grainPositions[4] = 0;
    grainPositions[5] = Math.sin(grainAngle) * radius * 0.96;
    const bx = this.aim.x;
    const bz = this.aim.z;
    const bladePositions = guide.bladePositions;
    bladePositions[0] = bx - Math.cos(bladeAngle) * radius * 0.12;
    bladePositions[1] = 0.002;
    bladePositions[2] = bz - Math.sin(bladeAngle) * radius * 0.12;
    bladePositions[3] = bx + Math.cos(bladeAngle) * radius * 0.3;
    bladePositions[4] = 0.002;
    bladePositions[5] = bz + Math.sin(bladeAngle) * radius * 0.3;
    for (const object of [guide.grain, guide.blade]) {
      const attribute = object.geometry.getAttribute('position');
      attribute.needsUpdate = true;
    }
    guide.group.position.set(0, this.debris.topY + 0.024, -0.95);
    guide.group.visible = true;
  }

  /** How closely the blade edge follows the local check (0..1). */
  bladeAlignmentAt(x, z) {
    if (!this.debris) return 1;
    const radial = Math.atan2(z, x);
    const seam = this.debris.nearestSeamAngle(x, z);
    const delta = Math.atan2(
      Math.sin(radial + this.bladeOffset - seam),
      Math.cos(radial + this.bladeOffset - seam),
    );
    return clamp(0.18 + 0.82 * Math.cos(delta) ** 2, 0, 1);
  }

  /** Position-on-grain quality combined with the blade's own angle. */
  effectiveGrainAt(x, z) {
    if (!this.debris) return 0.7;
    const position = this.debris.grainAt(x, z);
    return clamp(position * (0.55 + 0.45 * this.bladeAlignmentAt(x, z)), 0, 1);
  }

  rotateBlade(direction) {
    if (!this.ready || this.modalOpen || this.runOverlayOpen) return;
    this.bladeOffset = clamp(
      this.bladeOffset + direction * (Math.PI / 36),
      -Math.PI / 3,
      Math.PI / 3,
    );
    if (window.__sim) window.__sim.bladeAngle = Number(((this.bladeOffset * 180) / Math.PI).toFixed(1));
    this.updateAimHud();
    this.updateReticle?.();
  }

  resetBlade() {
    this.bladeOffset = 0;
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

  /**
   * Software rasterisers and the Low preset get a flat, contained HUD. The
   * panels keep their layout and type; this only drops the expensive paint
   * effects (blurred shadows, full-screen grain, ambient loops) that otherwise
   * cost more than the WebGL scene itself under SwiftShader.
   */
  applyPerformanceMode(name = this.qualityName) {
    const lite = name === 'low' || Boolean(this.qualityManager?.rendererInfo?.software);
    this.perfLite = lite;
    document.body?.classList.toggle('perf-lite', lite);
  }

  computeDpr(preset = this.qualityPreset) {
    const base = Math.min(window.devicePixelRatio || 1, preset.maxDpr) * preset.pixelRatio;
    return Math.max(0.12, base * this.renderScale);
  }

  applyPixelRatio() {
    if (!this.renderer) return;
    const dpr = this.computeDpr();
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (
      Math.abs(dpr - this.lastPixelRatio) < 0.002 &&
      width === this.lastRenderWidth &&
      height === this.lastRenderHeight
    ) {
      return;
    }
    this.lastPixelRatio = dpr;
    this.lastRenderWidth = width;
    this.lastRenderHeight = height;
    this.renderResizes = (this.renderResizes || 0) + 1;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.postfx?.resize(width, height, dpr);
  }

  async applyQuality({ name, preset, reason, previous = null }) {
    const software = Boolean(this.qualityManager?.rendererInfo?.software);
    if (software && name !== 'low') {
      // Manual High on a CPU rasteriser is allowed, but full 2048² shadows at
      // 1.35 DPR are not playable. Keep the richer content (all props, full
      // tree budget, bloom) while shading about the same pixel count as Low.
      preset = {
        ...preset,
        shadowSize: Math.min(preset.shadowSize || 512, 512),
        maxDpr: Math.min(preset.maxDpr || 1, 0.82),
        godrays: false,
      };
    }
    const changed = this.qualityName !== name || Boolean(previous && previous !== name);
    this.qualityName = name;
    this.qualityPreset = preset;
    this.applyPerformanceMode(name);
    if (changed || reason === 'startup' || reason === 'manual') {
      // Keep an already-adapted scale when the same preset is re-applied; only
      // a real quality change, startup or an explicit choice resets it. A
      // software/auto-low start begins at the floor the governor would settle
      // on anyway, avoiding two very expensive backbuffer reallocations.
      this.renderScale =
        preset.startScale ?? (preset.maxDpr <= 0.45 ? 0.55 : 1);
    }
    // Software rasterisers are fill-rate bound: keep the same preset and draw
    // calls but shade fewer pixels so physics and input stay responsive.
    const swScale = softwareInitialScale(this);
    if (swScale != null) this.renderScale = Math.min(this.renderScale, swScale);
    if (software) {
      const softwareCap = name === 'high' ? 0.5 : name === 'medium' ? 0.46 : null;
      if (softwareCap != null) this.renderScale = Math.min(this.renderScale, softwareCap);
    }
    const dpr = this.computeDpr(preset);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.lastPixelRatio = dpr;
    this.lastRenderWidth = window.innerWidth;
    this.lastRenderHeight = window.innerHeight;
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
    this.yard?.applyQuality(name, { silent: true });
    document.body.dataset.quality = name;
    if (this.postfx) {
      try {
        await this.postfx.setQuality(preset);
        this.postfxReady = Boolean(this.postfx.enabled);
      } catch {
        this.postfxReady = false;
      }
      this.postfx.resize(window.innerWidth, window.innerHeight, dpr);
      try {
        // Compile the bloom/composite shaders now rather than on the first
        // benchmarked frame after a High switch.
        this.postfx.render(0.016);
      } catch {
        // Post-processing is optional; never block the quality change.
      }
    }
    this.renderer.shadowMap.needsUpdate = true;
    // Compile and draw one frame during the quality switch. Under SwiftShader a
    // High switch has to compile the full-tree/leaf/shadow shaders; doing that
    // inside the click keeps the cost out of the next benchmark window and
    // means the first screenshot after a switch is fully dressed.
    if (this.webgl && this.scene && this.camera) {
      try {
        this.renderer.compile(this.scene, this.camera);
        this.renderer.render(this.scene, this.camera);
        // The switch just rebuilt the shadow map; do not immediately rebuild it
        // again on the next tick (that double pass is the costly first frame).
        this.shadowFrame = 1;
      } catch {
        // A compile hiccup must not block the actual quality change.
      }
    }
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
    // Autoplay policy: the soundtrack starts on the player's first real gesture.
    const unlock = () => this.unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });

    // One delegated click/hover layer keeps every button audible without
    // touching each individual handler in this large file.
    document.addEventListener(
      'pointerdown',
      (event) => {
        const control = event.target?.closest?.('button, [role="button"]');
        if (!control || control.id === 'swingButton') return;
        this.sound.click?.();
      },
      true,
    );
    document.addEventListener(
      'pointerover',
      (event) => {
        const control = event.target?.closest?.('button');
        if (!control || control === this._lastHoverTarget) return;
        this._lastHoverTarget = control;
        this.sound.hover?.();
      },
      true,
    );

    ui.musicVolume?.addEventListener('input', () =>
      this.setMusicVolume(Number(ui.musicVolume.value) / 100, false),
    );
    ui.musicVolume?.addEventListener('change', () =>
      this.setMusicVolume(Number(ui.musicVolume.value) / 100, true),
    );
    ui.sfxVolume?.addEventListener('input', () =>
      this.setSfxVolume(Number(ui.sfxVolume.value) / 100, false),
    );
    ui.sfxVolume?.addEventListener('change', () => {
      this.setSfxVolume(Number(ui.sfxVolume.value) / 100, true);
      // Preview at the new level so the slider is not a blind control.
      this.sound.tick?.(0.7);
    });
    ui.musicToggle?.addEventListener('click', () => {
      this.setMusicEnabled(ui.musicToggle.getAttribute('aria-pressed') !== 'true');
    });
    ui.sfxToggle?.addEventListener('click', () => {
      this.setSound(ui.sfxToggle.getAttribute('aria-pressed') !== 'true');
    });

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
      const chapterButton = event.target.closest('button[data-chapter]');
      if (chapterButton) {
        this.startCampaignChapter(Number(chapterButton.getAttribute('data-chapter')));
        return;
      }
      const button = event.target.closest('button[data-mode]');
      if (!button) return;
      this.startMode(button.getAttribute('data-mode'));
    });
    ui.contractStrip?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-contract]');
      if (!button) return;
      this.startContract(button.getAttribute('data-contract'), this.lastRunSeed);
    });

    ui.wedgeButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.sound.ensure();
      this.driveWedge();
    });
    ui.pullWedgeButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.sound.ensure();
      this.pullWedge();
    });

    ui.honeButton?.addEventListener('click', () => {
      const result = this.game.honeEdge();
      if (result.ok) {
        this.toast(`Whetstone — edge restored for ${result.cost} coins`, 'good');
        this.sound.sharpen?.();
        this.updateHudStatic();
      } else {
        this.toast(result.reason, 'bad');
        this.sound.deny?.();
      }
      this.renderShop();
    });

    ui.runAgain?.addEventListener('click', () => {
      if (this.lastContract) {
        this.startContract(this.lastContract.kind);
        return;
      }
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
      this.yard?.applyQuality(this.qualityName, { silent: true });
      this.game.setQuality(ui.qualitySelect.value);
      this.updateAtmosphereUi();
      this.sound.click?.();
    });

    ui.settingButtons?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-setting]');
      if (!button) return;
      const setting = button.getAttribute('data-setting');
      if (!setting || setting === this.yard?.setting) return;
      this.yard?.setSetting(setting).then(() => this.syncV2Ui());
      this.sound.click?.();
    });

    ui.costumeButtons?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-costume]');
      if (!button) return;
      const costume = button.getAttribute('data-costume');
      if (!costume || costume === this.yard?.costume) return;
      this.setCostume(costume).then(() => this.sound.click?.());
    });

    for (const container of [ui.characterButtons, ui.characterTabs]) {
      container?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-character]');
        if (!button) return;
        const character = button.getAttribute('data-character');
        if (!character || character === this.yard?.characterId) return;
        this.sound.click?.();
        this.setCharacter(character);
      });
    }

    ui.startCostumeButtons?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-costume]');
      if (!button) return;
      const costume = button.getAttribute('data-costume');
      if (!costume || costume === this.yard?.costume) return;
      this.sound.click?.();
      this.setCostume(costume);
    });

    for (const input of [ui.playerNameInput, ui.playerNameSettings]) {
      input?.addEventListener('input', () => {
        const value = input.value;
        for (const other of [ui.playerNameInput, ui.playerNameSettings]) {
          if (other && other !== input) other.value = value;
        }
        this.setPlayerName(value, { syncInputs: false });
      });
      input?.addEventListener('blur', () => {
        input.value = this.effectiveName();
      });
      input?.addEventListener('keydown', (event) => event.stopPropagation());
      input?.addEventListener('keyup', (event) => event.stopPropagation());
    }
    ui.characterPlay?.addEventListener('click', () => {
      this.hideStartPicker();
      this.sound.ensure();
      this.sound.click?.();
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
      this.sound.click?.();
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
          this.sound.purchase?.();
        } else {
          this.toast(result.reason, 'bad');
          this.sound.deny?.();
        }
      } else if (mode === 'equip') {
        if (this.game.equipAxe(axeId)) {
          this.toast(`Equipped ${this.game.axe.name}`, 'good');
          this.sound.click?.();
        }
      }
      this.renderShop();
      this.updateHudStatic();
      this.syncYardAxeFromGame();
      this.coop?.setLocalProfile?.({ axe: this.yard?.axeSkin });
    });

    ui.upgradeList?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-upgrade]');
      if (!button) return;
      const stat = button.getAttribute('data-upgrade');
      const result = this.game.buyUpgrade(stat);
      if (result.ok) {
        this.toast(`${UPGRADES[stat].name} → ${result.level}`, 'good');
        this.sound.purchase?.();
      } else {
        this.toast(result.reason, 'bad');
        this.sound.deny?.();
      }
      this.renderShop();
      this.updateHudStatic();
    });

    ui.resetProgressButton?.addEventListener('click', () => {
      this.game.resetProgress();
      this.resetScene(true);
      this.renderShop();
      this.updateHudStatic();
      this.sound.menuClose?.();
      this.toast('Progress reset. Back to white pine.', 'gold');
    });

    // Mouse aim + hold-to-charge.
    ui.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    ui.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.sound.ensure();
      if (this.yard?.mode === 'yard') {
        this.yard.onCanvasPointerDown(event);
        return;
      }
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
    if (
      this.showStartPicker &&
      ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Enter'].includes(event.code)
    ) {
      this.hideStartPicker();
    }
    if (event.key === 'Escape' && this.runOverlayOpen) {
      this.startMode('free');
      return;
    }
    if (event.key === 'Escape' && this.modalOpen) {
      this.closeModal(this.modalOpen);
      return;
    }
    if (this.modalOpen || this.runOverlayOpen) return;
    if (this.yard?.mode === 'stump' && event.key === 'Escape') {
      event.preventDefault();
      this.yard.enterYard();
      return;
    }
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (event.code !== 'Space') return;
    }
    // Free-roam owns WASD and mouse look. Main's canvas still owns Space/LMB
    // for the tree swing, and the yard layer handles E (block) itself.
    if (this.yard?.mode === 'yard') {
      if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) {
          this.sound.ensure();
          this.yard.swingAtTarget();
        }
        return;
      }
      if (event.code === 'KeyE') {
        event.preventDefault();
        if (!event.repeat) this.yard.toggleStump();
        return;
      }
      return;
    }
    if (this.yard?.mode === 'stump') {
      if (event.code === 'KeyE') {
        event.preventDefault();
        this.yard.enterYard();
        return;
      }
      if (event.code === 'KeyZ') {
        event.preventDefault();
        this.rotateBlade(1);
        return;
      }
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
        if (event.shiftKey) this.pullWedge();
        else this.driveWedge();
        break;
      case 'KeyT':
        this.toggleSlowMotion();
        break;
      case 'KeyD':
        this.toggleDebug();
        break;
      case 'KeyQ':
        if (event.shiftKey) this.rotateCamera(1);
        else this.rotateBlade(-1);
        break;
      case 'KeyE':
        if (event.shiftKey) this.rotateCamera(-1);
        else this.rotateBlade(1);
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
    if (this.yard?.mode === 'yard') return;
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
    if (this.showStartPicker) this.hideStartPicker();
    this.modalOpen = name;
    const modal = name === 'shop' ? ui.shopModal : ui.settingsModal;
    if (!modal) return;
    modal.hidden = false;
    this.sound.menuOpen?.(name);
    if (name === 'shop') this.renderShop();
    if (name === 'settings') {
      this.updateAtmosphereUi();
      this.updateAudioSettingsUi();
      this.syncV2Ui();
    }
    modal.querySelector('.modal-close')?.focus();
  }

  closeModal(name) {
    const modal = name === 'shop' ? ui.shopModal : ui.settingsModal;
    if (modal) modal.hidden = true;
    if (this.modalOpen === name) this.modalOpen = null;
    this.sound.menuClose?.();
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
    this.yard?.onGameEvent?.(type, detail);
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
      // The impact foley already covers the glance/stuck variants; do not stack
      // a second skate sound on top of the same hit.
      if (detail.quality !== 'MISS' && !detail.partial) {
        const pan = clamp((Number(detail.aimX) || 0) / 0.35, -0.6, 0.6);
        this.sound.split?.(detail.mainPieces || 2, {
          weather: this.weather?.weather || 'clear',
          pan,
        });
        this.music.stinger?.(detail.mainPieces || 2, { boss: Boolean(detail.boss) });
        if (detail.coins > 0) this.sound.coin?.(0.15);
        if (detail.boss) this.sound.bossDefeat?.();
      }
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

  /** Daily Seed and Daily Route share the date's sky, weather and light. */
  applyDailyAtmosphere(seedInput = 0) {
    if (!this.weather) return;
    const seed = Math.abs(Math.round(Number(seedInput) || 0));
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

  startMode(modeId = 'free', seedDate = '', options = {}) {
    if (!this.ready) return false;
    clearTimeout(this.runFinishTimer);
    this.runFinishTimer = 0;
    clearTimeout(this.contractFinishTimer);
    this.contractFinishTimer = 0;
    clearTimeout(this.bestStingerTimer);
    this.cancelCharge();
    this.contract = null;
    this.lastContract = null;
    this._lastCountdown = null;
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
      this.yard?.enterYard({ instant: true });
      this.startMusic('gameplay');
      return true;
    }

    let campaignStart = 0;
    if (def.campaign && options.startRound == null) {
      // Continue where the story left off; a finished campaign starts over.
      campaignStart = this.game.state.campaignComplete
        ? 0
        : campaignStartRound(this.game.state.campaignChapter || 1);
    }
    const result = this.game.startMode(def.id, {
      seedDate,
      startRound: options.startRound ?? campaignStart,
    });
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
      this.applyDailyAtmosphere(this.game.run.dailySeed);
    }

    this.resetScene(true);
    this.updateModeUi();
    const targetText = def.time
      ? 'clock live'
      : def.target
        ? `${def.target} rounds`
        : 'no finish line';
    this.toast(`${def.name} — ${targetText}. ${def.desc}`, def.trial ? 'bad' : 'gold');
    if (def.campaign) {
      const meta = this.game.campaignMeta;
      this.toast(
        `Chapter ${meta?.chapter || 1} · ${meta?.chapterName || 'First Firewood'} — ${meta?.chapterIdea || ''} Round ${meta?.roundInChapter || 1} of 3.`,
        'gold',
      );
    } else if (def.stumpTrial) {
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
    this.yard?.enterStump();
    this.startMusic('gameplay');
    return true;
  }

  /** Start a campaign run at the first round of a chapter (1–6). */
  startCampaignChapter(chapterNo = 1) {
    if (!this.ready) return false;
    const total = Math.max(1, Number(this.game.state.campaignChapters) || 6);
    const chapter = clamp(Math.round(Number(chapterNo) || 1), 1, total);
    const unlocked = this.game.state.campaignComplete
      ? total
      : clamp(Math.round(Number(this.game.state.campaignChapter) || 1), 1, total);
    if (chapter > unlocked) {
      this.toast(
        `Chapter ${chapter} is locked — clear Chapter ${unlocked} to unlock it.`,
        'bad',
      );
      this.sound.deny?.();
      return false;
    }
    const ok = this.startMode('campaign', '', {
      startRound: campaignStartRound(chapter),
    });
    if (ok) {
      this.toast(
        `Chapter ${chapter} · ${campaignChapter(chapter).name} — ${campaignChapter(chapter).idea}`,
        'gold',
      );
    }
    return ok;
  }

  /**
   * Start a contract. It reuses the normal run mode and only overrides the
   * seeded deck, target, and clock, so shop/progression and all mechanics stay
   * exactly the same. Medals and bests live in contracts.js storage.
   */
  startContract(kind = 'sprint', seedDate = '') {
    if (!this.ready) return false;
    clearTimeout(this.runFinishTimer);
    this.runFinishTimer = 0;
    clearTimeout(this.contractFinishTimer);
    this.contractFinishTimer = 0;
    this.cancelCharge();
    this._lastCountdown = null;
    clearTimeout(this.bestStingerTimer);
    const contract = new ContractRun(kind, { storage: this.game.storage, seedDate });
    const def = contract.def;
    const result = this.game.startMode(def.mode, { seedDate: def.daily ? contract.date : '' });
    if (!result?.ok) return false;
    this.game.run.contractId = def.id;
    this.game.run.contractSeed = contract.seed;
    this.game.run.timeLeft = def.time || 0;
    this.game.run.target = def.target || 0;
    if (def.deck) this.game.run.deck = [...def.deck];
    this.contract = contract;
    this.contract.begin();
    this.lastContract = null;
    this.lastRunMode = def.mode;
    this.lastRunSeed = def.daily ? contract.date : '';
    this.weatherCarryArmed = false;
    this.lastWeatherKey = '';
    if (def.daily) this.applyDailyAtmosphere(this.game.run.dailySeed);
    this.hideRunOverlay();
    this.resetScene(true);
    this.updateModeUi();
    this.toast(`${def.name} — ${def.desc}`, 'gold');
    this.sound.chime?.(0.78);
    this.yard?.enterStump();
    this.startMusic('gameplay');
    return true;
  }

  finishRun(reason = 'time') {
    if (!this.game.run.active) return null;
    this._lastCountdown = null;
    const summary = this.game.endRun(reason, true);
    if (!summary) return null;
    if (this.contract) {
      const elapsed =
        this.contract.kind === 'sprint'
          ? Math.min(this.contract.def.time, this.contract.def.time - summary.timeLeft)
          : this.contract.elapsed;
      summary.contract = this.contract.finish(summary.score, { elapsed });
      summary.contractId = summary.contract.kind;
      summary.medal = summary.contract.medal;
      this.lastContract = summary.contract;
      this.contract = null;
    }
    this.lastRunMode = summary.mode;
    this.music.setClock(0, false);
    this.music.setBoss(false);
    if (reason === 'time' || summary.reason === 'time') this.sound.timeUp?.();
    if (summary.campaign && summary.campaignComplete && summary.splits >= modeFor('campaign').target) {
      this.showCampaignVictory({
        ...summary,
        campaignMode: true,
        cleanSplits: summary.splits,
        bossesDefeated: summary.bosses,
        bestCombo: summary.bestCombo,
      });
    } else {
      this.showRunOverlay(summary);
      // A run summary is a beat of its own: warm cadence, then the menu theme.
      // A graded contract gets its medal fanfare instead of the generic cadence.
      if (summary.contract && summary.medal) this.sound.medal?.(summary.medal);
      else this.sound.runComplete?.();
      // Give the new-best flourish its own breath after the cadence.
      if (summary.newBest) {
        clearTimeout(this.bestStingerTimer);
        this.bestStingerTimer = setTimeout(() => this.sound.personalBest?.(), 520);
      }
    }
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
      ui.runKicker.textContent = summary.contract
        ? `${medalLabel(summary.contract.medal)} medal · ${summary.contract.name}`
        : summary.customSeed
          ? 'Shared seed run'
          : summary.newBest
            ? 'New personal best'
            : 'Run complete';
    }
    if (ui.runTitle) {
      ui.runTitle.textContent = summary.contract
        ? summary.contract.name
        : summary.modeName || mode.name;
    }
    if (ui.runSub) {
      const reasonText =
        summary.reason === 'time'
          ? 'The clock ran out. Clean splits buy more time.'
          : summary.reason === 'target'
            ? `${summary.splits} rounds down. The run is in the books.`
            : summary.reason === 'contract'
              ? 'Contract complete. The medal is in the books.'
              : 'Run closed.';
      ui.runSub.textContent = summary.contract
        ? `${summary.contract.name} · ${medalLabel(summary.contract.medal)} medal · ${summary.contract.score.toLocaleString()} points · ${summary.contract.elapsed.toFixed(1)}s.`
        : summary.mode === 'daily'
          ? `${reasonText} Seed ${summary.dailyDate || ''}.`
          : reasonText;
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
      if (summary.contract) {
        const c = summary.contract;
        bits.push(`<span>Medal <b>${medalLabel(c.medal)}</b></span>`);
        bits.push(`<span>Swings <b>${c.swings}</b> · misses <b>${c.misses}</b></span>`);
        if (c.kind === 'precision6') {
          bits.push(`<span>Bullseyes <b>${c.bullseyes}</b> · contract pts <b>${c.points}</b></span>`);
        }
        if (c.date) bits.push(`<span>Route <b>${c.date}</b></span>`);
        bits.push(`<span>Contract best <b>${c.best.toLocaleString()}</b></span>`);
      }
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
    this.music.setScene('menu');
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
    this.sound.confirm?.(copied);
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
    this.sound.confirm?.(copied);
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
    const campaignMode = Boolean(detail.campaignMode);
    if (ui.runCopy) ui.runCopy.hidden = true;
    if (ui.runSeed) ui.runSeed.hidden = true;
    if (ui.runRetrySeed) ui.runRetrySeed.hidden = true;
    if (ui.runKicker) ui.runKicker.textContent = 'Campaign complete';
    if (ui.runTitle) ui.runTitle.textContent = campaignMode ? 'The Iron Crown' : 'The Last Ring';
    if (ui.runSub) {
      ui.runSub.textContent = campaignMode
        ? 'Eighteen logs, six chapters, and three stone-bound sections on the block. The Iron Crown is in pieces and the yard is yours.'
        : 'Sixty clean splits, five chapters, and every stump in the yard. The woodpile is yours.';
    }
    if (ui.runScore) ui.runScore.innerHTML = `${detail.score.toLocaleString()} <small>${campaignMode ? 'campaign score' : 'total score'}</small>`;
    if (ui.runStats) {
      ui.runStats.innerHTML = campaignMode
        ? [
            `<span>Logs <b>${detail.cleanSplits}</b></span>`,
            `<span>Bosses <b>${detail.bossesDefeated}</b></span>`,
            `<span>Level <b>${detail.level}</b></span>`,
            `<span>Best combo <b>${detail.bestCombo}</b></span>`,
          ].join('')
        : [
            `<span>Clean splits <b>${detail.cleanSplits}</b></span>`,
            `<span>Bosses <b>${detail.bossesDefeated}</b></span>`,
            `<span>Level <b>${detail.level}</b></span>`,
            `<span>Best combo <b>${detail.bestCombo}</b></span>`,
          ].join('');
    }
    if (ui.runAgain) ui.runAgain.textContent = campaignMode ? 'Chop the free yard' : 'Keep chopping';
    if (ui.runHistory) ui.runHistory.textContent = '';
    if (ui.runExit) ui.runExit.hidden = true;
    ui.runOverlay.hidden = false;
    ui.runAgain?.focus();
    this.sound.chapter?.();
    this.music.setBoss(false);
    this.music.setScene('menu');
  }

  updateModeUi() {
    if (!this.game) return;
    const snapshot = this.game.snapshot();
    const run = this.game.run;
    const mode = run.active ? modeFor(run.mode) : modeFor('free');
    if (ui.modeStrip) {
      for (const button of ui.modeStrip.querySelectorAll('[data-mode]')) {
        button.classList.toggle('active', button.getAttribute('data-mode') === mode.id && !run.contractId);
      }
      const unlocked = clamp(
        Math.round(Number(this.game.state.campaignChapter) || 1),
        1,
        Math.max(1, Number(this.game.state.campaignChapters) || snapshot.campaignChapters || 6),
      );
      const activeChapter =
        run.active && run.mode === 'campaign' && !run.contractId ? this.game.campaignMeta?.chapter || 1 : 0;
      for (const button of ui.modeStrip.querySelectorAll('button[data-chapter]')) {
        const chapterNo = Number(button.getAttribute('data-chapter'));
        const chapterInfo = campaignChapter(chapterNo);
        const locked = chapterNo > unlocked && !this.game.state.campaignComplete;
        button.disabled = locked;
        button.classList.toggle('active', chapterNo === activeChapter);
        button.classList.toggle('locked', locked);
        button.title = locked
          ? `Chapter ${chapterNo} — ${chapterInfo.name}. Clear Chapter ${chapterNo - 1} to unlock.`
          : `Chapter ${chapterNo} — ${chapterInfo.name}. ${chapterInfo.idea}`;
      }
    }
    if (ui.contractStrip) {
      for (const button of ui.contractStrip.querySelectorAll('[data-contract]')) {
        button.classList.toggle(
          'active',
          Boolean(run.contractId) && button.getAttribute('data-contract') === run.contractId,
        );
      }
    }
    if (ui.contractStatus) {
      if (this.contract) {
        const c = this.contract;
        ui.contractStatus.textContent =
          c.kind === 'precision6'
            ? `${c.def.name} · ${c.clears}/${c.def.target} logs · ${c.attemptsLeft} strikes · ${c.bullseyes} bullseyes · best ${c.best}`
            : c.kind === 'route'
              ? `${c.def.name} · ${c.clears}/${c.def.target} · ${c.date} · best ${c.best}`
              : `${c.def.name} · ${Math.ceil(c.remaining)}s · ${c.clears} logs · best ${c.best}`;
      } else if (this.lastContract) {
        const r = this.lastContract;
        ui.contractStatus.textContent = `${r.name} · ${medalLabel(r.medal)} · ${r.score.toLocaleString()} pts · best ${r.best.toLocaleString()}`;
      } else {
        ui.contractStatus.textContent = 'Seeded challenges · separate medals';
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
        if (run.contractId) {
          const c = this.contract;
          if (run.contractId === 'sprint') {
            parts.push(`SPRINT CONTRACT · ${Math.ceil(run.timeLeft)}s · ${run.splits} logs · seeded deck`);
          } else if (run.contractId === 'route') {
            parts.push(`DAILY ROUTE · ${run.splits}/${run.target || mode.target} · ${run.dailyDate} · six-log seed`);
          } else if (run.contractId === 'precision6') {
            parts.push(
              `PRECISION SIX · ${run.splits}/${run.target || mode.target} logs · ${c ? c.attemptsLeft : 12} strikes · 55/30/15 grade`,
            );
          }
          kind = 'precision';
        } else if (mode.campaign) {
          const meta = this.game.campaignMeta;
          parts.push(
            meta
              ? `CHAPTER ${meta.chapter}/6 · ${meta.chapterName} · round ${meta.roundInChapter}/3 · ${meta.idea}`
              : 'Campaign · six chapters · 18 logs',
          );
          kind = meta?.boss ? 'boss' : 'precision';
        } else if (mode.id === 'precision') {
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
    const campaignPlan = this.game.campaignPlan;
    this.bossRound = campaignPlan ? Boolean(campaignPlan.boss) : this.game.bossReady;
    this.displaySpecies = campaignPlan
      ? campaignPlan
      : this.bossRound
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

    // Precision Six is a shot-placement contract: each marked log is deliberately
    // a one-strike target so twelve attempts cover six logs with room to miss.
    if (this.contract?.kind === 'precision6') {
      this.displaySpecies = {
        ...this.displaySpecies,
        strikes: 1,
        toughness: Math.max(0.32, (this.displaySpecies.toughness || 0.5) * 0.62),
        precisionContract: true,
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
    const seedOffset = this.game.run.contractSeed
      ? (this.game.run.contractSeed % 100000) + this.game.run.splits * 7
      : this.game.run.active && this.game.run.mode === 'campaign'
        ? 6203 + this.game.run.splits * 43
        : this.game.run.active && this.game.run.mode === 'daily'
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
    this.crown?.setLog(this.debris.getLogMetrics(), {
      finalBoss: Boolean(this.displaySpecies.finalBoss),
      sections: this.displaySpecies.crownSections || 3,
      required: this.debris.strikesRequired,
    });
    this.debris.setWind(this.weather ? this.weather.getWindVector() : null);
    this.debris.setQuality?.(this.qualityPreset);
    this.lastShockCount = this.debris.shockCount || 0;
    // Start the energy/fracture ledger for this round. Conditions are sampled
    // from the surface actually built above (carried snow and rain included).
    this.physics.setRound({
      log: this.displaySpecies,
      knots: this.currentKnots,
      hazards: this.currentHazards,
      conditions: this.physicsConditions(),
      seed: this.displaySpecies.seed || 1,
      strikes: this.debris.strikesRequired,
      piths: this.debris.piths,
    });
    this.lastPhysics = this.physics.snapshot();
    this.lastSwingModel = null;
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
    this.bladeOffset = 0;
    this.lastMeterValue = 0;
    this.meterTiming = 0;
    this.meterPerfect = false;
    this.hollowCollapsed = false;
    this.lastCrownSections = 0;
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
    this.music.setBoss(Boolean(this.bossRound));
    this.yard?.onStumpLogLoaded?.();
    if (this.bossRound) {
      const sealed = Boolean(this.displaySpecies.bossSeamSealed);
      const bossJ = Math.round(this.physics?.required || 0);
      this.toast(
        `BOSS ROUND — ${this.displaySpecies.name} · ${bossJ} J fracture energy · ${
          sealed
            ? `${this.displaySpecies.bossMechanic?.label || 'seam'} sealed: bite the rings first`
            : `${this.displaySpecies.bossMechanic?.label || 'weak seam'}: strike the glowing band`
        }`,
        'bad',
      );
      this.sound.bossIntro?.();
      this.music.setBossPhase(this.debris?.bossPhase || 1);
      if (ui.logCard) {
        ui.logCard.classList.remove('boss-bump');
        void ui.logCard.offsetWidth;
        ui.logCard.classList.add('boss-bump');
      }
    } else if (announce) {
      this.toast(`Fresh round: ${this.displaySpecies.name}`, 'gold');
      this.sound.roundStart?.();
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
      if (this.yard?.mode === 'yard') {
        this.yard.snapCamera();
      } else {
        const homeView = getHomeView();
        this.camera.position.copy(homeView.position);
        this.controls.target.copy(homeView.target);
        this.controls.update();
      }
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
    const { power, timing, perfect } = chargeFromMeter(value);
    this.lastMeterValue = value * 100;
    this.meterTiming = timing;
    this.meterPerfect = perfect;
    const aim = { x: this.aim.x, z: this.aim.z };
    this.updateChargeUi();
    return this.requestSwing({
      power,
      timing,
      perfect,
      aim,
      chargeValue: value,
      source: this.charge.source || 'mouse',
    });
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

  requestSwing({
    power = 0.75,
    timing = 0.65,
    perfect = false,
    aim = null,
    chargeValue = null,
    source = 'api',
  } = {}) {
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
      chargeValue: Number.isFinite(chargeValue) ? clamp(chargeValue, 0, 1) : null,
      source,
      winded,
      mods,
      cost,
    };
    this.sim.force = Math.round(p * 100);
    // If the last blow left the bit buried, this wind-up tears it free.
    if (this.lastImpact?.partial) this.sound.axePull?.();
    this.queueSwing(p);
    if (winded) {
      this.toast('Winded — the swing comes up short', 'bad');
      this.sound.winded?.();
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
      this.sound.deny?.();
      return false;
    }
    // A splitting maul seats a wedge with less wind and more bite; the felling
    // axe still works but is the honest, slower choice.
    const maul = this.game.axe.id === 'maul';
    const cost = Math.max(4.5, this.game.staminaCost * (maul ? 0.44 : 0.55));
    if (this.game.state.stamina < cost) {
      this.toast('Not enough wind to drive the wedge', 'bad');
      this.sound.deny?.();
      return false;
    }
    this.game.spendStamina(cost);
    const result = this.debris.driveWedge({ x: this.aim.x, z: this.aim.z }, maul ? 0.16 : 0);
    if (!result.ok) {
      this.toast(result.reason || 'The wedge will not take', 'bad');
      this.sound.deny?.();
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
    const remJ = Math.round(
      Math.max(0, (this.physics?.required || 0) * (1 - (this.physics?.work || 0))),
    );
    this.toast(
      `Wedge set (${result.wedges}/${result.max})${maul ? ' with the maul' : ''} — ${remJ} J of crack work left. Aim at the steel and swing to drive it home.`,
      'gold',
    );
    this.updateHudStatic();
    this.updateHudLive();
    this.updateAimHud();
    return true;
  }

  /**
   * Pull the most recently seated wedge back out. A shallow wedge comes free
   * cheaply; one driven home grips hard. The kerf closes a little, so this is a
   * recovery move for a misread check rather than a free reroll.
   */
  pullWedge() {
    if (!this.ready || this.modalOpen || this.runOverlayOpen) return false;
    if (this.sim.active || !this.debris || this.debris.active) return false;
    const check = this.debris.canPullWedge();
    if (!check.ok) {
      this.toast(check.reason, 'bad');
      return false;
    }
    const maul = this.game.axe.id === 'maul';
    const depth = Math.max(0, Math.min(1, check.slot.depth || 0));
    const grip = 0.55 + depth * 1.25 + (check.slot.homed ? 0.35 : 0);
    const cost = Math.max(3.5, this.game.staminaCost * (0.18 + grip * 0.24)) * (maul ? 0.8 : 1);
    if (this.game.state.stamina < cost) {
      this.toast('Not enough wind to pull the wedge — rest and try again', 'bad');
      return false;
    }
    const result = this.debris.pullWedge();
    if (!result.ok) {
      this.toast(result.reason || 'The wedge will not come free', 'bad');
      return false;
    }
    this.game.spendStamina(cost);
    this.game.state.wedgesPulled = (this.game.state.wedgesPulled || 0) + 1;
    this.sound.wedgePull?.(result.grip);
    this.shake = Math.max(this.shake, 0.012);
    const remJ = Math.round(
      Math.max(0, (this.physics?.required || 0) * (1 - (this.physics?.work || 0))),
    );
    this.toast(
      `Wedge pulled (${result.wedges}/${result.max}) — grip ${result.grip.toFixed(1)} · ${cost.toFixed(1)} wind · ${remJ} J of crack work left.`,
      'bad',
    );
    this.updateHudStatic();
    this.updateHudLive();
    this.updateAimHud();
    return true;
  }

  /** A stone-bound section of the final boss breaks free and falls on its own. */
  onCrownRelease({ index = 0, total = 3, standing = 0, position = null, physical = false, mass = null } = {}) {
    const origin = position || new THREE.Vector3(0, this.debris?.topY || 1, -0.95);
    this.debris?.spawnSparks(origin, 30, 1.15);
    this.debris?.biteBurst(origin, 1.15);
    this.sound.crownRelease?.();
    this.shake = Math.max(this.shake, 0.07);
    this.hitStop = Math.max(this.hitStop, 0.03);
    this.toast(
      standing > 0
        ? `Crown section ${index + 1}/${total} breaks free${
            physical && mass ? ` (${mass} kg stone-bound ring)` : ''
          } — ${standing} stone-bound section${standing === 1 ? '' : 's'} still standing.`
        : `The last stone-bound section falls. The Iron Crown is breaking!`,
      'gold',
    );
    this.updateHudStatic();
    this.updateHudLive();
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
    this.music.setBossPhase(this.debris.bossPhase);
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
    this.swingCount = (this.swingCount || 0) + 1;
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
    this.startMusic('gameplay');
    this.sound.whoosh(0.55 + p * 0.9);
    this.yard?.onStumpSwing?.(this.sim.impactAt);
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
    const grain = this.effectiveGrainAt(aim.x, aim.z);
    const bladeAlignment = this.bladeAlignmentAt(aim.x, aim.z);
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
    // Automated swings must be reproducible under a software rasteriser, where
    // frame pacing can shorten the measured head speed. Give the documented
    // "good swing" hooks a reliable energetic floor; player swings are untouched.
    const apiSwing = String(state.source || '').startsWith('window.');
    const measuredSpeed = clamp(
      apiSwing ? Math.max(24, this.headSpeed || 10) : Math.max(4, this.headSpeed || 10),
      4,
      30,
    );
    // Shared mechanics mapping, with the blade-alignment term kept from the
    // presentation layer (the same factor the inline formula used).
    const energy =
      deliveredEnergy({
        power: state.power,
        timing: state.timing,
        headWeight: this.game.headWeight,
        sharpness: this.game.sharpness,
        speed: measuredSpeed,
        weatherSplit: mods.split || 1,
      }) *
      (0.86 + bladeAlignment * 0.14);
    const headMassKg = 2.4 * this.game.headWeight;
    const impactJoules = 0.5 * headMassKg * measuredSpeed * measuredSpeed;

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
    // Precision Six grades the requested contact point instead, so its marked
    // targets may sit off-pith without becoming automatic misses.
    const precisionRun =
      this.game.run.active &&
      this.game.run.mode === 'precision' &&
      this.game.run.contractId !== 'precision6';
    const precisionMiss =
      precisionRun && (center < 0.72 || grain < 0.56 || knotHit);
    const seamWasSealed = this.bossRound && !this.debris.seamOpen;
    // Ring-shaken walnut: the pale loose-ring arc is the intended off-pith
    // target, and the bound heart is a trap that jams the bit. This is read
    // before the glance check because the bound core deliberately glances.
    const ringTarget = this.debris.ringAt?.(aim.x, aim.z) || null;
    const boundTarget = this.debris.boundAt?.(aim.x, aim.z) || null;
    const ringCut = Boolean(ringTarget) && !hazardHit && !precisionMiss && !wedgeAimed;
    // A full-force blow can punch the bound core instead of jamming. The mouse
    // route is deliberately an overcharge: release in the top 10% of the meter
    // (the mint core band) and the bit drives through the bound heart. That
    // costs the timing sweet spot, half a bite, and edge wear, but the ring then
    // needs only one arc cut. The direct-hook route below keeps the original
    // full-power/full-timing test contract.
    const coreWindow =
      Number.isFinite(state.chargeValue) && state.chargeValue >= 0.9;
    const corePunch =
      Boolean(boundTarget) &&
      !ringCut &&
      !hazardHit &&
      !precisionMiss &&
      !wedgeAimed &&
      !plan.glancing &&
      !this.debris.coreCracked &&
      ((coreWindow && state.power >= 0.9) ||
        (state.power >= 0.94 && state.timing >= 0.9 && energy >= 0.95));
    const ringBound =
      Boolean(boundTarget) &&
      !ringCut &&
      !corePunch &&
      !hazardHit &&
      !precisionMiss &&
      !wedgeAimed;
    // Fracture physics: predict the head speed / kinetic energy from the same
    // swing model the HUD uses, then balance it against this round's required
    // fracture energy. Special targets (ring arcs, wedges, root notches) are
    // resolved by their own mechanics and do not advance the main crack plane.
    const pithNow = this.debris.piths?.[0] || { x: 0, z: 0 };
    const radiusNow = Math.max(0.05, this.debris.radius || metrics.radius);
    const rNorm = Math.hypot(aim.x - pithNow.x, aim.z - pithNow.z) / radiusNow;
    // The fracture plane is the vertical plane through the contact along the
    // actual horizontal blade travel, so knot/stone intersections use the same
    // direction the axe is moving rather than a fixed X slice.
    this.axe.group.updateMatrixWorld(true);
    const bladeHeadNow = this.axe.getHeadWorld(this._scratch.v);
    const bladeDir = new THREE.Vector3().subVectors(bladeHeadNow, this.previousHead);
    bladeDir.y = 0;
    if (bladeDir.lengthSq() < 1e-6) bladeDir.set(0, 0, -1);
    else bladeDir.normalize();
    const edgeCoverage = clamp(1 - 0.55 * rNorm, 0.35, 1);
    const wedgeGeometry = clamp(0.88 + 0.5 * (this.game.axe.weight - 1), 0.8, 1.25);
    const headMass = headMassFor(this.game.headWeight);
    const swingModel = simulateSwing({
      power: state.power,
      timing: state.timing,
      headMass,
      handleMass: handleMassFor(headMass),
    });
    const rootAim = this.debris.rootAt(aim.x, aim.z);
    const specialTarget = ringCut || wedgeAimed || Boolean(rootAim);
    this.physics.setConditions(this.physicsConditions(), {
      bossPhase: this.debris.bossPhase || 1,
    });
    const physicsHit = this.physics.resolve({
      aim,
      delivered: swingModel.eEffective,
      sharpness: this.game.sharpness,
      wedge: wedgeGeometry,
      coverage: edgeCoverage,
      grain,
      riving: Boolean(this.debris.masterCheckAt?.(aim.x, aim.z)),
      weakHit: Boolean(weakPoint) && !hazardHit,
      hollowHit: Boolean(hollow) && !hazardHit,
      wedgeStored:
        Math.min(240, (this.debris.wedges || 0) * 55 + (this.debris.wedgeHomeCount || 0) * 75),
      swing: {
        power: Number(state.power.toFixed(3)),
        vHead: swingModel.vHead,
        eEffective: swingModel.eEffective,
        headMass: swingModel.headMass,
      },
      forceClean: specialTarget,
      commit: !specialTarget,
      bossPhase: this.debris.bossPhase || 1,
      bladeDir,
      rootBroken: Boolean(this.debris.rootRingBroken),
      hazardContact: hazard
        ? {
            ...hazard,
            type: hazard.hazard?.type === 'stone' ? 'stone' : 'nail',
          }
        : null,
    });
    this.lastPhysics = physicsHit;
    this.lastSwingModel = swingModel;
    // Cold, knotty wood chips the edge in proportion to the joules it actually
    // absorbs. Hazards are handled by registerSplit with the model's sharpLoss.
    const stressWear =
      !hazardHit && !specialTarget
        ? Math.min(
            0.016,
            (knotHit ? 0.0055 : 0) * clamp(physicsHit.delivered / 340, 0.2, 1.4) +
              (mods.frozen ? 0.003 : 0) * clamp(physicsHit.delivered / 300, 0.2, 1.4),
          )
        : 0;
    if (stressWear > 0.0004) this.game.dullEdge(stressWear);
    // The Canvas2D presentation gets an impact flash; WebGL uses PostFX instead.
    this.renderer?.flashImpact?.();
    const physicsGlance = physicsHit.outcome === 'glance';
    // Stone or steel in the grain always skates the bit and takes an edge with it.
    // The old energy proxy is deliberately not consulted here: the fracture
    // model above owns the glance decision (rim, knots, ice, wet bark), while
    // precision runs and hazards keep their explicit rules.
    const glancing =
      hazardHit ||
      precisionMiss ||
      (ringBound && !corePunch) ||
      (physicsGlance && !specialTarget);
    // A strike aimed at a seated wedge is a controlled interaction, not a wild
    // off-pith chop. It drives the wedge instead of splitting the round.
    const glancingAtWedge = wedgeAimed ? hazardHit || precisionMiss : glancing;
    const wedgeHit = wedgeAimed && !glancingAtWedge;
    // Root notches are an optional outer-ring target on an old stump. They are
    // deliberate off-pith cuts, so they ignore the centre-quality glance rule.
    const rootTarget = rootAim;
    const undercut = Boolean(rootTarget) && !hazardHit && !precisionMiss && !wedgeAimed;
    const weakHit = Boolean(weakPoint) && !glancingAtWedge && !hazardHit && !undercut && !ringCut;
    const hollowHit = Boolean(hollow) && !glancingAtWedge && !hazardHit && !undercut && !ringCut;
    const rimTear = Boolean(hollowRim) && !glancingAtWedge && !hazardHit && !undercut && !ringCut;
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
      !ringCut &&
      !wedgeHit &&
      !weakHit &&
      !hollowHit &&
      !rimTear &&
      energy >= 0.62;
    const rivingAngle = masterCheck?.angle ?? null;
    // A clean bite that lands just beside a live golden check drags across the
    // grain: it still cuts, but the riving streak is lost and the check moves.
    const checkMiss =
      !riving && !ringCut && this.debris.rivingStreak > 0
        ? this.debris.masterCheckMissAt?.(aim.x, aim.z) || null
        : null;
    const crossedGrain =
      Boolean(checkMiss) && !glancing && !hazardHit && !knotHit && !precisionMiss && !undercut;
    if (mods.frozen && (knotHit || hazardHit)) this.game.dullEdge(0.012);
    // Punching the bound core is steel-on-bound-heart: it works, but it rolls
    // the edge hard and is deliberately not repeatable on the same round.
    if (corePunch) this.game.dullEdge(0.12);
    let strike;
    if (ringCut) {
      strike = this.debris.cutRing({ power: state.power });
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
    } else if (undercut) {
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
      // Special mechanics that promise a split on the resolving blow keep
      // ownership of it; ordinary chops are decided by the energy ledger.
      const ringSpring = Boolean(this.debris.log?.ringShake && this.debris.ringShakeLoose);
      const rootReady = Boolean(this.debris.rootUnstable && !this.debris.rootRingBroken);
      strike = this.debris.registerStrike({
        clean: !glancingAtWedge,
        glancing: glancingAtWedge,
        hazardHit,
        // The energy ledger owns the split for ordinary chops. Riving, weak
        // points, hollow cores, rim tears, a sprung ring and a cracked root
        // ring keep their mechanic shortcuts.
        preventSplit:
          precisionMiss ||
          (physicsHit.outcome !== 'split' &&
            !riving &&
            !weakHit &&
            !hollowHit &&
            !rimTear &&
            !ringSpring &&
            !rootReady),
        weakHit,
        hollowHit,
        rimTear,
        riving,
        rivingAngle,
        crossedGrain,
        ringBound,
        corePunch,
        energyGain: physicsHit.energyGain,
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
      if (!wedgeHit && !undercut && !ringCut) this.debris.addCrack(aim.x, aim.z);
      this.debris.biteBurst(impactPoint, state.power);
      if (hazardHit) this.debris.spawnSparks(impactPoint, 18, 1.2);
      if (undercut) {
        this.debris.biteBurst(impactPoint, 1.15);
        this.shake = Math.max(this.shake, 0.06);
        this.sound.tick?.(0.55);
      }
      if (ringCut) {
        this.debris.biteBurst(impactPoint, 1.15);
        this.debris.spawnSparks(impactPoint, strike.ringLoose ? 12 : 8, 0.7);
        this.shake = Math.max(this.shake, strike.ringLoose ? 0.065 : 0.04);
        this.sound.ringShake?.(Boolean(strike.ringLoose));
        const ringLeft = Math.max(1, this.debris.ringCutsNeeded - (strike.ringCuts || 0));
        this.toast(
          strike.ringLoose
            ? 'RING LOOSE — the shake ring springs free. A clean centre bite will split the freed heart.'
            : `Loose ring cut — the pale arc has shifted. ${ringLeft} more arc cut${ringLeft === 1 ? '' : 's'} to spring it.`,
          'gold',
        );
      }
      if (strike.corePunch) {
        this.debris.spawnSparks(impactPoint, 26, 1.15);
        this.debris.biteBurst(impactPoint, 1.45);
        this.shake = Math.max(this.shake, 0.09);
        this.hitStop = Math.max(this.hitStop, 0.055);
        this.sound.corePunch?.();
        this.toast(
          'CORE PUNCH — the bound heart cracks. One arc cut springs the ring. Edge +0.12 wear.',
          'gold',
        );
      }
      if (crossedGrain) {
        this.shake = Math.max(this.shake, 0.035);
        this.sound.surfaceShift?.(false);
        this.toast('Crossed the grain — the bit dragged and the golden check moved.', 'bad');
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
    if (physicsHit.iceBroken) {
      this.debris.spawnSparks(impactPoint, 10, 0.6);
      this.toast('ICE SHELL SHATTERED — the glaze is off; the grain underneath is exposed.', 'gold');
      this.sound.surfaceShift?.(true);
    }
    if (physicsHit.stringy) {
      this.shake = Math.max(this.shake, 0.03);
      this.toast('The interlocked fibres hold — the bit stuck instead of opening the split.', 'bad');
      this.sound.tick?.(0.4);
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
    // The Iron Crown is a three-section structure. Every third landed strike
    // releases one stone-bound section, with its own burst and readout.
    if (this.displaySpecies?.finalBoss && this.debris) {
      const required = Math.max(1, this.debris.strikesRequired || 9);
      const done = this.debris.strikesDone || 0;
      const sections = clamp(Math.floor((done / required) * 3), 0, 3);
      if (sections > (this.lastCrownSections || 0)) {
        this.lastCrownSections = sections;
        this.shake = Math.max(this.shake, 0.085);
        this.hitStop = Math.max(this.hitStop, 0.07);
        this.debris.spawnSparks(impactPoint, 30, 1.4);
        this.debris.biteBurst(impactPoint, 1.5);
        this.sound.collapse?.();
        this.toast(
          sections >= 3
            ? 'THE IRON CROWN IS DOWN — three stone-bound sections released. The yard is yours.'
            : `IRON CROWN · section ${sections}/3 released. ${3 - sections} stone-bound section${
                3 - sections === 1 ? '' : 's'
              } still holding.`,
          'gold',
        );
      }
    }

    const contractLogIndex = this.game.run.splits;
    const coopDeferXpCoins = Boolean(this.coop?.inSession?.());
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
      sharpLoss: Number(physicsHit.sharpLoss || 0),
      fractureOutcome: physicsHit.outcome,
      crackWork: Number(physicsHit.work || 0),
      energyDelivered: Number(physicsHit.delivered || 0),
      energyRequired: Number(physicsHit.required || 0),
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
      crossedGrain: Boolean(strike.crossedGrain),
      rivingStreak: Number(strike.rivingStreak || 0),
      ringCut: Boolean(strike.ringCut),
      ringCuts: Number(strike.ringCuts || 0),
      ringLoose: Boolean(strike.ringLoose),
      ringBound: Boolean(strike.ringBound),
      corePunch: Boolean(strike.corePunch),
      corePunchGain: Number(strike.corePunchGain || 0),
      coreCracked: Boolean(strike.coreCracked),
      ringCutsNeeded: Number(strike.ringCutsNeeded || 2),
    }, { deferXpCoins: coopDeferXpCoins });

    // Co-op: route the split's XP/coins through the session so the partner
    // receives 50%; the actor's full amount comes back through onAward.
    if (coopDeferXpCoins && (lastHit.xp || lastHit.coins)) {
      this.coop.session.award({
        xp: lastHit.xp,
        gold: lastHit.coins,
        loot: 0,
        reason: 'split',
      });
    }

    // Co-op: a completed split claims a shared log from the host. First claim
    // wins; the loser gets the module's onDenied toast and the log disappears.
    if (this.coop?.inSession?.() && !lastHit.partial) {
      this.yard?.claimCoopLogSplit?.(lastHit.logId || this.game.species?.id || 'pine');
    }

    // Contracts grade the resolved strike without changing the swing loop.
    if (this.contract) {
      const outcome = this.contract.recordStrike({
        clean: lastHit.clean,
        partial: lastHit.partial,
        glancing: lastHit.glancing,
        hazardHit: lastHit.hazardHit,
        aimX: lastHit.aimX,
        aimZ: lastHit.aimZ,
        grain: lastHit.grain,
        power: lastHit.power,
        cleanSplits: lastHit.clean,
        logIndex: contractLogIndex,
      });
      if (outcome.points) {
        this.game.state.score += outcome.points;
        this.game.run.score += outcome.points;
        this.game.state.totalScore += outcome.points;
        lastHit.points += outcome.points;
        lastHit.contractPoints = outcome.points;
        this.game.save();
      }
      if (outcome.grade) lastHit.contractGrade = outcome.grade;
      if (this.contract.finished) {
        clearTimeout(this.contractFinishTimer);
        this.contractFinishTimer = setTimeout(() => {
          if (this.contract?.finished && this.game.run.active) this.finishRun('contract');
        }, 700);
      }
    }

    const weatherName = this.weather ? this.weather.weather : 'clear';
    const soundPan = clamp(aim.x / Math.max(0.2, Number(this.debris?.radius) || 0.35), -0.65, 0.65);
    this.sound.impact(0.35 + state.power * 0.85, measuredSpeed / 14, weatherName, {
      wood: this.displaySpecies?.id,
      hazard: hazard?.type || null,
      hollow: Boolean(hollow),
      boss: this.bossRound,
      glance: glancing,
      stuck: partial && !glancing && !wedgeHit,
      pan: soundPan,
    });
    if (precisionMiss) this.sound.miss?.(0.85);
    if (seamWasSealed && this.debris.seamOpen) {
      this.toast('The sound rings crack — the heartwood seam is exposed. Strike the glowing band.', 'gold');
      this.sound.chime?.(0.85);
    }
    if (state.perfect) this.sound.chime(0.45);
    const juice = juiceFor({
      perfect: state.perfect,
      grainLock: Boolean(strike.grainLock),
      corePunch: Boolean(strike.corePunch),
      glancing,
      hazardHit: Boolean(hazardHit),
      boss: this.bossRound,
      partial,
      power: state.power,
    });
    this.hitStop = Math.max(this.hitStop, juice.hitStop);
    this.perfectSlow = juice.slowMo;
    this.shake = Math.max(this.shake, juice.shake);
    this.showHitFeedback(lastHit, plan);
    this.spawnImpactFlash(state.perfect);

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
      energyDelivered: Number((physicsHit.delivered || 0).toFixed(1)),
      energyRequired: Number((physicsHit.required || 0).toFixed(1)),
      energyRatio: Number((physicsHit.ratio || 0).toFixed(3)),
      crackWork: Number((physicsHit.work || 0).toFixed(3)),
      bladeDepth: Number((physicsHit.penetration || 0).toFixed(4)),
      swingJoules: Number((swingModel.eEffective || 0).toFixed(1)),
      headSpeed: Number((swingModel.vHead || 0).toFixed(2)),
      headMass: Number((swingModel.headMass || 0).toFixed(2)),
      fractureOutcome: physicsHit.outcome || 'stuck',
      glanceRisk: Number((physicsHit.glanceRisk || 0).toFixed(3)),
      iceBroken: Boolean(physicsHit.iceBroken),
      stringy: Boolean(physicsHit.stringy),
      rootBroken: Boolean(physicsHit.rootBroken),
      energyFactors: physicsHit.factors || null,
      grainTwist: Number((physicsHit.twistAngle || 0).toFixed(3)),
      sharpLoss: Number((physicsHit.sharpLoss || 0).toFixed(3)),
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
      crossedGrain: Boolean(strike.crossedGrain),
      rivingStreak: Number(strike.rivingStreak || 0),
      ringCut: Boolean(strike.ringCut),
      ringCuts: Number(strike.ringCuts || 0),
      ringLoose: Boolean(strike.ringLoose),
      ringBound: Boolean(strike.ringBound),
      corePunch: Boolean(strike.corePunch),
      corePunchGain: Number(strike.corePunchGain || 0),
      coreCracked: Boolean(strike.coreCracked),
      ringCutsNeeded: Number(this.debris.ringCutsNeeded || 2),
      ringShellPieces: result ? result.ringShellPieces || 0 : 0,
      ringShellSurface: result ? result.ringShellSurface || null : null,
      corePlugDropped: Boolean(result?.corePlugDropped),
      mainPieces: result ? result.mainPieces : 0,
      joules: Number(impactJoules.toFixed(0)),
      headMassKg: Number(headMassKg.toFixed(2)),
      bladeAngle: Number(((this.bladeOffset * 180) / Math.PI).toFixed(1)),
      bladeAlignment: Number(bladeAlignment.toFixed(3)),
      grainAlignment: Number(grain.toFixed(3)),
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

  spawnImpactFlash(perfect = false) {
    if (!ui.hitFlash) return;
    ui.hitFlash.classList.toggle('perfect', Boolean(perfect));
    ui.hitFlash.classList.add('on');
    clearTimeout(this.impactFlashTimer);
    this.impactFlashTimer = setTimeout(() => {
      ui.hitFlash?.classList.remove('on');
      ui.hitFlash?.classList.remove('perfect');
    }, 140);
  }

  showHitFeedback(lastHit, plan) {
    if (!lastHit) return;
    const glancing = lastHit.glancing || !lastHit.clean;
    let head = 'CLEAN SPLIT';
    if (lastHit.quality === 'MISS') head = 'MISSED THE ROUND';
    else if (lastHit.undercut) head = 'ROOT UNDERCUT';
    else if (lastHit.corePunch) head = 'CORE PUNCH';
    else if (lastHit.hollowCollapse) head = 'HOLLOW CORE COLLAPSE';
    else if (lastHit.hollowRimTear) head = 'ROTTEN RIM TEAR';
    else if (lastHit.wedgeHomed) head = 'WEDGE DRIVEN HOME';
    else if (lastHit.wedgeHit) head = lastHit.wedgeBounced ? 'WEDGE BOUNCE' : 'WEDGE STRIKE';
    else if (lastHit.weakHit) head = lastHit.partial ? 'HEARTWOOD BITE' : 'BOSS SPLIT';
    else if (lastHit.grainLock) head = 'GRAIN LOCK';
    else if (lastHit.riving) head = 'RIVING CUT';
    else if (lastHit.partial) head = lastHit.glancing ? 'GLANCING BLOW' : 'AXE STUCK — KEEP GOING';
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
      const phys = this.physics?.snapshot?.();
      const remainingJ = phys ? Math.max(0, Math.round(phys.required * (1 - phys.work))) : 0;
      details.push(`${remainingJ} J of crack work still needed`);
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
    if (lastHit.ringCut) {
      details.push(
        lastHit.ringLoose
          ? 'loose ring sprung · the heart is freed'
          : `loose ring ${lastHit.ringCuts || 1}/2 · the arc moved`,
      );
    }
    if (lastHit.corePunch) {
      details.push('the bound core cracked · one arc cut springs the ring');
    } else if (lastHit.ringBound) {
      details.push(
        lastHit.coreCracked
          ? 'the cracked core still catches the bit · cut the arc'
          : 'bound heart · the bit jammed in the core',
      );
    }
    if (lastHit.crossedGrain) details.push('crossed the grain · the check moves');
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
            : lastHit.ringCut
              ? 'clean'
              : lastHit.perfect && !glancing
                ? 'perfect'
                : glancing
                ? 'glancing'
                : lastHit.partial
                  ? 'bite'
                : lastHit.combo >= 3
                  ? 'streak'
                  : 'clean',
    });
    if (lastHit.undercut) {
      this.sound.rootCut?.(lastHit.rootUnstable ? 1.1 : 0.8);
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
    } else if (
      lastHit.grainLock ||
      lastHit.riving ||
      lastHit.ringCut ||
      lastHit.corePunch ||
      lastHit.crossedGrain
    ) {
      // The rive / ring / core / crossed-grain toast already fired; keep the
      // generic "solid bite" line from talking over it.
      this.environment?.updateShadow?.();
    } else if (lastHit.partial && !glancing) {
      const phys = this.physics?.snapshot?.();
      const remainingJ = phys ? Math.max(0, Math.round(phys.required * (1 - phys.work))) : 0;
      this.toast(`Axe stuck — ${remainingJ} J of crack work still needed.`, 'gold');
      this.environment?.updateShadow?.();
    } else if (lastHit.ringBound) {
      this.toast('Bound heart — the core is still held by the loose ring. Strike the pale arc.', 'bad');
      this.environment?.updateShadow?.();
    } else if (glancing) {
      this.toast('Off-centre — the grain deflected the bit. Combo lost.', 'bad');
      this.environment?.updateShadow?.();
    } else if (lastHit.boss) {
      this.sound.chime?.(1.2);
      if (lastHit.campaignChapter) {
        const chapter = campaignChapter(lastHit.campaignChapter);
        const nextChapter =
          lastHit.campaignChapter < 6 ? campaignChapter(lastHit.campaignChapter + 1) : null;
        this.toast(
          nextChapter
            ? `Chapter ${chapter.index} complete — ${chapter.bossName} down. Chapter ${nextChapter.index}: ${nextChapter.name} — ${nextChapter.idea}`
            : `The Iron Crown falls. Chapter ${chapter.index} complete — the yard is yours.`,
          'gold',
        );
      } else {
        this.toast(`Boss down — bonus coins and XP. Chapter ${chapterFor(this.game.state.cleanSplits).index} waiting.`, 'gold');
      }
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
    if (this.yard?.mode === 'yard') {
      this.reticle.visible = false;
      if (this.precisionGuide) this.precisionGuide.group.visible = false;
      if (this.grainGuide) this.grainGuide.group.visible = false;
      return;
    }
    const active = !this.debris.active;
    this.reticle.visible = active;
    if (this.precisionGuide) {
      const precision = this.game.run.active && this.game.run.mode === 'precision';
      this.precisionGuide.group.visible = active && precision;
      if (active && precision) {
        this.precisionGuide.group.position.set(0, this.debris.topY + 0.022, -0.95);
      }
    }
    if (active) this.buildGrainGuide();
    else if (this.grainGuide) this.grainGuide.group.visible = false;
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
    const grain = this.effectiveGrainAt(x, z);
    const wedge = this.debris.wedgeAt(this.aim.x, this.aim.z);
    const root = this.debris.rootAt?.(this.aim.x, this.aim.z) || null;
    const ring = this.debris.ringAt?.(this.aim.x, this.aim.z) || null;
    const bound = this.debris.boundAt?.(this.aim.x, this.aim.z) || null;
    const hazard = this.debris.hazardAt?.(x, z) || null;
    const precisionRun = this.game.run.active && this.game.run.mode === 'precision';
    const check = precisionRun ? null : this.debris.masterCheckAt?.(this.aim.x, this.aim.z) || null;
    const weak = this.bossRound ? this.debris.weakAt(x, z) : null;
    const sealed = this.bossRound && !this.debris.seamOpen;
    const grade = grain * 0.55 + center * 0.45;
    const color = hazard
      ? 0xe08a2f
      : wedge
      ? 0xa9c6cf
      : root
        ? 0xe0a15c
        : ring
          ? 0xbdeee0
          : bound
            ? this.debris.coreCracked
              ? 0xd97d64
              : 0x9fe8d8
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
    const grain = this.effectiveGrainAt(this.aim.x, this.aim.z);
    const knot = this.debris.knotAt(this.aim.x, this.aim.z);
    const hollow = this.debris.hollowAt(this.aim.x, this.aim.z);
    const wedge = this.debris.wedgeAt(this.aim.x, this.aim.z);
    const root = this.debris.rootAt?.(this.aim.x, this.aim.z) || null;
    const ring = this.debris.ringAt?.(this.aim.x, this.aim.z) || null;
    const bound = this.debris.boundAt?.(this.aim.x, this.aim.z) || null;
    const hazard = this.debris.hazardAt?.(this.aim.x, this.aim.z) || null;
    const coreArmed = Boolean(bound) && !this.debris.coreCracked;
    const coreReady = coreArmed && this.charge.active && this.charge.value >= 0.9;
    const precisionRun = this.game.run.active && this.game.run.mode === 'precision';
    const check = precisionRun ? null : this.debris.masterCheckAt?.(this.aim.x, this.aim.z) || null;
    const weak = this.bossRound ? this.debris.weakAt(this.aim.x, this.aim.z) : null;
    const seamSealed =
      this.bossRound && Boolean(this.debris.log?.bossSeamSealed) && !this.debris.seamOpen;
    let label;
    let miss = false;
    if (this.debris.active) label = 'Round split · next log on the block';
    else if (precisionRun) {
      const contractTarget =
        this.contract?.kind === 'precision6' ? this.contract.targetFor(this.game.run.splits) : null;
      if (contractTarget) {
        // Precision Six is a graded target, so the player sees the same
        // 55/30/15 score the strike will receive before committing.
        const currentPower = this.charge.active ? 0.26 + this.charge.value * 0.74 : null;
        const predicted = precisionGrade(
          {
            aimX: this.aim.x,
            aimZ: this.aim.z,
            grain,
            power: currentPower ?? contractTarget.power / 100,
          },
          contractTarget,
        );
        const distance = predicted.distance == null ? '—' : `${(predicted.distance * 100).toFixed(1)} cm`;
        label = predicted.bullseye
          ? `PRECISION SIX · BULLSEYE · ${distance} · ${contractTarget.power}% power`
          : `PRECISION SIX · ${predicted.quality}% · ${distance} · target ${contractTarget.power}%${
              currentPower == null ? '' : ` · you ${Math.round(currentPower * 100)}%`
            }`;
        miss = predicted.quality < 25;
      } else if (knot) {
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
    } else if (hazard) {
      const kind = hazard.hazard?.type === 'stone' ? 'stone' : 'steel';
      label = `HAZARD · ${kind} in the grain · aim around it · edge at risk`;
      miss = true;
    } else if (wedge) {
      label = `WEDGE · strike to drive it home · ${Math.round(wedge.slot.depth * 100)}% set`;
    } else if (ring) {
      const need = this.debris.ringCutsNeeded || 2;
      const weatherRead = this.debris.surfaceFrozen
        ? ' · frost-widened arc'
        : this.debris.surfaceWet
          ? ' · rain-slick narrow arc'
          : '';
      label = `LOOSE RING · strike the pale arc · ${this.debris.ringShakeCuts || 0}/${need} cut${need === 1 ? '' : 's'} · it moves${weatherRead}`;
    } else if (bound) {
      label = coreArmed
        ? 'CORE PUNCH · overcharge the top mint band · +0.5 bite · edge +0.12'
        : 'CRACKED CORE · the bit still catches · cut the pale arc';
      miss = coreArmed;
    } else if (root) {
      label = `ROOT NOTCH · undercut to crack the root ring · ${this.debris.rootsCut || 0}/3 cut`;
    } else if (hollow) {
      label = 'Rotten heart · a centred strike collapses the core';
    } else if (weak) {
      label = `Heartwood seam · +${this.debris.bossPhase >= 2 ? '2' : '1'} bite · ${centerPercent}% centre`;
    } else if (seamSealed) {
      label = `Seam sealed · bite the rings to expose the heartwood`;
      miss = false;
    } else if (this.debris.ringShakeLoose) {
      label = `RING LOOSE · heart freed · clean centre bite springs the round · ${centerPercent}% centre`;
    } else if (check) {
      const d = this.debris;
      const sameLine =
        d.masterSeam != null &&
        d.lastRiveAngle != null &&
        Math.abs(((d.masterSeam - d.lastRiveAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.3;
      const locked = (d.rivingStreak || 0) > 0 && sameLine;
      label = locked
        ? 'GRAIN LOCK · same check again · +0.5 bite · clean halves'
        : (d.rivingStreak || 0) > 0
          ? 'RIVING CHECK · the check moved · new read · +0.24 bite'
          : 'RIVING CHECK · off-pith strike rides the grain · +0.24 bite';
    } else if (knot) label = `Knot in the line · ${centerPercent}% centre`;
    else if (this.debris.log?.twinPith && centerPercent > 80) {
      label = `Twin pith · ${centerPercent}% centre`;
    } else if (grain > 0.72 && centerPercent > 55) label = `On the grain · ${centerPercent}% centre`;
    else if (grain > 0.45) label = `Reading the grain · ${centerPercent}% centre`;
    else label = `Across the grain · ${centerPercent}% centre`;
    const bladeDegrees = Math.round((this.bladeOffset * 180) / Math.PI);
    if (Math.abs(bladeDegrees) >= 1 && !this.debris.active) {
      label += ` · blade ${bladeDegrees > 0 ? '+' : ''}${bladeDegrees}°`;
    }
    ui.aimReadout.textContent = label;
    ui.aimChip.classList.toggle(
      'perfect',
      !this.debris.active &&
        !seamSealed &&
        (coreReady ||
          Boolean(weak) ||
          Boolean(hollow) ||
          Boolean(check) ||
          Boolean(ring) ||
          this.debris.ringShakeLoose ||
          (precisionRun ? !miss : grain > 0.72 && centerPercent > 55)),
    );
    ui.aimChip.classList.toggle(
      'off',
      !this.debris.active &&
        (miss ||
          (!weak && !wedge && !root && !check && !ring && !bound && (centerPercent < 32 || grain < 0.25))),
    );
    ui.aimChip.classList.toggle('weak', !this.debris.active && Boolean(weak));
    ui.aimChip.classList.toggle('hazard', !this.debris.active && Boolean(hazard));
    ui.aimChip.classList.toggle('wedge', !this.debris.active && Boolean(wedge));
    ui.aimChip.classList.toggle('root', !this.debris.active && Boolean(root));
    ui.aimChip.classList.toggle('grain', !this.debris.active && Boolean(check));
    ui.aimChip.classList.toggle('ring', !this.debris.active && (Boolean(ring) || this.debris.ringShakeLoose));
    ui.aimChip.classList.toggle('core', !this.debris.active && coreArmed);
    if (ui.powerTrack) {
      ui.powerTrack.classList.toggle('core-armed', !this.debris.active && coreArmed);
      ui.powerTrack.classList.toggle('core-ready', coreReady);
    }
    this.coreWindowArmed = !this.debris.active && coreArmed;
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
    const coreArmed = Boolean(this.coreWindowArmed);
    const coreReady =
      coreArmed && this.charge.active && this.charge.value >= 0.9;
    ui.powerKnob.classList.toggle('core-ready', coreReady);
    if (ui.powerTrack) {
      ui.powerTrack.classList.toggle('core-armed', coreArmed);
      ui.powerTrack.classList.toggle('core-ready', coreReady);
    }
    if (ui.powerFill) ui.powerFill.style.width = `${scale}%`;
    if (ui.forceValue) ui.forceValue.textContent = String(Math.round(scale));
    if (ui.controlDeck) ui.controlDeck.classList.toggle('charging', this.charge.active);
    ui.swingButton?.classList.toggle('charging', this.charge.active);
    if (ui.powerLabel) {
      ui.powerLabel.textContent = coreReady
        ? 'Core punch'
        : this.charge.active
          ? 'Timing the swing'
          : coreArmed
            ? 'Overcharge the mint band'
            : 'Swing power';
    }
    if (ui.timingReadout) {
      if (this.charge.active) {
        if (coreArmed) {
          ui.timingReadout.textContent = coreReady
            ? 'CORE PUNCH — release now · edge +0.12'
            : 'Push into the mint band · core punch';
        } else {
          const dist = Math.abs(this.charge.value - 0.745);
          ui.timingReadout.textContent = dist < 0.042 ? 'PERFECT — release now' : 'Release in the green band';
        }
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
    // Called ~11 times a second while chopping: read the three live fields
    // instead of building a full save-shaped snapshot on every tick.
    const stamina = this.game.state.stamina;
    const maxStamina = this.game.maxStamina;
    const staminaCost = this.game.staminaCost;
    const staminaLabel = `${Math.round(stamina)} / ${maxStamina}`;
    if (ui.staminaText && ui.staminaText.textContent !== staminaLabel) {
      ui.staminaText.textContent = staminaLabel;
    }
    if (ui.staminaBar) {
      const pct = clamp(stamina / Math.max(1, maxStamina), 0, 1) * 100;
      ui.staminaBar.style.width = `${pct}%`;
      ui.staminaBar.classList.toggle('low', pct < 26);
      ui.staminaBar.classList.toggle('winded', pct < 8);
    }
    const costLabel = `${staminaCost.toFixed(1)} / swing`;
    if (ui.costChip && ui.costChip.textContent !== costLabel) ui.costChip.textContent = costLabel;
    this.updateTelemetryUi();
  }

  /** Live edge speed / impact energy / grain / fracture readout. */
  updateTelemetryUi() {
    if (!this.debris) return;
    const chargeValue = this.charge.active ? this.charge.value : 0;
    const last = this.lastImpact;
    const speed = this.sim.active
      ? Math.max(0, this.headSpeed || 0)
      : this.charge.active
        ? 6.5 + chargeValue * 13.5
        : last?.speed || 0;
    const headMass = 2.4 * this.game.headWeight;
    const joules = 0.5 * headMass * speed * speed;
    const grain = this.effectiveGrainAt(this.aim.x, this.aim.z) * 100;
    const phys = this.physics?.snapshot?.() || null;
    const requiredJ = Math.max(1, phys?.required || baseRequiredEnergy(this.displaySpecies || {}));
    const work = clamp(phys?.work || 0, 0, 1);
    const remainingJ = Math.max(0, Math.round(requiredJ * (1 - work)));
    const cracked = Math.round(work * 100);
    const crownTotal = this.displaySpecies?.finalBoss ? this.displaySpecies.crownSections || 3 : 0;
    const crownReleased = crownTotal ? this.crown?.released || 0 : 0;
    let fracture = 'Ready';
    if (this.debris.active || phys?.split) fracture = `Split · ${Math.round(requiredJ)} J`;
    else if (crownTotal) {
      fracture = `Crown ${Math.max(0, crownTotal - crownReleased)}/${crownTotal} standing · ${remainingJ} J left`;
    } else if (this.debris.coreCracked) fracture = `Core cracked · 1 arc cut · ${remainingJ} J left`;
    else if (this.debris.ringShakeLoose) fracture = `Ring loose · spring the heart · ${remainingJ} J`;
    else if (this.bossRound) {
      fracture = `Seam ${this.debris.seamOpen ? 'open' : 'sealed'} · ${remainingJ} J left`;
    } else if (this.debris.hollowCollapsed) fracture = 'Hollow collapsed · shell holding';
    else if (cracked > 0) fracture = `${remainingJ} J to split · ${cracked}% crack`;
    else fracture = `${remainingJ} J to split`;
    const bladeAngle = Math.round((this.bladeOffset * 180) / Math.PI);
    const alignment = this.bladeAlignmentAt(this.aim.x, this.aim.z) * 100;
    this.telemetry = {
      edgeSpeed: Number(speed.toFixed(2)),
      impactJoules: Number(joules.toFixed(0)),
      grainAlignment: Number(grain.toFixed(1)),
      bladeAlignment: Number(alignment.toFixed(1)),
      bladeAngle,
      fractureState: fracture,
      crownSections: crownTotal,
      crownSectionsReleased: crownReleased,
      lastJoules: last?.joules ?? null,
      lastSpeed: last?.speed ?? null,
      energyRequired: Number(requiredJ.toFixed(1)),
      energyRemaining: Number(remainingJ.toFixed(1)),
      energyDelivered: Number(phys?.delivered || 0),
      energyDeliveredTotal: Number(phys?.deliveredTotal || 0),
      crackWork: Number(work.toFixed(3)),
      bladeDepth: Number(phys?.penetration || 0),
    };
    // Only touch the DOM when the text really changed: setting textContent to
    // the same string still replaces the text node and dirties the HUD layer.
    const setText = (node, text) => {
      if (node && node.textContent !== text) node.textContent = text;
    };
    setText(ui.telemetrySpeed, `${speed.toFixed(1)} m/s`);
    if (ui.telemetryEnergy) {
      setText(ui.telemetryEnergy, `${Math.round(last && !this.sim.active ? last.joules : joules)} J`);
      ui.telemetryEnergy.classList.toggle('hot', joules >= 300);
      ui.telemetryEnergy.title = `Last blade hit delivered ${Math.round(
        phys?.delivered || 0,
      )} J against ${Math.round(requiredJ)} J required`;
    }
    if (ui.telemetryGrain) {
      setText(ui.telemetryGrain, `${Math.round(grain)}% grain · ${Math.round(alignment)}% edge`);
      ui.telemetryGrain.classList.toggle('hot', grain >= 72);
    }
    setText(ui.telemetryFracture, fracture);
    if (ui.telemetryBlade) {
      setText(
        ui.telemetryBlade,
        `Blade ${bladeAngle > 0 ? '+' : ''}${bladeAngle}° · Q/Z turn${
          bladeAngle === 0 ? '' : ' · Shift+Q camera'
        } · E yard`,
      );
    }
    this.grainReader?.update({
      debris: this.debris,
      aim: this.aim,
      bladeOffset: this.bladeOffset,
      knots: this.currentKnots,
      hazards: this.currentHazards,
      target:
        this.contract?.kind === 'precision6'
          ? this.contract.targetFor(this.game.run.splits)
          : null,
    });
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
    const campaignMeta = this.game.campaignMeta;
    const chapter = campaignMeta
      ? { index: campaignMeta.chapter, name: campaignMeta.chapterName }
      : chapterFor(this.game.state.cleanSplits);
    const run = this.game.run;
    const mode = run.active ? modeFor(run.mode) : null;
    const runTarget = run.active && run.target > 0 ? run.target : mode?.target || 0;
    if (ui.logCard) ui.logCard.classList.toggle('boss', boss);
    if (ui.logName) ui.logName.textContent = boss ? `☠ ${species.name}` : species.name;
    if (ui.logBlurb) ui.logBlurb.textContent = species.blurb;
    if (ui.logTier) {
      if (mode) {
        if (mode.campaign && campaignMeta) {
          ui.logTier.textContent = `Ch. ${campaignMeta.chapter}/6 · ${campaignMeta.chapterName} · ${
            boss ? 'BOSS' : `round ${campaignMeta.roundInChapter}/3`
          }${campaignMeta.finalBoss ? ' · IRON CROWN' : ''}`;
        } else if (mode.stumpTrial) {
          ui.logTier.textContent = `★ IRON STUMP TRIAL · round ${run.splits + 1}/${mode.target} · loaner maul`;
        } else if (mode.id === 'trial') {
          ui.logTier.textContent = `★ COLOSSUS TRIAL · round ${run.splits + 1}/${mode.target} · loaner maul`;
        } else {
          ui.logTier.textContent = boss
            ? `★ BOSS · ${mode.name} · round ${run.splits + 1}${runTarget ? `/${runTarget}` : ''}`
            : `${mode.name} · round ${run.splits + 1}${runTarget ? `/${runTarget}` : ''}`;
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
          : species.ringShake
            ? this.debris?.ringShakeLoose
              ? 'Ring loose · split the freed heart'
              : this.debris?.coreCracked
                ? `Core cracked · one arc cut springs it (${this.debris?.ringShakeCuts || 0}/1)`
                : `Loose ring · strike the pale arc (${this.debris?.ringShakeCuts || 0}/2)`
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
      if (mode?.campaign && campaignMeta) {
        const left = Math.max(0, runTarget - run.splits);
        ui.logNext.textContent = campaignMeta.finalBoss
          ? `Final boss · ${left} round${left === 1 ? '' : 's'} to the crown`
          : `${campaignMeta.chapterIdea} · ${left} round${left === 1 ? '' : 's'} left`;
      } else if (runTarget) {
        const left = Math.max(0, runTarget - run.splits);
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
      const physics = this.physics?.snapshot?.() || null;
      const work = clamp(physics?.work || 0, 0, 1);
      const split = Boolean(this.debris?.active || physics?.split);
      const neededJ = physics?.required || baseRequiredEnergy(species);
      const remainingJ = Math.max(0, neededJ * (1 - work));
      // The bar tracks accumulated crack work, so show accumulated joules too;
      // the title keeps the last strike's reading for feedback.
      const deliveredJ = physics?.deliveredTotal || physics?.delivered || 0;
      const lastJ = physics?.delivered || 0;
      const ratio = split ? 1 : clamp(1 - work, 0, 1);
      ui.roundHealth.classList.toggle('boss', boss);
      ui.roundHealth.classList.toggle('wedged', (this.debris?.wedges || 0) > 0);
      if (boss && species.finalBoss) {
        const total = species.crownSections || 3;
        const released = this.crown?.released ?? clamp(Math.floor(work * total), 0, total);
        ui.roundHealthLabel.textContent = `Iron Crown · ${released}/${total} sections down`;
      } else {
        ui.roundHealthLabel.textContent = boss ? 'Boss fracture energy' : 'Fracture energy';
      }
      ui.roundHealthValue.textContent = split
        ? `SPLIT · ${Math.round(neededJ)} J`
        : `${Math.round(deliveredJ)} / ${Math.round(neededJ)} J`;
      ui.roundHealth.title = physics
        ? split
          ? `${Math.round(neededJ)} J fracture energy met — the round is breaking.`
          : `${Math.round(work * 100)}% crack work · last strike ${Math.round(
              lastJ,
            )} J · ${Math.round(remainingJ)} J still needed · ${physics.outcome} · ${Math.round(
              physics.penetration * 1000,
            )} mm penetration`
        : 'Fracture energy';
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
        const physNow = this.physics?.snapshot?.();
        const leftJ = physNow
          ? Math.max(0, Math.round(physNow.required * (1 - physNow.work)))
          : 0;
        const maul = this.game.axe.id === 'maul';
        ui.wedgeButton.textContent = check.ok
          ? `Drive wedge${maul ? ' (maul)' : ''} · ${leftJ} J left`
          : d.wedges >= d.maxWedges
            ? 'Kerf fully wedged · aim at a wedge to seat it'
            : check.reason;
        ui.wedgeButton.title = check.ok
          ? 'Drive a steel wedge into the open check. Costs wind, but widens the kerf for the next blow. Then aim the axe at the wedge and swing to drive it home.'
          : check.reason;
      }
      if (ui.pullWedgeButton) {
        const pull = d?.canPullWedge?.() || { ok: false };
        ui.pullWedgeButton.hidden = !show || !pull.ok;
        if (!ui.pullWedgeButton.hidden) {
          const depth = clamp(Number(pull.slot?.depth) || 0, 0, 1);
          const grip = 0.55 + depth * 1.25 + (pull.slot?.homed ? 0.35 : 0);
          const cost = Math.max(3.5, this.game.staminaCost * (0.18 + grip * 0.24)) *
            (this.game.axe.id === 'maul' ? 0.8 : 1);
          ui.pullWedgeButton.disabled = this.game.state.stamina < cost;
          ui.pullWedgeButton.textContent = `Pull wedge · ${cost.toFixed(1)} wind · depth ${Math.round(
            depth * 100,
          )}%`;
          ui.pullWedgeButton.title =
            'Pull the most recently seated wedge back out (Shift+F). A home wedge grips harder and closes the kerf a little.';
        }
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

  /** Weather as felt by the fracture model: live surface, not the forecast. */
  physicsConditions() {
    const d = this.debris;
    const mods = this.weather?.getModifiers?.() || {};
    const snow = d?.snowLoad || 0;
    const wet = Math.max(d?.wetness || 0, mods.wetness || 0);
    const frozen = d?.surfaceFrozen || mods.frozen ? 1 : 0;
    return {
      wet: clamp(wet, 0, 1),
      frozen: clamp(frozen, 0, 1),
      icy: snow > 0.45 ? clamp(snow, 0, 1) : 0,
      iceShell: snow > 0.45,
    };
  }

  updateAtmosphereUi() {
    if (!this.weather) return;
    const time = this.weather.timeLabel;
    const weatherId = this.weather.weather;
    const weather = this.weather.weatherLabel;
    // One-shots on an actual change, not on the 2 Hz UI refresh. The context
    // only exists after a gesture, so this can never unlock audio by itself.
    if (this._lastAtmosphere && this.sound.ctx?.state === 'running') {
      if (weatherId !== this._lastAtmosphere.weather) {
        this.sound.weatherChange?.(weatherId);
      } else if (time !== this._lastAtmosphere.time) {
        this.sound.timeShift?.(time);
      }
    }
    this._lastAtmosphere = { weather: weatherId, time };
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
    this.updateAudioSettingsUi();
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
    this.applyPixelRatio();
  }

  updateAdaptiveResolution() {
    if (!this.ready || !this.qualityManager.auto) return;
    const now = performance.now();
    // Software starts at its floor (see perftune.js) and stays pinned there:
    // no auto-upgrade that could stall the exact frame the operator samples.
    // Hardware keeps its gentle ramp. SwiftShader is fill-rate bound, so if a
    // preset change or resize leaves it above the floor, react in under a
    // second and jump straight there instead of wasting slow samples.
    const software = Boolean(this.qualityManager.rendererInfo.software);
    if (now - this.lastAdaptiveChange < (software ? 800 : 1200)) return;
    const lowThreshold = software ? 24 : 22;
    if (this.fps > 0 && this.fps < lowThreshold) this.adaptiveLow += software ? 1.6 : 1;
    else this.adaptiveLow = Math.max(0, this.adaptiveLow - 0.5);
    if (this.fps > 44) this.adaptiveHigh += 1;
    else this.adaptiveHigh = 0;
    const presetFloor = this.qualityPreset?.minScale ?? 0.55;
    const scaleFloor = Math.min(softwareRenderFloor(this), presetFloor);
    const lowNeeded = software ? 1.5 : 2;
    if (this.adaptiveLow >= lowNeeded && this.renderScale > scaleFloor) {
      // A backbuffer reallocation stalls a SwiftShader frame for tens of
      // milliseconds, so walking down in 0.07 steps pays that stall four or
      // five times. Software builds jump straight to their floor; hardware
      // keeps the gentle ramp.
      const step = software ? this.renderScale - scaleFloor : 0.07;
      this.renderScale = Math.max(scaleFloor, this.renderScale - step);
      this.lastAdaptiveChange = now;
      this.adaptiveLow = 0;
      this.applyPixelRatio();
      if (!this.adaptiveNotified) {
        this.adaptiveNotified = true;
        this.toast('Adaptive resolution engaged for smoother play', 'gold');
      }
      this.updateAtmosphereUi();
    } else if (!software && this.adaptiveHigh >= 8 && this.renderScale < 1) {
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
    if (!Number.isFinite(raw)) raw = 88;
    if (raw > 1) raw /= 100;
    const power = clamp(raw, 0.2, 1);
    // A deterministic, centred, in-the-sweet-spot swing for automation.
    const radius = this.debris.radius;
    const pith = this.debris.piths?.[0] || { x: 0, z: 0 };
    let autoAim = { x: pith.x + radius * 0.035, z: pith.z + radius * 0.01 };
    // Bosses are their own target: aim at the exposed seam when it is live.
    if (this.bossRound && this.debris.seamOpen) {
      const weak = this.debris.weakPointPosition?.();
      if (weak) autoAim = { x: weak.x, z: weak.z };
    }
    // If the default line lands on a knot or embedded steel, fan out around the
    // pith and take the cleanest grain. The hook promises a *good* swing.
    if (this.debris.knotAt(autoAim.x, autoAim.z) || this.debris.hazardAt(autoAim.x, autoAim.z)) {
      let best = null;
      let bestScore = -Infinity;
      for (let i = 0; i < 12; i += 1) {
        const angle = (i / 12) * Math.PI * 2;
        const ring = radius * (0.055 + (i % 3) * 0.035);
        const x = pith.x + Math.cos(angle) * ring;
        const z = pith.z + Math.sin(angle) * ring;
        if (this.debris.knotAt(x, z) || this.debris.hazardAt(x, z)) continue;
        const score = this.debris.centerAt(x, z) * 0.55 + this.debris.grainAt(x, z) * 0.45;
        if (score > bestScore) {
          bestScore = score;
          best = { x, z };
        }
      }
      if (best) autoAim = best;
    }
    this.aim = autoAim;
    // The automation hook is documented as a "good swing": line the blade up
    // with the local check the same way a careful mouse player would.
    const radial = Math.atan2(this.aim.z, this.aim.x);
    const seam = this.debris.nearestSeamAngle(this.aim.x, this.aim.z);
    this.bladeOffset = clamp(seam - radial, -Math.PI / 3, Math.PI / 3);
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

  getPerfStats() {
    const count = this.frameSampleCount;
    const samples = Array.from(this.frameSamples.slice(0, count)).sort((a, b) => a - b);
    const avg = count ? samples.reduce((sum, value) => sum + value, 0) / count : 0;
    const p95 = count ? samples[Math.min(count - 1, Math.floor(count * 0.95))] : 0;
    const median = count ? samples[Math.floor((count - 1) * 0.5)] : 0;
    this.frameMsAvg = Number(avg.toFixed(2));
    this.frameMsP95 = Number(p95.toFixed(2));
    const info = this.renderer?.info;
    return {
      fps: this.fps,
      frameMsAvg: this.frameMsAvg,
      frameMsP95: this.frameMsP95,
      frameMsMedian: Number(median.toFixed(2)),
      frameMsMin: Number((count ? samples[0] : 0).toFixed(2)),
      samples: count,
      quality: this.qualityName,
      renderScale: Number(this.renderScale.toFixed(2)),
      pixelRatio: Number((this.renderer?.getPixelRatio?.() || 0).toFixed(3)),
      // A reallocation can be an 80 ms stall under SwiftShader, so expose the
      // count next to the frame-time window instead of hiding it in a profile.
      renderResizes: this.renderResizes || 0,
      drawCalls: info?.render?.calls || 0,
      triangles: info?.render?.triangles || 0,
      textures: info?.memory?.textures || 0,
      geometries: info?.memory?.geometries || 0,
      software: Boolean(this.qualityManager.rendererInfo.software),
      webgl: Boolean(this.webgl),
      fallback: !this.webgl,
      renderer: this.rendererReason || null,
      perfLite: Boolean(this.perfLite),
      reducedMotion: Boolean(this.reducedMotion),
      physicsBodies: this.world?.bodies?.len?.() || 0,
      hitStop: Number(this.hitStop.toFixed(3)),
      perfectSlow: Number(this.perfectSlow.toFixed(3)),
      shake: Number(this.shake.toFixed(3)),
    };
  }

  getGameState() {
    const snapshot = this.game.snapshot();
    if (this.debris) {
      snapshot.strikesRequired = this.debris.strikesRequired;
      snapshot.strikesDone = Number(this.debris.strikesDone.toFixed(2));
      snapshot.strikesLeft = Math.max(0, Math.ceil(this.debris.strikesLeft - 1e-6));
      snapshot.strikesLeftExact = Number(this.debris.strikesLeft.toFixed(2));
      const phys = this.physics?.snapshot?.();
      if (phys) {
        snapshot.energyRequired = Number(phys.required.toFixed(1));
        snapshot.energyDelivered = Number(phys.delivered.toFixed(1));
        snapshot.energyDeliveredTotal = Number(phys.deliveredTotal.toFixed(1));
        snapshot.energyRemaining = Number((phys.required * (1 - phys.work)).toFixed(1));
        snapshot.crackWork = Number(phys.work.toFixed(3));
        snapshot.fractureOutcome = phys.outcome;
        snapshot.energyRatio = Number(phys.ratio.toFixed(3));
        snapshot.energyGain = Number(phys.energyGain.toFixed(3));
        snapshot.bladeDepth = Number(phys.penetration.toFixed(4));
        snapshot.crackDepth = Number(phys.crackDepth.toFixed(4));
        snapshot.glanceRisk = Number(phys.glanceRisk.toFixed(3));
        snapshot.woodTraits = phys.traits;
        snapshot.energyFactors = phys.factors;
        snapshot.iceShell = Boolean(phys.iceShell);
        snapshot.iceBroken = Boolean(phys.iceBroken);
        snapshot.stringy = Boolean(phys.stringy);
        snapshot.sharpLoss = Number((phys.sharpLoss || 0).toFixed(3));
        snapshot.rootBroken = Boolean(phys.rootBroken);
        snapshot.bladeDir = phys.bladeDir;
        snapshot.grainTwist = Number((phys.twistAngle || 0).toFixed(3));
      }
      if (this.lastSwingModel) {
        snapshot.swing = {
          vHead: Number(this.lastSwingModel.vHead.toFixed(2)),
          headMass: Number(this.lastSwingModel.headMass.toFixed(2)),
          joules: Number(this.lastSwingModel.eEffective.toFixed(1)),
          effort: Number(this.lastSwingModel.effort.toFixed(3)),
        };
      }
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
      snapshot.masterCheckAngle = this.debris.masterSeam ?? null;
      snapshot.masterShiftCount = this.debris.masterShiftCount || 0;
      snapshot.ringShake = Boolean(this.debris.log?.ringShake);
      snapshot.ringCuts = this.debris.ringShakeCuts || 0;
      snapshot.ringLoose = Boolean(this.debris.ringShakeLoose);
      snapshot.ringAngle = this.debris.ringShakeAngle ?? null;
      snapshot.ringTarget = this.debris.ringAt?.(this.aim.x, this.aim.z) || null;
      snapshot.boundHeart = this.debris.boundAt?.(this.aim.x, this.aim.z) || null;
      snapshot.coreCracked = Boolean(this.debris.coreCracked);
      snapshot.ringCutsNeeded = this.debris.ringCutsNeeded || 2;
      snapshot.ringArcHalfWidth = Number((this.debris.ringArcHalfWidth || 0).toFixed(3));
      snapshot.ringVisualHalfWidth = Number((this.debris.ringVisualHalfWidth || 0).toFixed(3));
      snapshot.ringWeatherGain = Number((this.debris.ringWeatherGain || 0).toFixed(3));
      snapshot.ringShellPieces = this.debris.ringShellPieces || 0;
      snapshot.ringShellSurface = this.debris.lastRingShellSurface || null;
      snapshot.corePlugDropped = Boolean(this.debris.corePlugDropped);
      const boundNow = this.debris.boundAt?.(this.aim.x, this.aim.z) || null;
      const chargeNow = this.charge.active ? this.charge.value : 0;
      snapshot.corePunchWindow = {
        min: 0.9,
        armed: Boolean(boundNow) && !this.debris.coreCracked,
        ready: Boolean(boundNow) && !this.debris.coreCracked && chargeNow >= 0.9,
      };
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
      snapshot.wedgePull = this.debris.canPullWedge?.() || null;
      snapshot.wedgesPulled = this.game.state.wedgesPulled || 0;
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
    snapshot.weather = this.weather?.weather || 'clear';
    snapshot.weatherNote = this.currentWeatherNote();
    snapshot.weatherThawing = Boolean(this.debris?.thawing);
    snapshot.campaignGoal = CAMPAIGN_SPLITS;
    snapshot.runOverlayOpen = this.runOverlayOpen;
    snapshot.crownPhysicalBodies = this.crown?.physicalBodies || 0;
    snapshot.campaignChapterUnlocked = clamp(
      Math.round(Number(this.game.state.campaignChapter) || 1),
      1,
      Math.max(1, Number(this.game.state.campaignChapters) || 6),
    );
    snapshot.campaignChapters = Math.max(1, Number(this.game.state.campaignChapters) || 6);
    const campaignMeta = this.game.campaignMeta;
    if (campaignMeta) {
      snapshot.chapter = { index: campaignMeta.chapter, id: campaignMeta.chapterId, name: campaignMeta.chapterName };
      snapshot.campaignStartedAtRound = campaignMeta.round;
      snapshot.chapterIndex = campaignMeta.chapter;
      snapshot.chapterName = campaignMeta.chapterName;
      snapshot.campaignChapterIdea = campaignMeta.chapterIdea;
      snapshot.campaignRoundInChapter = campaignMeta.roundInChapter;
      snapshot.campaignFinalBoss = campaignMeta.finalBoss;
      snapshot.crownSections = campaignMeta.crownSections;
      snapshot.crownSectionsReleased = this.crown?.released || 0;
      snapshot.crownSectionsStanding = campaignMeta.finalBoss
        ? Math.max(0, (campaignMeta.crownSections || 3) - (this.crown?.released || 0))
        : 0;
      snapshot.crownPhysicalBodies = this.crown?.physicalBodies || 0;
    }
    if (!campaignMeta && this.displaySpecies?.finalBoss) {
      snapshot.crownSections = this.displaySpecies.crownSections || 3;
      snapshot.crownSectionsReleased = this.crown?.released || 0;
      snapshot.crownSectionsStanding = Math.max(0, snapshot.crownSections - snapshot.crownSectionsReleased);
      snapshot.crownPhysicalBodies = this.crown?.physicalBodies || 0;
    }
    snapshot.bladeAngle = Number(((this.bladeOffset * 180) / Math.PI).toFixed(1));
    snapshot.bladeOffset = Number(this.bladeOffset.toFixed(3));
    snapshot.bladeAlignment = Number(this.bladeAlignmentAt(this.aim.x, this.aim.z).toFixed(3));
    snapshot.telemetry = this.telemetry ? { ...this.telemetry } : null;
    snapshot.contract = this.contract ? this.contract.snapshot() : null;
    snapshot.lastContract = this.lastContract ? { ...this.lastContract } : null;
    snapshot.graphics = {
      quality: this.qualityName,
      webgl: Boolean(this.webgl),
      fallback: !this.webgl,
      renderer: this.rendererReason || this.qualityManager.rendererInfo.name,
      postfx: Boolean(this.postfxReady),
      bloom: Boolean(this.postfxReady && this.qualityPreset?.bloom),
      godrays: Boolean(this.postfx?.godrays?.enabled),
      godrayStrength: Number((this.weather?.getSunShaftStrength?.() ?? 0).toFixed(3)),
      shadowSize: this.qualityPreset?.shadowSize || 0,
      shadows: Boolean(this.qualityPreset?.shadows),
      contactShadows: Boolean(this.environment?.contactShadows?.visible),
      snowCaps: Boolean(this.environment?.snowCaps?.visible),
      leafLitter: Boolean(this.environment?.leafLitter),
      simpleSun: Boolean(this.environment?.simpleSunState),
      simpleSunStrength: Number((this.environment?.simpleSunState?.strength?.value ?? 0).toFixed(3)),
      pbrWood: Boolean(this.debris?.materials?.().grain),
      barkNormalMaps: Boolean(this.debris?.materials?.().bark?.normalMap),
      lanternPools: Boolean(this.environment?.lanterns?.[0]?.pool),
      dpr: Number(this.renderer.getPixelRatio().toFixed(3)),
      maxDpr: this.qualityPreset?.maxDpr || 0,
      exposure: Number((this.renderer.toneMappingExposure || 1).toFixed(2)),
      timeOfDay: this.weather?.timeLabel || null,
      sunShafts: Boolean(this.weather?.shafts?.visible),
      mood: this.postfx?.mood ? { ...this.postfx.mood } : null,
    };
    snapshot.audio = this.getAudioStats();
    snapshot.musicPlaying = snapshot.audio.musicPlaying;
    snapshot.musicVolume = snapshot.audio.musicVolume;
    snapshot.sfxVolume = snapshot.audio.sfxVolume;
    snapshot.activeVoices = snapshot.audio.activeVoices;
    snapshot.musicScene = snapshot.audio.musicScene;
    snapshot.musicBpm = snapshot.audio.musicBpm;
    snapshot.musicIntensity = snapshot.audio.musicIntensity;
    snapshot.musicBoss = snapshot.audio.musicBoss;
    snapshot.musicDucked = snapshot.audio.musicDucked;
    snapshot.ambientLevel = snapshot.audio.ambientLevel;
    snapshot.countdown = this._lastCountdown || null;
    // Live performance telemetry. getPerfStats() adds the p95/frame-time window,
    // draw calls and triangle count for the operator's profiling pass.
    snapshot.fps = this.fps;
    snapshot.quality = this.qualityName;
    snapshot.renderScale = Number(this.renderScale.toFixed(2));
    snapshot.drawCalls = this.renderer?.info?.render?.calls || 0;
    snapshot.triangles = this.renderer?.info?.render?.triangles || 0;
    snapshot.hitStop = Number(this.hitStop.toFixed(3));
    snapshot.perfectSlow = Number(this.perfectSlow.toFixed(3));
    snapshot.perfLite = Boolean(this.perfLite);
    snapshot.reducedMotion = Boolean(this.reducedMotion);
    snapshot.yard = this.yard ? this.yard.state() : null;
    snapshot.treesFelled = this.game?.state?.treesFelled || 0;
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
    // The first ~1.5 s after ready are still shader/texture uploads on a
    // software rasteriser. Drop those frames from the rolling HUD window once
    // they are over, so the loaded screenshot does not advertise a transient
    // 3 FPS as the steady-state reading.
    if (this.warmupUntil && now >= this.warmupUntil) {
      this.warmupUntil = 0;
      this.frameSampleCount = 0;
      this.frameSampleIndex = 0;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    const warmupFrame = this.warmupFrames < 1 || Boolean(this.warmupUntil);
    this.warmupFrames += 1;
    if (!warmupFrame) {
      this.frameSamples[this.frameSampleIndex] = Math.min(1000, elapsed * 1000);
      this.frameSampleIndex = (this.frameSampleIndex + 1) % this.frameSamples.length;
      this.frameSampleCount = Math.min(this.frameSamples.length, this.frameSampleCount + 1);
    }

    // Screen shake is a render-frame effect, not a physics-step effect: decay it
    // once per displayed frame so a 6–15 FPS software frame does not swallow the
    // whole kick (the old fixed-step decay could erase a hit in one frame).
    if (this.shake > 0) this.shake = decayShake(this.shake, rawDt);

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
    this.yard?.update(rawDt, scaledDt);
    this.coop?.update(now);

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
      // Spoken-clock style ticks over the last ten seconds. Only fires when the
      // whole-second value changes, so a fast frame never spams the voice cap.
      const whole = Math.ceil(this.game.run.timeLeft);
      if (whole > 0 && whole <= 10 && whole !== this._lastCountdown) {
        this._lastCountdown = whole;
        this.sound.countdown?.(whole);
      }
      if (this.game.run.timeLeft <= 0) this.finishRun('time');
    }
    // The band pulls back under the final ten seconds of a clocked run. This is
    // a cheap state check each frame; setClock only touches the graph on change.
    const clockedRun =
      this.game.run.active &&
      this.game.run.mode === 'time' &&
      !this.runOverlayOpen;
    this.music.setClock(clockedRun ? this.game.run.timeLeft : 0, clockedRun);
    this.contract?.tick(rawDt);

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
    if (this.targetPose && !this.v2Active) {
      this.updateHumanoid(scaledDt, this.targetPose.grip, this.targetPose.quaternion, this.targetPose.body);
    }
    if (this.debris) this.debris.update(scaledDt);
    if (this.crown && this.debris) {
      this.crown.sync(this.debris.strikesDone, this.debris.strikesRequired);
      this.crown.update(scaledDt);
    }
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
        this.sound.shock?.();
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
    if (this.yard?.mode !== 'yard') this.controls.update(rawDt);
    this.updateReticle();

    // FPS meter. Never let one pathological frame (tab wake, shader compile,
    // a long GC pause) drop the reported average to zero; cap its weight.
    if (!warmupFrame) {
      this.fpsFrames++;
      this.fpsTime += Math.min(elapsed, 0.5);
      if (this.fpsTime > 0.5) {
        // Median of the rolling frame-time window instead of frames / seconds.
        // One tab-wake or GC stall no longer reports 3 FPS for the next second;
        // sustained slowness still shows up because every frame is slow.
        const count = this.frameSampleCount;
        const recent = [];
        for (let i = 0; i < count; i += 1) recent.push(this.frameSamples[i]);
        recent.sort((a, b) => a - b);
        const median = count ? recent[Math.floor(count / 2)] : 16.7;
        this.fps = Math.max(1, Math.round(1000 / Math.max(1, median)));
        this.fpsFrames = 0;
        this.fpsTime = 0;
        // The first half-second after load can be one compile/upload stall and
        // read as "1 FPS" in the operator's opening screenshot. Hold the
        // readout at "--" until the frame loop has settled for three seconds.
        if (ui.fpsReadout && (!this.readyAt || performance.now() - this.readyAt > 3000)) {
          ui.fpsReadout.textContent = String(this.fps);
        }
        this.qualityManager.update(elapsed, this.fps);
        this.updateAdaptiveResolution();
        // Let audio thin itself out while the host is struggling, then recover.
        this.sound.setPerformancePressure?.(this.fps);
        this.music.setPerformanceBudget?.(this.fps);
      }
    }

    // Reduced motion keeps the impact readable but cuts the camera kick to a
    // subtle nudge; hit-stop and slow-mo timing stay identical for gameplay.
    const shake = this.shake * (this.reducedMotion ? 0.4 : 1);
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
    const softwareRenderer = Boolean(this.qualityManager?.rendererInfo?.software);
    const shadowEvery = softwareRenderer
      ? 15
      : this.qualityName === 'high' || this.qualityName === 'ultra'
        ? 1
        : 2;
    if (this.webgl && this.renderer.shadowMap.enabled && this.shadowFrame % shadowEvery === 0) {
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (!this.webgl) {
      this.renderer.draw(this, scaledDt);
    } else if (this.postfx && this.postfxReady) {
      this.postfx.setSun(
        this.weather?.getSunDirection?.(),
        this.weather?.getSunShaftStrength?.() ?? 0,
      );
      this.postfx.setMood?.({
        golden: this.weather?.goldenFactor ?? 0,
        night: this.weather?.nightFactor ?? 0,
        rain: this.weather?.weatherIntensity?.rain ?? 0,
        snow: this.weather?.weatherIntensity?.snow ?? 0,
        fog: this.weather?.weatherIntensity?.fog ?? 0,
      });
      this.postfx.render(scaledDt);
    } else this.renderer.render(this.scene, this.camera);

    if (sx || sy) {
      this.camera.position.x -= sx;
      this.camera.position.y -= sy;
    }

    this.uiAccumulator += rawDt;
    const hudInterval = this.perfLite ? 0.2 : 0.09;
    if (this.uiAccumulator > hudInterval) {
      this.uiAccumulator = 0;
      this.updateHudLive();
      if (ui.fragmentReadout && this.debris) {
        const pieces = String(this.debris.fragmentCount || 0);
        if (ui.fragmentReadout.textContent !== pieces) ui.fragmentReadout.textContent = pieces;
      }
      if (this.game.run.active && this.game.run.mode === 'time' && ui.runTimer) {
        const t = Math.max(0, this.game.run.timeLeft);
        const clock = `${t.toFixed(1)}s`;
        if (ui.runTimer.textContent !== clock) ui.runTimer.textContent = clock;
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
        this.syncMusicState();
        if (this.weather.weather === 'rain' && Math.random() < 0.018) {
          this.sound.thunder?.(0.4 + Math.random() * 0.5);
        }
      }
    }

    if (this.sim.active) ui.swingButton?.classList.add('swinging');
    else ui.swingButton?.classList.remove('swinging');

    if (window.__sim) {
      window.__sim.game = this.game;
      window.__sim.phase = this.phase;
      window.__sim.swingCount = this.swingCount || 0;
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
      window.__sim.webgl = Boolean(this.webgl);
      window.__sim.renderer = this.rendererReason || null;
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
      const physSim = this.physics?.snapshot?.();
      window.__sim.energyRequired = physSim ? physSim.required : 0;
      window.__sim.energyDelivered = physSim ? physSim.delivered : 0;
      window.__sim.crackWork = physSim ? physSim.work : 0;
      window.__sim.fractureOutcome = physSim ? physSim.outcome : 'ready';
      window.__sim.swingJoules = this.lastSwingModel ? this.lastSwingModel.eEffective : 0;
      window.__sim.headSpeed = this.lastSwingModel ? this.lastSwingModel.vHead : 0;
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
      window.__sim.masterSeam = this.debris?.masterSeam ?? null;
      window.__sim.masterShiftCount = this.debris?.masterShiftCount || 0;
      window.__sim.ringShake = Boolean(this.debris?.log?.ringShake);
      window.__sim.ringCuts = this.debris?.ringShakeCuts || 0;
      window.__sim.ringLoose = Boolean(this.debris?.ringShakeLoose);
      window.__sim.ringAngle = this.debris?.ringShakeAngle ?? null;
      window.__sim.ringTarget = this.debris?.ringAt?.(this.aim.x, this.aim.z) || null;
      const boundNow = this.debris?.boundAt?.(this.aim.x, this.aim.z) || null;
      window.__sim.boundHeart = boundNow;
      window.__sim.coreCracked = Boolean(this.debris?.coreCracked);
      window.__sim.ringCutsNeeded = this.debris?.ringCutsNeeded || 2;
      window.__sim.ringArcHalfWidth = this.debris?.ringArcHalfWidth || 0;
      window.__sim.ringVisualHalfWidth = this.debris?.ringVisualHalfWidth || 0;
      window.__sim.ringShellPieces = this.debris?.ringShellPieces || 0;
      window.__sim.ringShellSurface = this.debris?.lastRingShellSurface || null;
      window.__sim.corePunchWindow = {
        min: 0.9,
        armed: Boolean(boundNow) && !this.debris?.coreCracked,
        ready:
          Boolean(boundNow) &&
          !this.debris?.coreCracked &&
          this.charge.active &&
          this.charge.value >= 0.9,
      };
      window.__sim.corePlugDropped = Boolean(this.debris?.corePlugDropped);
      window.__sim.weatherBiteShift = this.weatherBiteShift || 0;
      window.__sim.weatherShiftCount = this.weatherShiftCount || 0;
      window.__sim.telemetry = this.telemetry ? { ...this.telemetry } : null;
      window.__sim.contract = this.contract ? this.contract.snapshot() : null;
      window.__sim.campaign = this.game.campaignMeta;
      window.__sim.bladeAngle = Number(((this.bladeOffset * 180) / Math.PI).toFixed(1));
      window.__sim.bladeOffset = Number(this.bladeOffset.toFixed(3));
      window.__sim.wedgeCheck = this.debris?.canDriveWedge?.() || null;
      window.__sim.wedgePull = this.debris?.canPullWedge?.() || null;
      window.__sim.crownSections = this.crown?.sections?.length || 0;
      window.__sim.crownSectionsReleased = this.crown?.released || 0;
      window.__sim.crownSectionsStanding = this.displaySpecies?.finalBoss
        ? Math.max(0, (this.displaySpecies.crownSections || 3) - (this.crown?.released || 0))
        : 0;
      window.__sim.crownPhysicalBodies = this.crown?.physicalBodies || 0;
      window.__sim.ambientLevel = this.sound.ambientLevel;
      window.__sim.audioState = this.sound.ctx ? this.sound.ctx.state : 'locked';
      const audioStats = this.getAudioStats();
      window.__sim.activeVoices = audioStats.activeVoices;
      window.__sim.musicPlaying = audioStats.musicPlaying;
      window.__sim.musicVolume = audioStats.musicVolume;
      window.__sim.sfxVolume = audioStats.sfxVolume;
      window.__sim.musicScene = audioStats.musicScene;
      window.__sim.musicBpm = audioStats.musicBpm;
      window.__sim.musicIntensity = audioStats.musicIntensity;
      window.__sim.musicBoss = audioStats.musicBoss;
      window.__sim.musicDucked = audioStats.musicDucked;
      window.__sim.countdown = this._lastCountdown || null;
      window.__sim.perfLite = Boolean(this.perfLite);
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Boot + public test hooks
 * ------------------------------------------------------------------ */

const simulation = new AxeSimulation();
// Debug/test escape hatch for driver scripts; the public hooks below are the
// supported surface, but exposing the instance keeps deep checks possible.
window.__simulation = simulation;
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
  activeVoices: 0,
  musicPlaying: false,
  musicVolume: 0.35,
  sfxVolume: 0.8,
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

/* Assets v2 automation surface ----------------------------------------- */
window.chopperTest = {
  ready() {
    return Boolean(simulation.ready && simulation.yard?.ready());
  },
  setSetting(setting) {
    simulation.hideStartPicker();
    const result = simulation.yard?.setSetting(setting) || Promise.resolve(false);
    return Promise.resolve(result).then((value) => {
      simulation.syncV2Ui();
      return value;
    });
  },
  setCharacter(character) {
    simulation.hideStartPicker();
    return simulation.setCharacter(character).then((value) => {
      simulation.syncV2Ui();
      return value;
    });
  },
  setCostume(costume) {
    simulation.hideStartPicker();
    return simulation.setCostume(costume).then((value) => {
      simulation.syncV2Ui();
      return value;
    });
  },
  setAxe(axe) {
    simulation.hideStartPicker();
    const result = simulation.yard?.setAxe(axe) || Promise.resolve(false);
    return Promise.resolve(result).then((value) => {
      simulation.updateHudStatic();
      simulation.renderShop();
      simulation.coop?.setLocalProfile?.({ axe: value });
      return value;
    });
  },
  setQuality(name) {
    simulation.hideStartPicker();
    simulation.qualityManager.setMode(name);
    simulation.yard?.applyQuality(simulation.qualityName, { silent: true });
    simulation.game?.setQuality(name);
    return Promise.resolve(simulation.qualityApplyPromise || null)
      .then(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          }),
      )
      .then(() => simulation.qualityName);
  },
  enterYard() {
    return simulation.yard?.enterYard({ instant: true }) || Promise.resolve(false);
  },
  enterStump() {
    simulation.hideStartPicker();
    return simulation.yard?.enterStump() || Promise.resolve(false);
  },
  teleportNearTree() {
    simulation.hideStartPicker();
    return simulation.yard?.teleportNearTree() ?? null;
  },
  chopTree() {
    simulation.hideStartPicker();
    return simulation.yard?.chopTree() || Promise.resolve({ felled: false, hits: 0 });
  },
  state() {
    if (simulation.yard) {
      const state = simulation.yard.state();
      state.name = simulation.effectiveName();
      state.characterLoaded = Boolean(simulation.yard.character?.isLoaded);
      state.axeAttachedTo = simulation.yard.character?.axeAttachedTo || null;
      return state;
    }
    return {
      setting: 'nj',
      character: 'sergey',
      characterName: 'Sergey',
      name: simulation.effectiveName(),
      costume: 'tee',
      axe: 'sergey',
      quality: simulation.qualityName,
      mode: 'stump',
      player: { x: 0, y: 0, z: 0 },
      anim: 'None',
      characterLoaded: false,
      axeAttachedTo: null,
      trees: { standing: 0, chopping: 0, falling: 0, felled: 0 },
      nearestTree: null,
    };
  },
};

window.getAudioStats = function getAudioStats() {
  return simulation.getAudioStats();
};

window.getPerfStats = function getPerfStats() {
  return simulation.getPerfStats();
};

window.startMode = function startMode(mode, seed) {
  return simulation.startMode(mode, seed);
};

window.startCampaignChapter = function startCampaignChapter(chapter) {
  return simulation.startCampaignChapter(chapter);
};

window.startContract = function startContract(kind, seed) {
  return simulation.startContract(kind, seed);
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

window.pullWedge = function pullWedge() {
  return simulation.pullWedge();
};

window.honeEdge = function honeEdge() {
  const result = simulation.game.honeEdge();
  simulation.updateHudStatic();
  simulation.renderShop();
  return result;
};

window.setQuality = function setQuality(name) {
  const result = simulation.qualityManager.setMode(name);
  simulation.yard?.applyQuality(simulation.qualityName, { silent: true });
  if (simulation.game) simulation.game.setQuality(name);
  return Promise.resolve(simulation.qualityApplyPromise || result).then(
    () => simulation.qualityName,
  );
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
    window.simulationReady = true;
  })
  .catch((error) => {
    window.__sim.ready = false;
    window.simulationReady = false;
    window.__sim.error = String(error && error.stack ? error.stack : error);
    showFatalError(error);
  });
