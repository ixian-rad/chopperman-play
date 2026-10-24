import * as THREE from 'three';

/**
 * Procedural PBR Texture Generator for the Suburban NJ Backyard & RPG Woodchopping Game.
 * Generates diffuse/albedo, bump/normal, and roughness maps purely via HTML5 Canvas.
 * Optimized for fast startup even under software rendering.
 */

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

// Deterministic pseudo-random helper for repeatable procedural textures
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lush suburban New Jersey lawn grass with mowing stripes, clover mottling, and fast pixel blade noise.
 */
export function createGrassTextures() {
  const size = 256;
  const { canvas, ctx } = createCanvas(size, size);
  const { canvas: bumpCanvas, ctx: bumpCtx } = createCanvas(size, size);
  const rand = mulberry32(101);

  ctx.fillStyle = '#3f6e2a';
  ctx.fillRect(0, 0, size, size);

  bumpCtx.fillStyle = '#808080';
  bumpCtx.fillRect(0, 0, size, size);

  // Fast pixel noise pass for dense grass micro-blades
  const imgData = ctx.getImageData(0, 0, size, size);
  const bData = bumpCtx.getImageData(0, 0, size, size);
  const d = imgData.data;
  const bd = bData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const stripe = Math.floor(x / (size / 8)) % 2 === 0 ? 12 : -10;
      const n = (rand() - 0.5) * 34;
      const clover = Math.sin(x * 0.09) * Math.cos(y * 0.09) * 10;

      d[idx] = Math.max(20, Math.min(255, 62 + stripe + n * 0.7 + clover));
      d[idx + 1] = Math.max(35, Math.min(255, 110 + stripe * 1.2 + n + clover));
      d[idx + 2] = Math.max(15, Math.min(255, 40 + stripe * 0.5 + n * 0.5));
      d[idx + 3] = 255;

      const bVal = Math.max(0, Math.min(255, 128 + n * 2.6));
      bd[idx] = bVal;
      bd[idx + 1] = bVal;
      bd[idx + 2] = bVal;
      bd[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  bumpCtx.putImageData(bData, 0, 0);

  // Overlay 1200 crisp directional grass blade strokes
  for (let i = 0; i < 1200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 3 + rand() * 5;
    const angle = -Math.PI / 2 + (rand() - 0.5) * 0.65;
    const light = 24 + Math.floor(rand() * 24);
    ctx.strokeStyle = `hsl(${92 + (rand() - 0.5) * 18}, 48%, ${light}%)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(16, 16);
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(16, 16);

  return { map, bumpMap };
}

/**
 * Species-customizable bark texture + bump + roughness maps.
 * Supports: 'pine', 'birch', 'maple', 'oak', 'knotty_oak', 'hickory'
 */
export function createBarkTextures(species = 'oak') {
  const width = 256;
  const height = 256;
  const { canvas, ctx } = createCanvas(width, height);
  const { canvas: bumpCanvas, ctx: bumpCtx } = createCanvas(width, height);
  const { canvas: roughCanvas, ctx: roughCtx } = createCanvas(width, height);

  const seedMap = {
    pine: 201,
    birch: 202,
    hollow_sycamore: 207,
    pitch_pine: 218,
    maple: 203,
    swamp_cypress: 212,
    oak: 204,
    forked_apple: 208,
    frozen_tamarack: 215,
    knotty_oak: 205,
    borer_ash: 219,
    gnarled_stump: 213,
    hickory: 206,
    cherry_crotch: 216,
    lightning_oak: 222,
    twisted_elm: 209,
    geode_sycamore: 225,
    burl_maple: 220,
    ironwood_hazard: 210,
    walnut_burl: 223,
    chainsaw_hickory: 226,
    boss_oak: 211,
    boss_stump: 214,
    boss_osage: 217,
    boss_bogoak: 221,
    boss_locust: 224,
    boss_ironbark: 227
  };
  const rand = mulberry32(seedMap[species] || 204);

  if (species === 'birch') {
    // Paper Birch: chalky off-white bark with dark horizontal lenticels and peeling amber patches
    ctx.fillStyle = '#dedad2';
    ctx.fillRect(0, 0, width, height);
    bumpCtx.fillStyle = '#909090';
    bumpCtx.fillRect(0, 0, width, height);
    roughCtx.fillStyle = '#b0b0b0';
    roughCtx.fillRect(0, 0, width, height);

    // Subtle vertical shading bands
    for (let x = 0; x < width; x += 8) {
      const v = 212 + Math.floor((rand() - 0.5) * 20);
      ctx.fillStyle = `rgb(${v}, ${v - 4}, ${v - 10})`;
      ctx.fillRect(x, 0, 8, height);
    }

    // Horizontal dark lenticel dashes & peeling crevices
    for (let i = 0; i < 180; i++) {
      const x = rand() * width;
      const y = rand() * height;
      const w = 10 + rand() * 34;
      const h = 1.5 + rand() * 3.5;
      ctx.fillStyle = rand() > 0.25 ? '#2b2623' : '#8c583a';
      ctx.fillRect(x, y, w, h);

      bumpCtx.fillStyle = '#303030';
      bumpCtx.fillRect(x, y, w, h + 1);
      roughCtx.fillStyle = '#e5e5e5';
      roughCtx.fillRect(x, y, w, h);
    }
  } else if (species === 'hollow_sycamore' || species === 'geode_sycamore') {
    // American Sycamore: mottled camouflage plates of cream, sage-grey, and peeling tan bark
    ctx.fillStyle = species === 'geode_sycamore' ? '#7b7485' : '#9e9585';
    ctx.fillRect(0, 0, width, height);
    bumpCtx.fillStyle = '#787878';
    bumpCtx.fillRect(0, 0, width, height);
    roughCtx.fillStyle = '#c4c4c4';
    roughCtx.fillRect(0, 0, width, height);

    const camoColors =
      species === 'geode_sycamore'
        ? ['#c4b5fd', '#7d7769', '#581c87', '#b5ad9b', '#67e8f9']
        : ['#cfc8b8', '#7d7769', '#635343', '#b5ad9b', '#838774'];
    for (let i = 0; i < 95; i++) {
      const x = rand() * width;
      const y = rand() * height;
      const rx = 10 + rand() * 26;
      const ry = 14 + rand() * 36;
      ctx.fillStyle = camoColors[i % camoColors.length];
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, (rand() - 0.5) * 0.5, 0, Math.PI * 2);
      ctx.fill();

      bumpCtx.strokeStyle = '#383838';
      bumpCtx.lineWidth = 1.8;
      bumpCtx.beginPath();
      bumpCtx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      bumpCtx.stroke();
    }
  } else {
    // Pine, Maple, Oak, Apple, Hickory, Twisted Elm, Ironwood, Boss Monarch Oak furrowed bark
    const palettes = {
      pine: { base: '#4d3222', rOff: 38, gOff: 14, bOff: 4, ridges: 38 },
      pitch_pine: { base: '#482816', rOff: 46, gOff: 22, bOff: 2, ridges: 44 },
      maple: { base: '#46382e', rOff: 22, gOff: 16, bOff: 12, ridges: 52 },
      swamp_cypress: { base: '#2c3627', rOff: 14, gOff: 24, bOff: 10, ridges: 58 },
      oak: { base: '#38291e', rOff: 24, gOff: 11, bOff: 0, ridges: 56 },
      forked_apple: { base: '#4f2f24', rOff: 36, gOff: 14, bOff: 8, ridges: 44 },
      frozen_tamarack: { base: '#2c3d4d', rOff: 18, gOff: 34, bOff: 52, ridges: 50 },
      knotty_oak: { base: '#332419', rOff: 22, gOff: 9, bOff: -2, ridges: 60 },
      borer_ash: { base: '#423b32', rOff: 28, gOff: 24, bOff: 14, ridges: 58 },
      gnarled_stump: { base: '#3b2818', rOff: 32, gOff: 18, bOff: 2, ridges: 66 },
      hickory: { base: '#3d3025', rOff: 26, gOff: 16, bOff: 6, ridges: 46 },
      cherry_crotch: { base: '#2b1b18', rOff: 28, gOff: 10, bOff: 8, ridges: 54 },
      lightning_oak: { base: '#1a1412', rOff: 22, gOff: 10, bOff: 4, ridges: 64 },
      twisted_elm: { base: '#3a322b', rOff: 20, gOff: 16, bOff: 10, ridges: 64 },
      burl_maple: { base: '#4f3620', rOff: 40, gOff: 24, bOff: 6, ridges: 62 },
      ironwood_hazard: { base: '#2c3036', rOff: 14, gOff: 16, bOff: 20, ridges: 68 },
      walnut_burl: { base: '#2d1e17', rOff: 28, gOff: 16, bOff: 10, ridges: 64 },
      chainsaw_hickory: { base: '#362a1f', rOff: 32, gOff: 20, bOff: 4, ridges: 54 },
      boss_oak: { base: '#281c14', rOff: 28, gOff: 12, bOff: -4, ridges: 72 },
      boss_stump: { base: '#24221f', rOff: 20, gOff: 22, bOff: 18, ridges: 76 },
      boss_osage: { base: '#4a2e10', rOff: 54, gOff: 28, bOff: -6, ridges: 70 },
      boss_bogoak: { base: '#14171c', rOff: 12, gOff: 18, bOff: 24, ridges: 80 },
      boss_locust: { base: '#1c1813', rOff: 34, gOff: 20, bOff: 4, ridges: 78 },
      boss_ironbark: { base: '#1a1625', rOff: 24, gOff: 14, bOff: 34, ridges: 82 }
    };
    const pal = palettes[species] || palettes.oak;

    ctx.fillStyle = pal.base;
    ctx.fillRect(0, 0, width, height);
    bumpCtx.fillStyle = '#505050';
    bumpCtx.fillRect(0, 0, width, height);
    roughCtx.fillStyle = '#d8d8d8';
    roughCtx.fillRect(0, 0, width, height);

    const ridgeCount = pal.ridges;
    for (let i = 0; i < ridgeCount; i++) {
      const baseX = (i / ridgeCount) * width;
      const ridgeW = 4 + rand() * 9;
      const shade = 34 + Math.floor(rand() * 36);
      const rCol = Math.min(255, shade + pal.rOff);
      const gCol = Math.min(255, shade + pal.gOff);
      const bCol = Math.max(0, shade + pal.bOff);

      ctx.strokeStyle = `rgb(${rCol}, ${gCol}, ${bCol})`;
      ctx.lineWidth = ridgeW;
      bumpCtx.strokeStyle = `rgb(${Math.min(255, shade * 3)}, ${Math.min(255, shade * 3)}, ${Math.min(255, shade * 3)})`;
      bumpCtx.lineWidth = ridgeW;
      roughCtx.strokeStyle = `rgb(${180 + (i % 4) * 15}, ${180 + (i % 4) * 15}, ${180 + (i % 4) * 15})`;
      roughCtx.lineWidth = ridgeW;

      ctx.beginPath();
      bumpCtx.beginPath();
      roughCtx.beginPath();
      let curX = baseX;
      ctx.moveTo(curX, 0);
      bumpCtx.moveTo(curX, 0);
      roughCtx.moveTo(curX, 0);
      for (let y = 0; y <= height; y += 16) {
        const wave =
          species === 'twisted_elm' || species === 'burl_maple'
            ? 12
            : species === 'hickory' || species === 'boss_oak' || species === 'boss_bogoak'
            ? 7
            : 4;
        const spiralDrift =
          species === 'twisted_elm' || species === 'burl_maple' ? (y / height) * 26 : 0;
        curX =
          baseX +
          spiralDrift +
          Math.sin(y * 0.04 + i) * wave +
          (rand() - 0.5) * 3.5;
        ctx.lineTo(curX, y);
        bumpCtx.lineTo(curX, y);
        roughCtx.lineTo(curX, y);
      }
      ctx.stroke();
      bumpCtx.stroke();
      roughCtx.stroke();

      // Deep dark furrow line beside ridge
      ctx.strokeStyle = 'rgba(18, 12, 8, 0.82)';
      ctx.lineWidth = 1.5 + rand() * 2;
      bumpCtx.strokeStyle = 'rgb(16, 16, 16)';
      bumpCtx.lineWidth = 2.5;
      ctx.stroke();
      bumpCtx.stroke();
    }

    // Lichen, moss, frost & rust specks (Boss Oak gets rich mossy ridges; Frozen Tamarack gets ice rime; Ironwood/Osage get rust)
    const speckCount = species === 'boss_oak' || species === 'frozen_tamarack' ? 150 : 95;
    for (let i = 0; i < speckCount; i++) {
      const x = rand() * width;
      const y = rand() * height;
      const rx = 1.5 + rand() * 4.5;
      const ry = 2 + rand() * 6.5;
      if (species === 'frozen_tamarack' && i % 2 === 0) {
        ctx.fillStyle = 'rgba(219, 234, 254, 0.56)';
      } else if (species === 'pitch_pine' && i % 2 === 0) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.65)';
      } else if (species === 'borer_ash' && i % 2 === 0) {
        ctx.fillStyle = 'rgba(214, 192, 150, 0.55)';
      } else if (species === 'boss_bogoak' && i % 2 === 0) {
        ctx.fillStyle = i % 4 === 0 ? 'rgba(56, 189, 248, 0.55)' : 'rgba(251, 191, 36, 0.52)';
      } else if ((species === 'lightning_oak' || species === 'boss_locust') && i % 2 === 0) {
        ctx.fillStyle = i % 4 === 0 ? 'rgba(251, 146, 60, 0.68)' : 'rgba(239, 68, 68, 0.55)';
      } else if ((species === 'ironwood_hazard' || species === 'boss_osage') && i % 3 === 0) {
        ctx.fillStyle = 'rgba(165, 62, 20, 0.48)';
      } else if (species === 'boss_oak' && i % 2 === 0) {
        ctx.fillStyle = 'rgba(76, 118, 48, 0.46)';
      } else {
        ctx.fillStyle =
          rand() > 0.45 ? 'rgba(94, 114, 72, 0.32)' : 'rgba(68, 52, 38, 0.35)';
      }
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;

  return { map, bumpMap, roughnessMap };
}

/**
 * Cross-section end grain texture with concentric annual growth rings, heartwood, sapwood,
 * medullary rays, and pith drying cracks.
 */
export function createEndGrainTextures(species = 'oak') {
  const size = 256;
  const { canvas, ctx } = createCanvas(size, size);
  const { canvas: bumpCanvas, ctx: bumpCtx } = createCanvas(size, size);
  const rand = mulberry32(303 + species.length * 17);
  const cx = size / 2;
  const cy = size / 2;

  const schemes = {
    pine: { sap: '#edd39c', heart0: '#d49b54', heart1: '#e4b976', ring: 'rgba(162, 102, 42, 0.48)', rings: 16 },
    birch: { sap: '#efe0be', heart0: '#c99c68', heart1: '#e3c796', ring: 'rgba(148, 104, 58, 0.42)', rings: 22 },
    hollow_sycamore: { sap: '#dfcbb0', heart0: '#4a3525', heart1: '#9c7c58', ring: 'rgba(110, 78, 48, 0.46)', rings: 24 },
    pitch_pine: { sap: '#f7d683', heart0: '#b45309', heart1: '#d97706', ring: 'rgba(180, 83, 9, 0.65)', rings: 22 },
    maple: { sap: '#e5c699', heart0: '#a86b3e', heart1: '#cf9e6c', ring: 'rgba(122, 72, 36, 0.50)', rings: 26 },
    swamp_cypress: { sap: '#c9c29f', heart0: '#5b5234', heart1: '#8b7e54', ring: 'rgba(72, 68, 38, 0.56)', rings: 28 },
    oak: { sap: '#d8b584', heart0: '#966436', heart1: '#b88754', ring: 'rgba(96, 56, 24, 0.58)', rings: 30 },
    forked_apple: { sap: '#e3be91', heart0: '#8a3e24', heart1: '#b86842', ring: 'rgba(108, 45, 22, 0.58)', rings: 28 },
    frozen_tamarack: { sap: '#dbeafe', heart0: '#60a5fa', heart1: '#93c5fd', ring: 'rgba(30, 64, 175, 0.52)', rings: 30 },
    knotty_oak: { sap: '#cfa672', heart0: '#7d4d25', heart1: '#a87644', ring: 'rgba(82, 44, 18, 0.65)', rings: 32 },
    borer_ash: { sap: '#ded1b4', heart0: '#7d6e54', heart1: '#a89674', ring: 'rgba(88, 74, 52, 0.56)', rings: 28 },
    gnarled_stump: { sap: '#deb86e', heart0: '#804a14', heart1: '#b87624', ring: 'rgba(92, 50, 12, 0.65)', rings: 34 },
    hickory: { sap: '#e2c391', heart0: '#784621', heart1: '#9c6639', ring: 'rgba(75, 40, 16, 0.65)', rings: 36 },
    cherry_crotch: { sap: '#e6c6a5', heart0: '#6e2219', heart1: '#a63e2e', ring: 'rgba(88, 24, 16, 0.62)', rings: 34 },
    lightning_oak: { sap: '#c9a677', heart0: '#3b180e', heart1: '#7c2d12', ring: 'rgba(234, 88, 12, 0.58)', rings: 36 },
    twisted_elm: { sap: '#d4b88c', heart0: '#6e4f35', heart1: '#997452', ring: 'rgba(84, 56, 32, 0.62)', rings: 38 },
    geode_sycamore: { sap: '#e2d4f0', heart0: '#3b0764', heart1: '#7e22ce', ring: 'rgba(126, 34, 206, 0.56)', rings: 34 },
    burl_maple: { sap: '#f2d49b', heart0: '#854d0e', heart1: '#ca8a04', ring: 'rgba(113, 63, 18, 0.68)', rings: 40 },
    ironwood_hazard: { sap: '#cbbfa8', heart0: '#544a40', heart1: '#7d7062', ring: 'rgba(62, 52, 42, 0.68)', rings: 44 },
    walnut_burl: { sap: '#e2cba4', heart0: '#2e160d', heart1: '#572f1c', ring: 'rgba(42, 20, 10, 0.72)', rings: 44 },
    chainsaw_hickory: { sap: '#e8d09e', heart0: '#6b3b18', heart1: '#9a5828', ring: 'rgba(82, 42, 16, 0.68)', rings: 42 },
    boss_oak: { sap: '#d4a66a', heart0: '#5e2714', heart1: '#8f4726', ring: 'rgba(68, 28, 12, 0.72)', rings: 48 },
    boss_stump: { sap: '#c4b293', heart0: '#3d281c', heart1: '#6e4c36', ring: 'rgba(54, 34, 20, 0.74)', rings: 52 },
    boss_osage: { sap: '#fde047', heart0: '#b45309', heart1: '#ea580c', ring: 'rgba(124, 45, 18, 0.72)', rings: 50 },
    boss_bogoak: { sap: '#475569', heart0: '#0f172a', heart1: '#1e293b', ring: 'rgba(148, 163, 184, 0.52)', rings: 56 },
    boss_locust: { sap: '#d9c77e', heart0: '#3f2e10', heart1: '#785616', ring: 'rgba(249, 115, 22, 0.65)', rings: 58 },
    boss_ironbark: { sap: '#c7b8d6', heart0: '#1e1b4b', heart1: '#4c1d95', ring: 'rgba(168, 85, 247, 0.65)', rings: 64 }
  };
  const sc = schemes[species] || schemes.oak;

  ctx.fillStyle = sc.sap;
  ctx.fillRect(0, 0, size, size);

  bumpCtx.fillStyle = '#909090';
  bumpCtx.fillRect(0, 0, size, size);

  const heartGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, size * 0.45);
  heartGrad.addColorStop(0, sc.heart0);
  heartGrad.addColorStop(0.55, sc.heart1);
  heartGrad.addColorStop(0.84, sc.sap);
  heartGrad.addColorStop(1, sc.sap);
  ctx.fillStyle = heartGrad;
  ctx.fillRect(0, 0, size, size);

  if (species === 'forked_apple' || species === 'walnut_burl' || species === 'chainsaw_hickory') {
    // Twin figure-8 pith centers for Y-shaped forked round!
    [-28, 28].forEach((offsetX) => {
      const px = cx + offsetX;
      for (let r = 1; r <= 14; r++) {
        const rad = (r / 14) * 44;
        ctx.beginPath();
        ctx.arc(px, cy, rad, 0, Math.PI * 2);
        ctx.strokeStyle = sc.ring;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    });
  } else if (species === 'cherry_crotch') {
    // Trefoil 3-pith centers for Trifurcated Black Cherry 3-Way Crown Fork!
    [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].forEach((ang) => {
      const px = cx + Math.cos(ang) * 28;
      const py = cy + Math.sin(ang) * 28;
      for (let r = 1; r <= 12; r++) {
        const rad = (r / 12) * 38;
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, Math.PI * 2);
        ctx.strokeStyle = sc.ring;
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
    });
  }

  // Concentric organic growth rings
  const ringCount = sc.rings;
  for (let r = 1; r <= ringCount; r++) {
    const baseRadius = (r / ringCount) * (size * 0.47);
    ctx.beginPath();
    bumpCtx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.08; a += 0.08) {
      const forkStretch =
        species === 'forked_apple' || species === 'chainsaw_hickory'
          ? Math.cos(a * 2) * (10 * (1 - r / ringCount))
          : species === 'burl_maple'
          ? Math.sin(a * 5 + r * 0.6) * (7 * (r / ringCount))
          : species === 'gnarled_stump' || species === 'boss_stump' || species === 'boss_bogoak' || species === 'boss_ironbark'
          ? Math.sin(a * 4 + 0.5) * (8 * (r / ringCount))
          : 0;
      const wobble =
        Math.sin(a * 3 + r * 0.4) * 1.4 +
        Math.cos(a * 7 - r * 0.2) * 0.8 +
        forkStretch;
      const rad = baseRadius + wobble;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      if (a === 0) {
        ctx.moveTo(x, y);
        bumpCtx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
        bumpCtx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = sc.ring;
    ctx.lineWidth = 1.1 + (r % 3) * 0.3;
    ctx.stroke();

    bumpCtx.strokeStyle = 'rgb(60, 60, 60)';
    bumpCtx.lineWidth = 1.2;
    bumpCtx.stroke();
  }

  // Hollow Sycamore & Mineralized Quartz-Geode Sycamore / Boss Ironbark: render central cavity or crystal druzy ring
  if (species === 'hollow_sycamore' || species === 'geode_sycamore' || species === 'boss_ironbark') {
    const rotGrad = ctx.createRadialGradient(cx, cy, 6, cx, cy, size * 0.22);
    if (species === 'geode_sycamore' || species === 'boss_ironbark') {
      rotGrad.addColorStop(0, '#0f0720');
      rotGrad.addColorStop(0.5, '#581c87');
      rotGrad.addColorStop(0.82, '#c084fc');
      rotGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    } else {
      rotGrad.addColorStop(0, '#140d08');
      rotGrad.addColorStop(0.58, '#291a10');
      rotGrad.addColorStop(0.85, '#593e25');
      rotGrad.addColorStop(1, 'rgba(90, 62, 37, 0.0)');
    }
    ctx.fillStyle = rotGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
    ctx.fill();

    bumpCtx.fillStyle = '#121212';
    bumpCtx.beginPath();
    bumpCtx.arc(cx, cy, size * 0.14, 0, Math.PI * 2);
    bumpCtx.fill();
  }

  // Mis-Bucked Sawmill Hickory Crotch: diagonal pinched chainsaw kerf burn & yellow lumber chalk line
  if (species === 'chainsaw_hickory') {
    ctx.strokeStyle = '#140d07';
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(cx - 4, 14);
    ctx.lineTo(cx + 4, size - 14);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(163, 230, 53, 0.85)';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(cx, 18);
    ctx.lineTo(cx, size - 18);
    ctx.stroke();
  }

  // Figured Birdseye Sugar Maple Burl & Black Walnut Crotch-Burl: swirling birdseye knots across the end-grain
  if (species === 'burl_maple' || species === 'walnut_burl') {
    for (let b = 0; b < 32; b++) {
      const ba = (b / 32) * Math.PI * 2 + rand() * 0.4;
      const br = size * (0.14 + rand() * 0.28);
      const bx = cx + Math.cos(ba) * br;
      const by = cy + Math.sin(ba) * br;
      ctx.strokeStyle = species === 'walnut_burl' ? 'rgba(42, 18, 8, 0.78)' : 'rgba(120, 53, 15, 0.68)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(bx, by, 3.5 + rand() * 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (species === 'lightning_oak' || species === 'boss_locust') {
    // Scorched Lichtenberg lightning-scar fissure lines radiating from center
    for (let f = 0; f < 6; f++) {
      const fa = (f / 6) * Math.PI * 2 + 0.12;
      ctx.strokeStyle = f % 2 === 0 ? 'rgba(251, 146, 60, 0.88)' : 'rgba(239, 68, 68, 0.78)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      let lx = cx;
      let ly = cy;
      ctx.moveTo(lx, ly);
      for (let step = 1; step <= 6; step++) {
        const rad = (step / 6) * (size * 0.45);
        const jitter = (rand() - 0.5) * 0.26;
        lx = cx + Math.cos(fa + jitter) * rad;
        ly = cy + Math.sin(fa + jitter) * rad;
        ctx.lineTo(lx, ly);
      }
      ctx.stroke();
    }
  } else if (species === 'borer_ash') {
    // Emerald Ash-Borer serpentine larval gallery tracks in the sapwood ring
    for (let g = 0; g < 14; g++) {
      const ga = (g / 14) * Math.PI * 2;
      const gr = size * (0.24 + (g % 3) * 0.06);
      ctx.strokeStyle = '#291d12';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(cx, cy, gr, ga, ga + 0.28);
      ctx.stroke();
    }
  } else if (species === 'boss_bogoak') {
    // Petrified Bog-Oak shimmering pyrite & quartz mineral veins
    for (let v = 0; v < 8; v++) {
      const va = (v / 8) * Math.PI * 2 + 0.2;
      ctx.strokeStyle = v % 2 === 0 ? 'rgba(56, 189, 248, 0.78)' : 'rgba(251, 191, 36, 0.78)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(va) * 14, cy + Math.sin(va) * 14);
      ctx.lineTo(cx + Math.cos(va + 0.18) * (size * 0.44), cy + Math.sin(va + 0.18) * (size * 0.44));
      ctx.stroke();
    }
  }

  // Medullary rays radiating from pith
  for (let i = 0; i < 42; i++) {
    const angle = (i / 42) * Math.PI * 2 + (rand() - 0.5) * 0.08;
    const inner = species === 'hollow_sycamore' ? size * 0.16 : 5 + rand() * 14;
    const outer = size * (0.25 + rand() * 0.22);
    ctx.strokeStyle = 'rgba(105, 65, 30, 0.24)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }

  // Radial drying checks / pith cracks
  const crackAngles = [0.0, 1.57, 3.14, 4.71];
  for (const baseAngle of crackAngles) {
    ctx.strokeStyle = '#3b2210';
    ctx.lineWidth = 1.8;
    bumpCtx.strokeStyle = '#181818';
    bumpCtx.lineWidth = 2.5;
    ctx.beginPath();
    bumpCtx.beginPath();
    ctx.moveTo(cx, cy);
    bumpCtx.moveTo(cx, cy);
    const maxLen = size * (0.2 + rand() * 0.2);
    for (let d = 5; d <= maxLen; d += 6) {
      const a = baseAngle + (rand() - 0.5) * 0.06;
      ctx.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
      bumpCtx.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
    }
    ctx.stroke();
    bumpCtx.stroke();
  }

  // Outer bark rim
  ctx.strokeStyle = species === 'birch' ? '#cfc9be' : '#3b291d';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.485, 0, Math.PI * 2);
  ctx.stroke();

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  return { map, bumpMap };
}

/**
 * Freshly split longitudinal interior wood grain texture (radial cleavage face)
 */
export function createSplitWoodTextures(species = 'oak') {
  const width = 256;
  const height = 256;
  const { canvas, ctx } = createCanvas(width, height);
  const { canvas: bumpCanvas, ctx: bumpCtx } = createCanvas(width, height);
  const rand = mulberry32(404 + species.length * 13);

  const tones = {
    pine: ['#dfb97c', '#f3dca8', '#fae8be', '#edd096', '#cfa468'],
    birch: ['#d8be98', '#efe0c2', '#f7ebd2', '#ead5b3', '#c6a882'],
    hollow_sycamore: ['#6e5034', '#bca07c', '#dfd0b8', '#bfa380', '#705236'],
    pitch_pine: ['#d97706', '#f59e0b', '#fde68a', '#fbbf24', '#b45309'],
    maple: ['#c79868', '#e3be92', '#edd0ab', '#ddb486', '#b58354'],
    swamp_cypress: ['#736c48', '#a39b70', '#c7be93', '#9c9468', '#635c3b'],
    oak: ['#c69762', '#dfc092', '#e8cfa6', '#dcb989', '#b88652'],
    forked_apple: ['#a85838', '#cf845c', '#e6ad86', '#c97c52', '#94492b'],
    frozen_tamarack: ['#93c5fd', '#dbeafe', '#eff6ff', '#bfdbfe', '#60a5fa'],
    knotty_oak: ['#b88550', '#d4ae7a', '#e0be8e', '#cfa470', '#a3713e'],
    borer_ash: ['#8c7b60', '#c4b393', '#dfd3b8', '#b8a686', '#73644c'],
    gnarled_stump: ['#9c621c', '#cc8c33', '#e8b358', '#c4832b', '#875114'],
    hickory: ['#9c683a', '#cfa474', '#e3be92', '#c89966', '#8a562b'],
    cherry_crotch: ['#7f291e', '#b84a39', '#d9735e', '#ad4232', '#691f16'],
    lightning_oak: ['#271712', '#7c2d12', '#ea580c', '#9a3412', '#1c120e'],
    twisted_elm: ['#8f6d4c', '#bda07e', '#d6bc9c', '#b59470', '#7d5c3d'],
    geode_sycamore: ['#6b21a8', '#c084fc', '#f3e8ff', '#a855f7', '#4c1d95'],
    burl_maple: ['#a16207', '#eab308', '#fef08a', '#ca8a04', '#854d0e'],
    ironwood_hazard: ['#786c5e', '#a89b88', '#c7bca8', '#9e907d', '#665b4e'],
    walnut_burl: ['#2e160d', '#5c331e', '#854d2b', '#4d2816', '#241109'],
    chainsaw_hickory: ['#854d27', '#c48f5a', '#e6c594', '#b87f49', '#6e3c1b'],
    boss_oak: ['#7a381c', '#b5683c', '#d99868', '#ad5e34', '#692d14'],
    boss_stump: ['#5c4230', '#8c694f', '#b59072', '#826046', '#4d3524'],
    boss_osage: ['#b45309', '#ea580c', '#fbbf24', '#d97706', '#9a3412'],
    boss_bogoak: ['#0f172a', '#1e293b', '#334155', '#1e293b', '#090d16'],
    boss_locust: ['#3f2e10', '#785616', '#d97706', '#854d0e', '#261c0a'],
    boss_ironbark: ['#1e1b4b', '#581c87', '#a855f7', '#3b0764', '#0f172a']
  };
  const cols = tones[species] || tones.oak;

  const grad = ctx.createLinearGradient(0, 0, width, 0);
  grad.addColorStop(0, cols[0]);
  grad.addColorStop(0.25, cols[1]);
  grad.addColorStop(0.5, cols[2]);
  grad.addColorStop(0.75, cols[3]);
  grad.addColorStop(1, cols[4]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  bumpCtx.fillStyle = '#808080';
  bumpCtx.fillRect(0, 0, width, height);

  for (let i = 0; i < 140; i++) {
    const x = (i / 140) * width + (rand() - 0.5) * 2.5;
    const alpha = 0.08 + rand() * 0.18;
    const dark = rand() > 0.45;
    ctx.strokeStyle = dark
      ? `rgba(120, 75, 34, ${alpha})`
      : `rgba(252, 238, 212, ${alpha + 0.07})`;
    ctx.lineWidth = 1 + rand() * 2;

    const bVal = dark ? 55 + Math.floor(rand() * 40) : 145 + Math.floor(rand() * 85);
    bumpCtx.strokeStyle = `rgb(${bVal}, ${bVal}, ${bVal})`;
    bumpCtx.lineWidth = 1.4 + rand() * 1.8;

    ctx.beginPath();
    bumpCtx.beginPath();
    ctx.moveTo(x, 0);
    bumpCtx.moveTo(x, 0);
    const waviness =
      species === 'twisted_elm' || species === 'burl_maple'
        ? 11.5
        : species === 'knotty_oak' || species === 'forked_apple' || species === 'boss_oak' || species === 'boss_bogoak'
        ? 5.8
        : 2.0;
    for (let y = 0; y <= height; y += 16) {
      const wx = x + Math.sin(y * 0.035 + i * 0.3) * waviness;
      ctx.lineTo(wx, y);
      bumpCtx.lineTo(wx, y);
    }
    ctx.stroke();
    bumpCtx.stroke();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;

  return { map, bumpMap };
}

/**
 * Red & black buffalo plaid flannel texture for the anonymous woodchopper's jacket
 */
export function createFlannelTexture() {
  const size = 128;
  const { canvas, ctx } = createCanvas(size, size);

  ctx.fillStyle = '#b22424';
  ctx.fillRect(0, 0, size, size);

  const stripe = 16;
  for (let i = 0; i < size; i += stripe * 2) {
    ctx.fillStyle = 'rgba(18, 20, 24, 0.55)';
    ctx.fillRect(i, 0, stripe, size);
    ctx.fillRect(0, i, size, stripe);
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  for (let i = -size; i < size * 2; i += 4) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3, 3);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/**
 * Indigo work denim texture for jeans
 */
export function createDenimTexture() {
  const size = 128;
  const { canvas, ctx } = createCanvas(size, size);
  const rand = mulberry32(505);

  ctx.fillStyle = '#263d5c';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 1200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    ctx.fillStyle =
      rand() > 0.5 ? 'rgba(200, 215, 240, 0.08)' : 'rgba(15, 25, 42, 0.12)';
    ctx.fillRect(x, y, 2, 2);
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/**
 * Suburban New Jersey horizontal vinyl clapboard siding texture
 */
export function createSidingTexture() {
  const width = 256;
  const height = 256;
  const { canvas, ctx } = createCanvas(width, height);
  const { canvas: bumpCanvas, ctx: bumpCtx } = createCanvas(width, height);

  ctx.fillStyle = '#d7dfe4';
  ctx.fillRect(0, 0, width, height);

  bumpCtx.fillStyle = '#808080';
  bumpCtx.fillRect(0, 0, width, height);

  const courses = 16;
  const courseH = height / courses;
  for (let i = 0; i < courses; i++) {
    const y = i * courseH;
    const g = ctx.createLinearGradient(0, y, 0, y + courseH);
    g.addColorStop(0, '#e2e9ee');
    g.addColorStop(0.82, '#cfd8df');
    g.addColorStop(0.95, '#9aa6b0');
    g.addColorStop(1, '#78848e');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, width, courseH);

    const bg = bumpCtx.createLinearGradient(0, y, 0, y + courseH);
    bg.addColorStop(0, '#a0a0a0');
    bg.addColorStop(0.9, '#ffffff');
    bg.addColorStop(1, '#252525');
    bumpCtx.fillStyle = bg;
    bumpCtx.fillRect(0, y, width, courseH);
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3, 2);
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(3, 2);

  return { map, bumpMap };
}

/**
 * Architectural asphalt roof shingle texture
 */
export function createRoofShingleTexture() {
  const size = 256;
  const { canvas, ctx } = createCanvas(size, size);
  const rand = mulberry32(606);

  ctx.fillStyle = '#33363b';
  ctx.fillRect(0, 0, size, size);

  const rows = 16;
  const cols = 8;
  const rowH = size / rows;
  const colW = size / cols;

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const x = c * colW + offset;
      const y = r * rowH;
      const shade = 44 + Math.floor(rand() * 22);
      ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 5})`;
      ctx.fillRect(x + 1, y + 1, colW - 2, rowH - 2);

      ctx.fillStyle = 'rgba(15, 16, 18, 0.55)';
      ctx.fillRect(x, y + rowH - 2, colW, 2);
    }
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(4, 3);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/**
 * Weathered cedar fence plank texture
 */
export function createCedarFenceTexture() {
  const size = 256;
  const { canvas, ctx } = createCanvas(size, size);
  const rand = mulberry32(707);

  ctx.fillStyle = '#8b6849';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 120; i++) {
    const x = rand() * size;
    ctx.strokeStyle =
      rand() > 0.5 ? 'rgba(65, 45, 28, 0.18)' : 'rgba(165, 132, 96, 0.14)';
    ctx.lineWidth = 1 + rand() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rand() - 0.5) * 5, size);
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}
