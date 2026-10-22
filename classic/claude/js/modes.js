// Game modes on top of free play: an 8-stage campaign that ends every stage with a boss log,
// and three challenges (time attack, precision, daily seed). A mode supplies the rounds for the
// lawn queue, keeps its own score and swing count, and reports a summary when it ends.
import { Rng, clamp } from './rng.js';
import { makeLogParams } from './log.js';
import { TRAITS, TRAIT_IDS } from './data.js';

// Campaign stages. Rounds are [species, ...traits]; every replay of a stage uses the same seeds,
// so a stage can be learned. Bosses are oversized, multi-trait rounds with a toughness factor.
export const STAGES = [
  {
    id: 's1', name: 'Saturday Kindling', weather: 'clear', hour: 10, par: 8, reward: 120, gear: 'Hardware-store axe',
    blurb: 'Easy pine to warm up. Aim at the pith, release in the green.',
    rounds: [['pine'], ['pine'], ['pine', 'knotty'], ['pine', 'rotten']],
    boss: { name: 'Old Knotty', species: 'pine', traits: ['huge', 'knotty'], reqMul: 1.0, intro: 'A giant knotty pine round. Find the clear lane and work one crack.' },
  },
  {
    id: 's2', name: 'Cherry Season', weather: 'clear', hour: 17.6, par: 9, reward: 180, gear: 'Hardware-store axe',
    blurb: 'Golden hour, cherry and the first twisted grain.',
    rounds: [['cherry'], ['cherry', 'twisted'], ['pine', 'soaked'], ['cherry', 'knotty'], ['cherry']],
    boss: { name: 'The Wishbone', species: 'cherry', traits: ['forked', 'huge'], reqMul: 0.9, intro: 'A Y-shaped crotch. Turn the blade along the branch, through the pith.' },
  },
  {
    id: 's3', name: 'Wet Weekend', weather: 'rain', hour: 13, par: 10, reward: 260, gear: 'Splitting axe',
    blurb: 'Rain all day: slippery handles, glancing bark, heavy waterlogged ash.',
    rounds: [['ash'], ['ash', 'soaked'], ['cherry', 'rotten'], ['ash', 'twisted'], ['pine', 'forked']],
    boss: { name: 'The Sponge', species: 'ash', traits: ['huge', 'soaked'], reqMul: 0.95, intro: 'A drowned ash round, heavy as a bucket of water.' },
  },
  {
    id: 's4', name: 'Fence Line', weather: 'clear', hour: 15, par: 10, reward: 340, gear: 'Splitting axe',
    blurb: 'Trees that grew along an old fence: nails and stones in the bark.',
    rounds: [['oak', '+nail'], ['ash', 'rock'], ['cherry', 'knotty', '+nail'], ['oak'], ['ash', 'rock', 'twisted']],
    boss: { name: 'The Fence Eater', species: 'oak', traits: ['huge', 'rock', 'knotty', '+nail'], reqMul: 0.9, intro: 'It swallowed a fence: steel AND stone inside. Read the bark.' },
  },
  {
    id: 's5', name: 'Deep Freeze', weather: 'snow', hour: 8.5, par: 10, reward: 420, gear: 'Splitting maul',
    blurb: 'Snow and ice-glazed rounds. Frozen wood is brittle once the glaze breaks.',
    rounds: [['oak', 'iced'], ['maple'], ['maple', 'iced'], ['oak', 'twisted'], ['ash', 'iced', 'knotty']],
    boss: { name: 'The Glacier', species: 'maple', traits: ['huge', 'iced'], reqMul: 1.0, intro: 'A maple round sealed in ice. Crack the glaze, then the wood.' },
  },
  {
    id: 's6', name: 'Storm Cleanup', weather: 'storm', hour: 18.5, par: 11, reward: 520, gear: 'Splitting maul',
    blurb: 'A thunderstorm brought down the big trees. Hickory and forks.',
    rounds: [['hickory'], ['maple', 'forked'], ['oak', 'soaked', 'twisted'], ['hickory', 'knotty'], ['maple', 'rotten']],
    boss: { name: 'The Lightning Tree', species: 'hickory', traits: ['huge', 'forked', 'twisted'], reqMul: 0.85, intro: 'Struck, twisted and forked. Line up with the fork.' },
  },
  {
    id: 's7', name: 'Iron in the Fog', weather: 'fog', hour: 19.2, par: 11, reward: 650, gear: 'Composite splitter',
    blurb: 'Ironwood dulls your edge three times faster. You cannot read the energy in fog.',
    rounds: [['ironwood'], ['elm'], ['ironwood', 'knotty'], ['hickory', 'rock'], ['ironwood', 'twisted']],
    boss: { name: 'Iron Heart', species: 'ironwood', traits: ['huge', 'knotty'], reqMul: 0.8, intro: 'The densest round in the county. Sharpen first.' },
  },
  {
    id: 's8', name: 'The Old Elm', weather: 'frost', hour: 21.5, par: 12, reward: 900, gear: 'Monster maul',
    blurb: 'Night, hard frost, lanterns lit. The final job.',
    rounds: [['elm'], ['elm', 'forked'], ['ironwood', 'iced'], ['hickory', 'iced', 'knotty'], ['elm', 'twisted'], ['oak', 'rock', '+nail']],
    boss: { name: 'The Old Elm', species: 'elm', traits: ['huge', 'forked', 'knotty', '+nail'], reqMul: 0.85, intro: 'Interlocked, forked, knotted and full of steel. Good luck.' },
  },
];

export const CHALLENGES = {
  timeattack: { name: 'Time Attack', blurb: '90 seconds. Split as much as you can; combos matter.', limit: 90 },
  precision: { name: 'Precision', blurb: '8 rounds. Only accuracy counts: within 45% of the radius from the pith, one hit for full marks.', rounds: 8 },
  daily: { name: 'Daily Seed', blurb: 'Same 10 rounds and weather for everyone today, with a boss at the end.', rounds: 10 },
};

const FREE_BOSS_NAMES = ['The Stubborn One', 'Granddaddy Round', 'The Knucklehead', 'Old Ironsides', 'The Brute', 'The Gnarl', 'Big Trouble', 'The Widowmaker'];

const hashStr = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Build log params from a stage round spec: [species, ...traits], '+nail' forces a nail.
function specParams(seed, spec, extra = {}) {
  const [species, ...rest] = spec;
  const traits = rest.filter((t) => TRAITS[t]);
  return makeLogParams(seed, { species, traits, knotChance: 0.15, nailChance: 0, nail: rest.includes('+nail'), sizeBias: 0.5, ...extra });
}

// Free-play variant picks: more and nastier variants as the level rises, and a random boss
// every 10th round from level 3.
export function freeVariants(L, rng, seq) {
  const avail = TRAIT_IDS.filter((t) => TRAITS[t].minLevel <= L);
  const out = [];
  const chance = L < 2 ? 0 : Math.min(0.7, 0.15 + 0.06 * L);
  if (avail.length && rng.next() < chance) out.push(rng.pick(avail));
  if (L >= 6 && avail.length > 1 && rng.next() < 0.25) {
    const t = rng.pick(avail);
    if (!out.includes(t)) out.push(t);
  }
  let boss = null;
  if (L >= 3 && seq % 10 === 0) {
    boss = { name: rng.pick(FREE_BOSS_NAMES), intro: 'A boss round rolled off the truck.' };
    if (!out.includes('huge')) out.push('huge');
    const extra = avail.filter((t) => !out.includes(t) && t !== 'rotten');
    if (extra.length) out.push(rng.pick(extra));
  }
  return { traits: out, boss };
}

export class ModeRun {
  constructor(game, type, opts = {}) {
    this.game = game;
    this.type = type;
    this.opts = opts;
    this.produced = 0;
    this.splits = 0; // rounds finished
    this.swings = 0;
    this.points = 0;
    this.precision = 0;
    this.t = 0;
    this.ended = false;
    this.bossDown = false;
    if (type === 'campaign') {
      this.stage = STAGES[opts.stage ?? 0];
      this.stageIdx = opts.stage ?? 0;
      this.name = `Stage ${this.stageIdx + 1}: ${this.stage.name}`;
      this.total = this.stage.rounds.length + 1;
      this.weather = this.stage.weather;
      this.hour = this.stage.hour;
      this.seedBase = hashStr(this.stage.id) % 100000;
    } else if (type === 'daily') {
      this.dateKey = opts.dateKey ?? todayKey();
      this.seedBase = hashStr('daily' + this.dateKey) % 1000000;
      const r = new Rng(this.seedBase);
      this.name = `Daily ${this.dateKey}`;
      this.total = CHALLENGES.daily.rounds;
      this.weather = r.pick(['clear', 'clear', 'rain', 'snow', 'frost', 'wind', 'fog']);
      this.hour = r.pick([9, 12, 16, 17.8, 20.5]);
    } else if (type === 'precision') {
      this.name = 'Precision';
      this.total = CHALLENGES.precision.rounds;
      this.seedBase = (Math.random() * 1e6) | 0;
    } else {
      this.name = 'Time Attack';
      this.total = null;
      this.limit = CHALLENGES.timeattack.limit;
      this.seedBase = (Math.random() * 1e6) | 0;
    }
  }

  get timeLeft() { return this.limit ? Math.max(0, this.limit - this.t) : null; }

  // Next round for the lawn queue, or null when the mode has no more.
  nextParams() {
    if (this.ended) return null;
    if (this.total !== null && this.produced >= this.total) return null;
    const i = this.produced++;
    const seed = (this.seedBase * 31 + i * 7919) >>> 0;
    if (this.type === 'campaign') {
      const st = this.stage;
      if (i < st.rounds.length) return specParams(seed, st.rounds[i]);
      const b = st.boss;
      return specParams(seed, [b.species, ...b.traits], { reqMul: b.reqMul, boss: { name: b.name, intro: b.intro }, knotChance: 0 });
    }
    if (this.type === 'daily') {
      const r = new Rng(seed);
      if (i === this.total - 1) {
        return specParams(seed, [r.pick(['cherry', 'ash', 'oak']), 'huge', r.pick(['knotty', 'twisted', 'forked', 'iced'])],
          { reqMul: 0.85, boss: { name: 'Daily Boss', intro: 'Same boss for everyone today.' } });
      }
      const sp = r.pick(['pine', 'pine', 'cherry', 'cherry', 'ash', 'oak']);
      const traits = r.next() < 0.6 ? [r.pick(TRAIT_IDS.filter((t) => t !== 'huge'))] : [];
      return specParams(seed, [sp, ...traits], { knotChance: 0.25, nailChance: 0.05 });
    }
    if (this.type === 'precision') {
      // Clean-ish rounds of the unlocked species: this is about aim, not brute force.
      const g = this.game;
      const pool = g.unlocked.filter((s) => s.tough <= 1.1);
      const r = new Rng(seed);
      return makeLogParams(seed, { species: r.pick(pool.length ? pool : g.unlocked), knotChance: 0.35, nailChance: 0, sizeBias: 0.3, traits: r.next() < 0.3 ? ['knotty'] : [] });
    }
    return this.game.freeParams({ noBoss: true });
  }

  onHit(h) {
    if (this.ended) return;
    this.swings++;
    this.points = Math.max(0, this.points + h.points);
    if (h.result === 'split') {
      this.splits++;
      if (this.type === 'precision') {
        const off = 1 - h.accuracy;
        const s = Math.round(100 * clamp(1 - off / 0.45, 0, 1) * (h.hits <= 1 ? 1 : 0.6));
        this.precision += s;
        h.labels.push(`Precision ${s}/100`);
      }
      if (h.boss) this.bossDown = true;
    }
  }

  update(dt) {
    if (this.ended || !this.limit) return false;
    this.t += dt;
    return this.t >= this.limit;
  }

  get score() { return this.type === 'precision' ? this.precision : this.points; }

  status() {
    return {
      type: this.type, name: this.name, round: Math.min(this.splits + 1, this.total ?? Infinity), total: this.total,
      splits: this.splits, swings: this.swings, points: this.points, score: this.score,
      par: this.stage?.par ?? null, timeLeft: this.timeLeft, dateKey: this.dateKey ?? null,
    };
  }

  // Summary + persistent records. reason: 'done' | 'time' | 'quit'.
  finish(reason) {
    this.ended = true;
    const p = this.game.p;
    const rec = p.records;
    const sum = { type: this.type, name: this.name, reason, score: this.score, points: this.points, swings: this.swings, splits: this.splits, total: this.total, cash: 0, best: false, stars: 0 };
    if (reason === 'quit') return sum;
    if (this.type === 'campaign') {
      const st = this.stage;
      const stars = 1 + (this.swings <= Math.round(st.par * 1.3) ? 1 : 0) + (this.swings <= st.par ? 1 : 0);
      const prev = rec.campaign[st.id] ?? { stars: 0, best: 0 };
      sum.stars = stars;
      sum.par = st.par;
      sum.best = this.points > prev.best;
      // Full reward the first time, then only the improvement in stars pays out again.
      const newStars = Math.max(0, stars - prev.stars);
      sum.cash = prev.stars ? Math.round(st.reward * newStars / 3) : Math.round(st.reward * (0.5 + stars / 6));
      rec.campaign[st.id] = { stars: Math.max(prev.stars, stars), best: Math.max(prev.best, this.points) };
      sum.next = this.stageIdx + 1 < STAGES.length ? this.stageIdx + 1 : null;
    } else if (this.type === 'daily') {
      const prev = rec.daily?.date === this.dateKey ? rec.daily.best : 0;
      sum.best = this.points > prev;
      if (sum.best) rec.daily = { date: this.dateKey, best: this.points };
      sum.cash = rec.dailyPaid === this.dateKey ? 0 : 150;
      rec.dailyPaid = this.dateKey;
    } else {
      const prev = rec[this.type] ?? 0;
      sum.best = this.score > prev;
      rec[this.type] = Math.max(prev, this.score);
      sum.cash = Math.round(this.score / (this.type === 'precision' ? 6 : 20));
    }
    p.cash += sum.cash;
    return sum;
  }
}
