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
import { patchScene, updateUpView, setLowShading, LOW } from './matpatch.js';
import { BlobShadows } from './blobs.js';
import { mergeStatic, setMerged } from './merge.js';
import { setTextureScale, setAnisoCap, setMipFilter } from './textures.js';
import { WEATHER_ORDER, AXES, AXES_BY_ID, AXE_FOR_MODEL } from './data.js';
import { progress } from './assets.js';
import { Sergey, COSTUMES, CHARACTERS, charOf } from './sergey.js';
import { YardWorld, SETTINGS } from './yard.js';
import { Player } from './player.js';
import { WoodChips } from './woodchips.js';
import { Picker } from './picker.js';
import { setupCoop } from './coopgame.js';

const BLOCK = { R: 0.31, H: 0.46 };
const CAMERA_HOME = { pos: new THREE.Vector3(1.85, 1.55, 2.75), target: new THREE.Vector3(-0.1, 0.72, -0.45) };
const MAX_FRAME_DT = 0.75; // real seconds of simulation allowed per rendered frame
const MAX_STEPS = 90;

const $ = (id) => document.getElementById(id);
const loading = $('loading');

// Loading screen: a progress bar fed by every GLB / texture request (models load in parallel).
progress.listeners.add((done, total) => {
  const f = $('load-fill'), c = $('load-count');
  if (f) f.style.width = `${Math.max(3, Math.round((100 * done) / Math.max(1, total)))}%`;
  if (c) c.textContent = `${done} / ${total} assets`;
});
const setLoadText = (t) => { const el = $('loading-text'); if (el) el.textContent = t; };
// Start screen: once the player touches the picker (or anything on the card) it waits for Play.
const startUi = { touched: false, started: false };
for (const ev of ['pointerdown', 'keydown', 'focusin']) document.querySelector('.load-card')?.addEventListener(ev, () => { startUi.touched = true; });
// The start-screen picker is shown right away; picks made before the game is wired up (physics
// WASM still loading) are kept and applied by main() as soon as it can.
const earlyPick = { api: null, queued: {}, saved: (() => { try { return JSON.parse(localStorage.getItem('backyard-log-splitter-save-v2'))?.settings ?? {}; } catch { return {}; } })() };
const startPicker = new Picker($('start-pick'), {
  preview: $('load-art'), idPrefix: 'sp',
  get: () => {
    if (earlyPick.api) return earlyPick.api.get();
    const costume = COSTUMES[earlyPick.queued.costume ?? earlyPick.saved.costume] ? (earlyPick.queued.costume ?? earlyPick.saved.costume) : 'tee';
    return { character: charOf(costume), costume, name: earlyPick.queued.name ?? earlyPick.saved.playerName ?? '' };
  },
  set: (p) => {
    if (earlyPick.api) return earlyPick.api.set(p);
    if (p.character) p = { costume: CHARACTERS[p.character].costumes[0] };
    Object.assign(earlyPick.queued, p);
    return Promise.resolve();
  },
});

async function main() {
  const physics = await Physics.create();
  setLoadText('Building the backyard…');
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
  setAnisoCap(PRESETS[startQuality].aniso);

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
  const lantern = env.lamps.find((L) => L.name === 'lantern');
  const blobs = new BlobShadows(scene); // stand-in shadows when the preset draws no shadow maps
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

  // ------------------------------------------------------------ assets v2: Sergey, the two yards, trees
  // Everything loads in parallel while the physics scene is being built; the loading screen waits
  // for it (see "start" below). If a GLB fails, the old procedural person keeps working.
  const S0 = game.p.settings;
  {
    const sid = SETTINGS[S0.setting] ? S0.setting : 'nj', h = S0.hour ?? 16.5;
    const v = h >= 20.5 || h < 5.5 ? 'night' : h >= 17.3 || h < 7 ? 'dusk' : 'wide';
    loading.style.backgroundImage = `linear-gradient(rgba(10,8,5,0.72), rgba(10,8,5,0.85)), url(assets/art/${sid}/${sid}_background_${v}.webp)`;
    loading.style.backgroundSize = 'cover';
    loading.style.backgroundPosition = 'center';
  }
  // Character: costume ids are unique per character (tee / jacket = Sergey, camo / bomber = Alex).
  // Only the saved character's costume loads at start; the others load when picked.
  if (earlyPick.queued.costume) S0.costume = earlyPick.queued.costume;
  if (earlyPick.queued.name !== undefined) S0.playerName = earlyPick.queued.name;
  if (!COSTUMES[S0.costume]) S0.costume = 'tee';
  S0.character = charOf(S0.costume);
  const sergey = new Sergey(scene); // the local player's rig (either character; the name stuck)
  const world = new YardWorld({ scene, env, physics, block, camera });
  const woodchips = new WoodChips(scene);
  setLoadText(`Loading ${CHARACTERS[S0.character].name}, the yard and the trees…`);
  let charPending = null; // latest character / costume swap in flight
  let coopG = null; // co-op glue (js/coopgame.js), created once the player exists
  let markReady;
  const worldReady = new Promise((r) => { markReady = r; }); // the scene is built and running
  const charReady = sergey.setCostume(S0.costume)
    .then(() => sergey.setAxe(game.axeStats.model ?? 'sergey'))
    .then(() => onCharacterLoaded());
  const yardReady = world.setSetting(SETTINGS[S0.setting] ? S0.setting : 'nj');
  // Sergey's meshes manage their own shadow flag (post.js only toggles static scenery).
  function onCharacterLoaded() {
    sergey.root.traverse((o) => { if (o.isMesh) o.userData.castOrig = false; });
    patchScene(sergey.root);
    humanoid.group.visible = false; // the procedural person stays only as the physics proxy / fallback
    axe.group.visible = false;
    return player.refreshBlade();
  }

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
  game.on('hit', (h) => { if (h.result === 'split' && h.boss) player.cheer = 2.8; });
  game.on('levelUp', () => { player.cheer = 2.6; });
  game.on('axe', (a) => {
    sergey.setAxe(a.model ?? 'sergey').then(() => { patchScene(sergey.root); sergey.root.traverse((o) => { if (o.isMesh) o.userData.castOrig = false; }); return player.refreshBlade(); });
    coopG?.profileChanged();
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
    setAnisoCap(P.aniso, scene);
    setMipFilter(!!P.propLow, scene);
    weather.setQuality({ precipScale: P.precip, cloudOctaves: P.cloudOctaves, envUpdates: P.envUpdates, ibl: P.ibl });
    for (const L of env.lamps) L.light.visible = P.pointLights || L.name === 'lantern';
    sparkLight.visible = P.pointLights; // every point light costs in every lit shader on software GL
    world.applyQuality(P);
    LOW.on = !!P.propLow; // rounds made from now on start out Lambert on Low / Potato
    // Low / Potato draw the procedural NJ house / fence / neighbours as one mesh per material.
    if (P.propLow && !env.njBatch) env.njBatch = mergeStatic(env.njGroup, { exclude: [env.procGrill, env.procTable].filter(Boolean) });
    setMerged(env.njBatch, !!P.propLow);
    for (const r of [env.ground, env.dirt, env.njGroup, env.woodpile?.mesh]) setLowShading(r, !!P.propLow);
    for (const m of [logs.log?.mesh, ...logs.pieces.map((p) => p.mesh), ...game.queue.map((it) => it.mesh)]) setLowShading(m, !!P.propLow);
    blobs.setEnabled(!P.shadows);
    env.ground.geometry = P.propLow ? env.groundGeo.lo : env.groundGeo.hi;
    sergey.setLow(!!P.propLow);
    coopG?.setLow(!!P.propLow);
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
      // Esc also closes the co-op menu (coop/ui.js panel, not a .modal), before leaving the block.
      closeModals: () => {
        for (const m of document.querySelectorAll('.modal')) m.classList.add('hidden');
        const cp = $('coop-panel');
        if (cp && !cp.hidden) { cp.hidden = true; $('coop-toggle')?.setAttribute('aria-expanded', 'false'); }
      },
      key: (code) => onKey(code),
      modalOpen: () => modalOpen() || $('coop-panel')?.hidden === false,
      leaveStump: () => enterYard(),
      yardKey: (code) => player.yardKey(code),
    },
  });

  const player = new Player({
    scene, camera, controls, dom: renderer.domElement, sergey, world, game, swingCtl, logs, audio, woodchips, dust, env, weather,
    blockTop: BLOCK.H, ui: { enterStump: () => enterStump(), modalOpen: () => modalOpen() },
  });

  function modalOpen() { return [...document.querySelectorAll('.modal')].some((m) => !m.classList.contains('hidden')); }

  // ------------------------------------------------------------ yard / stump modes
  // Stump: the original splitting game (orbit camera around the block). Yard: Sergey walks around.
  function enterYard() {
    if (player.mode === 'yard') return true;
    if (swingCtl.busy) { game.toast('Finish the swing first', 'info'); return false; }
    game.cancelMeter();
    ui.camTween = null;
    player.setMode('yard');
    input.yard = true;
    document.body.classList.add('yard');
    updateModeButton();
    player.snapCamera();
    if (!S.seenYard) { S.seenYard = true; game.toast('Yard: W A S D to walk, Shift to run, right-drag to look. Face a tree and click to chop. E at the block to split.', 'info', true); }
    return true;
  }
  function enterStump() {
    if (player.mode === 'stump') return true;
    if (player.busy) return false;
    player.setMode('stump');
    input.yard = false;
    document.body.classList.remove('yard');
    if (!swingCtl.busy) swingCtl.setReady();
    // Glide the camera back to the block view.
    const yaw = game.aim.yaw;
    const rot = (v) => v.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    ui.camYaw = 0;
    ui.camTween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: rot(CAMERA_HOME.pos), t1: rot(CAMERA_HOME.target), k: 0 };
    controls.enabled = false;
    updateModeButton();
    return true;
  }
  function updateModeButton() {
    const b = $('btn-mode');
    if (!b) return;
    const yard = player.mode === 'yard';
    b.innerHTML = yard ? 'Split logs <kbd>E</kbd>' : 'Walk the yard <kbd>Esc</kbd>';
    b.title = yard ? 'Walk to the chopping block and press E (or click here)' : 'Walk around the yard and chop trees (Esc)';
    $('hint').textContent = yard
      ? 'W A S D walk · Shift run · right-drag / arrows look · wheel zoom · click or Space chops the ringed tree · E at the block splits logs'
      : 'Mouse: aim on the log top · hold LMB to charge, drag ↔ to turn the blade, release to swing · right-drag orbit · wheel zoom · Esc walks the yard';
  }
  // Backdrop art for a setting at the current time of day (wide / dusk / night).
  function backdropUrl(id) {
    const h = weather.hour;
    const v = h >= 20.5 || h < 5.5 ? 'night' : h >= 17.3 || h < 7 ? 'dusk' : 'wide';
    return `assets/art/${id}/${id}_background_${v}.webp`;
  }
  let postcardT = 0;
  function showPostcard(id) {
    const pc = $('postcard');
    pc.querySelector('img').src = backdropUrl(id);
    pc.querySelector('figcaption').textContent = `Greetings from the ${SETTINGS[id].name}`;
    pc.classList.remove('hidden');
    clearTimeout(postcardT);
    postcardT = setTimeout(() => pc.classList.add('hidden'), 3200);
  }
  async function setSetting(id) {
    const s = await world.setSetting(id);
    S.setting = world.id;
    $('sel-setting').value = world.id;
    if (player.mode === 'yard') world.collide(player.pos, 0.35, player.queueObstacles());
    game.save();
    return s;
  }
  // Costume (any character's id: picking Alex's bomber also switches to Alex).
  async function setCostume(id) {
    if (!COSTUMES[id]) id = CHARACTERS[charOf(S.costume)].costumes[0];
    S.costume = id;
    S.character = charOf(id);
    refreshPlayerUi();
    const job = (async () => {
      await sergey.setCostume(id);
      if (sergey.costume !== id) return sergey.costume; // superseded by a newer pick
      await onCharacterLoaded();
      return sergey.costume;
    })();
    charPending = job;
    const out = await job;
    if (charPending === job) charPending = null;
    game.save();
    coopG?.profileChanged();
    refreshPlayerUi();
    return out;
  }
  // Character: Sergey or Alex, in his default outfit (tee / camo).
  function setCharacter(c) {
    if (!CHARACTERS[c]) c = 'sergey';
    return setCostume(CHARACTERS[c].costumes[0]).then(() => sergey.character);
  }
  const playerName = () => S.playerName || CHARACTERS[S.character]?.name || 'Sergey';
  function setPlayerName(n) {
    S.playerName = String(n || '').slice(0, 16);
    game.save();
    coopG?.profileChanged();
    refreshPlayerUi();
  }
  const pickerApi = {
    get: () => ({ character: S.character, costume: S.costume, name: S.playerName || '' }),
    set: (p) => {
      if (p.name !== undefined) { setPlayerName(p.name); return Promise.resolve(); }
      if (p.character) return p.character === S.character ? Promise.resolve() : setCharacter(p.character);
      if (p.costume) return setCostume(p.costume);
      return Promise.resolve();
    },
  };
  const pickers = [];
  function refreshPlayerUi() {
    const C = CHARACTERS[S.character];
    const el = $('h-player');
    if (el) el.textContent = `${C.name} · ${COSTUMES[S.costume].name}`;
    for (const pk of pickers) pk.render();
  }

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

  $('btn-mode').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (player.mode === 'yard') {
      enterStump(); // the button walks him straight back to the block
    } else enterYard();
  });
  $('sel-setting').addEventListener('change', (e) => {
    e.target.blur();
    const id = e.target.value;
    // Co-op: both players must stay in the host's yard (the protocol has no world change).
    if (coopG?.coop.inSession()) { e.target.value = world.id; game.toast('Leave co-op (Disconnect) to switch yards', 'warn', true); return; }
    game.toast(`Loading the ${SETTINGS[id].name}…`, 'info');
    setSetting(id).then(() => showPostcard(id)).catch((err) => { console.warn(err); game.toast('Could not load that yard', 'warn'); });
  });
  $('sel-setting').value = SETTINGS[S0.setting] ? S0.setting : 'nj';
  $('btn-player').addEventListener('click', (e) => { e.currentTarget.blur(); toggleModal('player'); });
  earlyPick.api = pickerApi;
  pickers.push(startPicker);
  pickers.push(new Picker($('player-pick'), { ...pickerApi, preview: $('player-art'), idPrefix: 'pp' }));
  refreshPlayerUi();
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
    woodchips.setViewport(window.innerHeight, pr, camera);
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
      const t0 = performance.now();
      tick(now);
      ui.tickMs = (ui.tickMs ?? 0) * 0.9 + (performance.now() - t0) * 0.1; // CPU time per frame (telemetry)
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
    // Low / Potato keep only the block lantern's point light, and only while it is actually lit:
    // an unlit point light still costs a light loop in every lit fragment on software GL.
    if (!pipeline.preset.pointLights && lantern) {
      const on = weather.lampLevel > (lantern.light.visible ? 0.01 : 0.03);
      if (on !== lantern.light.visible) lantern.light.visible = on;
    }
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

    // Sergey (stump pose or yard locomotion), the yard's trees and the wood-chip sprites.
    player.update(dtReal, dtReal * scale); // sim time (slow-mo / hit-stop) drives the stump follow-through
    coopG?.update(now, dtReal); // co-op: send our state, place + animate the partner
    world.update(dtReal, camera, weather);
    blobs.update(sergey.root.position, sergey.root.rotation.y, world.field, weather.daylight * (1 - 0.7 * Math.min(1, weather.cur.clouds)), coopG?.remoteRoot());
    woodchips.update(dtReal, windV);
    woodchips.uniforms.uLight.value.setScalar(0.25 + 0.85 * weather.daylight);
    // The sun's shadow frustum follows Sergey around the yard (and sits on the block otherwise).
    if (player.mode === 'yard') env.sun.target.position.set(Math.round(player.pos.x), 0, Math.round(player.pos.z));
    else env.sun.target.position.set(0, 0, 0.5);
    env.sun.target.updateMatrixWorld();

    if (player.mode === 'stump') {
      // Camera follows blade-direction changes around the block, plus impact shake.
      camera.position.sub(shakeOff);
      if (ui.camTween) {
        const T = ui.camTween;
        T.k = Math.min(1, T.k + dtReal / 0.7);
        const e = T.k * T.k * (3 - 2 * T.k);
        camera.position.lerpVectors(T.p0, T.p1, e);
        controls.target.lerpVectors(T.t0, T.t1, e);
        if (T.k >= 1) { ui.camTween = null; controls.enabled = true; }
      }
      if (Math.abs(ui.camYaw) > 1e-4) {
        const step = ui.camYaw * (1 - Math.exp(-8 * dtReal));
        ui.camYaw -= step;
        const pivot = new THREE.Vector3(0, 0, 0);
        camera.position.sub(pivot).applyAxisAngle(THREE.Object3D.DEFAULT_UP, step).add(pivot);
        controls.target.sub(pivot).applyAxisAngle(THREE.Object3D.DEFAULT_UP, step).add(pivot);
      }
      if (ui.camTween) camera.lookAt(controls.target); else controls.update();
      const sh = game.fx.shake * game.fx.shake * 0.012;
      shakeOff.set(Math.sin(now * 0.091) * sh, Math.sin(now * 0.077 + 1) * sh, Math.sin(now * 0.083 + 2) * sh);
      camera.position.add(shakeOff);
    } else shakeOff.set(0, 0, 0);
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
      updatePrompt();
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

  // On-screen prompt in the yard: the ringed tree (with chop progress) or the chopping block.
  function updatePrompt() {
    const el = $('prompt');
    let html = '';
    if (player.mode === 'yard') {
      const t = player.target?.tree;
      if (t && (t.state === 'standing' || t.state === 'chopping')) {
        const need = t.meta.hitsToFell, done = Math.min(need, Math.round(t.hits * 10) / 10);
        const name = t.species[0].toUpperCase() + t.species.slice(1);
        html = `🪓 ${name} — <kbd>Click</kbd> or <kbd>Space</kbd> to chop<small>${done} / ${need} hits · about ${Math.round(t.meta.height * t.scale)} m tall</small><span class="pbar"><i style="width:${Math.round((100 * done) / need)}%"></i></span>`;
      } else if (player.nearBlock()) html = 'Chopping block — press <kbd>E</kbd> or click it to split logs';
      else if (player.busy) html = '';
    }
    if (html !== el.dataset.h) { el.innerHTML = html; el.dataset.h = html; }
    el.classList.toggle('hidden', !html);
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
    if (player.mode === 'yard') { player.act = null; enterStump(); } // the hook always swings at the block
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
    get tickMs() { return ui.tickMs; },
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
    weather, pipeline, game, swing: swingCtl, logs, world,
    render: () => pipeline.render(),
    camera, controls, scene, renderer,
  };


  // ------------------------------------------------------------ assets-v2 test hooks
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 10000) => { const t0 = performance.now(); while (!fn() && performance.now() - t0 < ms) await sleep(50); return fn(); };
  const liveTree = (t) => t && (t.state === 'standing' || t.state === 'chopping');
  function nearestTree(filter = liveTree) {
    const f = world.field;
    if (!f) return null;
    let best = null, bd = Infinity;
    const p = sergey.root.position;
    for (const t of f.trees) {
      if (!filter(t)) continue;
      const d = Math.hypot(t.position.x - p.x, t.position.z - p.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best ? { tree: best, distance: bd } : null;
  }
  function treeStats() {
    const s = { standing: 0, chopping: 0, falling: 0, felled: 0 };
    for (const t of world.field?.trees ?? []) {
      if (t.state === 'gone') continue;
      s[t.state === 'fallen' || t.state === 'stump' ? 'felled' : t.state]++;
    }
    return s;
  }
  // Put Sergey at a tree's approach point facing it, camera behind him.
  function teleportNearTree(tree = null) {
    if (player.mode !== 'yard') enterYard();
    if (player.mode !== 'yard') return null;
    const f = world.field;
    if (!f) return null;
    const cands = tree ? [tree] : f.trees.filter((t) => liveTree(t) && world.insideBounds(t.position.x, t.position.z, 0.3))
      .sort((a, b) => a.position.distanceTo(player.pos) - b.position.distanceTo(player.pos));
    // Is the follow camera (4 m behind, ~2 m up) clear of every tree crown from this spot?
    const camClear = (p, yaw) => {
      const cx = p.x - Math.sin(yaw) * 3.9, cz = p.z - Math.cos(yaw) * 3.9;
      if (!world.insideBounds(cx, cz, -6)) return false;
      return !f.trees.some((o) => (o.state === 'standing' || o.state === 'chopping')
        && Math.hypot(cx - o.position.x, cz - o.position.z) < o.meta.crownRadius * o.scale * 0.8 && (o.meta.crownBase ?? 2) * o.scale < 2.3);
    };
    for (const t of cands) {
      const base = Math.atan2(player.pos.x - t.position.x, player.pos.z - t.position.z);
      let fallback = null, chosen = null;
      for (let k = 0; k < 12 && !chosen; k++) {
        const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
        const d = t.meta.approachDistance * t.scale;
        const p = new THREE.Vector3(t.position.x + Math.sin(a) * d, 0, t.position.z + Math.cos(a) * d);
        if (!world.insideBounds(p.x, p.z, 0.5)) continue;
        const q = world.collide(p.clone(), 0.35, player.queueObstacles());
        if (q.distanceTo(p) > 0.02) continue;
        if (camClear(p, Math.atan2(t.position.x - p.x, t.position.z - p.z))) chosen = p;
        else fallback ??= p;
      }
      const p = chosen ?? fallback;
      if (p) {
        player.act = null;
        player.pos.copy(p);
        player.speed = 0;
        player.yaw = Math.atan2(t.position.x - p.x, t.position.z - p.z);
        player.camYaw = player.yaw;
        player.camPitch = 0.16;
        sergey.root.position.copy(p);
        sergey.root.rotation.y = player.yaw;
        player.snapCamera();
        return t.id;
      }
    }
    return null;
  }
  window.__v2 = { sergey, world, player, woodchips, env }; // debugging handles
  window.chopperTest = {
    ready: () => !!(window.simReady && sergey.loaded && world.field && world.field.trees.length && player.rows.chop),
    setSetting: (id) => setSetting(id).then(() => world.id),
    // Accepts the current character's ids (tee / jacket for Sergey, camo / bomber for Alex); another
    // character's id switches character too.
    setCostume: (id) => setCostume(id),
    setCharacter: (c) => setCharacter(c),
    setAxe: async (model) => {
      const a = AXE_FOR_MODEL(model);
      if (!game.p.owned.includes(a.id)) { game.p.owned.push(a.id); game.p.sharp[a.id] = a.sharp; }
      await waitFor(() => !swingCtl.busy && !player.busy, 8000);
      game.equipAxe(a.id);
      await sergey.setAxe(a.model);
      await player.refreshBlade();
      return a.model;
    },
    setQuality: (q) => { applyQuality(q, true); return pipeline.presetId; },
    enterYard: async () => { await waitFor(() => !swingCtl.busy, 8000); enterYard(); return player.mode; },
    enterStump: async () => { await waitFor(() => !player.busy, 8000); enterStump(); await sleep(50); return player.mode; },
    teleportNearTree: () => teleportNearTree(),
    chopTree: async () => {
      if (player.mode !== 'yard') enterYard();
      let tree = player.target?.tree;
      if (!liveTree(tree)) { const id = teleportNearTree(); tree = id == null ? null : world.field.trees[id]; }
      if (!tree) return { felled: false, hits: 0 };
      let swings = 0;
      while (swings < 30 && liveTree(tree)) {
        await waitFor(() => !player.busy, 6000);
        if (!liveTree(tree)) break;
        // keep facing this trunk so pick() selects it
        player.yaw = Math.atan2(tree.position.x - player.pos.x, tree.position.z - player.pos.z);
        const pick = world.field.pick(player.pos, player.forward(), 1.75, 0.45);
        if (!pick || pick.tree !== tree) teleportNearTree(tree);
        if (player.swingAtTree(true)) swings++;
        await sleep(30);
      }
      await waitFor(() => !player.busy, 6000);
      await waitFor(() => tree.state === 'fallen' || tree.state === 'stump', 9000);
      return { felled: !liveTree(tree), hits: Math.round(tree.hits * 100) / 100, swings, species: tree.species, id: tree.id };
    },
    state: () => {
      const n = nearestTree();
      const clip = sergey.current ? sergey.cur?.actions[sergey.current]?.getClip().name : null;
      let attached = null;
      const ax = sergey.cur?.inner.children[0];
      for (let o = ax; o; o = o.parent) if (o.isBone) { attached = o.name; break; }
      return {
        setting: world.id, character: sergey.character, costume: sergey.costume, playerName: playerName(), axe: game.axeStats.model, axeName: game.axeStats.name, quality: pipeline.presetId,
        mode: player.mode, player: { x: +sergey.root.position.x.toFixed(3), y: +sergey.root.position.y.toFixed(3), z: +sergey.root.position.z.toFixed(3) },
        anim: clip, characterLoaded: !!(sergey.loaded && sergey.cur?.model.parent && !charPending), axeAttachedTo: attached,
        trees: treeStats(),
        nearestTree: n ? { id: n.tree.id, species: n.tree.species, x: +n.tree.position.x.toFixed(3), z: +n.tree.position.z.toFixed(3), radius: +n.tree.radius.toFixed(3), distance: +n.distance.toFixed(3) } : null,
        fps: +fpsNow.toFixed(1),
      };
    },
  };

  // ------------------------------------------------------------ co-op (./coop/, js/coopgame.js)
  // Nothing touches the network until Co-op > Host / Join (PeerJS is loaded lazily by the module).
  coopG = setupCoop({
    scene, camera, renderer, game, player, world, sergey, swingCtl, logs, ready: worldReady, setSetting,
    isLow: () => !!pipeline.preset?.propLow,
    profile: () => ({ name: playerName(), character: S.character, costume: S.costume, axe: game.axeStats.model ?? 'sergey' }),
  });
  const coop = coopG.coop;
  const coopUi = coop.mountUI({ mount: $('actions') });
  {
    // The toggle sits in the actions panel; the menu itself floats above everything (also above
    // the start screen), so it gets its own .coop-root wrapper on <body>.
    const wrap = document.createElement('div');
    wrap.className = 'coop-root coop-float';
    wrap.appendChild(coopUi.el.panel);
    document.body.appendChild(wrap);
    for (const ev of ['keydown', 'keyup', 'keypress']) wrap.addEventListener(ev, (x) => { if (x.target === coopUi.el.input) x.stopPropagation(); });
    coopUi.el.panel.querySelector('h2').insertAdjacentHTML('afterend', '<button type="button" class="coop-x" aria-label="Close the co-op menu">✕</button>');
    coopUi.el.panel.querySelector('.coop-x').addEventListener('click', () => coopUi.close());
    // Voice chat HUD (mute button + partner speaking indicator): the module pins it bottom-left,
    // which is this game's conditions panel. Put it in the HUD grid instead (bottom-centre column,
    // left-aligned, above the meter / hint), so the grid keeps it clear of every panel at any size.
    if (coopUi.el.vHud) {
      const vw = document.createElement('div');
      vw.className = 'coop-root coop-voice-slot';
      vw.appendChild(coopUi.el.vHud);
      $('bottombar').prepend(vw);
    }
  }
  $('btn-start-coop').addEventListener('click', () => { startUi.touched = true; coopUi.open(); });
  window.chopperTest.coop = coop.testHook({ fellTree: () => window.chopperTest.chopTree() });
  window.__v2.coop = coopG;

  // ------------------------------------------------------------ start
  // Wait for Sergey and the saved yard (they have been loading in parallel all along).
  const [charRes, yardRes] = await Promise.allSettled([charReady, yardReady]);
  if (charRes.status === 'rejected') { console.warn('Sergey failed to load, using the procedural person:', charRes.reason); }
  if (yardRes.status === 'rejected') { console.warn('Yard assets failed to load:', yardRes.reason); }
  while (charPending) await charPending.catch(() => {}); // a character picked on the start screen
  setLoadText('Ready');
  updateModeButton();
  const startPreset = S.quality === 'auto' || !S.quality ? detected.preset : S.quality;
  pipeline.auto = S.quality === 'auto' || !S.quality;
  pipeline.presetId = startPreset;
  patchScene(scene); // before applyQuality: Low swaps patched Standard materials for Lambert copies
  applyQuality(startPreset);
  game.rebuildQueue();
  game.nextLog(true);
  game.env.woodpile?.setPieces(game.p.woodpile);
  swingCtl.setReady();
  resetCamera();
  physics.step();
  renderer.compile(scene, camera);
  requestAnimationFrame((t) => { last = t; frame(t); });
  markReady();
  // Start screen: it gets out of the way as soon as everything is loaded, unless the player is
  // busy with the character picker; then it waits for Play (or a co-op connection).
  const begin = () => {
    if (startUi.started) return;
    startUi.started = true;
    loading.classList.add('hidden');
    setTimeout(() => loading.remove(), 600);
  };
  if (!startUi.touched) begin();
  else {
    const b = $('btn-play');
    b.disabled = false;
    b.textContent = 'Play ▶';
    b.addEventListener('click', begin);
    b.focus({ preventScroll: true });
    coop.on('change', () => { if (['hosting', 'connected'].includes(coop.uiModel().status)) begin(); });
  }
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
