import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  createGrassTextures,
  createSidingTexture,
  createRoofShingleTexture,
  createCedarFenceTexture,
  createBarkTextures,
  createEndGrainTextures
} from './textures.js';

/**
 * Builds the generic suburban New Jersey backyard environment and static physics colliders.
 * Fictional, anonymous suburban setting: lawn, 6ft cedar privacy fence, deciduous & evergreen
 * NJ trees, two-story clapboard colonial house facade with back deck, yard lantern post,
 * weather-reactive puddles & snow blankets, firewood rack, and props.
 */
export function buildBackyardEnvironment(scene, world, materials) {
  const envGroup = new THREE.Group();
  envGroup.name = 'SuburbanNJBackyard';
  scene.add(envGroup);

  const grassTex = createGrassTextures();
  const sidingTex = createSidingTexture();
  const roofTex = createRoofShingleTexture();
  const fenceTex = createCedarFenceTexture();
  const barkTex = createBarkTextures('oak');
  const endGrainTex = createEndGrainTextures('oak');

  // 1. Dynamic Sky Dome Canvas Texture
  const skyGeo = new THREE.SphereGeometry(95, 28, 20);
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 256;
  skyCanvas.height = 128;
  const skyCtx = skyCanvas.getContext('2d');

  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const skyMat = new THREE.MeshBasicMaterial({
    map: skyTexture,
    side: THREE.BackSide,
    depthWrite: false
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  envGroup.add(skyDome);

  // 2. Lawn Ground Mesh + Physics Ground Plane
  const groundGeo = new THREE.PlaneGeometry(60, 60, 24, 24);
  const groundMat = new THREE.MeshStandardMaterial({
    map: grassTex.map,
    bumpMap: grassTex.bumpMap,
    bumpScale: 0.035,
    roughness: 0.92,
    metalness: 0.0
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

  // 3. Worn Soil / Woodchip Patch around the Chopping Station + Flagstone Stepping Path
  const mulchGeo = new THREE.CircleGeometry(2.15, 32);
  const mulchMat = new THREE.MeshStandardMaterial({
    color: 0x4b3828,
    roughness: 0.96,
    bumpMap: barkTex.bumpMap,
    bumpScale: 0.04
  });
  const mulchPatch = new THREE.Mesh(mulchGeo, mulchMat);
  mulchPatch.rotation.x = -Math.PI / 2;
  mulchPatch.position.set(0, 0.004, 0.15);
  mulchPatch.receiveShadow = true;
  envGroup.add(mulchPatch);

  // Outer dirt transition ring
  const dirtRingGeo = new THREE.RingGeometry(2.05, 2.55, 32);
  const dirtRingMat = new THREE.MeshStandardMaterial({
    color: 0x454e2a,
    roughness: 0.95,
    transparent: true,
    opacity: 0.65
  });
  const dirtRing = new THREE.Mesh(dirtRingGeo, dirtRingMat);
  dirtRing.rotation.x = -Math.PI / 2;
  dirtRing.position.set(0, 0.003, 0.15);
  dirtRing.receiveShadow = true;
  envGroup.add(dirtRing);

  // Stepping stones leading from the house back deck to the chopping area
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x8d8e8a,
    roughness: 0.88
  });
  const stonePositions = [
    [0.2, -5.2],
    [0.05, -4.3],
    [-0.1, -3.4],
    [0.0, -2.5]
  ];
  stonePositions.forEach(([sx, sz], idx) => {
    const stone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.35, 0.035, 7),
      stoneMat
    );
    stone.position.set(sx, 0.015, sz);
    stone.rotation.y = idx * 0.9;
    stone.receiveShadow = true;
    stone.castShadow = true;
    envGroup.add(stone);
  });

  // 4. Generic Suburban New Jersey House Facade
  const {
    group: houseGroup,
    warmWindowMat,
    lanternBulbMat
  } = buildSuburbanHouseFacade(
    sidingTex,
    roofTex,
    world,
    materials.groundPhysMat
  );
  houseGroup.position.set(0, 0, -9.2);
  envGroup.add(houseGroup);

  // 5. 6-Foot Weathered Cedar Privacy Fence around the Backyard
  const fenceGroup = buildCedarPrivacyFence(
    fenceTex,
    world,
    materials.woodPhysMat
  );
  envGroup.add(fenceGroup);

  // 6. Suburban NJ Trees & Shrubs (returns swayable tree references for Wind weather)
  const { group: foliageGroup, swayTargets } = buildSuburbanTreesAndShrubs(barkTex);
  envGroup.add(foliageGroup);

  // 7. Backyard Woodchopping Props + Yard Lantern Post beside Chopping Station
  const { group: propsGroup, yardLanternBulb, cordwoodMeshes } = buildBackyardProps(
    barkTex,
    endGrainTex,
    world,
    materials.woodPhysMat,
    lanternBulbMat
  );
  envGroup.add(propsGroup);

  // 8. Weather-Reactive Puddles (visible during Rain)
  const { puddleGroup, rippleRings } = buildRainPuddles();
  envGroup.add(puddleGroup);

  // 9. Weather-Reactive Snow & Frost Blankets (visible during Snow)
  const snowGroup = buildSnowBlankets();
  envGroup.add(snowGroup);

  // 10. Dynamic House Chimney Fireplace Woodsmoke Plume (scales with stacked cordwood & weather!)
  const { smokeGroup, smokePuffs } = buildChimneySmokePlume();
  envGroup.add(smokeGroup);

  // 11. Backyard Fieldstone Patio Firepit (stoked by Kindling Quarter-Chops & [B] Bonfire action!)
  const {
    firepitGroup,
    fireFlames,
    fireEmbers,
    emberBedMat
  } = buildBackyardFirepit(world, materials.woodPhysMat);
  envGroup.add(firepitGroup);

  // 12. Suburban NJ Roadside Firewood Stand & Twine-Wrapped Bundle Shelf
  const {
    standGroup: firewoodStandGroup,
    orderBundleMeshes
  } = buildRoadsideFirewoodStand(fenceTex, barkTex, endGrainTex, world, materials.woodPhysMat);
  envGroup.add(firewoodStandGroup);

  // 13. Animated 3D Backyard Bluejay & Squirrel Fence Critters
  const {
    critterGroup,
    critters
  } = buildBackyardCritters();
  envGroup.add(critterGroup);

  let currentSmokeIntensity = 0.45;
  let currentBonfireLevel = 1;
  let critterScatterTimer = 0;

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
    yardLanternBulb,
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

  // 4 Corner timber posts + lower & upper bundle shelves
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

  // Pitched cedar roof & "FIREWOOD BUNDLES" sign board
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

  // Honor-system green metal cash box mounted on right post
  const cashBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.22, 0.14),
    cashBoxMat
  );
  cashBox.position.set(0.84, 1.05, 0.22);
  cashBox.castShadow = true;
  standGroup.add(cashBox);

  // 8 Twine-wrapped 3D Firewood Bundles stacked across the two shelves
  const orderBundleMeshes = [];
  const stickGeo = new THREE.CylinderGeometry(0.052, 0.055, 0.38, 7);
  stickGeo.rotateX(Math.PI / 2);
  const stickMats = [logBarkMat, logEndMat, logEndMat];

  for (let b = 0; b < 8; b++) {
    const bundle = new THREE.Group();
    const row = Math.floor(b / 4);
    const col = b % 4;
    bundle.position.set(-0.54 + col * 0.36, 0.34 + row * 0.52, 0);

    // 3 bundled split sticks + orange twine wrap band
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

  // 2 Suburban NJ Bluejays perched on the cedar fence rail
  const jayPerches = [
    { x: -5.8, y: 1.94, z: -9.18, rotY: 0.45, phase: 0.0 },
    { x: 6.1, y: 1.94, z: -9.18, rotY: -0.52, phase: 1.7 }
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

  // 1 Eastern Gray Squirrel perched on the right fence rail with a bushy bobbing tail
  const squirrelMat = new THREE.MeshStandardMaterial({
    color: 0x78716c,
    roughness: 0.82
  });
  const squirrel = new THREE.Group();
  squirrel.name = 'BackyardGraySquirrel';
  const sqHome = new THREE.Vector3(9.55, 1.94, -2.4);
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

  // Ring of 10 rugged New Jersey fieldstones
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

  // Glowing coal & ember mound at center of firepit
  const emberBed = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
    emberBedMat
  );
  emberBed.scale.set(1.0, 0.32, 1.0);
  firepitGroup.add(emberBed);

  // 4 Teepeed charred oak split logs inside the firepit
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

  // Multi-layered flickering 3D Flame Cones
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

  // Rising glowing ember sparks above the firepit
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

  // Static collider so split logs bounce off the stone firepit ring!
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
  // Brick chimney top world position: house (0,0,-9.2) + chimney (6.85, 8.75, -1.8)
  smokeGroup.position.set(6.85, 8.85, -11.0);

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

    // 2 animated raindrop ripple rings per puddle
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

  // Frosty snow drifts across the yard and around the chopping circle
  const driftCoords = [
    [-2.5, -2.5, 2.8, 2.2],
    [2.8, -2.2, 2.6, 2.1],
    [-3.2, 1.5, 2.4, 1.9],
    [3.1, 1.6, 2.5, 2.0],
    [0, -6.2, 5.5, 2.2],
    [-3.4, -1.5, 1.2, 0.4] // Top of firewood rack
  ];

  driftCoords.forEach(([x, z, sx, sz], idx) => {
    const drift = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      snowMat
    );
    const y = idx === 5 ? 0.92 : 0.0;
    const h = idx === 5 ? 0.08 : 0.055;
    drift.position.set(x, y, z);
    drift.scale.set(sx, h, sz);
    drift.receiveShadow = true;
    snowGroup.add(drift);
  });

  // Snow cap on house roof front slope
  const roofSnow = new THREE.Mesh(
    new THREE.BoxGeometry(13.5, 0.06, 3.05),
    snowMat
  );
  roofSnow.position.set(0, 7.66, -10.18);
  roofSnow.rotation.x = 0.52;
  roofSnow.receiveShadow = true;
  snowGroup.add(roofSnow);

  return snowGroup;
}

function buildSuburbanHouseFacade(sidingTex, roofTex, world, physMat) {
  const group = new THREE.Group();
  group.name = 'HouseFacade';

  const sidingMat = new THREE.MeshStandardMaterial({
    map: sidingTex.map,
    bumpMap: sidingTex.bumpMap,
    bumpScale: 0.025,
    roughness: 0.72
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xf4f5f0,
    roughness: 0.55
  });
  const brickMat = new THREE.MeshStandardMaterial({
    color: 0x7f382d,
    roughness: 0.9
  });
  const shutterMat = new THREE.MeshStandardMaterial({
    color: 0x1f3b2c,
    roughness: 0.65
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x3b5870,
    roughness: 0.15,
    metalness: 0.65
  });
  const warmWindowMat = new THREE.MeshStandardMaterial({
    color: 0x51687d,
    emissive: 0xffc870,
    emissiveIntensity: 0.35,
    roughness: 0.2,
    metalness: 0.4
  });
  const roofMat = new THREE.MeshStandardMaterial({
    map: roofTex,
    roughness: 0.88
  });
  const deckWoodMat = new THREE.MeshStandardMaterial({
    color: 0x7a5236,
    roughness: 0.82
  });

  const mainWidth = 13.0;
  const mainHeight = 6.2;
  const mainDepth = 4.5;

  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(mainWidth + 0.1, 0.55, mainDepth + 0.1),
    brickMat
  );
  foundation.position.set(0, 0.275, -mainDepth / 2);
  foundation.castShadow = true;
  foundation.receiveShadow = true;
  group.add(foundation);

  const houseBody = new THREE.Mesh(
    new THREE.BoxGeometry(mainWidth, mainHeight, mainDepth),
    sidingMat
  );
  houseBody.position.set(0, 0.55 + mainHeight / 2, -mainDepth / 2);
  houseBody.castShadow = true;
  houseBody.receiveShadow = true;
  group.add(houseBody);

  [-mainWidth / 2 + 0.08, mainWidth / 2 - 0.08].forEach((cx) => {
    const cornerPost = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, mainHeight, 0.18),
      trimMat
    );
    cornerPost.position.set(cx, 0.55 + mainHeight / 2, 0.02);
    group.add(cornerPost);
  });

  const fascia = new THREE.Mesh(
    new THREE.BoxGeometry(mainWidth + 0.5, 0.22, 0.35),
    trimMat
  );
  fascia.position.set(0, 0.55 + mainHeight + 0.05, 0.12);
  group.add(fascia);

  const roofSlopeLen = 3.1;
  const roofFront = new THREE.Mesh(
    new THREE.BoxGeometry(mainWidth + 0.6, 0.18, roofSlopeLen),
    roofMat
  );
  roofFront.position.set(0, 0.55 + mainHeight + 0.82, -mainDepth * 0.22);
  roofFront.rotation.x = 0.52;
  roofFront.castShadow = true;
  roofFront.receiveShadow = true;
  group.add(roofFront);

  const roofBack = new THREE.Mesh(
    new THREE.BoxGeometry(mainWidth + 0.6, 0.18, roofSlopeLen),
    roofMat
  );
  roofBack.position.set(0, 0.55 + mainHeight + 0.82, -mainDepth * 0.78);
  roofBack.rotation.x = -0.52;
  roofBack.castShadow = true;
  group.add(roofBack);

  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, mainHeight + 2.5, 0.85),
    brickMat
  );
  chimney.position.set(mainWidth / 2 + 0.35, (mainHeight + 2.5) / 2, -1.8);
  chimney.castShadow = true;
  chimney.receiveShadow = true;
  group.add(chimney);

  function addWindow(wx, wy, isLit = false) {
    const winGroup = new THREE.Group();
    winGroup.position.set(wx, wy, 0.04);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.18, 1.52, 0.1), trimMat);
    winGroup.add(frame);

    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.18), trimMat);
    sill.position.set(0, -0.76, 0.04);
    winGroup.add(sill);

    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.34),
      isLit ? warmWindowMat : glassMat
    );
    pane.position.z = 0.055;
    winGroup.add(pane);

    const hBar = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.05, 0.04), trimMat);
    hBar.position.z = 0.06;
    winGroup.add(hBar);

    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.34, 0.04), trimMat);
    vBar.position.z = 0.06;
    winGroup.add(vBar);

    [-0.82, 0.82].forEach((sx) => {
      const shutter = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 1.48, 0.06),
        shutterMat
      );
      shutter.position.set(sx, 0, 0.03);
      shutter.castShadow = true;
      winGroup.add(shutter);
    });

    group.add(winGroup);
  }

  addWindow(-4.4, 5.1, false);
  addWindow(-1.5, 5.1, true);
  addWindow(1.5, 5.1, false);
  addWindow(4.4, 5.1, true);

  addWindow(-4.4, 2.35, true);
  addWindow(4.4, 2.35, true);
  addWindow(2.0, 2.35, false);

  const doorX = -1.2;
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.18, 2.25, 0.08), trimMat);
  doorFrame.position.set(doorX, 1.85, 0.04);
  group.add(doorFrame);

  const doorPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.96, 2.08, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x7c2920, roughness: 0.55 })
  );
  doorPanel.position.set(doorX, 1.85, 0.075);
  group.add(doorPanel);

  const doorWindow = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.85), warmWindowMat);
  doorWindow.position.set(doorX, 2.25, 0.12);
  group.add(doorWindow);

  const lanternBulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff0c2,
    emissive: 0xffb84d,
    emissiveIntensity: 1.5,
    roughness: 0.2
  });
  const lanternBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 10),
    lanternBulbMat
  );
  lanternBulb.position.set(doorX + 0.82, 2.45, 0.18);
  group.add(lanternBulb);

  const deckW = 4.6;
  const deckD = 2.4;
  const deckH = 0.65;
  const deckX = -0.8;

  const deckPlatform = new THREE.Mesh(
    new THREE.BoxGeometry(deckW, 0.12, deckD),
    deckWoodMat
  );
  deckPlatform.position.set(deckX, deckH, deckD / 2);
  deckPlatform.castShadow = true;
  deckPlatform.receiveShadow = true;
  group.add(deckPlatform);

  const postPositions = [
    [deckX - deckW / 2 + 0.1, deckD - 0.1],
    [deckX + deckW / 2 - 0.1, deckD - 0.1],
    [deckX - deckW / 2 + 0.1, 0.1],
    [deckX + deckW / 2 - 0.1, 0.1],
    [deckX + 0.35, deckD - 0.1],
    [deckX + 1.45, deckD - 0.1]
  ];
  postPositions.forEach(([px, pz]) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.55, 0.11), trimMat);
    post.position.set(px, 0.775, pz);
    post.castShadow = true;
    group.add(post);
  });

  const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, deckD), trimMat);
  leftRail.position.set(deckX - deckW / 2 + 0.1, 1.48, deckD / 2);
  group.add(leftRail);

  const rightRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, deckD), trimMat);
  rightRail.position.set(deckX + deckW / 2 - 0.1, 1.48, deckD / 2);
  group.add(rightRail);

  const frontLeftRail = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.08, 0.08), trimMat);
  frontLeftRail.position.set(deckX - 0.95, 1.48, deckD - 0.1);
  group.add(frontLeftRail);

  for (let s = 0; s < 3; s++) {
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.08, 0.32),
      deckWoodMat
    );
    step.position.set(deckX + 0.9, deckH - (s + 1) * 0.18, deckD + 0.18 + s * 0.32);
    step.castShadow = true;
    step.receiveShadow = true;
    group.add(step);
  }

  const acUnit = new THREE.Mesh(
    new THREE.BoxGeometry(0.82, 0.78, 0.82),
    new THREE.MeshStandardMaterial({ color: 0x5d646b, roughness: 0.5, metalness: 0.4 })
  );
  acUnit.position.set(3.4, 0.42, 0.55);
  acUnit.castShadow = true;
  acUnit.receiveShadow = true;
  group.add(acUnit);

  const houseBodyPhys = new CANNON.Body({
    mass: 0,
    material: physMat
  });
  houseBodyPhys.addShape(
    new CANNON.Box(new CANNON.Vec3(mainWidth / 2, mainHeight / 2, mainDepth / 2)),
    new CANNON.Vec3(0, 0.55 + mainHeight / 2, -9.2 - mainDepth / 2)
  );
  houseBodyPhys.addShape(
    new CANNON.Box(new CANNON.Vec3(deckW / 2, deckH / 2, deckD / 2)),
    new CANNON.Vec3(deckX, deckH / 2, -9.2 + deckD / 2)
  );
  houseBodyPhys.userData = { label: 'HouseCollider' };
  world.addBody(houseBodyPhys);

  return { group, warmWindowMat, lanternBulbMat };
}

function buildCedarPrivacyFence(fenceTex, world, physMat) {
  const group = new THREE.Group();
  group.name = 'CedarFence';

  const postGeo = new THREE.BoxGeometry(0.11, 1.92, 0.11);
  const railGeo = new THREE.BoxGeometry(2.4, 0.08, 0.05);
  const picketGeo = new THREE.BoxGeometry(0.145, 1.82, 0.022);

  const baseMat = new THREE.MeshStandardMaterial({
    map: fenceTex,
    roughness: 0.88
  });

  function createFenceSpan(length, startX, startZ, rotY) {
    const spanGroup = new THREE.Group();
    spanGroup.position.set(startX, 0, startZ);
    spanGroup.rotation.y = rotY;

    const sectionWidth = 2.4;
    const sections = Math.round(length / sectionWidth);

    for (let s = 0; s <= sections; s++) {
      const post = new THREE.Mesh(postGeo, baseMat);
      post.position.set(s * sectionWidth, 0.96, 0);
      post.castShadow = true;
      post.receiveShadow = true;
      spanGroup.add(post);

      if (s < sections) {
        [0.42, 1.52].forEach((ry) => {
          const rail = new THREE.Mesh(railGeo, baseMat);
          rail.position.set(s * sectionWidth + sectionWidth / 2, ry, 0);
          rail.castShadow = true;
          spanGroup.add(rail);
        });

        const picketCount = 15;
        for (let p = 0; p < picketCount; p++) {
          const px = s * sectionWidth + 0.12 + (p * (sectionWidth - 0.16)) / (picketCount - 1);
          const picket = new THREE.Mesh(picketGeo, baseMat);
          picket.position.set(px, 0.92, 0.03);
          picket.castShadow = true;
          picket.receiveShadow = true;
          spanGroup.add(picket);
        }
      }
    }
    group.add(spanGroup);
  }

  createFenceSpan(16.8, -9.6, -9.2, -Math.PI / 2);
  createFenceSpan(16.8, 9.6, 7.6, Math.PI / 2);
  createFenceSpan(4.8, -9.6, -9.2, 0);
  createFenceSpan(4.8, 4.8, -9.2, 0);

  const fencePhys = new CANNON.Body({ mass: 0, material: physMat });
  fencePhys.addShape(
    new CANNON.Box(new CANNON.Vec3(0.1, 0.95, 8.5)),
    new CANNON.Vec3(-9.6, 0.95, -0.8)
  );
  fencePhys.addShape(
    new CANNON.Box(new CANNON.Vec3(0.1, 0.95, 8.5)),
    new CANNON.Vec3(9.6, 0.95, -0.8)
  );
  fencePhys.userData = { label: 'FenceCollider' };
  world.addBody(fencePhys);

  return group;
}

function buildSuburbanTreesAndShrubs(barkTex) {
  const group = new THREE.Group();
  group.name = 'BackyardTrees';
  const swayTargets = [];

  const trunkMat = new THREE.MeshStandardMaterial({
    map: barkTex.map,
    bumpMap: barkTex.bumpMap,
    bumpScale: 0.04,
    roughness: 0.92
  });

  function addDeciduousTree(x, z, scale, palette) {
    const tree = new THREE.Group();
    tree.position.set(x, 0, z);
    tree.scale.setScalar(scale);

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.36, 2.8, 10),
      trunkMat
    );
    trunk.position.y = 1.4;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);

    const crownGroup = new THREE.Group();
    crownGroup.position.set(0, 2.2, 0);
    tree.add(crownGroup);
    swayTargets.push({ node: crownGroup, phase: x * 0.7 + z * 0.3, amp: 1.0 });

    const limbOffsets = [
      [0.45, 0.4, 0.2, 0.45, 0.2],
      [-0.5, 0.3, -0.25, -0.48, -0.25],
      [0.15, 0.5, -0.45, 0.2, -0.45]
    ];
    limbOffsets.forEach(([lx, ly, lz, rx, rz]) => {
      const limb = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.15, 1.4, 8),
        trunkMat
      );
      limb.position.set(lx, ly, lz);
      limb.rotation.set(rz, 0, -rx);
      limb.castShadow = true;
      crownGroup.add(limb);
    });

    const crownClusters = [
      [0, 1.6, 0, 1.45],
      [0.95, 1.15, 0.45, 1.12],
      [-0.95, 1.05, -0.35, 1.15],
      [0.35, 1.2, -0.85, 1.08],
      [-0.4, 1.3, 0.85, 1.05],
      [0, 2.35, 0.1, 1.05]
    ];
    crownClusters.forEach(([cx, cy, cz, cr], idx) => {
      const mat = new THREE.MeshStandardMaterial({
        color: palette[idx % palette.length],
        roughness: 0.86,
        flatShading: true
      });
      const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(cr, 1), mat);
      puff.position.set(cx, cy, cz);
      puff.scale.set(1.08, 0.86, 1.04);
      puff.castShadow = true;
      puff.receiveShadow = true;
      crownGroup.add(puff);
    });

    group.add(tree);
  }

  function addEvergreenPine(x, z, scale) {
    const pine = new THREE.Group();
    pine.position.set(x, 0, z);
    pine.scale.setScalar(scale);

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.24, 1.6, 8),
      trunkMat
    );
    trunk.position.y = 0.8;
    trunk.castShadow = true;
    pine.add(trunk);

    const boughGroup = new THREE.Group();
    boughGroup.position.set(0, 1.2, 0);
    pine.add(boughGroup);
    swayTargets.push({ node: boughGroup, phase: x * 0.5 - z * 0.4, amp: 0.85 });

    const tiers = 4;
    for (let t = 0; t < tiers; t++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.35 - t * 0.24, 1.65, 9),
        new THREE.MeshStandardMaterial({
          color: t % 2 === 0 ? 0x244929 : 0x2d5832,
          roughness: 0.88,
          flatShading: true
        })
      );
      cone.position.y = 0.45 + t * 0.88;
      cone.castShadow = true;
      cone.receiveShadow = true;
      boughGroup.add(cone);
    }

    group.add(pine);
  }

  addDeciduousTree(-6.8, -5.8, 1.25, [0xb83728, 0xd45b2a, 0xc94424, 0xe07a2e]);
  addDeciduousTree(6.9, -5.2, 1.32, [0x47692b, 0x5c7a32, 0x76782e, 0x3b5924]);
  addDeciduousTree(-7.6, 1.4, 0.95, [0x6e8c38, 0x8ea33b, 0x58752c]);

  addEvergreenPine(7.8, 0.6, 1.1);
  addEvergreenPine(8.1, -2.4, 0.92);
  addEvergreenPine(-8.2, -2.5, 1.02);

  const shrubMat = new THREE.MeshStandardMaterial({
    color: 0x325a28,
    roughness: 0.9,
    flatShading: true
  });
  [-5.2, -4.1, -3.1, 2.2, 3.3, 4.5, 5.5].forEach((sx, i) => {
    const shrub = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.45 + (i % 2) * 0.08, 1),
      shrubMat
    );
    shrub.position.set(sx, 0.36, -8.55);
    shrub.scale.set(1.15, 0.82, 0.95);
    shrub.castShadow = true;
    shrub.receiveShadow = true;
    group.add(shrub);
  });

  // Scattered fallen New Jersey autumn leaves on the lawn
  const leafColors = [0xc84b28, 0xd9822b, 0x9e3620, 0xcca43b];
  const leafGeo = new THREE.CircleGeometry(0.055, 5);
  for (let i = 0; i < 55; i++) {
    const angle = (i * 2.39996) % (Math.PI * 2);
    const dist = 2.2 + ((i * 1.73) % 6.2);
    const lx = Math.cos(angle) * dist;
    const lz = Math.sin(angle) * dist - 1.5;
    const leaf = new THREE.Mesh(
      leafGeo,
      new THREE.MeshStandardMaterial({
        color: leafColors[i % leafColors.length],
        roughness: 0.85,
        side: THREE.DoubleSide
      })
    );
    leaf.position.set(lx, 0.008, lz);
    leaf.rotation.set(-Math.PI / 2, 0, i * 1.1);
    group.add(leaf);
  }

  return { group, swayTargets };
}

function buildBackyardProps(barkTex, endGrainTex, world, woodPhysMat, lanternBulbMat) {
  const group = new THREE.Group();
  group.name = 'BackyardProps';

  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x26292e,
    roughness: 0.45,
    metalness: 0.75
  });
  const logBarkMat = new THREE.MeshStandardMaterial({
    map: barkTex.map,
    bumpMap: barkTex.bumpMap,
    bumpScale: 0.03,
    roughness: 0.9
  });
  const logEndMat = new THREE.MeshStandardMaterial({
    map: endGrainTex.map,
    roughness: 0.82
  });

  // 1. Timber Lantern Post right beside the chopping station (illuminates Golden Hour & Night chopping!)
  const lanternPostGroup = new THREE.Group();
  lanternPostGroup.position.set(-1.35, 0, 0.15);

  const postMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 1.95, 0.11),
    logBarkMat
  );
  postMesh.position.y = 0.975;
  postMesh.castShadow = true;
  postMesh.receiveShadow = true;
  lanternPostGroup.add(postMesh);

  const armMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.07, 0.07),
     logBarkMat
  );
  armMesh.position.set(0.16, 1.82, 0);
  armMesh.castShadow = true;
  lanternPostGroup.add(armMesh);

  // Hanging iron lantern cage + glowing bulb at (-1.03, 1.62, 0.15)
  const capMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.09, 8),
    metalMat
  );
  capMesh.position.set(0.32, 1.72, 0);
  lanternPostGroup.add(capMesh);

  const yardLanternBulb = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.045, 0.12, 10),
    lanternBulbMat
  );
  yardLanternBulb.position.set(0.32, 1.63, 0);
  lanternPostGroup.add(yardLanternBulb);

  group.add(lanternPostGroup);

  // 2. Firewood Cordwood Rack (left side of chopping station)
  const rackGroup = new THREE.Group();
  rackGroup.position.set(-3.4, 0, -1.5);
  rackGroup.rotation.y = 0.32;

  const baseBar = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 0.48), metalMat);
  baseBar.position.y = 0.06;
  rackGroup.add(baseBar);

  [-0.98, 0.98].forEach((rx) => {
    [-0.2, 0.2].forEach((rz) => {
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.18, 0.05), metalMat);
      upright.position.set(rx, 0.62, rz);
      upright.castShadow = true;
      rackGroup.add(upright);
    });
  });

  const logGeo = new THREE.CylinderGeometry(0.095, 0.1, 0.52, 10);
  logGeo.rotateX(Math.PI / 2);
  const logMats = [logBarkMat, logEndMat, logEndMat];

  const cordwoodMeshes = [];
  const splitWedgeGeo = new THREE.CylinderGeometry(0.085, 0.09, 0.5, 5);
  splitWedgeGeo.rotateX(Math.PI / 2);

  for (let row = 0; row < 6; row++) {
    const count = 8 - (row % 2);
    for (let col = 0; col < count; col++) {
      const lx = -0.78 + col * 0.215 + (row % 2) * 0.09;
      const ly = 0.18 + row * 0.165;
      const isBonusRow = row >= 3;
      const stackedLog = new THREE.Mesh(
        isBonusRow ? splitWedgeGeo : logGeo,
        logMats
      );
      stackedLog.position.set(lx, ly, (col % 2 - 0.5) * 0.03);
      stackedLog.rotation.z = (row * 0.4 + col) * 0.5;
      stackedLog.castShadow = true;
      stackedLog.receiveShadow = true;
      if (isBonusRow) {
        stackedLog.visible = false;
        cordwoodMeshes.push(stackedLog);
      }
      rackGroup.add(stackedLog);
    }
  }
  group.add(rackGroup);

  const rackBody = new CANNON.Body({ mass: 0, material: woodPhysMat });
  rackBody.addShape(new CANNON.Box(new CANNON.Vec3(1.05, 0.55, 0.28)));
  rackBody.position.set(-3.4, 0.55, -1.5);
  rackBody.quaternion.setFromEuler(0, 0.32, 0);
  rackBody.userData = { label: 'FirewoodRackCollider' };
  world.addBody(rackBody);

  // 3. Contractor Wheelbarrow (right side of chopping station)
  const barrowGroup = new THREE.Group();
  barrowGroup.position.set(2.55, 0, -0.85);
  barrowGroup.rotation.y = -0.58;

  const trayMat = new THREE.MeshStandardMaterial({
    color: 0x225434,
    roughness: 0.42,
    metalness: 0.35
  });
  const handleWoodMat = new THREE.MeshStandardMaterial({
    color: 0xb98b56,
    roughness: 0.65
  });

  const tray = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.32, 0.42, 4),
    trayMat
  );
  tray.position.set(0, 0.52, 0);
  tray.rotation.y = Math.PI / 4;
  tray.scale.set(1.0, 1.0, 1.45);
  tray.castShadow = true;
  tray.receiveShadow = true;
  barrowGroup.add(tray);

  [-0.22, 0.22].forEach((hx) => {
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.045, 1.52),
      handleWoodMat
    );
    handle.position.set(hx, 0.34, -0.12);
    handle.rotation.x = 0.14;
    handle.castShadow = true;
    barrowGroup.add(handle);

    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.035), metalMat);
    leg.position.set(hx, 0.17, -0.35);
    leg.castShadow = true;
    barrowGroup.add(leg);
  });

  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.055, 10, 18),
    new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.85 })
  );
  wheel.position.set(0, 0.21, 0.56);
  wheel.rotation.y = Math.PI / 2;
  wheel.castShadow = true;
  barrowGroup.add(wheel);

  for (let i = 0; i < 3; i++) {
    const piece = new THREE.Mesh(logGeo, logMats);
    piece.scale.set(0.85, 0.85, 0.85);
    piece.position.set((i - 1) * 0.11, 0.65 + (i % 2) * 0.08, (i - 1) * 0.06);
    piece.rotation.set(0.15, i * 0.4, 0.3);
    piece.castShadow = true;
    barrowGroup.add(piece);
  }

  group.add(barrowGroup);

  const barrowBody = new CANNON.Body({ mass: 0, material: woodPhysMat });
  barrowBody.addShape(new CANNON.Box(new CANNON.Vec3(0.42, 0.38, 0.62)));
  barrowBody.position.set(2.55, 0.38, -0.85);
  barrowBody.quaternion.setFromEuler(0, -0.58, 0);
  barrowBody.userData = { label: 'WheelbarrowCollider' };
  world.addBody(barrowBody);

  // 4. Classic Backyard Kettle Charcoal Grill near the deck
  const grillGroup = new THREE.Group();
  grillGroup.position.set(2.4, 0, -5.6);

  const bowlMat = new THREE.MeshStandardMaterial({
    color: 0x181a1d,
    roughness: 0.28,
    metalness: 0.72
  });
  const kettle = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), bowlMat);
  kettle.position.y = 0.72;
  kettle.castShadow = true;
  grillGroup.add(kettle);

  for (let l = 0; l < 3; l++) {
    const a = (l / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.68, 6),
      metalMat
    );
    leg.position.set(Math.cos(a) * 0.18, 0.34, Math.sin(a) * 0.18);
    leg.rotation.set(Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15);
    leg.castShadow = true;
    grillGroup.add(leg);
  }
  group.add(grillGroup);

  return { group, yardLanternBulb, cordwoodMeshes };
}
