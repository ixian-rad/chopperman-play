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
    isWetLog: false,
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 285,
    baseXp: 115,
    description: 'Y-shaped orchard crotch round with twin piths. Lop off the Y-branches or cleave right along the central saddle seam!'
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
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 320,
    baseXp: 130,
    description: 'Twisted grain with 3 protruding branch knots. Aim between knots along the check line!'
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
    isIrregularStump: true,
    rootFlares: 4,
    isBoss: false,
    basePoints: 385,
    baseXp: 155,
    description: 'Irregularly flared backyard stump gripping a granite lawn stone! Shear off the root buttresses or plant a Steel Wedge [W]!'
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
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 420,
    baseXp: 170,
    description: 'Ultra-tough fibrous hardwood. Demands upgraded axe sharpness, mass, and timing.'
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
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 510,
    baseXp: 210,
    description: 'Interlocked helical grain that spirals down the round. Plant a Steel Wedge [W] or use a heavy maul!'
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
    isIrregularStump: false,
    rootFlares: 0,
    isBoss: false,
    basePoints: 640,
    baseXp: 265,
    description: 'Old property-line Hornbeam embedded with rusty fence nails! Avoid metal hazards or dull your axe!'
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
    isIrregularStump: true,
    rootFlares: 5,
    isBoss: true,
    basePoints: 1180,
    baseXp: 460,
    description: 'ANCIENT BOSS STUMP: Uprooted monarch stump with 5 gnarled root flares and 2 embedded granite fieldstones. Use a Steel Wedge [W]!'
  }
};

export const LOG_ORDER = [
  'pine',
  'birch',
  'hollow_sycamore',
  'maple',
  'swamp_cypress',
  'oak',
  'forked_apple',
  'knotty_oak',
  'gnarled_stump',
  'hickory',
  'twisted_elm',
  'ironwood_hazard',
  'boss_oak',
  'boss_stump'
];

export const AXE_TIERS = [
  {
    id: 'hickory_splitter',
    name: 'American Hickory Felling Axe',
    cost: 0,
    massKg: 2.2,
    sharpnessBonus: 1.0,
    wedgeFactor: 1.0,
    staminaFactor: 1.0,
    handleColor: 0xc89658,
    headColor: 0x393e46,
    bitColor: 0xd8dee6,
    headScale: [1.0, 1.0, 1.0],
    desc: 'Balanced 4.8 lb forged carbon-steel splitter on a curved hickory handle.'
  },
  {
    id: 'splitting_maul',
    name: '8 lb Heavy Cast Splitting Maul',
    cost: 450,
    massKg: 3.4,
    sharpnessBonus: 1.12,
    wedgeFactor: 1.38,
    staminaFactor: 1.12,
    handleColor: 0x9e632f,
    headColor: 0x22262b,
    bitColor: 0xe2e8f0,
    headScale: [1.45, 1.08, 1.12],
    desc: 'Broad flared wedge cheeks transfer massive lateral cleavage force into dense oak.'
  },
  {
    id: 'swedish_forest',
    name: 'Hand-Forged Swedish Damascus Axe',
    cost: 1200,
    massKg: 2.7,
    sharpnessBonus: 1.42,
    wedgeFactor: 1.25,
    staminaFactor: 0.9,
    handleColor: 0xd9b88c,
    headColor: 0x46515e,
    bitColor: 0xf8fafc,
    headScale: [1.15, 1.15, 1.22],
    desc: 'Razor-honed high-carbon bit slices cleanly through twisted grain and stubborn knots.'
  },
  {
    id: 'titanium_pro',
    name: 'Titanium-Core Lumberjack Pro',
    cost: 2600,
    massKg: 3.2,
    sharpnessBonus: 1.72,
    wedgeFactor: 1.55,
    staminaFactor: 0.78,
    handleColor: 0x1e242b,
    headColor: 0x15181e,
    bitColor: 0xfbbf24,
    headScale: [1.32, 1.18, 1.28],
    desc: 'Gold-nitride bevel edge with tungsten inertia core and composite anti-vibe shaft.'
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

    // Axe equipment & live blade condition (0..100%; damaged by embedded nails/rocks, restored by whetstone honing)
    this.unlockedAxes = ['hickory_splitter'];
    this.equippedAxeId = 'hickory_splitter';
    this.axeCondition = 100;

    // Challenge Mode state: 'campaign' | 'time_attack' | 'precision' | 'endless' | 'daily_seed'
    this.gameMode = 'campaign';
    this.challengeTimer = 0;
    this.challengeSplits = 0;
    this.challengeScore = 0;
    this.precisionStrikes = 0;
    this.precisionErrorSumCm = 0;
    this.bestTimeAttackScore = 0;
    this.dailySeedStr = new Date().toISOString().slice(0, 10);

    // Planted Steel Splitting Wedge state
    this.plantedWedgeActive = false;
    this.plantedWedgeOffsetX = 0;
    this.plantedWedgeStage = 0; // 0 = not planted, 1 = set in kerf, 2 = driven deep, 3 = ready to burst

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
    // Snow & frost cold air slows stamina recovery by 20%
    const weatherMult = weather === 'snow' ? 0.8 : 1.0;
    return baseRegen * weatherMult;
  }

  getSwingStaminaCost() {
    if (this.gameMode === 'time_attack') {
      return 6; // Reduced stamina drain during 60s Time Attack blitz
    }
    const axe = this.getEquippedAxe();
    const efficiency = Math.max(0.55, 1.0 - (this.staminaLevel - 1) * 0.045);
    return Math.round(16 * axe.staminaFactor * efficiency);
  }

  getEffectiveSharpness() {
    const axe = this.getEquippedAxe();
    const baseSharp = axe.sharpnessBonus * (1.0 + (this.sharpnessLevel - 1) * 0.14);
    // Dulled or nail-nicked edge reduces effective cutting power until honed with the whetstone
    const condFactor = 0.52 + 0.48 * (Math.max(15, this.axeCondition) / 100);
    return baseSharp * condFactor;
  }

  /**
   * Hones the axe blade with a whetstone back to 100% razor sharpness.
   */
  honeBlade() {
    this.axeCondition = 100;
    if (this.sound && typeof this.sound.playWhetstoneHone === 'function') {
      this.sound.playWhetstoneHone();
    }
    this.saveToStorage();
    return this.axeCondition;
  }

  /**
   * Plants a forged steel splitting wedge into the log's top kerf at `offsetX`.
   */
  plantWedge(offsetX = 0) {
    this.plantedWedgeActive = true;
    this.plantedWedgeOffsetX = Math.max(-0.08, Math.min(0.08, Number(offsetX) || 0));
    this.plantedWedgeStage = Math.max(1, this.plantedWedgeStage);
    if (this.sound && typeof this.sound.playWedgePlant === 'function') {
      this.sound.playWedgePlant();
    }
    this.saveToStorage();
    return {
      planted: true,
      offsetX: this.plantedWedgeOffsetX,
      stage: this.plantedWedgeStage
    };
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

    if (this.sound && typeof this.sound.playFiberCreak === 'function') {
      this.sound.playFiberCreak(1.2);
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
      'maple',
      'swamp_cypress',
      'oak',
      'forked_apple',
      'knotty_oak',
      'gnarled_stump',
      'hickory',
      'twisted_elm',
      'ironwood_hazard',
      'boss_oak',
      'boss_stump'
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
    return axe.wedgeFactor * (1.0 + (this.weightLevel - 1) * 0.12);
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
    if (cost === null || this.credits < cost) return false;

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
    const axe = AXE_TIERS.find((a) => a.id === axeId);
    if (!axe) return false;

    if (this.unlockedAxes.includes(axeId)) {
      this.equippedAxeId = axeId;
      this.axeCondition = 100;
      if (this.sound) this.sound.playUpgrade();
      this.saveToStorage();
      return true;
    }

    if (this.credits >= axe.cost) {
      this.credits -= axe.cost;
      this.unlockedAxes.push(axeId);
      this.equippedAxeId = axeId;
      this.axeCondition = 100;
      if (this.sound) this.sound.playUpgrade();
      this.saveToStorage();
      return true;
    }
    return false;
  }

  setLogType(typeId, forceUnlock = false) {
    if (!LOG_TYPES[typeId]) return false;
    const def = LOG_TYPES[typeId];
    if (!forceUnlock && def.unlockLevel > this.level) {
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

    // Every 6th split in Campaign mode spawns a Boss Round (alternating Boss Monarch Oak & Boss Glacial Stump)!
    if (
      this.gameMode === 'campaign' &&
      this.logsSplitCount > 0 &&
      this.logsSplitCount % 6 === 0 &&
      this.level >= 4 &&
      !LOG_TYPES[this.logType]?.isBoss
    ) {
      this.logType =
        this.level >= 7 && Math.floor(this.logsSplitCount / 6) % 2 === 0
          ? 'boss_stump'
          : 'boss_oak';
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
   * Regenerates stamina over time and ticks active Challenge Mode timers.
   */
  updateStamina(dt, isIdle = true, weather = 'sun') {
    this.maxStamina = this.getComputedMaxStamina();
    if (isIdle && this.stamina < this.maxStamina) {
      this.stamina = Math.min(
        this.maxStamina,
        this.stamina + this.getStaminaRegenRate(weather) * dt
      );
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
    isAutomatedSwing = false
  }) {
    const logDef = this.getCurrentLogDef();
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

    // Check if the player struck a planted Steel Splitting Wedge!
    const struckWedge =
      (Boolean(hitPlantedWedge) ||
        (this.plantedWedgeActive &&
          Math.abs(aimOffsetX - this.plantedWedgeOffsetX) < 0.032)) &&
      rockDistance >= 0.038 &&
      nailDistance >= 0.038;

    // Weather & Wet-Sap Cypress effects on slip / glancing threshold:
    // Rain or naturally waterlogged Swamp Bald Cypress makes outer bark slippery!
    const glanceThreshold =
      weather === 'rain' ? 0.62 : logDef.isWetLog ? 0.65 : 0.78;
    const isGlancing =
      !isAutomatedSwing && !struckWedge && normOffset > glanceThreshold;

    // Embedded Nail & Granite Fieldstone Rock Hazard checks
    const hitNail =
      !isAutomatedSwing &&
      !isGlancing &&
      !struckWedge &&
      (logDef.nails || 0) > 0 &&
      nailDistance < 0.038;
    const hitRock =
      !isAutomatedSwing &&
      !isGlancing &&
      !struckWedge &&
      !hitNail &&
      (logDef.rocks || 0) > 0 &&
      rockDistance < 0.042;

    // Grain alignment bonus (1.0 when perpendicular to grain, up to 1.35 when aligned with check line)
    const grainAlignment = Math.max(0, Math.cos(grainAngleError * 2));
    let grainBonusMult = 0.82 + grainAlignment * 0.43;

    // Forked Y-Crotch modifier: requires tight alignment with the crotch seam between the twin piths
    if (!isAutomatedSwing && logDef.isForked && !struckWedge) {
      grainBonusMult *= grainAlignment > 0.78 ? 1.2 : 0.76;
    }

    // Hollow Punky Log modifier: dead-center strikes (< 22% radius) punch into the empty rot cavity;
    // aiming slightly off-center (22%..56% radius) cleaves the solid sapwood wall cleanly!
    const centerAccuracy = Math.max(0, 1.0 - normOffset * 0.95);
    let centerMult = isGlancing ? 0.22 : 0.65 + centerAccuracy * 0.6;
    let hitHollowVoid = false;
    if (!isAutomatedSwing && logDef.isHollow && !isGlancing && !struckWedge) {
      if (normOffset < 0.22) {
        hitHollowVoid = true;
        centerMult *= 0.68;
      } else if (normOffset <= 0.56) {
        centerMult = 1.25; // Solid sapwood rim sweet spot!
      }
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

    // Spiral / Interlocked grain resistance (bypassed completely when driving a planted steel wedge!)
    const wedgePower = this.getEffectiveWedgePower();
    const twistResistance = struckWedge
      ? 1.28
      : !isAutomatedSwing && logDef.spiralTwist > 0.3
      ? Math.min(1.12, 0.76 + wedgePower * 0.22)
      : 1.0;

    // Steel Splitting Wedge multiplier when hammered with the maul/axe poll
    let steelWedgeMult = 1.0;
    if (struckWedge) {
      this.plantedWedgeStage = Math.min(3, (this.plantedWedgeStage || 1) + 1);
      steelWedgeMult = 1.75 + Math.min(0.45, (wedgePower - 1.0) * 0.6);
      centerMult = Math.max(centerMult, 1.25);
    }

    // Weather modifier on wood fracture:
    // - Rain / Wet Cypress: damp wood fibers absorb +12% impact energy
    // - Snow/Frost: frozen sap makes wood brittle (+22% cleavage propagation once struck firmly!)
    const weatherCleavageMult =
      weather === 'snow'
        ? 1.22
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
      weatherCleavageMult;

    // Automated swings (`window.swing()`) with default/reasonable power should reliably split logs
    const effectiveDamage = isAutomatedSwing
      ? Math.max(rawDamage, this.currentLogHp + 10)
      : Math.round(rawDamage);

    // Apply live blade wear / hazard nicking (driving a steel wedge with the flat poll protects the sharp bit!)
    if (!isAutomatedSwing && !struckWedge) {
      if (hitRock) {
        this.axeCondition = Math.max(15, Math.round(this.axeCondition - 28));
      } else if (hitNail) {
        this.axeCondition = Math.max(15, Math.round(this.axeCondition - 24));
      } else if (isGlancing) {
        this.axeCondition = Math.max(15, Math.round(this.axeCondition - 14));
      } else if (hitKnot) {
        this.axeCondition = Math.max(20, Math.round(this.axeCondition - 6));
      } else {
        const wear = logDef.toughness >= 200 ? 3 : 1.5;
        this.axeCondition = Math.max(
          25,
          Math.round((this.axeCondition - wear) * 10) / 10
        );
      }
    }

    this.currentLogHp = Math.max(0, this.currentLogHp - effectiveDamage);
    const didSplit = !isGlancing && !hitNail && !hitRock && this.currentLogHp <= 0;
    if (didSplit) {
      this.plantedWedgeActive = false;
      this.plantedWedgeStage = 0;
    }

    // Check piece-by-piece dismemberment on Forked Y-Rounds, Irregular Root Stumps, or Multi-Hit Slabs
    const forkBranchSheared =
      !didSplit &&
      !isGlancing &&
      !hitNail &&
      !hitRock &&
      Boolean(logDef.isForked) &&
      effectiveDamage >= 52;
    const rootButtressSheared =
      !didSplit &&
      !isGlancing &&
      !hitNail &&
      !hitRock &&
      Boolean(logDef.isIrregularStump || (logDef.rootFlares || 0) > 0) &&
      effectiveDamage >= 58;
    const slabSheared =
      !didSplit &&
      !isGlancing &&
      !hitNail &&
      !hitRock &&
      !forkBranchSheared &&
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
      rating = 'NAIL HAZARD! EDGE NICKED (-24% SHARP)';
    } else if (isGlancing) {
      // Penalty for glancing / off-center hazard hit
      this.combo = 0;
      pointsAwarded = -25;
      xpAwarded = 5;
      rating =
        weather === 'rain' || logDef.isWetLog
          ? 'WET BARK SLIP! (-25)'
          : 'GLANCING HIT! (-25)';
      // Cold snow jars the hands on a glancing blow
      if (weather === 'snow') {
        this.stamina = Math.max(0, this.stamina - 8);
      }
    } else if (didSplit) {
      // Clean split!
      const isOneShot = this.currentLogSwings === 1;
      const isBullseye =
        (logDef.isHollow ? normOffset >= 0.22 && normOffset <= 0.48 : normOffset < 0.18) &&
        grainAlignment > 0.75;

      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.logsSplitCount++;
      this.challengeSplits++;

      const comboMult = 1.0 + Math.min(this.combo - 1, 10) * 0.25;
      const accuracyBonus = Math.round(centerAccuracy * 75 + grainAlignment * 50);
      const oneShotBonus = isOneShot ? 60 : 0;
      const wedgeSplitBonus = struckWedge ? 85 : 0;
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
          precisionModeBonus) *
          comboMult *
          weatherBonus
      );
      xpAwarded = Math.round(
        (logDef.baseXp + accuracyBonus * 0.4) *
          (1 + Math.min(this.combo, 8) * 0.1) *
          weatherBonus
      );

      if (logDef.id === 'boss_stump') {
        rating = 'ANCIENT GRANITE STUMP CLEAVED! (+450 BOUNTY)';
        this.credits += 450;
      } else if (logDef.isBoss) {
        rating = 'BOSS MONARCH CLEAVED! (+300 BOUNTY)';
        this.credits += 300;
      } else if (struckWedge) {
        rating = 'STEEL WEDGE MAUL CLEAVE!';
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
        (struckWedge ? 48 : 30) * partialRatio * Math.max(0.4, centerAccuracy)
      );
      xpAwarded = Math.round((struckWedge ? 20 : 14) * partialRatio);
      if (struckWedge) {
        rating = `STEEL WEDGE DRIVEN! (${Math.round(this.currentLogHp)} HP LEFT)`;
      } else if (hitKnot) {
        rating = 'KNOT DEFLECTION (WIGGLE OR [SPACE] TO PRY!)';
        this.combo = 0;
      } else if (hitHollowVoid) {
        rating = 'HOLLOW ROT VOID! AIM FOR SAPWOOD WALL';
      } else if (forkBranchSheared) {
        rating = `Y-FORK LIMB LOPPED! (${Math.round(this.currentLogHp)} HP LEFT)`;
      } else if (rootButtressSheared) {
        rating = `ROOT BUTTRESS SHEARED! (${Math.round(this.currentLogHp)} HP LEFT)`;
      } else if (slabSheared) {
        rating = `SIDE SLAB SHEARED! (${Math.round(this.currentLogHp)} HP LEFT)`;
      } else {
        rating = `WEDGED ${Math.round(penetrationDepth * 100)}cm (WIGGLE / [SPACE] TO PRY!)`;
      }
    }

    this.score = Math.max(0, this.score + pointsAwarded);
    if (pointsAwarded > 0) {
      this.credits += pointsAwarded;
      this.challengeScore += pointsAwarded;
      if (
        this.gameMode === 'time_attack' &&
        this.challengeScore > this.bestTimeAttackScore
      ) {
        this.bestTimeAttackScore = this.challengeScore;
      }
    }

    // Add XP & check for Level Up
    this.xp += xpAwarded;
    let leveledUp = false;
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

    this.lastHit = {
      hit: true,
      split: didSplit,
      glancing: isGlancing,
      hitKnot,
      hitNail,
      hitRock,
      struckWedge,
      hitHollowVoid,
      forkBranchSheared,
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
      plantedWedgeStage: this.plantedWedgeStage,
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
    return {
      score: this.score,
      combo: this.combo,
      xp: this.xp,
      level: this.level,
      stamina: Math.round(this.stamina),
      axeCondition: Math.round(this.axeCondition),
      plantedWedge: this.plantedWedgeActive,
      plantedWedgeStage: this.plantedWedgeStage,
      logType: this.logType,
      currentLogHp: Math.round(this.currentLogHp),
      currentLogMaxHp: Math.round(this.currentLogMaxHp),
      logsSplitCount: this.logsSplitCount,
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
        sharpnessLevel: this.sharpnessLevel,
        weightLevel: this.weightLevel,
        staminaLevel: this.staminaLevel,
        unlockedAxes: this.unlockedAxes,
        equippedAxeId: this.equippedAxeId,
        axeCondition: this.axeCondition,
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
      if (typeof data.sharpnessLevel === 'number') this.sharpnessLevel = data.sharpnessLevel;
      if (typeof data.weightLevel === 'number') this.weightLevel = data.weightLevel;
      if (typeof data.staminaLevel === 'number') this.staminaLevel = data.staminaLevel;
      if (Array.isArray(data.unlockedAxes) && data.unlockedAxes.length > 0) {
        this.unlockedAxes = data.unlockedAxes;
      }
      if (typeof data.equippedAxeId === 'string') {
        this.equippedAxeId = data.equippedAxeId;
      }
      if (typeof data.axeCondition === 'number') {
        this.axeCondition = Math.max(15, Math.min(100, data.axeCondition));
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
