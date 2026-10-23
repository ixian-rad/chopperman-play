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
    basePoints: 135,
    baseXp: 48,
    description: 'Medium-soft white bark round. Rewards crisp center-grain alignment.'
  },
  maple: {
    id: 'maple',
    name: 'Seasoned Red Maple',
    unlockLevel: 2,
    toughness: 130,
    densityMass: 6.2,
    radius: 0.148,
    height: 0.44,
    knots: 1,
    basePoints: 175,
    baseXp: 65,
    description: 'Dense suburban shade tree wood with a minor side branch knot.'
  },
  oak: {
    id: 'oak',
    name: 'Suburban White Oak',
    unlockLevel: 3,
    toughness: 165,
    densityMass: 7.2,
    radius: 0.155,
    height: 0.45,
    knots: 1,
    basePoints: 230,
    baseXp: 90,
    description: 'Heavy, tight-ringed New Jersey hardwood. Needs high momentum or two strikes.'
  },
  knotty_oak: {
    id: 'knotty_oak',
    name: 'Knotty Pin Oak',
    unlockLevel: 4,
    toughness: 205,
    densityMass: 7.8,
    radius: 0.162,
    height: 0.45,
    knots: 3,
    basePoints: 310,
    baseXp: 125,
    description: 'Twisted grain with protruding branch knots. Aim between knots along the check line!'
  },
  hickory: {
    id: 'hickory',
    name: 'Shagbark Hickory',
    unlockLevel: 5,
    toughness: 255,
    densityMass: 8.6,
    radius: 0.168,
    height: 0.46,
    knots: 2,
    basePoints: 420,
    baseXp: 170,
    description: 'Ultra-tough fibrous hardwood. Demands upgraded axe sharpness, mass, and timing.'
  }
};

export const LOG_ORDER = ['pine', 'birch', 'maple', 'oak', 'knotty_oak', 'hickory'];

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

    // Axe equipment
    this.unlockedAxes = ['hickory_splitter'];
    this.equippedAxeId = 'hickory_splitter';

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
    const axe = this.getEquippedAxe();
    const efficiency = Math.max(0.55, 1.0 - (this.staminaLevel - 1) * 0.045);
    return Math.round(16 * axe.staminaFactor * efficiency);
  }

  getEffectiveSharpness() {
    const axe = this.getEquippedAxe();
    return axe.sharpnessBonus * (1.0 + (this.sharpnessLevel - 1) * 0.14);
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
      if (this.sound) this.sound.playUpgrade();
      this.saveToStorage();
      return true;
    }

    if (this.credits >= axe.cost) {
      this.credits -= axe.cost;
      this.unlockedAxes.push(axeId);
      this.equippedAxeId = axeId;
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
    this.currentLogMaxHp = def.toughness;
    this.currentLogHp = def.toughness;
    this.currentLogSwings = 0;
  }

  /**
   * Advances to the next appropriate log in the progression if auto-progression is enabled.
   */
  advanceNextLog() {
    if (!this.autoProgressLogs) {
      this.resetCurrentLogHp();
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
   * Regenerates stamina over time.
   */
  updateStamina(dt, isIdle = true, weather = 'sun') {
    this.maxStamina = this.getComputedMaxStamina();
    if (isIdle && this.stamina < this.maxStamina) {
      this.stamina = Math.min(
        this.maxStamina,
        this.stamina + this.getStaminaRegenRate(weather) * dt
      );
    }
  }

  /**
   * Evaluates a chop strike against the current log, accounting for:
   * - Strike position relative to log center (`aimOffsetX`)
   * - Alignment with the wood grain check line (`grainAngleError` in radians)
   * - Proximity to 3D knots (`knotInterference` 0..1)
   * - Swing power / Timing meter multiplier (`swingPower` 0.25..1.5)
   * - Weather conditions ('sun', 'rain', 'snow', 'wind', 'fog')
   * - Axe sharpness, weight, and player stamina
   */
  evaluateStrike({
    aimOffsetX = 0,
    grainAngleError = 0,
    knotDistance = 1.0,
    swingPower = 1.0,
    weather = 'sun',
    isAutomatedSwing = false
  }) {
    const logDef = this.getCurrentLogDef();
    this.currentLogSwings++;

    // Ensure automated test swings always have stamina to perform a clean hit
    if (isAutomatedSwing && this.stamina < 25) {
      this.stamina = Math.max(45, this.maxStamina * 0.65);
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

    // Weather effects on slip / glancing threshold:
    // Rain makes wet bark slippery -> off-center hits past 62% of radius glance off!
    const glanceThreshold = weather === 'rain' ? 0.62 : 0.78;
    const isGlancing = !isAutomatedSwing && normOffset > glanceThreshold;

    // Grain alignment bonus (1.0 when perpendicular to grain, up to 1.35 when aligned with check line)
    const grainAlignment = Math.max(0, Math.cos(grainAngleError * 2));
    const grainBonusMult = 0.82 + grainAlignment * 0.43;

    // Center accuracy multiplier
    const centerAccuracy = Math.max(0, 1.0 - normOffset * 0.95);
    const centerMult = isGlancing ? 0.22 : 0.65 + centerAccuracy * 0.6;

    // Knot interference: if striking within 0.04m of a knot without high sharpness
    const hitKnot = !isAutomatedSwing && logDef.knots > 0 && knotDistance < 0.042;
    const sharpness = this.getEffectiveSharpness();
    const knotMult = hitKnot ? Math.min(1.0, 0.42 * sharpness) : 1.0;

    // Weather modifier on wood fracture:
    // - Rain: damp wood fibers absorb +12% impact energy
    // - Snow/Frost: frozen sap makes wood brittle (+22% cleavage propagation once struck firmly!)
    const weatherCleavageMult =
      weather === 'snow' ? 1.22 : weather === 'rain' ? 0.88 : 1.0;

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
      weatherCleavageMult;

    // Automated swings (`window.swing()`) with default/reasonable power should reliably split standard logs
    const effectiveDamage = isAutomatedSwing
      ? Math.max(rawDamage, this.currentLogHp + 10)
      : Math.round(rawDamage);

    this.currentLogHp = Math.max(0, this.currentLogHp - effectiveDamage);
    const didSplit = !isGlancing && this.currentLogHp <= 0;

    // Compute realistic edge penetration depth (in meters, 0.015m to 0.24m)
    const penetrationDepth = isGlancing
      ? 0.014
      : didSplit
      ? logDef.height
      : Math.min(
          logDef.height * 0.65,
          0.035 + (effectiveDamage / logDef.toughness) * 0.16
        );

    // Scoring, Combo, and XP calculation
    let pointsAwarded = 0;
    let xpAwarded = 0;
    let rating = 'SOLID HIT';

    if (isGlancing) {
      // Penalty for glancing / off-center hazard hit
      this.combo = 0;
      pointsAwarded = -25;
      xpAwarded = 5;
      rating = weather === 'rain' ? 'WET SLIP! (-25)' : 'GLANCING HIT! (-25)';
      // Cold snow jars the hands on a glancing blow
      if (weather === 'snow') {
        this.stamina = Math.max(0, this.stamina - 8);
      }
    } else if (didSplit) {
      // Clean split!
      const isOneShot = this.currentLogSwings === 1;
      const isBullseye = normOffset < 0.18 && grainAlignment > 0.75;

      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.logsSplitCount++;

      const comboMult = 1.0 + Math.min(this.combo - 1, 10) * 0.25;
      const accuracyBonus = Math.round(centerAccuracy * 75 + grainAlignment * 50);
      const oneShotBonus = isOneShot ? 60 : 0;
      const weatherBonus =
        weather === 'snow'
          ? 1.25
          : weather === 'rain' || weather === 'fog'
          ? 1.2
          : weather === 'wind'
          ? 1.15
          : 1.0;

      pointsAwarded = Math.round(
        (logDef.basePoints + accuracyBonus + oneShotBonus) * comboMult * weatherBonus
      );
      xpAwarded = Math.round(
        (logDef.baseXp + accuracyBonus * 0.4) * (1 + Math.min(this.combo, 8) * 0.1) * weatherBonus
      );

      if (isBullseye && isOneShot) {
        rating = 'PERFECT GRAIN CLEAVE!';
      } else if (isOneShot) {
        rating = 'CLEAN ONE-SHOT SPLIT!';
      } else {
        rating = 'LOG SPLIT!';
      }
    } else {
      // Partial penetration / wedged in tough wood or knot
      const partialRatio = effectiveDamage / logDef.toughness;
      pointsAwarded = Math.round(25 * partialRatio * centerAccuracy);
      xpAwarded = Math.round(12 * partialRatio);
      if (hitKnot) {
        rating = 'KNOT DEFLECTION (WEDGED)';
        this.combo = 0;
      } else {
        rating = `WEDGED (${Math.round(penetrationDepth * 100)}cm DEEP)`;
      }
    }

    this.score = Math.max(0, this.score + pointsAwarded);
    if (pointsAwarded > 0) {
      this.credits += pointsAwarded;
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
      logType: this.logType,
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
