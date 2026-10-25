import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  createGrassTextures,
  createCedarFenceTexture,
  createBarkTextures,
  createEndGrainTextures
} from './textures.js';
import {
  loadGLB,
  loadTexture,
  loadTreeLibForSpecies,
  createScaledPropInstance,
  SETTING_SPECIES
} from './assetsLoader.js';
import { TreeField } from '../assets/trees_v2/runtime/trees.js';
import { WIND, updateWind } from '../assets/trees_v2/runtime/wind.js';

export const YARD_HALF_EXTENT = 19.5;

const BACKDROP_URLS = {
  nj: {
    day: './assets/art/nj/nj_background_wide.webp',
    dusk: './assets/art/nj/nj_background_dusk.webp',
    night: './assets/art/nj/nj_background_night.webp'
  },
  tiraspol: {
    day: './assets/art/tiraspol/tiraspol_background_wide.webp',
    dusk: './assets/art/tiraspol/tiraspol_background_dusk.webp',
    night: './assets/art/tiraspol/tiraspol_background_night.webp'
  }
};

/**
 * Builds the Backyard Environment supporting two switchable asset-pack settings:
 * - Setting 1 ('nj'): Suburban NJ Backyard (sage shed_nj with white crossbuck doors,
 *   chopping_stump_nj on mulch decal, firewood_heap_nj, tarp_woodpile, arborvitae hedge,
 *   fence_privacy/splitrail, patio_set, grill_gas, swing_set, recycling_bin, house_wall/siding_wall,
 *   NJ wide/dusk/night backdrops, and pine/oak/maple/birch trees_v2).
 * - Setting 2 ('tiraspol'): Tiraspol Backyard, Transnistria (fence_planks with iron_tools_horseshoe,
 *   mangal, house_wall_grapevine, bench, lada_car, well, tomato_garden, 15m khrushchevka block,
 *   distant white & gold-domed cathedral 80-150m away, Tiraspol backdrops, and walnut/apricot/poplar/birch trees_v2).
 */
export function buildBackyardEnvironment(scene, world, materials) {
  const envGroup = new THREE.Group();
  envGroup.name = 'BackyardEnvironmentRoot';
  scene.add(envGroup);

  const grassTex = createGrassTextures();
  const fenceTex = createCedarFenceTexture();
  const barkTex = createBarkTextures('oak');
  const endGrainTex = createEndGrainTextures('oak');

  // 1. Dynamic Sky Dome Canvas Texture (expanded radius so distant 80-150m cathedral fits inside)
  const skyGeo = new THREE.SphereGeometry(240, 28, 20);
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 256;
  skyCanvas.height = 128;
  const skyCtx = skyCanvas.getContext('2d');

  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const skyMat = new THREE.MeshBasicMaterial({
    map: skyTexture,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  envGroup.add(skyDome);

  // 2. Distant Curved Panoramic Backdrop Cards (matched to setting & time of day: day / dusk / night)
  const backdropMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    fog: false
  });
  // Place curved 2:1 backdrop arc at radius 155m (behind the 92m Tiraspol Cathedral)
  const backdropGeo = new THREE.CylinderGeometry(
    155,
    155,
    38,
    40,
    1,
    true,
    Math.PI * 0.55,
    Math.PI * 0.9
  );
  // Invert cylinder normals to face inward toward the yard
  backdropGeo.scale(-1, 1, 1);
  const backdropMesh = new THREE.Mesh(backdropGeo, backdropMat);
  backdropMesh.position.set(0, 8, 0);
  backdropMesh.visible = false;
  envGroup.add(backdropMesh);

  // 3. Lawn Ground Mesh + Physics Ground Plane
  const groundGeo = new THREE.PlaneGeometry(260, 260, 4, 4);
  const groundMat = new THREE.MeshLambertMaterial({
    map: grassTex.map
  });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  groundMesh.name = 'LawnGround';
  envGroup.add(groundMesh);

  const groundBody = new CANNON.Body({
    mass: 0,
    material: materials.groundPhysMat,
    shape: new CANNON.Plane()
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.userData = { label: 'GroundPlane' };
  world.addBody(groundBody);

  // 4. Mulch & Woodchips Decal Plane under the Chopping Stump (`tex_mulch_chips_decal.webp`, transparent, depthWrite: false)
  const mulchGeo = new THREE.PlaneGeometry(4.6, 4.6);
  const mulchMat = new THREE.MeshLambertMaterial({
    color: 0x7c6248,
    transparent: true,
    depthWrite: false,
    opacity: 0.96
  });
  const mulchPatch = new THREE.Mesh(mulchGeo, mulchMat);
  mulchPatch.rotation.x = -Math.PI / 2;
  mulchPatch.position.set(0, 0.006, 0.18);
  mulchPatch.receiveShadow = true;
  envGroup.add(mulchPatch);

  loadTexture('./assets/art/nj/tex_mulch_chips_decal.webp')
    .then((tex) => {
      mulchMat.map = tex;
      mulchMat.color.setHex(0xffffff);
      mulchMat.needsUpdate = true;
    })
    .catch(() => {});

  // Shared materials expected by AtmosphereController
  const warmWindowMat = new THREE.MeshStandardMaterial({
    color: 0x51687d,
    emissive: 0xffc870,
    emissiveIntensity: 0.45,
    roughness: 0.25
  });
  const lanternBulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d1,
    emissive: 0xffb347,
    emissiveIntensity: 1.5,
    roughness: 0.2
  });

  // Yard Lantern Post beside Chopping Station
  const lanternGroup = buildYardLanternPost(lanternBulbMat);
  envGroup.add(lanternGroup);

  // Weather-Reactive Puddles (visible during Rain)
  const { puddleGroup, rippleRings } = buildRainPuddles();
  envGroup.add(puddleGroup);

  // Weather-Reactive Snow & Frost Blankets (visible during Snow)
  const snowGroup = buildSnowBlankets();
  envGroup.add(snowGroup);

  // Dynamic Chimney / Yard Woodsmoke Plume
  const { smokeGroup, smokePuffs } = buildChimneySmokePlume();
  envGroup.add(smokeGroup);

  // Backyard Fieldstone Patio Firepit (stoked by Kindling Quarter-Chops & [B] Bonfire action)
  const {
    firepitGroup,
    fireFlames,
    fireEmbers,
    emberBedMat
  } = buildBackyardFirepit(world, materials.woodPhysMat);
  envGroup.add(firepitGroup);

  // Roadside Firewood Stand & Twine-Wrapped Bundle Shelf
  const {
    standGroup: firewoodStandGroup,
    orderBundleMeshes
  } = buildRoadsideFirewoodStand(
    fenceTex,
    barkTex,
    endGrainTex,
    world,
    materials.woodPhysMat
  );
  envGroup.add(firewoodStandGroup);

  // Animated 3D Backyard Bluejay & Squirrel Critters
  const { critterGroup, critters } = buildBackyardCritters();
  envGroup.add(critterGroup);

  // Setting-specific container groups ('nj' vs 'tiraspol')
  const settingPropsGroup = new THREE.Group();
  settingPropsGroup.name = 'ActiveSettingPropsGroup';
  envGroup.add(settingPropsGroup);

  let currentSetting = 'nj';
  let currentQuality = 'low';
  let currentTimePhase = 'dusk'; // 'day' | 'dusk' | 'night'
  let currentWorldSeed = 133701;
  let treeField = null;
  let propColliders = [];
  let cordwoodMeshes = [];
  const backdropTexCache = { nj: {}, tiraspol: {} };

  let currentSmokeIntensity = 0.45;
  let currentBonfireLevel = 1;
  let critterScatterTimer = 0;
  const swayTargets = [];

  // Base static colliders present in both yards (chopping stump, firepit, firewood stand, lantern)
  const baseColliders = [
    { type: 'circle', x: 0, z: 0.28, r: 0.48, label: 'chopping_stump' },
    { type: 'circle', x: 1.85, z: 0.95, r: 0.56, label: 'firepit' },
    { type: 'circle', x: -4.35, z: 1.35, r: 0.85, label: 'firewood_stand' },
    { type: 'circle', x: -1.03, z: 0.15, r: 0.22, label: 'lantern_post' }
  ];

  async function updateBackdropForTime(setting, timeOfDay = 17.15) {
    const phase =
      timeOfDay < 5.6 || timeOfDay > 19.4
        ? 'night'
        : timeOfDay < 8.2 || timeOfDay > 15.8
        ? 'dusk'
        : 'day';
    currentTimePhase = phase;
    const urls = BACKDROP_URLS[setting] || BACKDROP_URLS.nj;
    const url = urls[phase] || urls.day;
    try {
      if (!backdropTexCache[setting][phase]) {
        backdropTexCache[setting][phase] = await loadTexture(url);
      }
      if (currentSetting === setting && currentTimePhase === phase) {
        backdropMat.map = backdropTexCache[setting][phase];
        backdropMat.needsUpdate = true;
        backdropMesh.visible = true;
      }
    } catch {
      backdropMesh.visible = false;
    }
  }

  /**
   * Deterministic LCG PRNG for consistent tree placement per setting.
   */
  function makeSeededRandom(seedInit) {
    let seed = seedInit >>> 0;
    return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed >>> 8) / 16777216;
    };
  }

  /**
   * Populates 28 trees in `treeField` using `trees_v2` species for the active setting and `worldSeed`.
   * Uses a fixed tree count (28) across all quality presets so host and guest worlds are 100% identical.
   * Ensures a clear central walking lane (x in [-2.6, 2.6], z in [-5.5, 14.5]) and a clear
   * sightline corridor to the Tiraspol Cathedral so screenshots & locomotion checks always succeed.
   */
  function populateTreesForSetting(setting, lib, quality, worldSeed = currentWorldSeed) {
    if (treeField && treeField.group) {
      scene.remove(treeField.group);
    }

    const lodOpts =
      quality === 'low'
        ? { lod1Distance: 6.5, lod2Distance: 14.5, castShadow: false }
        : quality === 'medium'
        ? { lod1Distance: 12, lod2Distance: 26, castShadow: false }
        : { lod1Distance: 16, lod2Distance: 36, castShadow: false };

    treeField = new TreeField(scene, lib, lodOpts);
    const speciesList = SETTING_SPECIES[setting] || SETTING_SPECIES.nj;
    const baseSeed =
      worldSeed != null && Number.isFinite(Number(worldSeed))
        ? Number(worldSeed) >>> 0
        : setting === 'tiraspol'
        ? 20261024
        : 133701;
    currentWorldSeed = baseSeed;
    const mixedSeed =
      (baseSeed ^ (setting === 'tiraspol' ? 0x6c8e9cf5 : 0x00000000)) >>> 0;
    const rnd = makeSeededRandom(mixedSeed || 133701);

    const targetCount = 28;
    const placed = [];

    // 1. Place 6 guaranteed accessible standing trees inside the yard near the chopping zone
    // so `teleportNearTree()` always has nearby standing trees with unobstructed approach points.
    const guaranteedSpots = [
      { x: -3.6, z: 4.8, spIdx: 0, v: 0 },
      { x: 3.8, z: 5.2, spIdx: 1, v: 1 },
      { x: -5.4, z: -2.4, spIdx: 2, v: 2 },
      { x: 5.8, z: 2.2, spIdx: 3, v: 0 },
      { x: -3.8, z: 9.2, spIdx: 1, v: 2 },
      { x: 4.2, z: 9.6, spIdx: 0, v: 1 }
    ];

    for (const g of guaranteedSpots) {
      const sp = speciesList[g.spIdx % speciesList.length];
      if (!lib[sp]) continue;
      const scale = 0.94 + rnd() * 0.12;
      const t = treeField.place(sp, g.v % 3, g.x, g.z, {
        rotY: rnd() * Math.PI * 2,
        scale
      });
      placed.push(t);
    }

    // 2. Scatter remaining trees inside and outside the fence boundary
    let tries = 0;
    while (placed.length < targetCount && tries++ < 4000) {
      const sp = speciesList[Math.floor(rnd() * speciesList.length)];
      if (!lib[sp]) continue;
      const v = Math.floor(rnd() * 3);
      const meta = lib[sp].variants[v].meta;

      // Mix of in-yard trees (within 17.5m) and beyond-fence perimeter trees (up to 32m)
      const inYard = placed.length < 20;
      const range = inYard ? 17.2 : 30.0;
      const x = (rnd() * 2 - 1) * range;
      const z = (rnd() * 2 - 1) * range;

      // Keep central chopping zone & forward walking test corridor (x in [-2.6, 2.6], z in [-5.5, 14.5]) completely clear!
      if (Math.abs(x) < 2.6 && z > -5.5 && z < 14.5) continue;
      // Keep immediate chopping station & shed / props area clear
      if (Math.hypot(x, z) < 5.5) continue;
      // Keep sightline corridor to Tiraspol Cathedral & Khrushchevka (-X, -Z quadrant) clear of tall crowns
      if (setting === 'tiraspol' && x < 3.5 && x > -34.0 && z < -3.0 && z > -38.0) continue;

      // Avoid prop colliders
      if (
        propColliders.some((c) => {
          const cx = c.x;
          const cz = c.z;
          const cr = c.r || Math.max(c.hx || 1, c.hz || 1);
          return Math.hypot(x - cx, z - cz) < cr + 2.2;
        })
      ) {
        continue;
      }

      // Avoid overlapping other placed trees
      const minSpacing = Math.max(2.6, (meta.crownRadius || 2.5) * 0.68);
      if (
        placed.some(
          (p) => Math.hypot(p.position.x - x, p.position.z - z) < minSpacing
        )
      ) {
        continue;
      }

      const scale = 0.9 + rnd() * 0.2;
      placed.push(
        treeField.place(sp, v, x, z, {
          rotY: rnd() * Math.PI * 2,
          scale
        })
      );
    }

    return treeField;
  }

  /**
   * Builds a continuous, low-poly 4-sided perimeter fence around the yard boundary
   * so there are zero visual gaps and minimal triangle count.
   */
  function addContinuousPerimeterFence(parentGroup, height = 1.65, tintHex = 0xc8a47e) {
    const B = YARD_HALF_EXTENT + 0.5;
    const span = B * 2;
    const mat = new THREE.MeshLambertMaterial({
      map: fenceTex,
      color: tintHex
    });

    const walls = [
      { x: 0, z: -B, w: span, d: 0.14 },
      { x: 0, z: B, w: span, d: 0.14 },
      { x: -B, z: 0, w: 0.14, d: span },
      { x: B, z: 0, w: 0.14, d: span }
    ];
    for (const w of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w.w, height, w.d), mat);
      m.position.set(w.x, height * 0.5, w.z);
      parentGroup.add(m);
    }
  }

  /**
   * Loads and builds all GLB props, fences, backdrops, chopping stump, and `trees_v2`
   * for `'nj'` or `'tiraspol'`.
   */
  async function loadSetting(
    settingName = 'nj',
    quality = currentQuality,
    choppingStation = null,
    timeOfDay = 17.15,
    worldSeed = null
  ) {
    const targetSetting = settingName === 'tiraspol' ? 'tiraspol' : 'nj';
    currentSetting = targetSetting;
    currentQuality = quality || 'low';
    const effectiveSeed =
      worldSeed != null && Number.isFinite(Number(worldSeed))
        ? Number(worldSeed) >>> 0
        : targetSetting === 'tiraspol'
        ? 20261024
        : 133701;
    currentWorldSeed = effectiveSeed;

    // Clear previous setting props
    while (settingPropsGroup.children.length > 0) {
      settingPropsGroup.remove(settingPropsGroup.children[0]);
    }
    propColliders = [...baseColliders];
    cordwoodMeshes = [];

    const castShadow = false;

    // Kick off backdrop load in parallel
    updateBackdropForTime(targetSetting, timeOfDay);

    if (targetSetting === 'nj') {
      // Load NJ Backyard GLB models + NJ tree species in parallel
      const [
        treeLib,
        shedGltf,
        stumpNjGltf,
        chipsGltf,
        heapNjGltf,
        tarpGltf,
        arborvitaeGltf,
        fencePrivGltf,
        fenceRailGltf,
        patioGltf,
        grillGltf,
        swingGltf,
        binGltf,
        houseWallGltf,
        sidingWallGltf,
        wheelbarrowGltf,
        firewoodPileGltf,
        splitHalvesGltf
      ] = await Promise.all([
        loadTreeLibForSpecies(SETTING_SPECIES.nj),
        loadGLB('./assets/models/nj/shed_nj.glb'),
        loadGLB('./assets/models/nj/chopping_stump_nj.glb'),
        loadGLB('./assets/models/common/chips_scatter.glb'),
        loadGLB('./assets/models/nj/firewood_heap_nj.glb'),
        loadGLB('./assets/models/nj/tarp_woodpile.glb'),
        loadGLB('./assets/models/nj/arborvitae.glb'),
        loadGLB('./assets/models/nj/fence_privacy.glb'),
        loadGLB('./assets/models/nj/fence_splitrail.glb'),
        loadGLB('./assets/models/nj/patio_set.glb'),
        loadGLB('./assets/models/nj/grill_gas.glb'),
        loadGLB('./assets/models/nj/swing_set.glb'),
        loadGLB('./assets/models/nj/recycling_bin.glb'),
        loadGLB('./assets/models/nj/house_wall.glb'),
        loadGLB('./assets/models/nj/siding_wall.glb'),
        loadGLB('./assets/models/common/wheelbarrow.glb'),
        loadGLB('./assets/models/common/firewood_pile.glb'),
        loadGLB('./assets/models/common/split_log_halves.glb')
      ]);

      // Apply NJ chopping stump + scattered woodchips to ChoppingStation
      if (choppingStation && typeof choppingStation.applyGLBStump === 'function') {
        choppingStation.applyGLBStump(stumpNjGltf.scene, chipsGltf.scene);
      }

      // 1. Sage NJ Shed with white crossbuck double doors (`shed_nj.glb`, height 2.4m)
      // Placed right behind/beside the chopping zone so it's prominently framed in camera view
      const shed = createScaledPropInstance(shedGltf.scene, {
        targetHeight: 2.4,
        x: -2.4,
        z: -4.2,
        rotY: 0.35,
        castShadow
      });
      settingPropsGroup.add(shed.group);
      propColliders.push({ type: 'circle', x: -2.4, z: -4.2, r: 1.75, label: 'shed_nj' });

      // 2. Messy Split Firewood Heap (`firewood_heap_nj.glb`, height 0.7m) & Tarp Woodpile (`tarp_woodpile.glb`, height 1.1m)
      const heap = createScaledPropInstance(heapNjGltf.scene, {
        targetHeight: 0.7,
        x: -3.35,
        z: -2.1,
        rotY: 0.4,
        castShadow
      });
      settingPropsGroup.add(heap.group);
      propColliders.push({ type: 'circle', x: -3.35, z: -2.1, r: 0.9, label: 'firewood_heap_nj' });

      const tarp = createScaledPropInstance(tarpGltf.scene, {
        targetHeight: 1.1,
        x: 0.5,
        z: -4.3,
        rotY: -0.45,
        castShadow
      });
      settingPropsGroup.add(tarp.group);
      propColliders.push({ type: 'circle', x: 0.5, z: -4.3, r: 1.05, label: 'tarp_woodpile' });

      // 3. Common props around the chopping zone: Wheelbarrow (0.7m), Firewood Pile (0.85m), Split Log Halves (0.38m)
      const barrow = createScaledPropInstance(wheelbarrowGltf.scene, {
        targetHeight: 0.7,
        x: 2.1,
        z: -1.1,
        rotY: -0.8,
        castShadow
      });
      settingPropsGroup.add(barrow.group);
      propColliders.push({ type: 'circle', x: 2.1, z: -1.1, r: 0.65, label: 'wheelbarrow' });

      const pile = createScaledPropInstance(firewoodPileGltf.scene, {
        targetHeight: 0.85,
        x: -4.4,
        z: -2.6,
        rotY: 0.25,
        castShadow
      });
      settingPropsGroup.add(pile.group);
      propColliders.push({ type: 'circle', x: -4.4, z: -2.6, r: 0.85, label: 'firewood_pile' });

      const halves = createScaledPropInstance(splitHalvesGltf.scene, {
        targetHeight: 0.36,
        x: 0.95,
        z: 0.45,
        rotY: 0.6,
        castShadow
      });
      settingPropsGroup.add(halves.group);

      // 4. Suburban NJ Backyard props: Patio Set (2.4m), Gas Grill (1.25m), Swing Set (2.2m), Recycling Bin (1.1m)
      const patio = createScaledPropInstance(patioGltf.scene, {
        targetHeight: 2.4,
        x: 2.6,
        z: -6.2,
        rotY: -0.5,
        castShadow
      });
      settingPropsGroup.add(patio.group);
      propColliders.push({ type: 'circle', x: 2.6, z: -6.2, r: 1.5, label: 'patio_set' });

      const grill = createScaledPropInstance(grillGltf.scene, {
        targetHeight: 1.25,
        x: 4.2,
        z: -4.8,
        rotY: -0.9,
        castShadow
      });
      settingPropsGroup.add(grill.group);
      propColliders.push({ type: 'circle', x: 4.2, z: -4.8, r: 0.8, label: 'grill_gas' });

      const swing = createScaledPropInstance(swingGltf.scene, {
        targetHeight: 2.2,
        x: -6.6,
        z: -2.2,
        rotY: 0.75,
        castShadow
      });
      settingPropsGroup.add(swing.group);
      propColliders.push({ type: 'circle', x: -6.6, z: -2.2, r: 1.45, label: 'swing_set' });

      const bin = createScaledPropInstance(binGltf.scene, {
        targetHeight: 1.1,
        x: -4.6,
        z: -4.6,
        rotY: 0.35,
        castShadow
      });
      settingPropsGroup.add(bin.group);
      propColliders.push({ type: 'circle', x: -4.6, z: -4.6, r: 0.55, label: 'recycling_bin' });

      // 5. House Wall & Siding Wall framing the back-right patio
      const houseWall = createScaledPropInstance(houseWallGltf.scene, {
        targetHeight: 3.4,
        x: 5.2,
        z: -9.2,
        rotY: -0.55,
        castShadow
      });
      settingPropsGroup.add(houseWall.group);
      propColliders.push({ type: 'circle', x: 5.2, z: -9.2, r: 2.1, label: 'house_wall' });

      const sidingWall = createScaledPropInstance(sidingWallGltf.scene, {
        targetHeight: 2.7,
        x: 8.6,
        z: -7.5,
        rotY: -0.55,
        castShadow
      });
      settingPropsGroup.add(sidingWall.group);

      // 6. Arborvitae Hedge Row (`arborvitae.glb`, height 3.0m) framing the yard
      const hedgeCoords = [
        [-6.8, -7.8],
        [-4.8, -8.5],
        [1.8, -9.2]
      ];
      for (const [hx, hz] of hedgeCoords) {
        const arb = createScaledPropInstance(arborvitaeGltf.scene, {
          targetHeight: 3.0,
          x: hx,
          z: hz,
          rotY: (hx + hz) * 0.5,
          castShadow
        });
        settingPropsGroup.add(arb.group);
        propColliders.push({ type: 'circle', x: hx, z: hz, r: 0.75, label: 'arborvitae' });
      }

      // 7. Continuous Perimeter Fence + Hero Privacy & Split-Rail Fence Accents
      addContinuousPerimeterFence(settingPropsGroup, 1.75, 0xc89f74);

      const privFence = createScaledPropInstance(fencePrivGltf.scene, {
        targetHeight: 1.85,
        x: -5.8,
        z: -6.4,
        rotY: 0.45,
        castShadow: false
      });
      settingPropsGroup.add(privFence.group);

      for (const rx of [-3.6, 0, 3.6]) {
        const rail = createScaledPropInstance(fenceRailGltf.scene, {
          targetHeight: 1.2,
          x: rx,
          z: 15.6,
          rotY: 0,
          castShadow: false
        });
        settingPropsGroup.add(rail.group);
      }

      // 8. Populate NJ trees_v2 (pine, oak, maple, birch)
      populateTreesForSetting('nj', treeLib, currentQuality, effectiveSeed);
    } else {
      // Load Tiraspol Backyard (Transnistria) GLB models + Tiraspol tree species in parallel
      const [
        treeLib,
        stumpGltf,
        chipsGltf,
        fencePlanksGltf,
        horseshoeGltf,
        mangalGltf,
        grapeWallGltf,
        benchGltf,
        ladaGltf,
        wellGltf,
        tomatoGltf,
        khrushchevkaGltf,
        cathedralGltf,
        wheelbarrowGltf,
        firewoodPileGltf,
        splitHalvesGltf
      ] = await Promise.all([
        loadTreeLibForSpecies(SETTING_SPECIES.tiraspol),
        loadGLB('./assets/models/common/chopping_block.glb'),
        loadGLB('./assets/models/common/chips_scatter.glb'),
        loadGLB('./assets/models/tiraspol/fence_planks.glb'),
        loadGLB('./assets/models/tiraspol/iron_tools_horseshoe.glb'),
        loadGLB('./assets/models/tiraspol/mangal.glb'),
        loadGLB('./assets/models/tiraspol/house_wall_grapevine.glb'),
        loadGLB('./assets/models/tiraspol/bench.glb'),
        loadGLB('./assets/models/tiraspol/lada_car.glb'),
        loadGLB('./assets/models/tiraspol/well.glb'),
        loadGLB('./assets/models/tiraspol/tomato_garden.glb'),
        loadGLB('./assets/models/tiraspol/khrushchevka.glb'),
        loadGLB('./assets/models/tiraspol/cathedral.glb'),
        loadGLB('./assets/models/common/wheelbarrow.glb'),
        loadGLB('./assets/models/common/firewood_pile.glb'),
        loadGLB('./assets/models/common/split_log_halves.glb')
      ]);

      // Apply Tiraspol chopping block + scattered woodchips to ChoppingStation
      if (choppingStation && typeof choppingStation.applyGLBStump === 'function') {
        choppingStation.applyGLBStump(stumpGltf.scene, chipsGltf.scene);
      }

      // 1. Distant White & Gold-Domed Tiraspol Cathedral (`cathedral.glb`)
      // Placed at (-33.5, -1.4, -85.5) => distance = 91.8m (right inside the required 80-150m range!)
      // Framed so its white arched walls AND gleaming golden onion domes & crosses sit cleanly below the top HUD bar!
      const cathedral = createScaledPropInstance(cathedralGltf.scene, {
        targetHeight: 11.2,
        x: -33.5,
        y: -1.4,
        z: -85.5,
        rotY: 0.52,
        castShadow: false,
        receiveShadow: false,
        fog: false,
        emissiveBoost: 0.18
      });
      settingPropsGroup.add(cathedral.group);

      // 2. 5-Storey Soviet Khrushchevka Apartment Block (`khrushchevka.glb`, ~15m tall, background)
      // Placed at (-34, -0.8, -28) in the background so all 5 floors and roofline rise cleanly above the left-center yard!
      const khrushchevka = createScaledPropInstance(khrushchevkaGltf.scene, {
        targetHeight: 14.5,
        x: -34.0,
        y: -0.8,
        z: -28.0,
        rotY: 0.68,
        castShadow: false,
        receiveShadow: false,
        fog: false,
        emissiveBoost: 0.1
      });
      settingPropsGroup.add(khrushchevka.group);
      propColliders.push({
        type: 'circle',
        x: -34.0,
        z: -28.0,
        r: 5.5,
        label: 'khrushchevka'
      });

      // 3. Weathered Plank Fence behind the chopping zone with Iron Tools & Horseshoe hung on it
      const heroFenceCenter = createScaledPropInstance(fencePlanksGltf.scene, {
        targetHeight: 1.72,
        x: -2.4,
        z: -5.0,
        rotY: 0.58,
        castShadow
      });
      settingPropsGroup.add(heroFenceCenter.group);
      propColliders.push({ type: 'circle', x: -2.4, z: -5.0, r: 1.2, label: 'fence_planks_hero' });

      const horseshoe = createScaledPropInstance(horseshoeGltf.scene, {
        targetHeight: 0.85,
        x: -2.26,
        y: 0.82,
        z: -4.82,
        rotY: 0.58,
        castShadow
      });
      settingPropsGroup.add(horseshoe.group);

      // 4. Mangal Brazier (`mangal.glb`, 0.95m), Well (`well.glb`, 2.2m), Bench (`bench.glb`, 0.85m)
      const mangal = createScaledPropInstance(mangalGltf.scene, {
        targetHeight: 0.95,
        x: -2.1,
        z: -1.6,
        rotY: 0.5,
        castShadow
      });
      settingPropsGroup.add(mangal.group);
      propColliders.push({ type: 'circle', x: -2.1, z: -1.6, r: 0.65, label: 'mangal' });

      const well = createScaledPropInstance(wellGltf.scene, {
        targetHeight: 2.2,
        x: 1.55,
        z: -4.1,
        rotY: -0.45,
        castShadow
      });
      settingPropsGroup.add(well.group);
      propColliders.push({ type: 'circle', x: 1.55, z: -4.1, r: 1.05, label: 'well' });

      const bench = createScaledPropInstance(benchGltf.scene, {
        targetHeight: 0.85,
        x: -4.2,
        z: -2.5,
        rotY: 0.65,
        castShadow
      });
      settingPropsGroup.add(bench.group);
      propColliders.push({ type: 'circle', x: -4.2, z: -2.5, r: 0.85, label: 'bench' });

      // 5. Lada Car (`lada_car.glb`, 4.1m long), Tomato Garden (`tomato_garden.glb`, 1.6m), House Wall with Grapevine (`house_wall_grapevine.glb`, 3.4m)
      const lada = createScaledPropInstance(ladaGltf.scene, {
        targetLength: 4.1,
        x: -6.2,
        z: -5.4,
        rotY: 0.52,
        castShadow
      });
      settingPropsGroup.add(lada.group);
      propColliders.push({ type: 'circle', x: -6.2, z: -5.4, r: 2.1, label: 'lada_car' });

      const tomato = createScaledPropInstance(tomatoGltf.scene, {
        targetHeight: 1.6,
        x: 1.6,
        z: -3.1,
        rotY: -0.55,
        castShadow
      });
      settingPropsGroup.add(tomato.group);
      propColliders.push({ type: 'circle', x: 1.6, z: -3.1, r: 1.2, label: 'tomato_garden' });

      const grapeWall = createScaledPropInstance(grapeWallGltf.scene, {
        targetHeight: 3.4,
        x: 2.8,
        z: -6.8,
        rotY: -0.68,
        castShadow
      });
      settingPropsGroup.add(grapeWall.group);
      propColliders.push({
        type: 'circle',
        x: 2.8,
        z: -6.8,
        r: 1.85,
        label: 'house_wall_grapevine'
      });

      // 6. Common props: Wheelbarrow (0.7m), Firewood Pile (0.85m), Split Log Halves (0.36m)
      const barrow = createScaledPropInstance(wheelbarrowGltf.scene, {
        targetHeight: 0.7,
        x: 2.15,
        z: -1.05,
        rotY: -0.75,
        castShadow
      });
      settingPropsGroup.add(barrow.group);
      propColliders.push({ type: 'circle', x: 2.15, z: -1.05, r: 0.65, label: 'wheelbarrow' });

      const pile = createScaledPropInstance(firewoodPileGltf.scene, {
        targetHeight: 0.85,
        x: -4.6,
        z: -4.2,
        rotY: 0.3,
        castShadow
      });
      settingPropsGroup.add(pile.group);
      propColliders.push({ type: 'circle', x: -4.6, z: -4.2, r: 0.85, label: 'firewood_pile' });

      const halves = createScaledPropInstance(splitHalvesGltf.scene, {
        targetHeight: 0.36,
        x: 0.92,
        z: 0.44,
        rotY: 0.5,
        castShadow
      });
      settingPropsGroup.add(halves.group);

      // 7. Continuous Perimeter Plank Fence (low-poly gap-free boundary)
      addContinuousPerimeterFence(settingPropsGroup, 1.55, 0x9c8c78);

      // 8. Populate Tiraspol trees_v2 (walnut, apricot, poplar, birch)
      populateTreesForSetting('tiraspol', treeLib, currentQuality, effectiveSeed);
    }

    return true;
  }

  async function rebuildTreesForSeed(seed, settingName = currentSetting) {
    const targetSetting = settingName === 'tiraspol' ? 'tiraspol' : 'nj';
    const speciesList = SETTING_SPECIES[targetSetting] || SETTING_SPECIES.nj;
    const treeLib = await loadTreeLibForSpecies(speciesList);
    populateTreesForSetting(targetSetting, treeLib, currentQuality, seed);
    return treeField;
  }

  /**
   * Updates `TreeField` LOD & shadow settings when graphics quality changes.
   */
  function applyQualityToEnvironment(quality = 'low') {
    currentQuality = quality;
    if (!treeField) return;
    if (quality === 'low') {
      treeField.lod1D = 6.5;
      treeField.lod2D = 14.5;
      treeField.castShadow = false;
    } else if (quality === 'medium') {
      treeField.lod1D = 12;
      treeField.lod2D = 26;
      treeField.castShadow = false;
    } else {
      treeField.lod1D = 16;
      treeField.lod2D = 36;
      treeField.castShadow = false;
    }
    treeField._dirty = true;
  }

  /**
   * Pushes player `pos` (Vector3, xz) out of all `TreeField` trunks/stumps, big yard props,
   * and clamps to the yard fence boundary.
   */
  function collidePlayer(pos, radius = 0.35) {
    if (treeField) {
      treeField.collide(pos, radius);
    }
    for (const c of propColliders) {
      if (c.type === 'circle') {
        const dx = pos.x - c.x;
        const dz = pos.z - c.z;
        const r = c.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const k = (r - d) / d;
          pos.x += dx * k;
          pos.z += dz * k;
        }
      }
    }
    pos.x = THREE.MathUtils.clamp(pos.x, -YARD_HALF_EXTENT, YARD_HALF_EXTENT);
    pos.z = THREE.MathUtils.clamp(pos.z, -YARD_HALF_EXTENT, YARD_HALF_EXTENT);
    return pos;
  }

  return {
    envGroup,
    groundBody,
    groundMesh,
    groundMat,
    mulchMat,
    skyDome,
    skyCanvas,
    skyCtx,
    skyTexture,
    warmWindowMat,
    lanternBulbMat,
    swayTargets,
    puddleGroup,
    rippleRings,
    snowGroup,
    smokeGroup,
    smokePuffs,
    firepitGroup,
    fireFlames,
    fireEmbers,
    emberBedMat,
    firewoodStandGroup,
    orderBundleMeshes,
    critterGroup,
    critters,
    loadSetting,
    rebuildTreesForSeed,
    updateBackdropForTime,
    applyQualityToEnvironment,
    collidePlayer,
    getSetting() {
      return currentSetting;
    },
    getWorldSeed() {
      return currentWorldSeed;
    },
    setWorldSeed(seed) {
      if (seed != null && Number.isFinite(Number(seed))) {
        currentWorldSeed = Number(seed) >>> 0;
      }
      return currentWorldSeed;
    },
    getTreeField() {
      return treeField;
    },
    updateTreesAndWind(camera, dt, elapsedTime, windStrength = 0.4) {
      WIND.uWindStrength.value = windStrength;
      updateWind(elapsedTime);
      if (treeField && camera) {
        treeField.update(camera, dt);
      }
    },
    getSurfaceAt(x, z) {
      const dStump = Math.hypot(x, z - 0.18);
      if (dStump < 2.2) return 'mulch';
      if (Math.hypot(x - 1.85, z - 0.95) < 1.3) return 'dirt';
      return 'grass';
    },
    getSmokeIntensity() {
      return currentSmokeIntensity;
    },
    getBonfireLevel() {
      return currentBonfireLevel;
    },
    setBonfireLevel(lvl = 1) {
      currentBonfireLevel = Math.max(1, Math.min(5, Number(lvl) || 1));
    },
    getCritterScatterTimer() {
      return critterScatterTimer;
    },
    tickCritterScatterTimer(dt = 0) {
      if (critterScatterTimer > 0) {
        critterScatterTimer = Math.max(0, critterScatterTimer - dt);
      }
      return critterScatterTimer;
    },
    scatterCritters(duration = 3.8) {
      critterScatterTimer = Math.max(critterScatterTimer, duration);
      return true;
    },
    updateFirewoodStand(ordersCompletedCount = 0, currentProgress = 0) {
      const visibleBundles = Math.min(
        orderBundleMeshes.length,
        Math.max(1, ordersCompletedCount * 2 + currentProgress)
      );
      for (let i = 0; i < orderBundleMeshes.length; i++) {
        orderBundleMeshes[i].visible = i < visibleBundles;
      }
    },
    updateCordwoodStack(logsSplitCount = 0, ordersCompletedCount = 0, currentProgress = 0) {
      const visibleBonus = Math.min(cordwoodMeshes.length, Math.max(0, logsSplitCount));
      for (let i = 0; i < cordwoodMeshes.length; i++) {
        cordwoodMeshes[i].visible = i < visibleBonus;
      }
      currentSmokeIntensity = Math.min(1.0, 0.4 + logsSplitCount * 0.05);
      this.updateFirewoodStand(ordersCompletedCount, currentProgress);
    }
  };
}

function buildYardLanternPost(lanternBulbMat) {
  const postGroup = new THREE.Group();
  postGroup.name = 'YardLanternPost';
  postGroup.position.set(-1.25, 0, 0.15);

  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x4a3525,
    roughness: 0.85
  });
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x22262a,
    roughness: 0.45,
    metalness: 0.8
  });

  const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.85, 0.09), woodMat);
  post.position.y = 0.925;
  post.castShadow = true;
  postGroup.add(post);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.05), woodMat);
  arm.position.set(0.14, 1.76, 0);
  postGroup.add(arm);

  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.09, 6), ironMat);
  cap.position.set(0.22, 1.69, 0);
  postGroup.add(cap);

  const bulb = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.045, 0.12, 8),
    lanternBulbMat
  );
  bulb.position.set(0.22, 1.60, 0);
  postGroup.add(bulb);

  return postGroup;
}

function buildRoadsideFirewoodStand(fenceTex, barkTex, endGrainTex, world, woodPhysMat) {
  const standGroup = new THREE.Group();
  standGroup.name = 'SuburbanRoadsideFirewoodStand';
  standGroup.position.set(-4.35, 0, 1.35);
  standGroup.rotation.y = 0.52;

  const cedarMat = new THREE.MeshStandardMaterial({
    map: fenceTex,
    roughness: 0.86
  });
  const signMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    roughness: 0.72
  });
  const cashBoxMat = new THREE.MeshStandardMaterial({
    color: 0x15803d,
    roughness: 0.4,
    metalness: 0.65
  });
  const twineMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.65
  });
  const logBarkMat = new THREE.MeshStandardMaterial({
    map: barkTex.map,
    roughness: 0.88
  });
  const logEndMat = new THREE.MeshStandardMaterial({
    map: endGrainTex.map,
    roughness: 0.8
  });

  [-0.78, 0.78].forEach((px) => {
    [-0.28, 0.28].forEach((pz) => {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 1.58, 0.075),
        cedarMat
      );
      post.position.set(px, 0.79, pz);
      post.castShadow = true;
      standGroup.add(post);
    });
  });

  [0.24, 0.76].forEach((sy) => {
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(1.64, 0.055, 0.64),
      cedarMat
    );
    shelf.position.set(0, sy, 0);
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    standGroup.add(shelf);
  });

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(1.82, 0.065, 0.82),
    cedarMat
  );
  roof.position.set(0, 1.62, 0);
  roof.rotation.x = 0.22;
  roof.castShadow = true;
  standGroup.add(roof);

  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(1.36, 0.24, 0.04),
    signMat
  );
  signBoard.position.set(0, 1.38, 0.31);
  standGroup.add(signBoard);

  const cashBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.22, 0.14),
    cashBoxMat
  );
  cashBox.position.set(0.84, 1.05, 0.22);
  cashBox.castShadow = true;
  standGroup.add(cashBox);

  const orderBundleMeshes = [];
  const stickGeo = new THREE.CylinderGeometry(0.052, 0.055, 0.38, 7);
  stickGeo.rotateX(Math.PI / 2);
  const stickMats = [logBarkMat, logEndMat, logEndMat];

  for (let b = 0; b < 8; b++) {
    const bundle = new THREE.Group();
    const row = Math.floor(b / 4);
    const col = b % 4;
    bundle.position.set(-0.54 + col * 0.36, 0.34 + row * 0.52, 0);

    [
      [-0.045, -0.02],
      [0.045, -0.02],
      [0, 0.045]
    ].forEach(([ox, oy]) => {
      const stick = new THREE.Mesh(stickGeo, stickMats);
      stick.position.set(ox, oy, 0);
      stick.castShadow = true;
      bundle.add(stick);
    });

    const strap = new THREE.Mesh(
      new THREE.TorusGeometry(0.088, 0.011, 6, 12),
      twineMat
    );
    strap.position.set(0, 0.01, 0);
    bundle.add(strap);

    bundle.visible = b === 0;
    standGroup.add(bundle);
    orderBundleMeshes.push(bundle);
  }

  const standBody = new CANNON.Body({ mass: 0, material: woodPhysMat });
  standBody.addShape(new CANNON.Box(new CANNON.Vec3(0.84, 0.8, 0.36)));
  standBody.position.set(-4.35, 0.8, 1.35);
  standBody.quaternion.setFromEuler(0, 0.52, 0);
  standBody.userData = { label: 'RoadsideFirewoodStandCollider' };
  world.addBody(standBody);

  return { standGroup, orderBundleMeshes };
}

function buildBackyardCritters() {
  const critterGroup = new THREE.Group();
  critterGroup.name = 'BackyardFenceCritters';
  const critters = [];

  const jayBlueMat = new THREE.MeshStandardMaterial({
    color: 0x2563eb,
    roughness: 0.55
  });
  const jayWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.65
  });
  const beakMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.4
  });

  const jayPerches = [
    { x: -5.8, y: 1.88, z: -19.8, rotY: 0.45, phase: 0.0 },
    { x: 6.1, y: 1.88, z: -19.8, rotY: -0.52, phase: 1.7 }
  ];

  jayPerches.forEach((p, idx) => {
    const jay = new THREE.Group();
    jay.name = `BackyardBluejay_${idx}`;
    jay.position.set(p.x, p.y, p.z);
    jay.rotation.y = p.rotY;

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.068, 10, 8),
      jayBlueMat
    );
    body.scale.set(0.88, 0.92, 1.35);
    jay.add(body);

    const breast = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 8, 8),
      jayWhiteMat
    );
    breast.position.set(0, -0.015, 0.032);
    jay.add(breast);

    const crest = new THREE.Mesh(
      new THREE.ConeGeometry(0.035, 0.075, 6),
      jayBlueMat
    );
    crest.position.set(0, 0.072, 0.025);
    crest.rotation.x = -0.55;
    jay.add(crest);

    const beak = new THREE.Mesh(
      new THREE.ConeGeometry(0.016, 0.048, 5),
      beakMat
    );
    beak.position.set(0, 0.035, 0.092);
    beak.rotation.x = Math.PI / 2;
    jay.add(beak);

    const leftWing = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.014, 0.08),
      jayBlueMat
    );
    leftWing.position.set(0.065, 0.01, 0);
    jay.add(leftWing);

    const rightWing = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.014, 0.08),
      jayBlueMat
    );
    rightWing.position.set(-0.065, 0.01, 0);
    jay.add(rightWing);

    critterGroup.add(jay);
    critters.push({
      type: 'bluejay',
      node: jay,
      leftWing,
      rightWing,
      homePos: new THREE.Vector3(p.x, p.y, p.z),
      homeRotY: p.rotY,
      phase: p.phase
    });
  });

  const squirrelMat = new THREE.MeshStandardMaterial({
    color: 0x78716c,
    roughness: 0.82
  });
  const squirrel = new THREE.Group();
  squirrel.name = 'BackyardGraySquirrel';
  const sqHome = new THREE.Vector3(19.8, 1.88, -2.4);
  squirrel.position.copy(sqHome);
  squirrel.rotation.y = -Math.PI / 2;

  const sBody = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.052, 0.09, 6, 8),
    squirrelMat
  );
  sBody.rotation.x = Math.PI / 2;
  squirrel.add(sBody);

  const sHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.046, 8, 8),
    squirrelMat
  );
  sHead.position.set(0, 0.038, 0.075);
  squirrel.add(sHead);

  const sTail = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.044, 0.14, 6, 8),
    squirrelMat
  );
  sTail.position.set(0, 0.085, -0.085);
  sTail.rotation.x = -0.45;
  squirrel.add(sTail);

  critterGroup.add(squirrel);
  critters.push({
    type: 'squirrel',
    node: squirrel,
    tail: sTail,
    homePos: sqHome,
    homeRotY: -Math.PI / 2,
    phase: 2.9
  });

  return { critterGroup, critters };
}

function buildBackyardFirepit(world, woodPhysMat) {
  const firepitGroup = new THREE.Group();
  firepitGroup.name = 'BackyardFieldstoneFirepit';
  firepitGroup.position.set(1.85, 0, 0.95);

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x6c737a,
    roughness: 0.85,
    metalness: 0.12,
    flatShading: true
  });
  const charWoodMat = new THREE.MeshStandardMaterial({
    color: 0x1e1815,
    emissive: 0x7c2d12,
    emissiveIntensity: 0.35,
    roughness: 0.92
  });
  const emberBedMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    emissive: 0xf97316,
    emissiveIntensity: 1.4,
    roughness: 0.6
  });

  const ringRadius = 0.46;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.135, 0),
      stoneMat
    );
    stone.position.set(Math.cos(a) * ringRadius, 0.09, Math.sin(a) * ringRadius);
    stone.scale.set(1.25, 0.82, 1.1);
    stone.rotation.set(i * 0.4, a, 0.2);
    stone.castShadow = true;
    stone.receiveShadow = true;
    firepitGroup.add(stone);
  }

  const emberBed = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
    emberBedMat
  );
  emberBed.scale.set(1.0, 0.32, 1.0);
  firepitGroup.add(emberBed);

  for (let l = 0; l < 4; l++) {
    const la = (l / 4) * Math.PI * 2 + 0.35;
    const logMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.055, 0.48, 7),
      charWoodMat
    );
    logMesh.position.set(Math.cos(la) * 0.14, 0.18, Math.sin(la) * 0.14);
    logMesh.rotation.z = Math.cos(la) * 0.58;
    logMesh.rotation.x = -Math.sin(la) * 0.58;
    logMesh.castShadow = true;
    firepitGroup.add(logMesh);
  }

  const fireFlames = [];
  const flameDefs = [
    { x: 0, z: 0, r: 0.16, h: 0.52, color: 0xf97316, phase: 0.0 },
    { x: 0.06, z: -0.05, r: 0.12, h: 0.42, color: 0xfbbf24, phase: 1.4 },
    { x: -0.06, z: 0.05, r: 0.11, h: 0.38, color: 0xfde047, phase: 2.8 }
  ];
  flameDefs.forEach((fd) => {
    const fMat = new THREE.MeshBasicMaterial({
      color: fd.color,
      transparent: true,
      opacity: 0.84,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const fMesh = new THREE.Mesh(new THREE.ConeGeometry(fd.r, fd.h, 8), fMat);
    fMesh.position.set(fd.x, 0.24, fd.z);
    firepitGroup.add(fMesh);
    fireFlames.push({ mesh: fMesh, mat: fMat, baseH: fd.h, phase: fd.phase });
  });

  const fireEmbers = [];
  const emberGeo = new THREE.OctahedronGeometry(0.016, 0);
  for (let e = 0; e < 12; e++) {
    const eMat = new THREE.MeshBasicMaterial({
      color: e % 2 === 0 ? 0xfde047 : 0xf97316,
      transparent: true,
      opacity: 0.9
    });
    const eMesh = new THREE.Mesh(emberGeo, eMat);
    const phase = e / 12;
    eMesh.position.set(0, 0.2 + phase * 1.4, 0);
    firepitGroup.add(eMesh);
    fireEmbers.push({ mesh: eMesh, mat: eMat, phase });
  }

  const pitBody = new CANNON.Body({ mass: 0, material: woodPhysMat });
  pitBody.addShape(new CANNON.Cylinder(0.48, 0.52, 0.22, 12));
  pitBody.position.set(1.85, 0.11, 0.95);
  pitBody.userData = { label: 'FirepitCollider' };
  world.addBody(pitBody);

  return { firepitGroup, fireFlames, fireEmbers, emberBedMat };
}

function buildChimneySmokePlume() {
  const smokeGroup = new THREE.Group();
  smokeGroup.name = 'ChimneyFireplaceWoodsmoke';
  smokeGroup.position.set(6.85, 4.85, -9.0);

  const smokePuffs = [];
  const puffGeo = new THREE.DodecahedronGeometry(0.28, 1);

  for (let i = 0; i < 10; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.25,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(puffGeo, mat);
    const phase = i / 10;
    mesh.position.set(0, phase * 3.6, 0);
    smokeGroup.add(mesh);
    smokePuffs.push({ mesh, mat, phase });
  }

  return { smokeGroup, smokePuffs };
}

function buildRainPuddles() {
  const puddleGroup = new THREE.Group();
  puddleGroup.name = 'RainPuddles';
  puddleGroup.visible = false;

  const puddleMat = new THREE.MeshPhysicalMaterial({
    color: 0x2b3e4f,
    roughness: 0.06,
    metalness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 0.82
  });

  const puddleDefs = [
    { x: -0.95, z: 0.72, rx: 0.65, rz: 0.48, rot: 0.4 },
    { x: 1.15, z: 0.35, rx: 0.78, rz: 0.52, rot: -0.3 },
    { x: 0.35, z: -1.45, rx: 0.62, rz: 0.44, rot: 0.8 },
    { x: -1.8, z: -0.9, rx: 0.85, rz: 0.6, rot: 0.15 },
    { x: 1.65, z: -2.2, rx: 0.9, rz: 0.65, rot: -0.5 }
  ];

  const rippleRings = [];
  const ringGeo = new THREE.RingGeometry(0.06, 0.085, 20);
  ringGeo.rotateX(-Math.PI / 2);

  puddleDefs.forEach((pd, i) => {
    const geo = new THREE.CircleGeometry(1.0, 24);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, puddleMat);
    mesh.position.set(pd.x, 0.007, pd.z);
    mesh.scale.set(pd.rx, 1, pd.rz);
    mesh.rotation.y = pd.rot;
    mesh.receiveShadow = true;
    puddleGroup.add(mesh);

    for (let r = 0; r < 2; r++) {
      const rMat = new THREE.MeshBasicMaterial({
        color: 0xcbe3f8,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide
      });
      const rMesh = new THREE.Mesh(ringGeo, rMat);
      rMesh.position.set(
        pd.x + (r - 0.5) * 0.22,
        0.009,
        pd.z + (r - 0.5) * 0.15
      );
      puddleGroup.add(rMesh);
      rippleRings.push({
        mesh: rMesh,
        mat: rMat,
        phase: (i * 0.37 + r * 0.5) % 1.0
      });
    }
  });

  return { puddleGroup, rippleRings };
}

function buildSnowBlankets() {
  const snowGroup = new THREE.Group();
  snowGroup.name = 'SnowBlankets';
  snowGroup.visible = false;

  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xf1f6fc,
    roughness: 0.72,
    metalness: 0.05
  });

  const driftCoords = [
    [-2.5, -2.5, 2.8, 2.2],
    [2.8, -2.2, 2.6, 2.1],
    [-3.2, 1.5, 2.4, 1.9],
    [3.1, 1.6, 2.5, 2.0],
    [0, -6.2, 5.5, 2.2]
  ];

  driftCoords.forEach(([x, z, sx, sz]) => {
    const drift = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      snowMat
    );
    drift.position.set(x, 0.0, z);
    drift.scale.set(sx, 0.055, sz);
    drift.receiveShadow = true;
    snowGroup.add(drift);
  });

  return snowGroup;
}
