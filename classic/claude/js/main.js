import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Physics, RAPIER } from './physics.js';
import { createEnvironment } from './environment.js';
import { LogManager, makeLogParams, makeStaticRound } from './log.js';
import { Axe } from './axe.js';
import { Humanoid } from './humanoid.js';
import { SwingController } from './swing.js';
import { Chips, Dust, Sparks, setMaxChips } from './particles.js';
import { SoundFX } from './audio.js';
import { WeatherSystem } from './weather.js';
import { RenderPipeline, PRESETS, PRESET_ORDER } from './post.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { patchScene, updateUpView } from './matpatch.js';
import { setTextureScale } from './textures.js';
import { WEATHER_ORDER } from './data.js';

const BLOCK = { R: 0.31, H: 0.46 };
const CAMERA_HOME = { pos: new THREE.Vector3(1.85, 1.55, 2.75), target: new THREE.Vector3(-0.1, 0.72, -0.45) };
const MAX_FRAME_DT = 0.75; // real seconds of simulation allowed per rendered frame
const MAX_STEPS = 90;

const $ = (id) => document.getElementById(id);
const loading = $('loading');

async function main() {
  const physics = await Physics.create();
  loading.querySelector('#loading-text').textContent = 'Building the backyard…';
  await new Promise((r) => setTimeout(r, 0));

  // ------------------------------------------------------------ renderer / scene / camera
  const detected = RenderPipeline.detectStart();
  // MSAA multiplies the fragment cost on software rasterisers; FXAA-free there, sharp elsewhere.
  const renderer = new THREE.WebGLRenderer({ antialias: !detected.soft, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 1000);
  camera.position.copy(CAMERA_HOME.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(CAMERA_HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.8;
  controls.maxDistance = 35;
  controls.maxPolarAngle = Math.PI * 0.495;
  // Left button is the axe; the camera lives on the right button / wheel.
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.update();

  const pipeline = new RenderPipeline({ renderer, scene, camera });

  // Saved settings are needed before anything texture-heavy is generated.
  const settingsPeek = (() => { try { return JSON.parse(localStorage.getItem('backyard-log-splitter-save-v2'))?.settings ?? {}; } catch { return {}; } })();
  const startQuality = settingsPeek.quality && settingsPeek.quality !== 'auto' ? settingsPeek.quality : detected.preset;
  setTextureScale(PRESETS[startQuality].texScale);

  const env = createEnvironment({ scene, renderer, physics });
  const weather = new WeatherSystem({ scene, renderer, env, camera });

  // ------------------------------------------------------------ chopping block
  const blockParams = makeLogParams(4242, { species: 'oak', R: BLOCK.R, H: BLOCK.H, knotChance: 0 });
  const block = makeStaticRound(blockParams, { weathered: true });
  scene.add(block);
  physics.addStatic(RAPIER.ColliderDesc.cylinder(BLOCK.H / 2, BLOCK.R), [0, BLOCK.H / 2, 0], null, { friction: 0.75, restitution: 0.1 });

  // ------------------------------------------------------------ actors
  const logs = new LogManager({ scene, physics, blockTop: BLOCK.H });
  const axe = new Axe(scene, physics);
  const humanoid = new Humanoid(scene, physics);
  const chips = new Chips(scene, physics);
  const dust = new Dust(scene);
  const sparks = new Sparks(scene);
  const audio = new SoundFX();
  physics.createDebug(scene);
  const sparkLight = new THREE.PointLight(0xffa040, 0, 4, 2);
  scene.add(sparkLight);

  const ui = { slowmo: true, cine: { active: false, t: 0 }, telemetry: false, camYaw: 0, hitStop: 0 };

  const swingCtl = new SwingController({
    humanoid, axe, logs, blockTop: BLOCK.H,
    onEvent: (type, data) => onSwingEvent(type, data),
  });
  const game = new Game({ scene, physics, logs, swing: swingCtl, chips, dust, sparks, audio, weather, env, blockTop: BLOCK.H });
  logs.onLanded = () => game.onLogLanded();
  const hud = new Hud(game, weather);

  function onSwingEvent(type, data) {
    if (type === 'swingStart') audio.windup(data.power);
    else if (type === 'downswing') audio.whoosh(data.power);
    else if (type === 'blockHit') game.onBlockHit(data);
    else if (type === 'swingEnd') game.onSwingEnd();
    else if (type === 'wrench') { game.stamina = Math.max(0, game.stamina - 3); audio.wedgePull(); }
  }

  game.on('hit', (h) => {
    // Brief hit-stop sells the weight of the blow (skipped when frames are already slow).
    if (fpsNow > 20 && h.result !== 'miss') ui.hitStop = h.result === 'split' ? 0.07 : 0.05;
    if (h.result === 'split') {
      if (h.combo > 1) audio.ding(h.combo);
      audio.points(h.points);
      // Celebratory stingers: boss down > perfect bullseye > any clean split.
      if (h.boss) audio.bossDefeated();
      else if (h.timing === 'perfect' && h.grade === 'Bullseye') { audio.perfect(); audio.splitStinger('perfect'); }
      else if (h.grade === 'Bullseye' || h.grade === 'Clean split') audio.splitStinger('clean');
      // Perfect-timed bullseyes and boss kills get a longer, deeper slow-mo.
      const big = (h.timing === 'perfect' && h.grade === 'Bullseye') || h.boss;
      if (big && fpsNow > 20) ui.hitStop = 0.12;
      if (ui.slowmo && fpsNow > 14) ui.cine = { active: true, t: 0, hold: big ? 0.9 : 0.45, low: big ? 0.15 : 0.3 };
    }
  });
  game.on('sparkLight', (p) => {
    sparkLight.position.copy(p).y += 0.05;
    sparkLight.intensity = 8;
  });
  game.on('yaw', (d) => { ui.camYaw += d; });
  game.on('meter', (on) => { if (on) audio.meterStart(); });
  game.on('swing', () => { audioUi.lastSwing = performance.now(); });
  game.on('modeEnd', (sum) => {
    if (sum.reason === 'quit') return;
    if (sum.reason === 'time') audio.timeUp();
    audio.modeComplete(sum.stars ?? 0);
    if (sum.best) audio.achievement();
  });
  const audioUi = { lastSwing: 0, meterQ: -1, meterIn: false, modals: document.querySelectorAll('.modal') };

  // ------------------------------------------------------------ settings + quality
  const S = game.p.settings;
  function applyQuality(id, manual = false) {
    if (id === 'auto') {
      pipeline.auto = true;
      S.quality = 'auto';
      id = pipeline.presetId ?? detected.preset;
    } else if (manual) {
      pipeline.auto = false;
      S.quality = id;
    }
    pipeline.apply(id);
    const P = pipeline.preset;
    env.grass.count = Math.round(env.grassMax * P.grass);
    env.grass.visible = P.grass > 0;
    setMaxChips(P.chips);
    setTextureScale(P.texScale);
    weather.setQuality({ precipScale: P.precip, cloudOctaves: P.cloudOctaves, envUpdates: P.envUpdates, ibl: P.ibl });
    for (const L of env.lamps) L.light.visible = P.pointLights || L.name === 'lantern';
    onResize();
    $('sel-quality').value = S.quality === 'auto' ? 'auto' : id;
  }
  pipeline.onChange = (id) => { $('h-qname') && ($('h-qname').textContent = PRESETS[id].name); };

  weather.setWeather(S.weather ?? 'clear');
  if (S.weather && S.weather !== 'auto') weather.presetId = S.weather;
  weather.applyInstant();
  weather.setHour(S.hour ?? 16.5);
  weather.timeFlow = S.timeFlow !== false;
  weather.onThunder = (dist, delay) => setTimeout(() => audio.thunder(dist), delay * 1000);
  ui.slowmo = S.slowmo !== false;

  // ------------------------------------------------------------ input
  const input = new Input({
    dom: renderer.domElement, camera, controls, game, scene, blockTop: BLOCK.H,
    actions: {
      closeModals: () => { for (const m of document.querySelectorAll('.modal')) m.classList.add('hidden'); },
      key: (code) => onKey(code),
    },
  });

  function toggleModal(id) {
    const el = $(id);
    const open = el.classList.contains('hidden');
    for (const m of document.querySelectorAll('.modal')) m.classList.add('hidden');
    audio.uiOpen(open);
    if (open) {
      el.classList.remove('hidden');
      if (id === 'shop') hud.openShop();
      if (id === 'modes') hud.openModes();
    }
  }

  // Audio settings live in their own localStorage key (see audio.js); S.sound mirrors the SFX toggle.
  function setSound(on) { audio.setEnabled(on); S.sound = on; $('chk-sound').checked = on; }
  function setMusic(on) { audio.setMusicOn(on); $('chk-music').checked = on; }
  function setSlowmo(on) { ui.slowmo = on; S.slowmo = on; $('chk-slowmo').checked = on; if (!on) ui.cine.active = false; }
  function setTelemetry(on) { ui.telemetry = on; $('telemetry').classList.toggle('hidden', !on); physics.debugLines.visible = false; }
  function resetCamera() {
    const yaw = game.aim.yaw;
    const rot = (v) => v.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    camera.position.copy(rot(CAMERA_HOME.pos));
    controls.target.copy(rot(CAMERA_HOME.target));
    ui.camYaw = 0;
  }
  function setWeather(id, quiet = false) {
    weather.setWeather(id);
    S.weather = id;
    $('sel-weather').value = id;
    game.needed = null;
    if (!quiet) game.toast(`${id === 'auto' ? 'Auto weather' : weather.preset.name}`, 'info');
  }
  // Modes override the weather / time of day for their duration and restore them afterwards.
  game.host = { setWeather: (id, quiet) => setWeather(id, quiet) };

  function onKey(code) {
    switch (code) {
      case 'KeyB': toggleModal('shop'); break;
      case 'KeyO': toggleModal('modes'); break;
      case 'KeyH': toggleModal('help'); break;
      case 'KeyG': game.sharpen(); break;
      case 'KeyR': resetScene(); break;
      case 'KeyM': setMusic(!audio.prefs.musicOn); game.toast(audio.prefs.musicOn ? 'Music on' : 'Music muted'); break;
      case 'KeyT': weather.cycleTime(); break;
      case 'KeyN': setWeather(WEATHER_ORDER[(WEATHER_ORDER.indexOf(weather.presetId) + 1) % WEATHER_ORDER.length]); break;
      case 'KeyK': {
        const i = PRESET_ORDER.indexOf(pipeline.presetId);
        applyQuality(PRESET_ORDER[(i + 1) % PRESET_ORDER.length], true);
        game.toast(`Quality: ${pipeline.preset.name}`);
        break;
      }
      case 'KeyC': resetCamera(); break;
      case 'KeyF': setTelemetry(!ui.telemetry); break;
      case 'KeyX': game.testSwing(); break;
      case 'KeyP': physics.debugLines.visible = !physics.debugLines.visible; physics.updateDebug(); break;
    }
  }

  $('btn-shop').addEventListener('click', () => toggleModal('shop'));
  $('btn-modes').addEventListener('click', () => toggleModal('modes'));
  $('btn-help').addEventListener('click', () => toggleModal('help'));
  $('btn-sharpen').addEventListener('click', () => game.sharpen());
  $('btn-swing').addEventListener('click', () => game.testSwing());
  $('btn-reset').addEventListener('click', () => resetScene());
  $('btn-tele').addEventListener('click', () => setTelemetry(!ui.telemetry));
  $('btn-time').addEventListener('click', () => weather.cycleTime());
  $('chk-timeflow').addEventListener('change', (e) => { weather.timeFlow = e.target.checked; S.timeFlow = e.target.checked; });
  $('chk-sound').addEventListener('change', (e) => setSound(e.target.checked));
  $('chk-music').addEventListener('change', (e) => setMusic(e.target.checked));
  for (const [id, fn] of [['vol-music', (v) => audio.setMusicVolume(v)], ['vol-sfx', (v) => audio.setSfxVolume(v)]]) {
    const el = $(id);
    el.value = Math.round(100 * (id === 'vol-music' ? audio.prefs.musicVolume : audio.prefs.sfxVolume));
    el.addEventListener('input', () => fn(el.value / 100));
    el.addEventListener('change', () => { el.blur(); if (id === 'vol-sfx') audio.uiClick(); });
  }
  // UI sounds for every button / toggle (shop actions play their own purchase / denied sounds).
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('button, input[type=checkbox], select');
    if (!el || el.closest('[data-act]')) return;
    if (el.matches('[data-close]')) audio.uiOpen(false); else audio.uiClick();
  });
  document.addEventListener('pointerover', (e) => {
    const b = e.target.closest?.('button');
    if (b && !b.disabled && !(e.relatedTarget && b.contains(e.relatedTarget))) audio.uiHover();
  });
  $('chk-slowmo').addEventListener('change', (e) => setSlowmo(e.target.checked));
  $('sel-weather').addEventListener('change', (e) => { setWeather(e.target.value); e.target.blur(); });
  $('sel-quality').addEventListener('change', (e) => { applyQuality(e.target.value, true); e.target.blur(); });
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden'));
  // Keep Space from re-clicking focused buttons.
  for (const b of document.querySelectorAll('button, input[type=checkbox], input[type=range]')) {
    b.addEventListener('keydown', (e) => { if (e.code === 'Space') e.preventDefault(); });
    b.addEventListener('keyup', (e) => { if (e.code === 'Space') e.preventDefault(); });
  }
  $('chk-timeflow').checked = weather.timeFlow;
  $('chk-sound').checked = audio.enabled;
  $('chk-music').checked = audio.prefs.musicOn;
  $('chk-slowmo').checked = ui.slowmo;
  $('sel-weather').value = S.weather ?? 'clear';

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    pipeline.setSize(window.innerWidth, window.innerHeight);
    const pr = renderer.getPixelRatio();
    dust.setViewport(window.innerHeight, pr);
    sparks.setViewport(window.innerHeight, pr);
    weather.setViewport(window.innerHeight, pr);
  }
  window.addEventListener('resize', onResize);

  // ------------------------------------------------------------ scene control
  function resetScene() {
    game.cancelMeter();
    game.pendingNext = null; // otherwise a pending "next round" would replace the restored log
    ui.cine.active = false;
    const params = logs.log?.params ?? null;
    logs.clearAll();
    chips.clear();
    dust.clear();
    sparks.clear();
    if (params) {
      logs.createLog(params);
      game.applyAim();
    } else game.nextLog(true);
    game.needed = null;
    swingCtl.setReady();
    physics.step();
    game.emit('log');
    return params?.seed ?? logs.log?.params.seed;
  }

  // ------------------------------------------------------------ simulation loop
  const h = physics.dt;
  let simTime = 0;
  const pieceVel = new THREE.Vector3();
  let windV = { x: 0, z: 0 };

  function stepSim() {
    swingCtl.update(h);
    chips.applyWind(windV, h);
    physics.step();
    logs.update(h);
    dust.update(h, windV);
    sparks.update(h, 0.005);
    simTime += h;
    for (const p of logs.pieces) {
      if (!p.entry.body) continue;
      const v = p.entry.body.linvel();
      pieceVel.set(v.x, v.y, v.z);
      const dv = pieceVel.distanceTo(p.lastVel);
      const y = p.entry.body.translation().y;
      // Landings / bounces (audio.land is rate-limited); slow tumbling on the lawn rolls.
      if (dv > 1.2 && y < 0.9) audio.land(dv, y);
      else if (y < 0.3 && dv < 0.4 && Math.hypot(v.x, v.z) > 0.8) audio.roll(Math.hypot(v.x, v.z));
      p.lastVel.copy(pieceVel);
    }
  }

  function syncVisuals() {
    physics.syncMeshes();
    chips.sync();
    physics.updateDebug();
  }

  let acc = 0;
  let last = performance.now();
  let fpsT = 0, fpsN = 0, hudT = 0, fpsNow = 0, ambT = 0, frictionKey = '';
  let lastError = '';
  const shakeOff = new THREE.Vector3();

  function cineFactor(dtReal) {
    if (!ui.cine.active) return 1;
    ui.cine.t += dtReal;
    const t = ui.cine.t;
    const HOLD = ui.cine.hold ?? 0.45, RAMP = 0.35, LOW = ui.cine.low ?? 0.3;
    if (t > HOLD + RAMP) { ui.cine.active = false; return 1; }
    if (t < HOLD) return LOW;
    return LOW + (1 - LOW) * ((t - HOLD) / RAMP);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    try {
      tick(now);
    } catch (err) {
      // Never let one bad frame kill the loop (that is what froze v1's swing).
      if (String(err) !== lastError) { lastError = String(err); console.error(err); }
    }
  }

  function tick(now) {
    const raw = Math.max(0, (now - last) / 1000);
    last = now;
    const dtReal = Math.min(MAX_FRAME_DT, raw);
    fpsN++;
    fpsT += raw;
    if (fpsT > 0.5) {
      fpsNow = fpsN / fpsT;
      fpsN = 0;
      fpsT = 0;
    }

    weather.update(dtReal);
    const cond = weather.conditions;
    windV = cond.wind;
    game.update(dtReal);
    // Timing meter: ticks at the quarter marks and a ping when the needle enters the sweet zone.
    if (game.meter.active) {
      const v = game.meter.value, q = Math.floor(v * 4);
      if (q !== audioUi.meterQ) { if (audioUi.meterQ >= 0) audio.meterTick(false); audioUi.meterQ = q; }
      const [lo, hi] = game.sweetZone, inZ = v >= lo && v <= hi;
      if (inZ && !audioUi.meterIn) audio.meterTick(true);
      audioUi.meterIn = inZ;
    } else audioUi.meterQ = -1;

    // Surface friction follows the weather (wet / icy pieces slide further).
    const fk = `${Math.round(cond.wet * 4)}|${Math.round(cond.icy * 4)}`;
    if (fk !== frictionKey) {
      frictionKey = fk;
      const f = 0.9 - 0.35 * cond.wet - 0.5 * cond.icy;
      env.groundBody.collider(0).setFriction(Math.max(0.15, f));
      logs.setFriction(Math.max(0.15, 0.75 - 0.3 * cond.wet - 0.45 * cond.icy));
      chips.friction = Math.max(0.15, 0.7 - 0.3 * cond.wet - 0.4 * cond.icy);
    }

    let scale = cineFactor(dtReal);
    if (ui.hitStop > 0) { ui.hitStop -= dtReal; scale = 0; }
    acc += dtReal * scale;
    let steps = 0;
    while (acc >= h && steps < MAX_STEPS) {
      stepSim();
      acc -= h;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
    syncVisuals();
    input.update();
    env.update(simTime);
    sparkLight.intensity = Math.max(0, sparkLight.intensity - dtReal * 40);

    // Camera follows blade-direction changes around the block, plus impact shake.
    camera.position.sub(shakeOff);
    if (Math.abs(ui.camYaw) > 1e-4) {
      const step = ui.camYaw * (1 - Math.exp(-8 * dtReal));
      ui.camYaw -= step;
      const pivot = new THREE.Vector3(0, 0, 0);
      camera.position.sub(pivot).applyAxisAngle(THREE.Object3D.DEFAULT_UP, step).add(pivot);
      controls.target.sub(pivot).applyAxisAngle(THREE.Object3D.DEFAULT_UP, step).add(pivot);
    }
    controls.update();
    const sh = game.fx.shake * game.fx.shake * 0.012;
    shakeOff.set(Math.sin(now * 0.091) * sh, Math.sin(now * 0.077 + 1) * sh, Math.sin(now * 0.083 + 2) * sh);
    camera.position.add(shakeOff);
    camera.updateMatrixWorld();
    updateUpView(camera);

    const golden = weather.golden ?? 0;
    const sunVis = weather.daylight * (1 - 0.85 * Math.min(1, Math.max(0, (weather.cur.clouds - 0.5) * 2)));
    pipeline.setSun(weather.sunDir, sunVis * (0.25 + 0.75 * golden) * (1 + 3 * weather.cur.fog));
    pipeline.render();

    const down = pipeline.monitor(raw);
    if (down) { game.toast(down.msg, 'warn'); applyQuality(down.id); }

    hudT += raw;
    ambT += raw;
    if (hudT > 0.1) {
      hudT = 0;
      hud.update(fpsNow, pipeline.preset.name + (pipeline.auto ? ' (auto)' : ''));
      if (ui.telemetry) {
        hud.telemetry({
          state: swingCtl.state, headSpeed: swingCtl.headSpeedNow(), bodies: physics.bodyCount(),
          pieces: logs.pieces.length, chips: chips.list.length, scale,
        });
      }
      S.hour = weather.hour;
    }
    if (ambT > 0.3) {
      ambT = 0;
      audio.ambience({
        rain: weather.cur.rain, snow: weather.cur.snow, wind: cond.wind.speed, gust: cond.wind.gust,
        night: cond.night, temp: cond.temp, fog: cond.fog, id: cond.id, window: 0.3,
      });
      updateMusic();
    }
  }

  // Soundtrack section + intensity: menu while a menu is open or after ~30 s idle, gameplay while
  // chopping (intensity follows the combo streak), boss while a boss round is on the block.
  function updateMusic() {
    const now = performance.now();
    const modal = [...audioUi.modals].some((m) => !m.classList.contains('hidden'));
    const boss = !!logs.log?.params.boss;
    const idle = !audioUi.lastSwing || now - audioUi.lastSwing > 30000;
    const recent = audioUi.lastSwing && now - audioUi.lastSwing < 5000 ? 0.12 : 0;
    const section = boss && !modal ? 'boss' : modal || idle ? 'menu' : 'gameplay';
    const intensity = boss ? 0.75 + 0.06 * game.combo + recent : 0.22 + 0.11 * game.combo + recent;
    audio.music.setState(section, Math.min(1, intensity));
  }

  // ------------------------------------------------------------ globals for automation
  window.getAudioState = () => audio.state();
  // Scripted ~N-second showcase for recordings: swings of varied power, weather + time changes,
  // UI sounds and a boss round. Needs an unlocked AudioContext (click the page first, or launch
  // the browser with --autoplay-policy=no-user-gesture-required). Resolves to getAudioState().
  window.audioDemo = async (seconds = 60) => {
    audio.unlock();
    if (!audio.ctx) return audio.state();
    try { await audio.ctx.resume(); } catch { /* still locked */ }
    audio.prefs.musicOn = true; // for this session only (not saved)
    audio.applyVolumes();
    audio.music.start();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const saved = { weather: S.weather ?? 'clear', hour: weather.hour };
    const t0 = performance.now(), end = t0 + seconds * 1000;
    const wx = ['clear', 'rain', 'storm', 'snow', 'wind', 'fog', 'frost', 'clear'];
    weather.setHour(9);
    for (const [fn, ms] of [[() => audio.uiHover(), 0], [() => audio.uiClick(), 200], [() => audio.uiOpen(true), 400], [() => audio.purchase(), 700], [() => audio.denied(), 1200], [() => audio.sharpen(), 1600], [() => audio.uiOpen(false), 2400]]) setTimeout(fn, ms);
    await sleep(2600);
    let i = 0, boss = false, night = false;
    while (performance.now() < end) {
      const el = (performance.now() - t0) / 1000;
      if (i % 4 === 1) setWeather(wx[Math.floor(i / 4) % wx.length], true);
      if (!night && el > seconds * 0.4) { night = true; weather.setHour(22); }
      if (!boss && el > seconds * 0.6) {
        boss = true;
        window.game.makeRound({ species: 'oak', traits: ['huge', 'knotty'], boss: { name: 'Demo Stump' } });
        audio.bossIntro();
        await sleep(1500);
      }
      if (i % 6 === 3) { game.startMeter(false); await sleep(1300); game.cancelMeter(); }
      window.swing(0.5 + 0.5 * Math.random());
      const ts = performance.now();
      while (!['ready', 'done'].includes(swingCtl.state) && performance.now() - ts < 5000) await sleep(100);
      await sleep(500 + Math.random() * 600);
      i++;
    }
    setWeather(saved.weather, true);
    weather.setHour(saved.hour);
    audio.prefs.musicOn = audio.loadPrefs().musicOn;
    audio.applyVolumes();
    if (!audio.prefs.musicOn) audio.music.stop();
    return audio.state();
  };
  window.swing = (power) => {
    // Lets automation drive the soundtrack too, but only once the page has had a user activation
    // (so the AudioContext never trips the autoplay warning).
    if ((!audio.ctx || audio.ctx.state !== 'running') && navigator.userActivation?.hasBeenActive) audio.unlock();
    return game.testSwing(power);
  };
  window.resetScene = () => resetScene();
  window.getGameState = () => game.state();
  window.game = {
    setWeather, setHour: (hh) => weather.setHour(hh), setQuality: (q) => applyQuality(q, true),
    cycleTime: () => weather.cycleTime(), shop: hud, instance: game,
    // Modes: 'campaign' (opts.stage 0..7), 'timeattack', 'precision', 'daily'; endMode() quits to free play.
    startMode: (type, opts) => game.startMode(type, opts), endMode: () => game.endMode('quit'),
    // Put a specific round on the block (testing / showcase): makeRound({ species, traits: [...] }).
    makeRound: (opts = {}) => {
      game.cancelMeter();
      game.pendingNext = null;
      logs.clearAll();
      const params = makeLogParams((Math.random() * 1e6) | 0, { knotChance: 0, ...opts });
      logs.createLog(params);
      game.applyAim();
      game.needed = null;
      swingCtl.setReady();
      physics.step();
      game.emit('log');
      return game.state().log;
    },
  };
  window.sim = {
    get state() { return swingCtl.state; },
    get busy() { return swingCtl.busy; },
    get lastResult() { return game.lastHit; },
    get log() {
      const L = logs.log;
      return L ? { species: L.params.species.name, R: L.params.R, H: L.params.H, required: L.params.req, damage: L.damage, pos: L.pos.clone(), ready: L.ready } : null;
    },
    get pieces() {
      return logs.pieces.filter((p) => p.entry.body).map((p) => {
        const t = p.entry.body.translation();
        return { x: t.x, y: t.y, z: t.z, mass: p.mass, sleeping: p.entry.body.isSleeping() };
      });
    },
    get chips() { return chips.list.length; },
    get bodies() { return physics.bodyCount(); },
    get fps() { return fpsNow; },
    get quality() { return pipeline.presetId; },
    get lastContact() { return swingCtl.lastContact; },
    get lastOutcome() { return swingCtl.lastOutcome; },
    headSpeed: () => swingCtl.headSpeedNow(),
    // Deterministically advance the simulation (no rendering) — handy for unit-style tests.
    advance(seconds) {
      const n = Math.round(seconds / h);
      for (let i = 0; i < n; i++) { game.update(h); stepSim(); }
      syncVisuals();
      return swingCtl.state;
    },
    weather, pipeline, game, swing: swingCtl, logs,
    render: () => pipeline.render(),
    camera, controls, scene, renderer,
  };

  // ------------------------------------------------------------ start
  const startPreset = S.quality === 'auto' || !S.quality ? detected.preset : S.quality;
  pipeline.auto = S.quality === 'auto' || !S.quality;
  pipeline.presetId = startPreset;
  applyQuality(startPreset);
  patchScene(scene);
  game.rebuildQueue();
  game.nextLog(true);
  game.env.woodpile?.setPieces(game.p.woodpile);
  swingCtl.setReady();
  resetCamera();
  physics.step();
  renderer.compile(scene, camera);
  requestAnimationFrame((t) => { last = t; frame(t); });
  loading.classList.add('hidden');
  setTimeout(() => loading.remove(), 600);
  if (!game.p.seenHelp) {
    game.p.seenHelp = true;
    setTimeout(() => game.toast('New here? Hover the log, hold the left mouse button, release in the green zone. Press H for help.', 'info', true), 800);
  }
  if (detected.soft) setTimeout(() => game.toast(`Software GL detected — starting at ${pipeline.preset.name} quality`, 'warn'), 1600);
  window.simReady = true;
}

main().catch((err) => {
  console.error(err);
  loading.classList.add('error');
  loading.querySelector('#loading-text').textContent = `Failed to start: ${err.message}`;
  loading.querySelector('.spinner')?.remove();
});
