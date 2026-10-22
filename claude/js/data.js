// Game data: wood species (progression tiers), axes, shop upgrades and weather presets.

// tough: splitting-energy multiplier, hard: cutting resistance (edge penetration),
// value: base score, price: $ per split piece, unlock: player level.
export const SPECIES = [
  {
    id: 'pine', name: 'White pine', unlock: 1, density: 420, tough: 0.55, hard: 0.45, value: 40, price: 4,
    rings: [14, 28], latewood: 0.36, D: [0.24, 0.32],
    heart: [206, 166, 114], sap: [238, 218, 174], innerBark: [152, 92, 62], outerBark: [82, 68, 60],
    bark: { fx: 7, fy: 2, sharp: 1.5, warp: 0.5, dark: [58, 48, 42], light: [122, 106, 94] },
  },
  {
    id: 'cherry', name: 'Black cherry', unlock: 2, density: 560, tough: 0.72, hard: 0.7, value: 60, price: 6,
    rings: [25, 45], latewood: 0.15, D: [0.25, 0.33],
    heart: [170, 98, 66], sap: [216, 186, 150], innerBark: [132, 72, 52], outerBark: [46, 35, 33],
    bark: { fx: 5, fy: 6, sharp: 1.0, warp: 0.3, dark: [40, 30, 28], light: [92, 74, 66], plates: 0.7, lenticels: true },
  },
  {
    id: 'ash', name: 'White ash', unlock: 3, density: 670, tough: 0.7, hard: 0.85, value: 70, price: 7,
    rings: [18, 32], latewood: 0.32, D: [0.26, 0.35],
    heart: [190, 162, 122], sap: [228, 210, 174], innerBark: [152, 120, 90], outerBark: [102, 96, 88],
    bark: { fx: 12, fy: 3, sharp: 1.4, warp: 1.2, dark: [76, 70, 64], light: [152, 146, 136] },
  },
  {
    id: 'oak', name: 'Red oak', unlock: 4, density: 700, tough: 1.0, hard: 1.0, value: 95, price: 9,
    rings: [22, 40], latewood: 0.3, D: [0.27, 0.37],
    heart: [152, 104, 70], sap: [208, 180, 138], innerBark: [122, 74, 50], outerBark: [58, 50, 44],
    bark: { fx: 10, fy: 2, sharp: 1.8, warp: 0.35, dark: [50, 43, 38], light: [116, 106, 96], lichen: true },
  },
  {
    id: 'maple', name: 'Sugar maple', unlock: 6, density: 705, tough: 1.1, hard: 1.05, value: 115, price: 10,
    rings: [30, 55], latewood: 0.12, D: [0.28, 0.38],
    heart: [196, 160, 118], sap: [234, 214, 180], innerBark: [150, 110, 80], outerBark: [94, 88, 82],
    bark: { fx: 6, fy: 3, sharp: 1.2, warp: 0.6, dark: [68, 64, 60], light: [146, 140, 130], plates: 0.5 },
  },
  {
    id: 'hickory', name: 'Shagbark hickory', unlock: 8, density: 800, tough: 1.25, hard: 1.3, value: 145, price: 13,
    rings: [26, 48], latewood: 0.26, D: [0.28, 0.38],
    heart: [168, 124, 84], sap: [226, 204, 168], innerBark: [140, 104, 74], outerBark: [96, 88, 80],
    bark: { fx: 4, fy: 1.2, sharp: 2.4, warp: 0.25, dark: [52, 46, 40], light: [150, 140, 128], plates: 0.85 },
  },
  {
    // Hophornbeam ("ironwood"): a small, sinewy understory tree. Thin rounds, brutal to split, and
    // the dense fibres dull an edge three times faster than oak.
    id: 'ironwood', name: 'Ironwood', unlock: 9, density: 880, tough: 1.75, hard: 1.9, value: 165, price: 15, dulls: 3,
    rings: [40, 70], latewood: 0.1, D: [0.2, 0.27],
    heart: [176, 150, 112], sap: [222, 206, 176], innerBark: [142, 112, 86], outerBark: [96, 84, 74],
    bark: { fx: 16, fy: 1.4, sharp: 2.2, warp: 0.35, dark: [70, 62, 56], light: [148, 134, 120], plates: 0.45 },
  },
  {
    id: 'elm', name: 'American elm', unlock: 10, density: 600, tough: 1.5, hard: 0.9, value: 175, price: 12,
    interlocked: true, rings: [20, 36], latewood: 0.34, D: [0.3, 0.4],
    heart: [150, 110, 82], sap: [210, 188, 150], innerBark: [128, 96, 70], outerBark: [80, 72, 66],
    bark: { fx: 9, fy: 2.5, sharp: 1.3, warp: 0.9, dark: [62, 56, 50], light: [130, 120, 108] },
  },
];
export const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

// Axes. headMass / handleMass in kg; sharp = factory edge (0..1); wedge = splitting geometry
// factor (fat cheeks push the halves apart and stick less); paint = head colour.
export const AXES = [
  { id: 'utility', name: 'Hardware-store axe', price: 0, headMass: 1.6, handleMass: 0.75, sharp: 0.62, wedge: 0.86,
    paint: [0.55, 0.08, 0.06], handle: 'hickory', blurb: 'Thin felling bit. Bites deep, sticks often.' },
  { id: 'splitter', name: 'Splitting axe', price: 350, headMass: 2.6, handleMass: 0.9, sharp: 0.74, wedge: 1.0,
    paint: [0.07, 0.07, 0.075], handle: 'hickory', blurb: 'Classic 5.7 lb splitter. Good all-rounder.' },
  { id: 'maul', name: 'Splitting maul', price: 900, headMass: 3.6, handleMass: 1.0, sharp: 0.55, wedge: 1.22,
    paint: [0.62, 0.42, 0.05], handle: 'hickory', blurb: '8 lb maul. Brute force, tiring to swing.' },
  { id: 'composite', name: 'Composite splitter', price: 1600, headMass: 2.4, handleMass: 0.55, sharp: 0.9, wedge: 1.16,
    paint: [0.08, 0.08, 0.09], handle: 'composite', blurb: 'Light fibreglass handle, convex grind. Efficient.' },
  { id: 'monster', name: 'Monster maul', price: 2800, headMass: 5.4, handleMass: 1.1, sharp: 0.5, wedge: 1.32,
    paint: [0.18, 0.2, 0.55], handle: 'steel', blurb: '12 lb wedge-maul. For elm and the stubborn stuff.' },
];
export const AXES_BY_ID = Object.fromEntries(AXES.map((a) => [a.id, a]));

export const HONE_TIERS = [
  { price: 200, bonus: 0.06 },
  { price: 500, bonus: 0.06 },
  { price: 900, bonus: 0.06 },
];
export const GLOVES_PRICE = 250;
export const SHARPEN_PRICE = 15;

export const SKILLS = {
  strength: { name: 'Strength', max: 10, desc: '+6% muscle force per point (faster head speed).' },
  endurance: { name: 'Endurance', max: 10, desc: '+15 max stamina, +1.2/s regeneration, −3% swing cost per point.' },
  focus: { name: 'Focus', max: 10, desc: '−8% aim scatter, wider sweet zone, slower meter.' },
};

// Weather presets. temp in °C; wind in m/s (mean); fog = exponential fog density;
// clouds = sky coverage; precip = 'rain' | 'snow' | null.
export const WEATHER = {
  clear: { name: 'Clear', icon: '☀', temp: 19, wind: 1.5, fog: 0.004, clouds: 0.18, precip: null, bonus: 0 },
  rain: { name: 'Rain', icon: '🌧', temp: 12, wind: 3, fog: 0.012, clouds: 0.92, precip: 'rain', intensity: 0.7, bonus: 0.2 },
  storm: { name: 'Thunderstorm', icon: '⛈', temp: 15, wind: 9, fog: 0.016, clouds: 1.0, precip: 'rain', intensity: 1.0, lightning: true, bonus: 0.35 },
  snow: { name: 'Snow', icon: '❄', temp: -6, wind: 2.5, fog: 0.014, clouds: 0.85, precip: 'snow', intensity: 0.8, bonus: 0.25 },
  frost: { name: 'Hard frost', icon: '✱', temp: -9, wind: 0.8, fog: 0.006, clouds: 0.1, precip: null, frost: true, bonus: 0.12 },
  wind: { name: 'Windy', icon: '🌬', temp: 14, wind: 10, fog: 0.005, clouds: 0.5, precip: null, bonus: 0.15 },
  fog: { name: 'Fog', icon: '🌫', temp: 9, wind: 0.5, fog: 0.07, clouds: 0.7, precip: null, bonus: 0.1 },
};
export const WEATHER_ORDER = ['clear', 'rain', 'storm', 'snow', 'frost', 'wind', 'fog'];

export const xpForLevel = (L) => Math.round(120 * Math.pow(L, 1.55));

// Per-round variants ("traits"). They stack with the species and the weather and change the
// fracture physics as well as the look. value = score multiplier bonus, cash = cash multiplier.
//  knotty   3–5 knots: most split planes cross one, so read the end grain.
//  twisted  spiral grain: +30 % split energy, helical split faces, pieces spin off.
//  forked   Y-crotch: the split plane must contain the branch (through the pith) or it needs up
//           to 2.6× the energy and the fibres hold.
//  rotten   punky heart: much softer (−40…55 %), crumbles into extra pieces, worth less.
//  soaked   waterlogged: heavy, dark, wet bark glances, +18 % energy (like rain on any day).
//  iced     glazed in ice: the shell glances blows until it shatters; frozen wood is brittle.
//  rock     a stone grown into the trunk: hitting it ruins the edge (worse than a nail).
//  huge     oversized round (Ø46–54 cm): needs several strikes on the same line.
export const TRAITS = {
  knotty: { name: 'Knotty', icon: '◉', minLevel: 2, value: 0.3, cash: 1.1, tag: 'knot', desc: 'Several knots — find the clear line between them.' },
  twisted: { name: 'Twisted grain', icon: '↻', minLevel: 3, value: 0.25, cash: 1.1, tag: 'knot', desc: 'Spiral grain: +30% energy, helical faces.' },
  forked: { name: 'Forked crotch', icon: 'Y', minLevel: 4, value: 0.45, cash: 1.25, tag: 'knot', desc: 'Split through the fork (blade along the branch) or it will not open.' },
  rotten: { name: 'Punky heart', icon: '☁', minLevel: 2, value: -0.35, cash: 0.45, tag: 'rot', desc: 'Rotten core: soft and crumbly, low value.' },
  soaked: { name: 'Waterlogged', icon: '💧', minLevel: 2, value: 0.15, cash: 1.0, tag: 'wet', desc: 'Heavy and wet: +18% energy, bark glances.' },
  iced: { name: 'Ice-glazed', icon: '❄', minLevel: 3, value: 0.25, cash: 1.1, tag: 'frozen', desc: 'The glaze deflects blows until it shatters; frozen wood is brittle.' },
  rock: { name: 'Stone in bark', icon: '◆', minLevel: 5, value: 0.2, cash: 1.1, tag: 'nail', desc: 'A grown-in stone: keep the blade off its radial line.' },
  huge: { name: 'Huge round', icon: '⬤', minLevel: 4, value: 0.6, cash: 1.0, tag: 'crack', desc: 'Oversized: work one crack line over several strikes.' },
};
export const TRAIT_IDS = Object.keys(TRAITS);
