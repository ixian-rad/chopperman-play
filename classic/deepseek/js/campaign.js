/**
 * The authored campaign: six chapters, each two ordinary rounds and one boss.
 *
 * The module is deliberately free of DOM / Three.js / Rapier imports so it can
 * be unit-tested in Node and reused by GameState without a dependency cycle.
 * `campaignRound(index, logTypes)` returns a plain species-shaped object; main.js
 * presents it exactly like a LOG_TYPES entry.
 */

const BOSS_MECHANICS = {
  heartwood: {
    id: 'heartwood',
    label: 'Exposed heartwood',
    hint: 'Strike the glowing heartwood band for +1 bite',
    inner: 0.54,
    outer: 0.92,
    arc: 2.45,
    bonus: 1,
  },
  sapseam: {
    id: 'sapseam',
    label: 'Sap seam',
    hint: 'A narrow sap seam hides between the rings',
    inner: 0.42,
    outer: 0.74,
    arc: 1.9,
    bonus: 1,
  },
  ringshake: {
    id: 'ringshake',
    label: 'Ring shake',
    hint: 'The split follows the old ring shake near the bark',
    inner: 0.66,
    outer: 0.97,
    arc: 2.8,
    bonus: 1,
  },
};

export const CAMPAIGN_CHAPTERS = Object.freeze([
  Object.freeze({
    index: 1,
    id: 'firstFirewood',
    name: 'First Firewood',
    idea: 'Timing: hold the meter, release in the green, and let the follow-through finish.',
    blurb: 'Soft pine and paper birch. Learn the block before the block learns you.',
    bossName: 'The Big Pine',
    bossMechanic: 'heartwood',
    rounds: Object.freeze([
      Object.freeze({ logId: 'pine', hint: 'White pine is forgiving. A centred, well-timed swing splits it in one.' }),
      Object.freeze({ logId: 'birch', hint: 'Paper birch rewards the same clean centre with a brighter check.' }),
      Object.freeze({ logId: 'pine', boss: true, hint: 'Four bites. Keep the seam out of it and read the integrity bar.' }),
    ]),
  }),
  Object.freeze({
    index: 2,
    id: 'standingGrain',
    name: 'Standing Grain',
    idea: 'Grain and knots: aim between the knots and ride a radial check, not across it.',
    blurb: 'Dense oak and two knots. The bit tells you when you read the grain wrong.',
    bossName: 'The Knotty Warden',
    bossMechanic: 'sapseam',
    rounds: Object.freeze([
      Object.freeze({ logId: 'oak', hint: 'White oak needs two honest bites. Stay near the pith.' }),
      Object.freeze({ logId: 'knottyOak', hint: 'Two knots. Aim the bisector between them or bring more force.' }),
      Object.freeze({ logId: 'knottyOak', boss: true, hint: 'The sealed sap seam opens only after a normal bite into the rings.' }),
    ]),
  }),
  Object.freeze({
    index: 3,
    id: 'hollowHeart',
    name: 'Hollow Heart',
    idea: 'Hollow rounds: strike the rotten heart for a collapse, or tear the rim for a smaller bite.',
    blurb: 'The elm is punky to the core. Hit the open pocket, not the sound shell.',
    bossName: 'The Hollow Sentinel',
    bossMechanic: 'ringshake',
    rounds: Object.freeze([
      Object.freeze({ logId: 'rottenElm', hint: 'The dark pocket collapses in one blow. The pale rim only tears.' }),
      Object.freeze({ logId: 'hickory', hint: 'A dense honest round between you and the old elm.' }),
      Object.freeze({ logId: 'rottenElm', boss: true, hazards: 1, hint: 'Five bites, a bigger cavity, and a stone in the shell.' }),
    ]),
  }),
  Object.freeze({
    index: 4,
    id: 'hiddenSteel',
    name: 'Hidden Steel',
    idea: 'Hazards: steel and stone spark, roll the edge, and take the score with them. Work around them.',
    blurb: 'Old nails and river stone are buried in the rings. The edge remembers every mistake.',
    bossName: 'The Ironhearted',
    bossMechanic: 'heartwood',
    rounds: Object.freeze([
      Object.freeze({ logId: 'knottyHickory', hazards: 1, hint: 'A nail in the end grain. Watch the dark glint and aim away.' }),
      Object.freeze({ logId: 'ironwood', toughness: 1.32, hint: 'Real ironwood. Four bites, two hazards, and a thin margin.' }),
      Object.freeze({ logId: 'ironwood', boss: true, hazards: 2, toughness: 1.45, hint: 'The Ironhearted guards its seam. Open the rings, then strike the glow.' }),
    ]),
  }),
  Object.freeze({
    index: 5,
    id: 'twistedElm',
    name: 'Twisted Elm',
    idea: 'Twisted and forked grain: the checks spiral with height. Turn the blade with the local grain.',
    blurb: 'Interlocked elm and hickory. A straight radial line is a cross-grain drag here.',
    bossName: 'The Tangle',
    bossMechanic: 'sapseam',
    rounds: Object.freeze([
      Object.freeze({ logId: 'forkedElm', hint: 'Two piths. Pick one heart and read its own grain.' }),
      Object.freeze({ logId: 'hickory', twisted: true, hint: 'The checks wander. Match the blade guide before you release.' }),
      Object.freeze({ logId: 'hickory', boss: true, twisted: true, toughness: 1.26, hint: 'The Tangle turns its seam. Re-read it after every bite.' }),
    ]),
  }),
  Object.freeze({
    index: 6,
    id: 'ironCrown',
    name: 'The Iron Crown',
    idea: 'The final boss: three stone-bound sections hold the crown. Break each section and keep the edge alive.',
    blurb: 'The oldest ironwood in the yard. Three stones, three sections, one crown.',
    bossName: 'The Iron Crown',
    bossMechanic: 'ringshake',
    rounds: Object.freeze([
      Object.freeze({ logId: 'ironwood', hazards: 2, hint: 'A final warm-up: stone in the rings and four deep bites.' }),
      Object.freeze({ logId: 'ironStump', hint: 'The root-bound stump. Collapse the hollow heart, or undercut the roots.' }),
      Object.freeze({
        logId: 'ironwood',
        boss: true,
        finalBoss: true,
        hazards: 3,
        hint: 'Three stone-bound sections. Every third landed strike releases one section of the crown.',
      }),
    ]),
  }),
]);

const ROUNDS = Object.freeze(
  CAMPAIGN_CHAPTERS.flatMap((chapter) =>
    chapter.rounds.map((round, index) => ({
      ...round,
      chapter,
      roundInChapter: index + 1,
      boss: Boolean(round.boss),
    })),
  ),
);

export const CAMPAIGN_LENGTH = ROUNDS.length;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scaled(profile, round, chapter) {
  if (!round.toughness && !round.strikes) return profile;
  return {
    ...profile,
    toughness: round.toughness ?? profile.toughness,
    strikes: round.strikes ?? profile.strikes,
  };
}

/**
 * Build the log for campaign round `index` (0–17).
 * `logTypes` is passed in to avoid importing game.js (which imports this file).
 */
export function campaignRound(index, logTypes = []) {
  if (!Array.isArray(logTypes) || !logTypes.length) return null;
  const safeIndex = clamp(Math.round(Number(index) || 0), 0, ROUNDS.length - 1);
  const round = ROUNDS[safeIndex];
  const chapter = round.chapter;
  const base = logTypes.find((item) => item.id === round.logId) || logTypes[0];
  let profile = scaled(base, round, chapter);

  if (round.hazards != null) profile = { ...profile, hazards: round.hazards };
  if (round.hollow != null) profile = { ...profile, hollow: round.hollow };
  if (round.twisted != null) profile = { ...profile, twisted: round.twisted };

  let result = {
    ...profile,
    // The campaign reads from its own chapter/round, never the free ladder.
    campaign: true,
    campaignRound: safeIndex + 1,
    campaignIndex: safeIndex,
    campaignChapter: chapter.index,
    campaignChapterId: chapter.id,
    campaignChapterName: chapter.name,
    campaignIdea: chapter.idea,
    campaignRoundInChapter: round.roundInChapter,
    campaignHint: round.hint,
    campaignLength: ROUNDS.length,
    boss: Boolean(round.boss),
    finalBoss: Boolean(round.finalBoss),
    blurb: `${profile.blurb} ${round.hint}`,
  };

  if (round.boss) {
    const bossIndex = chapter.index - 1;
    const mechanic = BOSS_MECHANICS[chapter.bossMechanic] || BOSS_MECHANICS.heartwood;
    const factor = 1 + bossIndex * 0.09;
    // Bosses are sized and costed for the chapter they close. The final Crown
    // is a three-section structure: 9 strikes, 3 stone pockets, a wider round.
    const bossStrikes = round.finalBoss
      ? 9
      : Math.max(4, Math.round((profile.strikes || 1) + 2 + Math.floor(bossIndex / 2)));
    result = {
      ...result,
      name: chapter.bossName,
      short: round.finalBoss ? 'IRON CROWN' : 'BOSS',
      boss: true,
      bossIndex,
      bossMechanic: mechanic,
      bossSeamSealed: bossIndex >= 1,
      seamPhase: bossIndex >= 1,
      difficulty: 5,
      // Bosses are harder than the base species but capped: a 9-strike final
      // boss should be a long fight, not an unbreakable one. A normal clean
      // bite must stay possible without the heartwood seam.
      toughness: round.toughness ?? Math.min(1.62, profile.toughness * (1.02 + bossIndex * 0.04)),
      radius: (profile.radius || 0.18) * (round.finalBoss ? 1.42 : 1.12 + bossIndex * 0.015),
      height: (profile.height || 0.48) * (round.finalBoss ? 1.22 : 1.08),
      strikes: bossStrikes,
      knots: round.finalBoss ? 2 : Math.min(4, (profile.knots || 0) + 1),
      hazards: round.hazards ?? Math.max(1, profile.hazards || 0),
      basePoints: Math.round((profile.basePoints || 100) * (round.finalBoss ? 4.2 : 2.35 * factor)),
      crownSections: round.finalBoss ? 3 : 0,
      blurb: `${chapter.blurb} ${chapter.bossName} closes the chapter. ${mechanic.hint}.${
        bossIndex >= 1 ? ' Its seam is sealed until you open the rings.' : ''
      }${round.finalBoss ? ' Three stone-bound sections must fall separately.' : ''}`,
    };
  }
  return result;
}

export function campaignChapter(index) {
  const safe = clamp(Math.round(Number(index) || 1), 1, CAMPAIGN_CHAPTERS.length);
  return CAMPAIGN_CHAPTERS[safe - 1];
}

/**
 * First round index (0–17) of a chapter. Chapter 2 starts at round 3, chapter 6
 * at round 15. Kept here so the UI, GameState and tests share one rule.
 */
export function campaignStartRound(chapterIndex) {
  const safe = clamp(Math.round(Number(chapterIndex) || 1), 1, CAMPAIGN_CHAPTERS.length);
  return (safe - 1) * 3;
}

/** Chapter number (1–6) that contains a campaign round index (0–17). */
export function campaignChapterForRound(roundIndex) {
  const safe = clamp(Math.round(Number(roundIndex) || 0), 0, ROUNDS.length - 1);
  return Math.floor(safe / 3) + 1;
}

/** Highest chapter unlocked after `roundsCompleted` campaign logs. */
export function campaignUnlockedChapter(roundsCompleted) {
  const completed = Math.max(0, Math.min(ROUNDS.length, Math.round(Number(roundsCompleted) || 0)));
  return clamp(Math.floor(completed / 3) + 1, 1, CAMPAIGN_CHAPTERS.length);
}

/** Human-readable progress for HUD/state hooks. */
export function campaignMeta(index, logTypes = []) {
  const round = campaignRound(index, logTypes);
  if (!round) return null;
  return {
    index: round.campaignIndex,
    round: round.campaignRound,
    total: round.campaignLength,
    chapter: round.campaignChapter,
    chapterId: round.campaignChapterId,
    chapterName: round.campaignChapterName,
    chapterIdea: round.campaignIdea,
    roundInChapter: round.campaignRoundInChapter,
    boss: round.boss,
    finalBoss: round.finalBoss,
    bossName: round.boss ? round.name : null,
    crownSections: round.crownSections || 0,
    hint: round.campaignHint,
    next: index + 1 < round.campaignLength ? campaignRound(index + 1, logTypes).name : null,
  };
}
