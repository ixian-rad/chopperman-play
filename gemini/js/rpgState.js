/**
 * RPG Progression, Scoring, Stamina, Upgrade Shop, Log Progression, and Persistence Manager.
 * Persists state to localStorage and exposes structured state for `window.getGameState()`.
 */

export const STORAGE_KEY = 'nj_backyard_axe_rpg_v2';

export const LOG_TYPES = {
  pine: {
    id: 'pine',
    name: 'Eastern White Pine',
    unlockLevel: 1,
    toughness: 85, // Base fracture resistance (HP)
    densityMass: 4.8,
    radius: 0.138,
    height: 0.43,
    knots: 0,
    nails: 0,
    spiralTwist: 0,
    isHollow: false,
    isForked: false,
    isResinous: true,
    sapPitchRate: 10,
    isBoss: false,
    basePoints: 100,
    baseXp: 35,
    description: 'Soft, straight-grained conifer. Splits cleanly with a single solid swing.'
  },
  birch: {
    id: 'birch',
    name: 'Paper Birch',
    unlockLevel: 1,
    toughness: 105,
    densityMass: 5.5,
    radius: 0.142,
    height: 0.44,
    knots: 0,
    nails: 0,
    spiralTwist: 0,
    isHollow: false,
    isForked: false,
    isBoss: false,
    basePoints: 135,
    baseXp: 48,
    description: 'Medium-soft white bark round. Rewards crisp center-grain alignment.'
  },
  hollow_sycamore: {
    id: 'hollow_sycamore',
    name: 'Hollow Punky Sycamore',
    unlockLevel: 2,
    toughness: 120,
    densityMass: 4.6,
    radius: 0.156,
    height: 0.44,
    knots: 0,
    nails: 0,
    spiralTwist: 0,
    isHollow: true,
    isForked: false,
    isBoss: false,
    basePoints: 165,
    baseXp: 60,
    description: 'Decayed hollow core! Dead-center hits punch into rot; aim slightly off-center into the solid sapwood wall.'
  },
  pitch_pine: {
    id: 'pitch_pine',
    name: 'Jersey Pine Barrens Pitch Pine (Resin Sap)',
    unlockLevel: 2,
    toughness: 130,
    densityMass: 5.8,
    radius: 0.148,
    height: 0.44,
    knots: 2,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.08,
    isHollow: false,
    isForked: false,
    isResinous: true,
    sapPitchRate: 28,
    isBoss: false,
    basePoints: 175,
    baseXp: 64,
    description: 'Oozing amber Pine Barrens resin! Sticky pitch gums up your axe cheeks (increasing kerf drag) until wiped/honed [H] or seared over the Bonfire [B]!'
  },
  maple: {
    id: 'maple',
    name: 'Seasoned Red Maple',
    unlockLevel: 2,
    toughness: 135,
    densityMass: 6.2,
    radius: 0.148,
    height: 0.44,
    knots: 1,
    nails: 0,
    rocks: 0,
    spiralTwist: 0,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 180,
    baseXp: 68,
    description: 'Dense suburban shade tree wood with a side branch knot.'
  },
  swamp_cypress: {
    id: 'swamp_cypress',
    name: 'Swamp Bald Cypress (Wet Sap)',
    unlockLevel: 3,
    toughness: 155,
    densityMass: 6.9,
    radius: 0.154,
    height: 0.44,
    knots: 1,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.08,
    isHollow: false,
    isForked: false,
    isWetLog: true,
    isResinous: true,
    sapPitchRate: 18,
    isIrregularStump: false,
    rootFlares: 3,
    isBoss: false,
    basePoints: 215,
    baseXp: 82,
    description: 'Waterlogged wetland cypress with slick mossy bark & basal fluting. Strike dead-center or wet bark deflects your bit!'
  },
  oak: {
    id: 'oak',
    name: 'Suburban White Oak',
    unlockLevel: 3,
    toughness: 170,
    densityMass: 7.2,
    radius: 0.155,
    height: 0.45,
    knots: 1,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.12,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 235,
    baseXp: 92,
    description: 'Heavy, tight-ringed New Jersey hardwood. Needs high momentum or two strikes.'
  },
  forked_apple: {
    id: 'forked_apple',
    name: 'Forked Applewood Crotch',
    unlockLevel: 4,
    toughness: 195,
    densityMass: 7.6,
    radius: 0.164,
    height: 0.45,
    knots: 1,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.18,
    isHollow: false,
    isForked: true,
    forkCount: 2,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 285,
    baseXp: 115,
    description: 'Y-shaped orchard crotch round with twin piths. Lop off the Y-branches, Flip [V], or cleave along the saddle seam!'
  },
  frozen_tamarack: {
    id: 'frozen_tamarack',
    name: 'Permafrost Boreal Tamarack (Ice Core)',
    unlockLevel: 4,
    toughness: 205,
    densityMass: 7.4,
    radius: 0.16,
    height: 0.45,
    knots: 1,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.14,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isFrozenLog: true,
    isIrregularStump: false,
    rootFlares: 2,
    isBoss: false,
    basePoints: 305,
    baseXp: 122,
    description: 'Deep-frozen boreal larch with a brittle ice-sap heartwood core! Center hits shatter cleanly (+24%), while rim hits skitter off the frost rind!'
  },
  knotty_oak: {
    id: 'knotty_oak',
    name: 'Knotty Pin Oak',
    unlockLevel: 4,
    toughness: 215,
    densityMass: 7.8,
    radius: 0.162,
    height: 0.45,
    knots: 3,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.22,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 320,
    baseXp: 130,
    description: 'Twisted grain with 3 protruding branch knots. Aim between knots along the check line!'
  },
  borer_ash: {
    id: 'borer_ash',
    name: 'Emerald Borer-Riddled Green Ash',
    unlockLevel: 5,
    toughness: 230,
    densityMass: 7.5,
    radius: 0.166,
    height: 0.45,
    knots: 1,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.15,
    isHollow: false,
    isForked: false,
    hasBorerGalleries: true,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 350,
    baseXp: 142,
    description: 'Suburban Green Ash honeycombed with serpentine larval borer galleries! Strike along the gallery fault (<36% offset) for a +26% Gallery Shatter!'
  },
  gnarled_stump: {
    id: 'gnarled_stump',
    name: 'Gnarled Yard Mulberry Stump',
    unlockLevel: 5,
    toughness: 245,
    densityMass: 8.5,
    radius: 0.176,
    height: 0.43,
    knots: 2,
    nails: 0,
    rocks: 1,
    spiralTwist: 0.24,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: true,
    rootFlares: 4,
    isBoss: false,
    basePoints: 385,
    baseXp: 155,
    description: 'Irregularly flared backyard stump gripping a granite lawn stone! Flip [V] to invert hazards or plant a Steel Wedge [W]!'
  },
  hickory: {
    id: 'hickory',
    name: 'Shagbark Hickory',
    unlockLevel: 5,
    toughness: 260,
    densityMass: 8.6,
    radius: 0.168,
    height: 0.46,
    knots: 2,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.25,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 420,
    baseXp: 170,
    description: 'Ultra-tough fibrous hardwood. Demands upgraded axe sharpness, mass, and timing.'
  },
  cherry_crotch: {
    id: 'cherry_crotch',
    name: 'Trifurcated Black Cherry Crotch',
    unlockLevel: 6,
    toughness: 285,
    densityMass: 8.7,
    radius: 0.174,
    height: 0.46,
    knots: 2,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.28,
    isHollow: false,
    isForked: true,
    forkCount: 3,
    isResinous: true,
    sapPitchRate: 14,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 465,
    baseXp: 192,
    description: '3-way orchard crown fork with trefoil piths! Lop off the 3 upper limbs or press [V] to Flip Upside-Down and cleave from the basal trunk!'
  },
  lightning_oak: {
    id: 'lightning_oak',
    name: 'Lightning-Struck Scorched Scarlet Oak',
    unlockLevel: 6,
    toughness: 295,
    densityMass: 8.8,
    radius: 0.172,
    height: 0.46,
    knots: 2,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.22,
    isHollow: false,
    isForked: false,
    isLightningStruck: true,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 485,
    baseXp: 200,
    description: 'Scorched by a summer thunderstorm! Strike along the glowing lightning fissure (<34% offset) for a +28% Fissure Shatter & Ember Burst (+18% bonus in Rain)!'
  },
  twisted_elm: {
    id: 'twisted_elm',
    name: 'Twisted American Elm',
    unlockLevel: 6,
    toughness: 310,
    densityMass: 8.9,
    radius: 0.174,
    height: 0.46,
    knots: 2,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.58,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 510,
    baseXp: 210,
    description: 'Interlocked helical grain that spirals down the round. Plant Dual Tandem Steel Wedges [W] or use a heavy maul!'
  },
  geode_sycamore: {
    id: 'geode_sycamore',
    name: 'Mineralized Quartz-Geode Sycamore',
    unlockLevel: 7,
    toughness: 330,
    densityMass: 9.2,
    radius: 0.178,
    height: 0.46,
    knots: 1,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.16,
    isHollow: true,
    hasCrystalGeode: true,
    isForked: false,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 575,
    baseXp: 238,
    description: 'Hollow sycamore lined with glittering amethyst & quartz crystals! Strike along the crystal seam (<38% offset) for a +26% Geode Shatter & +140 Jeweler Bonus!'
  },
  burl_maple: {
    id: 'burl_maple',
    name: 'Figured Birdseye Sugar Maple Burl',
    unlockLevel: 7,
    toughness: 340,
    densityMass: 9.4,
    radius: 0.182,
    height: 0.46,
    knots: 3,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.44,
    isHollow: false,
    isForked: false,
    isBurl: true,
    burlBulges: 3,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 590,
    baseXp: 245,
    description: 'Swirling birdseye burl with 3 bulbous 3D burl domes! Shear off the burl domes for +40 Cabinetmaker Credits or cleave with Dual Wedges [W] (+120 Burl Bonus)!'
  },
  ironwood_hazard: {
    id: 'ironwood_hazard',
    name: 'Fence-Row Ironwood (Nail Hazards)',
    unlockLevel: 7,
    toughness: 350,
    densityMass: 9.6,
    radius: 0.172,
    height: 0.46,
    knots: 2,
    nails: 2,
    rocks: 0,
    spiralTwist: 0.28,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 640,
    baseXp: 265,
    description: 'Old property-line Hornbeam embedded with rusty fence nails! Avoid metal hazards or Flip [V] to shift nails downward!'
  },
  walnut_burl: {
    id: 'walnut_burl',
    name: 'Seasoned Black Walnut Crotch-Burl',
    unlockLevel: 8,
    toughness: 395,
    densityMass: 10.2,
    radius: 0.188,
    height: 0.47,
    knots: 3,
    nails: 0,
    rocks: 0,
    spiralTwist: 0.36,
    isHollow: false,
    isForked: true,
    forkCount: 2,
    isBurl: true,
    burlBulges: 2,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 690,
    baseXp: 290,
    description: 'Prized chocolate-heartwood Y-fork with 2 bulbous burl domes! Lop limbs, shear burl domes (+55 Credits), or cleave for a +150 Walnut Burl Bonus!'
  },
  chainsaw_hickory: {
    id: 'chainsaw_hickory',
    name: 'Mis-Bucked Sawmill Hickory Crotch',
    unlockLevel: 9,
    toughness: 430,
    densityMass: 10.8,
    radius: 0.192,
    height: 0.47,
    knots: 3,
    nails: 1,
    rocks: 0,
    spiralTwist: 0.34,
    isHollow: false,
    isForked: true,
    forkCount: 2,
    hasPinchedKerf: true,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 760,
    baseXp: 315,
    description: 'Dense shagbark hickory Y-crotch with a pinched chainsaw kerf & jammed bar tip! Strike the sawmill kerf (<32% offset) or plant a Steel Wedge [W] for +30% Kerf Relief!'
  },
  boss_oak: {
    id: 'boss_oak',
    name: 'BOSS: Hearth Monarch Oak',
    unlockLevel: 8,
    toughness: 520,
    densityMass: 13.5,
    radius: 0.225,
    height: 0.48,
    knots: 4,
    nails: 1,
    rocks: 0,
    spiralTwist: 0.34,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: false,
    rootFlares: 4,
    isBoss: true,
    basePoints: 950,
    baseXp: 380,
    description: 'BOSS ROUND: Massive 24-inch gnarled NJ monarch oak with 4 knots and an iron staple. Sheds outer slabs before cleaving!'
  },
  boss_stump: {
    id: 'boss_stump',
    name: 'BOSS: Glacial Granite-Bound Stump',
    unlockLevel: 9,
    toughness: 620,
    densityMass: 15.2,
    radius: 0.235,
    height: 0.48,
    knots: 4,
    nails: 1,
    rocks: 2,
    spiralTwist: 0.42,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: true,
    rootFlares: 5,
    isBoss: true,
    basePoints: 1180,
    baseXp: 460,
    description: 'ANCIENT BOSS STUMP: Uprooted monarch stump with 5 gnarled root flares and 2 embedded granite fieldstones. Use Dual Steel Wedges [W]!'
  },
  boss_osage: {
    id: 'boss_osage',
    name: 'BOSS: Barbed-Wire Pasture Osage Orange',
    unlockLevel: 10,
    toughness: 720,
    densityMass: 16.5,
    radius: 0.245,
    height: 0.49,
    knots: 4,
    nails: 3,
    rocks: 1,
    spiralTwist: 0.48,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: true,
    hasBarbedWire: true,
    rootFlares: 5,
    isBoss: true,
    basePoints: 1450,
    baseXp: 560,
    description: 'LEGENDARY BOSS: Ultra-dense hedge-apple monarch overgrown around rusty barbed wire & 3 iron staples. Walk a crack with Dual Wedges [W]!'
  },
  boss_bogoak: {
    id: 'boss_bogoak',
    name: 'BOSS: Petrified Bog-Oak Leviathan',
    unlockLevel: 11,
    toughness: 840,
    densityMass: 18.2,
    radius: 0.252,
    height: 0.5,
    knots: 4,
    nails: 2,
    rocks: 2,
    spiralTwist: 0.52,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: true,
    isPetrifiedBog: true,
    rootFlares: 6,
    isBoss: true,
    basePoints: 1750,
    baseXp: 680,
    description: 'MYTHIC BOSS: Sub-fossilized glacial peat-bog oak streaked with mineralized quartz & pyrite veins (+750 Bounty). Flip [V] & drive Dual Wedges [W]!'
  },
  boss_locust: {
    id: 'boss_locust',
    name: 'BOSS: Thunderstorm Iron-Spike Locust Colossus',
    unlockLevel: 12,
    toughness: 960,
    densityMass: 19.8,
    radius: 0.26,
    height: 0.51,
    knots: 4,
    nails: 3,
    rocks: 2,
    spiralTwist: 0.55,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: true,
    isLightningStruck: true,
    rootFlares: 6,
    isBoss: true,
    basePoints: 2050,
    baseXp: 820,
    description: 'TITANIC BOSS: Lightning-charred Black Locust utility-line monarch with 3 iron spikes, 2 fieldstones & 6 root flares (+900 Bounty). Heave with Peavey [P] & drive Dual Wedges [W]!'
  },
  boss_ironbark: {
    id: 'boss_ironbark',
    name: 'BOSS: Colonial Boundary-Stone Ironbark Behemoth',
    unlockLevel: 13,
    toughness: 1080,
    densityMass: 21.5,
    radius: 0.268,
    height: 0.52,
    knots: 4,
    nails: 3,
    rocks: 3,
    spiralTwist: 0.58,
    isHollow: false,
    isForked: false,
    isWetLog: false,
    isFrozenLog: false,
    isIrregularStump: true,
    hasCrystalGeode: true,
    hasBarbedWire: true,
    rootFlares: 6,
    isBoss: true,
    basePoints: 2400,
    baseXp: 960,
    description: 'MYTHIC COLONIAL BOSS: 300-year-old NJ boundary-marker Ironbark overgrown around 3 granite boundary stones, 3 iron spikes & a crystal geode core (+1100 Bounty)!'
  }
};

export const LOG_ORDER = [
  'pine',
  'birch',
  'hollow_sycamore',
  'pitch_pine',
  'maple',
  'swamp_cypress',
  'oak',
  'forked_apple',
  'frozen_tamarack',
  'knotty_oak',
  'borer_ash',
  'gnarled_stump',
  'hickory',
  'cherry_crotch',
  'lightning_oak',
  'twisted_elm',
  'geode_sycamore',
  'burl_maple',
  'ironwood_hazard',
  'walnut_burl',
  'chainsaw_hickory',
  'boss_oak',
  'boss_stump',
  'boss_osage',
  'boss_bogoak',
  'boss_locust',
  'boss_ironbark'
];

export const FIREWOOD_ORDERS = [
  {
    id: 'patio_pack',
    title: 'Patio Firepit Bundle (3 Splits)',
    target: 3,
    rewardCredits: 180,
    rewardXp: 60
  },
  {
    id: 'hearth_cord',
    title: 'Suburban Hearth Cord (4 Splits)',
    target: 4,
    rewardCredits: 260,
    rewardXp: 85
  },
  {
    id: 'kindling_crate',
    title: 'Kindling & Stove Pack (4 Splits)',
    target: 4,
    rewardCredits: 320,
    rewardXp: 110
  },
  {
    id: 'cabinetmaker_lot',
    title: 'Cabinetmaker Burl & Geode Lot (5 Splits)',
    target: 5,
    rewardCredits: 420,
    rewardXp: 140
  },
  {
    id: 'winter_storm_cord',
    title: 'Winter Storm Emergency Cord (5 Splits)',
    target: 5,
    rewardCredits: 500,
    rewardXp: 175
  }
];

export const AXE_TIERS = [
  {
    id: 'sergey',
    legacyId: 'hickory_splitter',
    name: "Sergey's Hatchet (Default)",
    cost: 0,
    massKg: 2.2,
    sharpnessBonus: 1.0,
    wedgeFactor: 1.0,
    staminaFactor: 1.0,
    handleColor: 0xc89658,
    headColor: 0x393e46,
    bitColor: 0xd8dee6,
    headScale: [1.0, 1.0, 1.0],
    desc: "Sergey's balanced forged carbon-steel hatchet on a seasoned ash handle."
  },
  {
    id: 'double_bit',
    legacyId: 'swedish_forest',
    name: 'Double-Bit Felling Axe',
    cost: 450,
    massKg: 2.8,
    sharpnessBonus: 1.32,
    wedgeFactor: 1.25,
    staminaFactor: 0.92,
    handleColor: 0xd9b88c,
    headColor: 0x46515e,
    bitColor: 0xf8fafc,
    headScale: [1.18, 1.15, 1.22],
    desc: 'Twin-bevel high-carbon felling head slices cleanly through standing timber and knots.'
  },
  {
    id: 'maul',
    legacyId: 'splitting_maul',
    name: '8 lb Heavy Cast Splitting Maul',
    cost: 1200,
    massKg: 3.6,
    sharpnessBonus: 1.24,
    wedgeFactor: 1.48,
    staminaFactor: 1.1,
    handleColor: 0x9e632f,
    headColor: 0x22262b,
    bitColor: 0xe2e8f0,
    headScale: [1.45, 1.08, 1.12],
    desc: 'Broad flared wedge cheeks transfer massive lateral cleavage force into dense oak.'
  },
  {
    id: 'golden',
    legacyId: 'titanium_pro',
    name: 'Golden Lumberjack Pro Axe',
    cost: 2600,
    massKg: 3.3,
    sharpnessBonus: 1.75,
    wedgeFactor: 1.58,
    staminaFactor: 0.78,
    handleColor: 0x7c2d12,
    headColor: 0xd97706,
    bitColor: 0xfbbf24,
    headScale: [1.32, 1.18, 1.28],
    desc: 'Engraved 24k gold-nitride bevel edge with maximum cleavage and tree-felling power.'
  }
];

export function normalizeAxeId(axeId) {
  const map = {
    hickory_splitter: 'sergey',
    swedish_forest: 'double_bit',
    splitting_maul: 'maul',
    titanium_pro: 'golden',
    sergey: 'sergey',
    double_bit: 'double_bit',
    maul: 'maul',
    golden: 'golden'
  };
  return map[axeId] || 'sergey';
}

export const HANDLE_WRAPS = [
  {
    level: 0,
    id: 'raw_hickory',
    name: 'Standard Raw Hickory Shaft',
    cost: 0,
    staminaMult: 1.0,
    hazardChipMult: 1.0,
    jarProtect: 0.0,
    cleaveBonus: 1.0,
    wrapColor: 0x3b2718,
    bandColor: 0x3b2718,
    visible: false,
    desc: 'Unwrapped seasoned hickory shaft.'
  },
  {
    level: 1,
    id: 'leather_cord',
    name: 'Braided Saddle-Leather Wrap',
    cost: 220,
    staminaMult: 0.84,
    hazardChipMult: 0.72,
    jarProtect: 0.5,
    cleaveBonus: 1.05,
    wrapColor: 0x7c3f1d,
    bandColor: 0xd97706,
    visible: true,
    desc: '-16% swing stamina cost, -28% rock/nail edge shock, and +5% cleave transfer.'
  },
  {
    level: 2,
    id: 'vulcan_rubber',
    name: 'Vulcanized Shock-Mount Grip',
    cost: 520,
    staminaMult: 0.76,
    hazardChipMult: 0.42,
    jarProtect: 0.8,
    cleaveBonus: 1.1,
    wrapColor: 0x1e293b,
    bandColor: 0xef4444,
    visible: true,
    desc: '-24% swing stamina cost, -58% rock/nail edge chipping, and +10% cleave transfer.'
  },
  {
    level: 3,
    id: 'copper_paracord',
    name: 'Copper-Wired Lumberjack Paracord',
    cost: 950,
    staminaMult: 0.68,
    hazardChipMult: 0.25,
    jarProtect: 1.0,
    cleaveBonus: 1.15,
    wrapColor: 0x065f46,
    bandColor: 0xf59e0b,
    visible: true,
    desc: '-32% swing stamina cost, -75% rock/nail shock damage, zero cold hand-jar, and +15% cleave transfer!'
  }
];

export class GameStateManager {
  constructor(soundEffects = null) {
    this.sound = soundEffects;
    this._initDefaultState();
    this.loadFromStorage();
  }

  _initDefaultState() {
    this.score = 0;
    this.credits = 0; // Spendable points in Upgrade Shop (earned 1:1 with score + level bonuses)
    this.combo = 0;
    this.maxCombo = 0;
    this.xp = 0;
    this.level = 1;
    this.logsSplitCount = 0;

    // Upgrade levels (1 to 10)
    this.sharpnessLevel = 1;
    this.weightLevel = 1;
    this.staminaLevel = 1;

    // Backyard Setting ('nj' | 'tiraspol'), Character ('sergey' | 'alex'), Costume ('tee' | 'jacket' | 'camo' | 'bomber') & Player Name
    this.setting = 'nj';
    this.character = 'sergey';
    this.costume = 'tee';
    this.playerName = 'Sergey';
    this.customPlayerName = false;
    this.treesFelledCount = 0;

    // Axe equipment, live blade condition (0..100%), and sticky resin/sap buildup (0..100%)
    this.unlockedAxes = ['sergey'];
    this.equippedAxeId = 'sergey';
    this.axeCondition = 100;
    this.axeSapBuildup = 0;

    // Backyard Patio Firepit / Bonfire heat level (1..5; stoked by kindling or [B]), Ember-Tempered Blade timer & block scars
    this.bonfireLevel = 1;
    this.emberEdgeTimer = 0;
    this.overstrikeScarsCount = 0;

    // Roadside Firewood Stand Contract Orders
    this.ordersCompletedCount = 0;
    this.currentOrder = this._createOrderForIndex(0);

    // Challenge Mode state: 'campaign' | 'time_attack' | 'precision' | 'endless' | 'daily_seed'
    this.gameMode = 'campaign';
    this.challengeTimer = 0;
    this.challengeSplits = 0;
    this.challengeScore = 0;
    this.precisionStrikes = 0;
    this.precisionErrorSumCm = 0;
    this.bestTimeAttackScore = 0;
    this.dailySeedStr = new Date().toISOString().slice(0, 10);

    // Planted Steel Splitting Wedge state (supports up to 2 Dual Tandem Wedges)
    this.plantedWedgeActive = false;
    this.plantedWedgeOffsetX = 0;
    this.plantedWedgeStage = 0; // 0 = not planted, 1 = set in kerf, 2 = driven deep, 3 = ready to burst
    this.plantedWedges = [];
    this.plantedWedgeCount = 0;
    this.lastStruckWedgeIndex = -1;

    // Log Flip / Invert state, Peavey Cant-Hook lever state, Handle Wrap & Chopping Block Tire/Chain Collar Upgrade
    this.isLogFlipped = false;
    this.isPeaveySeated = false;
    this.handleWrapLevel = 0;
    this.collarUnlocked = false;
    this.collarActive = false;

    // Current Log state
    this.logType = 'pine';
    this.autoProgressLogs = true;
    this.currentLogMaxHp = LOG_TYPES.pine.toughness;
    this.currentLogHp = this.currentLogMaxHp;
    this.currentLogSwings = 0;

    // Stamina (0 .. maxStamina)
    this.maxStamina = this.getComputedMaxStamina();
    this.stamina = this.maxStamina;

    // Last hit telemetry for HUD & testing hook
    this.lastHit = null;
  }

  getEquippedAxe() {
    return AXE_TIERS.find((a) => a.id === this.equippedAxeId) || AXE_TIERS[0];
  }

  getCurrentLogDef() {
    return LOG_TYPES[this.logType] || LOG_TYPES.pine;
  }

  getComputedMaxStamina() {
    return 100 + (this.staminaLevel - 1) * 15;
  }

  getStaminaRegenRate(weather = 'sun') {
    const baseRegen = 15 + (this.staminaLevel - 1) * 2.8;
    // Snow & frost cold air slows stamina recovery by 20% unless warmed by a roaring backyard bonfire!
    const weatherMult =
      weather === 'snow' ? (this.bonfireLevel >= 3 ? 0.96 : 0.8) : 1.0;
    const bonfireBoost = 1.0 + Math.min(0.35, Math.max(0, this.bonfireLevel - 1) * 0.085);
    return baseRegen * weatherMult * bonfireBoost;
  }

  getSwingStaminaCost() {
    if (this.gameMode === 'time_attack') {
      return 6; // Reduced stamina drain during 60s Time Attack blitz
    }
    const axe = this.getEquippedAxe();
    const wrap = this.getHandleWrap();
    const efficiency = Math.max(0.55, 1.0 - (this.staminaLevel - 1) * 0.045);
    return Math.max(4, Math.round(16 * axe.staminaFactor * efficiency * (wrap ? wrap.staminaMult : 1.0)));
  }

  getHandleWrap() {
    return HANDLE_WRAPS[Math.max(0, Math.min(HANDLE_WRAPS.length - 1, this.handleWrapLevel || 0))];
  }

  getHandleWrapUpgradeCost() {
    const nextLvl = (this.handleWrapLevel || 0) + 1;
    if (nextLvl >= HANDLE_WRAPS.length) return null;
    return HANDLE_WRAPS[nextLvl].cost;
  }

  upgradeHandleWrap() {
    const nextLvl = (this.handleWrapLevel || 0) + 1;
    if (nextLvl >= HANDLE_WRAPS.length) {
      if (this.sound && typeof this.sound.playErrorBuzz === 'function') {
        this.sound.playErrorBuzz();
      }
      return false;
    }
    const cost = HANDLE_WRAPS[nextLvl].cost;
    if (this.credits < cost) {
      if (this.sound && typeof this.sound.playErrorBuzz === 'function') {
        this.sound.playErrorBuzz();
      }
      return false;
    }
    this.credits -= cost;
    this.handleWrapLevel = nextLvl;
    if (this.sound) this.sound.playUpgrade();
    this.saveToStorage();
    return true;
  }

  /**
   * Hooks and levers the active log with the Forged-Steel Cant-Hook Peavey (`P` / Peavey button / `window.heaveWithPeavey()`):
   * - Seats the round squarely on the chopping block (`isPeaveySeated = true`) for a +18% (+25% on Bosses) next-strike cleavage bonus.
   * - Restores +8 Stamina from mechanical lever advantage.
   */
  heaveWithPeavey() {
    this.isPeaveySeated = true;
    this.stamina = Math.min(this.maxStamina, this.stamina + 8);
    if (this.sound && typeof this.sound.playPeaveyHeave === 'function') {
      this.sound.playPeaveyHeave();
    }
    this.saveToStorage();
    return {
      peaveySeated: this.isPeaveySeated,
      logType: this.logType,
      stamina: Math.round(this.stamina)
    };
  }

  getEffectiveSharpness() {
    const axe = this.getEquippedAxe();
    const baseSharp = axe.sharpnessBonus * (1.0 + (this.sharpnessLevel - 1) * 0.14);
    // Dulled or nail-nicked edge reduces effective cutting power until honed with the whetstone
    const condFactor = 0.52 + 0.48 * (Math.max(15, this.axeCondition) / 100);
    return baseSharp * condFactor;
  }

  /**
   * Hones the axe blade with a whetstone back to 100% razor sharpness AND wipes/sears off sticky pine pitch sap!
   */
  honeBlade() {
    const hadSap = this.axeSapBuildup > 5;
    this.axeCondition = 100;
    this.axeSapBuildup = 0;
    if (this.sound) {
      if (typeof this.sound.playWhetstoneHone === 'function') {
        this.sound.playWhetstoneHone();
      }
      if (hadSap && typeof this.sound.playSapSizzle === 'function') {
        this.sound.playSapSizzle();
      }
    }
    this.saveToStorage();
    return this.axeCondition;
  }

  isEmberTempered() {
    return (this.emberEdgeTimer || 0) > 0;
  }

  _createOrderForIndex(idx = 0) {
    const tpl = FIREWOOD_ORDERS[idx % FIREWOOD_ORDERS.length];
    const tierScale = 1 + Math.floor(idx / FIREWOOD_ORDERS.length) * 0.25;
    return {
      id: tpl.id,
      title: tpl.title,
      target: tpl.target,
      progress: 0,
      rewardCredits: Math.round(tpl.rewardCredits * tierScale),
      rewardXp: Math.round(tpl.rewardXp * tierScale)
    };
  }

  _advanceOrderProgress(amount = 1) {
    if (!this.currentOrder) {
      this.currentOrder = this._createOrderForIndex(this.ordersCompletedCount || 0);
    }
    this.currentOrder.progress = Math.max(0, (this.currentOrder.progress || 0) + amount);
    if (this.currentOrder.progress >= this.currentOrder.target) {
      const completedTitle = this.currentOrder.title;
      const rewardCredits = this.currentOrder.rewardCredits;
      const rewardXp = this.currentOrder.rewardXp;
      this.ordersCompletedCount = (this.ordersCompletedCount || 0) + 1;
      this.credits += rewardCredits;
      this.score += rewardCredits;
      this.challengeScore += rewardCredits;
      this.xp += rewardXp;
      if (this.sound && typeof this.sound.playContractComplete === 'function') {
        this.sound.playContractComplete();
      }
      this.currentOrder = this._createOrderForIndex(this.ordersCompletedCount);
      return {
        completed: true,
        completedTitle,
        rewardCredits,
        rewardXp,
        ordersCompletedCount: this.ordersCompletedCount,
        currentOrder: { ...this.currentOrder }
      };
    }
    return {
      completed: false,
      progress: this.currentOrder.progress,
      target: this.currentOrder.target,
      ordersCompletedCount: this.ordersCompletedCount || 0,
      currentOrder: { ...this.currentOrder }
    };
  }

  /**
   * Ties & stacks a roadside cordwood bundle (`O` / Bundle button / `window.claimFirewoodOrder()`):
   * - Advances active Roadside Stand Firewood Order progress by +1 (completing the order when target reached).
   * - Awards +45 immediate Bundle Tying Credits (+ full Contract Payout if order completes!).
   */
  bundleFirewoodOrder() {
    const bundleBonus = 45;
    this.credits += bundleBonus;
    this.score += bundleBonus;
    const adv = this._advanceOrderProgress(1);
    if (!adv.completed && this.sound && typeof this.sound.playContractComplete === 'function') {
      this.sound.playContractComplete();
    }
    this.saveToStorage();
    return {
      ...adv,
      bundleBonus
    };
  }

  /**
   * Stokes the Backyard Patio Firepit (`B` / Bonfire button / `window.stokeBonfire()`):
   * - Surges `bonfireLevel` up to 5 (increasing warm firelight, ember sparks & stamina regen).
   * - At Level 5, heats the axe blade into an incandescent **Ember-Tempered Blade (`emberEdgeTimer = 18s`)**!
   * - Sears off all sticky pine pitch sap (`axeSapBuildup = 0`) over the flames.
   * - Warms the woodchopper (+25 Stamina recovery).
   */
  stokeBonfire() {
    this.bonfireLevel = Math.min(5, (this.bonfireLevel || 1) + 2);
    this.axeSapBuildup = 0;
    this.stamina = Math.min(this.maxStamina, this.stamina + 25);
    if (this.bonfireLevel >= 5) {
      this.emberEdgeTimer = 18.0;
      if (this.sound && typeof this.sound.playEmberTemperIgnite === 'function') {
        this.sound.playEmberTemperIgnite();
      }
    } else if (this.sound && typeof this.sound.playBonfireStoke === 'function') {
      this.sound.playBonfireStoke();
    }
    this.saveToStorage();
    return {
      bonfireLevel: this.bonfireLevel,
      emberTempered: this.isEmberTempered(),
      emberEdgeTimer: this.emberEdgeTimer,
      axeSapBuildup: this.axeSapBuildup,
      stamina: Math.round(this.stamina)
    };
  }

  /**
   * Plants up to 2 Dual Tandem Forged Steel Splitting Wedges into the log's top kerf.
   * Planting a second wedge creates a Tandem Wedge Span for alternating crack-walking strikes!
   */
  plantWedge(offsetX = 0) {
    let clampedX = Math.max(-0.095, Math.min(0.095, Number(offsetX) || 0));
    if (this.plantedWedges.length === 0) {
      this.plantedWedges.push({ offsetX: clampedX, stage: 1 });
    } else if (this.plantedWedges.length === 1) {
      const firstX = this.plantedWedges[0].offsetX;
      if (Math.abs(clampedX - firstX) < 0.028) {
        clampedX = firstX > 0.02 ? firstX - 0.052 : firstX + 0.052;
      }
      this.plantedWedges.push({ offsetX: clampedX, stage: 1 });
    } else {
      // Replace the older wedge position while keeping 2 tandem wedges active
      this.plantedWedges.shift();
      this.plantedWedges.push({ offsetX: clampedX, stage: 1 });
    }

    this.plantedWedgeActive = true;
    this.plantedWedgeCount = this.plantedWedges.length;
    this.plantedWedgeOffsetX = clampedX;
    this.plantedWedgeStage = Math.max(...this.plantedWedges.map((w) => w.stage));
    if (this.sound && typeof this.sound.playWedgePlant === 'function') {
      this.sound.playWedgePlant();
    }
    this.saveToStorage();
    return {
      planted: true,
      offsetX: this.plantedWedgeOffsetX,
      stage: this.plantedWedgeStage,
      count: this.plantedWedgeCount,
      wedges: this.plantedWedges
    };
  }

  /**
   * Flips / inverts the active log 180 degrees upside-down on the chopping block (`V` / Flip button).
   * Exposes straight basal grain on forked/stump rounds and shifts top rock/nail hazards downward.
   */
  flipLog() {
    this.isLogFlipped = !this.isLogFlipped;
    if (this.sound && typeof this.sound.playLogFlip === 'function') {
      this.sound.playLogFlip();
    }
    this.saveToStorage();
    return {
      flipped: this.isLogFlipped,
      logType: this.logType
    };
  }

  /**
   * Unlocks or toggles the Chopping Block Tire & Chain Collar (`350 Credits` in Shop).
   */
  buyOrToggleCollar() {
    const cost = 350;
    if (this.collarUnlocked) {
      this.collarActive = !this.collarActive;
      if (this.sound) this.sound.playUpgrade();
      this.saveToStorage();
      return { unlocked: true, active: this.collarActive };
    }
    if (this.credits >= cost) {
      this.credits -= cost;
      this.collarUnlocked = true;
      this.collarActive = true;
      if (this.sound) this.sound.playUpgrade();
      this.saveToStorage();
      return { unlocked: true, active: true };
    }
    if (this.sound && typeof this.sound.playErrorBuzz === 'function') {
      this.sound.playErrorBuzz();
    }
    return { unlocked: false, active: false };
  }

  /**
   * Awards bonus score, credits, XP, and +1 streak when the player performs a rapid follow-up
   * Kindling Quarter-Chop on a collar-held split round!
   */
  awardKindlingBonus() {
    const bonusPts = 95 + this.level * 12;
    const bonusXp = 35;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.score += bonusPts;
    this.credits += bonusPts;
    this.challengeScore += bonusPts;
    this.xp += bonusXp;
    // Kindling quarter-chops automatically feed the backyard firepit and melt sticky sap!
    this.bonfireLevel = Math.min(5, (this.bonfireLevel || 1) + 1);
    if (this.bonfireLevel >= 5) {
      this.emberEdgeTimer = Math.max(this.emberEdgeTimer || 0, 18.0);
    }
    this.axeSapBuildup = Math.max(0, Math.round(this.axeSapBuildup - 35));
    const orderAdv = this._advanceOrderProgress(2);
    if (this.sound && typeof this.sound.playBonfireStoke === 'function') {
      this.sound.playBonfireStoke();
    }
    this.lastHit = {
      ...(this.lastHit || {}),
      hit: true,
      split: true,
      kindlingQuartered: true,
      bonfireLevel: this.bonfireLevel,
      emberTempered: this.isEmberTempered(),
      orderCompleted: orderAdv.completed,
      rating: orderAdv.completed
        ? `KINDLING QUARTER-CHOP & CONTRACT COMPLETE! (+${bonusPts + orderAdv.rewardCredits} PTS)`
        : `TIRE COLLAR KINDLING QUARTER-CHOP! (+${bonusPts} BONUS • BONFIRE STOKED!)`,
      points: bonusPts + (orderAdv.completed ? orderAdv.rewardCredits : 0),
      xpGained: bonusXp + (orderAdv.completed ? orderAdv.rewardXp : 0),
      timestamp: Date.now()
    };
    this.saveToStorage();
    return this.lastHit;
  }

  /**
   * Levers/pries a wedged axe blade sideways inside a cracked log:
   * - Deals +24 internal lever cleavage damage.
   * - If the log is already weakened (<= 55 HP), prying pops the round wide open (`didSplit = true`)!
   * - Otherwise cleanly extracts the blade and restores +5 stamina.
   */
  pryWedgedBlade() {
    if (this.currentLogHp <= 0) return { split: false, extracted: true };
    const logDef = this.getCurrentLogDef();
    const pryDamage = 24 + this.weightLevel * 4;
    this.currentLogHp = Math.max(0, this.currentLogHp - pryDamage);

    if (this.sound) {
      if (typeof this.sound.playWedgeExtract === 'function') {
        this.sound.playWedgeExtract(this.currentLogHp <= 32);
      } else if (typeof this.sound.playFiberCreak === 'function') {
        this.sound.playFiberCreak(1.2);
      }
    }

    if (this.currentLogHp <= 32) {
      // Pop the cracked round wide open!
      this.currentLogHp = 0;
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.logsSplitCount++;
      this.challengeSplits++;
      const bonusPts = Math.round(logDef.basePoints * 0.65 + 65);
      const bonusXp = Math.round(logDef.baseXp * 0.6 + 20);
      this.score += bonusPts;
      this.credits += bonusPts;
      this.challengeScore += bonusPts;
      this.xp += bonusXp;
      this.plantedWedgeActive = false;
      this.plantedWedgeStage = 0;
      this._advanceOrderProgress(1);
      this.lastHit = {
        ...(this.lastHit || {}),
        hit: true,
        split: true,
        priedSplit: true,
        rating: 'PRY-BAR LEVER SPLIT! (+65 BONUS)',
        points: bonusPts,
        xpGained: bonusXp,
        remainingHp: 0,
        timestamp: Date.now()
      };
      this.saveToStorage();
      return { split: true, extracted: true, result: this.lastHit };
    }

    // Blade levered free with a small stamina recovery
    this.stamina = Math.min(this.maxStamina, this.stamina + 5);
    this.saveToStorage();
    return {
      split: false,
      extracted: true,
      remainingHp: Math.round(this.currentLogHp)
    };
  }

  /**
   * Switches active Challenge Mode ('campaign', 'time_attack', 'precision', 'endless', 'daily_seed').
   */
  setGameMode(mode) {
    const valid = ['campaign', 'time_attack', 'precision', 'endless', 'daily_seed'];
    this.gameMode = valid.includes(mode) ? mode : 'campaign';
    this.challengeSplits = 0;
    this.challengeScore = 0;
    this.precisionStrikes = 0;
    this.precisionErrorSumCm = 0;
    this.stamina = this.maxStamina;
    this.axeCondition = 100;
    this.plantedWedgeActive = false;
    this.plantedWedgeStage = 0;

    if (this.gameMode === 'time_attack') {
      this.challengeTimer = 60.0;
      this.autoProgressLogs = true;
    } else if (this.gameMode === 'precision') {
      this.challengeTimer = 0;
      this.logType = 'knotty_oak';
    } else if (this.gameMode === 'endless') {
      this.challengeTimer = 0;
      this.autoProgressLogs = true;
      this.logType = 'maple';
    } else if (this.gameMode === 'daily_seed') {
      this.challengeTimer = 0;
      const seq = this.getDailySeedLogSequence();
      this.logType = seq[0] || 'maple';
    } else {
      this.challengeTimer = 0;
    }

    this.resetCurrentLogHp();
    this.saveToStorage();
    return this.gameMode;
  }

  getDailySeedHash() {
    const str = this.dailySeedStr || '2026-10-23';
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  getDailySeedLogSequence() {
    let seed = this.getDailySeedHash();
    const pool = [
      'birch',
      'hollow_sycamore',
      'pitch_pine',
      'maple',
      'swamp_cypress',
      'oak',
      'forked_apple',
      'frozen_tamarack',
      'knotty_oak',
      'borer_ash',
      'gnarled_stump',
      'hickory',
      'cherry_crotch',
      'lightning_oak',
      'twisted_elm',
      'geode_sycamore',
      'burl_maple',
      'ironwood_hazard',
      'walnut_burl',
      'chainsaw_hickory',
      'boss_oak',
      'boss_stump',
      'boss_osage',
      'boss_bogoak',
      'boss_locust',
      'boss_ironbark'
    ];
    const seq = [];
    for (let i = 0; i < 8; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      seq.push(pool[seed % pool.length]);
    }
    return seq;
  }

  getEffectiveAxeMassKg() {
    const axe = this.getEquippedAxe();
    return axe.massKg * (1.0 + (this.weightLevel - 1) * 0.11);
  }

  getEffectiveWedgePower() {
    const axe = this.getEquippedAxe();
    const baseWedge = axe.wedgeFactor * (1.0 + (this.weightLevel - 1) * 0.12);
    // Sticky pine pitch / sap gum on the axe cheeks increases kerf friction and drags down wedge cleavage transfer
    const sapDragFactor = 1.0 - (Math.min(100, this.axeSapBuildup || 0) / 100) * 0.28;
    return baseWedge * sapDragFactor;
  }

  getXpForNextLevel(lvl = this.level) {
    return Math.round(100 * Math.pow(lvl, 1.35));
  }

  getUpgradeCost(statName) {
    const lvl =
      statName === 'sharpness'
        ? this.sharpnessLevel
        : statName === 'weight'
        ? this.weightLevel
        : this.staminaLevel;
    if (lvl >= 10) return null;
    return Math.round(90 * Math.pow(lvl, 1.45));
  }

  upgradeStat(statName) {
    const cost = this.getUpgradeCost(statName);
    if (cost === null || this.credits < cost) {
      if (this.sound && typeof this.sound.playErrorBuzz === 'function') {
        this.sound.playErrorBuzz();
      }
      return false;
    }

    this.credits -= cost;
    if (statName === 'sharpness') {
      this.sharpnessLevel++;
      this.axeCondition = 100;
    } else if (statName === 'weight') {
      this.weightLevel++;
    } else if (statName === 'stamina') {
      this.staminaLevel++;
      this.maxStamina = this.getComputedMaxStamina();
      this.stamina = Math.min(this.maxStamina, this.stamina + 25);
    }

    if (this.sound) this.sound.playUpgrade();
    this.saveToStorage();
    return true;
  }

  buyOrEquipAxe(axeId) {
    const normId = normalizeAxeId(axeId);
    const axe = AXE_TIERS.find((a) => a.id === normId);
    if (!axe) return false;

    if (this.unlockedAxes.includes(normId)) {
      this.equippedAxeId = normId;
      this.axeCondition = 100;
      if (this.sound) this.sound.playUpgrade();
      this.saveToStorage();
      return true;
    }

    if (this.credits >= axe.cost) {
      this.credits -= axe.cost;
      this.unlockedAxes.push(normId);
      this.equippedAxeId = normId;
      this.axeCondition = 100;
      if (this.sound) this.sound.playUpgrade();
      this.saveToStorage();
      return true;
    }
    if (this.sound && typeof this.sound.playErrorBuzz === 'function') {
      this.sound.playErrorBuzz();
    }
    return false;
  }

  forceEquipAxe(axeId) {
    const normId = normalizeAxeId(axeId);
    const axe = AXE_TIERS.find((a) => a.id === normId);
    if (!axe) return false;
    if (!this.unlockedAxes.includes(normId)) {
      this.unlockedAxes.push(normId);
    }
    this.equippedAxeId = normId;
    this.axeCondition = 100;
    this.saveToStorage();
    return true;
  }

  setSettingState(setting) {
    if (setting !== 'nj' && setting !== 'tiraspol') return false;
    this.setting = setting;
    this.saveToStorage();
    return true;
  }

  setCharacterState(character, costumeOverride = null) {
    const targetChar = character === 'alex' ? 'alex' : 'sergey';
    this.character = targetChar;
    const validCostumes = targetChar === 'alex' ? ['camo', 'bomber'] : ['tee', 'jacket'];
    this.costume =
      costumeOverride && validCostumes.includes(costumeOverride)
        ? costumeOverride
        : validCostumes[0];
    if (!this.customPlayerName) {
      this.playerName = targetChar === 'alex' ? 'Alex' : 'Sergey';
    }
    this.saveToStorage();
    return true;
  }

  setCostumeState(costume) {
    const validCostumes = ['tee', 'jacket', 'camo', 'bomber'];
    if (!validCostumes.includes(costume)) return false;
    this.costume = costume;
    const inferredChar = costume === 'camo' || costume === 'bomber' ? 'alex' : 'sergey';
    if (this.character !== inferredChar) {
      this.character = inferredChar;
      if (!this.customPlayerName) {
        this.playerName = inferredChar === 'alex' ? 'Alex' : 'Sergey';
      }
    }
    this.saveToStorage();
    return true;
  }

  setPlayerNameState(rawName, isCustom = true) {
    const cleaned = String(rawName || '')
      .replace(/[^\p{L}\p{N} _.'-]/gu, '')
      .trim()
      .slice(0, 16);
    if (!cleaned) {
      this.customPlayerName = false;
      this.playerName = this.character === 'alex' ? 'Alex' : 'Sergey';
    } else {
      this.playerName = cleaned;
      this.customPlayerName = Boolean(
        isCustom && cleaned !== 'Sergey' && cleaned !== 'Alex'
      );
    }
    this.saveToStorage();
    return this.playerName;
  }

  computeTreeFelledReward(hitsToFell = 6) {
    const points = Math.round(140 + (Number(hitsToFell) || 6) * 25);
    const xpGained = Math.round(55 + (Number(hitsToFell) || 6) * 12);
    return { points, xpGained };
  }

  applyCoopAward(ev = {}) {
    const gold = Math.max(0, Math.floor(Number(ev.gold) || 0));
    const xpGained = Math.max(0, Math.floor(Number(ev.xp) || 0));
    const reason = String(ev.reason || '');
    const shared = Boolean(ev.shared);

    if (!shared && reason.startsWith('tree:')) {
      this.treesFelledCount = (this.treesFelledCount || 0) + 1;
      this.logsSplitCount = (this.logsSplitCount || 0) + 1;
      this.combo = (this.combo || 0) + 1;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this._advanceOrderProgress(1);
    }

    this.score += gold;
    this.credits += gold;
    this.challengeScore += gold;
    this.xp += xpGained;

    let leveledUp = false;
    while (this.xp >= this.getXpForNextLevel(this.level)) {
      this.xp -= this.getXpForNextLevel(this.level);
      this.level++;
      leveledUp = true;
      this.credits += 100 * this.level;
      this.maxStamina = this.getComputedMaxStamina();
      this.stamina = this.maxStamina;
    }

    if (leveledUp && this.sound && typeof this.sound.playLevelUp === 'function') {
      this.sound.playLevelUp();
    } else if (gold > 0 && this.sound && typeof this.sound.playPointsGain === 'function') {
      this.sound.playPointsGain(gold);
    }

    if (!shared && reason.startsWith('tree:')) {
      const sp = reason.slice(5) || 'oak';
      const label = sp.charAt(0).toUpperCase() + sp.slice(1);
      this.lastHit = {
        hit: true,
        split: true,
        glancing: false,
        leveledUp,
        points: gold,
        xpGained,
        rating: `${label.toUpperCase()} TREE FELLED! (+${gold} CREDITS & CORDWOOD ADDED)`
      };
    }

    this.saveToStorage();
    return { gold, xpGained, leveledUp, shared };
  }

  awardTreeFelled(species = 'oak', hitsToFell = 6) {
    const points = Math.round(140 + (Number(hitsToFell) || 6) * 25);
    const xpGained = Math.round(55 + (Number(hitsToFell) || 6) * 12);
    this.treesFelledCount = (this.treesFelledCount || 0) + 1;
    this.logsSplitCount = (this.logsSplitCount || 0) + 1;
    this.combo = (this.combo || 0) + 1;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.score += points;
    this.credits += points;
    this.xp += xpGained;

    let leveledUp = false;
    while (this.xp >= this.getXpForNextLevel(this.level)) {
      this.xp -= this.getXpForNextLevel(this.level);
      this.level++;
      leveledUp = true;
      this.credits += 100 * this.level;
      this.maxStamina = this.getComputedMaxStamina();
      this.stamina = this.maxStamina;
    }
    if (leveledUp && this.sound && typeof this.sound.playLevelUp === 'function') {
      this.sound.playLevelUp();
    }
    this._advanceOrderProgress(1);
    const label = species.charAt(0).toUpperCase() + species.slice(1);
    const res = {
      hit: true,
      split: true,
      glancing: false,
      leveledUp,
      points,
      xpGained,
      rating: `${label.toUpperCase()} TREE FELLED! (+${points} CREDITS & CORDWOOD ADDED)`
    };
    this.lastHit = res;
    this.saveToStorage();
    return res;
  }

  setLogType(typeId, forceUnlock = false) {
    if (!LOG_TYPES[typeId]) return false;
    const def = LOG_TYPES[typeId];
    if (!forceUnlock && def.unlockLevel > this.level) {
      if (this.sound && typeof this.sound.playErrorBuzz === 'function') {
        this.sound.playErrorBuzz();
      }
      return false;
    }
    this.logType = typeId;
    this.resetCurrentLogHp();
    this.saveToStorage();
    return true;
  }

  resetCurrentLogHp() {
    const def = this.getCurrentLogDef();
    // Endless Endurance mode progressively scales log toughness as streak grows
    const endlessScale =
      this.gameMode === 'endless'
        ? 1.0 + Math.min(1.6, this.challengeSplits * 0.08)
        : 1.0;
    const scaledHp = Math.round(def.toughness * endlessScale);
    this.currentLogMaxHp = scaledHp;
    this.currentLogHp = scaledHp;
    this.currentLogSwings = 0;
    this.plantedWedgeActive = false;
    this.plantedWedgeStage = 0;
    this.plantedWedges = [];
    this.plantedWedgeCount = 0;
    this.lastStruckWedgeIndex = -1;
    this.isLogFlipped = false;
    this.isPeaveySeated = false;
  }

  /**
   * Advances to the next appropriate log in the progression if auto-progression is enabled.
   */
  advanceNextLog() {
    if (this.gameMode === 'daily_seed') {
      const seq = this.getDailySeedLogSequence();
      this.logType = seq[this.challengeSplits % seq.length] || 'maple';
      this.resetCurrentLogHp();
      this.saveToStorage();
      return this.logType;
    }

    if (this.gameMode === 'endless') {
      const endlessPool = LOG_ORDER;
      const idx = (this.challengeSplits + 2) % endlessPool.length;
      this.logType = endlessPool[idx] || 'maple';
      this.resetCurrentLogHp();
      this.saveToStorage();
      return this.logType;
    }

    if (!this.autoProgressLogs) {
      this.resetCurrentLogHp();
      return this.logType;
    }

    // Every 6th split in Campaign mode spawns a Boss Round (cycling 6 Bosses: Monarch Oak, Glacial Stump, Osage Orange, Bog-Oak Leviathan, Locust Colossus & Ironbark Behemoth)!
    if (
      this.gameMode === 'campaign' &&
      this.logsSplitCount > 0 &&
      this.logsSplitCount % 6 === 0 &&
      !LOG_TYPES[this.logType]?.isBoss
    ) {
      const bossCycle = Math.floor(this.logsSplitCount / 6) % 6;
      if (this.level >= 11 && bossCycle === 5) {
        this.logType = 'boss_ironbark';
      } else if (this.level >= 10 && bossCycle >= 4) {
        this.logType = 'boss_locust';
      } else if (this.level >= 9 && bossCycle >= 3) {
        this.logType = 'boss_bogoak';
      } else if (this.level >= 8 && bossCycle >= 2) {
        this.logType = 'boss_osage';
      } else if (this.level >= 7 && bossCycle >= 1) {
        this.logType = 'boss_stump';
      } else {
        this.logType = 'boss_oak';
      }
      this.resetCurrentLogHp();
      this.saveToStorage();
      return this.logType;
    }

    const unlocked = LOG_ORDER.filter((id) => LOG_TYPES[id].unlockLevel <= this.level);
    const curIdx = unlocked.indexOf(this.logType);
    const nextIdx = (curIdx + 1) % unlocked.length;
    this.logType = unlocked[nextIdx] || 'pine';
    this.resetCurrentLogHp();
    this.saveToStorage();
    return this.logType;
  }

  /**
   * Regenerates stamina over time and ticks active Challenge Mode & Ember-Tempered Blade timers.
   */
  updateStamina(dt, isIdle = true, weather = 'sun') {
    this.maxStamina = this.getComputedMaxStamina();
    if (isIdle && this.stamina < this.maxStamina) {
      this.stamina = Math.min(
        this.maxStamina,
        this.stamina + this.getStaminaRegenRate(weather) * dt
      );
    }
    if (this.emberEdgeTimer > 0) {
      this.emberEdgeTimer = Math.max(0, this.emberEdgeTimer - dt);
    }
    if (this.gameMode === 'time_attack' && this.challengeTimer > 0) {
      this.challengeTimer = Math.max(0, this.challengeTimer - dt);
    }
  }

  /**
   * Evaluates a chop strike against the current log, accounting for:
   * - Strike position relative to log center (`aimOffsetX`)
   * - Alignment with the wood grain check line (`grainAngleError` in radians)
   * - Proximity to 3D knots (`knotDistance` in meters)
   * - Proximity to embedded nails/rocks (`nailDistance` in meters)
   * - Hollow core, forked crotch seam, and spiral-twisted grain modifiers
   * - Swing power / Timing meter multiplier (`swingPower` 0.25..1.5)
   * - Weather conditions ('sun', 'rain', 'snow', 'wind', 'fog')
   * - Axe sharpness, live blade condition, weight, and player stamina
   */
  evaluateStrike({
    aimOffsetX = 0,
    grainAngleError = 0,
    knotDistance = 1.0,
    nailDistance = 1.0,
    rockDistance = 1.0,
    hitPlantedWedge = false,
    swingPower = 1.0,
    weather = 'sun',
    stormCharged = false,
    isAutomatedSwing = false,
    deferAwardToCoop = false
  }) {
    const logDef = this.getCurrentLogDef();
    const handleWrap = this.getHandleWrap();
    const prevCombo = this.combo;
    this.currentLogSwings++;

    // Ensure automated test swings always have stamina & sharp blade condition to perform a clean hit
    if (isAutomatedSwing) {
      if (this.stamina < 25) {
        this.stamina = Math.max(45, this.maxStamina * 0.65);
      }
      if (this.axeCondition < 85) {
        this.axeCondition = 100;
      }
    }

    // Stamina fatigue penalty if swinging while nearly exhausted (< 15 stamina)
    const staminaFatigueMult =
      this.stamina < 12 ? 0.62 : this.stamina < 25 ? 0.85 : 1.0;

    // Drain stamina for this swing
    const cost = this.getSwingStaminaCost();
    this.stamina = Math.max(0, Math.round((this.stamina - cost) * 10) / 10);

    // Normalize center accuracy (0 = dead center, 1 = outer bark edge)
    const absOffset = Math.abs(aimOffsetX);
    const normOffset = absOffset / logDef.radius;

    // Check if the player struck any planted Steel Splitting Wedge (supports Dual Tandem Wedges!)
    let struckWedgeIdx = -1;
    for (let i = 0; i < this.plantedWedges.length; i++) {
      if (Math.abs(aimOffsetX - this.plantedWedges[i].offsetX) < 0.042) {
        struckWedgeIdx = i;
        break;
      }
    }
    if (struckWedgeIdx === -1 && Boolean(hitPlantedWedge) && this.plantedWedges.length > 0) {
      struckWedgeIdx = 0;
    }

    // Flipping the log upside-down (`isLogFlipped`) shifts top-surface rocks/nails downward (+35% clearance!)
    const nailHazardDist = this.isLogFlipped ? 0.024 : 0.038;
    const rockHazardDist = this.isLogFlipped ? 0.027 : 0.042;

    const struckWedge =
      struckWedgeIdx !== -1 &&
      rockDistance >= rockHazardDist &&
      nailDistance >= nailHazardDist;

    const isTandemCrackWalk =
      struckWedge &&
      this.plantedWedges.length >= 2 &&
      (this.lastStruckWedgeIndex === -1 || this.lastStruckWedgeIndex !== struckWedgeIdx);

    if (struckWedge) {
      this.lastStruckWedgeIndex = struckWedgeIdx;
    }

    // Weather, Wet-Sap Cypress, Permafrost Ice Rind, Ember-Tempered Blade & Tire Collar effects on glancing slip threshold:
    const emberTempered = this.isEmberTempered();
    const collarMargin = this.collarActive ? 0.09 : 0;
    const baseGlance =
      weather === 'rain'
        ? 0.62
        : logDef.isFrozenLog && !emberTempered
        ? 0.6
        : logDef.isWetLog
        ? 0.65
        : 0.78;
    const glanceThreshold = Math.min(0.88, baseGlance + collarMargin);
    const isGlancing =
      !isAutomatedSwing && !struckWedge && normOffset > glanceThreshold;

    // Embedded Nail / Barbed-Wire & Granite Fieldstone Rock Hazard checks
    const hitNail =
      !isAutomatedSwing &&
      !isGlancing &&
      !struckWedge &&
      (logDef.nails || 0) > 0 &&
      nailDistance < nailHazardDist;
    const hitRock =
      !isAutomatedSwing &&
      !isGlancing &&
      !struckWedge &&
      !hitNail &&
      (logDef.rocks || 0) > 0 &&
      rockDistance < rockHazardDist;

    // Grain alignment bonus (1.0 when perpendicular to grain, up to 1.35 when aligned with check line)
    const grainAlignment = Math.max(0, Math.cos(grainAngleError * 2));
    let grainBonusMult = 0.82 + grainAlignment * 0.43;

    // Inverted / Flipped Log Bonus: flipping a Forked Crotch or Irregular Root Stump upside-down
    // exposes the straight basal trunk grain (+22% cleavage & bypasses crotch fiber compression!)
    const invertedBasalBonus =
      this.isLogFlipped && (logDef.isForked || logDef.isIrregularStump || (logDef.rootFlares || 0) > 0);
    if (invertedBasalBonus) {
      grainBonusMult *= 1.22;
    } else if (!isAutomatedSwing && logDef.isForked && !struckWedge) {
      // Forked Y-Crotch / 3-Way Cherry Crown modifier when upright
      grainBonusMult *= grainAlignment > 0.78 ? 1.2 : 0.76;
    }

    // Hollow Punky Log, Crystal Geode, Pinched Chainsaw Kerf, Permafrost Ice-Core, Ash-Borer Gallery & Lightning-Struck Fissure modifiers:
    const centerAccuracy = Math.max(0, 1.0 - normOffset * 0.95);
    let centerMult = isGlancing ? 0.22 : 0.65 + centerAccuracy * 0.6;
    let hitHollowVoid = false;
    let borerGalleryShatter = false;
    let lightningFissureShatter = false;
    let geodeCrystalShatter = false;
    let pinchedKerfRelief = false;

    if (logDef.hasCrystalGeode && !isGlancing && normOffset < 0.38) {
      // Mineralized Quartz-Geode Sycamore / Colonial Ironbark Behemoth crystal druzy seam shatters with +26% cleavage!
      geodeCrystalShatter = true;
      centerMult *= 1.26;
    } else if (!isAutomatedSwing && logDef.isHollow && !isGlancing && !struckWedge) {
      if (normOffset < 0.22) {
        hitHollowVoid = true;
        centerMult *= 0.68;
      } else if (normOffset <= 0.56) {
        centerMult = 1.25; // Solid sapwood rim sweet spot!
      }
    } else if (
      logDef.hasPinchedKerf &&
      !isGlancing &&
      (struckWedge || (normOffset < 0.32 && grainAlignment > 0.72))
    ) {
      // Mis-Bucked Sawmill Hickory Crotch pinched chainsaw kerf releases compression for +30% cleavage!
      pinchedKerfRelief = true;
      centerMult *= 1.3;
    } else if (logDef.isFrozenLog && !isGlancing && (normOffset < 0.36 || emberTempered)) {
      // Permafrost Boreal Tamarack brittle ice-sap core shatters with +24% cleavage propagation!
      centerMult *= 1.24;
    } else if (logDef.hasBorerGalleries && !isGlancing && normOffset < 0.36) {
      // Emerald Borer-Riddled Green Ash honeycombed larval gallery collapses with +26% cleavage propagation!
      borerGalleryShatter = true;
      centerMult *= 1.26;
    } else if (logDef.isLightningStruck && !isGlancing && normOffset < 0.34 && grainAlignment > 0.72) {
      // Lightning-Struck Scorched Oak / Locust Colossus pre-stressed Lichtenberg fissure shatters with +28% cleavage!
      lightningFissureShatter = true;
      centerMult *= 1.28;
    }

    // Knot interference: if striking within 0.042m of a knot without high sharpness
    const hitKnot =
      !isAutomatedSwing &&
      !hitNail &&
      !hitRock &&
      !struckWedge &&
      logDef.knots > 0 &&
      knotDistance < 0.042;
    const sharpness = this.getEffectiveSharpness();
    const knotMult = hitKnot ? Math.min(1.0, 0.42 * sharpness) : 1.0;
    const hazardMult = hitNail ? 0.25 : hitRock ? 0.18 : 1.0;

    // Spiral / Interlocked grain & Figured Birdseye Burl resistance (bypassed when driving a planted steel wedge!)
    const wedgePower = this.getEffectiveWedgePower();
    let twistResistance = struckWedge
      ? 1.32
      : !isAutomatedSwing && logDef.spiralTwist > 0.3
      ? Math.min(1.12, 0.76 + wedgePower * 0.22)
      : 1.0;
    if (!isAutomatedSwing && logDef.isBurl && !struckWedge && !this.isLogFlipped) {
      twistResistance *= 0.78;
    }

    // Steel Splitting Wedge & Dual Tandem Crack-Walk multiplier when hammered with the maul/axe poll
    let steelWedgeMult = 1.0;
    if (struckWedge) {
      if (this.plantedWedges[struckWedgeIdx]) {
        this.plantedWedges[struckWedgeIdx].stage = Math.min(
          3,
          (this.plantedWedges[struckWedgeIdx].stage || 1) + 1
        );
      }
      this.plantedWedgeStage = Math.min(3, (this.plantedWedgeStage || 1) + 1);
      const baseWedgeMult = isTandemCrackWalk
        ? 2.25
        : this.plantedWedges.length >= 2
        ? 1.98
        : 1.75;
      steelWedgeMult = baseWedgeMult + Math.min(0.45, (wedgePower - 1.0) * 0.6);
      centerMult = Math.max(centerMult, 1.28);
    }

    // Tire Collar stability bonus (+12% cleavage transfer when collar holds the round tight)
    const collarMult = this.collarActive ? 1.12 : 1.0;

    // Peavey Cant-Hook lever seating bonus (+18% cleavage, or +25% against Boss Rounds!)
    const peaveyBonusApplied = Boolean(this.isPeaveySeated) && !isGlancing;
    const peaveyMult = peaveyBonusApplied ? (logDef.isBoss ? 1.25 : 1.18) : 1.0;
    if (this.isPeaveySeated) {
      this.isPeaveySeated = false;
    }

    // Handle Grip Wrap cleavage transfer bonus (+5% to +15%)
    const wrapCleaveMult = handleWrap ? handleWrap.cleaveBonus : 1.0;

    // Thunderstorm Lightning Surge bonus (+15% kinetic cleavage during storm charge!)
    const stormSurgeApplied = Boolean(stormCharged) && !isGlancing;
    const stormMult = stormSurgeApplied ? 1.15 : 1.0;

    // Level-5 Bonfire Ember-Tempered Blade thermal cleavage bonus (+20% cleavage, or +32% thermal shock against frozen wood!)
    const emberEdgeMult = emberTempered
      ? logDef.isFrozenLog || weather === 'snow'
        ? 1.32
        : 1.2
      : 1.0;
    if (emberTempered) {
      this.axeSapBuildup = 0;
    }

    // Weather modifier on wood fracture:
    // - Rain / Wet Cypress: damp wood fibers absorb +12% impact energy (EXCEPT Lightning-Struck wood which gains +18% in Rain!)
    // - Snow/Frost or Frozen Tamarack: frozen sap makes wood brittle (+22% cleavage propagation!)
    const weatherCleavageMult =
      weather === 'snow' || logDef.isFrozenLog
        ? 1.22
        : weather === 'rain' && logDef.isLightningStruck
        ? 1.18
        : weather === 'rain' || logDef.isWetLog
        ? 0.9
        : 1.0;

    // Total effective cleavage damage against log structural toughness
    const massMult = this.getEffectiveAxeMassKg() / 2.2;
    const rawDamage =
      98 *
      swingPower *
      staminaFatigueMult *
      sharpness *
      massMult *
      centerMult *
      grainBonusMult *
      knotMult *
      hazardMult *
      twistResistance *
      steelWedgeMult *
      collarMult *
      peaveyMult *
      wrapCleaveMult *
      stormMult *
      emberEdgeMult *
      weatherCleavageMult;

    // Automated swings (`window.swing()`) with default/reasonable power should reliably split logs
    const effectiveDamage = isAutomatedSwing
      ? Math.max(rawDamage, this.currentLogHp + 10)
      : Math.round(rawDamage);

    // Apply live blade wear / hazard nicking (driving a steel wedge with the flat poll protects the sharp bit, and Shock-Mount Handle Wraps reduce rock/nail chipping!)
    const chipProtect = handleWrap ? handleWrap.hazardChipMult : 1.0;
    if (!isAutomatedSwing && !struckWedge) {
      if (hitRock) {
        this.axeCondition = Math.max(15, Math.round(this.axeCondition - 28 * chipProtect));
      } else if (hitNail) {
        this.axeCondition = Math.max(15, Math.round(this.axeCondition - 24 * chipProtect));
      } else if (isGlancing) {
        this.axeCondition = Math.max(15, Math.round(this.axeCondition - 14 * chipProtect));
      } else if (hitKnot) {
        this.axeCondition = Math.max(20, Math.round(this.axeCondition - 6 * chipProtect));
      } else {
        const wear = logDef.toughness >= 200 ? 3 : 1.5;
        this.axeCondition = Math.max(
          25,
          Math.round((this.axeCondition - wear) * 10) / 10
        );
      }

      // Accumulate sticky Pine Pitch / Sap Gum buildup on the axe cheeks when chopping resinous wood (unless Ember-Tempered)!
      if (logDef.isResinous && !hitRock && !hitNail && !emberTempered) {
        const baseSap = logDef.sapPitchRate || 14;
        const weatherSapMult =
          weather === 'snow' ? 0.55 : weather === 'sun' ? 1.2 : 0.9;
        const bonfireMeltMult = this.bonfireLevel >= 3 ? 0.55 : 1.0;
        const addedSap = Math.round(baseSap * weatherSapMult * bonfireMeltMult);
        this.axeSapBuildup = Math.min(100, (this.axeSapBuildup || 0) + addedSap);
      }
    }

    // Striking a Lightning-Struck round along its fissure showers hot embers that stoke the backyard bonfire!
    if (lightningFissureShatter) {
      this.bonfireLevel = Math.min(5, (this.bonfireLevel || 1) + 1);
      if (this.bonfireLevel >= 5) {
        this.emberEdgeTimer = Math.max(this.emberEdgeTimer || 0, 18.0);
      }
    }

    this.currentLogHp = Math.max(0, this.currentLogHp - effectiveDamage);
    const didSplit = !isGlancing && !hitNail && !hitRock && this.currentLogHp <= 0;
    if (didSplit || isGlancing) {
      this.overstrikeScarsCount = (this.overstrikeScarsCount || 0) + 1;
    }
    let orderResult = null;
    if (didSplit) {
      this.plantedWedgeActive = false;
      this.plantedWedgeStage = 0;
      this.plantedWedges = [];
      this.plantedWedgeCount = 0;
      this.lastStruckWedgeIndex = -1;
      orderResult = this._advanceOrderProgress(1);
    }

    // Check piece-by-piece dismemberment on Forked Y-Rounds, Figured Burl Domes, Irregular Root Stumps, or Multi-Hit Slabs
    const forkBranchSheared =
      !didSplit &&
      !isGlancing &&
      !hitNail &&
      !hitRock &&
      Boolean(logDef.isForked) &&
      effectiveDamage >= 52;
    const burlOutgrowthSheared =
      !didSplit &&
      !isGlancing &&
      !hitNail &&
      !hitRock &&
      !forkBranchSheared &&
      Boolean(logDef.isBurl) &&
      effectiveDamage >= 54;
    const rootButtressSheared =
      !didSplit &&
      !isGlancing &&
      !hitNail &&
      !hitRock &&
      !burlOutgrowthSheared &&
      Boolean(logDef.isIrregularStump || (logDef.rootFlares || 0) > 0) &&
      effectiveDamage >= 58;
    const slabSheared =
      !didSplit &&
      !isGlancing &&
      !hitNail &&
      !hitRock &&
      !forkBranchSheared &&
      !burlOutgrowthSheared &&
      !rootButtressSheared &&
      effectiveDamage >= 65;

    // Compute realistic edge penetration depth (in meters, 0.012m to 0.26m)
    const penetrationDepth =
      isGlancing || hitNail || hitRock
        ? 0.014
        : didSplit
        ? logDef.height
        : Math.min(
            logDef.height * 0.68,
            0.035 + (effectiveDamage / this.currentLogMaxHp) * 0.17
          );

    // Track Precision Challenge error
    this.precisionStrikes++;
    this.precisionErrorSumCm += absOffset * 100;

    // Scoring, Combo, and XP calculation
    let pointsAwarded = 0;
    let xpAwarded = 0;
    let rating = 'SOLID HIT';

    if (hitRock) {
      this.combo = 0;
      pointsAwarded = -35;
      xpAwarded = 5;
      rating = 'GRANITE ROCK HAZARD! EDGE CHIPPED (-28% SHARP)';
    } else if (hitNail) {
      this.combo = 0;
      pointsAwarded = -30;
      xpAwarded = 5;
      rating = logDef.hasBarbedWire
        ? 'BARBED-WIRE HAZARD! EDGE NICKED (-24% SHARP)'
        : 'NAIL HAZARD! EDGE NICKED (-24% SHARP)';
    } else if (isGlancing) {
      // Penalty for glancing / off-center hazard hit
      this.combo = 0;
      pointsAwarded = -25;
      xpAwarded = 5;
      rating =
        logDef.isFrozenLog
          ? 'FROST RIND GLANCE! (-25)'
          : weather === 'rain' || logDef.isWetLog
          ? 'WET BARK SLIP! (-25)'
          : 'GLANCING HIT! (-25)';
      // Cold snow or permafrost tamarack jars the hands on a glancing blow (reduced by Shock-Mount Handle Wraps!)
      if (weather === 'snow' || logDef.isFrozenLog) {
        const jarMult = Math.max(0, 1.0 - (handleWrap ? handleWrap.jarProtect : 0));
        this.stamina = Math.max(0, this.stamina - Math.round(8 * jarMult));
      }
    } else if (didSplit) {
      // Clean split!
      const isOneShot = this.currentLogSwings === 1;
      const isBullseye =
        (logDef.isHollow && !logDef.hasCrystalGeode
          ? normOffset >= 0.22 && normOffset <= 0.48
          : normOffset < 0.18) && grainAlignment > 0.75;

      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.logsSplitCount++;
      this.challengeSplits++;

      const comboMult = 1.0 + Math.min(this.combo - 1, 10) * 0.25;
      const accuracyBonus = Math.round(centerAccuracy * 75 + grainAlignment * 50);
      const oneShotBonus = isOneShot ? 60 : 0;
      const wedgeSplitBonus = isTandemCrackWalk ? 155 : struckWedge ? 85 : 0;
      const flipSplitBonus = invertedBasalBonus ? 55 : 0;
      const peaveySplitBonus = peaveyBonusApplied ? 65 : 0;
      const kerfReliefBonus = pinchedKerfRelief ? 95 : 0;
      const precisionModeBonus =
        this.gameMode === 'precision' && absOffset < 0.025 ? 140 : 0;
      const weatherBonus =
        weather === 'snow'
          ? 1.25
          : weather === 'rain' || weather === 'fog'
          ? 1.2
          : weather === 'wind'
          ? 1.15
          : 1.0;

      pointsAwarded = Math.round(
        (logDef.basePoints +
          accuracyBonus +
          oneShotBonus +
          wedgeSplitBonus +
          flipSplitBonus +
          peaveySplitBonus +
          kerfReliefBonus +
          precisionModeBonus) *
          comboMult *
          weatherBonus
      );
      xpAwarded = Math.round(
        (logDef.baseXp + accuracyBonus * 0.4) *
          (1 + Math.min(this.combo, 8) * 0.1) *
          weatherBonus
      );

      if (logDef.id === 'boss_ironbark') {
        rating = 'COLONIAL IRONBARK BEHEMOTH CLEAVED! (+1100 BOUNTY)';
        this.credits += 1100;
      } else if (logDef.id === 'boss_locust') {
        rating = 'THUNDERSTORM LOCUST COLOSSUS CLEAVED! (+900 BOUNTY)';
        this.credits += 900;
      } else if (logDef.id === 'boss_bogoak') {
        rating = 'PETRIFIED BOG-OAK LEVIATHAN CLEAVED! (+750 BOUNTY)';
        this.credits += 750;
      } else if (logDef.id === 'boss_osage') {
        rating = 'BARBED-WIRE OSAGE BOSS CLEAVED! (+600 BOUNTY)';
        this.credits += 600;
      } else if (logDef.id === 'boss_stump') {
        rating = 'ANCIENT GRANITE STUMP CLEAVED! (+450 BOUNTY)';
        this.credits += 450;
      } else if (logDef.isBoss) {
        rating = 'BOSS MONARCH CLEAVED! (+300 BOUNTY)';
        this.credits += 300;
      } else if (geodeCrystalShatter) {
        rating = 'GEODE CRYSTAL SHATTER! (+140 JEWELER BONUS)';
        this.credits += 140;
      } else if (pinchedKerfRelief) {
        rating = 'PINCHED KERF RELIEF CLEAVE! (+95 SAWMILL BONUS)';
        this.credits += 95;
      } else if (logDef.id === 'walnut_burl') {
        rating = 'BLACK WALNUT CROTCH-BURL CLEAVED! (+150 BURL BONUS)';
        this.credits += 150;
      } else if (logDef.isBurl) {
        rating = 'BIRDSEYE BURL MASTER CLEAVE! (+120 BURL BONUS)';
        this.credits += 120;
      } else if (isTandemCrackWalk) {
        rating = 'TANDEM WEDGE CRACK-WALK CLEAVE!';
      } else if (struckWedge) {
        rating = 'STEEL WEDGE MAUL CLEAVE!';
      } else if (lightningFissureShatter) {
        rating = 'LIGHTNING FISSURE SHATTER! (+28% CLEAVE & EMBER BURST)';
      } else if (emberTempered && (logDef.isFrozenLog || weather === 'snow')) {
        rating = 'EMBER-TEMPERED FROST SHATTER! (+32% THERMAL CLEAVE)';
      } else if (peaveyBonusApplied) {
        rating = 'PEAVEY CANT-HOOK LEVER CLEAVE!';
      } else if (invertedBasalBonus) {
        rating = 'INVERTED BASAL TRUNK CLEAVE!';
      } else if (borerGalleryShatter) {
        rating = 'ASH-BORER GALLERY SHATTER!';
      } else if (logDef.isFrozenLog && normOffset < 0.36) {
        rating = 'PERMAFROST ICE-CORE SHATTER!';
      } else if (emberTempered) {
        rating = 'EMBER-TEMPERED GRAIN CLEAVE!';
      } else if (isBullseye && isOneShot) {
        rating = 'PERFECT GRAIN CLEAVE!';
      } else if (logDef.isForked && grainAlignment > 0.8) {
        rating = 'CROTCH SEAM CLEAVE!';
      } else if (logDef.isHollow && !hitHollowVoid) {
        rating = 'HOLLOW SAPWOOD SPLIT!';
      } else if (isOneShot) {
        rating = 'CLEAN ONE-SHOT SPLIT!';
      } else {
        rating = 'LOG SPLIT!';
      }
    } else {
      // Partial penetration / wedged in tough wood or knot
      const partialRatio = effectiveDamage / this.currentLogMaxHp;
      pointsAwarded = Math.round(
        (isTandemCrackWalk ? 68 : struckWedge ? 48 : 30) *
          partialRatio *
          Math.max(0.4, centerAccuracy)
      );
      xpAwarded = Math.round((isTandemCrackWalk ? 28 : struckWedge ? 20 : 14) * partialRatio);
      if (isTandemCrackWalk) {
        rating = `TANDEM WEDGE CRACK-WALK! (${Math.round(this.currentLogHp)} HP LEFT)`;
      } else if (struckWedge) {
        rating = `STEEL WEDGE DRIVEN! (${Math.round(this.currentLogHp)} HP LEFT)`;
      } else if (hitKnot) {
        rating = 'KNOT DEFLECTION (WIGGLE OR [SPACE] TO PRY!)';
        this.combo = 0;
      } else if (hitHollowVoid) {
        rating = 'HOLLOW ROT VOID! AIM FOR SAPWOOD WALL';
      } else if (geodeCrystalShatter) {
        rating = `CRYSTAL GEODE SEAM CRACKED! (${Math.round(this.currentLogHp)} HP LEFT)`;
      } else if (pinchedKerfRelief) {
        rating = `SAWMILL KERF RELIEVED! (${Math.round(this.currentLogHp)} HP LEFT)`;
      } else if (burlOutgrowthSheared) {
        const burlReward = logDef.id === 'walnut_burl' ? 55 : 40;
        this.credits += burlReward;
        pointsAwarded += burlReward;
        rating = `${logDef.id === 'walnut_burl' ? 'WALNUT' : 'BIRDSEYE'} BURL DOME SHEARED! (+${burlReward} BURL • ${Math.round(this.currentLogHp)} HP LEFT)`;
      } else if (lightningFissureShatter) {
        rating = `LIGHTNING FISSURE CRACKED! (${Math.round(this.currentLogHp)} HP LEFT)`;
      } else if (forkBranchSheared) {
        rating = `CROWN FORK LIMB LOPPED! (${Math.round(this.currentLogHp)} HP LEFT)`;
      } else if (rootButtressSheared) {
        rating = `ROOT BUTTRESS SHEARED! (${Math.round(this.currentLogHp)} HP LEFT)`;
      } else if (slabSheared) {
        rating = `SIDE SLAB SHEARED! (${Math.round(this.currentLogHp)} HP LEFT)`;
      } else if (this.axeSapBuildup >= 50) {
        rating = `STICKY PITCH KERF DRAG! (HONE [H] OR BONFIRE [B] TO CLEAN SAP)`;
      } else {
        rating = `WEDGED ${Math.round(penetrationDepth * 100)}cm (WIGGLE / [SPACE] TO PRY!)`;
      }
    }

    if (!deferAwardToCoop) {
      this.score = Math.max(0, this.score + pointsAwarded);
      if (pointsAwarded > 0) {
        this.credits += pointsAwarded;
        this.challengeScore += pointsAwarded;
        if (this.sound && typeof this.sound.playPointsGain === 'function') {
          this.sound.playPointsGain(pointsAwarded);
        }
        if (
          this.gameMode === 'time_attack' &&
          this.challengeScore > this.bestTimeAttackScore
        ) {
          this.bestTimeAttackScore = this.challengeScore;
        }
      }
    } else if (pointsAwarded < 0) {
      this.score = Math.max(0, this.score + pointsAwarded);
    }

    if (this.sound) {
      if (didSplit && this.combo > 0 && typeof this.sound.playComboIncrement === 'function') {
        this.sound.playComboIncrement(this.combo);
      } else if (prevCombo > 0 && this.combo === 0 && typeof this.sound.playComboBreak === 'function') {
        this.sound.playComboBreak();
      }
      if (rating === 'PERFECT GRAIN CLEAVE!' && typeof this.sound.playPerfectHit === 'function') {
        this.sound.playPerfectHit();
      }
    }

    // Add XP & check for Level Up (unless deferred to co-op session award)
    let leveledUp = false;
    if (!deferAwardToCoop) {
      this.xp += xpAwarded;
      while (this.xp >= this.getXpForNextLevel(this.level)) {
        this.xp -= this.getXpForNextLevel(this.level);
        this.level++;
        leveledUp = true;
        this.credits += 100 * this.level;
        this.maxStamina = this.getComputedMaxStamina();
        this.stamina = this.maxStamina;
      }

      if (leveledUp && this.sound) {
        this.sound.playLevelUp();
      }
    }

    this.lastHit = {
      hit: true,
      split: didSplit,
      glancing: isGlancing,
      hitKnot,
      hitNail,
      hitRock,
      struckWedge,
      struckWedgeIdx,
      isTandemCrackWalk,
      invertedBasalBonus,
      peaveyBonusApplied,
      stormSurgeApplied,
      emberTempered,
      hitHollowVoid,
      borerGalleryShatter,
      lightningFissureShatter,
      geodeCrystalShatter,
      pinchedKerfRelief,
      orderCompleted: Boolean(orderResult && orderResult.completed),
      forkBranchSheared,
      burlOutgrowthSheared,
      rootButtressSheared,
      slabSheared,
      isBoss: Boolean(logDef.isBoss),
      rating,
      points: pointsAwarded,
      xpGained: xpAwarded,
      leveledUp,
      accuracy: Math.round(centerAccuracy * 100) / 100,
      grainAlignment: Math.round(grainAlignment * 100) / 100,
      power: Math.round(swingPower * 100) / 100,
      centerOffset: Math.round(aimOffsetX * 1000) / 1000,
      penetrationDepth: Math.round(penetrationDepth * 1000) / 1000,
      damage: effectiveDamage,
      remainingHp: this.currentLogHp,
      axeCondition: Math.round(this.axeCondition),
      axeSapBuildup: Math.round(this.axeSapBuildup || 0),
      bonfireLevel: this.bonfireLevel || 1,
      plantedWedgeStage: this.plantedWedgeStage,
      plantedWedgeCount: this.plantedWedgeCount,
      isLogFlipped: this.isLogFlipped,
      logType: this.logType,
      weather,
      timestamp: Date.now()
    };

    this.saveToStorage();
    return this.lastHit;
  }

  /**
   * Returns the canonical snapshot required by `window.getGameState()`.
   */
  getGameStateSnapshot() {
    const def = this.getCurrentLogDef();
    const wrap = this.getHandleWrap();
    return {
      score: this.score,
      combo: this.combo,
      xp: this.xp,
      level: this.level,
      stamina: Math.round(this.stamina),
      axeCondition: Math.round(this.axeCondition),
      axeSapBuildup: Math.round(this.axeSapBuildup || 0),
      bonfireLevel: this.bonfireLevel || 1,
      emberTempered: this.isEmberTempered(),
      emberEdgeTimer: Math.round((this.emberEdgeTimer || 0) * 10) / 10,
      ordersCompletedCount: this.ordersCompletedCount || 0,
      currentOrder: this.currentOrder ? { ...this.currentOrder } : null,
      overstrikeScarsCount: this.overstrikeScarsCount || 0,
      plantedWedge: this.plantedWedgeActive,
      plantedWedgeStage: this.plantedWedgeStage,
      plantedWedgeCount: this.plantedWedgeCount,
      plantedWedges: this.plantedWedges.map((w) => ({ ...w })),
      isLogFlipped: this.isLogFlipped,
      isPeaveySeated: Boolean(this.isPeaveySeated),
      handleWrapLevel: this.handleWrapLevel || 0,
      handleWrapName: wrap ? wrap.name : 'Standard Raw Hickory Shaft',
      collarUnlocked: this.collarUnlocked,
      collarEquipped: this.collarActive,
      logType: this.logType,
      logName: def.name,
      isBossLog: Boolean(def.isBoss),
      currentLogHp: Math.round(this.currentLogHp),
      currentLogMaxHp: Math.round(this.currentLogMaxHp),
      logsSplitCount: this.logsSplitCount,
      treesFelledCount: this.treesFelledCount || 0,
      setting: this.setting || 'nj',
      character: this.character || 'sergey',
      costume: this.costume || 'tee',
      playerName: this.playerName || 'Sergey',
      equippedAxeId: this.equippedAxeId || 'sergey',
      gameMode: this.gameMode,
      lastHit: this.lastHit
    };
  }

  saveToStorage() {
    try {
      const payload = {
        score: this.score,
        credits: this.credits,
        combo: this.combo,
        maxCombo: this.maxCombo,
        xp: this.xp,
        level: this.level,
        logsSplitCount: this.logsSplitCount,
        treesFelledCount: this.treesFelledCount,
        setting: this.setting,
        character: this.character,
        costume: this.costume,
        playerName: this.playerName,
        customPlayerName: this.customPlayerName,
        sharpnessLevel: this.sharpnessLevel,
        weightLevel: this.weightLevel,
        staminaLevel: this.staminaLevel,
        unlockedAxes: this.unlockedAxes,
        equippedAxeId: this.equippedAxeId,
        axeCondition: this.axeCondition,
        axeSapBuildup: this.axeSapBuildup,
        bonfireLevel: this.bonfireLevel,
        emberEdgeTimer: this.emberEdgeTimer,
        ordersCompletedCount: this.ordersCompletedCount,
        currentOrder: this.currentOrder,
        overstrikeScarsCount: this.overstrikeScarsCount,
        handleWrapLevel: this.handleWrapLevel,
        collarUnlocked: this.collarUnlocked,
        collarActive: this.collarActive,
        bestTimeAttackScore: this.bestTimeAttackScore,
        logType: this.logType,
        autoProgressLogs: this.autoProgressLogs
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage errors in private/sandboxed browsing
    }
  }

  loadFromStorage() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return false;

      if (typeof data.score === 'number') this.score = data.score;
      if (typeof data.credits === 'number') this.credits = data.credits;
      if (typeof data.combo === 'number') this.combo = data.combo;
      if (typeof data.maxCombo === 'number') this.maxCombo = data.maxCombo;
      if (typeof data.xp === 'number') this.xp = data.xp;
      if (typeof data.level === 'number') this.level = Math.max(1, data.level);
      if (typeof data.logsSplitCount === 'number') this.logsSplitCount = data.logsSplitCount;
      if (typeof data.treesFelledCount === 'number') this.treesFelledCount = data.treesFelledCount;
      if (data.setting === 'nj' || data.setting === 'tiraspol') this.setting = data.setting;
      if (data.character === 'sergey' || data.character === 'alex') this.character = data.character;
      if (['tee', 'jacket', 'camo', 'bomber'].includes(data.costume)) {
        this.costume = data.costume;
      } else {
        this.costume = this.character === 'alex' ? 'camo' : 'tee';
      }
      if (typeof data.customPlayerName === 'boolean') {
        this.customPlayerName = data.customPlayerName;
      }
      if (typeof data.playerName === 'string' && data.playerName.trim()) {
        this.playerName = data.playerName.trim().slice(0, 16);
      } else {
        this.playerName = this.character === 'alex' ? 'Alex' : 'Sergey';
      }
      if (typeof data.sharpnessLevel === 'number') this.sharpnessLevel = data.sharpnessLevel;
      if (typeof data.weightLevel === 'number') this.weightLevel = data.weightLevel;
      if (typeof data.staminaLevel === 'number') this.staminaLevel = data.staminaLevel;
      if (Array.isArray(data.unlockedAxes) && data.unlockedAxes.length > 0) {
        this.unlockedAxes = [...new Set(data.unlockedAxes.map((id) => normalizeAxeId(id)))];
      }
      if (typeof data.equippedAxeId === 'string') {
        this.equippedAxeId = normalizeAxeId(data.equippedAxeId);
      }
      if (typeof data.axeCondition === 'number') {
        this.axeCondition = Math.max(15, Math.min(100, data.axeCondition));
      }
      if (typeof data.axeSapBuildup === 'number') {
        this.axeSapBuildup = Math.max(0, Math.min(100, data.axeSapBuildup));
      }
      if (typeof data.bonfireLevel === 'number') {
        this.bonfireLevel = Math.max(1, Math.min(5, data.bonfireLevel));
      }
      if (typeof data.emberEdgeTimer === 'number') {
        this.emberEdgeTimer = Math.max(0, data.emberEdgeTimer);
      }
      if (typeof data.ordersCompletedCount === 'number') {
        this.ordersCompletedCount = Math.max(0, data.ordersCompletedCount);
      }
      if (data.currentOrder && typeof data.currentOrder === 'object') {
        this.currentOrder = data.currentOrder;
      }
      if (typeof data.overstrikeScarsCount === 'number') {
        this.overstrikeScarsCount = Math.max(0, data.overstrikeScarsCount);
      }
      if (typeof data.handleWrapLevel === 'number') {
        this.handleWrapLevel = Math.max(0, Math.min(HANDLE_WRAPS.length - 1, data.handleWrapLevel));
      }
      if (typeof data.collarUnlocked === 'boolean') {
        this.collarUnlocked = data.collarUnlocked;
      }
      if (typeof data.collarActive === 'boolean') {
        this.collarActive = data.collarActive;
      }
      if (typeof data.bestTimeAttackScore === 'number') {
        this.bestTimeAttackScore = data.bestTimeAttackScore;
      }
      if (typeof data.logType === 'string' && LOG_TYPES[data.logType]) {
        this.logType = data.logType;
      }
      if (typeof data.autoProgressLogs === 'boolean') {
        this.autoProgressLogs = data.autoProgressLogs;
      }

      this.maxStamina = this.getComputedMaxStamina();
      this.stamina = this.maxStamina;
      this.resetCurrentLogHp();
      return true;
    } catch {
      return false;
    }
  }

  resetProgress() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    this._initDefaultState();
    this.saveToStorage();
  }
}
