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
    maple: 203,
    swamp_cypress: 212,
    oak: 204,
    forked_apple: 208,
    knotty_oak: 205,
    gnarled_stump: 213,
    hickory: 206,
    twisted_elm: 209,
    ironwood_hazard: 210,
    boss_oak: 211,
    boss_stump: 214
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
  } else if (species === 'hollow_sycamore') {
    // American Sycamore: mottled camouflage plates of cream, sage-grey, and peeling tan bark
    ctx.fillStyle = '#9e9585';
    ctx.fillRect(0, 0, width, height);
    bumpCtx.fillStyle = '#787878';
    bumpCtx.fillRect(0, 0, width, height);
    roughCtx.fillStyle = '#c4c4c4';
    roughCtx.fillRect(0, 0, width, height);

    const camoColors = ['#cfc8b8', '#7d7769', '#635343', '#b5ad9b', '#838774'];
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
      maple: { base: '#46382e', rOff: 22, gOff: 16, bOff: 12, ridges: 52 },
      swamp_cypress: { base: '#2c3627', rOff: 14, gOff: 24, bOff: 10, ridges: 58 },
      oak: { base: '#38291e', rOff: 24, gOff: 11, bOff: 0, ridges: 56 },
      forked_apple: { base: '#4f2f24', rOff: 36, gOff: 14, bOff: 8, ridges: 44 },
      knotty_oak: { base: '#332419', rOff: 22, gOff: 9, bOff: -2, ridges: 60 },
      gnarled_stump: { base: '#3b2818', rOff: 32, gOff: 18, bOff: 2, ridges: 66 },
      hickory: { base: '#3d3025', rOff: 26, gOff: 16, bOff: 6, ridges: 46 },
      twisted_elm: { base: '#3a322b', rOff: 20, gOff: 16, bOff: 10, ridges: 64 },
      ironwood_hazard: { base: '#2c3036', rOff: 14, gOff: 16, bOff: 20, ridges: 68 },
      boss_oak: { base: '#281c14', rOff: 28, gOff: 12, bOff: -4, ridges: 72 },
      boss_stump: { base: '#24221f', rOff: 20, gOff: 22, bOff: 18, ridges: 76 }
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
          species === 'twisted_elm'
            ? 11
            : species === 'hickory' || species === 'boss_oak'
            ? 7
            : 4;
        const spiralDrift = species === 'twisted_elm' ? (y / height) * 28 : 0;
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

    // Lichen, moss & rust specks (Boss Oak gets rich mossy ridges; Ironwood gets rust streaks)
    const speckCount = species === 'boss_oak' ? 150 : 95;
    for (let i = 0; i < speckCount; i++) {
      const x = rand() * width;
      const y = rand() * height;
      const rx = 1.5 + rand() * 4.5;
      const ry = 2 + rand() * 6.5;
      if (species === 'ironwood_hazard' && i % 3 === 0) {
        ctx.fillStyle = 'rgba(145, 58, 24, 0.42)';
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
    maple: { sap: '#e5c699', heart0: '#a86b3e', heart1: '#cf9e6c', ring: 'rgba(122, 72, 36, 0.50)', rings: 26 },
    swamp_cypress: { sap: '#c9c29f', heart0: '#5b5234', heart1: '#8b7e54', ring: 'rgba(72, 68, 38, 0.56)', rings: 28 },
    oak: { sap: '#d8b584', heart0: '#966436', heart1: '#b88754', ring: 'rgba(96, 56, 24, 0.58)', rings: 30 },
    forked_apple: { sap: '#e3be91', heart0: '#8a3e24', heart1: '#b86842', ring: 'rgba(108, 45, 22, 0.58)', rings: 28 },
    knotty_oak: { sap: '#cfa672', heart0: '#7d4d25', heart1: '#a87644', ring: 'rgba(82, 44, 18, 0.65)', rings: 32 },
    gnarled_stump: { sap: '#deb86e', heart0: '#804a14', heart1: '#b87624', ring: 'rgba(92, 50, 12, 0.65)', rings: 34 },
    hickory: { sap: '#e2c391', heart0: '#784621', heart1: '#9c6639', ring: 'rgba(75, 40, 16, 0.65)', rings: 36 },
    twisted_elm: { sap: '#d4b88c', heart0: '#6e4f35', heart1: '#997452', ring: 'rgba(84, 56, 32, 0.62)', rings: 38 },
    ironwood_hazard: { sap: '#cbbfa8', heart0: '#544a40', heart1: '#7d7062', ring: 'rgba(62, 52, 42, 0.68)', rings: 44 },
    boss_oak: { sap: '#d4a66a', heart0: '#5e2714', heart1: '#8f4726', ring: 'rgba(68, 28, 12, 0.72)', rings: 48 },
    boss_stump: { sap: '#c4b293', heart0: '#3d281c', heart1: '#6e4c36', ring: 'rgba(54, 34, 20, 0.74)', rings: 52 }
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

  if (species === 'forked_apple') {
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
  }

  // Concentric organic growth rings
  const ringCount = sc.rings;
  for (let r = 1; r <= ringCount; r++) {
    const baseRadius = (r / ringCount) * (size * 0.47);
    ctx.beginPath();
    bumpCtx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.08; a += 0.08) {
      const forkStretch =
        species === 'forked_apple'
          ? Math.cos(a * 2) * (10 * (1 - r / ringCount))
          : species === 'gnarled_stump' || species === 'boss_stump'
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

  // Hollow Sycamore: render dark rotted central cavity & punky ring
  if (species === 'hollow_sycamore') {
    const rotGrad = ctx.createRadialGradient(cx, cy, 6, cx, cy, size * 0.22);
    rotGrad.addColorStop(0, '#140d08');
    rotGrad.addColorStop(0.58, '#291a10');
    rotGrad.addColorStop(0.85, '#593e25');
    rotGrad.addColorStop(1, 'rgba(90, 62, 37, 0.0)');
    ctx.fillStyle = rotGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
    ctx.fill();

    bumpCtx.fillStyle = '#121212';
    bumpCtx.beginPath();
    bumpCtx.arc(cx, cy, size * 0.14, 0, Math.PI * 2);
    bumpCtx.fill();
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
    maple: ['#c79868', '#e3be92', '#edd0ab', '#ddb486', '#b58354'],
    swamp_cypress: ['#736c48', '#a39b70', '#c7be93', '#9c9468', '#635c3b'],
    oak: ['#c69762', '#dfc092', '#e8cfa6', '#dcb989', '#b88652'],
    forked_apple: ['#a85838', '#cf845c', '#e6ad86', '#c97c52', '#94492b'],
    knotty_oak: ['#b88550', '#d4ae7a', '#e0be8e', '#cfa470', '#a3713e'],
    gnarled_stump: ['#9c621c', '#cc8c33', '#e8b358', '#c4832b', '#875114'],
    hickory: ['#9c683a', '#cfa474', '#e3be92', '#c89966', '#8a562b'],
    twisted_elm: ['#8f6d4c', '#bda07e', '#d6bc9c', '#b59470', '#7d5c3d'],
    ironwood_hazard: ['#786c5e', '#a89b88', '#c7bca8', '#9e907d', '#665b4e'],
    boss_oak: ['#7a381c', '#b5683c', '#d99868', '#ad5e34', '#692d14'],
    boss_stump: ['#5c4230', '#8c694f', '#b59072', '#826046', '#4d3524']
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
      species === 'twisted_elm'
        ? 10.5
        : species === 'knotty_oak' || species === 'forked_apple' || species === 'boss_oak'
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
